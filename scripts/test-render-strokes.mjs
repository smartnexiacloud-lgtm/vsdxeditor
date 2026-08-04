// Renderer checks for the three things a scaled Visio drawing (a 1:100 floor
// plan) exposed: hairlines disappearing, hatch fills painted as solid blocks,
// and dashed line patterns coming out solid.
//
// The reference values come from a Microsoft Visio 16 SVG export of such a
// drawing: LineWeight 0 exports at 0.25pt, FillPattern 4 exports as a 6pt tile
// holding an X of 0.75pt strokes, LinePattern 2 exports as "1.75,1.25" at width
// 0.25 (7:5 in line weights) and LinePattern 23 as "0.24,0.48" (1:2).

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-strokes-'));
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
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// A 1-inch square outline, as the parser hands geometry to the renderer.
const squareRows = [
  { type: 'MoveTo', x: 0, y: 0 },
  { type: 'LineTo', x: 1, y: 0 },
  { type: 'LineTo', x: 1, y: 1 },
  { type: 'LineTo', x: 0, y: 1 },
  { type: 'LineTo', x: 0, y: 0 }
];

function shape(id, overrides = {}) {
  return {
    id,
    type: 'Shape',
    width: 1,
    height: 1,
    pinX: 1,
    pinY: 1,
    locPinX: 0.5,
    locPinY: 0.5,
    angle: 0,
    lineWeight: 0,
    linePattern: 1,
    fillPattern: 0,
    lineColor: '#000000',
    fillForeground: '#000000',
    fillBackground: '#ffffff',
    layerMembers: [],
    subShapes: [],
    hasGeometry: true,
    geometry: [{ rows: squareRows, noFill: false, noLine: false, noShow: false }],
    ...overrides
  };
}

function render(shapes, { drawingScale = 1, options = undefined } = {}) {
  const page = { id: '1', name: 'P', width: 10, height: 10, drawingScale, shapes, layers: [] };
  const container = document.createElement('div');
  renderPage(page, container, options);
  return container.querySelector('svg');
}

const strokeOf = (svg, id) => parseFloat(svg.querySelector(`#shape${id} path`).getAttribute('stroke-width'));
const pathOf = (svg, id) => svg.querySelector(`#shape${id} path`);

console.log('── renderer: hairlines, hatch fills, line patterns ──');

// 1. Hairlines. Visio's LineWeight 0 means "thinnest the device can draw" and
// its own export uses 0.25pt; on a 1:100 drawing the coordinate space is 100×
// bigger, so the emitted width has to grow with it or the line vanishes.
const HAIRLINE_UNSCALED = 96 * 0.25 / 72; // 0.25pt in our 96-per-inch space
{
  const plain = render([shape('a')]);
  check('unscaled hairline is 0.25pt', near(strokeOf(plain, 'a'), HAIRLINE_UNSCALED),
    `got ${strokeOf(plain, 'a')}`);

  const scaled = render([shape('b')], { drawingScale: 100 });
  check('scaled drawing keeps the hairline visible', near(strokeOf(scaled, 'b'), HAIRLINE_UNSCALED * 100),
    `got ${strokeOf(scaled, 'b')}`);

  // A real weight is untouched by the minimum.
  const real = render([shape('c', { lineWeight: 0.01 })], { drawingScale: 100 });
  check('real line weights are not floored', near(strokeOf(real, 'c'), 0.01 * 96 * 100),
    `got ${strokeOf(real, 'c')}`);
}

// 2. The viewer's opt-in minimum: one device pixel at the zoom being viewed.
{
  const raised = render([shape('a')], { options: { minStrokeWidth: 20 } });
  check('minStrokeWidth raises thin lines', near(strokeOf(raised, 'a'), 20), `got ${strokeOf(raised, 'a')}`);

  const belowHairline = render([shape('a')], { options: { minStrokeWidth: 0.01 } });
  check('minStrokeWidth never thins below the hairline',
    near(strokeOf(belowHairline, 'a'), HAIRLINE_UNSCALED), `got ${strokeOf(belowHairline, 'a')}`);

  const thick = render([shape('a', { lineWeight: 0.05 })], { options: { minStrokeWidth: 2 } });
  check('minStrokeWidth leaves thick lines alone', near(strokeOf(thick, 'a'), 0.05 * 96),
    `got ${strokeOf(thick, 'a')}`);
}

