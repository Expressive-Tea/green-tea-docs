---
title: Runtimes (Node, Deno, Bun, edge)
description: "Run Green Tea anywhere with app.fetch — the Web-Standards handler."
---

Green Tea exposes a Web-Standards handler, `app.fetch(request): Promise<Response>`, so the
same app runs on any runtime that speaks the Fetch API — for **HTTP and SSE** today.

```ts
const app = createApp({ modules: [ApiModule] });

// Node (native listener, TLS, timeouts)
await app.listen(3000); // rejects if the port is taken or a provider fails to boot

// Deno
Deno.serve(app.fetch);

// Bun
Bun.serve({ fetch: app.fetch });

// Cloudflare / edge
export default { fetch: app.fetch };
```

**`listen()`, `serveDeno()` and `serveBun()` boot the providers before anything binds.** What stays
lazy is what you drive yourself — `app.fetch` and `app.upgrade` handed to `Deno.serve`, `Bun.serve`
or your own server — and `edgeHandler`, where workerd offers no startup to move the work to. Those
boot on the first request, and the boot result is memoized, failure included. A provider that throws
there fails *every* request from then on, answered by the runtime with a 500 that never reaches your
`onError`, while the process itself looks healthy.

`await app.boot()` moves that failure to startup, where a bad key or an unreachable database
belongs:

```ts
const app = createApp({ modules: [ApiModule] });
await app.boot();               // throws here instead of on every request
Deno.serve({ port: 8000 }, app.fetch);
```

| Entry point | Providers boot | A failing provider |
|---|---|---|
| `app.listen()` (Node) | Before accepting | `listen()` rejects |
| `await serveDeno()` / `await serveBun()` | Before binding | the call rejects; no port opens |
| `await app.boot()`, then serve | Before serving | `boot()` rejects; the process exits |
| `app.fetch` / `app.upgrade` on a server you own | First request | Every request fails, from the runtime |
| `edgeHandler` (workerd) | First request, unavoidably | Every request fails until the next deploy |

It is idempotent and shares its memo with `listen()` and `fetch()`, so calling both boots once.
Unlike `ready()`, it does run provider factories. On workerd there is no startup outside a request,
so there is nothing `boot()` can move — the last row is the whole story there.

:::caution[Breaking in 26.9.0-beta.2]
`serveDeno()` and `serveBun()` are async. They return `Promise<DenoServer>` and
`Promise<BunServeResult>`, and the values they resolve to are unchanged:

```diff
- const server = serveDeno(app, { port });
+ const server = await serveDeno(app, { port });
```

Before this they were rows four and five of that table, and the documented fix was to remember
`await app.boot()` first. That made the correct use of a core helper depend on reading this page —
in a framework whose argument is that order should not be something you have to get right. Both
runtimes support top-level `await`, so a module that serves at import time needs nothing else.
`edgeHandler` is deliberately untouched: on workerd there is no startup outside a request, so there
is no earlier moment to move the failure to.
:::

**Node is the reference implementation.** A parity suite pins `app.fetch` to Node's native
listener — identical status, headers, and body for the same request. The other runtimes drive
that *same* `app.fetch` / `app.upgrade` core, so they inherit that behaviour rather than
re-implementing it, and each carries its own smoke tests: Deno and Bun cover WebSocket and mesh,
and edge runs against real workerd (Miniflare).

**All four runtimes now have full WebSocket support:** Node via `app.listen()`, Deno and Bun via
`serveDeno` / `serveBun`, and Cloudflare Workers / edge via `edgeHandler` (see below) — same graph,
same `@Ws` handlers, same rooms/channels everywhere. `app.listen()`, TLS and per-request timeouts
remain Node-only; on Deno/Bun/edge you get `app.fetch` + the runtime's adapter. **Mesh (alpha)
runs on Node, Deno and Bun** — teapot and teacup, in any combination — but not on edge.

Same API is not the same behaviour in every detail. The differences this page covers:

- **Compression:** on the edge core never encodes and sets only `Vary`; Cloudflare applies the
  encoding. Node, Deno and Bun encode in-process.
