// End-to-end test against the REAL built app (dist/): the Shape Tree and the
// Layers sidebar describing the same drawing the same way.
//
// The two panes used to disagree. Marking a layer said nothing to the tree, so
// walking down the layer rows left the tree listing the whole page regardless;
// and picking a shape in the tree — alone among every list in the app — left
// the Layers sidebar marking whatever it had been marking before. This checks
// both directions, and that the tree is the whole page again whenever there is
// no marked layer on screen to follow.
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
const errorText = () => $('error-box')?.textContent.trim() || '';
const dropFile = async (file) => {
  if ($('error-box')) $('error-box').textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  await waitFor(() => currentSvg() && currentSvg() !== previous
    && currentSvg().querySelector('g[data-shape-id]'));
};

const treeRows = () => [...window.document.querySelectorAll('#shape-tree-body .shape-tree-node')];
const treeIds = () => treeRows().map(row => row.dataset.shapeId).sort();
const treeRow = (id) => treeRows().find(row => row.dataset.shapeId === String(id));
const drawnIds = () => [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id')).sort();
const groupEl = (id) => q(`#svg-container svg g[data-shape-id="${id}"]`);
const layerItems = () => [...window.document.querySelectorAll('#layers-list .layer-item')];
const layerItem = (name) => layerItems().find(i => i.querySelector('.layer-name')?.textContent === name);
const markedLayer = () => layerItems().find(i => i.classList.contains('focused'))
  ?.querySelector('.layer-name')?.textContent ?? null;
const markLayer = async (name) => {
  layerItem(name)?.dispatchEvent(new window.MouseEvent('focus', { bubbles: false }));
  await sleep(60);
};
const subtitle = () => $('shape-tree-subtitle').textContent;

const fixture = process.argv[2] || 'test-files/test3_house.vsdx';
console.log(`── in-app shape tree ⇄ layers: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'tree-layers.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + errorText());

// --- 1. Put part of the drawing on a layer of its own ----------------------
// The fixture is entirely unlayered, which makes for a poor question. A group
// gets a layer from the canvas menu, and — this is the point of choosing a
// group — its children inherit it without carrying any membership of their own.
const nested = [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => ({ g, id: g.getAttribute('data-shape-id') }))
  .find(entry => entry.g.querySelector('g[data-shape-id]'));
check('the drawing has a group to put on a layer', !!nested);
if (!nested) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
const insideGroup = [nested.id, ...[...nested.g.querySelectorAll('g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'))].sort();
check('and the group has shapes inside it', insideGroup.length > 1, insideGroup.join(','));

const transform = /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(nested.g.getAttribute('transform') || '');
nested.g.dispatchEvent(new window.MouseEvent('contextmenu', {
  bubbles: true, cancelable: true,
  clientX: Number(transform?.[1] || 0) + 4, clientY: Number(transform?.[2] || 0) + 4,
}));
await sleep(60);
promptReply = 'Walls';
$('shape-context-new-layer').click();
await waitFor(() => !!layerItem('Walls'));
check('the group is on a layer of its own now', !!layerItem('Walls'),
  layerItems().map(i => i.querySelector('.layer-name').textContent).join(','));
// Re-queried: putting the group on a layer redraws the page, so the element
// captured before it is not on screen any more.
const groupNow = groupEl(nested.id);
check('and only the group carries the membership, its children inherit it',
  (groupNow.getAttribute('data-layers') || '').split(',').filter(Boolean).length === 1
  && [...groupNow.querySelectorAll('g[data-layers]')].length === 0,
  groupNow.getAttribute('data-layers'));

// --- 2. Clicking a shape marks its layer, and the tree follows the mark ----
const elsewhere = [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .find(g => g.getAttribute('data-shape-id') !== nested.id);
const unlayeredIds = drawnIds().filter(id => !insideGroup.includes(id));
elsewhere.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('the tree opened on the selection', $('shape-tree-sidebar').classList.contains('visible'));
check('and the click opened the layers pane onto the shape\'s layer',
  $('layers-sidebar').classList.contains('visible') && markedLayer() === 'Unlayered',
  String(markedLayer()));
check('so the tree lists what is on that layer',
  JSON.stringify(treeIds()) === JSON.stringify(unlayeredIds),
  `${treeIds().join(',')} vs ${unlayeredIds.join(',')}`);

// --- 2b. Shut the pane and there is no mark left to follow -----------------
$('btn-layers').click();
await sleep(80);
check('with the pane shut the tree is the whole page',
  JSON.stringify(treeIds()) === JSON.stringify(drawnIds()),
  `${treeIds().join(',')} vs ${drawnIds().join(',')}`);

// --- 3. Opening it again brings the mark, and the tree, back --------------
$('btn-layers').click();
await sleep(80);
check('the layers pane is open', $('layers-sidebar').classList.contains('visible'));
await markLayer('Walls');
check('"Walls" is the marked layer', markedLayer() === 'Walls', String(markedLayer()));
check('the tree lists exactly what is on it — the group and its contents',
  JSON.stringify(treeIds()) === JSON.stringify(insideGroup),
  `${treeIds().join(',')} vs ${insideGroup.join(',')}`);
check('and says so, so a shorter list is not a drawing that lost shapes',
  /of \d+ shapes on Walls/.test(subtitle()), subtitle());

// --- 4. Going to another layer takes the tree with you ---------------------
const outsideGroup = drawnIds().filter(id => !insideGroup.includes(id));
await markLayer('Unlayered');
check('"Unlayered" is the marked layer now', markedLayer() === 'Unlayered', String(markedLayer()));
check('and the tree changed to what is on that one',
  JSON.stringify(treeIds()) === JSON.stringify(outsideGroup.sort()),
  `${treeIds().join(',')} vs ${outsideGroup.join(',')}`);

// --- 5. Following can be turned off, and comes back on ---------------------
$('shape-tree-follow-layer').checked = false;
$('shape-tree-follow-layer').dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(60);
check('unfollowing lists the whole page again with the pane still open',
  JSON.stringify(treeIds()) === JSON.stringify(drawnIds()),
  `${treeIds().join(',')} vs ${drawnIds().join(',')}`);
check('and the subtitle stops naming a layer', !/on Unlayered/.test(subtitle()), subtitle());

// --- 6. Picking a shape in the tree marks the layer it is on ---------------
// Done with following off, so the row for a shape on another layer is there to
// be clicked in the first place.
check('the marked layer is not the one the group is on', markedLayer() === 'Unlayered');
treeRow(nested.id).querySelector('.shape-tree-label')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('clicking a tree row marks that shape\'s layer', markedLayer() === 'Walls', String(markedLayer()));

const child = insideGroup.find(id => id !== nested.id);
await markLayer('Unlayered');
treeRow(child).querySelector('.shape-tree-label')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('a shape inside the group marks the layer it inherits, not Unlayered',
  markedLayer() === 'Walls', String(markedLayer()));

// --- 7. The keyboard walks the tree without losing the keyboard ------------
$('shape-tree-follow-layer').checked = true;
$('shape-tree-follow-layer').dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(60);
check('following again filters back to the marked layer',
  JSON.stringify(treeIds()) === JSON.stringify(insideGroup),
  `${treeIds().join(',')} vs ${insideGroup.join(',')}`);

const cursor = treeRow(insideGroup[insideGroup.length - 1]);
cursor.focus();
$('shape-tree-body').dispatchEvent(new window.KeyboardEvent('keydown', {
  key: 'ArrowDown', bubbles: true, cancelable: true,
}));
await sleep(40);
$('shape-tree-body').dispatchEvent(new window.KeyboardEvent('keydown', {
  key: 'Enter', bubbles: true, cancelable: true,
}));
await sleep(80);
check('Enter on a row marks its layer too', markedLayer() === 'Walls', String(markedLayer()));
check('and the keyboard stays in the tree it is walking',
  $('shape-tree-body').contains(window.document.activeElement),
  window.document.activeElement?.className || String(window.document.activeElement?.tagName));

// --- 8. A folded group is unfolded to show what is on the layer ------------
$('shape-tree-follow-layer').checked = false;
$('shape-tree-follow-layer').dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(60);
$('shape-tree-collapse-all').click();
await sleep(60);
check('with every group folded, the shapes inside the group have no rows',
  insideGroup.filter(id => treeRow(id)).length === 1,
  treeIds().join(','));
$('shape-tree-follow-layer').checked = true;
$('shape-tree-follow-layer').dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(80);
check('following the layer unfolds the groups its shapes are buried under',
  JSON.stringify(treeIds()) === JSON.stringify(insideGroup),
  `${treeIds().join(',')} vs ${insideGroup.join(',')}`);

// --- 9. A layer switched off takes its shapes out of the lists ------------
// Not a filter this time: the shapes are not on the canvas, so they are not
// offered anywhere you would pick a shape from the drawing, whatever is marked.
$('shape-tree-follow-layer').checked = false;
$('shape-tree-follow-layer').dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(60);
$('shape-tree-expand-all').click();
await sleep(60);
// Selected off the layer under test, so the tree still has a reason to be open
// once that layer goes — it closes with nothing selected, as it always has.
elsewhere.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('the whole page is listed to start from',
  JSON.stringify(treeIds()) === JSON.stringify(drawnIds()),
  `${treeIds().join(',')} vs ${drawnIds().join(',')}`);

const search = async (query) => {
  $('shape-search').value = query;
  $('shape-search').dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(260);
  return [...window.document.querySelectorAll("#layer-objects-list .layer-object-row")]
    .map(row => row.dataset.shapeId);
};
check('the search box finds the group while its layer is on',
  (await search(`#${nested.id}`)).includes(nested.id));

const wallsBox = () => layerItem('Walls').querySelector('input[type=checkbox]');
const switchWalls = async (on) => {
  wallsBox().checked = on;
  wallsBox().dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(80);
};
await switchWalls(false);
check('the tree drops the shapes on the layer that was switched off',
  JSON.stringify(treeIds()) === JSON.stringify(unlayeredIds),
  `${treeIds().join(',')} vs ${unlayeredIds.join(',')}`);
check('and counts what it is showing, not what the page holds',
  new RegExp(`\\b${unlayeredIds.length} of ${drawnIds().length} shapes\\b`).test(subtitle()), subtitle());
check('and the search box stops finding it too',
  !(await search(`#${nested.id}`)).includes(nested.id));
await search('');

// --- 10. And gives up a selection that went with the layer ----------------
await switchWalls(true);
check('turning the layer back on brings its shapes back to the tree',
  insideGroup.every(id => !!treeRow(id)), treeIds().join(','));
treeRow(nested.id).querySelector('.shape-tree-label')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('a shape on the layer is the selection now',
  q('#svg-container svg g[data-shape-id][data-selected]')?.getAttribute('data-shape-id') === nested.id,
  String(q('#svg-container svg g[data-shape-id][data-selected]')?.getAttribute('data-shape-id')));
await switchWalls(false);
check('switching its layer off gives up the selection with it',
  !q('#svg-container svg g[data-shape-id][data-selected]'),
  String(q('#svg-container svg g[data-shape-id][data-selected]')?.getAttribute('data-shape-id')));
await switchWalls(true);

// --- 10b. And stops offering it under the cursor --------------------------
// Hit-testing is geometry, and geometry does not know about layer switches: the
// box is still where it was. *Select component* would go on offering it.
// What the list is *offering*: with nothing to offer the section is hidden, and
// the rows of the last thing it offered are left in it out of sight.
const pickIds = () => ($('shape-pick-section').hidden
  ? []
  : [...window.document.querySelectorAll('#shape-pick-list .shape-pick-row')]
    .map(row => row.dataset.shapeId));
const rightClickGroup = async () => {
  $('shape-context-menu').classList.remove('visible');
  const g = groupEl(nested.id);
  const at = /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(g?.getAttribute('transform') || '');
  g?.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Number(at?.[1] || 0) + 4, clientY: Number(at?.[2] || 0) + 4,
  }));
  await sleep(80);
  return pickIds();
};
const offered = await rightClickGroup();
check('Select component offers the group while its layer is on',
  offered.includes(nested.id), offered.join(','));
await switchWalls(false);
const offeredHidden = await rightClickGroup();
check('and offers nothing from that layer once it is switched off',
  insideGroup.every(id => !offeredHidden.includes(id)), offeredHidden.join(','));
$('shape-context-menu').classList.remove('visible');
await switchWalls(true);

// Something has to be selected for the tree to be open at all, and section 10
// deliberately took the selection away.
elsewhere.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);

// --- 11. Shutting the pane gives the whole page back ----------------------
$('btn-layers').click();
await sleep(80);
check('the layers pane is shut', !$('layers-sidebar').classList.contains('visible'));
// Section 8 left groups folded that the layer had no reason to open, and a
// folded group is a folded group whoever is following what.
$('shape-tree-expand-all').click();
await sleep(60);
check('and with no marked layer on screen the tree is the whole page',
  JSON.stringify(treeIds()) === JSON.stringify(drawnIds()),
  `${treeIds().join(',')} vs ${drawnIds().join(',')}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