// 3. Hatch fills as vector <pattern> defs, not solid paint and not a raster.
{
  const svg = render([
    shape('x', { fillPattern: 4 }),
    shape('dots', { fillPattern: 11, fillForegroundTrans: 0.5 }),
    shape('solid', { fillPattern: 1 }),
    shape('none', { fillPattern: 0 })
  ]);
  const fillOf = (id) => pathOf(svg, id).getAttribute('fill');

  check('hatch fill references a pattern', /^url\(#hatch_4_/.test(fillOf('x')), fillOf('x'));
  check('solid fill stays a plain colour', fillOf('solid') === '#000000', fillOf('solid'));
  check('FillPattern 0 paints nothing', fillOf('none') === 'none', fillOf('none'));

  const patternId = fillOf('x').slice(5, -1);
  const pattern = svg.querySelector(`#${patternId}`);
  check('pattern def exists', !!pattern);
  check('pattern is vector, not a raster tile',
    pattern.querySelectorAll('image').length === 0 && pattern.querySelectorAll('line').length > 0);
  // Visio's tile is 6pt square; the X hatch is both diagonals plus the four
  // corner stubs that make it tile seamlessly.
  check('pattern tile is Visio\'s 6pt square', near(parseFloat(pattern.getAttribute('width')), 96 * 6 / 72),
    pattern.getAttribute('width'));
  check('X hatch draws both diagonals', pattern.querySelectorAll('line').length === 6,
    String(pattern.querySelectorAll('line').length));
  check('hatch ink is one eighth of the tile',
    near(parseFloat(pattern.querySelector('line').getAttribute('stroke-width')), 96 * 6 / 72 / 8));
  check('hatch keeps the background colour',
    pattern.querySelector('rect').getAttribute('fill') === '#ffffff');

  const dotsPattern = svg.querySelector(`#${fillOf('dots').slice(5, -1)}`);
  check('dot pattern uses the eight cells Visio does',
    dotsPattern.querySelectorAll('rect').length === 9, // 8 dots + background
    String(dotsPattern.querySelectorAll('rect').length));
  check('fill transparency lands on the pattern ink',
    dotsPattern.querySelectorAll('rect')[1].getAttribute('fill-opacity') === '0.5');

  // Two shapes with the same pattern and colours share one def.
  const shared = render([shape('p', { fillPattern: 4 }), shape('q', { fillPattern: 4 })]);
  check('identical hatches share a def', shared.querySelectorAll('pattern').length === 1,
    String(shared.querySelectorAll('pattern').length));
}

// 4. Line patterns. Dash runs are multiples of the line weight, as in Visio.
{
  const svg = render([
    shape('dash', { linePattern: 2, lineWeight: 0.01 }),
    shape('dot', { linePattern: 23, lineWeight: 0.01 }),
    shape('dashdot', { linePattern: 4, lineWeight: 0.01 }),
    shape('plain', { linePattern: 1, lineWeight: 0.01 })
  ]);
  const w = 0.01 * 96;
  const dashOf = (id) => pathOf(svg, id).getAttribute('stroke-dasharray');

  check('LinePattern 2 is Visio\'s 7:5 dash', dashOf('dash') === `${7 * w} ${5 * w}`, dashOf('dash'));
  check('LinePattern 23 is Visio\'s 1:2 dot', dashOf('dot') === `${w} ${2 * w}`, dashOf('dot'));
  check('LinePattern 4 is dash-dot', dashOf('dashdot') === `${7 * w} ${5 * w} 0 ${5 * w}`, dashOf('dashdot'));
  check('dotted patterns get a round cap so the dots paint',
    pathOf(svg, 'dashdot').getAttribute('stroke-linecap') === 'round');
  check('solid lines carry no dash array', dashOf('plain') === null, dashOf('plain'));
}

console.log(`\nrender-strokes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
