// End-to-end test against the REAL built app (dist/) for the two shape-picking
// surfaces: the per-layer object list in the sidebar, and the "Select component"
// stack on the right-click menu that offers every shape under the cursor.
// Hovering either kind of row must draw a selection square on the canvas, and
// clicking must select that shape. Run `npm run build` first.
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
    if (!window.CSS) window.CSS = {};
    if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
  },
});
const { window } = dom;
const captured = window.__captured;
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
const highlight = () => window.document.querySelector('#svg-container svg #shape-highlight');
const pickRows = () => [...window.document.querySelectorAll('#shape-pick-list .shape-pick-row')];
const objectRows = () => [...window.document.querySelectorAll('#layer-objects-list .layer-object-row')];
const hover = (row) => row.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
const unhover = (row) => row.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app shape picking: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'pick.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);

// --- 1. Right-click stack -------------------------------------------------
// Pick a point known to be inside a shape: a group whose transform is a plain
// translate puts its local origin exactly at (tx, ty) in user units, and at
// zoom 1 with no pan those are client pixels.
const target = [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => ({ g, t: /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(g.getAttribute('transform') || '') }))
  .find(entry => entry.t);
check('found a shape to right-click', !!target);

if (target) {
  const x = Number(target.t[1]) + 4;
  const y = Number(target.t[2]) + 4;
  target.g.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x, clientY: y
  }));
  await sleep(50);

  check('the context menu opened', $('shape-context-menu').classList.contains('visible'));
  check('it offers a Select component list', $('shape-pick-section').hidden === false);
  check('the list names the shapes at that point', pickRows().length >= 1, `${pickRows().length} rows`);
  check('the hint reports how many are stacked there',
    /shapes? here/.test($('shape-pick-hint').textContent), $('shape-pick-hint').textContent);
  check('rows are labelled with their shape id',
    /#\d/.test(pickRows()[0]?.querySelector('.shape-pick-meta')?.textContent || ''),
    pickRows()[0]?.textContent);

  // Hovering draws the selection square; leaving removes it.
  check('no selection square before hovering', !highlight());
  hover(pickRows()[0]);
  check('hovering a row draws a selection square', !!highlight());
  check('the square is drawn as an overlay, not a shape',
    highlight()?.getAttribute('pointer-events') === 'none');
  check('the square has corner ticks', (highlight()?.querySelectorAll('path').length || 0) === 4,
    String(highlight()?.querySelectorAll('path').length));
  unhover(pickRows()[0]);
  check('leaving the row clears the square', !highlight());

  // Clicking a row selects that shape.
  const wantedId = pickRows()[0].dataset.shapeId;
  pickRows()[0].click();
  await sleep(50);
  const selected = window.document.querySelector(`#svg-container svg g[data-shape-id="${wantedId}"]`);
  check('clicking a row selects that shape', (selected?.style.outline || '').includes('solid'),
    `outline=${selected?.style.outline}`);

  // A right-click on blank canvas has nothing to offer and must not open.
  $('shape-context-menu').classList.remove('visible');
  currentSvg().dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: -5000, clientY: -5000
  }));
  await sleep(30);
  check('right-clicking empty space opens nothing',
    !$('shape-context-menu').classList.contains('visible'));
}

// --- 2. Per-layer object list --------------------------------------------
const layerRow = [...window.document.querySelectorAll('#layers-list .layer-item')]
  .find(item => !item.classList.contains('virtual-layer')) ||
  window.document.querySelector('#layers-list .layer-item');
check('the sidebar lists a layer', !!layerRow);

