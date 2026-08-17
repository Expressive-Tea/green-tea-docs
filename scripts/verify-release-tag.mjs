// A docs release is a claim: "these pages describe @green-tea/core at this version". The claim is
// only worth anything if the tag, package.json and the version the site shows all say the same
// thing — three places that a hurried release is exactly the moment to let drift apart.
//
// Ported from the site repository's equivalent. It was deliberately skipped when this repository
// was created, because package.json had no `version` to check a tag against. It has one now, and
// the reason for skipping went with it.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertReleaseTag(tag, version) {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(`Release tag mismatch: expected ${expected}, received ${tag || 'an empty tag'}.`);
  }
}

/** The version the site tells a reader it documents, which must not be a third opinion. */
export function assertSiteVersion(configSource, version) {
  const match = /documentsCoreVersion\s*=\s*'([^']+)'/.exec(configSource);
  if (!match) throw new Error("astro.config.mjs no longer exports `documentsCoreVersion` — the site can no longer say which version of @green-tea/core it documents.");
  if (match[1] !== version)
    throw new Error(
      `Site version mismatch: astro.config.mjs says it documents ${match[1]}, package.json says ${version}.`,
    );
}

async function main() {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assertReleaseTag(process.env.RELEASE_TAG, version);
  assertSiteVersion(await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8'), version);
  console.log(`Verified docs release v${version} — tag, package.json and the site all agree.`);
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryUrl === import.meta.url) {
  await main();
}
