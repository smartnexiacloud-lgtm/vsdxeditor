// Module-level test for the pen tool's geometry: build a <Shape> from an
// Illustrator-style path (anchors + bezier handles), insert it into a real
// .vsdx with addVsdxShapeToPage, then re-parse and assert every point comes
// back at the page coordinate it was drawn at — and that the curve survives as
// a curve all the way into the rendered SVG.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

// src/ modules are ESM but the package is commonjs; copy into a tmp
// "type: module" dir (same trick as the other tests).
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-pen-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx, addVsdxShapeToPage } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { buildPenShapeXml, penBounds, penPathToSvgD } = await import(pathToFileURL(join(tmp, 'pen-geometry.js')));
const { renderPage } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const SOURCE = 'test-files/test9_rect_and_line.vsdx';

// A path with one straight run and one curve, drawn somewhere inside the page.
const NODES = [
  { x: 1.0, y: 1.0, cIn: null, cOut: null },
  { x: 2.0, y: 1.0, cIn: null, cOut: null },                                  // straight
  { x: 3.0, y: 2.5, cIn: { x: 2.25, y: 2.5 }, cOut: { x: 3.75, y: 2.5 } },    // curve in
  { x: 4.0, y: 1.25, cIn: null, cOut: null }                                  // curve out
];
const STYLE = {
  stroke: true, strokeColor: '#c81e1e', strokeWidthPt: 2.25, strokePattern: 2,
  fill: true, fillColor: '#3366cc', fillTrans: 0.25
};

console.log('pen geometry');

// --- bounding box ---------------------------------------------------------
const bounds = penBounds(NODES, false);
check('bounds cover the anchors', near(bounds.minX, 1) && near(bounds.maxX, 4) && near(bounds.minY, 1));
check('bounds cover the control handles', near(bounds.maxY, 2.5) && near(bounds.spanY, 1.5),
  `spanY=${bounds.spanY}`);

// --- emitted XML ----------------------------------------------------------
const xml = buildPenShapeXml(NODES, STYLE, { closed: false });
check('emits a MoveTo', /<Row T="MoveTo"/.test(xml));
check('straight run stays a LineTo', /<Row T="LineTo"/.test(xml));
check('curve becomes RelCubBezTo', (xml.match(/<Row T="RelCubBezTo"/g) || []).length === 2,
  `got ${(xml.match(/<Row T="RelCubBezTo"/g) || []).length}`);
