#!/usr/bin/env node
/**
 * The public repository must only ever carry the shareable library.
 *
 *     node tools/ci/check-shareable.mjs
 *
 * The full edition bundles study arrangements of copyrighted songs, built from
 * a personal, git-ignored `_MIDIS/` and `_CHORDS/`. It is for personal use and
 * must never be pushed. The easy way to push it by accident is to run
 * `npm run build:library` (full) and commit the regenerated files — so this
 * check fails the build unless the committed library is the free edition and
 * no personal source material or release binary is tracked.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const failures = [];

const edition = readFileSync('src/scores/libraryEdition.ts', 'utf8');
const id = /"id":\s*"(\w+)"/.exec(edition)?.[1];
const songCount = Number(/"songCount":\s*(\d+)/.exec(edition)?.[1]);
if (id !== 'free') {
  failures.push(`src/scores/libraryEdition.ts is the "${id}" edition. Run \`npm run build:library:free\` before committing.`);
}
if (songCount !== 0) {
  failures.push(`the committed library bundles ${songCount} arranged songs; the free edition bundles none.`);
}

// eslint-disable-next-line sonarjs/no-os-command-from-path -- git from PATH is the tool under check; this runs in CI and on a developer's machine, never with untrusted input
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const personal = tracked.filter((path) =>
  /^_MIDIS\//.test(path) || /^_CHORDS\//.test(path) || /^releases\//.test(path) || /\.(apk|aab|ipa)$/i.test(path));
if (personal.length) {
  failures.push(`personal or release files are tracked:\n    ${personal.slice(0, 10).join('\n    ')}`);
}

if (failures.length) {
  console.error('✗ Not shareable:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log(`✓ Shareable: free edition, no arranged songs, no personal sources or binaries among ${tracked.length} tracked files.`);
