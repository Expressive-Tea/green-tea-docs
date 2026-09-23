---
title: Mesh (alpha)
description: "Distributed dependency injection over a secret-gated WebSocket control channel."
---

:::caution[Alpha]
Mesh is **alpha** — its API and wire protocol may change between releases, and discovery, load-balancing, and failover are not built. It is gated behind an explicit opt-in: `createApp({ mesh, experimental: true })`, and `createApp` **throws** if you configure `mesh` without `experimental: true`. **Don't ship mesh to production yet.**
:::

A **teacup** can depend on a token that physically lives on another node — a **teapot**. `@needs('billing')` resolves the same whether `billing` runs in this process or on a remote one. There's no gRPC layer or message-pattern DSL: there's the [graph](/docs/concepts/the-graph/), and some nodes happen to live elsewhere.

Exports are opt-in (`export: true`) on **steps and routes** — a provider cannot be exported, for a reason [below](#what-can-cross-data-never-behaviour) — and the control channel is gated by a shared secret.

## What runs where

Mesh runs on **Node, Deno and Bun**, as both teapot and teacup, in any combination — a Deno teapot can serve a Node teacup. The wire is JSON over a WebSocket, so peers only have to agree on the protocol version, not the runtime.

**Edge (Cloudflare Workers) is not supported.** The teapot's secret comparison uses `node:crypto`'s `timingSafeEqual`, which workerd's `nodejs_compat` does not provide.

You do **not** need `listen()`. `serveDeno` and `serveBun` boot the graph before they bind, so a teacup has reached its teapots — or spent its `bootTimeoutMs` grace trying — by the time the port opens:

```typescript
await serveDeno(teapot, { port: 3002 });   // control channel served via app.upgrade
await serveBun(teacup, { port: 3003 });    // teapots connected before this resolves
```

Hand `app.fetch`/`app.upgrade` to `Deno.serve`/`Bun.serve` yourself and the graph boots on first use instead, which for a teacup means the first request pays for the connection. `await app.boot()` first if you want that cost at startup.

## Node A — teapot (exposes `config`, `auth`, and a route)

```typescript
@Step({ provides: 'config', needs: [], export: true })
class Config { run() { return { config: { region: 'mx', tier: 'pro' } }; } }

@Step({ provides: 'auth', needs: [], export: true })
class Auth { run(ctx: any) { return { auth: { token: ctx.headers?.['x-token'] ?? 'anon' } }; } }

@Route('/svc')
class Svc { @Get('/ping', { export: true }) ping() { return { pong: true }; } }

@Module({ mountpoint: '/api', steps: [Config, Auth], controllers: [Svc] })
class TeapotModule {}

const teapot = createApp({ modules: [TeapotModule], experimental: true, mesh: { secret: 'shh' } });
await teapot.listen(3002);
```

## Node B — teacup (uses `config` + `auth` with nothing local providing them)

```typescript
@Route('/local')
class LocalCtl {
  @Get('/who')
  who(@needs('config') config: any, @needs('auth') auth: any) {
    return { config, auth };           // both resolved by RPC to the teapot
  }
}
@Module({ mountpoint: '/api', controllers: [LocalCtl] })
class TeacupModule {}

const teacup = createApp({
  modules: [TeacupModule],
  experimental: true,
  mesh: { teapots: [{ url: 'ws://A-host:3002/__mesh__/control', secret: 'shh' }] },
});
await teacup.listen(3003);
// GET B:3003/api/local/who  (x-token: abc)
//   → { "config": { "region": "mx", "tier": "pro" }, "auth": { "token": "abc" } }
```

## How it resolves

`@needs('config' | 'auth')` validates at boot because the teapot announced them in its **manifest** on connect — a list of step names and a list of routes, nothing else. Every export is **request-scope**: one RPC per request, carrying the request envelope, answered by the step running on the teapot. Nothing is resolved once and cached on the teacup, so a remote export holds nothing between requests.

That is also why a **provider cannot be exported**. A provider is a factory whose value *is* the object it builds — a pool, a client, a `db` — and an object is not what a JSON wire carries. What used to cross was whatever half of it survived serialization, cached app-scope on the teacup for the life of the process, out of a cache the teapot no longer stood behind. Export a `@Step` that returns what the provider's value carried instead; the [next section](#what-can-cross-data-never-behaviour) has the shape.

Remote tokens become synthetic nodes in the local graph with RPC-backed runners, so the rest of the pipeline is unchanged. For non-mesh apps `createApp` stays synchronous; a mesh app defers graph finalization until it boots — connecting to teapots is network I/O — and boots on whichever comes first: `app.fetch`, `app.upgrade` or `listen()`. Whoever triggers it, it happens once.

## Inspecting a mesh graph

`inspect()`, `graph()` and `explain()` are synchronous, but a mesh graph is not knowable until its teapots have been asked — so on a mesh app they throw until the graph is resolved. `await app.ready()` resolves it:

```typescript
await app.ready();       // connects the teapots; a no-op on a non-mesh app
app.graph();             // now includes the remote steps and routes
```

Write those two lines and your code works against either kind of app without knowing which it got. `ready()` deliberately does **not** boot providers — resolving the graph and being ready to serve are different things, and drawing a diagram should not open your database connections. Serving (`fetch`/`upgrade`/`listen`) boots them too and shares the same memoized step, so calling both never resolves the graph twice.

The dev routes (`/__graph__`, `/__openapi__`) need none of this: a request boots the app before the route runs.

## What can cross: data, never behaviour

The wire is JSON, so a mesh export carries **values**, not handles.

```typescript
@Provider({ provides: 'db', export: true })
class Db { provide() { return { db: new Pool() }; } }   // ✗ does not compile, and fails the boot
```

A `Pool` has methods and private state, and JSON keeps neither — and a provider's value is always
that kind of thing, which is why `export` is not among `@Provider`'s options at all. TypeScript
rejects it at the decorator; a JavaScript caller that passes it anyway reaches the boot error, which
names the provider and the replacement:

```
mesh: provider 'db' cannot be exported — a provider is a factory whose value is the object
itself, and the mesh transports data, not objects. Export a @Step instead, which runs on the
teapot per request and returns its result.
```

Export what the handle *produces* instead:

```typescript
@Step({ provides: 'customer', needs: ['db'], export: true })
class Customer {
  run(ctx) { return { customer: this.db.find(ctx.headers['x-customer']) }; }   // ✓ data
}
```

A step's *result* is checked too: the teapot refuses one it cannot transport, on the side that still
holds the real value, and names what sat where:

```
mesh cannot transport 'db': result.db is a Pool instance. The wire is JSON, so a mesh
export carries data, never behaviour — export what the handle produces rather than the handle.
```

It is an allowlist: primitives, plain objects and arrays. **`Date` is refused too**, because it would
arrive as a string rather than the type you declared — the same silent difference in a smaller
costume. Send an ISO string or a number and let the far side decide what it is.

:::caution[Before this check existed]
An export of a handle answered **HTTP 200 with `{}`**. It passed every `if (db)`, had no methods, and
failed as `db.query is not a function` somewhere else entirely. If you have a teapot exporting
something with behaviour, it has never worked — it has been failing at the call site.
:::

## Buffered routes only

Mesh proxies **buffered** endpoints. `@Sse`, `@Stream` and `@Ws` routes are not exportable: a remote route is registered as `transport: 'buffer'`, and a handler that returns an `AsyncIterable` over a mesh call fails with `cannot proxy a streaming route`. Streams are a live socket between client and server; there is no meaningful way to relay one through an RPC hop today.

## One teapot per route

A route must be exported by exactly **one** teapot. If two export the same method and effective match shape — including patterns that differ only by parameter name, such as `/:id` and `/:name` — boot **fails**, naming both patterns and both teapots:

```
mesh: ambiguous remote route 'GET /api/shape/:name' from ws://b/__mesh__/control
conflicts with 'GET /api/shape/:id' from ws://a/__mesh__/control — load balancing
across teapots is not implemented yet, so green-tea will not choose one for you.
```

This is a hard error rather than a silent pick because there is no load balancing to fall back on: choosing one would be an arbitrary answer you could come to depend on. Step tokens are unique for the same reason.

**Local routes win.** If you declare a route locally *and* import the same effective method/shape from a teapot, yours takes precedence — that is how you override a teapot — and green-tea warns so a shadowed export doesn't look like a broken one:

```
[green-tea] mesh: route 'GET /api/svc/ping' is exported by teapot ws://a/… but also
declared locally — the local route takes precedence and the remote one will not be
reached. Remove one if that is not what you meant.
```

## When a teapot goes away

A dead upstream is not a broken service, and the status says which:

| What happened | Status |
| --- | --- |
| The teapot never connected, so its routes were never registered | **404** Not Found — see [below](#when-a-teapot-is-not-there-yet) |
| The link is down (closed, or the heartbeat gave up) | **503** Service Unavailable |
| The link is up but the teapot didn't answer in `timeoutMs` | **504** Gateway Timeout |
| The teapot answered with an error | whatever it said |

503 arrives **immediately** — a closed socket cannot deliver the frame, so waiting `timeoutMs` (30s by default) would just make the caller pay for a verdict already known.

Each teacup pings its teapots every `heartbeatMs` (15s by default) and closes a link after two unanswered rounds. This is what catches a **half-open** connection — a dropped route, a killed container, a NAT that timed out — where the socket still looks open with nobody home. Without it, a teacup only finds out on the next request, which pays the full timeout first.

```typescript
mesh: { teapots: [...], heartbeatMs: 5000 }   // notice sooner, chatter more
```

Ping and pong are ordinary mesh frames rather than WebSocket protocol pings, because the platform `WebSocket` on Deno and Bun does not expose `ws.ping()` — a protocol-level heartbeat could not work on every runtime mesh supports.

## Reconnecting

A teacup reconnects to a teapot that comes back, with exponential backoff and jitter — 500 ms doubling to a 30 s ceiling. The jitter matters when several teacups went down together: without it they return in lockstep and stampede the teapot the moment it answers.

```typescript
mesh: { teapots: [...], reconnect: { initialDelayMs: 500, maxDelayMs: 30_000 } }
mesh: { teapots: [...], reconnect: false }   // fail once and stay down
```

While a link is down its RPCs answer **503 immediately**, and a reconnected link is simply usable again on the next RPC. There is nothing to invalidate or re-register: a remote export holds nothing between requests, so there is no cached value a returning teapot could disagree with.

`app.close()` is terminal for a link: one the application hung up on never reconnects. Otherwise closing an app would leave a process that cannot exit.

**Reconnection is not failover.** It returns to the *same* teapot. Switching to a different one exporting the same thing needs load balancing, which is not built.

### A returning manifest that no longer backs the graph

The graph was validated at boot against the manifest the teapot announced then, and it is already serving requests. So if a teapot comes back exporting *less* — a token gone, a route withdrawn — the connection is **refused** rather than adopted:

```
mesh: refusing to reconnect to ws://a/__mesh__/control — its manifest no longer exports
step 'billing', which the graph was validated against at boot. Retrying in case this is
a partial deploy.
```

The link keeps retrying, because a rollback or a half-finished deploy can still restore it, and the refusal is logged once per distinct manifest rather than once per attempt. Serving against a manifest that no longer backs the graph would surface as a 500 that looks like your code.

Extra exports are the other direction and are simply **ignored**: the graph is fixed at boot, so new tokens are not spliced into a running app.

This is a named policy rather than implicit behaviour:

```typescript
mesh: { teapots: [...], onManifestChange: 'refuse' }   // the default, and the only one today
```

A future release may add `'reconcile'`, which rebuilds the graph instead of refusing. Naming the policy now means that arrives as an addition rather than as a change to what the default means — which matters when the two ends are separate processes on separate deploy cadences.

## When a teapot is not there yet

A teapot that is thirty seconds behind and a teapot that does not exist look identical for the first thirty seconds, and a container that is merely late should not fail a deploy. `bootTimeoutMs` is the grace for that:

```typescript
mesh: { teapots: [...], bootTimeoutMs: 30_000 }   // the default is timeoutMs
mesh: { teapots: [...], bootTimeoutMs: 0 }        // one attempt, no grace
```

Within that budget the connection is retried with backoff. When it passes, the teacup **warns and starts without that teapot**. It can, because every export is a step or a proxied route: nothing needed that link resolved *at boot*, and a step is nothing but later.

Starting is not degrading, though, and the difference is worth stating exactly. A teapot that never connected sent no manifest, so the teacup learned nothing about it — no step runners, no routes, a graph identical to the one it would have had if that teapot were never configured. Its routes therefore **404**, through the ordinary unmatched-route path, because nothing was ever registered to match. **503** is what a teapot that connected and *later* died answers: that link exists, its steps and routes are registered, and the dead link is what returns the status. Never reachable and reachable-then-gone are different situations, and they read differently on purpose.

The warning names the teapot and says no manifest was exchanged, so a later 404 on one of its routes has a line to point back to:

```
mesh: teapot ws://a/__mesh__/control unreachable after 7 attempt(s) over 30000ms (…) — starting
without it. No manifest was ever exchanged, so none of its steps or routes are in this graph: its
routes 404 like any path that was never registered, and the boot still fails if anything local
needs one of its tokens. This line is what a later 404 on one of its routes points back to.
```

That last clause is the one thing that still stops a deploy: a local step or handler that `@needs` a token only that teapot exported **fails the boot**, naming the teapot that did not connect. So a teacup that does not depend on an absent teapot starts, and one that does still fails where you can see it. To make a teapot's absence fatal on purpose, have something local need one of its tokens.

**A refusal is not retried.** A wrong secret or a protocol-version mismatch is the teapot's decision and will be the same decision in thirty seconds, so it fails at once rather than spending the whole budget to reach an identical error. The two are told apart by whether the socket ever opened: a peer that accepted the connection and then hung up rejected you on purpose, while one that never accepted it may simply not be listening yet.

Every retry is logged *and* emitted as `mesh:boot:retry`, so a slow boot is visible to whatever collects [lifecycle events](/docs/guides/observability/) and not only to whoever happens to be watching a terminal. It is kept separate from `mesh:disconnect`, which means a link that was up and went away — this one never came up.

## A request keeps its identity across the hop

The RPC envelope carries the caller's `requestId` and `traceId`, and the teapot **adopts** them rather than opening its own — the same rule an incoming `x-request-id` gets, applied at the process boundary. So one request that crosses the mesh produces one trace, not two unrelated ones, and the teapot's `request:step:*` events carry the id the teacup already had.

The envelope also carries `url`, so a proxied handler sees the path its caller asked for.

Both are **optional on the wire**, which is why the protocol version did not move for them: a teapot running an older green-tea ignores what it does not recognise and keeps answering. You lose the correlation of that hop and nothing else.

## Keeping the control channel honest

The channel is authenticated, but an unauthenticated peer still gets to send bytes at it, so two limits bound what it can do before proving anything:

- **A handshake deadline.** A peer that connects and never sends `hello` is hung up on after 10 seconds. The teacup has always bounded its side; this is the teapot's.
- **A frame size cap.** `decode` runs `JSON.parse` on peer-controlled input, so frames above 4,000,000 characters are refused with close code `1009` — checked *before* parsing, since parsing is the expensive part being defended. The cap sits above the 1 MB default body limit a legitimate RPC can carry.

:::caution[The secret travels in the handshake]
The shared secret is sent verbatim in the `hello` frame. Over `ws://` that puts it in front of anyone on the path, so **use `wss://`** unless the link already runs inside an encrypted network. green-tea warns at boot for a `ws://` teapot that is not on loopback — a warning rather than a refusal, because a private network doing its own mutual TLS is a real deployment and the framework cannot tell the two apart.
:::

## Protocol version

Peers are separate processes on separate deploy cadences, so the wire is versioned: `MESH_PROTOCOL_VERSION` travels in the `hello` and `manifest` frames, and a mismatch is refused on both sides with both versions named. A teapot checks the version **before** the secret — a skewed peer is not an authentication failure, and reporting it as one would send you hunting the wrong bug.

**The version is a compatibility boundary, not a changelog.** It moves only when a peer on the old version would *misparse a frame or misbehave silently* — a field removed, renamed or retyped, a new **required** field, or a new frame type that expects an answer the old peer cannot decode. Adding an **optional** field is none of those, so it does not move the number: `decode` validates only what a frame type requires and passes extras through. Bumping per change would make the number mean "work happened" rather than "we are incompatible", which is the one thing it exists to say.

:::note[Skeleton limitations (by design)]
No discovery, load-balancing, or failover yet. A teapot that is down when a teacup *boots* is started without — its routes 404 and nothing stands in for it — and reconnection covers only links that connected at least once. A returning manifest is refused rather than reconciled, and extra exports in it are not spliced into the running graph.
:::
