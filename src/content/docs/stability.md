---
title: API stability
description: "What the RC.1 freeze covers, what may change between RC.1 and stable, and how deprecations work after stable."
---

**From the first release candidate (RC.1), the public API of `@green-tea/core` is frozen.** The
public API is everything exported from the four entry points:

| Entry point | Import |
|---|---|
| root | `@green-tea/core` |
| Deno | `@green-tea/core/deno` |
| Bun | `@green-tea/core/bun` |
| edge | `@green-tea/core/edge` |

Anything you can import from one of those is covered. Anything you cannot import is internal,
whatever its file is called.

The freeze is there so that code written against RC.1 still compiles and behaves the same against
the first stable release. Nothing published in `26.9.0-beta.2` was removed to reach it: the one
rename, `Headers` → `RequestHeaders`, kept the old name as a deprecated alias, and the mesh exports
stayed exported and were marked `@experimental`. Moving from beta.2 to RC.1 still has breaking
changes, all of them behaviour fixed before the freeze; [What's new](/docs/whats-new/) lists each
one with its migration.

## RC.1 to stable: fixes only

No release between RC.1 and stable adds, removes, renames or narrows a public API. It does not
deprecate anything either.

If a fix turns out to need an API change, the freeze is reopened for it on purpose rather than
bent quietly, and the CHANGELOG lists the change under `### Breaking`. So the CHANGELOG is the one
place to check: a release candidate with no `### Breaking` section changed no public API.

## After stable: deprecations come before removals

Once a stable release has shipped, nothing public disappears without notice:

- A deprecated API keeps working for **at least two monthly releases**.
- It carries a JSDoc `@deprecated` tag that names its replacement, so your editor shows it where
  you use it.
- Where it has a runtime path, it **warns once per process** through `app.logger` — never
  `console`, so the warning goes wherever you sent the rest of the framework's diagnostics.
- It is removed only in a release whose CHANGELOG lists the removal under `### Breaking`.

A type has no runtime path, so a deprecated type warns only in your editor.

## Every API change shows up in review

The core repository commits an API report for each entry point under
[`api/`](https://github.com/Expressive-Tea/green-tea/tree/main/api) (`api/*.api.md`), and CI
fails when the build no longer matches it. A deliberate change regenerates the report in the same
pull request, so a reviewer reads the API change as a diff instead of finding it after the release.

## Mesh is outside the promise

[Mesh](/docs/guides/mesh/) is `@experimental` and gated behind `createApp({ experimental: true })`,
so it may change in any release, including between release candidates. Its exports — `MeshConfig`,
`connectLink`, the manifest and frame types, and the rest — are still in the API reports, so a mesh
change still shows up in review. The [createApp reference](/docs/reference/createapp/#importable-types)
marks which exported types are mesh.

## Currently deprecated

| Deprecated | Use instead | Since | Notes |
|---|---|---|---|
| `Headers` (type) | `RequestHeaders` | RC.1 | the same type, under a name that does not shadow the Fetch `Headers` global in the files that import it. `Headers` stays as an alias, so nothing breaks |

## What this page does not cover

The [matcha](/docs/guides/cli/) CLI ships from its own repository on its own version line, so
nothing here speaks for it.
