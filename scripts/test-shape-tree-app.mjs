// End-to-end test against the REAL built app (dist/) for the Shape Tree.
//
// The panel used to open on the selected shape's *parent group*, which for a
// shape that was not in a group is a tree of exactly one row — every row you
// could click was the row already selected, so clicking rows looked like it did
// nothing at all. It lists the page now, and this test is mostly about what a
// row can do: point at its shape on the canvas, say what text it holds, select
// it, open the same menu the canvas opens, and delete it.
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => null;
    window.confirm = () => true;
    window.alert = () => {};
    if (!window.CSS) window.CSS = {};
    if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
    window.Element.prototype.scrollIntoView = function () {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
  },
});
const { window } = dom;
const scriptEl = window.document.createElement('script');
scriptEl.textContent = bundle;
window.document.body.appendChild(scriptEl);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);
const q = (sel) => window.document.querySelector(sel);
const WAIT_TIMEOUT_MS = Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000;
const waitFor = async (done) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (done()) return true;
    if ($('error-box')?.textContent.trim()) return false;
    await sleep(25);
  }
  return false;
};
const currentSvg = () => q('#svg-container svg');
const dropFile = async (file) => {
  if ($('error-box')) $('error-box').textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  await waitFor(() => currentSvg() && currentSvg() !== previous
    && currentSvg().querySelector('g[data-shape-id]'));
};

const errorText = () => $('error-box')?.textContent.trim() || '';
const rows = () => [...window.document.querySelectorAll('#shape-tree-body .shape-tree-node')];
const rowFor = (id) => rows().find(row => row.dataset.shapeId === String(id));
const rowIds = () => rows().map(row => row.dataset.shapeId);
const drawnIds = () => [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'));
const topLevel = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'));
const selected = () => [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
  .filter(g => g.dataset.selected).map(g => g.getAttribute('data-shape-id'));
const groupEl = (id) => q(`#svg-container svg g[data-shape-id="${id}"]`);
const clickShape = async (id) => {
  groupEl(id)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(60);
};

const fixture = process.argv[2] || 'test-files/test3_house.vsdx';
console.log(`── in-app shape tree: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'tree.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + errorText());

// --- 1. It lists the page, not just the shape you clicked -------------------
check('the tree is closed until something is selected',
  !$('shape-tree-sidebar').classList.contains('visible'));

const roots = topLevel();
check('the drawing has more than one top-level shape', roots.length > 1, roots.join(','));
await clickShape(roots[0]);
check('selecting a shape opens the tree', $('shape-tree-sidebar').classList.contains('visible'));
check('which lists every shape on the page, not only the selected one',
  rowIds().length === drawnIds().length && roots.every(id => rowIds().includes(id)),
  `${rowIds().join(',')} vs ${drawnIds().join(',')}`);
check('including shapes nested inside groups',
  rowIds().length > roots.length, `${rowIds().length} rows for ${roots.length} roots`);
check('the subtitle counts them', /\d+ shapes/.test($('shape-tree-subtitle').textContent),
  $('shape-tree-subtitle').textContent);

// --- 2. A row points at its shape ------------------------------------------
const otherId = rowIds().find(id => id !== roots[0]);
const otherRow = rowFor(otherId);
otherRow.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
await sleep(40);
check('hovering a row draws a box round that shape on the canvas', !!q('#shape-highlight'));
otherRow.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
await sleep(40);
check('and it goes when the pointer leaves', !q('#shape-highlight'));

const withText = rows().find(row => row.title.includes('“'));
check('a row holding text says so in its tooltip', !!withText,
  rows().map(row => row.title).join(' | '));
check('every row has a tooltip at all', rows().every(row => !!row.title));

// --- 3. Clicking a row selects that shape -----------------------------------
check('the shape clicked on the canvas is the selected one', selected().join(',') === roots[0],
  selected().join(','));
rowFor(otherId).querySelector('.shape-tree-label').click();
await sleep(120);
check('clicking a different row moves the selection to it', selected().join(',') === otherId,
  selected().join(','));
check('and the row itself is marked', rowFor(otherId)?.classList.contains('selected'));
check('the selection is drawn as an overlay on top of the drawing, not an outline '
  + 'the shape in front can cover', !!q('#shape-selection'));

// --- 4. A row has the same menu the canvas has ------------------------------
rowFor(otherId).dispatchEvent(new window.MouseEvent('contextmenu', {
  bubbles: true, cancelable: true, clientX: 40, clientY: 40,
}));
await sleep(80);
check('right-clicking a row opens the shape menu', $('shape-context-menu').classList.contains('visible'));
check('with the arrange actions for the selection', !$('shape-arrange-section').hidden);
check('and Delete among them', !!$('shape-arrange-delete'));
check('the "Select component" list is folded away, since a row is not a stack',
  $('shape-pick-section').hidden);
check('and the menu names the shape the row was for',
  $('shape-context-subtitle').textContent.length > 0, $('shape-context-subtitle').textContent);

// Right-clicking a row that is not selected moves the selection there first.
const thirdId = rowIds().find(id => id !== otherId && topLevel().includes(id));
if (thirdId) {
  rowFor(thirdId).dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 40, clientY: 40,
  }));
  await sleep(120);
  check('right-clicking an unselected row selects it first', selected().join(',') === thirdId,
    selected().join(','));
}
$('shape-context-menu').classList.remove('visible');

// --- 5. Every row can be deleted, the top one included ----------------------
// The ✕ used to be disabled on the row the tree opened on, from back when it
// spliced the in-memory tree and had nowhere to put a tree with no root.
const rootRow = rowFor(topLevel()[0]);
check('the top-level row offers a delete like any other',
  !!rootRow?.querySelector('.shape-tree-delete') && !rootRow.querySelector('.shape-tree-delete').disabled,
  String(rootRow?.querySelector('.shape-tree-delete')?.disabled));
const doomed = topLevel()[0];
const before = topLevel().length;
rootRow.querySelector('.shape-tree-delete').click();
const deleted = await waitFor(() => topLevel().length === before - 1);
check('and deleting it works', deleted, `${topLevel().join(',')} · ${errorText()}`);
check('the right shape went', !topLevel().includes(doomed), topLevel().join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
