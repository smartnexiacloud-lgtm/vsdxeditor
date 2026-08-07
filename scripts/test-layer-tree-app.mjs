// End-to-end test of the delimiter tree against the REAL built app (dist/).
// Visio layers are flat, so no fixture ships with hierarchical names — the test
// creates "Electrical/HV", "Electrical/LV", "Plumbing/Cold" through the app's
// own new-layer button, then turns the grouping on and drives it the way a user
// would: collapse, group checkboxes, a different delimiter, renaming a group
// (which re-prefixes every layer under it), and back to flat. Finally it saves
// and reopens to prove the renames are real layer names in the file and the
// tree was only ever a view. Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

let promptReply = '';
const alerts = [];
const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => promptReply;
    window.confirm = () => true;
    window.alert = (message) => alerts.push(String(message));
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

// Group rows are deliberately NOT .layer-item, so keyboard navigation and every
// existing test's idea of "a layer row" ignore them.
const layerItems = () => [...window.document.querySelectorAll('#layers-list .layer-item')];
const layerNames = () => layerItems().map(i => i.querySelector('.layer-name')?.textContent);
const layerTitles = () => layerItems().map(i => i.querySelector('.layer-name')?.title);
const layerItem = (name) => layerItems().find(i => i.querySelector('.layer-name')?.textContent === name);
const groupRows = () => [...window.document.querySelectorAll('#layers-list .layer-group-item')];
const groupNames = () => groupRows().map(i => i.querySelector('.layer-group-name')?.textContent);
const groupRow = (name) => groupRows().find(i => i.querySelector('.layer-group-name')?.textContent === name);
// The rows in the order they are drawn, groups included, so nesting order is
// checkable rather than just membership.
const rowOrder = () => [...window.document.querySelectorAll('#layers-list > div')]
  .map(el => el.classList.contains('layer-group-item')
    ? `[${el.querySelector('.layer-group-name').textContent}]`
    : el.querySelector('.layer-name').textContent);
const indent = (el) => parseInt(el.style.paddingLeft || '0', 10) || 0;
// One menu per row, whichever kind of row it is, with the rename on it. This
// hands back a click()-able stand-in so the checks below still read as
// "click the rename on this row".
const renameButton = (row) => {
  const button = row?.querySelector('.layer-menu-btn');
  if (!button) return null;
  return {
    click: () => {
      button.click();
      const entry = $('layer-context-menu').querySelector('[data-layer-action="rename"]');
      if (!entry.disabled) entry.click();
    },
  };
};
// The rows drawn between a group and the next row at its own indent.
const layersUnderRow = (group) => {
  const rows = [...window.document.querySelectorAll('#layers-list > div')];
  const start = rows.indexOf(groupRow(group));
  if (start < 0) return [];
  const depth = indent(rows[start]);
  const out = [];
  for (const row of rows.slice(start + 1)) {
    if (indent(row) <= depth) break;
    out.push(row.querySelector('.layer-name, .layer-group-name').textContent);
  }
  return out;
};

