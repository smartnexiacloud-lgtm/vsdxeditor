// End-to-end add/remove layer test against the REAL built app (dist/). Boots
// the bundle in jsdom, loads a .vsdx, adds a layer from the sidebar and another
// from a shape's context menu, deletes one that has shapes on it, then saves,
// reopens the downloaded file and checks the layer set — and where the orphaned
// shapes ended up — came back the way it was left. Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

let promptReply = '';
let confirmReply = true;
const alerts = [];
const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => promptReply;
    window.confirm = () => confirmReply;
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

// Parsing, rendering and rebuilding a package are async with no fixed
// duration, so poll for the outcome rather than guessing a delay.
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

const layerItems = () => [...window.document.querySelectorAll('#layers-list .layer-item')];
const layerNames = () => layerItems().map(i => i.querySelector('.layer-name')?.textContent);
const layerItem = (name) => layerItems().find(i => i.querySelector('.layer-name')?.textContent === name);
const objectRows = () => [...window.document.querySelectorAll('#layer-objects-list .layer-object-row')];
const openObjects = async (name) => {
  layerItem(name).querySelector('.layer-objects-btn').click();
  await sleep(50);
  return objectRows().map(r => r.textContent);
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app add/remove layer: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'layers.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);

const startingNames = layerNames();
check('the sidebar offers an add-layer control', !!$('layers-add'));
check('the add control is shown for an editable package', $('layers-manage')?.style.display !== 'none');

// --- 1. Add a layer from the sidebar --------------------------------------
promptReply = 'Survey notes';
$('layers-add').click();
await sleep(50);
check('the new layer is listed', layerNames().includes('Survey notes'), layerNames().join(','));
check('it did not disturb the existing layers',
  startingNames.every(name => layerNames().includes(name)), layerNames().join(','));
check('a new layer starts visible', layerItem('Survey notes')?.querySelector('input[type=checkbox]').checked === true);
check('a new layer can be tagged like any other', !!layerItem('Survey notes')?.querySelector('.layer-tag-edit'));

// --- 2. Names that cannot work are refused ---------------------------------
const countBefore = layerItems().length;
alerts.length = 0;
promptReply = 'survey NOTES';
$('layers-add').click();
await sleep(50);
check('a duplicate name is refused', layerItems().length === countBefore, layerNames().join(','));
check('and says why', alerts.some(m => /already has a layer/i.test(m)), alerts.join('|'));

alerts.length = 0;
promptReply = '   ';
$('layers-add').click();
await sleep(50);
check('a blank name is refused', layerItems().length === countBefore);
check('and says why', alerts.some(m => /needs a name/i.test(m)), alerts.join('|'));

// --- 3. Add a layer straight from a shape's context menu -------------------
const target = [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => ({ g, t: /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(g.getAttribute('transform') || '') }))
  .find(entry => entry.t);
check('found a shape to right-click', !!target);

if (target) {
  const shapeId = target.g.getAttribute('data-shape-id');
  target.g.dispatchEvent(new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Number(target.t[1]) + 4, clientY: Number(target.t[2]) + 4,
  }));
  await sleep(50);
  check('the context menu opened', $('shape-context-menu').classList.contains('visible'));
  check('it offers a new-layer action', !!$('shape-context-new-layer'));

  promptReply = 'Drawn over';
  $('shape-context-new-layer').click();
  await sleep(80);
  check('the layer was created', layerNames().includes('Drawn over'), layerNames().join(','));
  const rows = await openObjects('Drawn over');
  check('and the shape was filed onto it', rows.some(text => text.includes(`#${shapeId}`)),
    rows.join(' | '));
  $('layer-objects-close').click();
  await sleep(30);
}

// --- 4. Delete a layer -----------------------------------------------------
const doomed = layerItems().find(i => !i.classList.contains('virtual-layer')
  && i.querySelector('.layer-name').textContent !== 'Survey notes'
  && i.querySelector('.layer-name').textContent !== 'Drawn over');
const doomedName = doomed?.querySelector('.layer-name').textContent;
check('found a populated layer to delete', !!doomed);

check('the editor-only Unlayered row offers no delete',
  layerItems().filter(i => i.classList.contains('virtual-layer'))
    .every(i => !i.querySelector('.layer-delete')));

const shapesOnDoomed = doomed ? (await openObjects(doomedName)) : [];
$('layer-objects-close').click();
await sleep(30);

if (doomed) {
  confirmReply = false;
  doomed.querySelector('.layer-delete').click();
  await sleep(50);
  check('cancelling the confirm keeps the layer', layerNames().includes(doomedName));

  confirmReply = true;
  layerItem(doomedName).querySelector('.layer-delete').click();
  await sleep(80);
  check('confirming removes it from the sidebar', !layerNames().includes(doomedName), layerNames().join(','));
  check('its shapes were not deleted with it', !!currentSvg().querySelector('g[data-shape-id]'));

  if (shapesOnDoomed.length) {
    const unlayered = layerItems().find(i => i.classList.contains('virtual-layer'));
    check('the drawing now has an Unlayered row for the orphans', !!unlayered);
    if (unlayered) {
      unlayered.querySelector('.layer-objects-btn').click();
      await sleep(50);
      const orphanIds = objectRows().map(r => r.textContent);
      check('the orphaned shapes are listed as unlayered',
        shapesOnDoomed.some(text => {
          const id = /#(\d+)/.exec(text)?.[1];
          return id && orphanIds.some(o => o.includes(`#${id}`));
        }), `${shapesOnDoomed.join(' | ')} ⇒ ${orphanIds.join(' | ')}`);
      $('layer-objects-close').click();
      await sleep(30);
    }
  }
}

// --- 5. Save and reopen ----------------------------------------------------
const namesBeforeSave = layerNames().filter(n => n !== 'Unlayered');
const before = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > before);
check('Save produced a file', captured.length > before);
const savedBytes = Buffer.from(await captured.at(-1).arrayBuffer());
check('the saved file is a ZIP', savedBytes.subarray(0, 2).toString() === 'PK');

window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([savedBytes], 'layers-reopened.vsdx'));
const namesAfter = layerNames().filter(n => n !== 'Unlayered');
check('the added layers came back',
  namesAfter.includes('Survey notes') && (!target || namesAfter.includes('Drawn over')),
  namesAfter.join(','));
check('the deleted layer stayed deleted', !doomedName || !namesAfter.includes(doomedName), namesAfter.join(','));
check('the layer set round-tripped exactly',
  JSON.stringify(namesAfter) === JSON.stringify(namesBeforeSave),
  `${namesAfter.join(',')} vs ${namesBeforeSave.join(',')}`);
check('the reopened drawing still renders shapes', !!currentSvg()?.querySelector('g[data-shape-id]'));

if (target) {
  const rows = await openObjects('Drawn over');
  check('the shape filed onto the new layer is still on it', rows.length > 0, rows.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
