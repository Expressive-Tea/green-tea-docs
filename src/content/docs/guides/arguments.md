---
title: Argument decorators
description: "Everything a handler can inject with needs, ctx, param, query, body, header, cookie, inbound, and abort."
---

A handler's signature declares exactly what it wants — in any order, nothing more. Each
parameter decorator injects one thing: a graph-produced value, part of the request envelope,
or a stream handle. Some decorators add a **dependency edge** to the graph (boot-validated);
most just read from the request.

## The decorators at a glance

| Decorator | Injects | Adds a graph dependency? | Forms |
|---|---|---|---|
| `@needs('user')` | a value produced by a provider/step (boot-validated) | **yes** | `('key')` |
| `@ctx()` | the whole accumulated context | no | `()` |
| `@param(...)` | route params | no | `()` · `('id')` · `('id', schema)` |
| `@query(...)` | parsed query string | no | `()` · `('q')` · `(['a','b'])` · `(schema)` |
| `@body(...)` | parsed body (JSON / urlencoded / multipart) | no | `()` · `('field')` · `(schema)` |
| `@headers(...)` | request headers (whole bag or picked) | no | `()` · `('authorization')` · `(['a','b'])` · `(schema)` |
| `@header('name')` | one request header (singular alias of `@headers`) | no | `('x-trace')` · `('x-count', schema)` |
| `@cookies(...)` | request cookies, parsed from the `Cookie` header | no | `()` · `('session')` · `(['a','b'])` · `(schema)` |
| `@cookie('name')` | one request cookie (singular alias of `@cookies`) | no | `('session')` · `('session', schema)` |
| `@inbound()` | the incoming WS message channel | no (WS only) | `()` |
| `@abort()` | an `AbortSignal` that fires on disconnect | no (stream/WS) | `()` |

## `@needs` — a graph-produced value

`@needs('token')` injects a value a provider or step produces, and declares a dependency edge
in the graph. Its keys are **validated at boot**: if nothing provides the token, `createApp`
throws with a clear error instead of serving `undefined`.

```typescript
getUser(@needs('user') user: any, @param('id') id: string) {
  return { requested: id, you: user };
}
```

See [Dependency injection](/docs/guides/dependency-injection/) for how `needs`/`provides` build the
graph.

## `@ctx` — the whole context

`@ctx()` hands you the entire accumulated context — everything providers and steps have merged
in, plus built-ins. Use it to read values like `ctx.protocol` and `ctx.ip`.

`ctx.ip` is the client address: the socket peer, or, when `trustProxy` is on and the request has
an `X-Forwarded-For` header, that header's first hop. On the edge, under `trustProxy`,
`cf-connecting-ip` wins over both, because Cloudflare sets it itself. A bare `app.fetch(request)`
from your own code has no socket, so there it is `''` unless a trusted header supplies it.

The address is resolved the first time something reads `ctx.ip` and kept for the rest of the
request, so a route that never reads it pays nothing (on Bun, resolving it is a native call).

:::caution[`ctx.ip` inside a stream body]
A stream body runs after the response has started, when the socket the address would come from
may already be gone. So once a handler returns a stream, an address nothing has read yet is `''`.
If a stream needs the address, read `ctx.ip` in a step or in the handler before returning the
stream, and close over the value.
:::

## Envelope decorators — `@param`, `@query`, `@body`, `@headers`

These read from the parsed request. Each envelope decorator has **three access forms**:

- `@query()` — the whole object
- `@query('q')` — one key
- `@query(['q','date'])` — a subset

```typescript
@Get('/:id')
getUser(@param('id') id: string) { /* ... */ }
```

- **`@param`** reads route params. It always needs a name to say which param it binds
  (`@param('id')`).
- **`@query`** reads the parsed query string. Query values are always strings on the wire — a
  schema is often the coercion point (see below).
- **`@body`** reads the parsed body. It handles `application/json`,
  `application/x-www-form-urlencoded`, and `multipart/form-data` (see the multipart note). The
  parser is chosen by the media type — the part of `Content-Type` before any `;`, trimmed and
  compared case-insensitively — and any `+json` type (`application/problem+json`,
  `application/vnd.api+json`) is parsed as JSON too.
- **`@headers`** reads request headers — the whole bag (`@headers()`), one key
  (`@headers('authorization')`), or a subset (`@headers(['a','b'])`).

## `@header` — one header, singular alias

`@header('name')` is the singular alias of `@headers`: it picks exactly one request header.

```typescript
who(@header('x-trace') trace: string) { /* ... */ }
```

It also accepts a schema in slot 2 — `@header('x-count', schema)`.

## Cookies — `@cookies`, `@cookie`, and `setCookie()`

`@cookies()` injects the request's cookies as a name → value map (`{}` when the request sent
none); `@cookie('name')` picks one, and is `undefined` when it is absent. Both accept the same
forms as `@headers`, including a schema. `@needs('cookies')` gives the same map, for a step that
reads cookies.

```typescript
import { Route, Get, cookie, setCookie } from '@green-tea/core';

@Route('/session')
class SessionController {
  @Get('/')
  current(@cookie('session') session: string | undefined) {
    return { signedIn: session !== undefined };
  }
}
```

