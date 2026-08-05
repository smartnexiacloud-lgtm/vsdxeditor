// End-to-end layer-tag test against the REAL built app (dist/). Boots the
// bundle in jsdom, loads a .vsdx, tags a layer from the sidebar and another
// from the Layer Matrix, recolours a tag from the legend, clicks Save VSDX,
// then re-opens the downloaded file and confirms the tags, their chips, and
// their colours all come back. Also checks the saved bytes carry the Visio
// Solution XML wiring that survives a real Visio round-trip. Run `npm run
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
    window.prompt = () => promptReply;               // feed tag lists
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

// Parsing/rendering a drawing and building a saved .vsdx are async with no
// fixed duration — on a busy machine they outrun any constant we could pick,
// so poll for the outcome, bailing early once the app reports an error.
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
// Wait for a *new* <svg> node, not merely for one to exist: dropping a second
// file leaves the previous render in place until the new one replaces it.
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
const layerItem = (name) => layerItems().find(item => item.querySelector('.layer-name')?.textContent === name);
const chipsOf = (name) => [...(layerItem(name)?.querySelectorAll('.layer-tag') || [])].map(c => c.textContent);
const legendTags = () => [...window.document.querySelectorAll('#layers-tag-legend .tag-legend-name')].map(b => b.textContent);
const matrixTagInput = (pageName, layerName) =>
  window.document.querySelector(`#layer-matrix-body input[aria-label="${pageName} ${layerName} tags"]`);
const pageTab = (name) =>
  [...window.document.querySelectorAll('#page-tabs .page-tab-label')].find(b => b.textContent === name);
const setInput = (input, value) => {
  input.value = value;
  input.dispatchEvent(new window.Event('change'));
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app layer tags: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'tags.vsdx'));
check('app booted and rendered', !!window.document.querySelector('#svg-container svg'),
  'error: ' + $('error-box')?.textContent);
check('tag panel hidden while nothing is tagged', $('layers-tags')?.style.display === 'none');

// 1. Tag a layer from the sidebar (🏷 button → prompt).
const target = layerItems().find(item => !item.classList.contains('virtual-layer'));
const targetName = target.querySelector('.layer-name').textContent;
promptReply = 'electrical, as-built, electrical';
target.querySelector('.layer-tag-edit').click();
await sleep(50);
check('sidebar shows the tags as chips',
  JSON.stringify(chipsOf(targetName)) === JSON.stringify(['electrical', 'as-built']),
  JSON.stringify(chipsOf(targetName)));
check('duplicate tag was de-duplicated', chipsOf(targetName).length === 2);
check('tag legend lists both tags',
  JSON.stringify(legendTags()) === JSON.stringify(['as-built', 'electrical']), JSON.stringify(legendTags()));
check('tagging a layer did not toggle its visibility',
  target.querySelector('input[type=checkbox]').checked === true);
check('the editor-only Unlayered row offers no tag button',
  layerItems().filter(i => i.classList.contains('virtual-layer'))
    .every(i => !i.querySelector('.layer-tag-edit')));

// 2. The Layer Matrix edits the same tags, per page.
const pageNames = [...window.document.querySelectorAll('#page-tabs .page-tab-label')].map(b => b.textContent);
const [firstPage, secondPage] = pageNames;
$('btn-layer-matrix').click();
await sleep(50);
check('matrix has a Tags column', !!matrixTagInput(firstPage, targetName));
check('matrix shows the tags set from the sidebar',
  matrixTagInput(firstPage, targetName).value === 'electrical, as-built');
setInput(matrixTagInput(firstPage, targetName), 'electrical, as-built, hv');
await sleep(50);
check('matrix tagging shows up in the sidebar immediately',
  JSON.stringify(chipsOf(targetName)) === JSON.stringify(['electrical', 'as-built', 'hv']),
  JSON.stringify(chipsOf(targetName)));
setInput(matrixTagInput(firstPage, targetName), 'electrical, as-built');
await sleep(50);

