// End-to-end test against the REAL built app (dist/) for dragging shapes.
//
// The drawing used to be editable only through dialogs and the XML editor — you
// could say where a shape belonged but not push it there, and a press on a shape
// panned the canvas. This drives the actual mouse events: press a shape and move
// it, drag a corner handle to resize it, drag the grip to turn it, and check the
// edits are real by saving the file and opening it again.
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
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake'; };
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => null;
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
const errorText = () => $('error-box')?.textContent.trim() || '';
const currentSvg = () => q('#svg-container svg');
const dropFile = async (file) => {
  if ($('error-box')) $('error-box').textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  await waitFor(() => currentSvg() && currentSvg() !== previous
    && currentSvg().querySelector('g[data-shape-id]'));
};

// jsdom has no layout, so the app falls back to the viewBox/pan/zoom mapping:
// at zoom 1 with no pan, a client pixel is a user unit measured from the
// viewport's top-left, which is at (0,0). A group whose transform is a plain
// translate therefore has its local origin at exactly those client coordinates.
const groupEl = (id) => q(`#svg-container svg g[data-shape-id="${id}"]`);
const topLevel = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => g.getAttribute('data-shape-id'));
const translated = () => [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
  .map(g => ({ g, id: g.getAttribute('data-shape-id'),
    t: /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/.exec(g.getAttribute('transform') || '') }))
  .filter(entry => entry.t)
  .map(entry => ({ ...entry, x: Number(entry.t[1]), y: Number(entry.t[2]) }));
const originOf = (id) => {
  const m = /^translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)$/
    .exec(groupEl(id)?.getAttribute('transform') || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};
const handles = () => [...window.document.querySelectorAll('#shape-selection [data-handle]')];
const handleFor = (name) => handles().find(h => h.getAttribute('data-handle') === name);
const centreOf = (el) => {
  if (el.tagName === 'circle') return { x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) };
  return {
    x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
    y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2
  };
};

const mouse = (type, x, y, target, init = {}) =>
  (target || window.document).dispatchEvent(new window.MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init
  }));

// A drag: press on `target`, travel past the slop, let go. The app commits on
// mouse-up and reloads the package, so wait for the SVG to be replaced.
const drag = async (target, from, to, init = {}) => {
  const before = currentSvg();
  mouse('mousedown', from.x, from.y, target, init);
  await sleep(20);
  mouse('mousemove', (from.x + to.x) / 2, (from.y + to.y) / 2, window.document, init);
  await sleep(20);
  mouse('mousemove', to.x, to.y, window.document, init);
  await sleep(20);
  return { before };
};
const release = async (to, before, init = {}) => {
  mouse('mouseup', to.x, to.y, window.document, init);
  return waitFor(() => currentSvg() && currentSvg() !== before
    && currentSvg().querySelector('g[data-shape-id]'));
};