const addLayer = async (name) => {
  promptReply = name;
  $('layers-add').click();
  await sleep(40);
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app layer tree: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'tree.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);

const startingNames = layerNames();
for (const name of ['Electrical/HV', 'Electrical/LV', 'Plumbing/Cold', 'Standalone']) await addLayer(name);
check('the delimited layers were created',
  ['Electrical/HV', 'Electrical/LV', 'Plumbing/Cold', 'Standalone'].every(n => layerNames().includes(n)),
  layerNames().join(','));

// --- 1. Off by default -----------------------------------------------------
check('grouping is off until asked for', $('layer-tree-enable').checked === false);
check('so the sidebar is flat', groupRows().length === 0);
check('and layer names are shown whole', layerNames().includes('Electrical/HV'), layerNames().join(','));
check('the default delimiter is /', $('layer-tree-delimiter').value === '/');
check('collapse-all is disabled while flat', $('layer-tree-toggle-all').disabled === true);

// --- 2. Turn it on ---------------------------------------------------------
$('layer-tree-enable').checked = true;
$('layer-tree-enable').dispatchEvent(new window.Event('change'));
await sleep(40);

check('shared prefixes become group rows',
  groupNames().includes('Electrical') && groupNames().includes('Plumbing'), groupNames().join(','));
check('a group is not a layer row', !layerNames().includes('Electrical'), layerNames().join(','));
check('leaves are shown by their last segment only',
  layerNames().includes('HV') && layerNames().includes('LV') && !layerNames().includes('Electrical/HV'),
  layerNames().join(','));
check('but the full name is still on the row as a tooltip',
  layerTitles().includes('Electrical/HV'), layerTitles().join(','));
check('children follow their group in order',
  rowOrder().join(' ').includes('[Electrical] HV LV'), rowOrder().join(' '));
check('a layer with no delimiter stays at the top level',
  layerNames().includes('Standalone'));
check('every layer still has exactly one row',
  layerItems().length === startingNames.length + 4, `${layerItems().length}`);
check('children are indented past their group',
  indent(layerItem('HV')) > indent(groupRow('Electrical')),
  `${indent(layerItem('HV'))} vs ${indent(groupRow('Electrical'))}`);
check('a group counts what is under it',
  groupRow('Electrical').querySelector('.layer-group-count').textContent === '2/2',
  groupRow('Electrical').querySelector('.layer-group-count').textContent);

// --- 3. Collapse and expand ------------------------------------------------
groupRow('Electrical').querySelector('.layer-twisty').click();
await sleep(40);
check('collapsing hides the children', !layerNames().includes('HV') && !layerNames().includes('LV'),
  layerNames().join(','));
check('but keeps the group itself', groupNames().includes('Electrical'));
check('and leaves other groups alone', layerNames().includes('Cold'), layerNames().join(','));

groupRow('Electrical').querySelector('.layer-group-name').click();
await sleep(40);
check('clicking the group name expands it again', layerNames().includes('HV'), layerNames().join(','));

$('layer-tree-toggle-all').click();
await sleep(40);
check('collapse all hides every child',
  !layerNames().includes('HV') && !layerNames().includes('Cold'), layerNames().join(','));
check('and the button offers the way back', $('layer-tree-toggle-all').textContent === 'Expand all');
$('layer-tree-toggle-all').click();
await sleep(40);
check('expand all brings them back', layerNames().includes('HV') && layerNames().includes('Cold'),
  layerNames().join(','));

// --- 4. A group checkbox drives everything under it ------------------------
const groupCheckbox = (name) => groupRow(name).querySelector('input[type=checkbox]');
const layerChecked = (name) => layerItem(name)?.querySelector('input[type=checkbox]').checked;

check('a full group reads as checked', groupCheckbox('Electrical').checked === true);
groupCheckbox('Electrical').checked = false;
groupCheckbox('Electrical').dispatchEvent(new window.Event('change'));
await sleep(60);
check('unchecking a group hides every layer under it',
  layerChecked('HV') === false && layerChecked('LV') === false);
check('and leaves layers outside it alone', layerChecked('Cold') === true);
check('the group now reads as unchecked', groupCheckbox('Electrical').checked === false);

layerItem('HV').querySelector('input[type=checkbox]').click();
await sleep(60);
check('a partly shown group reads as indeterminate',
  groupCheckbox('Electrical').indeterminate === true && groupCheckbox('Electrical').checked === false);
check('and its count says how many', groupCheckbox('Electrical')
  .closest('.layer-group-item').querySelector('.layer-group-count').textContent === '1/2');

groupCheckbox('Electrical').checked = true;
groupCheckbox('Electrical').dispatchEvent(new window.Event('change'));
await sleep(60);
check('checking a group shows every layer under it',
  layerChecked('HV') === true && layerChecked('LV') === true);

// --- 5. The delimiter is the user's to choose ------------------------------
$('layer-tree-delimiter').value = '.';
$('layer-tree-delimiter').dispatchEvent(new window.Event('input'));
await sleep(40);
check('a delimiter that appears in no name groups nothing', groupRows().length === 0, groupNames().join(','));
check('and the names go back to being whole',
  layerNames().includes('Electrical/HV'), layerNames().join(','));

await addLayer('Site.North');
await addLayer('Site.South');
check('grouping follows the new delimiter',
  groupNames().includes('Site') && layerNames().includes('North'),
  `${groupNames().join(',')} | ${layerNames().join(',')}`);
check('a dot delimiter is matched literally, not as a regex',
  !groupNames().includes('Electrical'), groupNames().join(','));

$('layer-tree-delimiter').value = '/';
$('layer-tree-delimiter').dispatchEvent(new window.Event('input'));
await sleep(40);
check('switching back regroups on /', groupNames().includes('Electrical'), groupNames().join(','));
check('and the dotted names are flat again', layerNames().includes('Site.North'), layerNames().join(','));

// --- 6. Renaming a group re-prefixes every layer under it ------------------
check('a group row offers a rename', !!renameButton(groupRow('Electrical')));
check('so does a leaf row', !!renameButton(layerItem('HV')));

promptReply = 'Power';
renameButton(groupRow('Electrical')).click();
await sleep(60);
check('the group is renamed', groupNames().includes('Power') && !groupNames().includes('Electrical'),
  groupNames().join(','));
check('and every layer under it was re-prefixed',
  layerTitles().includes('Power/HV') && layerTitles().includes('Power/LV'),
  layerTitles().join(','));
check('their own segments are untouched',
  layerNames().includes('HV') && layerNames().includes('LV'), layerNames().join(','));
check('layers outside the group are untouched',
  layerTitles().includes('Plumbing/Cold') && layerTitles().includes('Standalone'),
  layerTitles().join(','));

// A new name containing the delimiter is a move: the subtree nests one deeper.
promptReply = 'Site/Power';
renameButton(groupRow('Power')).click();
await sleep(60);
check('renaming with a delimiter nests the whole subtree',
  layerTitles().includes('Site/Power/HV') && layerTitles().includes('Site/Power/LV'),
  layerTitles().join(','));
check('which shows up as a new level of grouping',
  rowOrder().join(' ').includes('[Site] [Power] HV LV'), rowOrder().join(' '));

// Two layers on a page may not share a name, and a rename can collide just as
// creating one can. Renaming a group onto another group's name is *not* a
// collision by itself — that merges the two — so this needs a full layer name
// that would end up used twice.
await addLayer('Plumbing/Power/HV');
alerts.length = 0;
promptReply = 'Plumbing';
const titlesBeforeClash = layerTitles().join(',');
renameButton(groupRow('Site')).click();
await sleep(60);
check('a rename that would collide is refused', layerTitles().join(',') === titlesBeforeClash,
  layerTitles().join(','));
check('and says why', alerts.some(m => /two layers/i.test(m)), alerts.join('|'));

alerts.length = 0;
promptReply = '   ';
renameButton(groupRow('Site')).click();
await sleep(60);
check('a blank rename is refused', layerTitles().join(',') === titlesBeforeClash);
check('and says why', alerts.some(m => /needs a name/i.test(m)), alerts.join('|'));

// A layer that is also a parent renames itself and its children together.
await addLayer('Plumbing');
check('a layer can share a name with a group', layerNames().includes('Plumbing'), layerNames().join(','));
const plumbingRow = layerItem('Plumbing');
check('and that row gets a twisty of its own', !!plumbingRow.querySelector('.layer-twisty'));
check('and a rename of its own', !!renameButton(plumbingRow));
promptReply = 'Water';
renameButton(plumbingRow).click();
await sleep(60);
check('renaming it renames the layer and its children',
  layerTitles().includes('Water') && layerTitles().includes('Water/Cold'),
  layerTitles().join(','));

// --- 6b. Moving a layer is renaming it ------------------------------------
// Nothing in the file records where a layer sits, so putting one in another
// group means giving it that group's prefix. The row's rename edits its whole
// path for exactly this reason.
promptReply = 'Site/Cold';
renameButton(layerItem('Cold')).click();
await sleep(60);
check('giving a leaf another prefix moves it',
  layerTitles().includes('Site/Cold') && !layerTitles().includes('Water/Cold'),
  layerTitles().join(','));
check('and it is drawn under its new group',
  layersUnderRow('Site').includes('Cold'), rowOrder().join(' '));
check('the group it left no longer claims it',
  groupRow('Water') === undefined || !layersUnderRow('Water').includes('Cold'),
  rowOrder().join(' '));

// Dropping every prefix moves a layer back out to the top level.
promptReply = 'Cold';
renameButton(layerItem('Cold')).click();
await sleep(60);
check('dropping the prefix moves it back to the top level',
  layerTitles().includes('Cold') && !layerTitles().includes('Site/Cold'),
  layerTitles().join(','));

// --- 7. The row context menu ----------------------------------------------
// The row buttons are faint until hovered; right-clicking a row names the same
// actions instead, and a group row's entries speak for everything under it.
const menu = () => $('layer-context-menu');
const menuVisible = () => menu().style.display === 'block';
const menuItem = (action) => menu().querySelector(`[data-layer-action="${action}"]`);
const rightClick = (row) => {
  row.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 40, clientY: 40,
  }));
};

