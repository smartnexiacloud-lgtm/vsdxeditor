// Editing an exported SVG somewhere else, and bringing the edits back.
//
// The round trip this covers is the one someone actually does: export a page,
// open it in Inkscape, delete something, draw something, save, drop the file
// back on the app. Until now that reported nothing at all — the SVG carries the
// whole drawing as metadata, so re-opening it unwrapped the original and threw
// the edited picture away.
//
// So these checks are deliberately end-to-end: a real fixture is rendered by
// the real renderer, the resulting SVG is edited as an SVG editor would edit it
// (a group removed, a path added, both by text), and what comes back has to be
// a real .vsdx whose shapes moved accordingly.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS', 'Element'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-svgimport-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { renderPage } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));
const { embedVsdxInSvg, extractVsdxFromSvg } = await import(pathToFileURL(join(tmp, 'svg-vsdx-embed.js')));
const { readSvgEdits, applySvgEdits, summarizeSvgEdits, normalizeCssColor, parseTransform, resolveStyle, penStyleFromSvg } =
  await import(pathToFileURL(join(tmp, 'svg-import.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const allShapes = (shapes, out = []) => {
  for (const shape of shapes || []) { out.push(shape); allShapes(shape.subShapes, out); }
  return out;
};

const FIXTURE = 'test-files/test9_rect_and_line.vsdx';
const source = toBuffer(readFileSync(FIXTURE));
const drawing = await parseVsdx(source);
const page = drawing.pages[0];

// The SVG the app would hand you, made the way the app makes it.
function exportSvg(target = page) {
  const stage = document.getElementById('stage');
  const svg = renderPage(target, stage);
  const text = new XMLSerializer().serializeToString(svg);
  return embedVsdxInSvg(text, new Uint8Array(source), 'test9_rect_and_line.vsdx', { pageId: target.id });
}

console.log('\nthe SVG says which page it is');
{
  const svgText = exportSvg();
  const embedded = extractVsdxFromSvg(svgText);
  check('the embedded document names its page', String(embedded.pageId) === String(page.id),
    `${embedded.pageId} vs ${page.id}`);
  check('…and still carries the drawing byte for byte',
    Buffer.compare(Buffer.from(embedded.buffer), Buffer.from(new Uint8Array(source))) === 0);
}

// ---------------------------------------------------------------------------
console.log('\nan untouched SVG reports no edits');
{
  const plan = readSvgEdits(exportSvg(), drawing, { pageId: page.id });
  check('the comparison ran', plan.ok, plan.reason || '');
  check('nothing was added', plan.added.length === 0, JSON.stringify(plan.added.map(a => a.label)));
  check('nothing was deleted', plan.removed.length === 0, JSON.stringify(plan.removed.map(r => r.id)));
  check('nothing was skipped', plan.skipped.length === 0, JSON.stringify(plan.skipped));
}

// ---------------------------------------------------------------------------
console.log('\na deletion in the SVG is a deletion in the drawing');

// Cut a shape's group out of the SVG text, the way deleting it in an editor does.
function deleteShapeFromSvg(svgText, shapeId) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const el = doc.querySelector(`[data-shape-id="${shapeId}"]`);
  if (!el) throw new Error(`fixture has no shape ${shapeId}`);
  el.parentNode.removeChild(el);
  return new XMLSerializer().serializeToString(doc);
}

const topLevel = page.shapes.map(shape => String(shape.id));
const victimId = topLevel[0];
{
  const edited = deleteShapeFromSvg(exportSvg(), victimId);
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  check('the missing shape is reported', plan.removed.map(entry => entry.id).join(',') === victimId,
    JSON.stringify(plan.removed));
  check('nothing is invented alongside it', plan.added.length === 0);

  const applied = await applySvgEdits(source, plan);
  const after = await parseVsdx(applied.buffer);
  const ids = allShapes(after.pages[0].shapes).map(shape => String(shape.id));
  check('the shape is gone from the saved drawing', !ids.includes(victimId), ids.join(','));
  check('and every other shape survived',
    ids.length === allShapes(page.shapes).length - allShapes([page.shapes.find(s => String(s.id) === victimId)]).length,
    `${ids.length} left`);
}

// ---------------------------------------------------------------------------
console.log('\na path drawn in the SVG becomes a shape in the drawing');

// The page is 96 user units to the inch with Y down from the top, so this
// triangle is the inch square whose top-left corner is one inch in from the
// top-left of the page.
const TRIANGLE = 'M 96 96 L 192 96 L 192 192 Z';

function addToSvg(svgText, markup, { intoLayer = null } = {}) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const fragment = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
  const host = intoLayer
    ? [...doc.documentElement.querySelectorAll('g')].find(g => g.getAttribute('inkscape:label') === intoLayer)
    : doc.documentElement;
  if (!host) throw new Error(`no layer group labelled "${intoLayer}"`);
  for (const child of [...fragment.documentElement.children]) host.appendChild(doc.importNode(child, true));
  return new XMLSerializer().serializeToString(doc);
}

