---
title: Plugins
description: "Extending the app safely via bus.on, scope.add and onShutdown."
---

A plugin is a function that receives the app's API at boot. It gets exactly three
capabilities: **observe** the running system through `bus.on(...)`, **extend its own
scope** through `scope.add(...)`, and **release what it opened** through `onShutdown(...)`.
That's the whole surface — and it's deliberately narrow.

```typescript
const logger = (api: any) => {
  api.bus.on('request:step:enter', (p: any) => console.log(`→ ${p.name}`));
  api.bus.on('stream:open', (p: any) => console.log(`stream open ${p.name}`));
  api.bus.on('mesh:rpc:error', (p: any) => console.error('mesh rpc failed', p.error));
};

const app = createApp({ modules: [ApiModule], plugins: [logger] });
```

## Releasing what a plugin opened

A plugin that starts a timer, opens a pool or holds a socket registers its cleanup with
`onShutdown`. It is **awaited** — unlike a `bus.on` listener, which is fire-and-forget by
design — so `app.close()` does not return until it has finished or the deadline passes.

```typescript
class MetricsPlugin {
  #timer?: ReturnType<typeof setInterval>;

  mount = (api: any) => {
    this.#timer = setInterval(() => this.flush(), 10_000);
    api.onShutdown(() => {              // takes no arguments
      clearInterval(this.#timer);       // the closure already holds what it needs
      return this.flush();              // return a promise and it will be awaited
    });
  };
}
```

The callback receives nothing on purpose. Whatever needs closing is already in the closure of
the code that opened it, so no handle has to travel anywhere. If you find yourself wanting an
argument, the registration probably belongs closer to the resource.

A failing teardown is logged and the remaining ones still run — one broken callback must not
leave the process up. See [dependency injection](/docs/guides/dependency-injection/#releasing-what-a-provider-opened)
for the provider equivalent, and [runtimes](/docs/guides/runtimes/) for the one runtime where
none of this happens.

## Isolation is structural

A plugin can add steps and providers to **its own scope** via `scope.add(...)`. It
**cannot** reorder or delete another scope's steps. The graph — not a policy check —
enforces this: each scope owns its nodes, and a plugin has no handle on anyone else's.
There's no ordering hook to abuse and no step registry to mutate. If you want a plugin to
influence execution, it does so by contributing a node with declared `needs`/`provides`,
and the framework computes where that node lands.

:::note
Because execution is per-route (a route runs only the transitive closure of its handler's
`@needs`), a plugin step that should run on **every** route must produce nothing — add it
with `provides: []`. A step that produces no token has nothing to gate on, so the framework
runs it unconditionally. See [The graph](/docs/concepts/the-graph/) for how the closure is
computed.
:::

## Lifecycle & request events

Subscribe to events on the `Bus` to observe boot, per-request execution, streaming, and
mesh activity without touching the pipeline itself:

```typescript
api.bus.on('boot:provider:ready', (p: any) => { /* ... */ });
api.bus.on('request:step:enter', (p: any) => { /* ... */ });
api.bus.on('request:step:leave', (p: any) => { /* ... */ });
```

The full event vocabulary, what each payload carries, and how requests are correlated across
them live in [Observability](/docs/guides/observability/). The short version:

- `request:start | request:end | request:failed` — the request itself
- `route:matched | route:unmatched` — routing (`unmatched` covers both 404 and 405)
- `request:step:*` — a step entering/exiting/failing, with its own `durationMs`
- `boot:provider:*` — provider lifecycle during boot
- `stream:open | stream:close | stream:error` — SSE/WS stream lifecycle
- `mesh:connect | mesh:disconnect | mesh:rpc:error` — mesh link and RPC activity
- `plugin:mounted` — a plugin finished mounting

Every per-request payload carries a `requestId`, so a plugin can attribute events to the request
that caused them — which matters the moment two requests overlap.

Observation is read-only: handlers see the event payload but can't alter control flow. To
change behavior, contribute a node to your scope — see
[Dependency injection](/docs/guides/dependency-injection/).
