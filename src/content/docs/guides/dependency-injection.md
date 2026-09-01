---
title: Dependency injection
description: "Providers, steps, and modules, and how values flow through the graph."
---

In green-tea the request pipeline is an explicit **dependency graph**. You declare what each
piece needs and produces; the framework computes the order, validates the wiring at boot, and
runs only the slice a route actually depends on. You never write "put this before that."

There are three building blocks:

- A **provider** is an app-scope singleton — constructed once, its value memoized for the
  lifetime of the app.
- A **step** runs per request and transforms the context.
- A **module** sets a mountpoint and wires providers, steps, and controllers together.

A handler's **argument decorators are its dependency declaration** — ask for what you want, in
any order. If you `@needs` a token nothing produces, you get a **boot error**, not an
`undefined` at runtime.

## The full example

```typescript
import 'reflect-metadata';
import { createApp, Provider, Step, Route, Get, Module, Unauthorized, needs, param } from '@green-tea/core';

@Provider({ provides: 'db' })
class Database {
  provide() { return { db: { find: (id: string) => ({ id, name: 'Diego' }) } }; }
}

@Step({ provides: 'user', needs: ['db', 'req'] })
class Authenticate {
  run(ctx: any) {
    const user = ctx.db.find(ctx.req.headers['x-token']);
    if (!user) throw new Unauthorized('bad token'); // throw = short-circuit the pipeline
    return { user };                                // return = continue, merge into ctx
  }
}

@Route('/users')
class UserController {
  @Get('/:id')
  getUser(@needs('user') user: any, @param('id') id: string) {
    return { requested: id, you: user };           // auto-serialized as JSON
  }
}

@Module({ mountpoint: '/api', providers: [Database], steps: [Authenticate], controllers: [UserController] })
class ApiModule {}

const app = createApp({ modules: [ApiModule] });
await app.listen(3000);
// GET /api/users/9  (header x-token) → { "requested": "9", "you": { "id": "...", "name": "Diego" } }

await app.close();   // graceful shutdown: drains in-flight, closes streams + mesh links, runs
                     // registered teardown, then force-closes whatever is left after 10s
```

## Releasing what a provider opened

A provider that opens something — a pool, a client, a file handle — closes it in `dispose()`.
The method is optional; a provider without one is skipped.

```typescript
@Provider({ provides: 'db' })
class Db {
  #pool = new Pool(process.env.DATABASE_URL);

  provide() {
    return { db: this.#pool };
  }

  async dispose() {     // awaited by app.close(); no arguments, the instance holds its own pool
    await this.#pool.end();
  }
}
```

**Teardown runs in reverse boot order.** Providers boot in dependency order, so they close in the
opposite one: a `cache` that needs `db` shuts down before the `db` it is still holding. You never
declare that order — it is the same graph that decided boot order, read backwards.

A provider that *failed* to boot is never disposed: nothing it might close was ever opened. A
`dispose()` that throws is logged and the rest still run, because one broken teardown must not
leave the process up.

It all happens inside `close()`'s deadline, so a slow `dispose()` cannot hold a deploy open. If a
connection must get its chance to close, reserve part of that budget:

```typescript
createApp({ modules: [ApiModule], shutdownTimeoutMs: 10_000, teardownTimeoutMs: 2_000 });
// drain gets at most 8s, teardown is guaranteed 2s, close() still returns within 10s
```

Left unset, the drain may use the whole budget and teardown takes what is left. A
`teardownTimeoutMs` larger than `shutdownTimeoutMs` is rejected at boot — it is reserved out of
that budget, not added to it.

