---
title: AI coding agents
description: "Point Claude Code, Codex, Cursor and other agents at the llms.txt that ships with green-tea."
---

green-tea is new, so a coding agent's training data says Express: `app.use`, `next()`, `req.user = …`.
None of that exists here. The fix is to give the agent green-tea's rules before it writes code, and
the framework ships them for you.

## What there is to read

| File | What it holds | Where |
|---|---|---|
| `llms.txt` (package) | The mental model, every decorator, built-in tokens, common mistakes. About 320 lines, written for models, matches the installed version. | `node_modules/@green-tea/core/llms.txt` |
| `llms-full.txt` (docs) | Every page of these docs as one file. | `https://green-tea.expressive-tea.io/docs/llms-full.txt` |
| `llms-small.txt` (docs) | The same, with non-essential content trimmed, for smaller context windows. | `https://green-tea.expressive-tea.io/docs/llms-small.txt` |
| `llms.txt` (docs) | An index of the files above, in the [llms.txt](https://llmstxt.org) format, for tools that look for it. | `https://green-tea.expressive-tea.io/docs/llms.txt` |

Start with the package file. It is short enough to keep in context permanently, and because it
comes from `node_modules` it always matches the version you installed. The docs files describe
the version these docs are for, which may be newer or older than yours.

## New projects: already done

`matcha new` writes an `AGENTS.md`, plus a `CLAUDE.md` that imports it, into every project. They
state the rules that differ from Express, point at `matcha routes|tokens|explain --json` for reading
the app, and link the `llms.txt` above. Most agents read `AGENTS.md` without being told to.

For a project that predates this, or one you started by hand:

```bash
matcha agents          # adds AGENTS.md and CLAUDE.md; --force overwrites existing ones
```

## Wiring it up by hand

**Claude Code.** In `CLAUDE.md`, an `@` path is imported into the context on every session:

```md
@node_modules/@green-tea/core/llms.txt
```

**Codex, OpenCode, Cursor, Copilot and others that read `AGENTS.md`.** Not every tool follows
imports, so tell the agent to read the file:

```md
Before writing green-tea code, read node_modules/@green-tea/core/llms.txt.
It matches the installed version and overrides what you know about Express-style frameworks.
```

**Deno (JSR).** There is no `node_modules`; link the copy on JSR for your version:

```md
https://jsr.io/@green-tea/core/26.11.0-rc.1/llms.txt
```

**Chat tools with no file access.** Paste the file in, or give it this URL if the tool can fetch:

```text
https://cdn.jsdelivr.net/npm/@green-tea/core@rc/llms.txt
```

Replace `rc` with your exact version to keep the answer in step with your install.

## Checking the agent's work

An agent that has read the rules still guesses. These catch the guess before it runs:

- `matcha doctor` finds the misconfigurations that fail confusingly, such as decorators not enabled.
- `createApp` validates the graph: a misspelled token or a missing producer throws at startup, with
  a suggestion, before any request is served.
- `matcha explain <route> --json` shows what a route actually runs, which is the quickest way to
  confirm the agent wired a step where it meant to.
