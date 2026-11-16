// Exercise the actual tools against a deterministic drawing: partial hits,
// nested groups, hidden objects, zoom/pan, isolation, and export.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync('dist/app.html', 'utf8');
const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously', url: 'http://localhost/',
  beforeParse(window) {
    delete window.MutationObserver;
    window.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
    window.Element.prototype.scrollIntoView = function () {};
    window.__downloads = [];
    window.URL.createObjectURL = blob => { window.__downloads.push(blob); return 'blob:test'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function () {};
    window.alert = () => {};
    window.CSS = { escape: value => String(value) };
  }
});
const { window } = dom;
const $ = id => window.document.getElementById(id);
const svg = () => $('svg-container').querySelector('svg');
const group = id => svg().querySelector(`g[data-shape-id="${id}"]`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async predicate => {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${$('error-box').textContent}`);
    await sleep(15);
  }
};
const originalArrayBuffer = window.Blob.prototype.arrayBuffer;
window.Blob.prototype.arrayBuffer = async function () {
  const bytes = new Uint8Array(await originalArrayBuffer.call(this));
  return new window.Uint8Array(bytes).buffer;
};
const script = window.document.createElement('script');
script.textContent = readFileSync('dist/main.js', 'utf8');
window.document.body.appendChild(script);

const ns = 'xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const cell = (name, value) => `<Cell N="${name}" V="${value}"/>`;
const shape = (id, x, y, width, height, children = '', layer = null) =>
  `<Shape ID="${id}" Name="Object ${id}" Type="${children ? 'Group' : 'Shape'}">` +
  cell('PinX', x) + cell('PinY', y) + cell('Width', width) + cell('Height', height) +
  cell('LocPinX', 0) + cell('LocPinY', 0) + cell('FillPattern', 1) +
  cell('FillForegnd', '#336699') + cell('LinePattern', 1) + cell('LineWeight', 0) +
  (layer === null ? '' : cell('LayerMember', layer)) +
  (children ? `<Shapes>${children}</Shapes>` :
    '<Section N="Geometry" IX="0">' + cell('NoFill', 0) + cell('NoLine', 0) +
    [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([px, py], i) =>
      `<Row T="${i ? 'RelLineTo' : 'RelMoveTo'}" IX="${i + 1}">${cell('X', px)}${cell('Y', py)}</Row>`).join('') + '</Section>') + '</Shape>';
const zip = await JSZip.loadAsync(readFileSync('test-files/test9_rect_and_line.vsdx'));
zip.file('visio/pages/pages.xml', `<Pages ${ns}><Page ID="0" Name="Test"><PageSheet>` +
  cell('PageWidth', 10) + cell('PageHeight', 10) +
  `<Section N="Layer"><Row IX="1">${cell('Name', 'Hidden')}${cell('Visible', 0)}</Row></Section>` +
  '</PageSheet><Rel r:id="rId1"/></Page></Pages>');
zip.file('visio/pages/page1.xml', `<PageContents ${ns}><Shapes>` +
  shape(1, 1, 1, 1, 1) + shape(2, 3, 1, 2, 1) + shape(3, 7, 7, 1, 1) +
  shape(4, 3.5, 2.5, 1, 0.5) + shape(5, 0.75, 3, 2, 0) + shape(6, 1, 2.4, 0.5, 0.5, '', '1') +
  shape(10, 0, 0, 6, 6, shape(11, 1, 4, 1, 1) +
    shape(12, 3, 4, 2, 2, shape(13, 0.1, 0.1, 0.5, 0.5) + shape(14, 1, 1, 0.5, 0.5))) +
  shape(20, 7, 1, 1, 1, shape(21, 2, 0.1, 1, 0.5)) +
  shape(30, 6, 5, 2, 2, shape(31, 0, 0, 1, 1), '1') +
  '</Shapes></PageContents>');
const drawing = await zip.generateAsync({ type: 'nodebuffer' });
const load = async () => {
  const before = svg();
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [new window.File([drawing], 'area.vsdx')] } });
  $('drop-zone').dispatchEvent(event);
  await waitFor(() => svg() && svg() !== before && group(1));
};
const mouse = (type, target, x, y, extra = {}) => target.dispatchEvent(new window.MouseEvent(type, {
  bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra
}));
const key = name => $('viewport').dispatchEvent(new window.KeyboardEvent('keydown', {
  key: name, bubbles: true, cancelable: true
}));
const mode = value => {
  $('selection-mode').value = value;
  $('selection-mode').dispatchEvent(new window.Event('change', { bubbles: true }));
};
const targets = value => {
  $('selection-target').value = value;
  $('selection-target').dispatchEvent(new window.Event('change', { bubbles: true }));
};
const client = (x, y) => {
  const transform = $('svg-container').style.transform;
  const pan = /translate\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(transform);
  const scale = Number(/scale\(([^)]+)\)/.exec(transform)?.[1] || 1);
  const vb = svg().getAttribute('viewBox').split(/[\s,]+/).map(Number);
  const zoom = ((parseFloat(svg().style.width) || vb[2]) / vb[2]) * scale;
  return { x: x * 96 * zoom + Number(pan?.[1] || 0), y: (10 - y) * 96 * zoom + Number(pan?.[2] || 0) };
};
const selected = () => [...svg().querySelectorAll('g[data-selected]')]
  .map(node => Number(node.getAttribute('data-shape-id'))).sort((a, b) => a - b);
let checks = 0;
const expect = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rect = (x1, y1, x2, y2, extra = {}, startTarget = svg()) => {
  const start = client(x1, y1), end = client(x2, y2);
  mouse('mousedown', startTarget, start.x, start.y, extra);
  mouse('mousemove', window, end.x, end.y, extra);
  mouse('mouseup', window, end.x, end.y, extra);
  // A real browser sends a click after the release. It must not collapse the
  // area selection to whichever object happens to be under its endpoint.
  mouse('click', group(1), end.x, end.y, extra);
};

await load();
expect($('btn-pan').classList.contains('active'), true, 'Pan is the default');
const placement = group(1).getAttribute('transform');
const beforePan = $('svg-container').style.transform;
mouse('mousedown', group(1), 150, 850);
mouse('mousemove', window, 190, 880);
mouse('mouseup', window, 190, 880);
await sleep(30);
expect(group(1).getAttribute('transform'), placement, 'Pan never moves a shape');
assert.notEqual($('svg-container').style.transform, beforePan, 'Pan moves the drawing'); checks++;

await load();
mode('contained');
expect($('btn-select').classList.contains('active'), true, 'Choosing an area mode activates Select');
rect(0.5, 0.5, 3.5, 3.5);
expect(selected(), [1, 5], 'Contained excludes partial shapes, groups, and hidden objects');
expect($('area-selection'), null, 'The rectangle is removed on release');
rect(0, 0, 10.5, 10.5);
expect(selected(), [1, 2, 3, 4, 5, 11, 13, 14, 21], 'A large area marks every visible individual element exactly once');
mode('touching');
rect(0.5, 0.5, 3.5, 3.5);
expect(selected(), [1, 2, 4, 5], 'Touching includes partial and edge contact without selecting the enclosing group');
rect(3.5, 3.5, 0.5, 0.5);
expect(selected(), [1, 2, 4, 5], 'Dragging in the opposite direction has the same result');
const beforeArea = group(1).getAttribute('transform');
rect(1.25, 1.25, 3.8, 2.25, {}, group(1));
expect(selected(), [1, 2], 'Area selection can start on a shape');
expect(group(1).getAttribute('transform'), beforeArea, 'Starting on a shape never moves it in area mode');
rect(0.5, 0.5, 3.5, 3.5);
rect(0.8, 3.9, 2.2, 5.1, { shiftKey: true });
expect(selected(), [1, 2, 4, 5, 11], 'Shift adds to the existing selection');
rect(8, 8, 8.5, 8.5);
expect(selected(), [3], 'Touching includes a shape sharing the rectangle corner');
mode('contained');
rect(8.2, 8.2, 8.8, 8.8);
expect(selected(), [], 'An empty area replaces the selection');

mode('touching');
targets('groups');
rect(0.5, 0.5, 3.5, 3.5);
expect(selected(), [1, 2, 4, 5, 10], 'Groups as objects selects current-level groups without descendants');
mode('contained');
rect(6.9, 0.9, 8.1, 2.1);
expect(selected(), [], 'A group is not enclosed if its child extends outside the rectangle');
targets('elements');
mode('touching');
rect(0, 3.8, 5.8, 6.2);
expect(selected(), [11, 13, 14], 'Individual elements searches through nested groups');

const point = client(1.5, 1.5);
mouse('mousedown', group(1), point.x, point.y);
mouse('mousemove', window, point.x + 25, point.y + 25);
expect($('area-selection')?.dataset.mode, 'touching', 'The live rectangle identifies its mode');
key('Escape');
mouse('mouseup', window, point.x + 25, point.y + 25);
mouse('click', group(1), point.x + 25, point.y + 25);
expect(selected(), [11, 13, 14], 'Escape cancels without changing the previous selection');
expect($('area-selection'), null, 'Escape clears the live rectangle');

// Double-clicking a nested part enters its outer group first, then its inner
// group. Scope affects point selection, rectangle selection, and the tree.
mouse('dblclick', group(13), 0, 0);
expect($('group-isolation-bar').hidden, false, 'Double-click enters group isolation');
expect($('group-isolation-path').textContent, 'Drawing›Object 10', 'The breadcrumb identifies the outer group');
expect(svg().querySelector('#group-isolation-shade rect').getAttribute('fill'), '#fff', 'Outside content gets a white wash');
expect(svg().querySelectorAll('#group-isolation-shade [data-shape-id]').length, 0, 'The isolated visual copy cannot be picked');
expect([...$('shape-tree-body').querySelectorAll('.shape-tree-node')].map(row => Number(row.dataset.shapeId)).sort((a, b) => a - b),
  [11, 12, 13, 14], 'The Shape Tree is scoped to the isolated group');
mouse('click', group(3), 0, 0);
expect(selected(), [], 'Objects outside isolation cannot be selected');
mode('touching');
rect(0, 0, 10, 10);
expect(selected(), [11, 13, 14], 'Area selection stays inside the isolated group');
targets('groups');
rect(0, 0, 10, 10);
expect(selected(), [11, 12], 'Groups as objects works one level inside isolation');
mouse('dblclick', group(13), 0, 0);
expect($('group-isolation-path').textContent, 'Drawing›Object 10›Object 12', 'Double-click enters a nested group');
const visualCopy = svg().querySelector('#group-isolation-shade').lastElementChild;
expect(visualCopy.getAttribute('transform'), group(10).getAttribute('transform'), 'The visual copy preserves the outer group transform');
expect(visualCopy.firstElementChild.getAttribute('transform'), group(12).getAttribute('transform'), 'The visual copy preserves the nested group transform');
targets('elements');
mode('touching');
rect(0, 0, 10, 10);
expect(selected(), [13, 14], 'Nested isolation excludes siblings in the outer group');
key('Escape');
expect($('group-isolation-path').textContent, 'Drawing›Object 10', 'Escape returns to the parent group');

mode('point');
mouse('click', group(11), 0, 0);
const oldPlacement = group(11).getAttribute('transform');
const from = client(1.5, 4.5), to = client(1.7, 4.7);
mouse('mousedown', group(11), from.x, from.y);
mouse('mousemove', window, to.x, to.y);
mouse('mouseup', window, to.x, to.y);
await waitFor(() => group(11).getAttribute('transform') !== oldPlacement);
const newPlacement = group(11).getAttribute('transform');
expect([...svg().querySelectorAll('#group-isolation-shade [transform]')]
  .some(node => node.getAttribute('transform') === newPlacement), true, 'Isolation updates after moving a child');

const downloadsBefore = window.__downloads.length;
$('btn-export').click();
$('export-run').click();
await waitFor(() => window.__downloads.length > downloadsBefore);
const exported = await window.__downloads.at(-1).text();
expect(exported.includes('group-isolation-shade'), false, 'Export omits the isolation wash and visual copy');
expect((exported.match(/data-shape-id="11"/g) || []).length, 1, 'Export contains each original shape once');
$('group-isolation-path').querySelector('button').click();
expect($('group-isolation-bar').hidden, true, 'The Drawing breadcrumb exits isolation');
expect(svg().querySelector('#group-isolation-shade'), null, 'Exiting removes the white wash');

// Exercise the real zoom and pan transforms rather than assuming screen
// pixels always equal SVG units.
$('btn-zoom-in').click();
$('btn-zoom-in').click();
$('btn-pan').click();
mouse('mousedown', svg(), 400, 400);
mouse('mousemove', window, 430, 425);
mouse('mouseup', window, 430, 425);
await sleep(180);
mode('contained');
rect(0.5, 0.5, 2.5, 2.5);
expect(selected(), [1], 'Area selection follows zoom and pan');
mouse('dblclick', group(13), 0, 0);
await load();
expect($('group-isolation-bar').hidden, true, 'Opening a new file exits isolation');
expect($('btn-pan').classList.contains('active'), true, 'Opening a new file restores Pan');
mouse('dblclick', group(13), 0, 0);
expect($('group-isolation-bar').hidden, false, 'Double-click also enters a group from Pan');
$('btn-pen').click();
expect($('group-isolation-bar').hidden, true, 'Choosing Pen exits isolation before creating page shapes');

console.log(`area-selection-app: ${checks} assertions passed`);
dom.window.close();
