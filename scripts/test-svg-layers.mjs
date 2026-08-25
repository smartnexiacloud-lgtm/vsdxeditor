// Visio layers as real layers in the exported SVG.
//
// The export used to tag each shape with a data-layers attribute and stop
// there, which no SVG editor reads: opening the file in Inkscape gave one flat
// pile of paths and no layer panel at all. Grouping the shapes fixes that, but
// SVG paint order *is* document order while Visio's z-order is independent of
// its layers — so the interesting checks here are not "are there groups", they
// are "did grouping quietly restack the drawing".
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { localFixtures, noLocalFixtures } from './local-fixtures.mjs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS', 'Element'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-svglayers-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { renderPage } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));
const { collectShapeBoxes } = await import(pathToFileURL(join(tmp, 'shape-picker.js')));
const { planLayerGroups, groupSvgShapesByLayer, UNLAYERED_LABEL, INKSCAPE_NS } =
  await import(pathToFileURL(join(tmp, 'svg-layers.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
const entry = (key, bounds) => ({ key, label: key || UNLAYERED_LABEL, bounds });

// ---------------------------------------------------------------------------
console.log('\nhow the shapes are bucketed');
{
  const plan = planLayerGroups([
    entry('A', box(0, 0, 1, 1)), entry('A', box(2, 0, 3, 1)), entry('B', box(4, 0, 5, 1))
  ]);
  check('a page already sorted by layer gets one group each',
    plan.mode === 'layers' && plan.groups.length === 2, JSON.stringify(plan.mode) + ' ' + plan.groups.length);
  check('…and nothing was split', plan.split === 0);
}
{
  // A, B, A — the layers interleave, but the shapes are nowhere near each
  // other, so collecting the two A's together cannot change the picture.
  const plan = planLayerGroups([
    entry('A', box(0, 0, 1, 1)), entry('B', box(2, 0, 3, 1)), entry('A', box(4, 0, 5, 1))
  ]);
  check('interleaved layers still merge when the shapes are disjoint',
    plan.mode === 'layers' && plan.groups.length === 2, `${plan.mode} ${plan.groups.length}`);
  check('…and the merged group holds both of its shapes',
    JSON.stringify(plan.groups[0].members) === '[0,2]', JSON.stringify(plan.groups[0].members));
}
{
  // Same interleaving, but now the B in the middle overlaps both A's: merging
  // would lift B above them or drop it below, and it would show.
  const plan = planLayerGroups([
    entry('A', box(0, 0, 4, 4)), entry('B', box(1, 1, 3, 3)), entry('A', box(0, 0, 4, 4))
  ]);
  check('overlapping shapes are not restacked to tidy up the layer list',
    plan.mode === 'runs' && plan.groups.length === 3, `${plan.mode} ${plan.groups.length}`);
  check('…and the split is reported', plan.split === 1, String(plan.split));
  check('…keeping the original order', JSON.stringify(plan.groups.map(g => g.members)) === '[[0],[1],[2]]',
    JSON.stringify(plan.groups.map(g => g.members)));
}
{
  const plan = planLayerGroups([
    entry('A', null), entry('B', box(0, 0, 1, 1)), entry('A', null)
  ]);
  check('a shape whose box is unknown is never moved past anything',
    plan.mode === 'runs', plan.mode);
}
check('an empty page groups into nothing', planLayerGroups([]).mode === 'none');

// ---------------------------------------------------------------------------
console.log('\nwhat comes out of the real renderer');

const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const shapeOrder = (svg) => [...svg.querySelectorAll('[data-shape-id]')].map(el => el.getAttribute('data-shape-id'));

async function renderFixture(file, pageIndex = 0) {
  const drawing = await parseVsdx(toBuffer(readFileSync(file)));
  const page = drawing.pages[pageIndex];
  const svg = renderPage(page, document.getElementById('stage'));
  const bounds = new Map();
  for (const box of collectShapeBoxes(page)) if (box.depth === 0) bounds.set(String(box.id), box.bounds);
  return { drawing, page, svg, bounds };
}

// The drawing in test-files/ is small and public; anything in local-fixtures/
// is a real drawing somebody dropped there and is picked up by listing the
// directory, so no private file is named here. See scripts/local-fixtures.mjs.
const FIXTURES = ['test-files/test9_rect_and_line.vsdx', ...localFixtures()];

for (const fixture of FIXTURES) {
  console.log(`\n  ${fixture}`);
  const { page, svg, bounds } = await renderFixture(fixture);
  const before = shapeOrder(svg);
  const flat = [...svg.children].filter(el => el.getAttribute?.('data-shape-id') !== null).length;
  check('the page renders as a flat pile of shapes to begin with', flat > 0, String(flat));

  const summary = groupSvgShapesByLayer(svg, page, { bounds });
  const groups = [...svg.children].filter(el =>
    el.getAttributeNS(INKSCAPE_NS, 'groupmode') === 'layer' || el.getAttribute('inkscape:groupmode') === 'layer');
  check('every shape now lives in a layer group', groups.length === summary.groups && groups.length > 0,
    `${groups.length} groups, summary says ${summary.groups}`);
  check('no shape was left at the top level',
    [...svg.children].every(el => el.getAttribute?.('data-shape-id') === null), 'a shape is still loose');
  check('no shape was lost or duplicated',
    shapeOrder(svg).length === before.length && new Set(shapeOrder(svg)).size === before.length,
    `${before.length} -> ${shapeOrder(svg).length}`);

  const labels = groups.map(g => g.getAttributeNS(INKSCAPE_NS, 'label') || g.getAttribute('inkscape:label'));
  check('every group is labelled', labels.every(Boolean), JSON.stringify(labels));
  const layerNames = new Set((page.layers || []).map(l => l.name || l.nameUniv));
  check('the labels are the drawing\'s own layer names',
    labels.every(label => layerNames.has(label.replace(/ \(\d+\)$/, '').split(' + ')[0]) || label.startsWith(UNLAYERED_LABEL)),
    JSON.stringify([...labels]) + ' vs ' + JSON.stringify([...layerNames]));

  if (summary.mode === 'runs') {
    check('a split grouping left the stacking order untouched',
      JSON.stringify(shapeOrder(svg)) === JSON.stringify(before));
  } else {
    check('a merged grouping only moved shapes that cannot overlap', (() => {
      const after = shapeOrder(svg);
      const position = new Map(after.map((id, i) => [id, i]));
      for (let i = 0; i < before.length; i++) {
        for (let j = i + 1; j < before.length; j++) {
          if (position.get(before[i]) < position.get(before[j])) continue;
          const a = bounds.get(before[i]);
          const b = bounds.get(before[j]);
          if (!a || !b) return false;
          if (a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY) return false;
        }
      }
      return true;
    })(), summary.mode);
  }
}

// ---------------------------------------------------------------------------
console.log('\na hidden layer is a hidden layer, not hidden shapes');
// Whichever fixture can actually demonstrate it: the check needs a page with a
// layer that has shapes on it, and asking the drawings rather than naming one
// means this runs on a bare checkout instead of only where a rich local sample
// happens to sit.
async function firstHideableFixture() {
  for (const fixture of FIXTURES) {
    const rendered = await renderFixture(fixture);
    const layer = (rendered.page.layers || [])[0];
    if (!layer) continue;
    layer.visible = false;
    const svg = renderPage(rendered.page, document.getElementById('stage'));
    const hidden = [...svg.querySelectorAll('[data-shape-id][display="none"]')].length;
    if (hidden > 0) return { fixture, layer, svg, hidden, page: rendered.page, bounds: rendered.bounds };
    layer.visible = true; // put it back: the next fixture gets a clean look at it
  }
  return null;
}
const hideable = await firstHideableFixture();
if (!hideable) {
  console.log(noLocalFixtures('the hidden-layer check') + ' with a layer that has shapes on it');
} else {
  const { page, bounds, layer, hidden: hiddenBefore, svg: rendered } = hideable;
  console.log(`  using ${hideable.fixture}`);
  check('the fixture has a layer to switch off', !!layer);
  check('switching it off hides its shapes one by one', hiddenBefore > 0, String(hiddenBefore));

  groupSvgShapesByLayer(rendered, page, { bounds });
  const label = layer.name || layer.nameUniv;
  const group = [...rendered.children].find(el =>
    (el.getAttributeNS(INKSCAPE_NS, 'label') || el.getAttribute('inkscape:label')) === label);
  check('the layer group exists', !!group, label);
  check('…and it is the group that is hidden', /display\s*:\s*none/.test(group?.getAttribute('style') || ''),
    group?.getAttribute('style'));
  check('…so its shapes are visible again inside it, and the eye actually toggles',
    [...group.querySelectorAll('[data-shape-id]')].every(el => el.getAttribute('display') !== 'none'));
}

// ---------------------------------------------------------------------------
console.log('\nit survives serialization');
{
  const { page, svg, bounds } = await renderFixture('test-files/test9_rect_and_line.vsdx');
  groupSvgShapesByLayer(svg, page, { bounds });
  const text = new XMLSerializer().serializeToString(svg);
  check('the inkscape namespace is declared', text.includes('http://www.inkscape.org/namespaces/inkscape'));
  check('the groups say they are layers', /groupmode="layer"/.test(text));
  check('and they are labelled', /inkscape:label="/.test(text));
  const reparsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  check('it is still well-formed SVG', reparsed.getElementsByTagName('parsererror').length === 0);
  check('…with the same shapes in it',
    reparsed.querySelectorAll('[data-shape-id]').length === svg.querySelectorAll('[data-shape-id]').length);
}

console.log(`\nsvg layers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
