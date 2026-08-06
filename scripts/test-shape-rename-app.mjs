// End-to-end test against the REAL built app (dist/) for renaming a shape from
// the canvas right-click menu. A shape's name is Visio's Name/NameU — what the
// Shape Tree, the "Select component" list and Visio's own Shape Name dialog all
// show — so the test renames one, checks every surface agrees, and then saves
// and reopens to prove the name is in the file rather than only in the editor.
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

let promptReply = '';
let promptDefault = null;
let promptCancels = false;
const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    // Kept so the test can assert the prompt is prefilled with the name the
    // shape has now — retyping it from scratch would be the wrong affordance.
    window.prompt = (message, value) => {
      promptDefault = value;
      return promptCancels ? null : promptReply;
    };
    window.confirm = () => true;
    window.alert = () => {};
    if (!window.CSS) window.CSS = {};
    if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
  },
});
const { window } = dom;
const captured = window.__captured;
window.HTMLAnchorElement.prototype.click = function () {};
const origArrayBuffer = window.Blob.prototype.arrayBuffer;
window.Blob.prototype.arrayBuffer = async function () {
  const src = new Uint8Array(await origArrayBuffer.call(this));
  const dst = new window.Uint8Array(src.length);
  dst.set(src);
  return dst.buffer;
};

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
const currentSvg = () => window.document.querySelector('#svg-container svg');
const dropFile = async (file) => {
  if ($('error-box')) $('error-box').textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  await waitFor(() => currentSvg() && currentSvg() !== previous);
};

// A group whose transform is a plain translate puts its local origin exactly at
// (tx, ty) in user units, which at zoom 1 with no pan are client pixels — the
// same trick the shape-picking test uses to right-click a known shape.
const translated = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => ({ g, id: g.getAttribute('data-shape-id'), t: /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(g.getAttribute('transform') || '') }))
  .filter(entry => entry.t);
const rightClickShape = async (entry) => {
  entry.g.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: Number(entry.t[1]) + 4, clientY: Number(entry.t[2]) + 4,
  }));
  await sleep(50);
};
const menuOpen = () => $('shape-context-menu').classList.contains('visible');
const pickLabels = () => [...window.document.querySelectorAll('#shape-pick-list .shape-pick-row')]
  .map(row => row.querySelector('.shape-pick-label')?.textContent.trim());
const treeLabels = () => [...window.document.querySelectorAll('#shape-tree-body .shape-tree-label')]
  .map(el => el.firstChild?.textContent || el.textContent);

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app shape rename: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'rename.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);

const target = translated()[0];
check('found a shape to right-click', !!target);

// --- 1. The menu offers it -------------------------------------------------
await rightClickShape(target);
check('the context menu opened', menuOpen());
check('it offers a rename', !!$('shape-context-rename') && $('shape-context-rename').style.display !== 'none');
const originalSubtitle = $('shape-context-subtitle').textContent;

// --- 2. Cancelling changes nothing ----------------------------------------
promptCancels = true;
$('shape-context-rename').click();
await sleep(60);
check('cancelling the prompt closes the menu without renaming', !menuOpen());
await rightClickShape(target);
check('and the shape keeps the name it had',
  $('shape-context-subtitle').textContent === originalSubtitle,
  `${$('shape-context-subtitle').textContent} vs ${originalSubtitle}`);

// --- 3. Renaming -----------------------------------------------------------
promptCancels = false;
promptReply = 'Feeder cable';
$('shape-context-rename').click();
await sleep(80);
check('the menu closes once it has acted', !menuOpen());

const renamed = translated().find(entry => entry.id === target.id);
check('the shape is still on the canvas', !!renamed);
await rightClickShape(renamed);
check('the menu now names the shape by its new name',
  $('shape-context-subtitle').textContent.startsWith('Feeder cable'),
  $('shape-context-subtitle').textContent);
check('and the Select component list agrees',
  pickLabels().includes('Feeder cable'), pickLabels().join(','));

// The Shape Tree is the other surface that shows a shape's name; it appears
// once a shape is selected, which picking it from this list does.
const pickRow = [...window.document.querySelectorAll('#shape-pick-list .shape-pick-row')]
  .find(row => row.dataset.shapeId === String(target.id));
