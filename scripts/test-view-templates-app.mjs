// End-to-end named-views test against the REAL built app (dist/). Boots the
// bundle in jsdom, loads a .vsdx, hides a layer, saves a named view, restores
// it, saves a second view, clicks Save VSDX, then re-opens the downloaded file
// and confirms both views come back and applying one re-hides the layer. Also
// checks the saved bytes carry the Visio Solution XML wiring. Run `npm run
// build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';
import JSZip from 'jszip';

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
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => promptReply;               // feed view names
    // jsdom lacks CSS.escape; the app uses it to build layer selectors.
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
const dropFile = async (file) => {
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  await sleep(500);
};
// A layer row's checkbox in the sidebar: #layer-cb-<index>.
const connectorCheckbox = () =>
  [...window.document.querySelectorAll('#layers-list .layer-item')]
    .map(item => ({ item, name: item.querySelector('.layer-name')?.textContent }))
    .find(x => x.name === 'Connector')?.item.querySelector('input[type=checkbox]');
const connectorMatrixFlag = (prop) =>
  window.document.querySelector(`#layer-matrix-body input[aria-label="Connector ${prop}"]`);

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app named views: ${fixture} ──`);

// 1. Load the drawing with Connector hidden in its initial file state.
const fixtureZip = await JSZip.loadAsync(readFileSync(fixture));
const pagesPath = 'visio/pages/pages.xml';
const pagesXml = await fixtureZip.file(pagesPath).async('string');
let connectorLayerFound = false;
const hiddenPagesXml = pagesXml.replace(/<Row\b[^>]*>[\s\S]*?<\/Row>/g, (row) => {
  if (!/<Cell\b(?=[^>]*\bN=["']Name["'])(?=[^>]*\bV=["']Connector["'])[^>]*\/?\s*>/.test(row)) return row;
  connectorLayerFound = true;
  return row.replace(
    /(<Cell\b(?=[^>]*\bN=["']Visible["'])[^>]*\bV=["'])[^"']*/,
    (_match, prefix) => prefix + '0'
  );
});
if (!connectorLayerFound) throw new Error('Could not find Connector layer in fixture');
fixtureZip.file(pagesPath, hiddenPagesXml);
const hiddenFixture = await fixtureZip.generateAsync({ type: 'uint8array' });
await dropFile(new window.File([hiddenFixture], 'views.vsdx'));
check('app booted and rendered', !!window.document.querySelector('#svg-container svg'),
  'error: ' + $('error-box')?.textContent);
check('named-views panel visible for vsdx', $('layers-views')?.style.display !== 'none');
$('btn-layer-matrix').click();
check('named-view controls visible in layer matrix', $('layer-matrix-views')?.style.display !== 'none');

const cb = connectorCheckbox();
check('found the Connector layer checkbox', !!cb);
const connectorLayerIndex = cb?.closest('.layer-item')?.dataset.layerIndex;
const connectorSvgGroups = () => [...window.document.querySelectorAll('#svg-container g[data-layers]')]
  .filter(group => group.getAttribute('data-layers').split(',').includes(connectorLayerIndex));
const initialConnectorGroups = connectorSvgGroups();
check('Connector starts hidden from file state',
  cb?.checked === false && initialConnectorGroups.length > 0
    && initialConnectorGroups.every(group => group.getAttribute('display') === 'none'));
if (!cb.checked) { cb.click(); await sleep(50); }
const visibleConnectorGroups = connectorSvgGroups();
check('Connector becomes visible live without re-rendering',
  visibleConnectorGroups.length === initialConnectorGroups.length
    && visibleConnectorGroups.every((group, index) => group === initialConnectorGroups[index])
    && visibleConnectorGroups.every(group => group.style.display === '' && group.getAttribute('display') === null));
connectorMatrixFlag('print').click();
connectorMatrixFlag('lock').click();
check('matrix changed Connector print and lock',
  connectorMatrixFlag('print').checked === false && connectorMatrixFlag('lock').checked === true);

// 2. With Connector ON, save view "All on".
promptReply = 'All on';
$('btn-view-save').click();
await sleep(50);
check('view "All on" added to dropdown',
  [...$('view-select').options].some(o => o.textContent === 'All on'));

// 3. Hide Connector, save view "Hide connectors".
if (cb.checked) { cb.click(); await sleep(50); }
check('Connector now hidden', !connectorCheckbox().checked);
connectorMatrixFlag('print').click();
connectorMatrixFlag('lock').click();
promptReply = 'Hide connectors';
$('btn-view-save').click();
await sleep(50);
check('two views in dropdown',
  [...$('view-select').options].filter(o => o.value !== '').length === 2);
check('matrix named-view dropdown stays synchronized',
  [...$('layer-matrix-view-select').options].filter(o => o.value !== '').length === 2);

// 4. Save VSDX and inspect the downloaded bytes.
$('btn-save-vsdx').click();
await sleep(500);
const vsdxBlob = captured.at(-1);
const savedBytes = Buffer.from(await vsdxBlob.arrayBuffer());
check('Save VSDX produced a ZIP', savedBytes.subarray(0, 2).toString() === 'PK');
const zip = await JSZip.loadAsync(savedBytes);
check('saved file carries the solution XML part', !!zip.file('visio/solutions/vsdxeditor-views.xml'));
const rels = await zip.file('visio/_rels/document.xml.rels').async('string');
check('saved file carries the solutionxml relationship',
  rels.includes('relationships/solutionxml') && rels.includes('solutions/vsdxeditor-views.xml'));

// 5. Re-open the saved file in the app: views must repopulate.
window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([savedBytes], 'views-reopened.vsdx'));
const reopenedOpts = [...$('view-select').options].filter(o => o.value !== '').map(o => o.textContent);
check('both views restored after reopen',
  reopenedOpts.includes('All on') && reopenedOpts.includes('Hide connectors'),
  'got: ' + JSON.stringify(reopenedOpts));

// After reopen the file's saved state had Connector hidden → it should be off.
check('reopened drawing reflects saved (Connector hidden)', !connectorCheckbox().checked);

// 6. Select "All on" from the dropdown → Connector should become visible again.
const sel = $('layer-matrix-view-select');
const allOnIdx = [...sel.options].find(o => o.textContent === 'All on').value;
sel.value = allOnIdx;
sel.dispatchEvent(new window.Event('change'));
await sleep(50);
check('applying "All on" re-shows Connector', connectorCheckbox().checked === true);
check('applying "All on" restores print and lock',
  connectorMatrixFlag('print').checked === false && connectorMatrixFlag('lock').checked === true);

// 7. Apply "Hide connectors" → Connector hidden again.
const hideIdx = [...sel.options].find(o => o.textContent === 'Hide connectors').value;
sel.value = hideIdx;
sel.dispatchEvent(new window.Event('change'));
await sleep(50);
check('applying "Hide connectors" hides Connector', connectorCheckbox().checked === false);

// 8. A referenced layer row without a name remains controllable instead of
// disappearing as if it were an unused Visio placeholder.
const unnamedZip = await JSZip.loadAsync(readFileSync(fixture));
const unnamedPagesXml = await unnamedZip.file(pagesPath).async('string');
let unnamedLayerIndex = null;
const withUnnamedLayer = unnamedPagesXml.replace(/<Row\b[^>]*>[\s\S]*?<\/Row>/g, (row) => {
  if (!/<Cell\b(?=[^>]*\bN=["']Name["'])(?=[^>]*\bV=["']Connector["'])[^>]*\/?\s*>/.test(row)) return row;
  unnamedLayerIndex = row.match(/\bIX=["']([^"']+)/)?.[1] ?? null;
  return row.replace(
    /(<Cell\b(?=[^>]*\bN=["'](?:Name|NameUniv)["'])[^>]*\bV=["'])[^"']*/g,
    (_match, prefix) => prefix
  );
});
if (unnamedLayerIndex === null) throw new Error('Could not create unnamed layer fixture');
unnamedZip.file(pagesPath, withUnnamedLayer);
const unnamedFixture = await unnamedZip.generateAsync({ type: 'uint8array' });
await dropFile(new window.File([unnamedFixture], 'unnamed-layer.vsdx'));
const unnamedItem = [...window.document.querySelectorAll('#layers-list .layer-item')]
  .find(item => item.dataset.layerIndex === unnamedLayerIndex);
check('referenced unnamed layer is shown as a muted placeholder',
  unnamedItem?.classList.contains('unnamed-layer')
    && unnamedItem.querySelector('.layer-name')?.textContent === `Layer ${unnamedLayerIndex}`);
const unlayeredItem = [...window.document.querySelectorAll('#layers-list .layer-item')]
  .find(item => item.dataset.layerIndex === '__vsdxeditor_unlayered__');
const unlayeredGroups = [...window.document.querySelectorAll('#svg-container g[data-shape-id]:not([data-layers])')];
check('editor-only Unlayered layer represents shapes without Visio membership',
  unlayeredItem?.classList.contains('virtual-layer')
    && unlayeredItem.querySelector('.layer-name')?.textContent === 'Unlayered'
    && unlayeredGroups.length > 0);
$('layers-deselect-all').click();
const layeredGroups = [...window.document.querySelectorAll('#svg-container g[data-layers]')];
check('deselect all hides shapes on named and unnamed layers',
  layeredGroups.length > 0 && layeredGroups.every(group => group.style.display === 'none'));
check('deselect all also hides editor-only unlayered shapes',
  unlayeredGroups.every(group => group.style.display === 'none'));

console.log(`\nview-templates-app: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