// The same layer name on another page is tagged independently.
const secondPageInput = secondPage ? matrixTagInput(secondPage, targetName) : null;
if (secondPageInput) {
  setInput(secondPageInput, 'draft');
  await sleep(50);
  check('tagging page 2 leaves page 1 alone',
    JSON.stringify(chipsOf(targetName)) === JSON.stringify(['electrical', 'as-built']));
}
$('layer-matrix-close').click();
await sleep(50);

// 3. Recolour a tag from the legend and confirm the chip follows.
const swatch = window.document.querySelector('#layers-tag-legend input[aria-label="Colour for tag electrical"]');
check('legend offers a colour swatch per tag', !!swatch);
const chipColorOf = (layerName, tag) =>
  [...layerItem(layerName).querySelectorAll('.layer-tag')].find(c => c.textContent === tag)?.style.background;
const defaultColor = chipColorOf(targetName, 'electrical');
check('untouched tags already get a colour', !!defaultColor);
swatch.value = '#ff8800';
swatch.dispatchEvent(new window.Event('input'));
await sleep(50);
check('recolouring a tag restyles its chips',
  /255,\s*136,\s*0|#ff8800/i.test(chipColorOf(targetName, 'electrical') || ''),
  chipColorOf(targetName, 'electrical'));

// 4. `tag:` filtering drives the bulk select/deselect buttons.
$('layer-filter-text').value = 'tag:electrical';
$('layer-filter-text').dispatchEvent(new window.Event('input'));
await sleep(50);
check('tag: filter narrows the sidebar to tagged layers',
  layerItems().length === 1 && layerItems()[0].querySelector('.layer-name').textContent === targetName,
  layerItems().map(i => i.querySelector('.layer-name').textContent).join(','));
$('layers-deselect-filtered').click();
await sleep(50);
$('layer-filter-text').value = '';
$('layer-filter-text').dispatchEvent(new window.Event('input'));
await sleep(50);
check('deselect-filter hid exactly the tagged layer',
  layerItem(targetName).querySelector('input[type=checkbox]').checked === false);
layerItem(targetName).querySelector('input[type=checkbox]').click();
await sleep(50);

// 5. Save and inspect the bytes.
const capturedBeforeSave = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > capturedBeforeSave);
const savedBytes = Buffer.from(await captured.at(-1).arrayBuffer());
check('Save VSDX produced a ZIP', savedBytes.subarray(0, 2).toString() === 'PK');
const zip = await JSZip.loadAsync(savedBytes);
check('saved file carries the layer-tag solution part', !!zip.file('visio/solutions/vsdxeditor-layer-tags.xml'));
const rels = await zip.file('visio/_rels/document.xml.rels').async('string');
check('saved file carries the solutionxml relationship',
  rels.includes('relationships/solutionxml') && rels.includes('solutions/vsdxeditor-layer-tags.xml'));

// 6. Re-open the saved file: tags and colours must repopulate.
window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([savedBytes], 'tags-reopened.vsdx'));
check('tags restored after reopen',
  JSON.stringify(chipsOf(targetName)) === JSON.stringify(['electrical', 'as-built']),
  JSON.stringify(chipsOf(targetName)));
check('tag colour restored after reopen',
  /255,\s*136,\s*0|#ff8800/i.test(chipColorOf(targetName, 'electrical') || ''),
  chipColorOf(targetName, 'electrical'));
check('tag panel is visible once tags exist', $('layers-tags')?.style.display !== 'none');
if (secondPageInput) {
  pageTab(secondPage).click();
  await sleep(200);
  check('page 2 keeps its own tag after reopen',
    JSON.stringify(chipsOf(targetName)) === JSON.stringify(['draft']),
    JSON.stringify(chipsOf(targetName)));
  pageTab(firstPage).click();
  await sleep(200);
}

// 7. Clearing a layer's tags removes its chips.
promptReply = '';
layerItem(targetName).querySelector('.layer-tag-edit').click();
await sleep(50);
check('clearing tags removes the chips', chipsOf(targetName).length === 0);

console.log(`\nlayer-tags-app: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
