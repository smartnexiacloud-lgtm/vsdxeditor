// Regression test against the REAL built app (dist/): editing one shape's XML
// by hand must not throw away everything else the user has changed.
//
// Applying a shape edit rebuilds the package and re-parses it, and the sidebar
// is rebuilt from the result. Layer toggles, renames and tags live only in
// memory until something writes them out, so unless they are folded into the
// bytes first the re-parse silently reverts them — the layers "reset".
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
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => promptReply;
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
const layerItems = () => [...window.document.querySelectorAll('#layers-list .layer-item')];
const realLayerItems = () => layerItems().filter(item => !item.classList.contains('virtual-layer'));
const layerItem = (name) => layerItems().find(item => item.querySelector('.layer-name')?.textContent === name);
const isHidden = (name) => layerItem(name)?.querySelector('input[type=checkbox]')?.checked === false;
const chipsOf = (name) => [...(layerItem(name)?.querySelectorAll('.layer-tag') || [])].map(c => c.textContent);

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app shape edit keeps editor state: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'edit.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);

const layers = realLayerItems();
check('fixture has layers to work with', layers.length >= 1, `${layers.length} layers`);

// 1. Hide a layer and tag it — both are in-memory-only edits.
const targetName = layers[0].querySelector('.layer-name').textContent;
const checkbox = layers[0].querySelector('input[type=checkbox]');
checkbox.checked = false;
checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
check('layer starts out hidden by the user', isHidden(targetName));

promptReply = 'electrical';
// Tagging is on the row's menu: open it, then click the entry.
layers[0].querySelector('.layer-menu-btn')?.click();
$('layer-context-menu').querySelector('[data-layer-action="tags"]')?.click();
await sleep(50);
check('layer starts out tagged', chipsOf(targetName).includes('electrical'), JSON.stringify(chipsOf(targetName)));

// Hide the editor-only "Unlayered" row too, if this drawing has one: it has
// nowhere to live in the file, so it can only survive in memory.
const unlayered = layerItems().find(item => item.classList.contains('virtual-layer'));
if (unlayered) {
  const unlayeredBox = unlayered.querySelector('input[type=checkbox]');
  unlayeredBox.checked = false;
  unlayeredBox.dispatchEvent(new window.Event('change', { bubbles: true }));
}
const unlayeredName = unlayered?.querySelector('.layer-name')?.textContent || null;

// 2. Hand-edit one shape's XML and apply it unchanged. The Shape Tree (where
// the Edit XML button lives) only populates once a shape is selected.
const shapeGroup = window.document.querySelector('#svg-container svg > g[data-shape-id]');
shapeGroup?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(50);
const xmlButton = window.document.querySelector('#shape-tree-body .shape-tree-xml');
check('a shape offers Edit XML', !!xmlButton);
xmlButton.click();
await waitFor(() => $('shape-xml-textarea')?.value?.includes('<Shape'));
const snippet = $('shape-xml-textarea').value;
check('the XML editor loaded the shape', snippet.includes('<Shape'), snippet.slice(0, 80));

const svgBefore = currentSvg();
$('shape-xml-save').click();
const applied = await waitFor(() => currentSvg() && currentSvg() !== svgBefore);
check('the edit was applied', applied, 'error: ' + $('error-box')?.textContent);

// 3. Everything the user had set must still be set.
check('the hidden layer is still hidden', isHidden(targetName),
  `checkbox=${layerItem(targetName)?.querySelector('input[type=checkbox]')?.checked}`);
check('the layer tag survived the edit', chipsOf(targetName).includes('electrical'),
  JSON.stringify(chipsOf(targetName)));
if (unlayeredName) {
  check('the editor-only Unlayered row is still hidden', isHidden(unlayeredName),
    `checkbox=${layerItem(unlayeredName)?.querySelector('input[type=checkbox]')?.checked}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