Plugins register the same thing with [`onShutdown`](/docs/guides/plugins/#releasing-what-a-plugin-opened),
and an app that wants neither can pass `hooks: [{ onShutdown }]` to `createApp`. All three land in
one registry with one order and one failure policy. None of it runs on
[the edge](/docs/guides/runtimes/).

## Who calls `close()`

Everything above runs from `close()`, and something has to call it. That part is not optional: a
container `SIGKILL`ed after its grace period skips every `dispose()` the registry so carefully
ordered, and reports nothing on the way out. The failure is silent, which is what makes it worth a
heading.

You have both options, and neither is a workaround for the other.

**Write the handler yourself** and keep the control — when the process exits is the application's
call, and there are apps that want to decide it:

```typescript
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
```

**Or hand it over**, and the framework registers `SIGINT`/`SIGTERM` to close and exit for you:

```typescript
createApp({ modules: [ApiModule], handleSignals: true });
```

Off by default on purpose — a library that installs process-wide handlers behind your back is worse
than one that installs none. Turned on, it also absorbs the last per-runtime difference an app
otherwise carries: `process.on` on Node and Bun, `Deno.addSignalListener` on Deno, and the matching
`exit` for each. You declare it once on `createApp`, and whichever boot call you use — `listen()`,
`serveDeno()` or `serveBun()` — wires it to the closer that drains *that* server.

`close()` unregisters the handlers, so a **second** signal falls through to the platform default and
ends the process at once. Ctrl-C twice is the way out of a teardown that is stuck; once is the way to
let it finish.

## `@Provider` — app-scope, memoized

A provider produces a value once, when the app boots, and reuses it for every request. Its
`provide()` method returns an object whose keys become tokens in the graph — here `db`.

```typescript
@Provider({ provides: 'db' })
class Database {
  provide() { return { db: { find: (id: string) => ({ id, name: 'Diego' }) } }; }
}
```

Because it's app-scope, a provider is the right home for things you build once and share:
database clients, config, connection pools.

:::note
An optional provider (`optional: true`) that throws on boot does **not** abort startup — it is
left unregistered and logged, and the failure surfaces at request time for routes that need it.
Query the degraded set with `app.degraded()` or listen for the `boot:provider:fail` bus event.
:::

## `@Step` — request-scope, transforms the context

A step runs once per request. Its `run(ctx)` receives the accumulated context and either:

- **returns an object** → the pipeline continues and the object is merged into `ctx`, or
- **throws** → the request short-circuits (here `Unauthorized` becomes a `401`).

```typescript
@Step({ provides: 'user', needs: ['db', 'req'] })
class Authenticate {
  run(ctx: any) {
    const user = ctx.db.find(ctx.req.headers['x-token']);
    if (!user) throw new Unauthorized('bad token'); // throw = short-circuit the pipeline
    return { user };                                // return = continue, merge into ctx
  }
}
```

This step `provides: 'user'` and `needs: ['db', 'req']` — so green-tea knows the `db` provider
and the built-in `req` must resolve before it runs, and it topologically sorts accordingly.

## How `needs` / `provides` build the graph

Every node declares what it **produces** (`provides`) and what it **consumes** (`needs`). The
framework reads those declarations and computes a topological order — you never specify
ordering by hand. A handler's argument decorators extend the same graph: `@needs('user')` on a
parameter is a dependency edge exactly like a step's `needs`.

Because the graph is explicit, **each route runs only the transitive closure of its handler's
`@needs`** — nothing else.

:::caution[Per-route execution]
A route that doesn't `@needs('user')` does **not** run the `Authenticate` step. A cross-cutting
*enforcement* step (e.g. auth that throws `401`) only protects routes that actually `@needs`
its token. To run something on **every** route regardless of needs (logging, audit, a global
guard), add it as a **plugin step** via `scope.add({ ..., provides: [] })` — steps that produce
nothing run unconditionally. Don't rely on a token-providing step to guard routes that don't
declare it.
:::

## `@Module` — mountpoint and wiring

A module ties everything together: a `mountpoint` prefix for the routes, and the lists of
`providers`, `steps`, and `controllers` that belong to it.

```typescript
@Module({ mountpoint: '/api', providers: [Database], steps: [Authenticate], controllers: [UserController] })
class ApiModule {}
```

Pass modules to `createApp({ modules: [ApiModule] })` to assemble the app.

## Boot validation of `@needs`

The payoff of declaring dependencies is that the wiring is checked before a single request is
served. When you `@needs` a token, green-tea verifies some provider or step actually produces
it. If nothing does, **`createApp` throws with a clear error** instead of letting your handler
receive `undefined`. Boot fails loudly, so you never serve `undefined`.

### Names the framework owns

`logger`, `rooms`, `events` and `bus` are reserved. Declaring one — from a module, a plugin or a
mesh export — fails at boot rather than overriding the framework's own.

The first three are real tokens you can inject: `@needs('logger')` gets the same logger core writes
to, `@needs('rooms')` the built-in `Rooms`, and `@needs('events')` the read-only `{ on }` slice of
the event bus ([observability](/docs/guides/observability/#reaching-the-bus)).

`bus` is reserved without being provided. The `Bus` itself is deliberately not a graph token — a
node that could reach it could also `emit`, and an observation channel anything can write to is not
one — so `@needs('bus')` fails at boot and tells you what to use instead. Reserving the name is what
stops it from quietly resolving to something you happened to call `bus`.

## Where to go next

- New to green-tea? Start with [Getting started](/docs/getting-started/).
- The mental model behind all of this: [The graph](/docs/concepts/the-graph/).
- Everything a handler can inject: [Argument decorators](/docs/guides/arguments/) and the
  [decorator reference](/docs/reference/decorators/).
- Coerce and validate injected values with Standard Schema: [Validation](/docs/guides/validation/).
- Declare `@Sse` and return an `AsyncIterable` to push data over time: [Streaming](/docs/guides/streaming/).
- Wrap a flaky upstream in a provider instead of a retry scattered through handlers:
  [Circuit breakers](/docs/guides/circuit-breaker/).
