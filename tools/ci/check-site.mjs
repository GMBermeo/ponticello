#!/usr/bin/env node
/**
 * The product site in docs/ has no build step, so nothing else notices when it
 * breaks. This checks what a broken deploy would show:
 *
 *     node tools/ci/check-site.mjs
 *
 * - every local file the page references (src, href, poster, srcset) exists;
 * - every image has alt text and every video an accessible name;
 * - the page has a title, a description and a link-preview image.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PAGE = process.argv[2] ?? 'docs/index.html';
const html = readFileSync(PAGE, 'utf8');
const failures = [];

const references = new Set();
for (const [, attr, value] of html.matchAll(/\s(src|href|poster|srcset|content)="([^"]+)"/g)) {
  for (const candidate of attr === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/)[0]) : [value]) {
    if (!candidate || /^(https?:|mailto:|#|data:)/.test(candidate)) continue;
    if (attr === 'content' && !candidate.startsWith('assets/')) continue;
    references.add(candidate.split(/[?#]/)[0]);
  }
}
for (const path of references) {
  if (!existsSync(join(dirname(PAGE), path))) failures.push(`missing file: docs/${path}`);
}

for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
  if (!/\salt="/.test(tag)) failures.push(`image without alt text: ${tag.slice(0, 90)}…`);
}
for (const [tag] of html.matchAll(/<video\b[^>]*>/g)) {
  if (!/\saria-label="[^"]+"/.test(tag)) failures.push(`video without an accessible name: ${tag.slice(0, 90)}…`);
}

if (!/<title>[^<]+<\/title>/.test(html)) failures.push('the page has no <title>');
if (!/<meta name="description" content="[^"]+"/.test(html)) failures.push('the page has no meta description');
if (!/<meta property="og:image" content="[^"]+"/.test(html)) failures.push('the page has no og:image');

if (failures.length) {
  console.error(`✗ ${PAGE}:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ ${PAGE}: ${references.size} local references resolve; images and videos are labelled.`);