{
  const edited = addToSvg(exportSvg(),
    `<path id="drawn" d="${TRIANGLE}" style="fill:#ff0000;stroke:#0000ff;stroke-width:2"/>`);
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  check('the new path is reported as an addition', plan.added.length === 1,
    JSON.stringify(plan.added.map(a => a.label)));
  check('…and named so the user can tell which it is',
    plan.added[0]?.label === '<path id="drawn">', plan.added[0]?.label);
  check('nothing is reported as deleted', plan.removed.length === 0);
  check('the summary reads as a summary', summarizeSvgEdits(plan) === '1 shape added', summarizeSvgEdits(plan));

  const applied = await applySvgEdits(source, plan);
  const after = await parseVsdx(applied.buffer);
  const shapes = allShapes(after.pages[0].shapes);
  check('the drawing gained exactly one shape',
    shapes.length === allShapes(page.shapes).length + 1, `${shapes.length}`);

  const added = shapes.find(shape => String(shape.id) === String(applied.addedIds[0]));
  check('the new shape exists under the id it was given', !!added, JSON.stringify(applied.addedIds));

  // The triangle spans one inch each way, one inch in from the top-left, and
  // Visio measures Y up from the bottom of the page.
  check('it is an inch wide', near(added.width, 1), String(added.width));
  check('it is an inch tall', near(added.height, 1), String(added.height));
  check('it sits where it was drawn, X', near(added.pinX, 1.5), String(added.pinX));
  check('it sits where it was drawn, Y', near(added.pinY, page.height - 1.5), `${added.pinY} vs ${page.height - 1.5}`);
  check('it kept the fill it was drawn with', String(added.fillForeground).toLowerCase() === '#ff0000',
    String(added.fillForeground));
  check('it kept the stroke it was drawn with', String(added.lineColor).toLowerCase() === '#0000ff',
    String(added.lineColor));
  // 2 user units is 2/96 inch; Visio wants a real length, and the pen writes
  // points, so this is 1.5pt.
  check('it kept the stroke width it was drawn with', near(added.lineWeight, 1.5 / 72, 1e-6),
    String(added.lineWeight));

  const rows = (added.geometry || []).flatMap(section => section.rows || []);
  check('it is a closed three-cornered outline',
    rows.filter(row => row.type === 'LineTo').length === 3 && rows[0].type === 'MoveTo',
    rows.map(r => r.type).join(','));
}

