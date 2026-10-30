---
title: Routing
description: "Route constraints, specificity, HEAD and OPTIONS semantics, and path validation."
---

Routes are declared with method decorators on a `@Route`-prefixed controller. Patterns are matched **by segment**.

## Method decorators

| Decorator | Method / transport |
|---|---|
| `@Get` `@Head` `@Post` `@Put` `@Patch` `@Delete` `@Options` | buffered HTTP response |
| `@Sse` | server-sent events (`text/event-stream`) |
| `@Ws` | WebSocket duplex |
| `@Stream` | negotiated — SSE / ndjson / WS, picked from the client's `Accept` / `Upgrade` |

```typescript
@Route('/users')
class Users {
  @Get('/:id') get(@param('id') id: string) { /* ... */ }
  @Post('/')   create(@body() data: unknown) { /* ... */ }
}
```

The path a route matches is `joinPath(module.mountpoint, route.path)` — a controller under `@Module({ mountpoint: '/api' })` with `@Route('/users')` + `@Get('/:id')` serves `/api/users/:id`.

## Pattern segments

- **Static** — `users` matches exactly.
- **`:param`** — matches exactly one segment; the decoded value lands in `params.name` (`@param('id')`).
- **`:param(constraint)`** — matches one complete decoded segment when it satisfies a safe regex subset, for example `:id(\d+)`.
- **`:name*` catch-all** — a trailing segment that captures the **rest of the path, slashes included**, into `params.name`.

```typescript
@Get('/users/:id(\\d+)') // /users/42 matches; /users/alice does not
@Get('/files/:path*')   //  /files/img/2026/logo.png  →  params.path = "img/2026/logo.png"
```

A catch-all also matches zero remaining segments (`/files` → `params.path = ""`).

Constraints are anchored to the whole segment automatically. They allow character classes, alphanumeric/literal atoms, the escaped character classes `\d`, `\D`, `\s`, `\S`, `\w`, `\W`, and simple quantifiers (`+`, `*`, `?`, `{n}`, `{n,m}`). Groups, alternation, lookarounds, backreferences, anchors, and other arbitrary regex features are rejected at boot. Expressions are limited to 128 characters, counted quantifiers are capped, and unsafe adjacent unbounded quantifiers are rejected. This deliberately small subset avoids accepting route regexes with obvious ReDoS shapes.

Patterns must start with `/`, parameter names must be unique and use identifier syntax, and a catch-all must be the final segment. Repeated slashes in a declared pattern fail at boot.

## Precedence

When more than one route matches the same path, the **most specific wins** — `static ▸ constrained :param ▸ plain :param ▸ catch-all` — compared segment by segment, independent of registration order.

```typescript
@Get('/a/b')      // wins for /a/b
@Get('/a/:id(\\d+)') // wins for /a/42 over the plain parameter
@Get('/a/:id')    // wins for /a/x
@Get('/a/:rest*') // wins for /a/x/y
```

Two routes under the same method cannot have the same effective shape: `/users/:id` and `/users/:name` are ambiguous and make boot fail with both declarations named. The same rule applies after mesh routes join. Different methods may reuse a shape.

## Overlapping constraints fail at boot

The precedence rules pick a winner whenever two routes match one request. Some declarations still go wrong. Two constraints can accept the same segment, so only declaration order decides between them. Or a route can lose every request it could match, so it never runs. `createApp` refuses both, naming both declarations.

The check compares two routes with the same method that **branch at the same segment, under the same prefix**, where both are params and at least one is constrained. A static segment or a catch-all at the branch is not checked: precedence already decides those cases.

### Ambiguous: two constraints that share a segment

```typescript
@Get('/u/:id(\\d+)')
@Get('/u/:n(\\d{1,3})')
```

```
ambiguous route GET /u/:n(\d{1,3}) at Users.byNumber conflicts with GET /u/:id(\d+) at Users.byId:
both match '0' (GET /u/0), so only declaration order would choose between them — give the
constraints disjoint languages, or merge the routes
```

The quoted segment is a **witness**: a real value both constraints accept, with a request path that reaches both routes. Two spellings of the same language, such as `\d+` and `[0-9]+`, are ambiguous too.

The rest of the patterns counts as well. `/u/:id(\d+)/a` and `/u/:n(\d{1,3})/b` share digits at the branch but can never match the same request, so they boot. Disjoint constraints such as `\d+` and `[a-z]+` boot, and so do overlapping constraints under different methods.

### Unreachable: a constraint that takes every segment

```typescript
@Get('/algo/:id')
@Get('/algo/:a([^]*)')
```

```
unreachable route GET /algo/:id at Algo.byId: GET /algo/:a([^]*) at Algo.any matches every
request it would, and wins each one — its constraint accepts every segment, and a constrained
parameter outranks a plain one. Remove one of them, or narrow the constraint
```

`[^]*` and `[\s\S]+` accept every segment. **`.*` does not**: without the `s` flag, `.` does not match a line terminator, so `/algo/%0A` still reaches `:id` and that pair boots.

### Not an error: the constrained fallback

A plain param next to a constraint that leaves some segments over is the pattern constraints exist for, and it boots unchanged:

```typescript
@Get('/u/:id(\\d+)') // /u/42  → params.id   = "42"
@Get('/u/:slug')     // /u/bob → params.slug = "bob"
```

