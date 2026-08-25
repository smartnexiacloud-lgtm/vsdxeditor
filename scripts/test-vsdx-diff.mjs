// Headless exercise of vsdx-diff: parse a file, remove a layer via the app's
// own pruning path, re-parse, and diff the two — proving cascade + IX remap
// are handled (layers matched by name, membership resolved to names).

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.Node = dom.window.Node;

// Copy ESM sources into a module-typed temp dir (package is commonjs). Use the
// OS tmpdir and clean up on exit so we never leave .tmp-esm-* dirs in the repo.
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-diff-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
// Symlink the project's node_modules so bare imports (jszip, …) still resolve
// from the out-of-tree temp dir.
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');
const copy = (src, dst, reps = []) => {
  let code = readFileSync(src, 'utf8');
  for (const [a, b] of reps) code = code.replace(a, b);
  writeFileSync(join(tmp, dst), code);
};
copy('src/shape-inheritance.js', 'shape-inheritance.mjs');
copy('src/parse-progress.js', 'parse-progress.mjs');
copy('src/svg-renderer.js', 'svg-renderer.mjs');
copy('src/vsdx-parser.js', 'vsdx-parser.mjs', [
  [/from '\.\/shape-inheritance\.js'/g, "from './shape-inheritance.mjs'"],
  [/from '\.\/parse-progress\.js'/g, "from './parse-progress.mjs'"],
  [/from '\.\/svg-renderer\.js'/g, "from './svg-renderer.mjs'"],
]);
copy('src/vsdx-diff.js', 'vsdx-diff.mjs');

const imp = (name) => import(pathToFileURL(join(tmp, name)).href);
const { parseVsdx, saveVsdxWithoutNonSelectedLayers } = await imp('vsdx-parser.mjs');
const { computeDiff, summarizeDiff } = await imp('vsdx-diff.mjs');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: test-vsdx-diff.mjs <file.vsdx> [more.vsdx ...]');
  process.exit(2);
}

// Shared pass/fail tally so BOTH the real-fixture checks below and the synthetic
// scenarios gate the final exit code.
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

for (const file of files) {
  console.log(`\n════════ ${file} ════════`);
  const buf = new Uint8Array(readFileSync(file)).buffer;
  const base = await parseVsdx(buf);

  // Find a page with a layer to remove.
  const page = base.pages.find((p) => (p.layers || []).length > 0);
  if (!page) {
    console.log('  (no layers on any page — skipping layer-removal scenario)');
    continue;
  }
  const doomed = page.layers[0];
  const keep = new Set(page.layers.slice(1).map((l) => String(l.index)));
  console.log(`  page "${page.name}": layers=${page.layers.map((l) => l.name).join(', ')}`);
  console.log(`  removing layer "${doomed.name}" (IX ${doomed.index}); keeping IX {${[...keep].join(',')}}`);

  const { buffer: headBuf, removedCount } = await saveVsdxWithoutNonSelectedLayers(
    buf, base.pages, page.id, keep);
  console.log(`  prune removedCount=${removedCount}`);

  const head = await parseVsdx(headBuf);
  const diff = computeDiff(base, head);

  console.log('  --- diff ---');
  console.log(summarizeDiff(diff).split('\n').map((l) => '  ' + l).join('\n'));

  // Assertions: the removed layer must be reported as removed (by NAME), and
  // must NOT show up as a spurious property-change on a renumbered survivor.
  const pd = diff.pages.find((p) => String(p.pageId) === String(page.id));
  const removedNames = pd.layers.removed.map((l) => l.name);
  const okRemoved = removedNames.includes(doomed.name);
  const survivorsNames = page.layers.slice(1).map((l) => l.name);
  const spuriousChange = pd.layers.changed.filter((c) => survivorsNames.includes(c.name)
    && c.changes.some((x) => x.field !== 'visible' && x.field !== 'print')); // props shouldn't shift from IX remap
  check(`removed-layer-by-name (${file})`, okRemoved);
  check(`no spurious survivor prop-churn (${file})`, spuriousChange.length === 0, JSON.stringify(spuriousChange));
}

// ── Synthetic scenarios ─────────────────────────────────────────────────────
// The test fixtures only have single-layer pages, so build multi-layer models
// directly to prove IX-remap resilience, hidden-layer, and membership-move.
console.log('\n════════ synthetic scenarios ════════');
const layer = (index, name, over = {}) => ({
  index: String(index), name, nameUniv: name,
  visible: true, print: true, active: false, lock: false, snap: true, glue: true,
  color: null, colorTrans: null, ...over,
});
const shape = (id, layerMembers, over = {}) => ({ id: String(id), layerMembers, pinX: 0, pinY: 0, ...over });
const doc = (layers, shapes) => ({ pages: [{ id: '1', name: 'P', layers, shapes }] });

// A) Hidden layer: Visible on -> off must surface as a property change.
{
  const base = doc([layer(0, 'Walls', { visible: true })], []);
  const head = doc([layer(0, 'Walls', { visible: false })], []);
  const pd = computeDiff(base, head).pages[0];
  const c = pd.layers.changed.find((x) => x.name === 'Walls');
  check('hidden layer reported as visible on→off',
    !!c && c.changes.some((x) => x.field === 'visible' && x.from === true && x.to === false),
    JSON.stringify(pd.layers));
}

// B) IX-remap resilience: remove layer A (IX0); B/C renumber to 0/1; a shape on
//    C has its LayerMember remapped 2->1. Must NOT read as moved or changed.
{
  const base = doc(
    [layer(0, 'A'), layer(1, 'B'), layer(2, 'C')],
    [shape('s1', ['2'])], // on C
  );
  const head = doc(
    [layer(0, 'B'), layer(1, 'C')],      // A gone, B&C renumbered
    [shape('s1', ['1'])],                // remapped to new C index
  );
  const pd = computeDiff(base, head).pages[0];
  check('removed layer A reported', pd.layers.removed.some((l) => l.name === 'A'));
  check('survivors B/C not reported changed', pd.layers.changed.length === 0, JSON.stringify(pd.layers.changed));
  check('shape on C NOT flagged as moved (IX remap absorbed)', pd.membership.length === 0, JSON.stringify(pd.membership));
}

// C) Real membership move: shape genuinely reassigned Walls -> Doors.
{
  const base = doc([layer(0, 'Walls'), layer(1, 'Doors')], [shape('s1', ['0'])]);
  const head = doc([layer(0, 'Walls'), layer(1, 'Doors')], [shape('s1', ['1'])]);
  const pd = computeDiff(base, head).pages[0];
  const m = pd.membership.find((x) => x.shapeId === 's1');
  check('genuine move reported Walls→Doors',
    !!m && m.from.join() === 'Walls' && m.to.join() === 'Doors', JSON.stringify(pd.membership));
}

console.log(`\ntotal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