// ---------------------------------------------------------------------------
console.log('\nthe geometry survives a curve, not just corners');
{
  // A quarter circle drawn as a cubic: the control points are where Visio's
  // RelCubBezTo has to put them back.
  const edited = addToSvg(exportSvg(),
    '<path id="curve" d="M 96 96 C 96 149 139 192 192 192" fill="none" stroke="black"/>');
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  const applied = await applySvgEdits(source, plan);
  const after = await parseVsdx(applied.buffer);
  const added = allShapes(after.pages[0].shapes).find(s => String(s.id) === String(applied.addedIds[0]));
  const rows = (added.geometry || []).flatMap(section => section.rows || []);
  check('the curve came through as a real bezier row',
    rows.some(row => row.type === 'RelCubBezTo'), rows.map(r => r.type).join(','));
  check('with an unfilled outline', added.fillPattern === 0, String(added.fillPattern));

  const bez = rows.find(row => row.type === 'RelCubBezTo');
  // Fractions of Width/Height, Y measured up: the first handle is straight
  // above the start, the second straight left of the end.
  check('the first control point is where it was drawn',
    near(bez.a, 0, 1e-3) && near(bez.b, 1 - 53 / 96, 1e-2), `${bez.a},${bez.b}`);
  check('the second control point is where it was drawn',
    near(bez.c, 43 / 96, 1e-2) && near(bez.d, 0, 1e-3), `${bez.c},${bez.d}`);
}

// ---------------------------------------------------------------------------
console.log('\na shape drawn into an Inkscape layer lands on that Visio layer');
{
  const layer = (page.layers || [])[0];
  check('the fixture has a layer to draw into', !!layer, JSON.stringify(page.layers));
  const layerName = layer.name || layer.nameUniv;
  const edited = addToSvg(exportSvg(),
    `<g inkscape:groupmode="layer" inkscape:label="${layerName}" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">`
    + `<path id="in-layer" d="${TRIANGLE}" fill="#00ff00"/></g>`);
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  check('the addition knows which layer it was drawn on', plan.added[0]?.layer === layerName,
    String(plan.added[0]?.layer));

  const applied = await applySvgEdits(source, plan);
  const after = await parseVsdx(applied.buffer);
  const added = allShapes(after.pages[0].shapes).find(s => String(s.id) === String(applied.addedIds[0]));
  check('and the saved shape is on it',
    (added.layerMembers || []).map(String).includes(String(layer.index)),
    JSON.stringify(added.layerMembers));
}

// ---------------------------------------------------------------------------
console.log('\ntransforms on the way in are honoured');
{
  // The same triangle, but written at the origin and moved into place by the
  // group around it — which is exactly what Inkscape does when you drag.
  const edited = addToSvg(exportSvg(),
    '<g transform="translate(96,96)"><path id="moved" d="M 0 0 L 96 0 L 96 96 Z" fill="#123456"/></g>');
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  const applied = await applySvgEdits(source, plan);
  const after = await parseVsdx(applied.buffer);
  const added = allShapes(after.pages[0].shapes).find(s => String(s.id) === String(applied.addedIds[0]));
  check('the group transform moved the shape, X', near(added.pinX, 1.5), String(added.pinX));
  check('the group transform moved the shape, Y', near(added.pinY, page.height - 1.5), String(added.pinY));
  check('and the fill came from the element', String(added.fillForeground).toLowerCase() === '#123456',
    String(added.fillForeground));
}

// ---------------------------------------------------------------------------
console.log('\nadditions and deletions in the same file');
{
  let edited = deleteShapeFromSvg(exportSvg(), victimId);
  edited = addToSvg(edited, `<rect id="box" x="96" y="96" width="96" height="96" fill="#abcdef"/>`);
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  check('both are reported', plan.added.length === 1 && plan.removed.length === 1, summarizeSvgEdits(plan));
  check('the summary says both', summarizeSvgEdits(plan) === '1 shape added, 1 shape deleted',
    summarizeSvgEdits(plan));

  const applied = await applySvgEdits(source, plan);
  const after = await parseVsdx(applied.buffer);
  const ids = allShapes(after.pages[0].shapes).map(String_ => String(String_.id));
  check('the deleted shape is gone', !ids.includes(victimId));
  check('the added shape is there', ids.includes(String(applied.addedIds[0])));

  const added = allShapes(after.pages[0].shapes).find(s => String(s.id) === String(applied.addedIds[0]));
  check('a rect comes through as an inch square',
    near(added.width, 1) && near(added.height, 1), `${added.width}x${added.height}`);
}

