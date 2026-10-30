import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

/**
 * The `@green-tea/core` release these pages describe.
 *
 * Exported and checked rather than written in prose: `npm run verify:release` fails if this, the
 * git tag and package.json disagree, so a docs release cannot claim to document a version it does
 * not. It is shown on every page because a reader arriving from a search result has no other way
 * to tell whether what they are reading matches what they installed.
 */
export const documentsCoreVersion = '26.9.0-beta.2';

// Docs site for @green-tea/core. Content lives in src/content/docs/**.
export default defineConfig({
  site: 'https://green-tea.expressive-tea.io',
  base: '/docs',
  integrations: [
    starlight({
      // GoatCounter — same site code as the marketing site, so /docs traffic lands in
      // the same dashboard and referrer paths stay comparable.
      head: [
        {
          tag: 'script',
          attrs: {
            'data-goatcounter': 'https://greentea.goatcounter.com/count',
            async: true,
            src: '//gc.zgo.at/count.js',
          },
        },
      ],
      // Let the content-backed 404.md own /404; otherwise Astro also injects a conflicting route.
      disable404Route: true,

      // /docs/llms.txt, /docs/llms-full.txt and /docs/llms-small.txt: the docs in the shape LLM
      // agents read. green-tea is new, so an agent has no training data to fall back on; these, and
      // the llms.txt that ships inside @green-tea/core, are what it learns the framework from.
      plugins: [
        starlightLlmsTxt({
          projectName: 'green-tea',
          description:
            'A TypeScript HTTP framework for Node 22+, Deno, Bun and Cloudflare Workers where the request pipeline is a dependency graph: providers and steps declare what they provide and need, handlers declare what they need in their signature, and the order is derived and validated at boot. It is not Express: there is no middleware chain, no next(), and no req/res mutation.',
          promote: ['getting-started', 'concepts/**', 'stability'],
          demote: ['contributors', 'whats-new', 'guides/mesh'],
          exclude: ['404'],
        }),
      ],

      title: 'Green Tea.',
      description: 'A zen, opinionated, type-safe framework — your API is a graph, not a chain.',
      logo: { src: './src/assets/logo.svg', alt: 'Green Tea' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/brand.css'],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', link: '/' },
            { label: 'Getting started', slug: 'getting-started' },
            // No version badge here on purpose: these docs describe one version, the banner already
            // names it, and a second copy of the number in the sidebar can only drift out of step —
            // which it did, sitting at beta.1 through the beta.2 deploy.
            { label: "What's new", slug: 'whats-new' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'The dependency graph', slug: 'concepts/the-graph' },
            { label: 'The typed flow core', slug: 'concepts/flow' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'The matcha CLI', slug: 'guides/cli' },
            { label: 'Routing', slug: 'guides/routing' },
            { label: 'Dependency injection', slug: 'guides/dependency-injection' },
            { label: 'Argument decorators', slug: 'guides/arguments' },
            { label: 'Validation', slug: 'guides/validation' },
            { label: 'Error handling', slug: 'guides/errors' },
            { label: 'Streaming & real-time', slug: 'guides/streaming' },
            { label: 'File uploads', slug: 'guides/uploads' },
            { label: 'HTML & views', slug: 'guides/html' },
            { label: 'Transport security', slug: 'guides/security' },
            { label: 'Plugins', slug: 'guides/plugins' },
            { label: 'Circuit breakers', slug: 'guides/circuit-breaker' },
            { label: 'Observability', slug: 'guides/observability' },
            { label: 'Graph introspection', slug: 'guides/introspection' },
            { label: 'OpenAPI', slug: 'guides/openapi' },
            { label: 'Runtimes', slug: 'guides/runtimes' },
            { label: 'Testing', slug: 'guides/testing' },
            { label: 'Mesh (alpha)', slug: 'guides/mesh', badge: { text: 'alpha', variant: 'caution' } },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Decorators', slug: 'reference/decorators' },
            { label: 'createApp options', slug: 'reference/createapp' },
          ],
        },
        {
          label: 'Project',
          items: [{ label: 'Contributors', slug: 'contributors' }],
        },
      ],
    }),
  ],
});
