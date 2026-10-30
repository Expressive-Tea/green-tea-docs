---
title: createApp options
description: "Every option accepted by createApp and every method on the App it returns."
---

```typescript
import { createApp, type AppOptions } from '@green-tea/core';

const options: AppOptions = { modules: [ApiModule] };
const app = createApp(options);
```

## Options

The options object is the exported `AppOptions` interface. Everything except `modules` is optional.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `modules` | `Ctor[]` | — | the `@Module` classes to wire (required) |
| `plugins` | `Plugin[]` | `[]` | named objects `{ name, mount }`, each limited to `bus.on` + `scope.add` + `onShutdown` ([plugins](/docs/guides/plugins/)) |
| `hooks` | `Hooks[]` | `[]` | lifecycle participation without extending the graph; `{ onShutdown }` today ([teardown](/docs/guides/dependency-injection/#releasing-what-a-provider-opened)) |
| `limits` | `RequestLimits` | see below | body-size, concurrency, and timeout ceilings |
| `devGraph` | `boolean` | `false` | mount `GET /__graph__` ([introspection](/docs/guides/introspection/)) |
| `devOpenapi` | `boolean` | `false` | mount `GET /__openapi__` serving the [OpenAPI](/docs/guides/openapi/) document |
| `overrides` | `Record<string, unknown>` | — | swap any node by token ([testing](/docs/guides/testing/)) |
| `tls` | `TlsOptions` | — | serve over https/wss — Node `listen()` only; `serveDeno`/`serveBun` reject it |
| `trustProxy` | `boolean` | `false` | honor `X-Forwarded-*` for `ctx.protocol` / `ctx.ip` |
| `security` | `boolean \| SecurityOptions` | `true` | secure-by-default headers ([security](/docs/guides/security/)) |
| `cors` | `CorsOptions` | — | CORS handling |
| `bodyDuplicates` | `'array' \| 'last'` | `'last'` | policy for repeated form fields |
| `onError` | `ErrorRenderer` | — | render errors your way ([error handling](/docs/guides/errors/)); returns a response or `undefined` to fall back to JSON |
| `views` | `string` | `process.cwd()` | base dir `@Html('file.html')` paths resolve against — relative paths join it, absolute paths are used as-is ([HTML & views](/docs/guides/html/)) |
| `viewEngine` | `(source: string, data: unknown) => string` | built-in `render` | swap in your own template engine for `@Html(..., { template: true })`; template mode only ([HTML & views](/docs/guides/html/)) |
| `static` | `boolean \| string \| { dir?: string; cacheControl?: string }` | — | serve a directory as a `GET`/`HEAD` fallback (after declared routes, before `404`); `true` → `./public`, a string → that dir, the object form → `dir` (default `./public`) plus the `Cache-Control` sent with its files and `304`s (default `no-cache`). Every hit is revalidated with a weak `ETag` and `Last-Modified`. An unknown key, or a `cacheControl` with CR/LF, throws. Path-traversal-safe; a symlink that resolves outside the root is a `404`; needs a filesystem — Node/Deno/Bun only ([HTML & views](/docs/guides/html/#static-files--createapp-static-), [caching](/docs/guides/caching-and-compression/)) |
| `etag` | `boolean` | `false` | weak ETags for buffered `200` responses to `GET`/`HEAD`; a matching `If-None-Match` gets a bodiless `304`. The handler still runs. Anything but a boolean throws ([caching](/docs/guides/caching-and-compression/)) |
| `compression` | `boolean \| CompressionOptions` | `false` | response compression negotiated on `Accept-Encoding`; `true` uses the defaults below. On the edge core sets only `Vary` and Cloudflare encodes. Invalid options throw ([compression](/docs/guides/caching-and-compression/)) |
| `health` | `boolean \| { drainDelayMs?: number }` | `false` | serve `GET`/`HEAD` `/__live__` and `/__ready__`, answered ahead of the route table; while on, a route at either path fails boot. `drainDelayMs` (default `0`) keeps the listener open that long after `close()` starts, with `/__ready__` already `503`. `createApp` throws when `drainDelayMs` + `teardownTimeoutMs` exceeds `shutdownTimeoutMs`, and when `health` is anything but `true`, `false` or `{ drainDelayMs?: number }` ([health probes](/docs/guides/introspection/#health-probes--createapp-health-)) |
| `logger` | `Logger` | structured JSON (readable on a TTY) | where every framework diagnostic is written; also injectable as `@needs('logger')` ([observability](/docs/guides/observability/)) |
| `logRequests` | `boolean` | `false` | log one line per completed request and per failure; a removable Bus subscriber, not a middleware ([observability](/docs/guides/observability/)) |
| `shutdownTimeoutMs` | `number` | `10_000` | how long `close()` gives in-flight work before forcing the rest shut; `close({ timeoutMs })` still wins per call. Set it here when `close()` is reached from a signal handler or shutdown hook you do not own ([runtimes](/docs/guides/runtimes/)) |
| `teardownTimeoutMs` | `number` | — | milliseconds **reserved out of** `shutdownTimeoutMs` for teardown, so a slow drain cannot leave a connection unclosed. Unset, the drain may use the whole budget and teardown takes what is left. Larger than `shutdownTimeoutMs` throws at boot ([teardown](/docs/guides/dependency-injection/#releasing-what-a-provider-opened)) |
| `handleSignals` | `boolean` | `false` | register `SIGINT`/`SIGTERM` to run `close()` and exit, using each runtime's own API ([teardown](/docs/guides/dependency-injection/#who-calls-close)) |
| `mesh` | `MeshConfig` | — | distributed DI — **requires `experimental: true`**; `@experimental`, outside the [API freeze](/docs/stability/) ([mesh](/docs/guides/mesh/)) |
| `experimental` | `boolean` | `false` | opt in to alpha features (currently gates `mesh`) |
| `warnGraphDepth` | `number \| false` | `20` | warn when one route resolves to more than this many steps; `false` disables the design warning |

### `RequestLimits`

| Field | Default |
|---|---|
| `maxBodyBytes` | `1_000_000` (→ `413` when exceeded) |
| `maxConnections` | `1000` (Node only; `<= 0` means unlimited) |
| `maxConcurrentRequests` | unlimited (`<= 0` also means unlimited); bounds concurrently executing handlers, and a request above that ceiling → `503` with `Retry-After: 1` |
| `requestTimeoutMs` | `30_000` |
| `headersTimeoutMs` | `10_000` |
| `keepAliveTimeoutMs` | `5_000` |
| `maxParts` | `1000` (multipart) |
| `maxWsMessageBytes` | `1_048_576` (1 MiB): the largest inbound WebSocket message, in bytes (UTF-8 bytes for text); a fragmented message counts as a whole. A larger one closes the connection with `1009` — on Bun before 1.4 the connection is dropped instead, so the peer sees `1006`; Bun 1.4 and later send `1009` |
| `maxWsQueue` | `16`: inbound WebSocket messages a connection may hold that the handler has not read yet. One more closes the connection with `1013` |

`maxBodyBytes` is enforced while the body is read, on every runtime: a `Content-Length` that already declares more is refused before any of the body is read, and otherwise reading stops at the chunk that crosses the limit ([uploads](/docs/guides/uploads/#limits)).

`maxWsMessageBytes` and `maxWsQueue` must be positive integers; anything else makes `createApp` throw a `TypeError`. Both are server-wide, apply on every runtime, and have no per-route override. How early an oversized message is refused depends on the runtime ([streaming](/docs/guides/streaming/#inbound-limits), [runtimes](/docs/guides/runtimes/#websocket-message-size)).

`maxConcurrentRequests` is enforced before request-body acquisition in both the Node and Fetch paths, so it applies across Node, Deno, Bun, and edge — as a budget per server or Fetch adapter instance, not one ceiling shared by the app ([runtimes](/docs/guides/runtimes/)). Long-lived streams release their slot once request handling returns, and WebSocket upgrades are outside this budget.

### `CompressionOptions`

`{ threshold?, encodings? }` — `threshold` is the smallest buffered body worth encoding, in bytes (default `1024`; streams ignore it). `encodings` is the codings core may produce, in preference order: an array of `'br'` and `'gzip'` (default `['br', 'gzip']`). See [Caching & compression](/docs/guides/caching-and-compression/).

### `TlsOptions`

`{ key, cert, ca?, passphrase? }` — `key`/`cert` are `Buffer | string`.

### `CorsOptions`

`{ origins, methods?, allowedHeaders?, exposedHeaders?, credentials?, maxAge? }`. `origins` is a string, array, `'*'`, or a `(origin) => boolean` predicate. `credentials: true` is never combined with `'*'`.

### `SecurityOptions`

`{ hsts?, frameOptions?, referrerPolicy?, noSniff?, dnsPrefetchControl?, csp? }`. HSTS is only emitted on secure connections. `csp` is opt-in.

### `MeshConfig`

`{ secret?, teapots?, timeoutMs?, heartbeatMs?, reconnect?, onManifestChange?, bootTimeoutMs? }` — `teapots` is `{ url, secret }[]`; `timeoutMs` bounds an RPC (default 30s, → 504), `heartbeatMs` is the ping gap that detects a half-open link (default 15s, → 503). `reconnect` is `boolean | { initialDelayMs?, maxDelayMs? }` (default on; 500ms doubling to 30s with jitter), `onManifestChange` is `'refuse'` — the default, and the only policy today — and `bootTimeoutMs` is how long boot waits for a teapot that has not started yet (default `timeoutMs`; `0` for a single attempt). Exhausting it warns and boots without that teapot: its routes `404` and none of its steps are in the graph, and the boot still fails if anything local needs one of its tokens. The teapot is then retried in the background with the `reconnect` backoff, and once it connects its routes are spliced in and served, with no restart; its steps are not added, because the graph was validated without them. With `reconnect: false` it is not retried. A refused handshake is never retried. Every change to the remote routes emits `mesh:routes`. See [Mesh](/docs/guides/mesh/).

`MeshConfig` and every other mesh export are `@experimental`: outside the [API freeze](/docs/stability/), and they may change in any release.

## The `App`

`createApp` returns an `App`:

| Member | Returns | Notes |
|---|---|---|
| `listen(port)` | `Promise<http.Server>` | boots providers, then serves. Rejects with the bind error (`EADDRINUSE`, `EACCES`) when the port cannot be bound; the app then counts as never having listened, so `close()` resolves and a second `listen()` can try another port |
| `close({ timeoutMs? })` | `Promise<void>` | drains in-flight, closes streams + mesh links, then runs registered teardown (`dispose()`, `onShutdown`); after the deadline (default `10s`, or `createApp({ shutdownTimeoutMs })`) it warns and force-closes what is left. **Draining** is Node-only — on Deno and Bun use the server `serveDeno()`/`serveBun()` returned, which also runs teardown ([runtimes](/docs/guides/runtimes/)) |
| `handleSignals(closer)` | the same type as `closer` | wires `SIGINT`/`SIGTERM` to `closer` and returns a close that also unregisters them — or returns `closer` untouched when `createApp({ handleSignals })` is not set. `listen()`, `serveDeno()` and `serveBun()` call it for you; call it yourself only when you serve the app some other way ([teardown](/docs/guides/dependency-injection/#who-calls-close)) |
| `ready()` | `Promise<void>` | resolves the graph and mesh links without booting providers |
| `boot()` | `Promise<void>` | boots providers now instead of on the first request; idempotent, shares its memo with `listen()` and `fetch()`, and a failure stays failed. A no-op on workerd, which has no startup outside a request ([runtimes](/docs/guides/runtimes/)) |
| `fetch(request)` | `Promise<Response>` | Web-Standards HTTP/SSE handler for Node, Deno, Bun, and edge |
| `upgrade(request, socket)` | `Promise<void>` | neutral WebSocket upgrade used by non-Node adapters; takes a `WsRequest` and a `WsSocket` |
| `inspect(route)` | `InspectLine[]` | the provider/step/handler chain for a route |
| `explain(route)` | `Explain` | the chain annotated with each node's needs/provides |
| `graph()` | `GraphView` | the full node + route graph |
| `toMermaid()` / `toDOT()` | `string` | render the graph |
| `openapi(info?)` | `OpenApiDoc` | structural OpenAPI 3.1 document ([details](/docs/guides/openapi/)) |
| `degraded()` | `string[]` | optional providers running degraded (empty until providers boot through `fetch`, `upgrade`, or `listen`) |
| `bus` | `Bus` | lifecycle + request event bus ([observability](/docs/guides/observability/)) |
| `logger` | `Logger` | the app's logger — the one passed in, or the default |

:::note
On mesh apps, `graph` / `explain` / `inspect` / `degraded` are only available after `ready()` or the first serving call — the graph is finalized once the teapots have announced their steps and routes.
:::

## Importable types

Every type a public signature uses can be imported, so code that calls the API can also name what it
passes and gets back. These are the types RC.1 adds to the exports — most were already in the
declarations without a name you could import, and the rest arrive with new options:

```typescript
import type { AppOptions, ExplainNode, WsRequest, WsSocket } from '@green-tea/core';
```

| Type | Entry point | What it is |
|---|---|---|
| `AppOptions` | `@green-tea/core` | the options object of `createApp`, described above |
| `RequestHeaders` | `@green-tea/core` | the incoming request headers, `Record<string, string \| string[] \| undefined>` |
| `Headers` | `@green-tea/core` | already exported before RC.1, now a **deprecated** alias of `RequestHeaders`; it shadows the Fetch `Headers` global in the files that import it ([API stability](/docs/stability/#currently-deprecated)) |
| `ExplainNode` | `@green-tea/core` | one entry of `Explain.chain` ([introspection](/docs/guides/introspection/)) |
| `WsRequest`, `WsSocket` | `@green-tea/core` | the two arguments of `app.upgrade` |
| `CompressionOptions` | `@green-tea/core` | the object form of `compression` |
| `CookieOptions` | `@green-tea/core` | the third argument of `setCookie()` ([cookies](/docs/guides/arguments/#cookies--cookies-cookie-and-setcookie)) |
| `ModuleOptions` | `@green-tea/core` | the argument of `@Module` |
| `Ctor` | `@green-tea/core` | any class constructor, as `modules`, `providers`, `steps` and `controllers` take them |
| `BusLike` | `@green-tea/core` | the slice of the `Bus` that `logRequests(bus, logger)` subscribes to |
| `ArgSource` | `@green-tea/core` | where an argument decorator reads from (`ArgSpec.source`) |
| `GraphNodeView`, `GraphRouteView` | `@green-tea/core` | a node and a route in the `GraphView` that `app.graph()` returns |
| `StandardIssue`, `StandardResult` | `@green-tea/core` | the issue and result shapes of [Standard Schema](/docs/guides/validation/) |
| `DenoServeOptions`, `DenoHttpServer` | `@green-tea/core/deno` | the options of `serveDeno()`, and the server the `DenoServer` it resolves to extends |
| `BunServeOptions`, `BunServer` | `@green-tea/core/bun` | the options of `serveBun()`, and the server the `BunServeResult` it resolves to extends |
| `EdgeCtx` | `@green-tea/core/edge` | the Workers execution context (`waitUntil`) that the handler returned by `edgeHandler` takes as its third argument |

### Mesh types — experimental

These are exported from `@green-tea/core` and marked `@experimental`, like the rest of the mesh:
outside the [API freeze](/docs/stability/#mesh-is-outside-the-promise), so they may change in any
release.

`MeshConfig`, `Link`, `ReconnectOptions`, `ManifestPolicy`, `Manifest`, `RequestEnvelope`, `Frame`,
`RouteEntry`, `RemoteScopeNode`, `RemoteRoute`, `MeshControlDeps`, `ResponseShape` (a materialized
response, public only through those mesh signatures), `SocketCtor` and `EventfulSocket`, along with the functions and constants `connectLink`, `buildRemote`,
`envelopeFrom`, `buildManifest`, `createMeshControl` and `MESH_CONTROL_PATH`.