// ---------------------------------------------------------------------------
console.log('\nwhat it refuses to guess at');
{
  // "Optimised SVG" and friends drop attributes they do not recognise. Without
  // the ids there is no way to tell a deletion from a rename of the file, and
  // the wrong answer deletes the whole drawing.
  const stripped = exportSvg().replace(/ data-shape-id="[^"]*"/g, '');
  const plan = readSvgEdits(stripped, drawing, { pageId: page.id });
  check('an SVG with its shape ids stripped is refused', !plan.ok, JSON.stringify(plan.removed));
  check('…and says why', /shape ids/.test(plan.reason || ''), plan.reason || '');
  check('…rather than reporting the whole drawing as deleted', plan.removed.length === 0);
}
{
  const edited = addToSvg(exportSvg(), '<text id="label" x="10" y="10">hello</text>');
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  check('added text is reported but not converted',
    plan.added.length === 0 && plan.skipped.length === 1, JSON.stringify(plan.skipped));
  check('…with a reason', /text is not converted/.test(plan.skipped[0]?.reason || ''),
    plan.skipped[0]?.reason);
}
{
  const edited = addToSvg(exportSvg(), '<path id="empty" d=""/>');
  const plan = readSvgEdits(edited, drawing, { pageId: page.id });
  check('a path that draws nothing is skipped, not imported',
    plan.added.length === 0 && plan.skipped.length === 1, JSON.stringify(plan.skipped));
}
{
  const plan = readSvgEdits('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>',
    drawing, { pageId: 'nope' });
  check('an SVG that is not this drawing is refused', !plan.ok, plan.reason || '');
}

// ---------------------------------------------------------------------------
console.log('\nthe pieces underneath');
{
  check('a translate is read', JSON.stringify(parseTransform('translate(3,4)')) === JSON.stringify([1, 0, 0, 1, 3, 4]));
  const rotated = parseTransform('rotate(90)');
  check('a rotate is read', near(rotated[0], 0, 1e-9) && near(rotated[1], 1, 1e-9), JSON.stringify(rotated));
  const composed = parseTransform('translate(10,0) scale(2)');
  check('transforms compose left to right',
    JSON.stringify(composed) === JSON.stringify([2, 0, 0, 2, 10, 0]), JSON.stringify(composed));

  check('hex colours pass through', normalizeCssColor('#AABBCC') === '#aabbcc');
  check('short hex expands', normalizeCssColor('#abc') === '#aabbcc');
  check('rgb() is read', normalizeCssColor('rgb(255, 0, 128)') === '#ff0080');
  check('named colours are read', normalizeCssColor('red') === '#ff0000');
  check('none is no paint at all', normalizeCssColor('none') === null);

  const doc = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg"><g fill="#00ff00" opacity="0.5">'
    + '<path style="stroke:#ff0000;stroke-width:4" opacity="0.5"/></g></svg>', 'image/svg+xml');
  const path = doc.querySelector('path');
  const style = resolveStyle(path, doc.documentElement);
  check('fill is inherited from the group', style.fill === '#00ff00', style.fill);
  check('stroke comes from the element', style.stroke === '#ff0000', style.stroke);
  check('opacity multiplies down the tree', near(style.opacity, 0.25), String(style.opacity));

  const pen = penStyleFromSvg(style, 1);
  check('a translucent shape becomes a transparency', near(pen.fillTrans, 0.75), String(pen.fillTrans));
  check('stroke width converts to points', near(pen.strokeWidthPt, (4 / 96) * 72), String(pen.strokeWidthPt));
  check('an element with no stroke gets no line',
    penStyleFromSvg({ fill: '#000000', stroke: 'none' }, 1).stroke === false);
}

console.log(`\nsvg import: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