rightClick(layerItem('Cold'));
check('right-clicking a layer row opens a menu', menuVisible());
check('named after the row it came from',
  $('layer-context-title').textContent === 'Cold', $('layer-context-title').textContent);
check('offering rename, move and tags',
  menuItem('rename').textContent === 'Rename…'
  && menuItem('move').textContent === 'Move to group…'
  && menuItem('tags').textContent === 'Edit tags…',
  [...menu().querySelectorAll('button')].map(b => b.textContent).join('|'));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
check('and Escape closes it', !menuVisible());

rightClick(groupRow('Site'));
check('a group row gets a menu of its own', menuVisible());
check('whose title counts what is under it',
  /^Site \(\d+ layers\)$/.test($('layer-context-title').textContent), $('layer-context-title').textContent);
check('and whose entries speak for the group',
  menuItem('rename').textContent === 'Rename group…'
  && menuItem('move').textContent === 'Move group…'
  && /^Add tags to \d+ layers…$/.test(menuItem('tags').textContent),
  [...menu().querySelectorAll('button')].map(b => b.textContent).join('|'));

// Moving from the menu keeps the row's own name and changes only its parent —
// unlike the rename, which hands you the whole path to retype.
rightClick(layerItem('Cold'));
promptReply = 'Water';
menuItem('move').click();
await sleep(60);
check('Move to group… files a layer under a group without renaming it',
  layerTitles().includes('Water/Cold'), layerTitles().join(','));
