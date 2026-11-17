---
title: Caching and compression
description: "Response compression, weak ETags and 304s for handler responses, and how static files are revalidated."
---

Three `createApp` options decide how much of a response actually crosses the wire: `compression`
encodes bodies, `etag` lets a client that already has a response skip the body, and `static`
revalidates files instead of re-sending them. All three are off by default except static
revalidation, which comes with `static` itself. None of them needs a dependency.

## Compression — `createApp({ compression })`

```typescript
const app = createApp({ modules: [ApiModule], compression: true });

// or, with the defaults spelled out:
const app2 = createApp({
  modules: [ApiModule],
  compression: { threshold: 1024, encodings: ['br', 'gzip'] },
});
```

| Option | Default | Meaning |
|---|---|---|
| `threshold` | `1024` | smallest buffered body, in bytes, worth encoding; streams ignore it |
| `encodings` | `['br', 'gzip']` | the codings core may produce, in server preference order |

`threshold` must be a non-negative integer and `encodings` a non-empty array of `'br'` and
`'gzip'`; anything else throws at `createApp`.

The coding is negotiated on the request's `Accept-Encoding`, with q-values, `identity`, `*` and
`q=0`. The highest `q` wins and a tie goes to the order of `encodings`. A request without
`Accept-Encoding` gets identity: the spec allows any coding then, but a client that sends no header
is overwhelmingly one that would not decode it.

### What gets compressed

A response is a candidate when its `Content-Type` is text (`text/*`), JSON, JavaScript, ndjson, XML,
SVG, wasm, or any `+json` / `+xml` type. It is left alone when it:

- already has a `Content-Encoding` or a `Content-Range`;
- has no `Content-Type`;
- says `Cache-Control: no-transform`;
- is a `204`.

That covers handler responses, error responses and [static files](/docs/guides/html/#static-files--createapp-static-)
alike. An encoded body loses its `Content-Length`, which described the identity bytes.

A buffered body under `threshold` is sent identity whatever the client accepts. A `HEAD` is never
encoded, since it has no body; it only gets `Vary` (below).

### `Vary: Accept-Encoding`

A shared cache has to know that a response depends on `Accept-Encoding`, or it hands a brotli body
to a client that cannot read one. Core adds `Vary: Accept-Encoding`, merged with any `Vary` the
response already has, wherever the request decided the outcome:

- an encoded response;
- an identity response to a client that accepted none of `encodings`;
- a `HEAD`;
- every `304`, so a cache revalidates under the same key it stored the `200` under.

A body under the threshold gets **no** `Vary`. It is identity for every client, so `Accept-Encoding`
played no part in it, and a cache is right to store one copy for everyone. Skipping the header also
matters for speed: on Deno it costs about 10% of a small request (about 3% on Bun).

A response that is not a candidate at all (an image, `no-transform`, already encoded) gets no
`Vary` either.

### Streams

SSE and ndjson streams are compressed too, and flushed after every event, error frame and ping, so
each event can be decoded the moment it arrives instead of waiting in the compressor's buffer.
`threshold` does not apply to them.

### Per runtime

- **Node and Bun:** `node:zlib`, always through its async API, with brotli at quality 4. The sync
  API, and brotli's default quality of 11, stall the event loop under load.
- **Deno:** the same code, but Deno runs `node:zlib`'s async API on the main thread, so compression
  costs event-loop time there — about 4× slower than Node for a 51 KB gzip under load. Deno's own
  `automaticCompression` is about 3× faster than core's for gzip (slower for brotli, and it weakens
  strong ETags on what it encodes). If gzip is all you need on Deno, leave `compression` off and let
  the runtime do it.
- **Edge (Cloudflare Workers):** core never encodes. Cloudflare compresses in front of the Worker,
  and a body core had already encoded would be encoded a second time. Core sets only `Vary`, on every
  candidate response, since there the encoding is decided outside the app. The edge is recognised
  through `edgeHandler`, or at `createApp` by detecting workerd.

## ETags for handler responses — `createApp({ etag: true })`

```typescript
const app = createApp({ modules: [ApiModule], etag: true });
```

A buffered `200` to `GET` or `HEAD` gets a weak `ETag`, `W/"<length>-<hash>"`, from a 32-bit FNV-1a
hash of its body plus its byte length. A request whose `If-None-Match` matches it — weak comparison,
so `W/"x"` matches `"x"`; a comma-separated list; or `*` — gets a `304` with no body.

- **A handler that sets its own `etag` header keeps it**, and that tag is what `If-None-Match` is
  compared against. Use it when you already have a version or revision to tag with.
- **The handler still runs.** The ETag is computed from the body it produced, so this saves
  bandwidth, not work.
- Streams, non-`200` responses and other methods are never tagged.
- With `compression` on, the tag is taken on the identity body and is weak, so one tag describes
  every coding of it.

FNV-1a is not collision-resistant, and need not be: an ETag detects a change, it does not
authenticate one. It is synchronous and dependency-free, where `crypto.subtle.digest` would cost a
promise per response.

`etag` takes a boolean only; anything else throws at `createApp`.

## Static files are revalidated

Every file `static` serves carries:

- a weak `ETag`, `W/"<size>-<mtime>"`, from the file's `stat`;
- `Last-Modified`, from the same `stat`;
- `Cache-Control: no-cache`, unless you configure another value.

A request with a matching `If-None-Match` — or, when it sends no `If-None-Match`, an
`If-Modified-Since` no earlier than the file's modification time — gets a `304` decided from the
`stat` alone, without reading the file. A `HEAD` does not read the file either. These validators
are sent whether or not `etag` is on.

`no-cache` does not mean "do not cache". It means "cache, but ask before reusing": the browser keeps
the file and revalidates it, which costs a `304` with no body when nothing changed. Without it,
a browser seeing `Last-Modified` is free to guess a lifetime from it and reuse a stale file without
asking.

### Choosing `Cache-Control` — `static: { dir, cacheControl }`

The object form of `static` sets the `Cache-Control` sent with every static file and its `304`s:

```typescript
// Content-hashed assets (app.3f2a.js) never change under the same name.
const app = createApp({
  modules: [ApiModule],
  static: { dir: 'dist/assets', cacheControl: 'public, max-age=31536000, immutable' },
});
```

| Key | Default | Meaning |
|---|---|---|
| `dir` | `./public` | the directory, as in `static: '<dir>'` |
| `cacheControl` | `'no-cache'` | the `Cache-Control` value for static responses |

`static: true` and `static: '<dir>'` keep working and mean `cacheControl: 'no-cache'`. An unknown
key, a `dir` that is not a string, or a `cacheControl` containing CR or LF throws at `createApp`.

:::caution[Changed in this release]
Before this release a static hit carried only `Content-Type`: no validators and no
`Cache-Control`, and every request — `HEAD` included — read the file and sent it in full. Static
responses now always carry `ETag`, `Last-Modified` and `Cache-Control: no-cache`. If a proxy or CDN
in front of the app relied on the old headers, set `static: { cacheControl }` to the value it
expects.
:::

## Related

- [HTML & views](/docs/guides/html/) — `@Html` and the `static` option itself.
- [Streaming](/docs/guides/streaming/) — the SSE and ndjson transports that compression flushes per event.
- [Runtimes](/docs/guides/runtimes/) — what differs between Node, Deno, Bun and the edge.
- [createApp](/docs/reference/createapp/) — every option in one place.
