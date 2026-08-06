// End-to-end test against the REAL built app (dist/) for deleting shapes:
// the Delete button in the right-click menu, the Delete/Backspace keys, and the
// ✕ on a Shape Tree row.
//
// The point that matters most is the last one in each case — that the deletion
// is in the *file*. Removing a shape from the in-memory page looks identical on
// screen and then quietly comes back on Save VSDX, because saving patches the
// original package and skips shapes it no longer knows about. So every delete
// here is followed by a save and a reopen.
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
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
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
  await waitFor(() => currentSvg() && currentSvg() !== previous
    && currentSvg().querySelector('g[data-shape-id]'));
};

const errorText = () => $('error-box')?.textContent.trim() || '';
const allIds = () => [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'));
const topLevel = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'));
const groupEl = (id) => window.document.querySelector(`#svg-container svg g[data-shape-id="${id}"]`);
const selected = () => [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
  .filter(g => g.dataset.selected).map(g => g.getAttribute('data-shape-id'));

const clickShape = async (id, modifier = false) => {
  groupEl(id)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: modifier }));
  await sleep(60);
};
const rightClick = async (id) => {
  const el = groupEl(id);
  const t = /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(el?.getAttribute('transform') || '');
  el?.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: t ? Number(t[1]) + 4 : 20, clientY: t ? Number(t[2]) + 4 : 20,
  }));
  await sleep(60);
};
const pressKey = async (key, target = window.document.body) => {
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await sleep(60);
};
const saveAndReopen = async () => {
  const before = captured.length;
  $('btn-save-vsdx').click();
  if (!await waitFor(() => captured.length > before)) return false;
  const bytes = Buffer.from(await captured.at(-1).arrayBuffer());
  await dropFile(new window.File([bytes], 'reopened.vsdx'));
  return true;
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app delete: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'delete.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + errorText());
const startingIds = topLevel();
check('found shapes to delete', startingIds.length >= 3, startingIds.join(','));

// --- 1. The menu offers it --------------------------------------------------
const victim = startingIds[0];
await clickShape(victim);
await rightClick(victim);
check('the context menu opened', $('shape-context-menu').classList.contains('visible'));
check('there is a Delete button', !!$('shape-arrange-delete'));
check('it is in the Arrange section, with the other selection actions',
  $('shape-arrange-section').contains($('shape-arrange-delete')));
check('it reads "Delete" for one shape', $('shape-arrange-delete').textContent === 'Delete',
  $('shape-arrange-delete').textContent);
check('and names the shape it would delete',
  /delete/i.test($('shape-arrange-delete').title), $('shape-arrange-delete').title);

// --- 2. Clicking it deletes, for real --------------------------------------
$('shape-arrange-delete').click();
const deletedOk = await waitFor(() => !topLevel().includes(victim));
check('clicking Delete removes the shape', deletedOk, `${topLevel().join(',')} · ${errorText()}`);
check('and only that shape', topLevel().length === startingIds.length - 1,
  `${topLevel().join(',')} vs ${startingIds.join(',')}`);
check('the menu closed behind it', !$('shape-context-menu').classList.contains('visible'));
check('and nothing is selected any more', selected().length === 0, selected().join(','));

check('the delete survives a save and reopen', await saveAndReopen(), errorText());
check('the shape did not come back', !topLevel().includes(victim), topLevel().join(','));
const afterOne = topLevel();

// --- 3. The Delete key ------------------------------------------------------
const keyVictim = afterOne[0];
await clickShape(keyVictim);
check('a shape is selected to delete with the keyboard', selected().includes(keyVictim), selected().join(','));
await pressKey('Delete');
const keyOk = await waitFor(() => !topLevel().includes(keyVictim));
check('the Delete key deletes the selection', keyOk, `${topLevel().join(',')} · ${errorText()}`);

// Backspace does the same, since that is the key half of everyone reaches for.
const backVictim = topLevel()[0];
await clickShape(backVictim);
await pressKey('Backspace');
const backOk = await waitFor(() => !topLevel().includes(backVictim));
check('so does Backspace', backOk, `${topLevel().join(',')} · ${errorText()}`);

// --- 4. It leaves the typing keys alone ------------------------------------
const survivor = topLevel()[0];
await clickShape(survivor);
const countBeforeTyping = topLevel().length;
await pressKey('Delete', $('layer-filter-text'));
await sleep(80);
check('Delete inside a text box does not delete the shape',
  topLevel().length === countBeforeTyping && topLevel().includes(survivor), topLevel().join(','));
await pressKey('Backspace', $('layer-filter-text'));
await sleep(80);
check('nor does Backspace', topLevel().includes(survivor), topLevel().join(','));

// --- 5. Several at once, and a group takes its children --------------------
await dropFile(new window.File([readFileSync(fixture)], 'delete-again.vsdx'));
const freshIds = topLevel();
await clickShape(freshIds[0]);
await clickShape(freshIds[1], true);
await rightClick(freshIds[1]);
check('the button counts a multiple selection',
  $('shape-arrange-delete').textContent === 'Delete 2 shapes', $('shape-arrange-delete').textContent);
$('shape-arrange-group').click();
const groupedOk = await waitFor(() => topLevel().length === freshIds.length - 1);
check('two shapes grouped, to check a group takes its children', groupedOk, errorText());
const newGroupId = topLevel().find(id => !freshIds.includes(id));

await clickShape(newGroupId);
await rightClick(newGroupId);
$('shape-arrange-delete').click();
const groupGoneOk = await waitFor(() => !topLevel().includes(newGroupId));
check('deleting a group removes the group', groupGoneOk, `${topLevel().join(',')} · ${errorText()}`);
check('and the shapes that were inside it',
  !allIds().includes(freshIds[0]) && !allIds().includes(freshIds[1]), allIds().join(','));
check('and left everything else', topLevel().length === freshIds.length - 2,
  `${topLevel().join(',')} vs ${freshIds.join(',')}`);
check('that survives a save and reopen too', await saveAndReopen(), errorText());
check('with the group still gone', !allIds().includes(newGroupId), allIds().join(','));

// --- 6. The Shape Tree's ✕ ---------------------------------------------------
// It used to splice the shape out of the page in memory only, so the drawing
// looked right and the saved file still had the shape in it.
await dropFile(new window.File([readFileSync(fixture)], 'delete-tree.vsdx'));
const treeIds = topLevel();
await clickShape(treeIds[1]);
const treeRows = [...window.document.querySelectorAll('#shape-tree-body .shape-tree-node')];
check('the Shape Tree has rows', treeRows.length > 0, String(treeRows.length));
const removable = treeRows
  .map(row => ({ row, del: row.querySelector('.shape-tree-delete') }))
  .find(entry => entry.del && !entry.del.disabled);
check('one of them offers a delete', !!removable);
if (removable) {
  const before = topLevel().length;
  removable.del.click();
  const treeDeleted = await waitFor(() => topLevel().length === before - 1);
  check('the ✕ deletes the shape', treeDeleted, `${topLevel().join(',')} · ${errorText()}`);
  const remaining = topLevel();
  check('and it stays deleted through a save and reopen', await saveAndReopen(), errorText());
  check('the saved file has the same shapes the screen showed',
    topLevel().join(',') === remaining.join(','), `${topLevel().join(',')} vs ${remaining.join(',')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