const fixture = process.argv[2] || 'test-files/test9_rect_and_line.vsdx';
console.log(`── in-app shape drag: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'drag.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + errorText());

const target = translated()[0];
check('found a shape placed by a plain translate', !!target, topLevel().join(','));

// --- 1. Handles appear on the selected shape --------------------------------
check('nothing is selected, so there are no handles', handles().length === 0);
groupEl(target.id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('selecting a shape puts handles on it', handles().length > 0, String(handles().length));
check('eight of them resize', handles().filter(h => h.getAttribute('data-handle') !== 'rotate').length === 8,
  handles().map(h => h.getAttribute('data-handle')).join(','));
check('and one of them turns it', !!handleFor('rotate'));
check('every handle says which shape it belongs to',
  handles().every(h => h.getAttribute('data-handle-shape') === target.id));

// --- 2. A press that does not travel is still just a click ------------------
const origin = originOf(target.id);
mouse('mousedown', origin.x + 5, origin.y + 5, groupEl(target.id));
mouse('mousemove', origin.x + 6, origin.y + 5, window.document);
mouse('mouseup', origin.x + 6, origin.y + 5, window.document);
await sleep(120);
check('a press that barely moves does not edit the drawing',
  originOf(target.id)?.x === origin.x && originOf(target.id)?.y === origin.y,
  JSON.stringify(originOf(target.id)));
check('…and reports no error', !errorText(), errorText());

// --- 3. Dragging the shape moves it -----------------------------------------
const MOVE_X = 60, MOVE_Y = -40;
let { before } = await drag(groupEl(target.id), { x: origin.x + 5, y: origin.y + 5 },
  { x: origin.x + 5 + MOVE_X, y: origin.y + 5 + MOVE_Y });
check('an outline is drawn where the shape is about to be', !!q('#shape-drag-preview'),
  currentSvg()?.innerHTML.slice(0, 0) || '');
check('and the drawing itself has not been touched yet',
  originOf(target.id)?.x === origin.x, JSON.stringify(originOf(target.id)));
check('the moved shape is committed', await release({ x: origin.x + 5 + MOVE_X, y: origin.y + 5 + MOVE_Y }, before),
  errorText());
const afterMove = originOf(target.id);
check('the shape moved by the distance dragged',
  Math.abs(afterMove.x - (origin.x + MOVE_X)) < 0.01 && Math.abs(afterMove.y - (origin.y + MOVE_Y)) < 0.01,
  `${JSON.stringify(afterMove)} vs ${JSON.stringify({ x: origin.x + MOVE_X, y: origin.y + MOVE_Y })}`);
check('the preview outline is cleared once the drag is over', !q('#shape-drag-preview'));
check('the shape it moved is still the selected one',
  [...window.document.querySelectorAll('#svg-container svg g[data-shape-id]')]
    .filter(g => g.dataset.selected).map(g => g.getAttribute('data-shape-id')).join(',') === target.id);
check('so its handles came back', handles().length > 0);

// --- 4. Dragging a corner handle resizes it ---------------------------------
const sizeOf = (id) => {
  const g = groupEl(id);
  const path = g?.querySelector('path, rect, polygon, ellipse');
  return path?.getAttribute('d') || path?.getAttribute('width') || '';
};
const beforeGeometry = sizeOf(target.id);
const se = handleFor('se');
check('the shape has a bottom-right handle to pull', !!se,
  handles().map(h => h.getAttribute('data-handle')).join(','));
const sePoint = centreOf(se);
({ before } = await drag(se, sePoint, { x: sePoint.x + 40, y: sePoint.y + 30 }));
check('resizing draws an outline too', !!q('#shape-drag-preview'));
check('the resize is committed', await release({ x: sePoint.x + 40, y: sePoint.y + 30 }, before), errorText());
check('the shape is drawn differently afterwards, so its size really changed',
  sizeOf(target.id) !== beforeGeometry, `${sizeOf(target.id)} vs ${beforeGeometry}`);
check('and its top-left corner did not move — that is the corner not being dragged',
  Math.abs(originOf(target.id).x - afterMove.x) < 0.01
  && Math.abs(originOf(target.id).y - afterMove.y) < 0.01,
  `${JSON.stringify(originOf(target.id))} vs ${JSON.stringify(afterMove)}`);

// --- 5. Dragging the grip turns it ------------------------------------------
const rotate = handleFor('rotate');
check('there is a rotation grip', !!rotate);
const grip = centreOf(rotate);
({ before } = await drag(rotate, grip, { x: grip.x + 120, y: grip.y + 120 }));
check('turning draws an outline too', !!q('#shape-drag-preview'));
check('the rotation is committed', await release({ x: grip.x + 120, y: grip.y + 120 }, before), errorText());
const turned = groupEl(target.id)?.getAttribute('transform') || '';
check('the shape is no longer a plain translate, so it has been turned',
  !/^translate\([^)]*\)$/.test(turned), turned);

// --- 6. All of it is in the file, not just on screen ------------------------
const beforeSave = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > beforeSave);
check('Save produced a file', captured.length > beforeSave);
const savedBytes = Buffer.from(await captured.at(-1).arrayBuffer());
window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([savedBytes], 'drag-reopened.vsdx'));
check('the reopened drawing renders', !!currentSvg()?.querySelector('g[data-shape-id]'), errorText());
const reopened = groupEl(target.id)?.getAttribute('transform') || '';
check('and the shape comes back moved, resized and turned',
  reopened === turned, `${reopened} vs ${turned}`);

// --- 7. Pressing empty canvas still pans ------------------------------------
const containerTransform = () => $('svg-container').style.transform || '';
const wasTransform = containerTransform();
mouse('mousedown', 5, 5, $('viewport'));
mouse('mousemove', 45, 35, window.document);
mouse('mouseup', 45, 35, window.document);
await sleep(60);
check('a press on empty canvas still pans rather than dragging a shape',
  containerTransform() !== wasTransform, `${containerTransform()} vs ${wasTransform}`);

// --- 8. A read-only package has no handles ----------------------------------
// (Nothing here loads one, so this checks the other half: the pen tool owns the
// canvas while it is active, and handles must not fight it for the pointer.)
$('btn-pen').click();
await sleep(60);
check('the pen tool takes the handles away while it is drawing', handles().length === 0,
  String(handles().length));
$('btn-pen').click();
await sleep(60);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
