---
title: Graph introspection
description: "The graph is data. Explain one route, walk the structure, or render it as Mermaid or DOT."
---

Because the request/boot pipeline is an explicit [dependency graph](/docs/concepts/the-graph/),
it is **data you can read** — not a chain you have to reconstruct by reading source files in
order. Everything on this page is a different projection of that same structure: a route
explanation, a plain object, a diagram.

Introspection answers *what will run*. For what actually ran on a given request, see
[observability](/docs/guides/observability/).

## Explain one route

`app.explain(route)` returns the exact execution chain for a single route — the ordered nodes,
each with its kind, origin, and declared `needs`/`provides`:

```typescript
const e = app.explain('/api/u/me');
// { pattern: '/api/u/me', method: 'GET', transport: 'buffer', chain: [...] }

console.log(e.chain.map((n) => `${n.kind}:${n.name}`));
// → ['step:user', 'handler:me']

console.log(e.chain[0]);
// → { name: 'user', kind: 'step', origin: 'module:M', needs: [], provides: ['user'] }
```

The chain is the transitive closure of the handler's `@needs` — the same set the framework
actually runs for that route, and nothing more. If a step you expected is missing, it is
missing because nothing on that route asked for it.

`origin` is what makes this useful in a large application: it tells you *which module* put a
node in the chain, so a surprising dependency traces back to the declaration that introduced
it rather than to a guess.

An unknown path throws rather than returning an empty chain:

```typescript
app.explain('/api/nope');  // Error: no route: /api/nope
```

## Walk the graph yourself

`app.graph()` returns the whole structure as a plain object. Use it when you want to query the
application rather than look at it — a test asserting that nothing outside `auth` provides
`user`, a script listing every route that touches the database, a custom renderer.

```typescript
const view = app.graph();
// view.nodes  → GraphNodeView[]  { name, kind: 'provider' | 'step', origin, needs, provides }
// view.routes → GraphRouteView[] { pattern, method, transport, chain: string[] }
```

Two things worth knowing before you assert against it:

- **The framework contributes its own nodes.** `logger` and `rooms` appear with
  `origin: 'builtin'` even in an application that declared neither. Filter on `origin` when you
  mean "the nodes I wrote".
- `routes[].chain` holds node **names**, while `explain()` returns the resolved nodes. Use
  `graph()` to survey, `explain()` to inspect.

## Render it

Two renderers, same graph, different destinations.

```typescript
console.log(app.toMermaid());  // flowchart, for a README or a docs page
console.log(app.toDOT());      // Graphviz DOT, for `dot -Tsvg` and large graphs
```

Prefer **Mermaid** when the diagram is going somewhere that renders it inline — GitHub,
Starlight, most wikis — with no toolchain involved. Prefer **DOT** when you want to control
the layout, export SVG or PDF, or when the graph has grown past what a flowchart renders
legibly; Graphviz handles hundreds of nodes that Mermaid will not.

Both are text. Committing the output and diffing it on a pull request is a cheap way to make
an unintended change to the pipeline visible.

## The dev endpoint

`devGraph: true` mounts `GET /__graph__`, which serves the same graph without a build step:

```typescript
const app = createApp({ modules: [ApiModule], devGraph: true });
// GET /__graph__                    → HTML viewer
// GET /__graph__  Accept: text/plain → raw Mermaid source
```

:::caution
`devGraph` exposes your application's structure — every provider, step and route — over HTTP,
unauthenticated. It is a development tool. Leave it off in production.
:::

For the machine-readable description of your **HTTP surface** rather than its internals, see
[OpenAPI](/docs/guides/openapi/), which projects the same graph into a spec.

## Degraded optional providers

`app.degraded()` returns the names of optional providers running in a **degraded** state — an
optional dependency that failed to initialize but did not abort boot.

```typescript
const down = app.degraded();  // → ['cache']
```

It is a health signal: surface it on a readiness endpoint so partial availability is something
you report rather than something a user discovers.

## Related

- [The graph](/docs/concepts/the-graph/) — why the pipeline is a graph at all.
- [Observability](/docs/guides/observability/) — what actually ran, per request, with timings.
- [OpenAPI](/docs/guides/openapi/) — the same structure projected as a spec.
- [Testing](/docs/guides/testing/) — `explain()` as an assertion about wiring.
