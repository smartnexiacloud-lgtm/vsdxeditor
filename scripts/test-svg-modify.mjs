// Changing a shape in the exported SVG, and having the change come back.
//
// Additions and deletions only need the shape ids the renderer stamps on each
// group. A *modification* needs the inverse of the renderer: given that the
// third number of the second path moved, which Geometry section, which row and
// which cell of that row said where it was — and whether writing to that cell
// is safe. So these checks are about the things that go wrong when the inverse
// is nearly right: a point written into the wrong row, a shape's whole outline
// rewritten when it merely moved, a `Width*0.6` replaced by the number it
// happens to equal.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS', 'Element'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-svgmod-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx, addVsdxShapeToPage } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { renderPage } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));
const { embedVsdxInSvg } = await import(pathToFileURL(join(tmp, 'svg-vsdx-embed.js')));
const { buildPenShapeXml } = await import(pathToFileURL(join(tmp, 'pen-geometry.js')));
const { readSvgEdits, applySvgEdits, summarizeSvgEdits } = await import(pathToFileURL(join(tmp, 'svg-import.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const allShapes = (shapes, out = []) => {
  for (const shape of shapes || []) { out.push(shape); allShapes(shape.subShapes, out); }
  return out;
};

// ---------------------------------------------------------------------------
// A drawing with one pen-drawn path on it: a corner, a straight run and a
// curve, which is every row type a point can be dragged in.
const PEN_NODES = [
  { x: 1, y: 1, cIn: null, cOut: null },
  { x: 3, y: 1, cIn: null, cOut: null },
  { x: 4, y: 3, cIn: { x: 4, y: 2 }, cOut: null }
];

const base = toBuffer(readFileSync('test-files/test9_rect_and_line.vsdx'));
const drawn = await addVsdxShapeToPage(base, (await parseVsdx(base)).pages[0].id,
  buildPenShapeXml(PEN_NODES, { fill: false, stroke: true }, { closed: false }));
const source = drawn.buffer;
const drawing = await parseVsdx(source);
const page = drawing.pages[0];
const penShapeId = String(drawn.shapeId);
const penShape = allShapes(page.shapes).find(shape => String(shape.id) === penShapeId);
check('the fixture has a pen-drawn path to edit', !!penShape, penShapeId);
check('…whose straight rows are written as proportions of the shape, the way Visio writes them',
  (penShape.geometry || []).flatMap(s => s.rows).some(row => row.formulas?.X?.startsWith('Width*')),
  JSON.stringify((penShape.geometry || []).flatMap(s => s.rows).map(r => r.formulas)));
check('…and its curve is a real bezier row',
  (penShape.geometry || []).flatMap(s => s.rows).some(row => row.type === 'RelCubBezTo'));

function exportSvg() {
  const svg = renderPage(page, document.getElementById('stage'));
  return embedVsdxInSvg(new XMLSerializer().serializeToString(svg),
    new Uint8Array(source), 'modified.vsdx', { pageId: page.id });
}

const parse = (text) => new DOMParser().parseFromString(text, 'image/svg+xml');
const serialize = (doc) => new XMLSerializer().serializeToString(doc);
const groupOf = (doc, id) => doc.querySelector(`[data-shape-id="${id}"]`);
const pathsOf = (group) => [...group.children].filter(el => el.localName === 'path');
const numbersOf = (d) => (d.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(Number);

const rowsOf = (shape) => (shape.geometry || []).flatMap(section => section.rows || []);
async function applyAndReparse(plan) {
  const applied = await applySvgEdits(source, plan);
  const after = await parseVsdx(applied.buffer);
  return { applied, page: after.pages[0], shapes: allShapes(after.pages[0].shapes) };
}

// ---------------------------------------------------------------------------
console.log('\nan untouched export changes nothing');
{
  const plan = readSvgEdits(exportSvg(), drawing, { pageId: page.id });
  check('the comparison ran', plan.ok, plan.reason || '');
  check('no shape is reported as changed', plan.modified.length === 0,
    JSON.stringify(plan.modified.map(m => [m.label, m.kinds])));
  check('and nothing is reported as unreadable', plan.skipped.length === 0, JSON.stringify(plan.skipped));
}

// ---------------------------------------------------------------------------
console.log('\nmoving a shape by its transform');
{
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  // An inch to the right and an inch down the page.
  group.setAttribute('transform', `translate(96,96) ${group.getAttribute('transform') || ''}`);
  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });

  check('exactly one shape is reported as changed', plan.modified.length === 1,
    JSON.stringify(plan.modified.map(m => m.label)));
  check('…and it is reported as a move, not as a redrawn outline',
    plan.modified[0]?.kinds.join() === 'moved' && plan.modified[0].geometry.length === 0,
    JSON.stringify(plan.modified[0]?.kinds) + ' ' + (plan.modified[0]?.geometry.length));
  check('the summary counts it', summarizeSvgEdits(plan) === '1 shape changed', summarizeSvgEdits(plan));

  const { shapes } = await applyAndReparse(plan);
  const moved = shapes.find(shape => String(shape.id) === penShapeId);
  check('the shape moved an inch right', near(moved.pinX, penShape.pinX + 1), `${moved.pinX} vs ${penShape.pinX}`);
  check('…and an inch down the page', near(moved.pinY, penShape.pinY - 1), `${moved.pinY} vs ${penShape.pinY}`);
  check('its outline was left completely alone',
    JSON.stringify(rowsOf(moved).map(r => [r.x, r.y, r.a, r.b, r.c, r.d]))
    === JSON.stringify(rowsOf(penShape).map(r => [r.x, r.y, r.a, r.b, r.c, r.d])),
    JSON.stringify(rowsOf(moved).map(r => [r.x, r.y])));
}

// ---------------------------------------------------------------------------
console.log('\nmoving a shape by rewriting its path data');
{
  // This is what an SVG editor set to bake transforms into path data does —
  // which is the usual default, and would otherwise read as "every point of
  // this shape was dragged".
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  for (const path of pathsOf(group)) {
    let index = 0;
    path.setAttribute('d', path.getAttribute('d').replace(
      /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g,
      (n) => String(Number(n) + (index++ % 2 === 0 ? 48 : 24))));
  }
  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
  check('it is still recognised as a move', plan.modified[0]?.kinds.join() === 'moved',
    JSON.stringify(plan.modified[0]?.kinds));
  check('…rather than as every row being rewritten', plan.modified[0]?.geometry.length === 0,
    String(plan.modified[0]?.geometry.length));

  const { shapes } = await applyAndReparse(plan);
  const moved = shapes.find(shape => String(shape.id) === penShapeId);
  check('half an inch right', near(moved.pinX, penShape.pinX + 0.5), `${moved.pinX} vs ${penShape.pinX}`);
  check('a quarter inch down', near(moved.pinY, penShape.pinY - 0.25), `${moved.pinY} vs ${penShape.pinY}`);
  check('and its rows are untouched',
    JSON.stringify(rowsOf(moved).map(r => [r.x, r.y])) === JSON.stringify(rowsOf(penShape).map(r => [r.x, r.y])));
}

// ---------------------------------------------------------------------------
console.log('\ndragging a single point');
{
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  const path = pathsOf(group)[0];
  const before = numbersOf(path.getAttribute('d'));
  // The second point of the outline (the end of the straight run), a quarter
  // inch further right.
  const target = 2;
  const after = [...before];
  after[target] = before[target] + 24;
  let i = 0;
  path.setAttribute('d', path.getAttribute('d')
    .replace(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g, () => String(after[i++])));

  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
  check('the shape is reported as changed', plan.modified.length === 1,
    JSON.stringify(plan.skipped));
  check('…as a moved point rather than a moved shape',
    /point/.test(plan.modified[0]?.kinds.join() || ''), JSON.stringify(plan.modified[0]?.kinds));
  check('…and exactly one row is touched', plan.modified[0]?.geometry.length === 1,
    JSON.stringify(plan.modified[0]?.geometry));

  const edit = plan.modified[0].geometry[0];
  check('the row it touches is the one that drew that point',
    String(edit.rowIx) === '2' && edit.rowType === 'LineTo', JSON.stringify(edit));
  check('only the coordinate that moved is written',
    Object.keys(edit.cells).join() === 'X', Object.keys(edit.cells).join());
  check('the coordinate that Visio wrote as a proportion stays a proportion',
    /^Width\*/.test(edit.cells.X.formula || ''), JSON.stringify(edit.cells.X));

  const { shapes } = await applyAndReparse(plan);
  const changed = shapes.find(shape => String(shape.id) === penShapeId);
  const row = rowsOf(changed).find(r => String(r.ix) === '2');
  const wasRow = rowsOf(penShape).find(r => String(r.ix) === '2');
  check('the point moved a quarter of an inch', near(row.x, wasRow.x + 0.25), `${row.x} vs ${wasRow.x}`);
  check('…and only along the axis it was dragged on', near(row.y, wasRow.y), `${row.y} vs ${wasRow.y}`);
  check('every other row is exactly as it was',
    JSON.stringify(rowsOf(changed).filter(r => String(r.ix) !== '2').map(r => [r.ix, r.x, r.y]))
    === JSON.stringify(rowsOf(penShape).filter(r => String(r.ix) !== '2').map(r => [r.ix, r.x, r.y])));
  check('the shape did not move as a whole',
    near(changed.pinX, penShape.pinX) && near(changed.pinY, penShape.pinY));
  // A proportion that was rewritten has to still evaluate to the value beside it.
  const cellFormula = row.formulas?.X;
  check('the rewritten formula agrees with the value it sits next to',
    !!cellFormula && near(parseFloat(cellFormula.split('*')[1]) * changed.width, row.x, 1e-6),
    `${cellFormula} vs ${row.x} (width ${changed.width})`);
}

// ---------------------------------------------------------------------------
console.log('\ndragging a point down the page');
{
  // Worth its own check because of the flip: SVG measures Y down from the top
  // of the shape and Visio measures it up from the bottom, so dragging a point
  // *down* has to make its Y cell *smaller*. Getting that backwards still moves
  // the point, just the wrong way, and only a signed check notices.
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  const path = pathsOf(group)[0];
  const before = numbersOf(path.getAttribute('d'));
  const target = 3;                       // the Y of the straight run's end
  const after = [...before];
  after[target] = before[target] + 48;    // half an inch down the page
  let i = 0;
  path.setAttribute('d', path.getAttribute('d')
    .replace(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g, () => String(after[i++])));

  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
  const edit = plan.modified[0]?.geometry[0];
  check('the vertical drag lands on the Y cell', Object.keys(edit?.cells || {}).join() === 'Y',
    JSON.stringify(edit));

  const { shapes } = await applyAndReparse(plan);
  const changed = shapes.find(shape => String(shape.id) === penShapeId);
  const row = rowsOf(changed).find(r => String(r.ix) === '2');
  const wasRow = rowsOf(penShape).find(r => String(r.ix) === '2');
  check('dragging down half an inch lowers the Visio coordinate by half an inch',
    near(row.y, wasRow.y - 0.5), `${row.y} vs ${wasRow.y}`);
  check('…and the height it is a proportion of is the one that was used',
    !row.formulas?.Y || near(parseFloat(row.formulas.Y.split('*')[1]) * changed.height, row.y, 1e-6),
    `${row.formulas?.Y} vs ${row.y} (height ${changed.height})`);
}

// ---------------------------------------------------------------------------
console.log('\ndragging a bezier handle');
{
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  const path = pathsOf(group)[0];
  const before = numbersOf(path.getAttribute('d'));
  // The curve is the last command: C cp1x cp1y cp2x cp2y ex ey. Pull the
  // second control point up.
  const target = before.length - 3;
  const after = [...before];
  after[target] = before[target] - 48;
  let i = 0;
  path.setAttribute('d', path.getAttribute('d')
    .replace(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g, () => String(after[i++])));

  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
  check('the handle move is reported', plan.modified.length === 1, JSON.stringify(plan.skipped));
  const edit = plan.modified[0].geometry[0];
  check('it lands on the bezier row', edit.rowType === 'RelCubBezTo', JSON.stringify(edit));
  check('and on the cell that holds that control point',
    Object.keys(edit.cells).join() === 'D', Object.keys(edit.cells).join());

  const { shapes } = await applyAndReparse(plan);
  const changed = shapes.find(shape => String(shape.id) === penShapeId);
  const bez = rowsOf(changed).find(r => r.type === 'RelCubBezTo');
  const wasBez = rowsOf(penShape).find(r => r.type === 'RelCubBezTo');
  // Half an inch up, as a fraction of the shape's height.
  check('the control point moved half an inch up',
    near(bez.d, wasBez.d + 0.5 / changed.height, 1e-4), `${bez.d} vs ${wasBez.d}, height ${changed.height}`);
  check('the curve\'s endpoint stayed put', near(bez.x, wasBez.x) && near(bez.y, wasBez.y));
}

// ---------------------------------------------------------------------------
console.log('\nwhat it refuses to read back');
{
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  const path = pathsOf(group)[0];
  path.setAttribute('d', path.getAttribute('d') + ' L 500 500');
  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
  check('a point added to an outline is not guessed at', plan.modified.length === 0,
    JSON.stringify(plan.modified));
  check('…and it says why', /added to or removed from/.test(plan.skipped.map(s => s.reason).join(' ')),
    JSON.stringify(plan.skipped));
}
{
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  group.setAttribute('transform', `${group.getAttribute('transform') || ''} scale(2)`);
  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
  check('a shape scaled in the SVG is refused', !plan.modified.some(m => m.kinds.includes('moved')),
    JSON.stringify(plan.modified));
  check('…because Visio has no scale to write it to',
    /scaled or skewed/.test(plan.skipped.map(s => s.reason).join(' ')), JSON.stringify(plan.skipped));
}
{
  const doc = parse(exportSvg());
  const group = groupOf(doc, penShapeId);
  pathsOf(group)[0].remove();
  const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
  check('a path deleted from inside a shape is reported, not applied', plan.modified.length === 0);
  check('…with a reason', /went from \d+ path/.test(plan.skipped.map(s => s.reason).join(' ')),
    JSON.stringify(plan.skipped));
}

// ---------------------------------------------------------------------------
console.log('\nthe drawing\'s own shapes, not just the pen\'s');
{
  // The fixture's shapes come from a master, so their rows are inherited: the
  // shape has no Geometry element of its own until one is written. That is the
  // case an override exists for, and the one most likely to be got wrong.
  const other = page.shapes.find(shape => String(shape.id) !== penShapeId
    && (shape.geometry || []).some(section => (section.rows || []).length > 1));
  check('the fixture has a second shape with an outline', !!other,
    JSON.stringify(page.shapes.map(s => [s.id, (s.geometry || []).length])));

  if (other) {
    const doc = parse(exportSvg());
    const group = groupOf(doc, String(other.id));
    const path = pathsOf(group)[0];
    const before = numbersOf(path.getAttribute('d'));
    const after = [...before];
    after[0] = before[0] + 12;
    let i = 0;
    path.setAttribute('d', path.getAttribute('d')
      .replace(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g, () => String(after[i++])));

    const plan = readSvgEdits(serialize(doc), drawing, { pageId: page.id });
    const entry = plan.modified.find(m => String(m.id) === String(other.id));
    if (!entry) {
      // Perfectly legitimate — the row may be an arc or formula-driven — but
      // then it has to say so rather than going quiet.
      check('an outline it will not edit says why',
        plan.skipped.some(s => s.label.includes(other.name || other.nameU || `Shape ${other.id}`)),
        JSON.stringify(plan.skipped));
    } else {
      const { shapes } = await applyAndReparse(plan);
      const changed = shapes.find(shape => String(shape.id) === String(other.id));
      const edit = entry.geometry[0];
      const row = rowsOf(changed).find(r => String(r.ix) === String(edit.rowIx));
      const wasRow = rowsOf(other).find(r => String(r.ix) === String(edit.rowIx));
      // A Rel* row's X is a fraction of the shape's Width, not a length, so an
      // eighth of an inch on the page is an eighth of an inch's worth of it.
      const moved = edit.rowType.startsWith('Rel') ? 0.125 / changed.width : 0.125;
      check(`the point moved an eighth of an inch (${edit.rowType})`,
        near(row.x, wasRow.x + moved), `${row.x} vs ${wasRow.x} + ${moved}`);
      check('the rest of the row still says what the master says',
        near(row.y, wasRow.y), `${row.y} vs ${wasRow.y}`);
      check('and the shape kept every other row', rowsOf(changed).length === rowsOf(other).length,
        `${rowsOf(changed).length} vs ${rowsOf(other).length}`);
    }
  }
}

console.log(`\nsvg modify: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
