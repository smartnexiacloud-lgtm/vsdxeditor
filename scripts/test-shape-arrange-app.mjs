// End-to-end test against the REAL built app (dist/) for selecting several
// shapes and arranging them from the right-click menu: group, ungroup, bring to
// front, send to back. The geometry is checked elsewhere (test-shape-arrange);
// what matters here is that the selection, the menu and the buttons actually
// wire up to it, and that the result survives a save and reopen.
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
    // jsdom has no layout, so it does not implement scrollIntoView; the app
    // calls it when a click focuses the shape's layer row.
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
  await waitFor(() => currentSvg() && currentSvg() !== previous);
};

const errorText = () => $('error-box')?.textContent.trim() || '';
// Only the shapes drawn straight onto the page — a group's members stop being
// direct children of the <svg> the moment they are grouped, which is exactly
// what this test is looking for.
const topLevel = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'));
const groupEl = (id) => window.document.querySelector(`#svg-container svg g[data-shape-id="${id}"]`);
const childIdsOf = (id) => [...(groupEl(id)?.querySelectorAll(':scope > g[data-shape-id]') || [])]
  .map(g => g.getAttribute('data-shape-id'));
// A plain translate() puts the group's origin at (tx, ty) in client pixels at
// zoom 1, which is how the right-click gets coordinates it can resolve.
const translated = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => ({ g, id: g.getAttribute('data-shape-id'), t: /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(g.getAttribute('transform') || '') }))
  .filter(entry => entry.t);

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
const outlined = () => [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
  .filter(g => (g.style.outline || '').includes('#e94560'))
  .map(g => g.getAttribute('data-shape-id'));
const menuOpen = () => $('shape-context-menu').classList.contains('visible');
const arrangeVisible = () => !$('shape-arrange-section').hidden;

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app arrange: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'arrange.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + errorText());

const pickable = translated().map(entry => entry.id);
check('found at least two shapes to work with', pickable.length >= 2, pickable.join(','));
if (pickable.length < 2) { console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); }
const [first, second] = pickable;
const startingIds = topLevel();
const startingCount = startingIds.length;

// --- 1. Selecting more than one shape --------------------------------------
await clickShape(first);
check('clicking a shape selects it alone', outlined().join(',') === first, outlined().join(','));
await clickShape(second, true);
check('ctrl-clicking a second shape adds it',
  outlined().length === 2 && outlined().includes(first) && outlined().includes(second),
  outlined().join(','));
await clickShape(second, true);
check('ctrl-clicking it again drops it', outlined().join(',') === first, outlined().join(','));
await clickShape(second, true);

// --- 2. The menu offers the arrange actions --------------------------------
await rightClick(second);
check('right-clicking inside the selection keeps it',
  outlined().length === 2, outlined().join(','));
check('the context menu opened', menuOpen());
check('it has an Arrange section', arrangeVisible());
check('which says how many shapes are selected',
  $('shape-arrange-hint').textContent.includes('2 shapes'), $('shape-arrange-hint').textContent);
check('Group is offered', !$('shape-arrange-group').disabled);
check('Ungroup is not, since nothing selected is a group', $('shape-arrange-ungroup').disabled);

// --- 3. Group --------------------------------------------------------------
$('shape-arrange-group').click();
const groupedOk = await waitFor(() => topLevel().length === startingCount - 1);
check('grouping two shapes leaves one shape where there were two', groupedOk,
  `${topLevel().length} vs ${startingCount} · ${errorText()}`);
const newGroupId = topLevel().find(id => !startingIds.includes(id));
check('a new group appeared on the page', !!newGroupId, topLevel().join(','));
check('and both shapes are inside it',
  childIdsOf(newGroupId).includes(first) && childIdsOf(newGroupId).includes(second),
  childIdsOf(newGroupId).join(','));
check('the new group is what is selected now', outlined().includes(newGroupId), outlined().join(','));

// --- 4. It is in the file, not just on screen ------------------------------
const before = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > before);
check('Save produced a file', captured.length > before);
const savedBytes = Buffer.from(await captured.at(-1).arrayBuffer());
window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([savedBytes], 'arrange-reopened.vsdx'));
check('the reopened drawing renders', !!currentSvg()?.querySelector('g[data-shape-id]'));
check('the group came back with its shapes in it',
  childIdsOf(newGroupId).includes(first) && childIdsOf(newGroupId).includes(second),
  childIdsOf(newGroupId).join(','));

// --- 5. Ungroup ------------------------------------------------------------
await clickShape(newGroupId);
await rightClick(newGroupId);
check('Ungroup is offered for a group', !$('shape-arrange-ungroup').disabled);
$('shape-arrange-ungroup').click();
const ungroupedOk = await waitFor(() => topLevel().includes(first) && topLevel().includes(second));
check('ungrouping puts the shapes back on the page', ungroupedOk, `${topLevel().join(',')} · ${errorText()}`);
check('and the group itself is gone', !topLevel().includes(newGroupId), topLevel().join(','));
check('the page is the size it started', topLevel().length === startingCount, `${topLevel().length} vs ${startingCount}`);

// --- 6. Z-order ------------------------------------------------------------
await clickShape(first);
await rightClick(first);
check('the Arrange section shows for a single shape too', arrangeVisible());
$('shape-arrange-front').click();
const frontOk = await waitFor(() => topLevel().at(-1) === first);
check('Bring to front draws the shape last', frontOk, `${topLevel().join(',')} · ${errorText()}`);

await clickShape(first);
await rightClick(first);
$('shape-arrange-back').click();
const backOk = await waitFor(() => topLevel()[0] === first);
check('Send to back draws it first', backOk, `${topLevel().join(',')} · ${errorText()}`);
check('and nothing was lost on the way', topLevel().length === startingCount, topLevel().join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
