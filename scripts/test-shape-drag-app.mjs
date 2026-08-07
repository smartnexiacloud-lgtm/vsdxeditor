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
// mouse-up.
//
// It used to commit by rewriting the .vsdx, parsing it back and drawing the
// whole page from the result, so a release was something to wait for by
// watching for a fresh <svg>. A move, a resize and a turn change six numbers on
// one shape and nothing else, so they are now made on the drawing that is
// already on screen. A resize draws that one shape again; a move, a turn or a
// flip only writes where its group sits. So what a release waits for is the
// shape's group being *placed* somewhere else — by either route.
const placementOf = (shapeId) => {
  const group = groupEl(shapeId);
  return group ? `${group.getAttribute('transform')}` : null;
};
const drag = async (shapeId, target, from, to, init = {}) => {
  const before = { group: groupEl(shapeId), svg: currentSvg(), placement: placementOf(shapeId) };
  mouse('mousedown', from.x, from.y, target, init);
  await sleep(20);
  mouse('mousemove', (from.x + to.x) / 2, (from.y + to.y) / 2, window.document, init);
  await sleep(20);
  mouse('mousemove', to.x, to.y, window.document, init);
  await sleep(20);
  return { before };
};
const release = async (shapeId, to, before, init = {}) => {
  mouse('mouseup', to.x, to.y, window.document, init);
  const committed = await waitFor(() => groupEl(shapeId)
    && (groupEl(shapeId) !== before.group || placementOf(shapeId) !== before.placement));
  // A browser fires a click after the mouse comes up, and the app has to
  // swallow that one — otherwise a drag of several shapes would end with the
  // selection collapsed onto whichever one the pointer happened to be over. So
  // the test fires it too, or the suppression is left armed for the next click
  // the test makes on purpose.
  mouse('click', to.x, to.y, groupEl(shapeId));
  await sleep(20);
  return committed;
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
const treeRowsBefore = [...window.document.querySelectorAll('#shape-tree-body .shape-tree-node')];
const childrenBefore = [...groupEl(target.id).children];
let { before } = await drag(target.id, groupEl(target.id), { x: origin.x + 5, y: origin.y + 5 },
  { x: origin.x + 5 + MOVE_X, y: origin.y + 5 + MOVE_Y });
check('an outline is drawn where the shape is about to be', !!q('#shape-drag-preview'),
  currentSvg()?.innerHTML.slice(0, 0) || '');
check('and the drawing itself has not been touched yet',
  originOf(target.id)?.x === origin.x, JSON.stringify(originOf(target.id)));
check('the moved shape is committed', await release(target.id, { x: origin.x + 5 + MOVE_X, y: origin.y + 5 + MOVE_Y }, before),
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
// And they are on the shape, not where it used to be. The handles, the
// selection outline and what a click picks are all read from the same
// flattened boxes, so a placement that forgot to throw those away would leave
// every one of them a drag behind. The "nw" handle sits on the shape's own
// local (0,0), which for a plain-translate shape is its origin exactly.
const nwHandle = handleFor('nw');
check('and they are drawn on the shape where it is now, not where it was',
  nwHandle && Math.abs(centreOf(nwHandle).x - afterMove.x) < 0.01
  && Math.abs(centreOf(nwHandle).y - afterMove.y) < 0.01,
  `${JSON.stringify(nwHandle && centreOf(nwHandle))} vs ${JSON.stringify(afterMove)}`);

// Nothing but the shape changed, so nothing but the shape is built again. This
// is the whole point: reloading the package to move one group cost 18 seconds
// of parse on a 20 MB drawing before a pixel of it moved.
check('the rest of the drawing was not drawn again', currentSvg() === before.svg);
check('and the Shape Tree was not rebuilt to move one shape',
  [...window.document.querySelectorAll('#shape-tree-body .shape-tree-node')]
    .every((row, i) => row === treeRowsBefore[i]));
check('every other shape is the element it already was',
  [...window.document.querySelectorAll('#svg-container svg > g[data-shape-id]')]
    .filter(g => g.getAttribute('data-shape-id') !== target.id)
    .every(g => g === before.svg.querySelector(`g[data-shape-id="${g.getAttribute('data-shape-id')}"]`)));

// Nor is the shape that moved. What it looks like has not changed — only where
// it is, and that is one attribute on its group. Building the group again to
// write it would cost what is inside the shape, which for a group of a thousand
// children is a thousand elements to move it an inch.
check('and the shape that moved was placed, not built again',
  groupEl(target.id) === before.group, 'its group was replaced');
check('what is drawn inside it is the same as before',
  [...groupEl(target.id).children].every((child, i) => child === childrenBefore[i]));

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
({ before } = await drag(target.id, se, sePoint, { x: sePoint.x + 40, y: sePoint.y + 30 }));
check('resizing draws an outline too', !!q('#shape-drag-preview'));
check('the resize is committed', await release(target.id, { x: sePoint.x + 40, y: sePoint.y + 30 }, before), errorText());
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
({ before } = await drag(target.id, rotate, grip, { x: grip.x + 120, y: grip.y + 120 }));
check('turning draws an outline too', !!q('#shape-drag-preview'));
check('the rotation is committed', await release(target.id, { x: grip.x + 120, y: grip.y + 120 }, before), errorText());
const turned = groupEl(target.id)?.getAttribute('transform') || '';
check('the shape is no longer a plain translate, so it has been turned',
  !/^translate\([^)]*\)$/.test(turned), turned);

// --- 6. All of it is in the file, not just on screen ------------------------
// Now that a placement is made on the model rather than by reloading the
// package, this is what says the package hears about it at all: three drags are
// still only in memory when Save is clicked, and Save has to fold every one of
// them into the bytes. It is also the check that the numbers the model was
// given are the numbers the file gives back — the reopened transform is
// compared against the on-screen one character for character.
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

// --- 7b. The hand tool pans from anywhere, shapes included ------------------
// Pressing empty canvas is no use on a drawing whose shapes cover it, and on a
// big one they cover most of it. So there is a hand, and with it out a press on
// a shape moves the drawing rather than the shape.
const panOffset = () => {
  const m = /^translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(containerTransform());
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};
$('btn-select').click();
groupEl(target.id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
check('with Select out, pressing the shape picks it', handles().length > 0, String(handles().length));

// Somewhere squarely on the shape, in the coordinates a mouse arrives in. The
// shape has been turned by now, so its transform no longer says where it is;
// the handles do — they sit on its own corners — and the drawing has been
// panned since, which is the difference between the two.
const grab = (() => {
  const nw = centreOf(handleFor('nw'));
  const se = centreOf(handleFor('se'));
  const pan = panOffset();
  return { x: (nw.x + se.x) / 2 + pan.x, y: (nw.y + se.y) / 2 + pan.y };
})();

$('btn-pan').click();
await sleep(60);
check('the toolbar lights the tool that has the canvas',
  $('btn-pan').classList.contains('active') && !$('btn-select').classList.contains('active'));
check('and the handles step aside for the hand', handles().length === 0, String(handles().length));
check('but the shape is still the selected one',
  groupEl(target.id).getAttribute('data-selected') === 'primary');

const heldPlacement = placementOf(target.id);
const heldPan = containerTransform();
mouse('mousedown', grab.x, grab.y, groupEl(target.id));
mouse('mousemove', grab.x + 40, grab.y + 25, window.document);
mouse('mouseup', grab.x + 40, grab.y + 25, window.document);
await sleep(60);
check('dragging a shape with the hand out pans the drawing',
  containerTransform() !== heldPan, `${containerTransform()} vs ${heldPan}`);
check('and leaves the shape exactly where it was',
  placementOf(target.id) === heldPlacement, `${placementOf(target.id)} vs ${heldPlacement}`);

// A click is how a shape is picked, so the hand has to swallow that too — a
// drag that ends over a different shape must not select it.
const otherId = topLevel().find(id => id !== target.id);
check('there is another shape to try to click', !!otherId, topLevel().join(','));
groupEl(otherId).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(60);
check('and a click with the hand out picks nothing',
  !groupEl(otherId).getAttribute('data-selected')
  && groupEl(target.id).getAttribute('data-selected') === 'primary',
  `${groupEl(otherId).getAttribute('data-selected')} / ${groupEl(target.id).getAttribute('data-selected')}`);

$('btn-select').click();
await sleep(60);
check('Select takes the canvas back, handles and all',
  $('btn-select').classList.contains('active') && handles().length > 0, String(handles().length));

// --- 8. A read-only package has no handles ----------------------------------
// (Nothing here loads one, so this checks the other half: the pen tool owns the
// canvas while it is active, and handles must not fight it for the pointer.)
$('btn-pen').click();
await sleep(60);
check('the pen tool takes the handles away while it is drawing', handles().length === 0,
  String(handles().length));
$('btn-pen').click();
await sleep(60);

// --- 9. A drag is planned once a frame, not once an event -------------------
// A pointer reports far faster than the screen redraws — a 1000 Hz mouse is 16
// events a frame — and planning for a position that is already stale is work
// thrown away. On a drawing of 8,470 shapes that was 39 ms of arithmetic per
// event, so the events piled up behind it and the drag visibly stuttered.
//
// So a move only records where the pointer is; the planning happens on the
// frame. Which means the outline is not there the instant the mouse moves — and
// that a drag let go before its frame has come must not lose the last move.
// Back to the fixture as it shipped: everything above has been moved, resized
// and turned, and this section needs a shape still placed by a plain translate
// so client pixels and drawing units line up.
await dropFile(new window.File([readFileSync(fixture)], 'drag-again.vsdx'));
const fresh = translated()[0];
check('there is an untouched shape to drag', !!fresh, topLevel().join(','));
groupEl(fresh.id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);

const burstFrom = originOf(fresh.id);
mouse('mousedown', burstFrom.x + 5, burstFrom.y + 5, groupEl(fresh.id));
for (let i = 1; i <= 8; i++) mouse('mousemove', burstFrom.x + 5 + i * 4, burstFrom.y + 5, window.document);
check('eight moves in one frame have not drawn anything yet', !q('#shape-drag-preview'));
await sleep(60);
check('…and when the frame comes, there is one outline', !!q('#shape-drag-preview'));
check('…and the drawing still has not been touched',
  originOf(fresh.id)?.x === burstFrom.x, JSON.stringify(originOf(fresh.id)));

// Let go in the same breath as the last move: the position the hand released at
// is the one that has to be committed, not the one the last frame happened to
// see. It has to end somewhere the previous burst did not, or a drag that threw
// the last move away would land in the right place by luck.
const BURST = 72;   // the burst above stopped at +32
const burstBefore = placementOf(fresh.id);
for (let i = 1; i <= 6; i++) {
  mouse('mousemove', burstFrom.x + 5 + (i * BURST) / 6, burstFrom.y + 5, window.document);
}
mouse('mouseup', burstFrom.x + 5 + BURST, burstFrom.y + 5, window.document);
check('the drag committed', await waitFor(() => placementOf(fresh.id) !== burstBefore),
  errorText());
const landed = originOf(fresh.id);
check('and it landed where the mouse was let go, not where the last frame saw it',
  landed && Math.abs(landed.x - (burstFrom.x + BURST)) < 0.01,
  `${JSON.stringify(landed)} vs x=${burstFrom.x + BURST}`);

// --- 10. Groups, and more than one shape at a time --------------------------
// A group is the case the placement path has to get right and cannot fake: the
// shapes inside it are placed in *its* coordinates, so moving it must not touch
// a single one of their cells — they come along because the group they hang off
// moved. Redrawing the group redraws them with it, and that is the check.
await dropFile(new window.File([readFileSync('test-files/test3_house.vsdx')], 'group-drag.vsdx'));
const groupRoot = translated().find(entry => entry.g.querySelector('g[data-shape-id]'));
check('the house has a group placed by a plain translate', !!groupRoot, topLevel().join(','));

const childId = groupRoot.g.querySelector('g[data-shape-id]').getAttribute('data-shape-id');
const childTransform = groupEl(childId).getAttribute('transform');
const groupOrigin = originOf(groupRoot.id);
groupEl(groupRoot.id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
const GROUP_DX = 24, GROUP_DY = 18;
({ before } = await drag(groupRoot.id, groupEl(groupRoot.id),
  { x: groupOrigin.x + 3, y: groupOrigin.y + 3 },
  { x: groupOrigin.x + 3 + GROUP_DX, y: groupOrigin.y + 3 + GROUP_DY }));
check('dragging a group commits', await release(groupRoot.id,
  { x: groupOrigin.x + 3 + GROUP_DX, y: groupOrigin.y + 3 + GROUP_DY }, before), errorText());
const groupLanded = originOf(groupRoot.id);
check('the group moved by the distance dragged',
  Math.abs(groupLanded.x - (groupOrigin.x + GROUP_DX)) < 0.01
  && Math.abs(groupLanded.y - (groupOrigin.y + GROUP_DY)) < 0.01,
  `${JSON.stringify(groupLanded)} vs ${JSON.stringify({ x: groupOrigin.x + GROUP_DX, y: groupOrigin.y + GROUP_DY })}`);
check('and what is inside it came along without being moved itself',
  groupEl(childId)?.getAttribute('transform') === childTransform,
  `${groupEl(childId)?.getAttribute('transform')} vs ${childTransform}`);
check('the child is drawn inside the group it belongs to',
  groupEl(groupRoot.id)?.contains(groupEl(childId)));

// Two shapes at once: Ctrl-click adds to the selection, and both move.
const second = translated().find(entry => entry.id !== groupRoot.id);
check('there is a second shape to add to the selection', !!second, topLevel().join(','));
groupEl(second.id).dispatchEvent(new window.MouseEvent('click', {
  bubbles: true, cancelable: true, ctrlKey: true }));
await sleep(80);
const pairBefore = { group: originOf(groupRoot.id), second: originOf(second.id) };
const pairFrom = { x: pairBefore.second.x + 3, y: pairBefore.second.y + 3 };
const PAIR_DX = -15, PAIR_DY = 11;
({ before } = await drag(second.id, groupEl(second.id), pairFrom,
  { x: pairFrom.x + PAIR_DX, y: pairFrom.y + PAIR_DY }));
check('dragging a selection of two commits',
  await release(second.id, { x: pairFrom.x + PAIR_DX, y: pairFrom.y + PAIR_DY }, before), errorText());
const pairAfter = { group: originOf(groupRoot.id), second: originOf(second.id) };
check('both shapes moved, by the same distance',
  Math.abs(pairAfter.second.x - (pairBefore.second.x + PAIR_DX)) < 0.01
  && Math.abs(pairAfter.group.x - (pairBefore.group.x + PAIR_DX)) < 0.01
  && Math.abs(pairAfter.group.y - (pairBefore.group.y + PAIR_DY)) < 0.01,
  `${JSON.stringify(pairAfter)} vs ${JSON.stringify(pairBefore)}`);

// --- 11. A placement waiting behind a structural edit -----------------------
// Three drags are sitting in memory, unwritten. Bringing a shape to the front
// *is* structural — it moves an element in the page part — so it goes through
// the package and comes back as a fresh model. It has to write the drags into
// the bytes on the way, or reloading throws every one of them away. This is the
// whole risk of not writing an edit the moment it is made, so it is checked
// where it bites rather than only at Save.
const beforeReorder = currentSvg();
groupEl(groupRoot.id).dispatchEvent(new window.MouseEvent('contextmenu', {
  bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
await sleep(80);
check('the shape menu offers Bring to front', !$('shape-arrange-front').disabled);
$('shape-arrange-front').click();
check('bringing it to the front reloads the drawing',
  await waitFor(() => currentSvg() && currentSvg() !== beforeReorder
    && currentSvg().querySelector('g[data-shape-id]')), errorText());
check('and the drags made before it survived the reload',
  Math.abs(originOf(groupRoot.id).x - pairAfter.group.x) < 0.01
  && Math.abs(originOf(groupRoot.id).y - pairAfter.group.y) < 0.01
  && Math.abs(originOf(second.id).x - pairAfter.second.x) < 0.01,
  `${JSON.stringify(originOf(groupRoot.id))} vs ${JSON.stringify(pairAfter.group)}`);
check('the shape really did come to the front', topLevel().at(-1) === groupRoot.id,
  topLevel().join(','));

// And all of it is in a file that can be opened again.
const beforeGroupSave = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > beforeGroupSave);
const groupBytes = Buffer.from(await captured.at(-1).arrayBuffer());
const onScreen = { group: groupEl(groupRoot.id).getAttribute('transform'),
  second: groupEl(second.id).getAttribute('transform') };
window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([groupBytes], 'group-drag-reopened.vsdx'));
check('the saved file opens with both shapes where they were left',
  groupEl(groupRoot.id)?.getAttribute('transform') === onScreen.group
  && groupEl(second.id)?.getAttribute('transform') === onScreen.second,
  `${groupEl(groupRoot.id)?.getAttribute('transform')} vs ${onScreen.group}`);
check('and the child inside the group still placed where it always was',
  groupEl(childId)?.getAttribute('transform') === childTransform,
  `${groupEl(childId)?.getAttribute('transform')} vs ${childTransform}`);

// --- 12. Dragging a shape that lives inside a group -------------------------
// A child's cells are in its group's coordinates and its flipped Y is measured
// against the group's height, not the page's. Drawing it again therefore needs
// to be told which box it hangs off — get that wrong and it lands somewhere
// else entirely, in a way nothing on screen can catch by itself because the
// drawing and the wrong answer agree with each other.
//
// What catches it is the file. Drag the child, save, open the file again, and
// compare the transform the app drew against the one a fresh parse produces,
// character for character.
const nested = [...groupEl(groupRoot.id).querySelectorAll('g[data-shape-id]')]
  .find(g => g.getAttribute('transform'));
check('the group holds a child with a placement of its own', !!nested,
  groupEl(groupRoot.id)?.innerHTML.slice(0, 0) || '');
const nestedId = nested.getAttribute('data-shape-id');
const nestedBefore = nested.getAttribute('transform');

({ before } = await drag(nestedId, groupEl(nestedId), { x: 200, y: 200 }, { x: 233, y: 179 }));
check('dragging a nested shape commits',
  await release(nestedId, { x: 233, y: 179 }, before), errorText());
const nestedAfter = groupEl(nestedId)?.getAttribute('transform');
check('the nested shape was placed somewhere new', nestedAfter !== nestedBefore,
  `${nestedAfter} vs ${nestedBefore}`);
check('and it is still drawn inside its group',
  groupEl(groupRoot.id)?.contains(groupEl(nestedId)));

const beforeNestedSave = captured.length;
$('btn-save-vsdx').click();
await waitFor(() => captured.length > beforeNestedSave);
const nestedBytes = Buffer.from(await captured.at(-1).arrayBuffer());
window.document.querySelector('#svg-container').innerHTML = '';
await dropFile(new window.File([nestedBytes], 'nested-drag-reopened.vsdx'));
check('and the file puts it exactly where the app drew it',
  groupEl(nestedId)?.getAttribute('transform') === nestedAfter,
  `${groupEl(nestedId)?.getAttribute('transform')} vs ${nestedAfter}`);

// --- 13. What was hidden stays hidden ---------------------------------------
// Whether a shape is on screen is not in the file — it is the layers the viewer
// has turned off and the rows unticked in the Shape Tree, held apart from the
// drawing. A shape drawn again from the model knows nothing about any of that,
// so a redraw has to be told, or dragging a group would bring back everything
// inside it that was deliberately put away.
groupEl(groupRoot.id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
const nestedRow = window.document.querySelector(
  `#shape-tree-body .shape-tree-node[data-shape-id="${nestedId}"] .shape-tree-checkbox`);
check('the Shape Tree offers to hide the shape inside the group', !!nestedRow);
nestedRow.checked = false;
nestedRow.dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(80);
check('unticking it takes the shape off the drawing',
  groupEl(nestedId)?.style.display === 'none', groupEl(nestedId)?.style.display);

const hiddenOrigin = originOf(groupRoot.id);
({ before } = await drag(groupRoot.id, groupEl(groupRoot.id),
  { x: hiddenOrigin.x + 3, y: hiddenOrigin.y + 3 },
  { x: hiddenOrigin.x + 33, y: hiddenOrigin.y + 17 }));
check('the group still drags with something inside it hidden',
  await release(groupRoot.id, { x: hiddenOrigin.x + 33, y: hiddenOrigin.y + 17 }, before), errorText());
check('and the hidden shape did not come back with the redraw',
  groupEl(nestedId)?.style.display === 'none', groupEl(nestedId)?.style.display);
check('while the group itself moved', Math.abs(originOf(groupRoot.id).x - (hiddenOrigin.x + 30)) < 0.01,
  `${JSON.stringify(originOf(groupRoot.id))} vs x=${hiddenOrigin.x + 30}`);

// The same again for a shape that is hidden and is itself one of the shapes
// being moved, rather than a passenger inside one. You cannot press a shape
// that is not on screen, but you can put it in the selection first and then
// hide it, and dragging the rest of the selection still takes it along.
groupEl(second.id).dispatchEvent(new window.MouseEvent('click', {
  bubbles: true, cancelable: true, ctrlKey: true }));
await sleep(80);
const secondBox = window.document.querySelector(
  `#shape-tree-body .shape-tree-node[data-shape-id="${second.id}"] .shape-tree-checkbox`);
secondBox.checked = false;
secondBox.dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(80);
check('a selected shape can be hidden and stay selected',
  groupEl(second.id)?.style.display === 'none'
  && !!groupEl(second.id)?.dataset.selected, groupEl(second.id)?.style.display);

const bothFrom = originOf(groupRoot.id);
const secondFrom = originOf(second.id);
({ before } = await drag(groupRoot.id, groupEl(groupRoot.id),
  { x: bothFrom.x + 3, y: bothFrom.y + 3 }, { x: bothFrom.x + 23, y: bothFrom.y - 9 }));
check('dragging the pair commits',
  await release(groupRoot.id, { x: bothFrom.x + 23, y: bothFrom.y - 9 }, before), errorText());
check('the hidden shape moved with the rest',
  Math.abs(originOf(second.id).x - (secondFrom.x + 20)) < 0.01,
  `${JSON.stringify(originOf(second.id))} vs x=${secondFrom.x + 20}`);
check('and it is still hidden, though it was drawn again in its own right',
  groupEl(second.id)?.style.display === 'none', groupEl(second.id)?.style.display);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
