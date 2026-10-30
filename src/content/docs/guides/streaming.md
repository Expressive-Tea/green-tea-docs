---
title: Streaming & real-time
description: "SSE, ndjson, and WebSocket duplex from one AsyncIterable primitive."
---

Most stacks treat "push data over time" as a bolt-on: Express reaches for a `ws` or SSE library, Fastify for a plugin, NestJS for a separate **WebSocket Gateway** with its own adapter and decorators. That's a second mental model, a second error surface, glued to your HTTP app.

green-tea has one model: an **`AsyncIterable`**. A handler that returns a sequence of values over time *is* a stream — the same shape you'd return from any function. You **declare the mode** with a decorator; the framework handles framing, backpressure, cleanup, and disconnects.

## One primitive, three modes

| Declare | Direction | Transport | Reach for it when |
|---|---|---|---|
| `@Sse` | server → client | `text/event-stream` | live updates to a browser (`EventSource`) |
| `@Ws` | duplex | WebSocket | chat, collaboration — anything two-way |
| `@Stream` | negotiated | SSE / ndjson / WS, picked from the client's `Accept` / `Upgrade` | one handler, the client chooses |

The primitive never changes — it's always an `AsyncIterable`. What changes is **direction and framing**, and you declare which. That's the difference between each iterable green-tea hands you:

- **`@Sse`** — you return **one** iterable: the *outbound* stream. Each `yield` becomes an SSE event, or an ndjson line.
- **`@Ws` (duplex)** — **two** iterables. `@inbound()` gives you the client's *incoming* messages to consume; the one you **return** is the *outbound* stream to the client. `@abort()` hands you an `AbortSignal` for teardown.
- **`@Stream`** — you write the handler once; the client's request decides whether it arrives as SSE, ndjson, or a WebSocket. No branching in your code.

:::note
Streaming bypasses the response transformer — the transport frames each value directly, handles backpressure, and cleans up on disconnect. See [arguments](/docs/guides/arguments/) for the full list of argument decorators, including the stream-only `@inbound()` and `@abort()`.
:::

## Streaming — SSE

A route decorated `@Sse` streams — that's what triggers it, not the return value. It must return an `AsyncIterable`; the transport frames each value as an SSE event, handles backpressure, and cleans up on disconnect (the transformer is bypassed).

```typescript
import { Route, Sse } from '@green-tea/core';

@Route('/feed')
class FeedController {
  @Sse('/ticks')
  ticks() {
    return (async function* () {
      for (let n = 1; n <= 3; n++) yield { tick: n };
    })();
  }
}
// GET /feed/ticks  (Accept: text/event-stream)
//   data: {"tick":1}
//   data: {"tick":2}
//   data: {"tick":3}
```

`@Stream(path)` negotiates the transport by header (`Accept: text/event-stream` → SSE, `Upgrade: websocket` → WS, else ndjson chunked).

### Reconnection, and the `id:` it needs

`EventSource` reconnects on its own. That is the reason to pick SSE over a raw WebSocket, and it is
also the part that quietly loses data if the server never says where the client got to.

When it reconnects, the browser sends the last event id it saw as a `Last-Event-ID` request header.
Emit ids with `sse()`, read the header back with `@header('last-event-id')`, and the reconnect
resumes instead of restarting:

```typescript
import { Route, Sse, header, sse } from '@green-tea/core';

@Route('/feed')
class FeedController {
  @Sse('/rows')
  rows(@header('last-event-id') from: string) {
    return (async function* () {
      for await (const row of readRows({ after: from })) yield sse(row, { id: row.seq });
    })();
  }
}
//   id: 41
//   data: {"seq":"41","body":"…"}
```

`sse(data, fields)` takes three optional fields:

| Field | Wire | What it does |
|---|---|---|
| `id` | `id:` | the marker the browser echoes back as `Last-Event-ID` |
| `event` | `event:` | a named event — delivered to `addEventListener(name)` instead of `onmessage` |
| `retry` | `retry:` | reconnection delay in whole milliseconds; applies to the connection, not the event |

Yielding a plain value still writes a bare `data:` frame, exactly as before. On an `ndjson` route —
or a `@Stream` route where the client chose ndjson — the payload is unwrapped and the fields are
dropped, because NDJSON has no frame to carry them.

:::caution[An id built from a request must not contain a newline]
The SSE format is line-based, so a newline inside `id` would end the field and let the rest of the
value be read as further SSE fields — which is how a page token or cursor taken from a request turns
into arbitrary events in somebody else's stream. `sse()` throws rather than trimming it: an id
silently shortened is echoed back as `Last-Event-ID` and resumes from the wrong place, which is the
invisible failure the whole mechanism exists to prevent.
:::