check('stroke cells written', xml.includes('N="LineColor" V="#c81e1e"') && xml.includes('N="LinePattern" V="2"'));
check('stroke width converted to inches', xml.includes(`N="LineWeight" V="${(2.25 / 72).toFixed(10).replace(/0+$/, '')}"`),
  xml.match(/N="LineWeight" V="[^"]*"/)?.[0]);
check('fill cells written', xml.includes('N="FillForegnd" V="#3366cc"') && xml.includes('N="FillPattern" V="1"'));
check('fill transparency written', xml.includes('N="FillForegndTrans" V="0.25"'));
check('geometry section not marked NoFill', xml.includes('N="NoFill" V="0"'));

const noStroke = buildPenShapeXml(NODES, { ...STYLE, stroke: false }, {});
check('stroke off ⇒ LinePattern 0 + NoLine', noStroke.includes('N="LinePattern" V="0"') && noStroke.includes('N="NoLine" V="1"'));
const noFill = buildPenShapeXml(NODES, { ...STYLE, fill: false }, {});
check('fill off ⇒ FillPattern 0 + NoFill', noFill.includes('N="FillPattern" V="0"') && noFill.includes('N="NoFill" V="1"'));

// --- degenerate axis ------------------------------------------------------
// A perfectly horizontal path has zero height; every fraction times zero is a
// point, so the box has to be floored and the path centred in it.
const flat = buildPenShapeXml(
  [{ x: 1, y: 2, cIn: null, cOut: null }, { x: 3, y: 2, cIn: null, cOut: null }], {}, {});
check('flat path has no NaN cells', !/V="NaN"/.test(flat), flat.match(/V="NaN"[^>]*/)?.[0]);
const flatHeight = Number(flat.match(/N="Height" V="([^"]+)"/)?.[1]);
check('flat path gets a non-zero Height', flatHeight > 0, String(flatHeight));
check('flat path is centred on its Y', flat.includes('N="PinY" V="2"'));

// --- insert into a real package ------------------------------------------
const source = readFileSync(SOURCE);
const before = await parseVsdx(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
const page = before.pages.find(p => !p.isBackground) || before.pages[0];
const existingIds = new Set(page.shapes.map(s => String(s.id)));

const { buffer, shapeId } = await addVsdxShapeToPage(
  source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), page.id, xml);
check('insert returns a fresh shape id', !existingIds.has(String(shapeId)), `id=${shapeId}`);

const after = await parseVsdx(buffer);
const newPage = after.pages.find(p => String(p.id) === String(page.id));
check('page keeps its other shapes', newPage.shapes.length === page.shapes.length + 1,
  `${page.shapes.length} → ${newPage.shapes.length}`);

const shape = newPage.shapes.find(s => String(s.id) === String(shapeId));
check('new shape is on the page', Boolean(shape));

// --- round-trip: do the points land where they were drawn? ---------------
if (shape) {
  const geo = shape.geometry?.[0];
  const rows = geo?.rows || [];
  check('geometry re-parses with 4 rows', rows.length === 4, `got ${rows.length}`);
  check('re-parsed row types', rows.map(r => r.type).join(',') === 'MoveTo,LineTo,RelCubBezTo,RelCubBezTo',
    rows.map(r => r.type).join(','));

  // Shape-local (Y-up, inches) → page coordinates.
  const originX = shape.pinX - shape.locPinX;
  const originY = shape.pinY - shape.locPinY;
  const toPage = (row) => (row.type.startsWith('Rel')
    ? { x: originX + row.x * shape.width, y: originY + row.y * shape.height }
    : { x: originX + row.x, y: originY + row.y });

  let worst = 0;
  for (let i = 0; i < Math.min(rows.length, NODES.length); i++) {
    const point = toPage(rows[i]);
    worst = Math.max(worst, Math.abs(point.x - NODES[i].x), Math.abs(point.y - NODES[i].y));
  }
  check('anchors round-trip to their page coordinates', worst < 1e-6, `worst error ${worst}`);

  // The curve's control points too — cells A,B and C,D, same normalisation.
  const curve = rows[2];
  const cp1 = { x: originX + curve.a * shape.width, y: originY + curve.b * shape.height };
  const cp2 = { x: originX + curve.c * shape.width, y: originY + curve.d * shape.height };
  check('outgoing handle round-trips', near(cp1.x, NODES[1].x, 1e-6) && near(cp1.y, NODES[1].y, 1e-6),
    `${cp1.x},${cp1.y}`);
  check('incoming handle round-trips', near(cp2.x, NODES[2].cIn.x, 1e-6) && near(cp2.y, NODES[2].cIn.y, 1e-6),
    `${cp2.x},${cp2.y}`);

  check('stroke survives the round-trip', shape.lineColor === '#c81e1e' && Math.round(shape.linePattern) === 2,
    `${shape.lineColor} / ${shape.linePattern}`);
  check('stroke weight survives', near(shape.lineWeight, 2.25 / 72, 1e-9), String(shape.lineWeight));
  check('fill survives the round-trip', shape.fillForeground === '#3366cc' && Math.round(shape.fillPattern) === 1,
    `${shape.fillForeground} / ${shape.fillPattern}`);

  // --- and it still renders as a curve ---
  const container = dom.window.document.createElement('div');
  renderPage(newPage, container);
  const group = container.querySelector(`g[data-shape-id="${shapeId}"]`);
  const d = group?.querySelector('path')?.getAttribute('d') || '';
  check('renders with a cubic segment', /\bC\b/.test(d), d.slice(0, 120));
  check('renders with the drawn stroke colour',
    (group?.innerHTML || '').includes('#c81e1e'), (group?.innerHTML || '').slice(0, 160));
}

// --- only emit row types real Visio itself writes -------------------------
// schema.json is a structural dump of a real Visio-authored document (see
// inspect-schema.mjs): it records which Row/@T values that file actually
// contained. Emitting anything outside that set would mean inventing geometry
// Visio never produces, which is the one thing we cannot verify by round-
// tripping through our own parser. (Only @T is checked: the tool caps how many
// distinct @N values it samples, so its Cell list is not exhaustive.)
//
// That dump is taken from a private drawing and is kept out of the repo (see
// .gitignore), so this last check runs on a machine that has one and is skipped
// where there is none — CI, a fresh clone — rather than failing the run over a
// file nobody there could have.
if (!existsSync('schema.json')) {
  console.log('  skipped — schema.json is not in this checkout (run inspect-schema.mjs to make one)');
} else {
  const observed = new Set(JSON.parse(readFileSync('schema.json', 'utf8')).schema.elements.Row.attrs.T);
  check('schema records a real Visio corpus', observed.size > 5 && observed.has('NURBSTo'),
    [...observed].join(','));
  const emitted = new Set(
    [...xml.matchAll(/<Row T="([^"]+)"/g), ...flat.matchAll(/<Row T="([^"]+)"/g)].map(m => m[1]));
  const unknown = [...emitted].filter(type => !observed.has(type));
  check('every emitted row type occurs in real Visio output', unknown.length === 0,
    `unknown: ${unknown.join(',')} (emitted ${[...emitted].join(',')})`);
  check('the cubic we emit is one Visio writes itself', observed.has('RelCubBezTo'));
}

// --- preview path matches what gets committed ----------------------------
const previewD = penPathToSvgD(NODES, { dpi: 96, pageHeight: 11 });
check('preview draws the same command mix', (previewD.match(/C /g) || []).length === 2 && previewD.includes('L '),
  previewD);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