Digits go to `:id` and everything else goes to `:slug`, whichever is declared first.

### WebSocket and mesh routes

WebSocket routes follow the same rules, under their own precedence: **an upgrade goes to the first declared `@Ws` route that matches**, not the most specific one. So a plain WS param declared before a constrained sibling makes the constrained one unreachable, and boot fails. Declare the constrained route first, as in the fallback above. A `@Stream` route is served as both HTTP and WebSocket, so it is checked against both kinds.

Routes exported by different [mesh](/docs/guides/mesh/) teapots are checked against each other the same way. A local route that overlaps a remote one is still the deliberate override, not an error.

The check is exact: no sampling, no list of known patterns. The safe constraint subset makes it decidable. It runs once at boot and changes nothing about how requests are matched. The worst case the 128-character limit allows takes about 90 ms.

## HEAD and OPTIONS

An explicit `@Head` or `@Options` route always wins. Without an explicit HEAD route, HEAD falls back to a matching **buffered** GET handler, preserves its status and headers, and suppresses the body. Streaming GET routes do not become implicit HEAD routes.

Without an explicit OPTIONS route, OPTIONS on an existing path returns `204` with a canonical `Allow` header. GET implies HEAD, and any existing path implies OPTIONS, so a GET/POST path reports `GET, HEAD, POST, OPTIONS`. A CORS preflight (OPTIONS with `Access-Control-Request-Method`) is handled before explicit or automatic OPTIONS when CORS is configured.

## Path policy and 404 vs 405

`/path` and `/path/` are equivalent. Repeated slashes such as `/path//item` are rejected rather than collapsed, and malformed percent encoding is rejected; both return `400 Bad Request` with the configured security/CORS headers. Query strings do not participate in route matching.

The query string is everything after the **first** `?`, up to a `#` if there is one. A `?` inside the query is part of a value, as RFC 3986 allows: `/search?q=what?now` gives `q: 'what?now'`, and `/search?a=1&b=?` gives `b: '?'`. A key repeated in the query keeps its **last** value — `/search?tag=a&tag=b` gives `tag: 'b'`.

**`.` and `..` are resolved, not rejected.** `/public/../admin` matches a route declared as `/admin`, exactly as the URL bar and every HTTP client already treat it, and `%2e` counts as a dot — `/public/%2e%2e/admin` resolves the same way, so the encoded spelling cannot reach a route the plain one resolves away from.

Resolving rather than rejecting is not the stricter choice, and it is not green-tea's to make: Deno, Bun and Cloudflare Workers resolve dot segments inside the `Request` constructor, before the framework is handed anything, so the raw path is unrecoverable there. Rejecting would be implementable on Node alone, and the same request would then reach different routes depending on where you deployed. If a path traversal matters to you, it is worth knowing that a proxy or WAF matching on the literal string sees `/public/...` while the app sees `/admin`.

A path that no route matches returns `404`. A path that **does** exist but under a different method returns **`405 Method Not Allowed`** with an `Allow` header listing the methods that do match — not a `404`.

## Reserved paths

Some paths are answered by green-tea itself, ahead of the route table, on every runtime. A route that claims one fails `createApp`, naming the declaration and the reserved path:

| Path | Reserved | What answers it |
|---|---|---|
| `/__mesh__/control` | in every app, mesh or not | the [mesh](/docs/guides/mesh/) control channel |
| `/__live__`, `/__ready__` | while `createApp({ health })` is on | the [health probes](/docs/guides/introspection/#health-probes--createapp-health-) |

A route claims a reserved path when its first segment is the same literal and the pattern matches the path: `@Ws('/__mesh__/control')`, `@Get('/__mesh__/control')`, `@Ws('/__mesh__/:x')`, `/__mesh__/:rest*`, or a mountpoint that adds up to one of these. A pattern whose first segment is a param (`/:org/:repo`, `/:rest*`) still boots; it simply never sees the reserved path, because the framework answers it first. A route exported by a teapot is checked the same way: at boot it fails the teacup's boot, and a teapot that connects later has that route refused and logged.

`/__mesh__/control` is reserved even without mesh so that one route cannot work on one runtime and not on another — before RC.1 the Node listener served a user route there while Deno, Bun and the edge refused it. An upgrade to `/__mesh__/control` on an app with no control channel is refused the same way everywhere: the socket is accepted and closed with `1008` (`mesh control channel not enabled: this app exports nothing, or has no mesh.secret`). The one exception is a Node app with no `@Ws`/`@Stream` routes and no mesh: it attaches no upgrade listener, so there the request reaches the HTTP route table as before. To migrate a route that used the path, move it, for example to `/mesh/control`.

## Matcher scale

HTTP route lookup walks a **radix index per method**, built once from the route table, so a lookup — including the miss behind a `404` or `405` — no longer scans the route list. Routes spliced in from mesh teapots sit in an index of their own. The index changes nothing about which route wins: precedence, params, `Allow`, implicit `HEAD` and 404/405 are exactly what the rules above say. `graph()`, `explain()` and `openapi()` read the declared routes, not the index.

See [Streaming & real-time](/docs/guides/streaming/) for `@Sse` / `@Ws` / `@Stream`, and [Argument decorators](/docs/guides/arguments/) for everything a handler can read from a request.
