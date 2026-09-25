#!/usr/bin/env node
/**
 * Render an SVG to a PNG on a transparent ground.
 *
 *     node tools/rasterize-svg.mjs <in.svg> <out.png> <width>
 *
 * Used by tools/make-icons.py: the master icon is hand-edited in a vector
 * editor, with drop-shadow filters and free-form paths that Pillow cannot
 * draw. resvg renders the whole of SVG 1.1 filters, so what ships is what the
 * editor showed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const [input, output, width] = process.argv.slice(2);
if (!input || !output || !width) {
  console.error('usage: rasterize-svg.mjs <in.svg> <out.png> <width>');
  process.exit(2);
}

const resvg = new Resvg(readFileSync(input, 'utf8'), {
  fitTo: { mode: 'width', value: Number(width) },
  background: 'rgba(0, 0, 0, 0)',
});
writeFileSync(output, resvg.render().asPng());
