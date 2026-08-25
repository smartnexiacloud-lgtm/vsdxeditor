// The shape picker computes every shape's page-space box so a click can be
// resolved to the shapes under it. That box is only trustworthy if it agrees
// with where the renderer actually draws the shape — so this test composes the
// transform chain straight off the rendered SVG (including nested groups,
// rotation and flips) and checks the picker's matrix against it, shape by
// shape, on real drawings.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { localFixtures } from './local-fixtures.mjs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-picker-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { renderPage } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));
const { collectShapeBoxes, shapesAtPoint, shapesOnLayer, searchShapes } =
  await import(pathToFileURL(join(tmp, 'shape-picker.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

// --- compose an SVG transform attribute the way a renderer would ----------
const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function parseTransform(text) {
  let m = IDENTITY;
  for (const [, fn, argText] of String(text || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = argText.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
    else if (fn === 'scale') m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    else if (fn === 'rotate') {
      const rad = ((a[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const cx = a[1] || 0, cy = a[2] || 0;
      m = mul(m, [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]);
    }
  }
  return m;
}

// The composed matrix of a rendered group, walking up to the root <svg>.
function domMatrix(group) {
  let m = IDENTITY;
  const chain = [];
  for (let el = group; el && el.tagName !== 'svg'; el = el.parentNode) {
    if (el.getAttribute?.('transform')) chain.unshift(el.getAttribute('transform'));
  }
  for (const text of chain) m = mul(m, parseTransform(text));
  return m;
}

// The drawings in test-files/ are small and public; anything in local-fixtures/
// is a real drawing somebody dropped there and is picked up by listing the
// directory, so no private file is named here. See scripts/local-fixtures.mjs.
const FIXTURES = [
  'test-files/test3_house.vsdx',
  'test-files/test4_connectors.vsdx',
  'test-files/test9_rect_and_line.vsdx',
  ...localFixtures(),
];

for (const fixture of FIXTURES) {
  console.log(`\nshape picker: ${fixture}`);
  const bytes = readFileSync(fixture);
  const parsed = await parseVsdx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const page = parsed.pages.find(p => !p.isBackground) || parsed.pages[0];

  const container = dom.window.document.createElement('div');
  renderPage(page, container);

  const entries = collectShapeBoxes(page);
  check('found shapes to check', entries.length > 0, `${entries.length}`);

  // Compare every rendered group's composed transform against the picker's.
  let worst = 0;
  let compared = 0;
  let nested = 0;
  for (const entry of entries) {
    // Nested shapes can repeat an ID across groups; match on the DOM node that
    // carries the same ancestor chain.
    const candidates = [...container.querySelectorAll(`g[data-shape-id="${entry.id}"]`)];
    const group = candidates.find(el => {
      const chain = [];
      for (let p = el.parentNode; p && p.tagName !== 'svg'; p = p.parentNode) {
        const id = p.getAttribute?.('data-shape-id');
        if (id) chain.unshift(id);
      }
      return chain.join('/') === entry.ancestors.join('/');
    }) || candidates[0];
    if (!group) continue;

    compared++;
    if (entry.depth > 0) nested++;
    const fromDom = domMatrix(group);
    const w = (entry.shape.width || 0) * 96;
    const h = (entry.shape.height || 0) * 96;
    for (const [lx, ly] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      const a = apply(entry.matrix, lx, ly);
      const b = apply(fromDom, lx, ly);
      worst = Math.max(worst, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
  }
  check(`matches the renderer for all ${compared} rendered groups`, worst < 1e-6, `worst ${worst}px`);
  if (nested) check(`covered ${nested} shape(s) nested inside groups`, nested > 0);

  // A shape's own centre must hit that shape.
  const target = entries.find(e => e.area > 0 && !e.isGroup) || entries[0];
  const cx = (target.bounds.minX + target.bounds.maxX) / 2;
  const cy = (target.bounds.minY + target.bounds.maxY) / 2;
  const hits = shapesAtPoint(page, cx, cy);
  check('hit test finds the shape under its own centre',
    hits.some(h => h.id === target.id && h.ancestors.join('/') === target.ancestors.join('/')),
    `${hits.length} hits at ${cx.toFixed(3)},${cy.toFixed(3)}`);
  check('hit test returns topmost first',
    hits.length < 2 || hits[0].order >= hits[hits.length - 1].order,
    hits.map(h => h.order).join(','));

  // Far outside the page nothing should be hit.
  check('hit test is empty well outside the page',
    shapesAtPoint(page, -1000, -1000).length === 0);

  // Every shape reported on a layer really carries that layer.
  const layer = (page.layers || [])[0];
  if (layer) {
    const onLayer = shapesOnLayer(page, layer.index);
    check(`layer "${layer.name}" lists only its own shapes`,
      onLayer.every(e => e.layerMembers.some(m => String(m) === String(layer.index))),
      `${onLayer.length} shapes`);
    const expected = entries.filter(e => e.layerMembers.some(m => String(m) === String(layer.index))).length;
    check('layer listing is complete', onLayer.length === expected, `${onLayer.length} vs ${expected}`);
  }

  const unlayered = shapesOnLayer(page, '__unlayered__', { unlayeredIndex: '__unlayered__' });
  check('unlayered listing holds only shapes with no layer',
    unlayered.every(e => e.layerMembers.length === 0), `${unlayered.length} shapes`);

  // --- searching by name, text or ID ---------------------------------------
  check('an empty search matches nothing', searchShapes(page, '   ').length === 0);
  check('a search nobody wrote matches nothing',
    searchShapes(page, 'zzz-no-such-shape-zzz').length === 0);

  const byId = searchShapes(page, `#${target.id}`);
  check('a #ID search finds that shape',
    byId.some(e => e.id === target.id), `#${target.id} → ${byId.length}`);
  check('and returns only shapes whose ID starts that way',
    byId.every(e => e.id.startsWith(String(target.id))), byId.map(e => e.id).join(','));
  check('a bare # is not a match-everything',
    searchShapes(page, '#').length === 0);

  // Whatever the row would be labelled with is what a user types.
  const named = entries.find(e => e.label && !['Shape', 'Group'].includes(e.label));
  if (named) {
    // Trimmed, because the search trims too — an unnamed shape's row says
    // "Shape", so searching "shape" is meant to find it.
    const needle = named.label.slice(0, Math.min(6, named.label.length)).trim();
    const hits = searchShapes(page, needle);
    check(`searching "${needle}" finds the shape labelled "${named.label}"`,
      hits.some(e => e.id === named.id && e.ancestors.join('/') === named.ancestors.join('/')),
      `${hits.length} hits`);
    check('the search is case-insensitive',
      searchShapes(page, needle.toUpperCase()).length === hits.length);
    check('every hit really contains the text somewhere',
      hits.every(e => [e.label, e.shape.name, e.shape.nameU, e.shape.text]
        .some(v => String(v ?? '').toLowerCase().includes(needle.toLowerCase()))));
    check('results carry the box the highlight needs',
      hits.every(e => e.bounds && Number.isFinite(e.bounds.minX) && Number.isFinite(e.bounds.maxY)));
    if (hits.length > 1) {
      check('a limit caps the result list', searchShapes(page, needle, { limit: 1 }).length === 1);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