check('the menu closes once it has acted', !menuVisible());

rightClick(layerItem('Cold'));
promptReply = '';
menuItem('move').click();
await sleep(60);
check('and a blank answer moves it back to the top level',
  layerTitles().includes('Cold') && !layerTitles().includes('Water/Cold'), layerTitles().join(','));

// Tagging a group tags what is under it, and only ever adds: a bulk edit that
// replaced each layer's tags would be a bulk delete wearing a friendly label.
const tagsOf = (name) => [...(layerItem(name)?.querySelectorAll('.layer-tag') || [])].map(c => c.textContent);
rightClick(layerItem('HV'));
promptReply = 'as-built';
menuItem('tags').click();
await sleep(60);
check('a layer row tags just that layer', tagsOf('HV').includes('as-built'), tagsOf('HV').join(','));

rightClick(groupRow('Site'));
promptReply = 'draft';
menuItem('tags').click();
await sleep(60);
const underSite = layersUnderRow('Site').filter(n => layerItem(n));
check('tagging a group tags every layer under it',
  underSite.length > 1 && underSite.every(n => tagsOf(n).includes('draft')),
  underSite.map(n => `${n}:${tagsOf(n)}`).join(' '));
check('without dropping the tags those layers already had',
  tagsOf('HV').includes('as-built') && tagsOf('HV').includes('draft'), tagsOf('HV').join(','));

