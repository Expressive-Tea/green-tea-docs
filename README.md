# green-tea-docs

The documentation site for [`@green-tea/core`](https://github.com/Expressive-Tea/green-tea) — an
[Astro](https://astro.build) + [Starlight](https://starlight.astro.build) site published at
**<https://green-tea.expressive-tea.io/docs>**.

It was split out of the core repository, with its history, so that a documentation change does not
run the framework's test matrix and a framework release does not wait on a docs typo.

> **Nothing here fails when these pages are wrong.**
> This repository imports nothing from `@green-tea/core`, so a guide can describe a decorator that
> was renamed, an option that was removed or a method that never shipped, and the build stays green.
> Code examples are prose, and prose does not get type-checked. **A change to public API in
> [green-tea](https://github.com/Expressive-Tea/green-tea) updates the page documenting it, in the
> same pull request.** That is a rule, not a check — no check exists yet. Issue #18 is what a stale
> page looks like from a reader's side, and it happened while both still lived in one repository.

## Running it

```bash
npm ci
npm run dev      # local server with hot reload
npm run build    # static build into dist/
npm run preview  # serve the built site
```

Node 18+ and nothing else — the site has no dependency on the framework it documents.

## Where things live

| Path | What |
|---|---|
| `src/content/docs/` | every page, as Markdown/MDX |
| `astro.config.mjs` | site URL, base path, and the sidebar — a new page must be added to the sidebar here |
| `src/styles/brand.css` | the brand overrides on top of Starlight's defaults |
| `src/assets/`, `public/` | logo and favicon |

The site is served under `/docs`, not at the domain root: `base: '/docs'` in `astro.config.mjs`. The
root is the marketing site, which lives in its own repository.

## Releasing

Deployment is deliberately manual — cPanel has no API here, and a docs site does not change often
enough to justify pretending otherwise. CI produces the artifact; a person uploads it.

**This repository's version is the `@green-tea/core` release it documents**, not a version of its
own. `26.8.0-beta.1` here means *these pages describe core 26.8.0-beta.1* — so cutting a docs release
is a claim that everything in that core release is documented, and the two move together.

Three places have to agree before a release is allowed: the git tag, `package.json`, and the version
the site prints in a banner on every page (`documentsCoreVersion` in `astro.config.mjs`).
`npm run verify:release` fails when they do not, and the release workflow runs it first.

```bash
# after bumping package.json and documentsCoreVersion to match the core release
git tag v26.8.0-beta.1 && git push origin v26.8.0-beta.1
```

That runs `.github/workflows/release.yml`, which verifies the three agree, builds the site, and attaches
`green-tea-docs-v26.8.0-beta.1.tar.gz` to a GitHub release. Download it, then unpack it into the `/docs`
directory of the cPanel docroot.

The archive is taken from *inside* `dist/`, so it unpacks as the directory's contents rather than as
a wrapping folder — `index.html` lands at `/docs/index.html`.

There is no `.htaccess` here on purpose. The domain root's own `.htaccess`, owned by the marketing
site, already applies to `/docs`: HTTPS redirect and cache headers are inherited rather than
restated, so the two sites cannot drift into contradicting each other.

Every push and pull request to `main` runs `.github/workflows/ci.yml`, which builds the site and
audits dependencies. A tag is only worth cutting once that is green.

## License

MIT, the same as the framework — see [LICENSE](./LICENSE). These pages were part of the core
repository until the split, so the licence follows them rather than starting over.
