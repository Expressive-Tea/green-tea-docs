---
title: What's new
description: "What changed in @green-tea/core RC.1, and what it means if you are already using it."
---

:::note[The API is frozen from RC.1]
RC.1 is the first release candidate. From here to the first stable release, releases are fixes
only: nothing public is added, removed, renamed or narrowed. [API stability](/docs/stability/) has
the full policy, including how deprecations work after stable.
:::

This is what changed in **RC.1** since `26.9.0-beta.2`, in the order it matters to you rather than
the order it was built. The [full changelog](https://github.com/Expressive-Tea/green-tea/blob/main/CHANGELOG.md)
has every release and every detail; this page is only the current one.

The breaking changes come first, because they are what can stop an upgrade. Each one is behaviour
that had to move before the freeze, and each has a migration. Nothing published in beta.2 was
removed: the one renamed type keeps its old name as a deprecated alias.

## Breaking

### Node 22 is the minimum

Node 18 and 20 are end-of-life and receive no security patches, so `engines.node` is now `>=22`.
**Migrate:** upgrade Node before you upgrade green-tea.

### Response header values are `string | string[]`

`TransformerFn`, `ErrorResponse.headers`, `HttpError.headers` / `HttpErrorLike.headers` and the
pipeline's `ResponseShape.headers` widen from `Record<string, string>`, so a response can carry
several `Set-Cookie` lines. A `set-cookie` array goes out as one header line per element on every
runtime; before, the fetch adapters joined it into one broken `a,b` cookie. Any other array is sent
as one line joined with `, `.

**Migrate:** code that *produces* headers needs nothing. Code that *reads* `headers[k]` from one of
these types as a `string` stops compiling and must handle the array.

### Inbound WebSocket messages are capped at 1 MiB, and 16 unread messages

A larger message closes the connection with `1009`; a 17th unread message closes it with `1013`.
Before, Node allowed 100 MiB, the other runtimes applied no cap, and the inbound queue was
unbounded everywhere. A `@Ws` handler that never reads `inbound` counts too.

**Migrate:** raise the bounds with `limits.maxWsMessageBytes` and `limits.maxWsQueue` if your
clients legitimately need more. See [Streaming](/docs/guides/streaming/#inbound-limits).

### Overlapping constrained route params fail boot

Two routes of one method that branch at the same segment now fail `createApp` when both constraints
accept a common segment (`/u/:id(\d+)` and `/u/:n(\d{1,3})`), or when a constraint that accepts
every segment makes a plain sibling unreachable. Before, registration order picked silently.

**Migrate:** make the router's choice explicit — make the constraints disjoint (`\d{1,3}` and
`\d{4,}`), keep one route and branch in its handler, or move one under a static segment of its own.
Delete a plain param reported as unreachable: it never answered a request. For a WebSocket pair,
declare the constrained route first. See
[Routing](/docs/guides/routing/#overlapping-constraints-fail-at-boot).

### A token has one producer

A second node providing a token fails `createApp`, naming both:
`token 'user' is provided twice: by 'user' (module:AppModule) and by 'shadow' (plugin)`. Before,
the last one registered won, so a plugin could silently replace the app's own provider. The rule
covers modules, plugins, mesh steps and the built-ins `logger`, `rooms` and `events`. `overrides`
keep working.

**Migrate:** rename one producer's token. See [Plugins](/docs/guides/plugins/#what-a-plugin-can-and-cannot-touch).

### A node that needs the token it provides fails boot

A step with `needs: ['user']` and `provides: 'user'` used to boot and then read a value nobody had
written. It now fails as a cycle: `cycle detected: user -> user (it needs 'user', which only it
provides)`. Seeded tokens such as `req` and `params` still satisfy a node's own need.

**Migrate:** remove the token from the node's `needs`, or move the work that produces it into a
separate provider or step the node needs. See
[Dependency injection](/docs/guides/dependency-injection/#a-node-cannot-need-what-it-provides).

### `/__mesh__/control` is reserved in every app

A `@Ws`, `@Stream` or HTTP route that claims it — or a mountpoint that adds up to it — fails
`createApp`, mesh or not. Before, Node served a user route there when no mesh was configured, while
Deno, Bun and the edge refused it.

**Migrate:** move the route, for example to `/mesh/control`. See
[Routing](/docs/guides/routing/#reserved-paths).

### Static files are revalidated, not re-downloaded

Every static hit carries a weak `ETag`, `Last-Modified` and `Cache-Control: no-cache`, and a
matching conditional request answers `304` without reading the file.

**Migrate:** to send a different `Cache-Control`, set `static: { cacheControl }` — for example
`'public, max-age=31536000, immutable'` for content-hashed assets. See
[Caching & compression](/docs/guides/caching-and-compression/).

### A handler that returns `undefined` answers `204 No Content`

Before, Node sent an empty `200` with a JSON `content-type`, and Deno, Bun and the edge answered
`500`. Every runtime now sends `204` with no body. `null` still gives `200` with `null`, and a route
with its own `@Transformer` is not affected.

**Migrate:** a client that checked for `200` after a handler with no `return` now sees `204`; return
a value from the handler to keep the `200`.

### `serveDeno()` and `serveBun()` reject an app created with `tls`

Only Node's `listen()` ever read `tls`, so on Deno and Bun the same app came up as plain HTTP without
a word. Both adapters now reject before they boot or bind.

**Migrate:** drop `tls` from `createApp` and configure TLS on the runtime's server, or terminate it
at a proxy. See [Runtimes](/docs/guides/runtimes/).

### Edge WebSocket upgrades trust `cf-connecting-ip` only under `trustProxy`

`edgeHandler` copied the header into `ctx.ip` on every upgrade, so any client chose its own
address. It now counts only under `trustProxy: true`; without it, `ctx.ip` on an edge WebSocket is
`''`, as on edge HTTP. Edge HTTP, which never read the header, now reads it under `trustProxy` too.

**Migrate:** an app behind Cloudflare that keys anything on the client address sets
`createApp({ trustProxy: true })`. See [Runtimes](/docs/guides/runtimes/#the-client-address--ctxip).

## Added

- **Health probes** — `createApp({ health: true })` serves `/__live__` and `/__ready__`, answered
  ahead of the route table, with `/__ready__` reporting `booting`, `ok`, `degraded` and `draining`.
  `health: { drainDelayMs }` holds the listener open after `close()` starts so a load balancer sees
  the `503`. See [Graph introspection](/docs/guides/introspection/#health-probes--createapp-health-).
- **Response compression** — `createApp({ compression })`, off by default; br and gzip negotiated
  on `Accept-Encoding`, streams included. On the edge Cloudflare encodes and core sets `Vary`.
  See [Caching & compression](/docs/guides/caching-and-compression/).
- **ETags** — `createApp({ etag: true })` tags buffered `200` responses and answers a matching
  `If-None-Match` with `304`; `static` accepts `{ dir?, cacheControl? }`. See
  [Caching & compression](/docs/guides/caching-and-compression/).
- **Cookies** — `@cookie('name')`, `@cookies()` and `setCookie()`, with `HttpOnly`,
  `SameSite=Lax`, `Path=/` and `Secure` by default. See
  [Argument decorators](/docs/guides/arguments/#cookies--cookies-cookie-and-setcookie).
- **Importable types** — every type a public signature uses can be imported: `AppOptions`,
  `ExplainNode`, `WsRequest`, `WsSocket`, `CompressionOptions`, `CookieOptions` and more, plus the
  runtime entry points' option and server types. See
  [createApp options](/docs/reference/createapp/#importable-types).
- **`RequestHeaders`** — the request headers type under a name that does not shadow the Fetch
  `Headers` global.

## Changed and fixed

- **Route lookup uses a radix index per method.** Internal, and the same route still wins with the
  same params, `Allow`, implicit `HEAD` and 404/405. See [Routing](/docs/guides/routing/#matcher-scale).
- **A query string keeps every `?` after the first**: `/search?q=what?now` gives `q: 'what?now'`.
  See [Routing](/docs/guides/routing/#path-policy-and-404-vs-405).
- **Every `304` is bodiless**, on every adapter, including one from `throw new NotModified()`.
- **WebSocket outbound respects backpressure**: a fast producer waits while a slow peer's send
  buffer is over 1 MiB. workerd reports no buffered amount, so there the platform buffers. See
  [Streaming](/docs/guides/streaming/#outbound-backpressure).
- **`ctx.ip` is resolved when it is read**, so a route that never reads it pays nothing, and
  `serveDeno()` and `serveBun()` now fill it with the client's address. Inside a stream body it is
  `''` unless something read it first. See [Runtimes](/docs/guides/runtimes/#the-client-address--ctxip).
- **`listen()` rejects when the port is taken** (`EADDRINUSE`, `EACCES`) instead of never settling.
- **Mesh (alpha) follows its teapots.** A teapot that missed `bootTimeoutMs` is retried in the
  background and its routes are served once it connects; a link that gives up for good has its
  routes removed; every change emits `mesh:routes`. The mesh exports are now marked
  `@experimental`, outside the freeze. See [Mesh](/docs/guides/mesh/).

## Deprecated

- **The `Headers` type.** Import `RequestHeaders` instead — the same type. `Headers` stays as an
  alias, so nothing breaks. See [API stability](/docs/stability/#currently-deprecated).

The changelog's *Fixed* section has the rest, among them `@header('Content-Type')` finding the
header whatever its case, the body parser choosing by media type, and the npm ESM build loading on
Cloudflare Workers.
