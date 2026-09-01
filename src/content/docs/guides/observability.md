---
title: Observability
description: A correlated lifecycle event stream, an injectable logger, and where exporters go.
---

green-tea does not integrate with an observability vendor. It emits a **correlated event stream** and
lets you read it. A logger, a metrics exporter and a tracing bridge are three consumers of that one
stream — not three features, which is why they are one design.

The rule that shapes all of it: core has one runtime dependency, `reflect-metadata`, and keeps it.
Nothing here imports an exporter.

This is the runtime half of a pair. [Graph introspection](/docs/guides/introspection/) answers *what
will run* for a route, before a request exists; the event stream answers *what did run*, for one
request that happened. A chain from `explain()` that does not match the events you observe is the
gap worth looking at.

## Correlation

Every request gets an id. Every event it causes carries that id.

```ts
app.bus.on('request:step:leave', (event) => {
  event.requestId; // "9f0c…" — the same value on every event of this request
  event.route;     // "/users/:id" — the pattern, never the concrete path
  event.durationMs; // how long this step took
});
```

Without that id the stream is unusable under any concurrency: two requests interleave their step
events and nothing tells you which is which.

**An incoming `x-request-id` is adopted, not replaced.** A service behind a gateway must not open a
second identity for a request that already has one.

**A `traceparent` header is carried through untouched** as `traceId`. Core parses nothing and
implements no propagation spec — W3C Trace Context belongs to the exporter that understands it.

**The identity survives a mesh hop.** A request resolved from a remote teapot carries its
`requestId` and `traceId` across the wire, and the teapot adopts them rather than opening its own —
so the far side's events join the same trace instead of starting a second investigation. See
[Mesh](/docs/guides/mesh/), which is still alpha.

### `route` is the pattern, always

`route` is `/users/:id`, never `/users/42`. This is a contract, not an implementation detail: a
metrics consumer that labels a counter with the concrete path gets one label per distinct URL, and
unbounded label cardinality takes down the metrics backend rather than the application.

## Reaching the bus

Three doors, and which one you want depends on what you have.

```ts
app.bus.on('request:end', (e) => count(e.route));            // you own the app
```

```ts
const metrics: Plugin = (api) => {                            // you are extending someone's app
  api.bus.on('request:end', (e) => count(e.route));
  api.onShutdown(() => flush());
};
```

```ts
@Provider({ provides: 'collector', needs: ['events'] })       // you are inside the graph
class Collector {
  #off?: () => void;
  provide(ctx: { events: Events }) {
    this.#off = ctx.events.on('request:end', (e) => count(e.route));
    return { collector: registry };
  }
  dispose() { this.#off?.(); }
}
```

**A plugin is the right home for observation**, and the reason is the pairing: `bus.on` arrives
next to `onShutdown`, so whatever it subscribes to it can also release. `@needs('events')` exists
for the case where you are already a node and reaching for a plugin would be a detour — it gives
you the subscribe half alone, so `on()` hands back its own unsubscribe and a provider is expected
to call it in `dispose()`.

:::caution[Subscribe once, not per request]
A `@Provider` runs once, so subscribing there is fine. A **`@Step` runs on every request**, and one
that calls `on()` adds a listener each time — an unbounded leak that looks exactly like using any
other injected dependency. If a step is where you noticed you needed events, a plugin is what you
actually wanted.
:::

### `emit` is nobody's

`app.bus` carries `emit` because the application that owns the app owns its event stream. Nothing
else does: a plugin gets `{ on }`, `@needs('events')` gets `{ on }`, and `@needs('bus')` fails at
boot rather than resolving.

That is not an oversight to be fixed later. A node that could emit could forge any lifecycle event,
and an observation channel anything can write to is not one — the numbers coming off it stop being
evidence. `bus` is also a reserved token name, so nothing you declare can quietly become what
`@needs('bus')` resolves to.

## The events

| Event | When |
|---|---|
| `request:start` / `request:end` | a request enters and leaves the handler |
| `request:failed` | the request produced an error |
| `route:matched` / `route:unmatched` | a route matched, or none did (covers **404 and 405**) |
| `request:step:enter` / `:leave` / `:error` | one step of the pipeline |
| `boot:provider:start` / `:ok` / `:fail` | a provider booting |
| `stream:open` / `:close` / `:error` | an SSE, ndjson or WebSocket connection |
| `mesh:connect` / `:disconnect` / `:rpc:error` | mesh links |
| `mesh:boot:retry` | a teapot that has not come up yet, still inside the boot grace ([mesh](/docs/guides/mesh/)) |
| `plugin:mounted` | a plugin registered |

### Where a streaming request ends

`request:end` fires **when the handler returns**, not when a stream it produced finishes.

A streaming route returns in milliseconds while its connection may live for hours. Ending the
request span at stream close would put hour-long SSE connections and 2 ms buffered replies in one
latency distribution, ruining both. The connection is described by `stream:open` / `stream:close`,
which carry the same `requestId` — so you can join the two yourself, and you get a meaningful
latency histogram either way.

### Streams do not emit per message

Lifecycle only. A per-message event on a high-rate stream is a firehose that costs more than it
reports, and the cost lands on the workload least able to absorb it. Instrument your own handler if
you need it, where you know what the messages mean.

## The logger

```ts
const app = createApp({ modules: [AppModule], logger: myLogger });
```

Any object with `debug`, `info`, `warn` and `error` — each taking a message and optional structured
fields. Bridging `pino` or `winston` is a few lines in either direction; core defines the shape it
needs rather than adopting anyone's.