The `Cookie` header is parsed on first use and the result is kept for the request, so a route that
declares no cookie argument never parses it, and one that declares several parses it once. Parsing
follows RFC 6265: for a repeated name the first value wins (browsers send the most specific cookie
first), `%`-sequences are decoded, and a malformed pair is skipped. A broken cookie never becomes a
`400`: the header is client state the server did not choose, and the route may not even need it.
The same decorators work on WebSocket routes.

### Setting a cookie

Core has no response-cookie API of its own: a cookie is a `Set-Cookie` header. `setCookie(name,
value, options?)` builds that header's value, with the safe defaults on:

```typescript
setCookie('session', id, { maxAge: 3600 });
// 'session=<id>; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax'
```

| Option | Default | Meaning |
|---|---|---|
| `httpOnly` | `true` | page scripts cannot read the cookie |
| `sameSite` | `'lax'` | `'strict'`, `'lax'` or `'none'`; `'none'` requires `secure` |
| `path` | `'/'` | `Path` |
| `secure` | `true` | `Secure`; pass `false` where the browser will not accept it (below) |
| `maxAge` | — | `Max-Age` in seconds, an integer; `0` or less tells the browser to drop it |
| `expires` | — | `Expires`, from a `Date` |
| `domain` | — | omitted, so the cookie is scoped to the exact host that set it |
| `partitioned` | `false` | `Partitioned` (CHIPS); requires `secure` |

`Secure` is on by default because Chrome, Edge and Firefox accept a `Secure` cookie on
`http://localhost`. Safari, a LAN IP or a plain-HTTP dev hostname do not; there, pass
`secure: false` (for example `secure: !isDev`).

`setCookie` throws a `TypeError`, naming the field, rather than produce a header that would split
or reshape the response: a name outside the RFC 6265 token set, a value containing CR, LF, `;`,
`,`, whitespace or a control character, an attribute containing CR, LF, `;` or a control character,
a non-integer `maxAge`, an invalid `expires`, and `sameSite: 'none'` or `partitioned` without
`secure`. The value is written as given, so encode it yourself (`encodeURIComponent`) if it can hold
any of those characters; the cookie decorators decode it on the way back in.

Several cookies on one response go in an array, and each element is sent as its own `Set-Cookie`
line on every runtime:

```typescript
import { setCookie, type TransformerFn } from '@green-tea/core';

const signIn: TransformerFn = (value) => {
  const { sessionId, user } = value as { sessionId: string; user: object };
  return {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': [setCookie('session', sessionId), setCookie('theme', 'dark', { httpOnly: false })],
    },
    body: JSON.stringify(user),
  };
};

// @Post('/login') @Transformer(signIn) login(...) { return { sessionId, user }; }
```

The same array works in `HttpError`'s `headers` argument and in an `onError` response.

`parseCookies(header)` — the parser the decorators use — and the `CookieOptions` type are exported
too. Signing and sessions are deliberately not in core.

## Schema forms — validation & coercion

`@body`, `@query`, `@headers`, and `@param` accept an optional **Standard Schema** (zod,
valibot, arktype, …). The value the handler receives is the schema's **parsed/coerced output**,
already typed:

```typescript
create(@body(CreateUser) user: { email: string }) {
  return { created: user.email };
}
```

:::note[Access shape (asymmetry)]
`@param('id', Schema)` takes the **key in slot 1** and the schema in slot 2 — `@param` always
needs a name to say which route param it binds. `@body(Schema)`, `@query(Schema)`, and
`@headers(Schema)` take the schema as their **only** argument, validating the whole parsed
object.
:::

A failing schema short-circuits the request with **422**. See [Validation](/docs/guides/validation/)
for the full contract (fail-fast order, error shape, async schemas, and caveats).

## Multipart access asymmetry

A request with `Content-Type: multipart/form-data` makes `@body()` resolve to `{ fields, files }`
instead of a plain object.

:::caution[Access note]
For multipart, `@body('title')` returns `undefined` — the value lives at `body.fields.title`,
not `body.title`, unlike JSON/urlencoded where `@body('title')` picks the value directly. Use
`@body()` and read `.fields` / `.files`, or key into the envelope itself with `@body('fields')`
/ `@body('files')`.
:::

```typescript
upload(@body() form: MultipartBody) {
  const name = form.fields.name;         // string | string[]
  const avatar = form.files.avatar;      // UploadedFile | UploadedFile[]
  return { name, size: Array.isArray(avatar) ? undefined : avatar?.size };
}
```

## Stream decorators — `@inbound` and `@abort`

These are for streaming handlers:

- **`@inbound()`** (WS only) gives you the incoming WebSocket message channel — the client's
  messages to consume. A `@Ws` handler returns the **outbound** channel.
- **`@abort()`** (stream / WS) hands you an `AbortSignal` that fires on disconnect, so you can
  tear down work when the client goes away.

```typescript
@Ws('/echo')
echo(@inbound() incoming: AsyncIterable<string>) {
  const out = channel<string>();
  (async () => {
    for await (const msg of incoming) out.push(`echo: ${msg}`);
    out.close();
  })();
  return out;
}
```

See [Streaming](/docs/guides/streaming/) for SSE, WebSocket duplex, and channels.

## Where to go next

- How injected values are produced: [Dependency injection](/docs/guides/dependency-injection/).
- The mental model: [The graph](/docs/concepts/the-graph/).
- Validating and coercing injected values: [Validation](/docs/guides/validation/).
- The full API surface: [Decorator reference](/docs/reference/decorators/).