pickRow?.click();
await sleep(60);
check('the Shape Tree shows the new name', treeLabels().includes('Feeder cable'), treeLabels().join(','));

// --- 4. It is a real Visio name, not an editor label -----------------------
const before = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > before);
check('Save produced a file', captured.length > before);
const savedBytes = Buffer.from(await captured.at(-1).arrayBuffer());
const savedText = savedBytes.toString('latin1');
check('the saved package is a zip', savedText.startsWith('PK'));

window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([savedBytes], 'rename-reopened.vsdx'));
check('the reopened drawing renders', !!currentSvg()?.querySelector('g[data-shape-id]'));

const reopened = translated().find(entry => entry.id === target.id);
check('the renamed shape came back', !!reopened);
if (reopened) {
  await rightClickShape(reopened);
  check('with the name written into the file',
    $('shape-context-subtitle').textContent.startsWith('Feeder cable'),
    $('shape-context-subtitle').textContent);
}

// --- 5. Blank clears the name ---------------------------------------------
promptReply = '';
$('shape-context-rename').click();
await sleep(80);
check('the prompt was prefilled with the name the shape had',
  promptDefault === 'Feeder cable', String(promptDefault));
const cleared = translated().find(entry => entry.id === target.id);
await rightClickShape(cleared);
check('a blank answer clears the name again',
  !$('shape-context-subtitle').textContent.startsWith('Feeder cable'),
  $('shape-context-subtitle').textContent);

// --- 6. Renaming from the Shape Tree --------------------------------------
// The tree is where you are when you are reading the names, so it renames too.
// It used to offer only a double-click, which never landed: the click that
// selected the row redrew the tree, so the second click hit a different node.
const treeRows = () => [...window.document.querySelectorAll('#shape-tree-body .shape-tree-node')];
const treeRowFor = (name) => treeRows().find(row =>
  (row.querySelector('.shape-tree-label')?.firstChild?.textContent || '') === name);
const treeEditor = () => window.document.querySelector('#shape-tree-body .shape-tree-editor');

const treeTarget = translated().find(entry => entry.id !== target.id) || translated()[0];
await rightClickShape(treeTarget);
window.document.querySelector(`#shape-pick-list .shape-pick-row[data-shape-id="${treeTarget.id}"]`)?.click();
await sleep(60);
$('shape-context-menu').classList.remove('visible');

const treeRow = treeRows().find(row => !row.querySelector('.shape-tree-expander:disabled')) || treeRows()[0];
check('the Shape Tree drew rows to rename', !!treeRow, `${treeRows().length} rows`);
check('every row offers a rename button', treeRows().every(row => !!row.querySelector('.shape-tree-rename')));

const renameFrom = treeRow.querySelector('.shape-tree-label')?.firstChild?.textContent;
treeRow.querySelector('.shape-tree-rename').click();
await sleep(50);
check('the rename button opens the inline editor', !!treeEditor());
if (treeEditor()) {
  const editor = treeEditor();
  editor.value = 'Tree renamed';
  editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(80);
  check('the tree shows the new name', treeLabels().includes('Tree renamed'), treeLabels().join(','));
  check('and it replaced the name that row had', !treeLabels().includes(renameFrom) || renameFrom === 'Tree renamed');
}

// Double-clicking the name still works once the row is the selected one — the
// selection no longer redraws the tree when it has not actually changed.
const renamedRow = treeRowFor('Tree renamed');
if (renamedRow) {
  const label = renamedRow.querySelector('.shape-tree-label');
  label.click();
  await sleep(50);
  const sameLabel = treeRowFor('Tree renamed')?.querySelector('.shape-tree-label');
  check('selecting an already-selected row leaves it in place', sameLabel === label);
  label.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await sleep(50);
  check('double-clicking the name opens the editor too', !!treeEditor());
  if (treeEditor()) {
    treeEditor().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(50);
    check('Escape leaves the name alone', treeLabels().includes('Tree renamed'), treeLabels().join(','));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
