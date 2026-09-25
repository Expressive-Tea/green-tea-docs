---
title: Plugins
description: "Extending the app safely via bus.on, scope.add and onShutdown."
---

A plugin is a named object — `{ name, mount(api) }` — whose `mount` receives the app's API at
boot. It gets exactly three
capabilities: **observe** the running system through `bus.on(...)`, **extend its own
scope** through `scope.add(...)`, and **release what it opened** through `onShutdown(...)`.
That's the whole surface — and it's deliberately narrow.

```typescript
const logger = {
  name: 'logger',
  mount(api: any) {
    api.bus.on('request:step:enter', (p: any) => console.log(`→ ${p.name}`));
    api.bus.on('stream:open', (p: any) => console.log(`stream open ${p.name}`));
    api.bus.on('mesh:rpc:error', (p: any) => console.error('mesh rpc failed', p.error));
  },
};

const app = createApp({ modules: [ApiModule], plugins: [logger] });
```

## The name is yours to give

`name` is a field rather than something read off the function, because a function's name is not
dependable: an arrow returned straight from a factory has none, `const plugin = …` reports
`"plugin"`, and a minifier rewrites either. The name is what `plugin:mounted` reports, and what a
failed mount is blamed on:

```text
plugin "jwt" failed to mount: ENOENT: no such file or directory, open '/etc/keys/jwt.json'
```

The original error is kept as that error's `cause`. Two plugins with the same name fail
`createApp`, so a plugin that can be mounted twice takes its name from whatever renames its node —
by convention, its `provides` option.

## Releasing what a plugin opened

A plugin that starts a timer, opens a pool or holds a socket registers its cleanup with
`onShutdown`. It is **awaited** — unlike a `bus.on` listener, which is fire-and-forget by
design — so `app.close()` does not return until it has finished or the deadline passes.

```typescript
class MetricsPlugin {
  #timer?: ReturnType<typeof setInterval>;
  readonly name = 'metrics';

  mount = (api: any) => {
    this.#timer = setInterval(() => this.flush(), 10_000);
    api.onShutdown(() => {              // takes no arguments
      clearInterval(this.#timer);       // the closure already holds what it needs
      return this.flush();              // return a promise and it will be awaited
    });
  };
}
```

`createApp({ plugins: [new MetricsPlugin()] })` — an instance satisfies `Plugin` because it has both
members.

The callback receives nothing on purpose. Whatever needs closing is already in the closure of
the code that opened it, so no handle has to travel anywhere. If you find yourself wanting an
argument, the registration probably belongs closer to the resource.

A failing teardown is logged and the remaining ones still run — one broken callback must not
leave the process up. See [dependency injection](/docs/guides/dependency-injection/#releasing-what-a-provider-opened)
for the provider equivalent, and [runtimes](/docs/guides/runtimes/) for the one runtime where
none of this happens.

## What a plugin can and cannot touch

A plugin registers through the three functions `mount` receives, and nothing else. It gets no
handle on the container, the modules or another scope's nodes, and there is no ordering hook: if a
plugin wants to influence execution, it contributes a node with declared `needs`/`provides`, and
the framework works out where that node lands.

Node names are unique across the app. A plugin node named like an existing provider or step fails
`createApp`:

```text
duplicate provider/step name 'user' — names must be unique across modules and plugins
```

Tokens are a different matter. `scope.add` takes a node's name and the tokens it provides
separately, so a plugin node with a name of its own can still provide a token the app already
provides, and when it does, it takes that token over without a warning. The app's provider drops
out of every route that needed it. The framework's own tokens (`logger`, `events`, and the request
seeds `req` and `params`) are not affected, because they are registered after plugins.

So give a plugin a token of its own, derived from its `provides` option, and never provide a token
the app owns.

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
api.bus.on('boot:provider:ok', (p: any) => { /* ... */ });
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

## Write one, publish one

`matcha create plugin` starts one. By default it writes an in-app plugin to `plugins/<name>/` and
registers it in `createApp({ plugins })`. With `--package` it writes a package of its own instead:
JSR by default, and `--registry both` adds an ESM-only npm build. See the
[CLI guide](/docs/guides/cli/#generate--matcha-create).

Three official plugins are published so far, and each has a page on the
[plugin listing](https://green-tea.expressive-tea.io/plugins/) with its README, its versions and
the runtimes it supports:

- [`@green-tea/jwt`](https://green-tea.expressive-tea.io/plugins/jwt/)
- [`@green-tea/metrics`](https://green-tea.expressive-tea.io/plugins/metrics/)
- [`@green-tea/rate-limit`](https://green-tea.expressive-tea.io/plugins/rate-limit/)

Listing yours takes one yaml file in a pull request. The listing's
[CONTRIBUTING](https://github.com/Expressive-Tea/green-tea-marketplace/blob/main/CONTRIBUTING.md)
says what it has to contain and what a reviewer checks.
