// End-to-end test against the REAL built app (dist/) for the layers pane as a
// piece of UI rather than as a feature: its tools fold away, its width is the
// user's, and a change to what is shown can be taken back. Also covers the one
// thing the pane got wrong that no feature test could see — closing a tab and
// then pruning the drawing brought every closed tab back, because the prune
// re-parsed bytes that still had the pages in them.
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

let promptReply = 'New layer';
const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => promptReply;
    window.confirm = () => true;
    window.alert = () => {};
    if (!window.CSS) window.CSS = {};
    if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
  },
});
const { window } = dom;
window.HTMLAnchorElement.prototype.click = function () {};

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

const sectionBody = (name) => window.document.querySelector(`[data-section-body="${name}"]`);
const sectionToggle = (name) => window.document.querySelector(`[data-section-toggle="${name}"]`);
const sectionBadge = (name) => window.document.querySelector(`[data-section-badge="${name}"]`)?.textContent;
const layerItems = () => [...window.document.querySelectorAll('#layers-list .layer-item')];
const boxes = () => layerItems().map(i => i.querySelector('input[type=checkbox]').checked);
const shownCount = () => boxes().filter(Boolean).length;
const tabs = () => [...window.document.querySelectorAll('#page-tabs .page-tab')];
const press = (key, opts = {}) => window.dispatchEvent(
  new window.KeyboardEvent('keydown', { key, bubbles: true, ...opts }));

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app layers pane: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'layers-ui.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);
$('btn-layers').click();
await sleep(30);

// --- 1. The tools fold away ------------------------------------------------
// Searching layers, searching shapes, picking a delimiter and saving a view are
// each occasional. None of them should be taking room from the list by default.
const SECTIONS = ['filter', 'find', 'grouping', 'views'];
check('every tool section exists', SECTIONS.every(name => !!sectionBody(name)),
  SECTIONS.filter(name => !sectionBody(name)).join(','));
check('and every one of them starts folded',
  SECTIONS.every(name => sectionBody(name).hidden === true),
  SECTIONS.filter(name => !sectionBody(name).hidden).join(','));

sectionToggle('filter').click();
await sleep(20);
check('clicking a heading opens that section', sectionBody('filter').hidden === false);
check('and says so for a screen reader',
  sectionToggle('filter').getAttribute('aria-expanded') === 'true');
check('the others stay folded', sectionBody('grouping').hidden === true);
sectionToggle('filter').click();
await sleep(20);
check('clicking it again folds it back', sectionBody('filter').hidden === true);

// A folded section still has to admit what it is doing, or a filter left on
// looks like a drawing that lost its layers.
sectionToggle('filter').click();
$('layer-filter-text').value = 'zzz-no-such-layer';
$('layer-filter-text').dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(40);
check('a filter that is on shows up on its heading',
  (sectionBadge('filter') || '').includes('zzz-no-such-layer'), sectionBadge('filter'));
$('layer-filter-text').value = '';
$('layer-filter-text').dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(40);
check('and the heading is quiet again once it is off', !sectionBadge('filter'), sectionBadge('filter'));

// --- 2. The delimiter box is a box you can type in -------------------------
// It used to be a shrinkable 34px input in a 220px pane sharing a row with a
// label and a button, which squeezed it to a sliver nobody could click into.
sectionToggle('grouping').click();
await sleep(20);
const delimiter = $('layer-tree-delimiter');
check('the delimiter box is enabled', !delimiter.disabled && !delimiter.readOnly);
check('and the stylesheet pins its width instead of letting it shrink',
  /#layer-tree-delimiter\s*\{[^}]*flex:\s*0 0/.test(html) && /#layer-tree-delimiter\s*\{[^}]*min-width/.test(html));
check('it sits on a row of its own, not wedged beside the label and button',
  !!delimiter.closest('.layers-tree-row')
  && !delimiter.closest('.layers-tree-row').querySelector('button'));

$('layer-tree-enable').checked = true;
$('layer-tree-enable').dispatchEvent(new window.Event('change', { bubbles: true }));
delimiter.value = '::';
delimiter.dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(40);
check('typing a delimiter is taken as typed',
  (sectionBadge('grouping') || '').includes('::'), sectionBadge('grouping'));
check('and the box keeps what was typed in it', delimiter.value === '::', delimiter.value);
$('layer-tree-enable').checked = false;
$('layer-tree-enable').dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(30);

// --- 3. The pane is as wide as you drag it ---------------------------------
const resizer = $('layers-resizer');
check('the pane has a drag handle', !!resizer);
const widthBefore = $('layers-sidebar').style.width;
resizer.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 240 }));
window.document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 420 }));
window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
await sleep(20);
check('dragging it widens the pane', $('layers-sidebar').style.width === '420px',
  `${widthBefore} → ${$('layers-sidebar').style.width}`);
