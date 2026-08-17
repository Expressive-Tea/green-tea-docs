---
title: Contributors
description: "Who has shipped code in green-tea, and what they built."
---

green-tea is one person's spare-time project that other people have started shipping into. This page
names them and what they built, because "thanks to our contributors" is worth nothing next to a
sentence someone can point at.

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
[#17](https://github.com/Expressive-Tea/green-tea/issues/17) and
[#21](https://github.com/Expressive-Tea/green-tea/issues/21) — making a hit connection cap answer
the client instead of dropping the socket silently, and a concurrency ceiling that works across all
four runtimes rather than only Node.

## Contributing

Issues are assigned when someone claims them, so an unassigned open issue is genuinely free. The
[contributing guide](https://github.com/Expressive-Tea/green-tea/blob/main/CONTRIBUTING.md) covers
the branch model, the DCO sign-off every commit needs, and what CI will run.

Two things worth knowing before you start. The project holds itself to **one runtime dependency** —
`reflect-metadata`, and nothing else — so anything that would add a third belongs in a plugin. And a
change to public API needs a companion pull request to this documentation repository; nothing fails
when the code and these pages disagree, which is exactly why it is asked for rather than checked. If
you would rather not write the docs change, say so in your pull request and a maintainer will.
