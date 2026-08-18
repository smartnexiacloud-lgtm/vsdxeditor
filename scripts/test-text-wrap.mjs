// Where the renderer breaks a shape's text into lines.
//
// The reference values are a Microsoft Visio 16 SVG export of a 1:50 floor
// plan, read back out of its markup — Visio starts a line at every tspan
// carrying a dy shift, so the export says exactly where it broke:
//
//   <text …>Podest-<tspan dy="1.2em">höhe</tspan>: <tspan dy="1.2em">600</tspan>mm</text>
//
// Two rules the old wrapper did not have come out of that file:
//
//   * text wraps inside the text block *less its 4pt margins*, not the whole
//     block, which is why a 10mm-wide box holds far less than its width says;
//   * a word with nowhere to break is broken anyway — at a hyphen if it has
//     one, otherwise mid-word, down to one character per line.
//
// The shapes below carry the real numbers of four shapes in that drawing, so a
// change that puts the breaks somewhere else is a change away from Visio.

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-textwrap-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');
const copy = (src, dst) => writeFileSync(join(tmp, dst), readFileSync(src, 'utf8'));
copy('src/shape-inheritance.js', 'shape-inheritance.mjs');
copy('src/svg-renderer.js', 'svg-renderer.mjs');
const { renderPage } = await import(pathToFileURL(join(tmp, 'svg-renderer.mjs')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

// A text-only shape: no geometry, so the only thing the renderer emits is the
// text block we are measuring.
function textShape(id, text, overrides = {}) {
  const width = overrides.width ?? 1;
  const height = overrides.height ?? 1;
  return {
    id,
    type: 'Shape',
    text,
    width,
    height,
    pinX: width / 2,
    pinY: height / 2,
    locPinX: width / 2,
    locPinY: height / 2,
    angle: 0,
    fontFamily: 'Calibri',
    fontSize: 12 / 72,
    horzAlign: 1,
    vertAlign: 1,
    layerMembers: [],
    subShapes: [],
    hasGeometry: false,
    geometry: [],
    ...overrides
  };
}

function linesOf(shape, drawingScale = 1) {
  const page = {
    id: '1', name: 'P', width: 200, height: 200, drawingScale, shapes: [shape], layers: []
  };
  const container = document.createElement('div');
  renderPage(page, container);
  const text = container.querySelector(`#shape${shape.id} text`);
  if (!text) return [];
  const tspans = text.querySelectorAll('tspan');
  return tspans.length
    ? [...tspans].map(t => t.textContent)
    : [text.textContent];
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('── renderer: text wrapping against a Visio export ──');

// The drawing is 1:50, so a shape 19.685 drawing-inches wide is 10mm on paper
// and the 6pt text in it is 6pt on paper. Both the block and the font are
// scaled by 50 in the emitted coordinates, and the 4pt margins have to be
// scaled with them or the usable width comes out 20% too generous.
const SCALE = 50;
const PT6 = 6 / 72;

// 1. A word broken at its hyphen. Visio: "Podest-" / "höhe:" / "600mm".
{
  const lines = linesOf(textShape('podest', 'Podest-höhe: 600mm', {
    width: 19.68503149625741, height: 48.20020893859146, fontSize: PT6
  }), SCALE);
  check('a hyphen is a place to break', eq(lines, ['Podest-', 'höhe:', '600mm']), JSON.stringify(lines));
}

// 2. Nowhere to break and no room either: Visio fills a 4mm-wide box with
//    "Schalter BSK" one letter per line.
{
  const lines = linesOf(textShape('schalter', 'Schalter BSK', {
    width: 7.874015748031525, height: 38.58267716535465, fontSize: PT6
  }), SCALE);
  check('a word with no room is broken mid-word',
    eq(lines, ['S', 'c', 'h', 'a', 'l', 't', 'e', 'r', 'B', 'S', 'K']), JSON.stringify(lines));
}

// 3. The other half of the same evidence: Visio left these on one line, and a
//    measurement that reads too wide would break them.
{
  const label = linesOf(textShape('label', 'B1400xT895', {
    width: 44.86799440231346, height: 7.874015748031567, fontSize: 10 / 72
  }), SCALE);
  check('a label that fits is left alone', eq(label, ['B1400xT895']), JSON.stringify(label));

  const bacs = linesOf(textShape('bacs', 'BACS', {
    width: 19.56228531360466, height: 11.4960629921261, fontSize: 8 / 72
  }), SCALE);
  check('and so is a short one in a small box', eq(bacs, ['BACS']), JSON.stringify(bacs));
}

// 4. Ordinary word wrap, unscaled: a 12pt line in a 2.46in block holds about
//    thirty characters, so this is three lines and not two.
{
  const lines = linesOf(textShape('para',
    'Shape for context filter: The scenario is {{scenario}} and this file was created on {{date}}',
    { width: 0.984251968503937, height: 0.5, txtWidth: 2.460629921259843, fontSize: 12 / 72 }));
  check('long text wraps to as many lines as it needs', lines.length === 3, JSON.stringify(lines));
  check('and breaks at spaces while it can',
    lines.every(line => !/\S-$/.test(line)) && lines.join(' ').includes('scenario is'),
    JSON.stringify(lines));
}

// 5. Line breaks the file already carries are kept, and each of them wraps on
//    its own — a paragraph that is too wide is not exempt because it was typed
//    as its own line.
{
  const lines = linesOf(textShape('explicit', 'Podest-höhe:\n600mm', {
    width: 19.68503149625741, height: 48.20020893859146, fontSize: PT6
  }), SCALE);
  check('an explicit break is honoured and still wraps',
    eq(lines, ['Podest-', 'höhe:', '600mm']), JSON.stringify(lines));
}

// 6. No usable width is not a licence to guess: a shape whose text block is
//    narrower than its own margins keeps its text on one line rather than
//    shredding it a character at a time.
{
  const lines = linesOf(textShape('tiny', 'Schalter', { width: 0.05, height: 0.05, fontSize: PT6 }));
  check('a block with no room left inside it does not wrap', eq(lines, ['Schalter']), JSON.stringify(lines));

  const unsized = linesOf(textShape('unsized', 'Schalter BSK', { width: 0, height: 0, fontSize: PT6 }));
  check('nor does one with no width at all', eq(unsized, ['Schalter BSK']), JSON.stringify(unsized));
}

// 7. The measurement follows the font. Arial is wider than Calibri at the same
//    size, and a string that just fits in one has to break in the other.
{
  const box = { width: 1.18, height: 0.4, fontSize: 12 / 72 };
  const calibri = linesOf(textShape('cal', 'immerhin dann', { ...box, fontFamily: 'Calibri' }));
  const arial = linesOf(textShape('ari', 'immerhin dann', { ...box, fontFamily: 'Arial' }));
  check('Calibri fits what Arial does not',
    calibri.length === 1 && arial.length === 2, `${JSON.stringify(calibri)} vs ${JSON.stringify(arial)}`);
}

console.log(`\ntext-wrap: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
