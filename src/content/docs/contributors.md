---
title: Contributors
description: "Who has shipped code in green-tea, and what they built."
---

green-tea is one person's spare-time project that other people have started shipping into. This page
names them and what they built, because "thanks to our contributors" is worth nothing next to a
sentence someone can point at.

## In 26.9.0-beta.1

**[@hgshreyas](https://github.com/hgshreyas)** — [#23](https://github.com/Expressive-Tea/green-tea/pull/23),
a concurrency ceiling that works on all four runtimes rather than only Node. `limits.maxConnections`
could cap sockets but not work — a thousand cheap keep-alive connections and a thousand expensive
in-flight handlers are the same number to it — and it existed only on the `listen()` path.
`limits.maxConcurrentRequests` counts executing handlers instead, per server and per Fetch adapter,
and sheds with `503` + `Retry-After` rather than queueing.

The interesting part is what it deliberately does *not* count: a returned stream releases its slot
when the handler returns, not when the connection closes, so an SSE route does not sit on a budget
slot for hours. A follow-up in the same branch made a dropped connection on Node log a warning
instead of vanishing silently.

It arrived with [its own documentation pull request](https://github.com/Expressive-Tea/green-tea-docs/pull/8),
unprompted, which is the part worth naming.

## In 26.8.0-beta.1

**[@hgshreyas](https://github.com/hgshreyas)** — [#16](https://github.com/Expressive-Tea/green-tea/pull/16),
concurrent connection limits. Node's socket count was previously unbounded, which meant the framework
had no answer at all to the load it could not serve; `limits.maxConnections` is that answer. A
follow-up made non-positive values mean *unlimited* rather than *zero*, which is the reading anyone
setting `0` actually intends.

The design discussion on that one is worth reading if you are curious how decisions get made here:
the counting cannot live in the shared `app.fetch` path, because `app.fetch` is not on Node's
`listen()` route — a detail found in review rather than in the original issue.

**[@YxnnXriel](https://github.com/YxnnXriel)** — [#14](https://github.com/Expressive-Tea/green-tea/pull/14),
a timeout on `app.close()`. Before it, a single stuck handler could hold a deploy open indefinitely.
Everything this release added on top — an app-wide `shutdownTimeoutMs`, the bounded `close()` on the
Deno and Bun adapters, and the teardown budget — is built on the deadline that pull request
introduced.

## Also in flight

[@hgshreyas](https://github.com/hgshreyas) is working on
[#17](https://github.com/Expressive-Tea/green-tea/issues/17) — making a hit connection cap answer the
client instead of dropping the socket silently. The warning that shipped above is a step toward it,
not the whole thing: an operator can now see the drop, but the client still gets a closed socket
rather than a response.

## Contributing

Issues are assigned when someone claims them, so an unassigned open issue is genuinely free. The
[contributing guide](https://github.com/Expressive-Tea/green-tea/blob/main/CONTRIBUTING.md) covers
the branch model, the DCO sign-off every commit needs, and what CI will run.

Two things worth knowing before you start. The project holds itself to **one runtime dependency** —
`reflect-metadata`, and nothing else — so anything that would add a third belongs in a plugin. And a
change to public API needs a companion pull request to this documentation repository; nothing fails
when the code and these pages disagree, which is exactly why it is asked for rather than checked. If
you would rather not write the docs change, say so in your pull request and a maintainer will.