Given none, the default writes structured JSON, or a human-readable line when the process is
attached to a TTY — decided once at boot, not per record.

**Nothing in core writes to `console`.** That is enforced by a lint rule, not by good intentions, so
every framework diagnostic is redirectable.

The logger is also injectable:

```ts
@Step({ provides: 'user', needs: ['db'] })
class LoadUser {
  run(@needs('logger') log: Logger) { … }
}
```

Same object, two access paths. It is registered rather than declared as a provider because it has to
outlive the graph on both ends: a provider cannot report its own boot failing, and shutdown warnings
happen after the graph is gone.

## Request logging

Off by default. A framework that writes to stdout uninvited is one you have to configure before you
can use it.

```ts
createApp({ modules: [AppModule], logRequests: true });
```

It is an ordinary subscriber, so you can do it by hand and take it back:

```ts
import { logRequests } from '@green-tea/core';

const stop = logRequests(app.bus, app.logger);
stop(); // removable, not merely optional
```

A logger that throws does **not** silently stop writing: the subscriber is wrapped so failures fall
back to `console`. `Bus.emit` isolates listener failures by design — an observer must never break a
request — and the wrapper keeps that guarantee without paying for it in silence.

## The names you can import

Everything above works untyped; these exist for when you want the types written down.

| Export | What it is |
|---|---|
| `Logger` | the four-method shape `createApp({ logger })` accepts |
| `LogLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` |
| `LogFields` | the optional structured second argument |
| `createDefaultLogger(pretty?)` | builds the built-in logger; pass `true`/`false` to force JSON or human-readable instead of letting it detect a TTY |
| `withConsoleFallback(logger)` | wraps a logger so a throw inside it falls back to `console` rather than vanishing |
| `LifecycleEvent` | the union of every event name in the table above |
| `EventPayload` | the shape a subscriber receives |
| `Correlation` | the request-identifying subset spread into each event |
| `Events` | the read-only `{ on }` slice `@needs('events')` provides |
| `UNMATCHED_ROUTE` | the `route` value carried when nothing matched — compare against this instead of hardcoding `'<unmatched>'` |

`withConsoleFallback` is worth knowing about if you pass your own logger. A logger that throws while
reporting a failure is the worst moment to lose output, and core cannot catch that for you without
also swallowing the errors you asked it to report:

```ts
import { withConsoleFallback } from '@green-tea/core';

const app = createApp({ modules: [AppModule], logger: withConsoleFallback(myLogger) });
```

## Related

- [Graph introspection](/docs/guides/introspection/) — the same pipeline, read before it runs.
- [Errors](/docs/guides/errors/) — what a thrown error becomes on the wire, and in the stream.
- [Testing](/docs/guides/testing/) — asserting on events instead of on log output.

## Metrics and tracing

There is no metrics registry in core and no OpenTelemetry exporter in core. Both read the stream
above from outside:

```ts
app.bus.on('request:end', (e) => histogram.observe(e.durationMs, { route: e.route, status: e.status }));
```

### Count `request:end`, and nothing else

One request that throws emits **three** events — `request:start`, `request:failed`, `request:end` —
all carrying the same `requestId`. A 404 emits two: `route:unmatched` and the `request:end` that
follows. The first exporter anyone writes counts the failure twice, and it fails silently: the
metrics simply lie.

| Event | What it means | What to build on it |
|---|---|---|
| `request:end` | terminal and universal, for every request shape, and the only one carrying the status the client received | the request counter and the latency histogram |
| `request:failed` | *handler code threw* — which no status expresses, since a rendered `422` is also a throw | a separate error counter |
| `route:unmatched` | *no route ran*, covering 404 and 405 | a separate counter, if you want one |

`request:failed` and `route:unmatched` are **additional** to `request:end`, not alternatives to it.

`route:unmatched` is also not a synonym for failure: a file served by `createApp({ static })`
matched no route either, and answers `200`. Read the status from `request:end`, like everything
else.

### Label on `route`, never on `name`

`name` is for a human reading a log line, and on the request events it carries the path that
arrived. That is fine in a log and disastrous as a metric label: a matched path is bounded by your
route table, an **unmatched** one is bounded by nothing at all, and a scanner walking `/aaa`,
`/aab`, `/aac` becomes one label per distinct URL — a memory leak with a metrics backend attached.

`route` is bounded by construction. When nothing matched it is `'<unmatched>'`, exported as
`UNMATCHED_ROUTE`, so every path that was never a route collapses into one series instead of a
fallback you have to invent.

```ts
app.bus.on('request:end', (e) => counter.inc({ route: e.route, status: e.status }));  // bounded
app.bus.on('request:end', (e) => counter.inc({ route: e.name }));                     // do not
```

Per-step timings are already on the events, so a per-node timing breakdown needs no extra
instrumentation — the graph already knows every node.

## What it costs

**About 0.29 µs per request** — roughly **7% of the framework's own work**, or **~2% of a request
measured over a real socket**, where the transport dominates.

The cost is **per request, not per step**. Per-step timing and payload construction are skipped
entirely when nothing is subscribed, so a deep pipeline pays no more than a shallow one. What
remains is fixed: generating the request id, reading two headers, and the checks that decide
whether anyone is listening.

Absolute throughput numbers are deliberately not quoted here. The figure above comes from an
interleaved A/B — alternating both versions round by round — because the same code measured at the
start and end of one session on the same machine differed by 12% as it warmed up. Any before/after
that does not interleave is measuring the clock as much as the code.
