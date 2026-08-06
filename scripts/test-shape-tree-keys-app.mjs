// End-to-end test against the REAL built app (dist/) for walking the Shape Tree
// from the keyboard. A page is thirty rows called Shape.7, Shape.8, Shape.9, so
// the tree moves under the arrows like any other tree — and the cursor is not
// the selection: moving it only points at a shape, Enter is what commits it.
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
const rowIds = () => rows().map(row => row.dataset.shapeId);
const cursorRow = () => rows().find(row => row.classList.contains('cursor')) || null;
const cursorId = () => cursorRow()?.dataset.shapeId ?? null;
const selected = () => [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
  .filter(g => g.dataset.selected).map(g => g.getAttribute('data-shape-id'));
const topLevel = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'));
const groupEl = (id) => q(`#svg-container svg g[data-shape-id="${id}"]`);

// The key goes to whatever the tree currently has the keyboard on, exactly as a
// real keypress would: the row is the tab stop, and the handler sits on the body.
const press = async (key) => {
  const target = cursorRow() || $('shape-tree-body');
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await sleep(60);
};

const fixture = process.argv[2] || 'test-files/test3_house.vsdx';
console.log(`── in-app shape tree keyboard: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'keys.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + errorText());

const roots = topLevel();
groupEl(roots[0])?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('selecting a shape opens the tree', $('shape-tree-sidebar').classList.contains('visible'));

// --- 1. There is a cursor, and it starts on the selected row ----------------
check('the tree puts a cursor somewhere', !!cursorRow(), rowIds().join(','));
check('and it starts on the selected shape', cursorId() === roots[0], `${cursorId()} vs ${roots[0]}`);
check('the cursor row is the tree\'s one tab stop',
  cursorRow().tabIndex === 0 && rows().filter(row => row.tabIndex === 0).length === 1,
  rows().map(row => row.tabIndex).join(','));
check('the buttons inside a row are not separate tab stops',
  rows().every(row => [...row.querySelectorAll('button, input')].every(el => el.tabIndex === -1)));
check('the tree says it is a tree', $('shape-tree-body').getAttribute('role') === 'tree'
  && rows().every(row => row.getAttribute('role') === 'treeitem'));

// --- 2. Up and down walk the rows you can see -------------------------------
const startIndex = rowIds().indexOf(cursorId());
await press('ArrowDown');
check('ArrowDown steps to the next row', rowIds().indexOf(cursorId()) === startIndex + 1,
  `${cursorId()} at ${rowIds().indexOf(cursorId())}`);
check('and points at that shape on the canvas', !!q('#shape-highlight'));
check('without moving the selection — Enter is what selects',
  selected().join(',') === roots[0], selected().join(','));

await press('ArrowUp');
check('ArrowUp steps back', rowIds().indexOf(cursorId()) === startIndex);

await press('End');
check('End goes to the last row', cursorId() === rowIds().at(-1), cursorId());
await press('ArrowDown');
check('and ArrowDown stops there rather than wrapping', cursorId() === rowIds().at(-1), cursorId());
await press('Home');
check('Home goes to the first row', cursorId() === rowIds()[0], cursorId());
await press('ArrowUp');
check('and ArrowUp stops there too', cursorId() === rowIds()[0], cursorId());

// --- 3. Enter is what selects ----------------------------------------------
await press('ArrowDown');
const target = cursorId();
check('moved to a row that is not the selected one', target !== selected().join(','),
  `${target} vs ${selected().join(',')}`);
await press('Enter');
check('Enter selects the shape the cursor is on', selected().join(',') === target,
  selected().join(','));
check('the row is marked selected', cursorRow()?.classList.contains('selected'));
check('and the cursor stays where it was', cursorId() === target, cursorId());
check('the selection is drawn on the canvas', !!q('#shape-selection'));

// --- 4. Left and right fold groups ------------------------------------------
// A group is a row whose expander is not disabled.
const groupRow = rows().find(row => !row.querySelector('.shape-tree-expander').disabled);
check('the drawing has a group to fold', !!groupRow, rowIds().join(','));
if (groupRow) {
  const groupId = groupRow.dataset.shapeId;
  groupRow.querySelector('.shape-tree-label').click();
  await sleep(80);
  check('clicking a row moves the cursor there too', cursorId() === groupId, cursorId());
  check('the group starts open', cursorRow().getAttribute('aria-expanded') === 'true',
    cursorRow().getAttribute('aria-expanded'));

  const openRows = rowIds().length;
  await press('ArrowLeft');
  check('ArrowLeft folds the group away', rowIds().length < openRows,
    `${rowIds().length} vs ${openRows}`);
  check('the cursor stays on the group it folded', cursorId() === groupId, cursorId());
  check('and the row says so', cursorRow().getAttribute('aria-expanded') === 'false');

  await press('ArrowRight');
  check('ArrowRight opens it again', rowIds().length === openRows,
    `${rowIds().length} vs ${openRows}`);
  check('with the cursor still on the group', cursorId() === groupId, cursorId());

  const groupAt = rowIds().indexOf(groupId);
  await press('ArrowRight');
  check('ArrowRight again steps into the group', rowIds().indexOf(cursorId()) === groupAt + 1,
    cursorId());
  const childId = cursorId();
  await press('ArrowLeft');
  check('ArrowLeft climbs back out to the parent', cursorId() === groupId,
    `${cursorId()} from ${childId}`);
}

// --- 5. Space is the row's checkbox ----------------------------------------
const beforeHidden = cursorRow().classList.contains('hidden');
await press(' ');
check('Space toggles the row\'s visibility', cursorRow()?.classList.contains('hidden') !== beforeHidden,
  String(cursorRow()?.classList.contains('hidden')));
await press(' ');
check('and toggles it back', cursorRow()?.classList.contains('hidden') === beforeHidden);

// --- 6. The rename editor keeps its own keys --------------------------------
await press('F2');
const editor = q('#shape-tree-body .shape-tree-editor');
check('F2 opens the inline rename editor', !!editor);
if (editor) {
  const before = rowIds().length;
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  await sleep(50);
  check('arrows inside the editor belong to the text field, not the tree',
    !!q('#shape-tree-body .shape-tree-editor') && rowIds().length === before);
  q('#shape-tree-body .shape-tree-editor')
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(60);
  check('Escape closes it', !q('#shape-tree-body .shape-tree-editor'));
  check('and the tree still has a cursor afterwards', !!cursorRow(), rowIds().join(','));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
