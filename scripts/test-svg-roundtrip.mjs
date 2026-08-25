// End-to-end check that "Export SVG" round-trips back to .vsdx: parse a real
// .vsdx, render a page to SVG (jsdom), serialize it, embed the source bytes
// as base64 metadata (svg-vsdx-embed), then extract them again and assert the
// recovered bytes are identical and still parse to the same document.

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

// The src/ modules are ESM but the package is commonjs; copy them into a tmp
// "type: module" dir (same trick as test-diff-view.mjs).
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-svgroundtrip-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');
const copy = (src, dst, reps = []) => {
  let code = readFileSync(src, 'utf8');
  for (const [a, b] of reps) code = code.replace(a, b);
  writeFileSync(join(tmp, dst), code);
};
copy('src/shape-inheritance.js', 'shape-inheritance.mjs');
copy('src/parse-progress.js', 'parse-progress.mjs');
copy('src/svg-renderer.js', 'svg-renderer.mjs');
copy('src/svg-vsdx-embed.js', 'svg-vsdx-embed.mjs');
copy('src/vsdx-parser.js', 'vsdx-parser.mjs', [
  [/from '\.\/shape-inheritance\.js'/g, "from './shape-inheritance.mjs'"],
  [/from '\.\/parse-progress\.js'/g, "from './parse-progress.mjs'"],
  [/from '\.\/svg-renderer\.js'/g, "from './svg-renderer.mjs'"],
]);
const imp = (n) => import(pathToFileURL(join(tmp, n)).href);
const { parseVsdx } = await imp('vsdx-parser.mjs');
const { renderPage } = await imp('svg-renderer.mjs');
const { embedVsdxInSvg, extractVsdxFromSvg } = await imp('svg-vsdx-embed.mjs');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
const original = new Uint8Array(readFileSync(fixture));

console.log(`── svg export round-trip: ${fixture} ──`);

// 1. Parse and render page 1 to an SVG string, as btn-export does.
const parsed = await parseVsdx(original.buffer);
const container = document.createElement('div');
renderPage(parsed.pages[0], container);
const svgEl = container.querySelector('svg');
check('page renders to an <svg>', !!svgEl);
const plainSvg = new XMLSerializer().serializeToString(svgEl);

// 2. Plain SVG carries no embedded document.
check('plain export has no embedded document', extractVsdxFromSvg(plainSvg) === null);

// 3. Embed and extract.
const name = 'testraum & <friends>.vsdx';
const embeddedSvg = embedVsdxInSvg(plainSvg, original, name);
check('embedded SVG still starts with the svg element', /<svg[\s>]/.test(embeddedSvg));
const recovered = extractVsdxFromSvg(embeddedSvg);
check('embedded document extracted', !!recovered);
check('file name survives (incl. XML escaping)', recovered.name === name, recovered.name);
check(
  'recovered bytes are identical to the source',
  recovered.buffer.length === original.length &&
    recovered.buffer.every((b, i) => b === original[i]),
  `len ${recovered.buffer.length} vs ${original.length}`
);

// 4. The recovered bytes still parse to the same document.
const reparsed = await parseVsdx(recovered.buffer.slice().buffer);
check('re-parsed page count matches', reparsed.pages.length === parsed.pages.length,
  `${reparsed.pages.length} vs ${parsed.pages.length}`);
const shapeCount = (p) => (p.shapes || []).length;
check('re-parsed shape count on page 1 matches',
  shapeCount(reparsed.pages[0]) === shapeCount(parsed.pages[0]));

// 5. The embedded SVG still parses as valid XML with the drawing intact.
const embDoc = new DOMParser().parseFromString(embeddedSvg, 'image/svg+xml');
check('embedded SVG is valid XML', !embDoc.querySelector('parsererror'));
check('metadata element present in DOM',
  !!embDoc.querySelector('metadata#vsdxeditor-source, metadata[id="vsdxeditor-source"]'));

// 6. Re-embedding replaces the old payload instead of stacking a second one.
const other = new Uint8Array([1, 2, 3, 4, 5]);
const reEmbedded = embedVsdxInSvg(embeddedSvg, other, 'other.vsdx');
const matches = reEmbedded.match(/vsdxeditor-source/g) || [];
check('re-embed keeps a single metadata block', matches.length === 1, `count=${matches.length}`);
const recovered2 = extractVsdxFromSvg(reEmbedded);
check('re-embed returns the new payload',
  recovered2.buffer.length === 5 && recovered2.name === 'other.vsdx');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
