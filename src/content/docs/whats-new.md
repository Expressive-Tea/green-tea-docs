---
title: What's new
description: "What changed in @green-tea/core 26.8.0-beta.1, and what it means if you are already using it."
---

These pages document **26.8.0-beta.1**. This is what changed since `26.8.0-beta.0`, in the order it
matters to you rather than the order it was built. The [full changelog](https://github.com/Expressive-Tea/green-tea/blob/main/CHANGELOG.md)
has every release; this page is only the current one.

## You can see what your app is doing

The largest gap in the beta is closed. Every request gets an id — if a gateway already sent an
`x-request-id`, that one is adopted rather than replaced — and every event of that request carries
it, alongside the matched route **pattern**. Each step reports its own duration.

```ts
const app = createApp({ modules: [AppModule], logger: myLogger, logRequests: true });
```

The logger is any object with `debug`/`info`/`warn`/`error`. Given none, the default writes JSON, or
a readable line when attached to a TTY. **Nothing in core writes to `console`** — enforced by a lint
rule, not by intention — so every framework diagnostic is redirectable.

There is still no metrics registry and no OpenTelemetry exporter in core, on purpose: core keeps one
runtime dependency. A `traceparent` header is carried through untouched for an exporter to read.

→ [Observability](/docs/guides/observability/)

## Shutdown is somewhere you can hook into

Closing a connection no longer means writing `process.on('SIGTERM', …)` yourself. A provider that
opened a pool closes it in `dispose()`, a plugin registers `onShutdown`, and an app that wants
neither passes `hooks`. All three are awaited, run in reverse boot order — a `cache` that needs `db`
closes first — and a failure is logged rather than swallowed.

```ts
@Provider({ provides: 'db' })
class Db {
  provide() { return { db: this.#pool }; }
  async dispose() { await this.#pool.end(); }
}
```

It runs inside `close()`'s deadline, so a slow teardown cannot hold a deploy open;
`createApp({ teardownTimeoutMs })` reserves part of that budget when a connection must get its
chance. **Not available on the edge** — workerd has no shutdown to hook.

→ [Releasing what a provider opened](/docs/guides/dependency-injection/#releasing-what-a-provider-opened)

## One behaviour change worth reading

**`.` and `..` in a request path now resolve instead of returning 404.** `GET /public/../admin`
reaches a route declared as `/admin`, and `%2e` counts as a dot.

This changes Node only, and it exists to end a divergence rather than to be lenient: Deno, Bun and
Workers resolve dot segments inside the `Request` constructor before the framework sees anything, so
the same bytes on the wire were already reaching different routes depending on where you deployed.
If a proxy or WAF in front of you matches on the literal path, it now sees something different from
what the application routes.

→ [Path normalization](/docs/guides/routing/)

## Smaller, but you may be waiting for them

- **`createApp({ shutdownTimeoutMs })`** sets the shutdown deadline app-wide, for when `close()` is
  reached from a signal handler you do not own. Built on `close({ timeoutMs })`, contributed by
  [@YxnnXriel](https://github.com/YxnnXriel).
- **`limits.maxConnections`** caps concurrent sockets on Node, which was previously unbounded;
  non-positive values leave it unlimited. Contributed by [@hgshreyas](https://github.com/hgshreyas).
- **A bounded `close()` on the Deno and Bun adapters**, since `app.close()` cannot drain a server it
  does not own. One difference the deadline cannot hide: Node and Bun force the remainder shut, Deno
  cannot — there the deadline bounds how long `close()` waits, not when connections die.
- **Buffered bodies are narrowed to what the runtime's `Response` accepts** — a real typing hole on
  the `app.fetch` path that Deno, Bun and the edge all use.

→ [Who built this release](/docs/contributors/)

## Where this is going

Not a roadmap — see [Honest scope](https://github.com/Expressive-Tea/green-tea#honest-scope) for what
is settled and what still moves. The short version: the graph is the settled part, the plugin API and
`createApp`'s options still grow, and mesh is alpha. The API freeze belongs to the release candidate,
and freezing it before observability landed would have frozen an API still missing its contract.