if (layerRow) {
  const layerName = layerRow.querySelector('.layer-name').textContent;
  const wasVisible = layerRow.querySelector('input[type=checkbox]').checked;
  check('the object list starts closed', $('layer-objects').hidden === true);

  // Listing a layer's shapes is one entry on the row's menu, which is what the
  // row's single button (and a right-click on it) opens.
  const menuButton = layerRow.querySelector('.layer-menu-btn');
  check('each layer offers a row menu', !!menuButton);
  menuButton.click();
  const objectsEntry = $('layer-context-menu').querySelector('[data-layer-action="objects"]');
  check('the menu offers "list shapes"', !!objectsEntry && !objectsEntry.disabled);
  objectsEntry.click();
  await sleep(50);

  check('the object list opened', $('layer-objects').hidden === false);
  check('its title names the layer and the count',
    $('layer-objects-title').textContent.includes(layerName) &&
    /\d+ object/.test($('layer-objects-title').textContent),
    $('layer-objects-title').textContent);
  check('opening the list did not toggle the layer',
    layerRow.querySelector('input[type=checkbox]').checked === wasVisible);
  check('it lists the shapes on that layer', objectRows().length >= 1, `${objectRows().length} rows`);

  if (objectRows().length) {
    hover(objectRows()[0]);
    check('hovering an object row draws the selection square', !!highlight());
    unhover(objectRows()[0]);
    check('leaving it clears the square', !highlight());

    const wantedId = objectRows()[0].dataset.shapeId;
    objectRows()[0].click();
    await sleep(50);
    const selected = window.document.querySelector(`#svg-container svg g[data-shape-id="${wantedId}"]`);
    check('clicking an object row selects that shape', (selected?.style.outline || '').includes('solid'),
      `outline=${selected?.style.outline}`);
    check('the list stays open after selecting', $('layer-objects').hidden === false);
    check('the selected row is marked', objectRows().some(r => r.classList.contains('selected')));
  }

  // The square is scaffolding — it must not reach an exported SVG.
  hover(objectRows()[0]);
  const before = captured.length;
  $('btn-export').click();
  $('export-run').click();
  if (await waitFor(() => captured.length > before)) {
    const svgText = await captured.at(-1).text();
    check('exported SVG omits the selection square', !svgText.includes('shape-highlight'));
  }

  // The rows were rebuilt when the list opened, so ask the sidebar for the
  // row's menu again rather than clicking a button that is no longer in it.
  window.document.querySelector('#layers-list .layer-item .layer-menu-btn').click();
  $('layer-context-menu').querySelector('[data-layer-action="objects"]').click();
  await sleep(30);
  check('asking again toggles the list closed', $('layer-objects').hidden === true);
  check('closing the list clears the square', !highlight());
}

// --- 3. Everything that passes through the point, not just the box test ----
// Geometry alone answers in page inches, so it leans on this app's screen→page
// transform and on a bounding box standing in for the shape. The browser knows
// the truth for what it drew: elementsFromPoint returns the whole stack at a
// point, occluded entries included. Both are asked and merged, so a shape you
// would otherwise have to send to the back before you could pick it is offered
// straight away. jsdom implements no hit testing at all, so the browser's half
// is stood up here by hand.
const allDrawn = [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')];
const anchor = allDrawn
  .map(g => ({ g, t: /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(g.getAttribute('transform') || '') }))
  .find(entry => entry.t);
check('the page has shapes to stack and one to click', allDrawn.length >= 3 && !!anchor,
  `${allDrawn.length} drawn`);

if (allDrawn.length >= 3 && anchor) {
  const at = { clientX: Number(anchor.t[1]) + 4, clientY: Number(anchor.t[2]) + 4 };
  const rightClick = async () => {
    // A right-click that offers nothing leaves the previous list in place, so
    // every probe below clicks a point that really does open the menu.
    currentSvg().dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...at }));
    await sleep(40);
    return pickRows().map(r => r.dataset.shapeId);
  };

  delete window.document.elementsFromPoint;
  const baseline = await rightClick();
  check('the box test finds something on its own', baseline.length >= 1, baseline.join(','));

  // A shape the box test does not claim at this point — the one the user would
  // otherwise have to send to the back to reach.
  const hidden = allDrawn.map(g => g.getAttribute('data-shape-id')).find(id => !baseline.includes(id));
  check('and there is a shape it does not claim here, to go looking for', !!hidden,
    `baseline ${baseline.join(',')} of ${allDrawn.length}`);

  if (hidden) {
    const hiddenEl = allDrawn.find(g => g.getAttribute('data-shape-id') === hidden);
    window.document.elementsFromPoint = () => [hiddenEl];
    const merged = await rightClick();
    check('a shape the box test never claimed is offered once the browser reports it',
      merged.includes(hidden), `wanted ${hidden}, got ${merged.join(',')}`);
    check('and nothing the box test found was dropped to make room',
      baseline.every(id => merged.includes(id)), `${baseline.join(',')} → ${merged.join(',')}`);
    check('the merged list is in paint order, topmost first',
      merged.every((id, i) => i === 0 || Number(orderOf(id)) <= Number(orderOf(merged[i - 1]))),
      merged.join(','));

    // The same shape reported by both halves must appear once.
    window.document.elementsFromPoint = () => allDrawn;
    const both = await rightClick();
    check('a shape both halves report is listed once, not twice',
      new Set(both).size === both.length, both.join(','));

    delete window.document.elementsFromPoint;
    const without = await rightClick();
    check('and a browser without that API is no worse off than before',
      without.length === baseline.length && baseline.every(id => without.includes(id)),
      `${baseline.join(',')} → ${without.join(',')}`);
  }
}

// Paint order is the document order of the <g> elements the renderer emitted.
function orderOf(shapeId) {
  return [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
    .findIndex(g => g.getAttribute('data-shape-id') === String(shapeId));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
