import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { documentsCoreVersion } from '../astro.config.mjs';

/**
 * The version banner, defaulted here rather than written into 25 files' frontmatter.
 *
 * Starlight takes `banner` per page, and repeating it per page is how it ends up saying three
 * different things. Defaulting it in the schema means every page carries it, a page can still
 * override it for a genuine announcement, and the version has exactly one source — the same
 * constant `npm run verify:release` checks against `package.json` and the release tag.
 *
 * It is on every page rather than only the landing page because most readers arrive from a search
 * result, and the question it answers — *does this match what I installed?* — is one they have no
 * other way to answer.
 */
const versionBanner = {
  content: `These docs describe <strong>@green-tea/core ${documentsCoreVersion}</strong> — <a href="https://github.com/Expressive-Tea/green-tea/blob/main/CHANGELOG.md">what changed</a>. Install with <code>npm i @green-tea/core@beta</code>.`,
};

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: (context) =>
      docsSchema()(context).extend({
        banner: z.object({ content: z.string() }).default(versionBanner),
      }),
  }),
};