check('and the pane cannot be dragged narrower than its own controls',
  (() => {
    resizer.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 420 }));
    window.document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 10 }));
    window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    return parseInt($('layers-sidebar').style.width, 10) >= 160;
  })(), $('layers-sidebar').style.width);
check('a drag that ended is over',
  (() => {
    const before = $('layers-sidebar').style.width;
    window.document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 600 }));
    return $('layers-sidebar').style.width === before;
  })(), $('layers-sidebar').style.width);

// --- 4. Hiding everything can be taken back --------------------------------
// "Hide all" is one click; undoing it by hand is one click per layer.
const total = layerItems().length;
check('the sidebar has layers to hide', total >= 1, `${total} rows`);
check('they all start shown', shownCount() === total, `${shownCount()}/${total}`);

$('layers-deselect-all').click();
await sleep(30);
check('Hide all hides them', shownCount() === 0, `${shownCount()}/${total}`);

press('z', { ctrlKey: true });
await sleep(30);
check('Ctrl+Z brings them back', shownCount() === total, `${shownCount()}/${total}`);

press('z', { ctrlKey: true, shiftKey: true });
await sleep(30);
check('Ctrl+Shift+Z hides them again', shownCount() === 0, `${shownCount()}/${total}`);
press('y', { ctrlKey: true });
await sleep(30);
check('and a redo past the end is refused rather than guessed',
  shownCount() === 0 && /Nothing to redo/i.test($('error-box').textContent), $('error-box').textContent);

press('z', { ctrlKey: true });
await sleep(30);
check('undo works after a redo too', shownCount() === total, `${shownCount()}/${total}`);

// A single toggle is undoable as well, and undo does not reach past the page.
const firstBox = layerItems()[0].querySelector('input[type=checkbox]');
firstBox.checked = false;
firstBox.dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(30);
check('one layer hidden by hand', shownCount() === total - 1, `${shownCount()}/${total}`);
press('z', { ctrlKey: true });
await sleep(30);
check('and that single toggle undoes too', shownCount() === total, `${shownCount()}/${total}`);

// Typing in a box is the browser's undo, not ours.
$('layer-filter-text').value = 'text';
$('layer-filter-text').dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(30);
$('layers-deselect-all').click();
await sleep(30);
const hiddenNow = shownCount();
$('layer-filter-text').dispatchEvent(new window.KeyboardEvent('keydown',
  { key: 'z', ctrlKey: true, bubbles: true }));
await sleep(30);
check('Ctrl+Z inside a text box is left to the browser', shownCount() === hiddenNow,
  `${shownCount()} vs ${hiddenNow}`);
$('layer-filter-text').value = '';
$('layer-filter-text').dispatchEvent(new window.Event('input', { bubbles: true }));
press('z', { ctrlKey: true });
await sleep(30);

// --- 5. A closed tab stays closed through a prune --------------------------
const tabCount = tabs().length;
if (tabCount >= 2) {
  const closingName = tabs()[1].querySelector('.page-tab-label').textContent;
  tabs()[1].querySelector('.page-tab-close').click();
  await sleep(80);
  check('closing a tab closes it', tabs().length === tabCount - 1,
    tabs().map(t => t.querySelector('.page-tab-label').textContent).join(','));

  // Remove Non-selected needs something selected and something not.
  const rows = layerItems();
  if (rows.length >= 2) {
    const box = rows[0].querySelector('input[type=checkbox]');
    box.checked = false;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(30);

    const svgBefore = currentSvg();
    $('error-box').textContent = '';
    $('btn-remove-non-selected').click();
    const pruned = await waitFor(() => currentSvg() && currentSvg() !== svgBefore);
    check('Remove Non-selected ran', pruned, $('error-box').textContent);
    check('and the closed tab stayed closed', tabs().length === tabCount - 1,
      tabs().map(t => t.querySelector('.page-tab-label').textContent).join(','));
    check('the page that was closed is really gone',
      !tabs().some(t => t.querySelector('.page-tab-label').textContent === closingName),
      closingName);
  } else {
    check('fixture has two layers to prune between', false, `${rows.length} layers`);
  }
} else {
  check('fixture has two pages to close between', false, `${tabCount} tabs`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