### green-tea does not keep your events

There is no buffer, no retention window and no replay. green-tea carries the marker in both
directions and stores nothing; **what a gap means is your handler's decision**, because only your
source knows.

That is a deliberate line, not a missing feature. Replaying a gap would need a stream identity that
survives a disconnect — and there is none, since every reconnect is a new request that builds a new
iterable — plus a retention policy no default can get right (a ticker at 1000/s and an audit log at
one a minute want incompatible answers, and guessing too small loses data silently) and an
in-process buffer that would resume from nothing the moment a reconnect lands on your second
instance.

So decide which kind of source you have, and say so:

- **Resumable** — a paged log, a database cursor, a Kafka offset. Emit an `id` and re-read from it.
  This is usually cheaper and more correct than any buffer the framework could keep for you.
- **Not resumable** — a live sensor, a price ticker, a presence feed. There is no past worth
  delivering; the client reconnects and picks up the next value. Emit no `id`, and write that in
  your own API docs so a consumer does not assume otherwise.

### When a stream fails part-way

A source that throws mid-stream is reported the same way on every runtime: the framework writes the
encoder's error frame — `event: error` with the message, for SSE — and then closes the response
cleanly, and emits `stream:error` on the [bus](/docs/guides/observability/). A consumer that received
an `error` event knows what happened; a connection that merely dropped tells it nothing, which is why
the frame comes first.

### `ctx.ip` inside a stream body

