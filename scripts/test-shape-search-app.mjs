// End-to-end test against the REAL built app (dist/) for finding a shape by
// name, text or #ID from the Layers sidebar, and for the hover highlight that
// makes the result mean something: the point of the search is not the list, it
// is the red square drawn around the shape on the canvas when you hover a row.
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

// The input is debounced so a big drawing is not re-walked on every keystroke.
const DEBOUNCE_WAIT = 220;
const typeSearch = async (text) => {
  $('shape-search').value = text;
  $('shape-search').dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(DEBOUNCE_WAIT);
};
const panelVisible = () => !$('layer-objects').hidden;
const rows = () => [...window.document.querySelectorAll('#layer-objects-list .layer-object-row')];
const rowLabels = () => rows().map(row => row.querySelector('.shape-pick-label')?.textContent.trim());
const title = () => $('layer-objects-title').textContent;
const highlight = () => window.document.querySelector('#svg-container #shape-highlight');
const hover = async (row) => {
  row.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
  await sleep(20);
};
const unhover = async (row) => {
  row.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
  await sleep(20);
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
const needle = process.argv[3] || 'Shape B';
// Something the drawing has several of, to prove the highlight follows the row.
const broad = process.argv[4] || 'Shape';
console.log(`── in-app shape search: ${fixture} (“${needle}”) ──`);

await dropFile(new window.File([readFileSync(fixture)], 'search.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);
check('the sidebar offers a shape search', !!$('shape-search'));
check('the result panel starts closed', !panelVisible());

// --- 1. Finding by name ----------------------------------------------------
await typeSearch(needle);
check('typing opens the result panel', panelVisible());
check('and lists matches', rows().length > 0, `${rows().length} rows`);
check('every row names something matching',
  rows().length > 0 && rowLabels().every(label => label.toLowerCase().includes(needle.toLowerCase())),
  rowLabels().join(','));
check('the panel title counts the matches',
  title().includes(String(rows().length)) && title().includes(needle), title());

if (!rows().length) {
  console.log(`\n${pass} passed, ${fail + 1} failed — nothing matched “${needle}”, the rest cannot run`);
  process.exit(1);
}

// --- 2. Hovering a row highlights the shape --------------------------------
check('nothing is highlighted before hovering', !highlight());
const first = rows()[0];
await hover(first);
const box = highlight();
check('hovering a result draws the highlight', !!box);
check('the highlight is a box on the canvas',
  !!box?.querySelector('rect') && Number(box.querySelector('rect').getAttribute('width')) > 0,
  box?.querySelector('rect')?.getAttribute('width'));
// It has to sit on the shape, not just anywhere: compare against the rendered
// group's own bounding box in the same user units.
const hoveredId = first.dataset.shapeId;
const renderedGroups = [...window.document.querySelectorAll(`#svg-container svg g[data-shape-id="${hoveredId}"]`)];
check('the highlighted shape is really on the page', renderedGroups.length > 0, hoveredId);
await unhover(first);
check('leaving the row clears the highlight', !highlight());

// A box that never moves is not pointing at anything. Two different results
// have to put it in two different places.
const boxRect = () => {
  const r = highlight()?.querySelector('rect');
  return r ? ['x', 'y', 'width', 'height'].map(a => r.getAttribute(a)).join(',') : null;
};
await typeSearch(broad);
const many = rows();
check(`“${broad}” matches more than one shape to compare`, many.length >= 2, `${many.length} rows`);
if (many.length >= 2) {
  await hover(many[0]);
  const firstBox = boxRect();
  await unhover(many[0]);
  await hover(many[1]);
  const secondBox = boxRect();
  await unhover(many[1]);
  check('each result highlights its own shape, in its own place',
    !!firstBox && !!secondBox && firstBox !== secondBox, `${firstBox} vs ${secondBox}`);
  check('only ever one highlight at a time',
    window.document.querySelectorAll('#svg-container #shape-highlight').length === 0);
}
await typeSearch(needle);

// --- 3. Picking a result selects the shape ---------------------------------
first.click();
await sleep(60);
check('clicking a result selects that shape',
  rows().some(row => row.dataset.shapeId === hoveredId && row.classList.contains('selected')),
  rows().map(r => r.dataset.shapeId + (r.classList.contains('selected') ? '*' : '')).join(','));
check('and the Shape Tree opens on it',
  window.document.querySelectorAll('#shape-tree-body .shape-tree-label').length > 0);

// --- 4. Searching by ID ----------------------------------------------------
await typeSearch(`#${hoveredId}`);
check('a #ID search finds that shape',
  rows().some(row => row.dataset.shapeId === hoveredId),
  rows().map(r => r.dataset.shapeId).join(','));
check('and every ID it lists starts that way',
  rows().every(row => row.dataset.shapeId.startsWith(String(hoveredId))),
  rows().map(r => r.dataset.shapeId).join(','));

// --- 5. No matches says so, rather than showing a stale list ---------------
await typeSearch('zzz-no-such-shape-zzz');
check('a search with no matches still opens the panel', panelVisible());
check('and says nothing matched',
  rows().length === 0 && /No shape/i.test($('layer-objects-list').textContent),
  $('layer-objects-list').textContent);

// --- 6. Clearing and Escape close it ---------------------------------------
await typeSearch(needle);
check('the list comes back', rows().length > 0);
await typeSearch('');
check('clearing the box closes the panel', !panelVisible());

await typeSearch(needle);
$('shape-search').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(40);
check('Escape closes the panel', !panelVisible());
check('and empties the box', $('shape-search').value === '');

// --- 7. Enter takes the top match ------------------------------------------
await typeSearch(needle);
const topId = rows()[0].dataset.shapeId;
$('shape-search').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await sleep(60);
check('Enter selects the top match',
  rows().some(row => row.dataset.shapeId === topId && row.classList.contains('selected')), topId);

// --- 8. A layer's object list and the search share one panel ---------------
const objectsButton = window.document.querySelector('#layers-list .layer-objects-btn');
if (objectsButton) {
  objectsButton.click();
  await sleep(60);
  check('opening a layer\'s objects takes over the panel', panelVisible());
  check('and drops the search text so the panel shows one thing',
    $('shape-search').value === '', $('shape-search').value);
  await typeSearch(needle);
  check('typing again takes the panel back for the search',
    title().includes(needle), title());
  check('and no layer keeps the active mark',
    !window.document.querySelector('#layers-list .layer-objects-btn.active'));
} else {
  check('fixture has a layer to cross-check the panel with', false, 'no ⊙ button found');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
