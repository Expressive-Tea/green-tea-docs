---
title: What's new
description: "What changed in @green-tea/core RC.2 and RC.1, and what it means if you are already using it."
---

:::note[The API is frozen from RC.1]
RC.1 is the first release candidate. From here to the first stable release, releases are fixes
only: nothing public is added, removed, renamed or narrowed. [API stability](/docs/stability/) has
the full policy, including how deprecations work after stable.
:::

## RC.2: security fixes

RC.2 fixes nine security advisories reported against RC.1, and every one of them is in RC.1 and
earlier. **Upgrade:** `npm i @green-tea/core@26.11.0-rc.2`, or `jsr:@green-tea/core@26.11.0-rc.2`.
The [security advisories](https://github.com/Expressive-Tea/green-tea/security/advisories) have the
details, and the [changelog](https://github.com/Expressive-Tea/green-tea/blob/main/CHANGELOG.md)
has every change.

No public API changed, and the freeze holds. Some behaviour did, and that is what can affect an
upgrade:

| What changed | Who it affects | What to do |
|---|---|---|
| `cors: { origins: '*', credentials: true }` fails `createApp` | apps that set that pair | list the origins, or write `origins: () => true` if you really mean it. [CORS](/docs/guides/security/#cors) |
| WebSocket upgrades from another site get `403` | browser clients on another origin; apps behind a proxy that rewrites `Host` | add the origin to `cors.origins`. [WebSocket origins](/docs/guides/security/#websocket-origins) |
| `static` no longer serves dotfiles | apps that served one on purpose | move it, or serve it from a route. [Static files](/docs/guides/html/#static-files--createapp-static-) |
| Under `trustProxy`, `ctx.ip` is the right-most `X-Forwarded-For` entry | apps behind several proxies | `ctx.ip` is now what the last proxy saw. [Client address](/docs/guides/runtimes/#the-client-address--ctxip) |
| A stream's error frame says `Internal Server Error` unless the error is an `HttpError` | clients that read the frame's text | throw an `HttpError` for a message meant for the client. [Streaming](/docs/guides/streaming/#when-a-stream-fails-part-way) |
| `channel()` buffers 1024 values per subscriber, dropping the oldest | subscribers that fall further behind | `channel({ buffer: Infinity })` for the old behaviour |
| `/__ready__` no longer lists degraded provider names | probes that read `degraded` | read `app.degraded()` or the boot log |
| Mesh: a `ws://` teapot off loopback fails `createApp` | mesh apps (experimental) | use `wss://`, or `mesh.allowInsecure` on an encrypted network. [Mesh](/docs/guides/mesh/) |

Fixed with no behaviour change you need to act on: Node closes slow-header sockets and dead
WebSocket peers promptly; the template engine no longer re-renders `{{{ }}}` output; a form field
named `__proto__` is an ordinary key; argument decorators read own keys only; Deno, Bun and
`app.fetch` honour `X-Forwarded-Proto` under `trustProxy`; a mesh teapot checks the route's HTTP
method and stops sending internal error messages to the client.

Other fixes: Bun no longer drops an SSE stream idle for 10 seconds, a long SSE stream no longer
grows the heap per event, an async bus listener that rejects no longer exits Node, and a bus
listener that throws is logged once.

## RC.1

This is what changed in **RC.1** since `26.9.0-beta.2`, in the order it matters to you rather than
the order it was built. The [full changelog](https://github.com/Expressive-Tea/green-tea/blob/main/CHANGELOG.md)
has every release and every detail; this page is only the current one.

The breaking changes come first, because they are what can stop an upgrade. Each one is behaviour
that had to move before the freeze, and each has a migration. Nothing published in beta.2 was
removed: the one renamed type keeps its old name as a deprecated alias.

### Breaking

#### Node 22 is the minimum

Node 18 and 20 are end-of-life and receive no security patches, so `engines.node` is now `>=22`.
**Migrate:** upgrade Node before you upgrade green-tea.

#### Response header values are `string | string[]`

`TransformerFn`, `ErrorResponse.headers`, `HttpError.headers` / `HttpErrorLike.headers` and the
pipeline's `ResponseShape.headers` widen from `Record<string, string>`, so a response can carry
several `Set-Cookie` lines. A `set-cookie` array goes out as one header line per element on every
runtime; before, the fetch adapters joined it into one broken `a,b` cookie. Any other array is sent
as one line joined with `, `.

**Migrate:** code that *produces* headers needs nothing. Code that *reads* `headers[k]` from one of
these types as a `string` stops compiling and must handle the array.

#### Inbound WebSocket messages are capped at 1 MiB, and 16 unread messages

A larger message closes the connection with `1009`; a 17th unread message closes it with `1013`.
Before, Node allowed 100 MiB, the other runtimes applied no cap, and the inbound queue was
unbounded everywhere. A `@Ws` handler that never reads `inbound` counts too.

**Migrate:** raise the bounds with `limits.maxWsMessageBytes` and `limits.maxWsQueue` if your
clients legitimately need more. See [Streaming](/docs/guides/streaming/#inbound-limits).

#### Overlapping constrained route params fail boot

Two routes of one method that branch at the same segment now fail `createApp` when both constraints
accept a common segment (`/u/:id(\d+)` and `/u/:n(\d{1,3})`), or when a constraint that accepts
every segment makes a plain sibling unreachable. Before, registration order picked silently.

**Migrate:** make the router's choice explicit — make the constraints disjoint (`\d{1,3}` and
`\d{4,}`), keep one route and branch in its handler, or move one under a static segment of its own.
Delete a plain param reported as unreachable: it never answered a request. For a WebSocket pair,
declare the constrained route first. See
[Routing](/docs/guides/routing/#overlapping-constraints-fail-at-boot).

#### A token has one producer

A second node providing a token fails `createApp`, naming both:
`token 'user' is provided twice: by 'user' (module:AppModule) and by 'shadow' (plugin)`. Before,
the last one registered won, so a plugin could silently replace the app's own provider. The rule
covers modules, plugins, mesh steps and the built-ins `logger`, `rooms` and `events`. `overrides`
keep working.

**Migrate:** rename one producer's token. See [Plugins](/docs/guides/plugins/#what-a-plugin-can-and-cannot-touch).

#### A node that needs the token it provides fails boot

A step with `needs: ['user']` and `provides: 'user'` used to boot and then read a value nobody had
written. It now fails as a cycle: `cycle detected: user -> user (it needs 'user', which only it
provides)`. Seeded tokens such as `req` and `params` still satisfy a node's own need.

**Migrate:** remove the token from the node's `needs`, or move the work that produces it into a
separate provider or step the node needs. See
[Dependency injection](/docs/guides/dependency-injection/#a-node-cannot-need-what-it-provides).

#### `/__mesh__/control` is reserved in every app

A `@Ws`, `@Stream` or HTTP route that claims it — or a mountpoint that adds up to it — fails
`createApp`, mesh or not. Before, Node served a user route there when no mesh was configured, while
Deno, Bun and the edge refused it.

**Migrate:** move the route, for example to `/mesh/control`. See
[Routing](/docs/guides/routing/#reserved-paths).

#### Static files are revalidated, not re-downloaded

Every static hit carries a weak `ETag`, `Last-Modified` and `Cache-Control: no-cache`, and a
matching conditional request answers `304` without reading the file.

**Migrate:** to send a different `Cache-Control`, set `static: { cacheControl }` — for example
`'public, max-age=31536000, immutable'` for content-hashed assets. See
[Caching & compression](/docs/guides/caching-and-compression/).

#### A handler that returns `undefined` answers `204 No Content`

Before, Node sent an empty `200` with a JSON `content-type`, and Deno, Bun and the edge answered
`500`. Every runtime now sends `204` with no body. `null` still gives `200` with `null`, and a route
with its own `@Transformer` is not affected.

**Migrate:** a client that checked for `200` after a handler with no `return` now sees `204`; return
a value from the handler to keep the `200`.

#### `serveDeno()` and `serveBun()` reject an app created with `tls`

Only Node's `listen()` ever read `tls`, so on Deno and Bun the same app came up as plain HTTP without
a word. Both adapters now reject before they boot or bind.

**Migrate:** drop `tls` from `createApp` and configure TLS on the runtime's server, or terminate it
at a proxy. See [Runtimes](/docs/guides/runtimes/).

#### Edge WebSocket upgrades trust `cf-connecting-ip` only under `trustProxy`

`edgeHandler` copied the header into `ctx.ip` on every upgrade, so any client chose its own
address. It now counts only under `trustProxy: true`; without it, `ctx.ip` on an edge WebSocket is
`''`, as on edge HTTP. Edge HTTP, which never read the header, now reads it under `trustProxy` too.

**Migrate:** an app behind Cloudflare that keys anything on the client address sets
`createApp({ trustProxy: true })`. See [Runtimes](/docs/guides/runtimes/#the-client-address--ctxip).

### Added

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

### Changed and fixed

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

### Deprecated

- **The `Headers` type.** Import `RequestHeaders` instead — the same type. `Headers` stays as an
  alias, so nothing breaks. See [API stability](/docs/stability/#currently-deprecated).

The changelog's *Fixed* section has the rest, among them `@header('Content-Type')` finding the
header whatever its case, the body parser choosing by media type, and the npm ESM build loading on
Cloudflare Workers.