`ctx.ip` is worked out the first time something reads it, not on every request. A stream body runs
after the response has started, when the socket the address would come from may already be gone, so
**inside a stream body `ctx.ip` is `''`** unless a step or the handler read it before returning the
stream. A route that needs the address in a stream reads it first, as rate-limit already does. See
[Runtimes](/docs/guides/runtimes/#the-client-address--ctxip) for what reading it costs.

## Streaming — WebSocket duplex

A WS handler receives the **inbound** channel and returns the **outbound** channel — a step that consumes one channel and produces another.

```typescript
import { Route, Ws, inbound, channel } from '@green-tea/core';

@Route('/chat')
class ChatController {
  @Ws('/echo')
  echo(@inbound() incoming: AsyncIterable<string>) {
    const out = channel<string>();
    (async () => {
      for await (const msg of incoming) out.push(`echo: ${msg}`);
      out.close();
    })();
    return out;
  }
}
```

`channel<T>()` is a multicast `AsyncIterable` with `push` / `close` / `fail` and an optional bounded buffer (`channel({ buffer: 100 })`, drop-oldest).

:::note[WebSocket needs the `ws` peer]
`@Ws` (and mesh) require the optional [`ws`](https://github.com/websockets/ws) peer dependency — `npm i ws`. SSE, ndjson, and plain HTTP need nothing extra.
:::

### Inbound limits

Every WebSocket connection has two bounds on what the client sends, set server-wide in
[`limits`](/docs/reference/createapp/#requestlimits):

| Limit | Default | Over it |
|---|---|---|
| `maxWsMessageBytes` | `1_048_576` (1 MiB) per message, in bytes (UTF-8 bytes for text); a fragmented message counts as a whole | the connection closes with `1009` (`message too large`) |
| `maxWsQueue` | `16` messages the handler has not read yet | the connection closes with `1013` (`inbound queue full`) |

```typescript
const app = createApp({
  modules: [ChatModule],
  limits: { maxWsMessageBytes: 256 * 1024, maxWsQueue: 64 },
});
```

Nothing is dropped silently: the client learns which bound it hit from the close code. Both values
must be positive integers, or `createApp` throws a `TypeError`. There is no per-route override, and
the bounds apply to every `@Ws` and `@Stream` WebSocket the server accepts. The mesh control channel
starts under tighter bounds and has its own larger ones once its peer authenticates; see
[mesh](/docs/guides/mesh/#keeping-the-control-channel-honest).

**The queue is per consumer.** Each iterator over `@inbound()` gets its own queue, receiving every
message from the moment it starts reading, and `maxWsQueue` applies to each one. A message that
would overflow any queue closes the connection without reaching the others. Messages that arrive
before anything reads (while providers boot, or before your loop starts) are held for the first
consumer. A consumer that stops iterating (`break`, `return`) is removed and no longer counts.

That first queue exists whether or not the handler reads it. A `@Ws` handler that never iterates
`@inbound()` is closed with `1013` when its client sends the 17th message at the defaults. Read the
channel, or raise `maxWsQueue`, if your protocol lets the client send without waiting for replies.

**How early a large message is refused depends on the runtime.** Node and Bun refuse it before
buffering it. Deno and the edge receive it in full and then close, so their memory is bounded by the
platform's own cap. Bun before 1.4 closes without a close frame, so its client sees `1006` instead
of `1009`; Bun 1.4 and later send `1009`. See [Runtimes](/docs/guides/runtimes/#websocket-message-size).

**Worst case.** Buffered inbound memory can reach about
`maxConnections × maxWsQueue × maxWsMessageBytes`. At the Node defaults that is
`1000 × 16 × 1 MiB` ≈ **15.6 GiB**, so lower one of the three before you expose a WebSocket
to untrusted clients. `maxConnections` is enforced only on Node. Deno, Bun and the edge have no
connection cap of their own, so set one at the platform or reverse proxy there.

:::caution[Breaking in RC.1]
Before these limits, Node accepted messages up to `ws`'s own default of 100 MiB, Deno, Bun and
the edge applied no cap, and the inbound queue was unbounded on every runtime. Now a message over
1 MiB closes with `1009`, and a connection holding 16 unread messages closes on the 17th with
`1013`. That includes a handler that never reads `@inbound()`: on Node those messages used to be
discarded, and now they count. If your clients send larger messages or bursts, raise
`maxWsMessageBytes` or `maxWsQueue`.
:::

### Outbound backpressure

The values a `@Ws` handler yields are pulled only as fast as the client reads them. Before each pull
the framework waits while the socket's send buffer is over 1 MiB, an internal mark rather than an
option, so a slow client holds at most about that plus one frame. A client that keeps up never makes
it wait. If the client goes away during the wait, the wait ends and the iterator's `return()` runs, as
on any other close.

Node, Bun and Deno each report their send buffer, so the wait works there. **workerd reports no
buffered amount, so on the edge the framework never waits** and buffering is left to the platform.

## Fan-out — `channel()` and `rooms`

Fan-out is a primitive too: `channel()` is a **multicast** `AsyncIterable` (bounded, drop-oldest) so one source feeds many subscribers, and `rooms` are named broadcast hubs — publish once, every connection in the room receives it.

```typescript
@Route('/live')
class Live {
  @Sse('/prices')                                   // one iterable out — each yield is an event
  prices() {
    return (async function* () {
      while (true) { yield { btc: await getPrice() }; await sleep(1000); }
    })();
  }

  @Ws('/echo')                                      // duplex — consume @inbound, return the outbound stream
  echo(@inbound() incoming: AsyncIterable<string>) {
    const out = channel<string>();
    (async () => { for await (const m of incoming) out.push(`echo: ${m}`); out.close(); })();
    return out;
  }
}
```

Same `@Route`, same handler shape, same `AsyncIterable` — real-time is not a separate framework you also have to learn.

`rooms` is the built-in shared `Rooms` primitive (one instance app-wide). A typical chat handler pumps the `@inbound()` channel into `rooms.room(name)` and returns that same room as its outbound channel, so every joined socket multicasts to the others. A handshake `@Step` can read `?token=` and throw `Unauthorized` — which closes the socket with code **4401** (`4000 + status`). See [security](/docs/guides/security/) for handshake authentication.

## Transport is declared, not inferred

A route streams **because** it's declared `@Sse`, `@Stream`, or `@Ws` — never because a handler happened to return an `AsyncIterable`. In most frameworks the return type decides the wire format; in green-tea the decorator decides, and the return value is enforced against it:

| Declare | Handler must return | Otherwise |
|---|---|---|
| `@Get` / `@Head` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Options` (buffered) | a value | returning an `AsyncIterable` fails with a 500 `TransportMismatchError` |
| `@Sse` / `@Ws` (streaming) | an `AsyncIterable` | returning a plain value fails with a 500 `TransportMismatchError` |
| `@Stream` (negotiate) | either | the client picks via `Accept` / `Upgrade` — no mismatch |

This is the anti-Express guarantee: your wire contract is what you **declared**, never a surprise sprung by a return value. A buffered route can't accidentally start streaming because someone returned a generator; a streaming route can't silently downgrade to a buffered response because someone forgot a `yield`. Declare `@Sse` / `@Stream` / `@Ws` to stream — the return value never changes a route's transport.
