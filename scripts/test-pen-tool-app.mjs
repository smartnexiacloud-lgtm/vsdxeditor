// End-to-end pen-tool test against the REAL built app (dist/). Boots the
// bundle in jsdom, loads a .vsdx, turns on the Pen, draws a path by dispatching
// the same mouse events a user would produce — click for a corner, click-drag
// for a curve — sets fill and stroke, commits, then clicks Save Visio and
// re-opens the downloaded bytes to confirm the drawn path is really in the
// package. Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';
import JSZip from 'jszip';

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
const setInput = (input, value) => {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const setChecked = (input, value) => {
  input.checked = value;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const shapeGroups = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')];

// jsdom has no layout, so the app falls back to its pan/zoom transform for
// screen→page mapping. After Fit that is pan 0,0 at zoom 1, which makes a
// client pixel exactly one page unit (1/96in).
const DPI = 96;
let pageHeight = 0;
const at = (xIn, yIn) => ({ clientX: xIn * DPI, clientY: (pageHeight - yIn) * DPI });
const mouse = (type, point, target = $('viewport')) => {
  target.dispatchEvent(new window.MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, ...point
  }));
};
const clickAt = (xIn, yIn) => { mouse('mousedown', at(xIn, yIn)); mouse('mouseup', at(xIn, yIn)); };
const dragAt = (xIn, yIn, hxIn, hyIn) => {
  mouse('mousedown', at(xIn, yIn));
  mouse('mousemove', at(hxIn, hyIn));
  mouse('mouseup', at(hxIn, hyIn));
};

const fixture = process.argv[2] || 'test-files/test9_rect_and_line.vsdx';
console.log(`── in-app pen tool: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'pen.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);

const shapesBefore = shapeGroups().length;

// The page height drives the Y flip; read it off the rendered viewBox.
pageHeight = Number(currentSvg().getAttribute('viewBox').split(/\s+/)[3]) / DPI;
check('page height read from the render', pageHeight > 0, String(pageHeight));

// 1. The Pen only offers itself on an editable package.
check('Pen button is enabled for a .vsdx', $('btn-pen').disabled === false);
check('pen bar starts hidden', $('pen-bar').hidden === true);
$('btn-pen').click();
check('pen bar opens with the tool', $('pen-bar').hidden === false);
check('Finish is disabled with nothing drawn', $('pen-finish').disabled === true);

// 2. Set fill and stroke before drawing.
setChecked($('pen-stroke-on'), true);
setInput($('pen-stroke-color'), '#c81e1e');
setInput($('pen-stroke-width'), '2.25');
setInput($('pen-stroke-pattern'), '2');
setChecked($('pen-fill-on'), true);
setInput($('pen-fill-color'), '#3366cc');
setInput($('pen-fill-opacity'), '75');

// 3. Draw: corner, corner, then a drag that pulls a bezier handle.
clickAt(1, 1);
check('first point starts a path', $('pen-cancel').disabled === false);
check('one point is not enough to finish', $('pen-finish').disabled === true);

clickAt(2, 1);
check('two points can be committed', $('pen-finish').disabled === false);

dragAt(3, 2.5, 3.75, 2.5);
mouse('mousemove', at(4, 1.25));
const preview = window.document.querySelector('#svg-container svg #pen-preview');
check('live preview is drawn while placing points', !!preview);
check('preview paints with the chosen stroke colour',
  (preview?.innerHTML || '').includes('#c81e1e'), (preview?.innerHTML || '').slice(0, 200));
check('preview paints the chosen fill', (preview?.innerHTML || '').includes('#3366cc'));

clickAt(4, 1.25);
check('point count is reported', /4 points/.test($('pen-hint').textContent), $('pen-hint').textContent);

// Undo/redo the last point to prove the path is still editable before commit.
$('pen-undo').click();
check('Undo point drops the last anchor', /3 points/.test($('pen-hint').textContent), $('pen-hint').textContent);
clickAt(4, 1.25);

// 4. Commit.
$('pen-finish').click();
const added = await waitFor(() => shapeGroups().length === shapesBefore + 1);
check('committing adds exactly one shape to the page', added,
  `${shapesBefore} → ${shapeGroups().length}; error: ${$('error-box')?.textContent}`);
check('the preview overlay is cleaned up', !window.document.querySelector('#pen-preview'));
check('the pen is ready for the next path', $('pen-finish').disabled === true);

const drawn = shapeGroups().at(-1);
const d = drawn?.querySelector('path')?.getAttribute('d') || '';
check('the drawn shape renders as a path with a curve', /\bC\b/.test(d), d.slice(0, 140));
check('the drawn shape renders with the chosen stroke',
  (drawn?.innerHTML || '').includes('#c81e1e'), (drawn?.innerHTML || '').slice(0, 200));
check('the drawn shape renders with the chosen fill',
  (drawn?.innerHTML || '').includes('#3366cc'), (drawn?.innerHTML || '').slice(0, 200));

// 5. A half-drawn path is scaffolding: it must not leak into an exported SVG.
const shapesAfterCommit = shapeGroups().length;
clickAt(6, 6);
clickAt(7, 6);
check('a path is in progress again', !!window.document.querySelector('#pen-preview'));
const capturedBeforeExport = captured.length;
$('btn-export').click();
$('export-run').click();
if (await waitFor(() => captured.length > capturedBeforeExport)) {
  const exported = await captured.at(-1).text();
  check('exported SVG omits the pen overlay', !exported.includes('pen-preview'));
}
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Esc discards an in-progress path', !window.document.querySelector('#pen-preview'));
check('Esc did not add a shape', shapeGroups().length === shapesAfterCommit);

// 6. Save and re-open: is the path really in the package?
const capturedBeforeSave = captured.length;
$('btn-save-vsdx').click();
const saved = await waitFor(() => captured.length > capturedBeforeSave);
check('Save produced a download', saved, 'error: ' + $('error-box')?.textContent);

if (saved) {
  const bytes = Buffer.from(await captured.at(-1).arrayBuffer());
  check('saved file is a ZIP', bytes.subarray(0, 2).toString() === 'PK');

  const zip = await JSZip.loadAsync(bytes);
  const pageNames = Object.keys(zip.files).filter(n => /^visio\/pages\/page\d+\.xml$/.test(n));
  const pageXmls = await Promise.all(pageNames.map(n => zip.file(n).async('string')));
  const withPath = pageXmls.find(xml => xml.includes('RelCubBezTo'));
  check('the saved page carries the drawn cubic', !!withPath);
  check('the saved page carries the stroke colour', !!withPath && withPath.includes('#c81e1e'));
  check('the saved page carries the fill colour', !!withPath && withPath.includes('#3366cc'));
  check('the saved page carries the dashed line pattern',
    !!withPath && /N="LinePattern" V="2"/.test(withPath));

  // Re-open the saved bytes in the app: the shape must come back.
  await dropFile(new window.File([bytes], 'pen-roundtrip.vsdx'));
  check('saved file re-opens', !!currentSvg(), 'error: ' + $('error-box')?.textContent);
  check('the drawn shape survived the round-trip', shapeGroups().length === shapesBefore + 1,
    `${shapeGroups().length} vs ${shapesBefore + 1}`);
  const reopened = shapeGroups().at(-1);
  check('and still renders as a curve',
    /\bC\b/.test(reopened?.querySelector('path')?.getAttribute('d') || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
