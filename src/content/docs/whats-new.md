---
title: What's new
description: "What changed in @green-tea/core 26.9.0-beta.2, and what it means if you are already using it."
---

These pages document **26.9.0-beta.2**. This is what changed since `26.9.0-beta.1`, in the order it
matters to you rather than the order it was built. The [full changelog](https://github.com/Expressive-Tea/green-tea/blob/main/CHANGELOG.md)
has every release; this page is only the current one.

Two of these are breaking, and both are one line to migrate. If you serve on Deno or Bun, read the
first section. If you ship a plugin, read the second. Everything else is additive.

## `serveDeno()` and `serveBun()` boot before they bind

They are async now, returning `Promise<DenoServer>` and `Promise<BunServeResult>`. The values they
resolve to are unchanged, so migration is one keyword:

```diff
- const server = serveDeno(app, { port });
+ const server = await serveDeno(app, { port });
```

Both runtimes support top-level `await`, so a module that serves at import time needs nothing else.

They did not boot the app before, and the documented fix was to remember `await app.boot()` first.
That made the correct use of a core helper depend on reading a page — in a framework whose argument
is that order should not be something you have to get right. Forget it and a missing signing key was
not a failed deploy: the boot memo keeps the rejection, so the port bound, every request got a 500
from the runtime, and none of them reached `onError`. The server looked healthy to anything that
only checked whether it was listening.

`edgeHandler` is deliberately untouched. On workerd there is no startup outside a request, so there
is no earlier moment to move the failure to — see the table in [Runtimes](/docs/guides/runtimes/).

→ [Runtimes](/docs/guides/runtimes/)

## A plugin is a named object

`Plugin` is now `{ name, mount(api) }`. It was `(api) => void`, and the name that `plugin:mounted`
reports came from the function — empty for an arrow returned by a factory, `"plugin"` for a `const`,
and whatever a minifier leaves. The event that exists to say which plugins mounted named none of
them.

```diff
- const jwt = (options) => ({ scope }) => { scope.add(node); };
+ const jwt = (options) => ({
+   name: options.provides ?? 'jwt',
+   mount({ scope }) { scope.add(node); },
+ });
```

The name is the author's word now. A failed mount reads `plugin "jwt" failed to mount: …` and keeps
the original error as its `cause`, and two plugins sharing a name fail `createApp`.

→ [Plugins](/docs/guides/plugins/)

## `app.boot()` is public

It runs the provider factories now instead of on the first request. `listen()`, `serveDeno()` and
`serveBun()` all call it for you, so you need it when you drive `app.fetch` / `app.upgrade` from a
server you own:

```ts
const app = createApp({ modules: [ApiModule] });
await app.boot();               // throws here instead of on every request
Deno.serve({ port: 8000 }, app.fetch);
```

It is idempotent and shares its memo with `listen()` and `fetch()`. On workerd there is no startup
outside a request, so it moves nothing there.

→ [Runtimes](/docs/guides/runtimes/)

## Errors are recognised by brand, not `instanceof`

`HttpError` and `ValidationError` carry `Symbol.for('green-tea.http-error')` and
`Symbol.for('green-tea.validation-error')`, and `isHttpError` checks the brand.

This matters when more than one copy of core is in play — a plugin package with its own dependency,
an app that installed from npm and JSR both. An `Unauthorized` thrown by the other copy failed
`instanceof` and rendered as a 500, which is the least useful status it could have chosen. It now
renders with its own.

The string is the public protocol: code that imports only types can write
`Symbol.for('green-tea.http-error')` itself. `HttpErrorLike` and `isValidationError` are exported
alongside.

→ [Errors](/docs/guides/errors/)

## Mesh (alpha): a teapot exports steps and routes, not providers

`@Provider({ export: true })` now fails the boot, with an error naming the provider and the
replacement. A provider's value *is* the object it builds — a pool, a client, a `db` — and an object
is not what a JSON wire carries. What crossed before was whatever half of it survived serialization,
and it arrived as an app-scope binding: the teacup resolved it once at boot and served that value
for the life of the process. Restarting the teapot changed nothing until the teacup restarted too.

Export a `@Step` instead. It runs on the teapot, per request, and only its result comes back.

Two things follow from that. The manifest now carries `{ steps: string[], routes }` rather than
`{ scopes: [{ token, scope }], routes }`, since every export is request-scope and the lifetime field
had one value left. And an **unreachable teapot no longer stops a teacup from booting**: there is no
app-scope value that has to resolve at boot, so after the `bootTimeoutMs` grace the teacup warns and
starts without it.

Be precise about what that last one buys, because it is narrower than it sounds. A teapot that never
connected sent no manifest, so its routes **404** — nothing was registered to match — and a local
step that `@needs` one of its tokens **still fails the boot**, naming the teapot. `503` is what a
teapot that connected and *later* died answers. What the change buys is the teacup that does not
depend on that teapot starting anyway.

`MESH_PROTOCOL_VERSION` stays at `1` on purpose: mesh is alpha behind `experimental: true`, both
peers ship from the same repository, and there is no deployed pair of versions for a bump to
protect.

→ [Mesh](/docs/guides/mesh/)