- **WebSocket outbound backpressure:** Node, Deno and Bun wait for a slow client's send buffer;
  workerd reports no buffered amount, so the edge [never waits](#websocket-backpressure).
- **TLS** is Node-only: `serveDeno()` and `serveBun()` reject an app created with `createApp({ tls })`
  before they boot or bind, rather than serving plain HTTP to someone who asked for HTTPS.
- **WebSocket message size** and **`ctx.ip`** are refused and resolved differently per runtime; see
  [below](#websocket-message-size).

**Connection-limit enforcement is Node-only:** `limits.maxConnections` defaults to `1000`; values
`<= 0` leave Node's connection count unlimited. Positive values map to Node's
`server.maxConnections` when the app runs through `app.listen()`. When the cap is reached, Node
destroys excess sockets without sending an HTTP response. `Deno.serve` and `Bun.serve` expose no
equivalent active-socket cap, so `serveDeno` and `serveBun` cannot enforce this option. Apply the
connection limit at the deployment platform or reverse proxy on those runtimes.

`limits.maxConcurrentRequests` is separate from the connection limit and applies per server or Fetch adapter instance, so an app using both `app.listen()` and `app.fetch` has two independent request budgets. It bounds concurrently executing handlers; a handler that never returns continues to hold its slot, while on Node a client disconnect releases that slot. Excess requests receive `503 Service Unavailable` with `Retry-After: 1`.

**Draining belongs to whoever owns the server.** On Deno and Bun the app is served through
`app.fetch` and never through `app.listen()`, so `app.close()` has no connections to drain — it
warns if you passed `timeoutMs`. The server `serveDeno()` and `serveBun()` return carries the same
`close({ timeoutMs })` instead:

```ts
const server = await serveBun(app, { port: 3000 });   // or await serveDeno(app, { port: 3000 })
await server.close({ timeoutMs: 5_000 });
```

**Shutdown teardown runs on all three, from that same `close()`.** A provider's `dispose()`, a
plugin's `onShutdown` and an app's `hooks` behave identically on Node, Deno and Bun — one call is
enough, because `serveDeno()`/`serveBun()`'s `close()` drains the connections and then the app.

**Reaching that `close()` from a signal is the one place the runtimes still spell things
differently** — `process.on` and `process.exit` on Node and Bun, `Deno.addSignalListener` and
`Deno.exit` on Deno. Write it yourself and your three entrypoints stop being identical for the sake
of one block. Or let the framework absorb it, which is what the option is for:

```ts
createApp({ modules: [App], handleSignals: true });   // same line on all three
```

Off by default, because when the process exits is the application's call and a library has no
business deciding it behind your back. Declared once on `createApp`, and whichever boot call you use
attaches it to the closer that drains *that* server — so on Deno and Bun it is the server's
`close()`, not the app's, that the signal reaches. See
[who calls `close()`](/docs/guides/dependency-injection/#who-calls-close).

On Cloudflare Workers there is nothing to close: `edgeHandler` is a handler, not a server, and the
platform owns the lifecycle. **Teardown therefore never runs on the edge, and nothing can make it** —
an isolate is discarded rather than closed, so there is no shutdown to intercept. A provider or
plugin that relies on `dispose()`/`onShutdown` to release something is silently inert there. Anything
that must be released belongs in the request that acquired it, or in a platform binding that manages
its own lifetime.

One difference the deadline cannot hide:

| Runtime | After the deadline |
|---|---|
| Node | warns, then `closeAllConnections()` — the remainder is cut |
| Bun | warns, then `stop(true)` — the remainder is cut |
| Deno | warns, then **returns anyway**; the remainder ends with the process |

Deno offers no force-close that composes with a drain already under way — aborting the signal its
server was started with throws `BadResource` once `shutdown()` is pending. So on Deno the deadline
bounds how long `close()` waits, not when the connections die. Exit the process after `close()`
resolves and the effect is the same; keep serving and it is not.

**Body-size enforcement is the same on every runtime.** `maxBodyBytes` is checked while the body
is read: a `Content-Length` that already declares more than the limit is refused before any of the
body is read, and otherwise reading stops at the chunk that crosses it, so an oversized upload is
never buffered in full. (On Deno, Bun and the edge, a well-formed `Content-Length` within the limit
is read in one `arrayBuffer()`, since the runtime frames the body by that header; only a chunked
upload takes the chunk-by-chunk read.) The answer is the same `413` everywhere. The one difference is on workerd,
which may drop `Content-Length` from a chunked upload, so there the refusal comes from the running
count rather than up front. See [uploads](/docs/guides/uploads/#limits).

## WebSocket on Deno

`app.fetch` covers HTTP + SSE on every runtime. WebSocket needs a runtime-specific
upgrade, so Deno gets a dedicated adapter at `@green-tea/core/deno`:

```ts
import { createApp } from '@green-tea/core';
import { serveDeno } from '@green-tea/core/deno';

const app = createApp({ modules: [ChatModule] });

// HTTP + SSE via app.fetch, WebSocket via Deno.upgradeWebSocket — one call:
await app.boot();
await serveDeno(app, { port: 8000 });
```

`serveDeno` routes normal requests through `app.fetch` and WebSocket upgrades through
`app.upgrade` — the same graph, the same `@Ws` handlers, the same rooms/channels you
run on Node. Behaviour matches the Node reference.

**Advanced:** `app.upgrade(request, socket)` is the neutral primitive `serveDeno` uses.
Any runtime can build a `WsSocket` capability (`inbound`, `abort`, `isOpen`, `send`,
`close`, `terminate`, and optionally `drained`) and drive the graph — `serveBun` and `edgeHandler`
build on the same primitive (see below). `drained()` resolves once the socket's send buffer is at or
below the adapter's high-water mark, or the socket has closed; the outbound pump awaits it before
each pull. A socket built without it is never waited on.

**Still Node-only:** `app.listen()`, TLS and per-request timeouts. On Deno you get
`app.fetch` + `serveDeno`, and `serveDeno()` rejects an app created with `tls`. [Mesh](/docs/guides/mesh/) works here: the control channel is
served through `app.upgrade` and the teacup connects with Deno's global `WebSocket`.

## WebSocket on Bun

`app.fetch` covers HTTP + SSE on every runtime. WebSocket needs a runtime-specific
upgrade, so Bun gets a dedicated adapter at `@green-tea/core/bun`:

```ts
import { createApp } from '@green-tea/core';
import { serveBun } from '@green-tea/core/bun';

const app = createApp({ modules: [ChatModule] });

// HTTP + SSE via app.fetch, WebSocket via Bun's server-level handler — one call:
await app.boot();
await serveBun(app, { port: 8000 });
```

`serveBun` routes normal requests through `app.fetch` and WebSocket upgrades through
`app.upgrade` — the same graph, the same `@Ws` handlers, the same rooms/channels you
run on Node and Deno. Behaviour matches the Node reference.

**Still Node-only:** `app.listen()`, TLS and per-request timeouts. On Bun you get
`app.fetch` + `serveBun`, and `serveBun()` rejects an app created with `tls`. [Mesh](/docs/guides/mesh/) works here too.

## Cloudflare Workers / edge

`app.fetch` covers HTTP + SSE on every runtime. WebSocket needs a runtime-specific
upgrade, so Cloudflare Workers get a dedicated adapter at `@green-tea/core/edge`:

```ts
import { createApp } from '@green-tea/core';
import { edgeHandler } from '@green-tea/core/edge';

const app = createApp({ modules: [ChatModule] });

export default { fetch: edgeHandler(app) };
```

`edgeHandler` routes normal requests through `app.fetch` and WebSocket upgrades through
`WebSocketPair` and `app.upgrade` — the same neutral primitive `serveDeno` and `serveBun`
use. Same graph, same `@Ws` handlers, same rooms/channels as Node/Deno/Bun; behaviour
matches the Node reference; validated on real workerd (Miniflare).

**Requirement:** the Worker must enable the `nodejs_compat` compatibility flag —
`wrangler.toml`:

```toml
compatibility_flags = ["nodejs_compat"]
compatibility_date = "2024-09-23" # or later
```

Green Tea's core statically imports Node built-ins that workerd only provides under
this flag; without it, the Worker fails to load.

**Still Node-only:** `app.listen()`, TLS and per-request timeouts. [Mesh](/docs/guides/mesh/)
is **not** supported on edge: the teapot's secret comparison needs `node:crypto`'s
`timingSafeEqual`, which `nodejs_compat` does not provide. Cloudflare's
Durable Objects and WebSocket Hibernation are **not** used — `edgeHandler` accepts
WebSockets with the standard `WebSocketPair` model, so a Worker holds the connection
open for its lifetime rather than hibernating between messages.

## WebSocket message size

[`limits.maxWsMessageBytes`](/docs/guides/streaming/#inbound-limits) (default 1 MiB) applies on
every runtime, but only Node and Bun let the server refuse a message before it is buffered:

| Runtime | Oversized message refused | The client sees |
|---|---|---|
| Node | before buffering (`ws`'s `maxPayload`) | `1009` |
| Bun | before buffering (Bun's `maxPayloadLength`) | `1009` on Bun 1.4 and later; `1006` before 1.4, which drops the connection without a close frame |
| Deno | after the whole message is received | `1009` |
| edge (workerd) | after the whole message is received | `1009` |

Deno and workerd offer no per-message size option, so there the message is held in memory before
the limit is checked, and only the platform's own cap bounds it. `maxWsQueue` behaves the same on
all four.

A Bun app that serves as a mesh teapot raises Bun's native limit to the control channel's larger
bound, so on a user route the framework refuses an oversized message instead, with `1009` on every
Bun version.

## WebSocket backpressure

A `@Ws` handler's outbound iterator is pulled only while the socket's send buffer is at or below
1 MiB, so a slow client cannot grow it without limit (see
[streaming](/docs/guides/streaming/#outbound-backpressure)). Each runtime signals in its own way:

| Runtime | How the wait ends |
|---|---|
| Node | `ws`'s `bufferedAmount` and send callback |
| Bun | `getBufferedAmount()` and the `drain` callback |
| Deno | polls `bufferedAmount`, since its `WebSocket` has no drain event |
| edge (workerd) | **never waits**: workerd reports no buffered amount, so buffering is left to the platform |

## The client address — `ctx.ip`

`serveDeno()` and `serveBun()` give `app.fetch` the socket peer, so `ctx.ip` is populated on Deno and
Bun as it is on Node. All three follow one rule: with `trustProxy` on and an `X-Forwarded-For`
header present, `ctx.ip` is the header's first hop; otherwise it is the socket peer. That includes
`trustProxy` with no `X-Forwarded-For`, which falls back to the peer.

`ctx.ip` is resolved the first time a step, a handler or a plugin reads it, and kept for the rest of
the request; a route that never reads it pays nothing. What reading it costs depends on the runtime:

| Runtime | Where the address comes from | Cost when read |
|---|---|---|
| Node | `req.socket.remoteAddress`, cached by Node per connection | negligible |
| Deno | `info.remoteAddr`, handed over by `Deno.serve` | negligible |
| Bun | `server.requestIP()`, a native call per request | 7–11% of a small request |
| edge | the `cf-connecting-ip` header, under `trustProxy` | negligible |

Behind a proxy that sets `X-Forwarded-For`, `trustProxy: true` takes the address from the header on
every runtime and never asks the socket. Inside a stream body `ctx.ip` is `''` unless a step or the
handler read it before returning the stream, because the socket may already be gone by then.

Addresses are passed through as each runtime reports them. The IPv6 loopback is `::1` on all three,
but Node may report an IPv4 client in IPv4-mapped form, such as `::ffff:127.0.0.1`. Normalize before
comparing addresses across runtimes.

`app.fetch` handed to a server directly, as in `Deno.serve(app.fetch)` or
`Bun.serve({ fetch: app.fetch })`, or called from your own code, has no socket to report, so
`ctx.ip` is `''` there (or the forwarded hop, with `trustProxy`). Only `serveDeno()` and `serveBun()`
pass the peer along. A `Request` copied from the one the adapter received carries nothing either.

`edgeHandler` has no peer address either: workerd exposes none. Under `createApp({ trustProxy: true })`
it takes `ctx.ip` from `CF-Connecting-IP`, ahead of `X-Forwarded-For`, because Cloudflare sets that
header itself while `X-Forwarded-For` can carry hops the client supplied. This applies to HTTP and
WebSocket upgrades alike. Without `trustProxy` the header is ignored and `ctx.ip` is `''`, since
trusting it is only correct behind Cloudflare. Only `edgeHandler` reads it; the Node, Deno and Bun
adapters, and a bare `app.fetch`, ignore it.

Anything keyed on `ctx.ip`, such as a rate limiter, needs one of the populated paths. Otherwise every
client lands in the same bucket.

## Filesystem features — Node/Deno/Bun only

A few [HTML & views](/docs/guides/html/) features read from disk, so they need a runtime with
a filesystem:

- `@Html('file.html')` — reads and caches the file at boot.
- `@Html('file.html', { template: true })` — same, then renders it per request.
- `createApp({ static })` — serves a directory of files.

All three throw at boot (`createApp()`/route-build time) on a runtime without a
filesystem, rather than failing per-request. On the edge, use bare `@Html` returning a
string instead — pair it with the exported `render` over a template string you `import`
as a module (so it ships in the bundle, no disk read), and serve other assets (images,
CSS, JS) from a CDN in front of the Worker.