// Listing a group's shapes answers "what is in Electrical?" when Electrical is
// a naming convention rather than a layer: it is every shape on every layer
// under the row, each listed once however many of them it is on.
const objectRows = () => [...window.document.querySelectorAll('#layer-objects-list .layer-object-row')];
// The layers made above carry no shapes, so file the drawing's own layer — the
// one that does — under the group first, and put it back afterwards.
const drawnLayer = startingNames.find(name => name !== 'Unlayered');
check('the fixture has a layer with shapes on it', !!drawnLayer, startingNames.join(','));
if (drawnLayer) {
  rightClick(layerItem(drawnLayer));
  promptReply = 'Site';
  menuItem('move').click();
  await sleep(60);

  rightClick(layerItem(drawnLayer));
  menuItem('objects').click();
  await sleep(60);
  const ownShapes = objectRows().map(r => r.dataset.shapeId);
  check('a layer row lists its own shapes', ownShapes.length > 0, `${ownShapes.length} rows`);
  check('under a title naming the layer',
    $('layer-objects-title').textContent.includes(drawnLayer), $('layer-objects-title').textContent);

  rightClick(groupRow('Site'));
  check('a group row offers the same listing',
    menuItem('objects').textContent === 'List shapes under Site', menuItem('objects').textContent);
  menuItem('objects').click();
  await sleep(60);
  const siteShapes = objectRows().map(r => r.dataset.shapeId);
  check('which is titled after the group',
    $('layer-objects-title').textContent.startsWith('Site'), $('layer-objects-title').textContent);
  check('and lists every shape under it, whichever layer they sit on',
    ownShapes.length > 0 && ownShapes.every(id => siteShapes.includes(id)),
    `${ownShapes.join(',')} ⊄ ${siteShapes.join(',')}`);
  check('each shape once, however many of those layers it is on',
    new Set(siteShapes).size === siteShapes.length, siteShapes.join(','));
  $('layer-objects-close').click();
  await sleep(30);

  // --- 7b. Clicking a shape unfolds its way down to the layer it is on ------
  // Picking a shape on the canvas points the sidebar at its layer. Once names
  // are grouped, that layer's row may be folded away inside a group — and a row
  // that is not drawn cannot be highlighted, so the answer to "which layer is
  // this on?" used to be nothing at all: the pane opened on a tree with every
  // group shut and nothing marked anywhere in it.
  const drawnIndex = layerItem(drawnLayer).dataset.layerIndex;
  const onLayer = [...currentSvg().querySelectorAll('g[data-layers]')]
    .find(g => g.getAttribute('data-layers').split(',').includes(String(drawnIndex)));
  check('the canvas has a shape drawn on the borrowed layer', !!onLayer, String(drawnIndex));

  if ($('layer-tree-toggle-all').textContent === 'Expand all') $('layer-tree-toggle-all').click();
  await sleep(40);
  $('layer-tree-toggle-all').click();
  await sleep(40);
  check('with every group folded, the layer has no row to point at',
    !layerItem(drawnLayer), rowOrder().join(' '));

  onLayer.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(80);
  check('clicking the shape unfolds the groups its layer is buried under',
    !!layerItem(drawnLayer), rowOrder().join(' '));
  check('and marks the row, which is the point of unfolding it',
    layerItem(drawnLayer)?.classList.contains('focused'),
    layerItems().filter(i => i.classList.contains('focused'))
      .map(i => i.querySelector('.layer-name')?.textContent).join(','));
  check('leaving the groups it did not have to open alone',
    layersUnderRow('Water').length === 0, rowOrder().join(' '));

  $('layer-tree-toggle-all').click();
  await sleep(40);

  rightClick(layerItem(drawnLayer));
  promptReply = '';
  menuItem('move').click();
  await sleep(60);
  check('and the borrowed layer went back where it was',
    layerTitles().includes(drawnLayer), layerTitles().join(','));
}

