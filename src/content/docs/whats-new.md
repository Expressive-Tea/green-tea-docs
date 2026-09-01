---
title: What's new
description: "What changed in @green-tea/core 26.9.0-beta.1, and what it means if you are already using it."
---

These pages document **26.9.0-beta.1**. This is what changed since `26.8.0-beta.1`, in the order it
matters to you rather than the order it was built. The [full changelog](https://github.com/Expressive-Tea/green-tea/blob/main/CHANGELOG.md)
has every release; this page is only the current one.

Three of these are crashes, and each one exits the process rather than answering. If you are on
`26.8.0-beta.1` and using a CORS predicate, a custom `onError`, or the JSR package, read the first
three sections before anything else.

## A CORS predicate that throws no longer takes the process down

`cors.origins` accepts a predicate, and a predicate is the whole reason the option takes a function:
the shapes it exists for are lookups — an allowlist in Redis, a tenant query. Every one of those has
a failure mode, and until now the framework gave it no boundary. A throw became a rejected promise
nobody awaited, and Node's default for that is to exit the process.

One cross-origin request was enough. `onError` never saw it, because the predicate runs before the
region where errors convert to a response.

The trigger is a browser, which is what let this survive a green test suite: the predicate is only
reached when a request carries an `Origin` header, so a test that forgets the header cannot catch
it.

A predicate that throws now **denies** the origin, and the failure is logged. Not a 500, and not an
open door: a lookup that failed has not said yes, and a backing store being briefly unavailable must
never widen an allowlist. Watch your logs for it — failing closed is invisible from the outside,
because a broken lookup and a genuinely disallowed origin look identical to the caller.

→ [CORS](/docs/guides/security/#cors)

## The JSR package works

If you installed from JSR rather than npm, `@Html('file.html')` died at boot on Deno:

```
error: Uncaught (in promise) ReferenceError: require is not defined
  at readViewFile (…/src/views.ts:64:20)
```

JSR serves the TypeScript source rather than the bundled build, and the bundle is where the ESM
`createRequire` shim lived — so every lazy `require()` in the source had nothing to resolve.

Two other places were worse than the crash, because they answered confidently and wrongly.
`createApp({ static: true })` reported *"needs a filesystem and is unavailable on this runtime
(edge)"* while running on Deno, which has one. Multipart uploads reported `busboy` as not installed
while it sat in `node_modules`. Both blamed the runtime for a packaging problem, and both named a
runtime you were not on — which is harder to debug than the crash, not easier.

Nothing changes for npm installs; both builds behave exactly as they did.

## A custom `onError` that throws no longer takes the process down

Same shape as the one above, in a different callback, and easier to reach: not a cross-origin
request but *any* request that produces an error.

`createApp({ onError })` is the advertised way to render errors and it ran with no boundary around
it. A renderer that threw exited the process. And it renders the `404` too — so an app with a custom
renderer and no matching route was one request away from ending.

It is also the worst-timed crash there was, because of *when* the renderer runs. It only runs once
something has already gone wrong: an error occurred, the code written to report it failed, and
instead of a degraded report the server went away.

A renderer that throws now falls back to the built-in JSON rendering — which is exactly what the
option overrides — so the original error still gets its response. The renderer's own failure is
logged separately, naming both errors, because they are different errors and chasing the wrong one
costs an afternoon.

Worth re-reading your renderer with this in mind. None of these look risky while you write them:

```ts
onError(error, req) {
  const type = req.headers.accept.split(',')[0];  // no Accept header → throws
  ...
}
```

→ [Errors](/docs/guides/errors/#if-your-renderer-throws)

## Shutdown can be the framework's job now

The previous release moved the *content* of teardown into the framework — `dispose()`, `onShutdown`,
`hooks` — but not the trigger. Nothing called `close()`, so every application still wrote the signal
handler, and wrote it three times, because the spelling is runtime-specific.

```ts
createApp({ modules: [AppModule], handleSignals: true });
```

That registers `SIGINT`/`SIGTERM` to close and exit, using each runtime's own API: `process.on` on
Node and Bun, `Deno.addSignalListener` on Deno, and the matching `exit` for each. Declare it once on
`createApp` and whichever boot call you use — `listen()`, `serveDeno()`, `serveBun()` — wires it to
the closer that drains *that* server.

**Off by default, and staying that way.** A library that installs process-wide handlers behind your
back is worse than one that installs none, because when the process exits is your call. Writing the
handler yourself remains fully supported; what is not optional either way is that *something* calls
`close()`. Skip it and the container is `SIGKILL`ed after its grace period: every `dispose()` the
registry so carefully ordered is skipped, and nothing reports that it was.

One detail worth knowing: `close()` unregisters the handlers, so a **second** signal falls through
to the platform default and ends the process at once. Ctrl-C twice is the way out of a teardown that
is stuck; once is the way to let it finish.

→ [Who calls `close()`](/docs/guides/dependency-injection/#who-calls-close)

## A request budget, not just a connection cap

`limits.maxConnections` capped sockets. It could not cap work: a thousand cheap keep-alive
connections and a thousand expensive in-flight handlers are the same number to it.

```ts
createApp({ modules: [AppModule], limits: { maxConcurrentRequests: 100 } });
```

Over the budget, a request gets `503` with `Retry-After: 1` instead of queueing behind the ones
already running. Opt-in and unlimited by default, and it applies per server and per Fetch adapter
instance — so it works on all four runtimes, not only Node.

It counts **executing handlers**, not open connections. The slot is released when routing and the
handler finish, so a long-lived SSE stream or a WebSocket upgrade does not hold one for its
lifetime; on Node, a client disconnecting releases the slot early. A handler that never returns
keeps its slot, which is the honest behaviour for a budget of this shape rather than a gap in it.

Contributed by [@hgshreyas](https://github.com/hgshreyas), documentation included.

→ [Runtimes](/docs/guides/runtimes/) · [`RequestLimits`](/docs/reference/createapp/#requestlimits)

## The lifecycle stream has a contract now

The stream shipped last release and was enough to build on. What it was missing was anything saying
how to build on it — and every mistake it invited was silent. Nothing threw, nothing logged, the
metrics simply came out wrong.

**Count `request:end`, and nothing else.** One request that throws emits three events, a 404 emits
two, and they all share a `requestId`. The first exporter anyone writes counts failures twice.
`request:end` is terminal, universal and the only one carrying the status the client received;
`request:failed` means *handler code threw*, which no status expresses since a rendered `422` is
also a throw; `route:unmatched` means *no route ran*. The last two are **additional**, not
alternatives.

**Label on `route`, never on `name`.** `name` carries the path that arrived, which is bounded by
nothing at all — a scanner walking `/aaa`, `/aab`, `/aac` turns a counter into one series per URL,
which is a memory leak with a metrics backend attached. `route` is bounded by construction, and an
unmatched request now carries `'<unmatched>'` instead of nothing, exported as `UNMATCHED_ROUTE`.

**`request:start` and `request:end` are guaranteed to come in pairs**, including for a request shed
by `maxConcurrentRequests`, which never reaches a route. An in-flight gauge that counts one up and
the other down is correct now, where before it would have drifted the first time a server shed —
under load, which is when you are watching it.

`request:failed` also carries `status` now, so an error counter can break down by status without
joining back through `requestId`.

→ [Observability](/docs/guides/observability/#count-requestend-and-nothing-else)

## Subscribing from inside the graph

`app.bus` was public and a plugin could subscribe, but the bus was not a graph token, so
`@needs('bus')` failed at boot and nothing said why.

```ts
@Provider({ provides: 'collector', needs: ['events'] })
class Collector {
  #off?: () => void;
  provide(ctx: { events: Events }) {
    this.#off = ctx.events.on('request:end', (e) => count(e.route));
    return { collector: registry };
  }
  dispose() { this.#off?.(); }
}
```

`@needs('events')` reaches `{ on }` — the same narrowing plugins already get. The `Bus` itself stays
out of the graph on purpose: a node that could reach it could also `emit`, and an observation
channel anything can write to is not one. `@needs('bus')` now fails saying that, and pointing at
what does work.

A plugin is still the right home for observation, because it gets `on` and `onShutdown` *together*.
This token gives the subscribe half alone — so a `@Provider` releases in `dispose()`, and a `@Step`
should not subscribe at all, since it runs per request and would add a listener each time.

:::caution[Reserved names]
`logger`, `rooms`, `events` and `bus` are reserved. Declaring one now **fails at boot**, where
before a provider called `logger` silently replaced the framework's own and every `@needs('logger')`
in the app got something that was not the logger core writes to. If your app declares one of these,
rename it — this is a change that can fail an app that boots today.
:::

→ [Reaching the bus](/docs/guides/observability/#reaching-the-bus)

## `@Sse` can tell the client where it got to

`EventSource` reconnects on its own — that is the reason to choose SSE over a raw WebSocket. What
it needs from the server is an id, and the encoder wrote exactly one field:

```
data: {"seq":41}
```

No `id:`, so the browser had nothing to send back, so every automatic reconnect rebuilt the route's
iterable from its beginning. **Everything produced during the gap was lost and nothing on either
side reported it** — the client saw a healthy connection and a continuous stream, and had simply
missed events. That is worse than not reconnecting at all: a failure that announces itself gets
handled.

```ts
@Sse('/rows')
rows(@header('last-event-id') from: string) {
  return (async function* () {
    for await (const row of readRows({ after: from })) yield sse(row, { id: row.seq });
  })();
}
```

The other half already worked, which was worth checking before designing anything: the request
envelope has always carried every header, so a handler could already read `Last-Event-ID`. It just
always arrived empty. `event:` and `retry:` come along for free — named events and a tunable
reconnect delay were both unreachable before.

**green-tea stores nothing.** No buffer, no retention window, no replay, and that is a line rather
than a gap. Replaying would need a stream identity that survives a disconnect — there is none, every
reconnect builds a new iterable — plus a retention policy no default gets right and an in-process
buffer that resumes from nothing the first time a reconnect lands on your second instance. What a
gap means is your handler's call, because only your source knows: a paged log re-reads from an
offset, a live ticker has no past worth delivering. Say which one you are in your own API docs.

An `id` containing a newline throws instead of being trimmed. The format is line-based, and an id is
exactly the value most likely to be built from a request — a cursor, a page token — so one newline
would let a caller append fields to somebody else's stream.

→ [Streaming](/docs/guides/streaming/#reconnection-and-the-id-it-needs)

## Your app boots in its longest chain, not the sum of it

Boot walked the dependency order one provider at a time. The graph already knew which of them
cannot constrain each other — that is what a topological sort *is* — and flattening it into a list
was the only thing throwing that away.

```
three providers, no edges between them, 200ms of work each

  before   616ms      the sum
  now      210ms      the critical path
```

With real providers those are a pool handshake, a schema check and a warm-up query that have nothing
to say to each other. Nothing you wrote changes, and nothing about the derived order changes: a
provider that `needs` another still waits for it, and a level is fully registered before the next
one starts.

This is the second thing the graph earns you, after pruning. An Express app cannot parallelize
`app.use` safely because nothing in it declares what is independent; we have that declaration and
were not spending it.

Two things to know if you watch boot closely. `boot:provider:start` no longer strictly alternates
with `:ok` — a level emits its starts together, then its results. And a **required** provider that
fails no longer stops its independent siblings from starting, since they are already in flight;
whatever they opened is registered for teardown before the boot aborts, so it can still be closed.
Teardown itself is unchanged and still the exact reverse of boot.

→ [Independent providers boot together](/docs/guides/dependency-injection/#independent-providers-boot-together)

## Stream events exist on more than one runtime now

`stream:open`, `stream:close` and `stream:error` were emitted by the Node adapter only. Every Fetch
runtime — Deno, Bun, workerd, and `app.fetch()` on Node — emitted none of them, and when a source
threw part-way it broke the response instead of writing the encoder's `error` frame.

Both halves were silent. A dashboard counting `stream:error` read zero on three of the four runtimes
while streams were failing normally, and the client got a truncated body that is indistinguishable
from a clean end of stream. If you have a stream gauge that looked suspiciously quiet off Node, this
is why.

The Fetch path now emits all three and frames the error before closing cleanly — which is what Node
always did, and the better answer for a client: a consumer that received an `error` event knows what
happened, where a dropped connection tells it nothing.

All three also carry the `requestId` and `traceId` of the request that opened the connection, plus a
bounded `route`. The docs had claimed the id since the stream shipped; it was never emitted. The
split is deliberate — `request:end` fires when the handler returns, so an hour-long SSE connection
never lands in the same latency distribution as a 2ms reply — but it only works if the two can be
**joined**, and without the id you could not say which request opened the connection still holding a
slot. A WebSocket upgrade correlates itself the same way, adopting your gateway's `x-request-id`
rather than opening a second identity, and carries `transport: 'ws'`.

→ [A stream is not a request](/docs/guides/observability/#a-stream-is-not-a-request)

## Smaller, but you may be waiting for them

- **A custom `@Transformer` can be typed.** `TransformerFn` was not exported, so the only way to
  annotate one was to borrow the type off a value with `typeof JsonTransformer`. Four more
  extension-point types came out of the same audit: `PluginApi`, `ScopeApi` and `ScopeNode` — the
  chain reached through `api.scope.add`, without which a plugin split into named functions cannot
  annotate what it receives — plus `Hooks` and `TeardownFn`.
- **A request's security and CORS headers are computed once**, where they used to be derived twice
  per request and three times for a preflight. Nothing was incorrect, but `cors.origins` may be a
  predicate with a network call in it, and running it two or three times charged your latency budget
  and your backend for an answer that had not changed in between. A predicate with a counter in it
  also stops counting double.
- **No per-request bookkeeping when no request budget is set.** Every request registered a `close`
  listener for `maxConcurrentRequests`, which is opt-in and unlimited by default — so most apps paid
  a closure and an event registration per request, on the hot path, for a feature that was off.
  Unchanged where a budget *is* configured.
- **Hitting `maxConnections` on Node says so.** The socket was destroyed with no HTTP response and
  nothing logged, which from the outside reads like a network fault. It now logs a warning naming
  the dropped peer, rate-limited to one a minute. Also contributed by
  [@hgshreyas](https://github.com/hgshreyas).

→ [Who built this release](/docs/contributors/)

## Where this is going

Not a roadmap — see [Honest scope](https://github.com/Expressive-Tea/green-tea#honest-scope) for what
is settled and what still moves. The short version: the graph is the settled part, the plugin API and
`createApp`'s options still grow, and mesh is alpha. The API freeze belongs to the release candidate.

The event stream's contract landed in this release, which was the last thing standing between the
observability work and something you could build an exporter against without reading the source.
Two of the three gaps named in that paragraph last release are closed above. What is still open and
worth knowing about: there is no metrics package outside core, so everyone writing an exporter still
writes the same eighty lines; and mesh remains alpha, with nothing moving in it this release.