// --- 8. Back to flat -------------------------------------------------------
$('layer-tree-enable').checked = false;
$('layer-tree-enable').dispatchEvent(new window.Event('change'));
await sleep(40);
check('turning grouping off removes every group row', groupRows().length === 0);
check('and shows whole names again',
  layerNames().includes('Site/Power/HV') && layerNames().includes('Water/Power/HV'),
  layerNames().join(','));

// With grouping off a row still renames — it is simply a name rather than a
// path, though typing a delimiter into it still files the layer into a group.
check('a flat row has a rename too', !!renameButton(layerItem('Standalone'))); 
promptReply = 'Site/Standalone';
renameButton(layerItem('Standalone')).click();
await sleep(60);
check('renaming from the flat list works', layerNames().includes('Site/Standalone'),
  layerNames().join(','));
alerts.length = 0;
promptReply = 'site/POWER/hv';
renameButton(layerItem('Site/Standalone')).click();
await sleep(60);
check('and it refuses a name another layer already has',
  layerNames().includes('Site/Standalone'), layerNames().join(','));
check('saying why', alerts.some(m => /two layers/i.test(m)), alerts.join('|'));

// A flat row can be filed into a group from the menu too: the delimiter is
// still what a group *would* be, it is simply not drawn as one yet.
rightClick(layerItem('Site/Standalone'));
check('a flat row has the same menu', menuVisible());
promptReply = 'Depot';
menuItem('move').click();
await sleep(60);
check('and moving one rewrites its whole prefix',
  layerNames().includes('Depot/Standalone'), layerNames().join(','));

// --- 9. Save and reopen ----------------------------------------------------
// The renames the tree drove are real layer names; the grouping settings that
// drove them travel with the file too, so whoever opens it next sees the same
// tree rather than a flat list.
const namesBeforeSave = layerNames().filter(n => n !== 'Unlayered');

$('layer-tree-enable').checked = true;
$('layer-tree-enable').dispatchEvent(new window.Event('change'));
await sleep(40);
groupRow('Site').querySelector('.layer-twisty').click();
await sleep(40);
check('Site is collapsed before saving', layersUnderRow('Site').length === 0, rowOrder().join(' '));

const before = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > before);
check('Save produced a file', captured.length > before);
const savedBytes = Buffer.from(await captured.at(-1).arrayBuffer());

window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([savedBytes], 'tree-reopened.vsdx'));
check('the reopened drawing renders', !!currentSvg()?.querySelector('g[data-shape-id]'));
check('grouping comes back on with the file', $('layer-tree-enable').checked === true);
check('with the delimiter it was saved with', $('layer-tree-delimiter').value === '/');
check('so the sidebar reopens as a tree', groupRows().length > 0, rowOrder().join(' '));
check('and the group left collapsed is still collapsed',
  layersUnderRow('Site').length === 0, rowOrder().join(' '));

$('layer-tree-toggle-all').click();
await sleep(40);
check('the saved names still group the same way',
  rowOrder().join(' ').includes('[Site] [Power] HV LV'), rowOrder().join(' '));
check('and the tags added from the context menu survived the round-trip',
  tagsOf('HV').includes('draft'), tagsOf('HV').join(','));

$('layer-tree-enable').checked = false;
$('layer-tree-enable').dispatchEvent(new window.Event('change'));
await sleep(40);
check('the renamed layers came back',
  JSON.stringify(layerNames().filter(n => n !== 'Unlayered')) === JSON.stringify(namesBeforeSave),
  `${layerNames().join(',')} vs ${namesBeforeSave.join(',')}`);

// A drawing nobody grouped must not inherit the last one's settings.
window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([readFileSync(fixture)], 'plain.vsdx'));
check('a file carrying no settings opens flat again',
  $('layer-tree-enable').checked === false && groupRows().length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
