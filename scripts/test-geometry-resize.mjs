// Making a shape bigger has to make its outline bigger.
//
// Half of a Visio outline resizes by itself and half of it does not. `Rel…` rows
// hold fractions of Width and Height, so they follow the box for nothing; plain
// rows hold inches and follow nothing at all, and the shapes in this repo's
// fixtures are almost entirely the first kind — which is how a shape whose
// picture never changed size survived 1500 passing checks.
//
// src/geometry-resize.js is the arithmetic that closes that gap: what each row
// type's cells become when the box is scaled. Some of it is a multiplication,
// some of it is not (an arc's bulge is measured at right angles to its chord,
// and an uneven scale is not a right angle any more), so it is checked here
// against geometry worked out independently rather than against itself.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-geomresize-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx, transformVsdxShapes, groupVsdxShapes } =
  await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { planResizeShape, planGroupShapes } = await import(pathToFileURL(join(tmp, 'shape-arrange.js')));
const { planGeometryScale, applyGeometryScale } =
  await import(pathToFileURL(join(tmp, 'geometry-resize.js')));
const { geometryToPath } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const loadPage = async (buffer, pageId = null) => {
  const parsed = await parseVsdx(buffer);
  return pageId === null
    ? (parsed.pages.find(p => !p.isBackground) || parsed.pages[0])
    : parsed.pages.find(p => String(p.id) === String(pageId));
};
const findShape = (shapes, id) => {
  for (const shape of shapes || []) {
    if (String(shape.id) === String(id)) return shape;
    const hit = findShape(shape.subShapes, id);
    if (hit) return hit;
  }
  return null;
};
const descendantsOf = (shape) =>
  (shape.subShapes || []).flatMap(child => [String(child.id), ...descendantsOf(child)]);

// A shape made of nothing but the rows under test, so what comes out is about
// the arithmetic and not about whatever a fixture happened to contain.
const shapeOf = (rows, width = 4, height = 2) => ({
  width, height,
  geometry: [{ ix: '0', source: 'shape', rows: rows.map((row, i) => ({ ix: String(i + 1), del: false, x: null, y: null, formulas: {}, ...row })) }]
});
const cellsOf = (plan, rowIx) => plan.find(u => u.rowIx === String(rowIx))?.cells || {};
const valueOf = (plan, rowIx, cell) => cellsOf(plan, rowIx)[cell]?.value;

// ---------------------------------------------------------------------------
console.log('\nwhat scales and what does not');

{
  const rel = shapeOf([
    { type: 'RelMoveTo', x: 0, y: 0 },
    { type: 'RelLineTo', x: 1, y: 1 },
    { type: 'RelCubBezTo', x: 1, y: 1, a: 0.2, b: 0.3, c: 0.4, d: 0.5 },
    { type: 'RelQuadBezTo', x: 1, y: 0, a: 0.5, b: 0.5 },
    { type: 'RelEllipticalArcTo', x: 1, y: 1, a: 0.5, b: 0.5, c: 0, d: 1 }
  ]);
  check('a shape drawn in fractions of its box has nothing to change',
    planGeometryScale(rel, 3, 5).length === 0, JSON.stringify(planGeometryScale(rel, 3, 5)));

  const plain = shapeOf([{ type: 'MoveTo', x: 1, y: 0.5 }, { type: 'LineTo', x: 3, y: 1.5 }]);
  check('a scale of exactly one changes nothing', planGeometryScale(plain, 1, 1).length === 0);

  const plan = planGeometryScale(plain, 2, 3);
  check('a point held in inches moves with the box',
    near(valueOf(plan, 1, 'X'), 2) && near(valueOf(plan, 1, 'Y'), 1.5)
    && near(valueOf(plan, 2, 'X'), 6) && near(valueOf(plan, 2, 'Y'), 4.5),
    JSON.stringify(plan));
}

{
  // Visio measures Y up from the bottom of the shape, so scaling about the
  // origin is what "the top edge stays at the top" means: a point at y = height
  // lands on the new height, and one at y = 0 does not move.
  const plan = planGeometryScale(shapeOf([
    { type: 'MoveTo', x: 0, y: 0 }, { type: 'LineTo', x: 4, y: 2 }
  ]), 2.5, 2.5);
  check('the corner at the origin stays put', near(valueOf(plan, 1, 'X'), 0) && near(valueOf(plan, 1, 'Y'), 0));
  check('and the far corner lands on the new box', near(valueOf(plan, 2, 'X'), 10) && near(valueOf(plan, 2, 'Y'), 5));
}

// ---------------------------------------------------------------------------
console.log('\nan arc\'s bulge');

{
  // A is the sagitta: the distance from the middle of the chord to the arc,
  // measured at right angles to the chord. Under an even scale it is a length
  // like any other.
  const arc = shapeOf([{ type: 'MoveTo', x: 0, y: 0 }, { type: 'ArcTo', x: 2, y: 0, a: 0.5 }]);
  check('an even scale multiplies the bulge like any other length',
    near(valueOf(planGeometryScale(arc, 3, 3), 2, 'A'), 1.5),
    String(valueOf(planGeometryScale(arc, 3, 3), 2, 'A')));

  // A chord along X with the bulge along Y: stretching Y stretches the bulge,
  // stretching X leaves it alone. This one can be read straight off the picture.
  check('stretching across the chord stretches the bulge',
    near(valueOf(planGeometryScale(arc, 1, 4), 2, 'A'), 2),
    String(valueOf(planGeometryScale(arc, 1, 4), 2, 'A')));
  check('and stretching along the chord does not',
    near(valueOf(planGeometryScale(arc, 4, 1), 2, 'A'), 0.5),
    String(valueOf(planGeometryScale(arc, 4, 1), 2, 'A')));

  // A chord at 45°, checked against the sagitta worked out by hand: scale the
  // vector the old sagitta was, then take the part of it still at right angles
  // to the chord the scale left behind.
  const diagonal = shapeOf([{ type: 'MoveTo', x: 0, y: 0 }, { type: 'ArcTo', x: 1, y: 1, a: 0.25 }]);
  const sx = 3, sy = 1.5;
  const chord = { x: 1, y: 1 };
  const len = Math.hypot(chord.x, chord.y);
  const sag = { x: -chord.y / len * 0.25 * sx, y: chord.x / len * 0.25 * sy };
  const scaledChord = { x: chord.x * sx, y: chord.y * sy };
  const scaledLen = Math.hypot(scaledChord.x, scaledChord.y);
  const wanted = (sag.x * -scaledChord.y + sag.y * scaledChord.x) / scaledLen;
  check('a chord across the corner keeps the bulge it can still have',
    near(valueOf(planGeometryScale(diagonal, sx, sy), 2, 'A'), wanted, 1e-8),
    `${valueOf(planGeometryScale(diagonal, sx, sy), 2, 'A')} vs ${wanted}`);

  const straight = shapeOf([{ type: 'MoveTo', x: 0, y: 0 }, { type: 'ArcTo', x: 2, y: 0, a: 0 }]);
  check('an arc with no bulge is a line and stays one',
    cellsOf(planGeometryScale(straight, 2, 2), 2).A === undefined);
}

// ---------------------------------------------------------------------------
console.log('\nan elliptical arc\'s axes');

{
  // C is where the ellipse's major axis points and D is how much longer it is
  // than the minor one. An even scale changes neither; an uneven one turns one
  // ellipse into a different ellipse.
  const arc = shapeOf([
    { type: 'MoveTo', x: 0, y: 0 },
    { type: 'EllipticalArcTo', x: 2, y: 0, a: 1, b: 1, c: 0, d: 1 }
  ]);
  const even = cellsOf(planGeometryScale(arc, 2, 2), 2);
  check('an even scale leaves the ellipse the shape it was',
    even.C === undefined && even.D === undefined, JSON.stringify(even));
  check('…while the point it passes through moves',
    near(even.A.value, 2) && near(even.B.value, 2), JSON.stringify(even));

  const wide = cellsOf(planGeometryScale(arc, 4, 1), 2);
  check('a circle pulled sideways becomes an ellipse four times as wide',
    near(wide.D.value, 4, 1e-9) && near(wide.C.value, 0, 1e-9),
    `angle ${wide.C?.value} ratio ${wide.D?.value}`);

  const upright = shapeOf([
    { type: 'MoveTo', x: 0, y: 0 },
    { type: 'EllipticalArcTo', x: 2, y: 0, a: 1, b: 1, c: Math.PI / 2, d: 3 }
  ]);
  // Its major axis is vertical, so pulling it up makes it longer still and
  // pulling it sideways evens it out. Both leave it standing on end.
  const taller = cellsOf(planGeometryScale(upright, 1, 2), 2);
  check('an ellipse standing on end and pulled upward gets longer, not rounder',
    near(taller.D.value, 6, 1e-9), String(taller.D?.value));
  const rounder = cellsOf(planGeometryScale(upright, 2, 1), 2);
  check('…and pulled sideways it gets rounder',
    near(rounder.D.value, 1.5, 1e-9), String(rounder.D?.value));
  check('either way it goes on pointing the way it pointed',
    near(Math.abs(taller.C.value), Math.PI / 2, 1e-9)
    && near(Math.abs(rounder.C.value), Math.PI / 2, 1e-9),
    `${taller.C?.value} ${rounder.C?.value}`);
}

// ---------------------------------------------------------------------------
console.log('\nthe rows that are nothing but points');

{
  const ellipse = shapeOf([{ type: 'Ellipse', x: 2, y: 1, a: 4, b: 1, c: 2, d: 2 }]);
  const cells = cellsOf(planGeometryScale(ellipse, 3, 5), 1);
  check('an Ellipse is a centre and a point on each axis, and all of it scales',
    near(cells.X.value, 6) && near(cells.Y.value, 5)
    && near(cells.A.value, 12) && near(cells.B.value, 5)
    && near(cells.C.value, 6) && near(cells.D.value, 10), JSON.stringify(cells));

  const line = shapeOf([{ type: 'InfiniteLine', x: 3, y: 1, a: 1, b: 0.5 }]);
  const lineCells = cellsOf(planGeometryScale(line, 2, 4), 1);
  check('an InfiniteLine is two points and scales as two points',
    near(lineCells.X.value, 6) && near(lineCells.Y.value, 4)
    && near(lineCells.A.value, 2) && near(lineCells.B.value, 2), JSON.stringify(lineCells));

  // A spline's A, B, C and D are knots and a degree — positions along the curve
  // and not on it. Only the control point is a place.
  const spline = shapeOf([
    { type: 'SplineStart', x: 1, y: 1, a: 0.25, b: 0, c: 1, d: 3 },
    { type: 'SplineKnot', x: 2, y: 1.5, a: 0.5 }
  ]);
  const start = cellsOf(planGeometryScale(spline, 2, 2), 1);
  const knot = cellsOf(planGeometryScale(spline, 2, 2), 2);
  check('a spline\'s control points move and its knots do not',
    near(start.X.value, 2) && near(start.Y.value, 2)
    && start.A === undefined && start.D === undefined
    && near(knot.X.value, 4) && near(knot.Y.value, 3) && knot.A === undefined,
    `${JSON.stringify(start)} ${JSON.stringify(knot)}`);
}

// ---------------------------------------------------------------------------
console.log('\ncontrol points written into a formula');

{
  // A NURBSTo keeps its control points inside the E cell rather than in cells of
  // its own, and the two numbers after the degree say what the coordinates mean:
  // 0 is already a fraction of the box, anything else is inches.
  const relative = shapeOf([{ type: 'NURBSTo', x: 1, y: 1,
    e: 'NURBS(1, 3, 0, 0, 0.25,0.5,0,1, 0.75,0.5,0,1)' }]);
  check('control points already held as fractions are left alone',
    cellsOf(planGeometryScale(relative, 2, 3), 1).E === undefined,
    JSON.stringify(cellsOf(planGeometryScale(relative, 2, 3), 1)));

  const absolute = shapeOf([{ type: 'NURBSTo', x: 1, y: 1,
    e: 'NURBS(1, 3, 1, 1, 0.25,0.5,0,1, 0.75,0.5,0,1)' }]);
  const nurbs = cellsOf(planGeometryScale(absolute, 2, 3), 1);
  check('control points held in inches are scaled inside the formula',
    nurbs.E.value === 'NURBS(1, 3, 1, 1, 0.5,1.5,0,1, 1.5,1.5,0,1)', String(nurbs.E?.value));
  check('…and the endpoint scales with them',
    near(nurbs.X.value, 2) && near(nurbs.Y.value, 3), JSON.stringify(nurbs));

  const poly = shapeOf([{ type: 'PolylineTo', x: 2, y: 1, a: 'POLYLINE(1,1,0.5,0.5,1,0.75)' }]);
  check('a POLYLINE\'s points scale the same way',
    cellsOf(planGeometryScale(poly, 2, 4), 1).A.value === 'POLYLINE(1,1,1,2,2,3)',
    String(cellsOf(planGeometryScale(poly, 2, 4), 1).A?.value));

  const junk = shapeOf([{ type: 'NURBSTo', x: 1, y: 1, e: 'NURBS(nonsense)' }]);
  check('a formula that cannot be read is left exactly as it was',
    cellsOf(planGeometryScale(junk, 2, 2), 1).E === undefined);
}

// ---------------------------------------------------------------------------
console.log('\nwhat happens to a formula');

{
  // A coordinate reading `Width*0.5` is not a number someone typed, it is a
  // proportion Visio re-evaluates. Scaling it must not turn it into a number, or
  // the shape quietly stops being resizable by anything but this editor.
  const rows = shapeOf([
    { type: 'MoveTo', x: 2, y: 1, formulas: { X: 'Width*0.5', Y: 'Height*0.5' } },
    { type: 'LineTo', x: 4, y: 2 }
  ]);
  const plan = planGeometryScale(rows, 3, 3);
  check('a proportion goes on being a proportion',
    cellsOf(plan, 1).X.formula === 'Width*0.5' && cellsOf(plan, 1).Y.formula === 'Height*0.5',
    JSON.stringify(cellsOf(plan, 1)));
  check('…with the number beside it brought up to date',
    near(cellsOf(plan, 1).X.value, 6) && near(cellsOf(plan, 1).Y.value, 3));
  check('and a plain number stays a plain number, with no formula invented for it',
    cellsOf(plan, 2).X.formula === null && cellsOf(plan, 2).Y.formula === null,
    JSON.stringify(cellsOf(plan, 2)));

  // `Width*k` is the case the scaling is exact for: Width*k against a Width that
  // has been multiplied by sx is the old value multiplied by sx, precisely.
  check('a proportion scales to exactly what Visio would work out for it',
    near(cellsOf(plan, 1).X.value, rows.width * 3 * 0.5, 1e-12));
}

// ---------------------------------------------------------------------------
console.log('\nputting the answer back on the shape');

{
  const shape = shapeOf([
    { type: 'MoveTo', x: 0, y: 0 },
    { type: 'LineTo', x: 4, y: 2 },
    { type: 'ArcTo', x: 0, y: 2, a: 0.5 }
  ]);
  const before = geometryToPath(shape.geometry[0].rows, shape.width, shape.height);
  const plan = planGeometryScale(shape, 2, 2);
  applyGeometryScale(shape, plan);
  shape.width *= 2;
  shape.height *= 2;
  const after = geometryToPath(shape.geometry[0].rows, shape.width, shape.height);
  check('the rows the renderer draws from carry the new numbers',
    near(shape.geometry[0].rows[1].x, 8) && near(shape.geometry[0].rows[1].y, 4)
    && near(shape.geometry[0].rows[2].a, 1),
    JSON.stringify(shape.geometry[0].rows.map(r => [r.x, r.y, r.a])));

  const extent = (d) => {
    const xs = [], ys = [];
    for (const [, x, y] of d.matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) { xs.push(+x); ys.push(+y); }
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const was = extent(before), now = extent(after);
  check('so the path it produces is drawn twice the size',
    near(now.w / was.w, 2, 1e-6) && near(now.h / was.h, 2, 1e-6),
    `${JSON.stringify(was)} → ${JSON.stringify(now)}`);

  check('a plan for rows that are not there changes nothing',
    (() => {
      const other = shapeOf([{ type: 'MoveTo', x: 1, y: 1 }]);
      applyGeometryScale(other, [{ sectionIx: '9', rowIx: '9', rowType: 'MoveTo', cells: { X: { value: 99 } } }]);
      return other.geometry[0].rows[0].x === 1;
    })());
}

// ---------------------------------------------------------------------------
console.log('\na real resize, and a real file');

{
  const original = toBuffer(readFileSync('test-files/test3_house.vsdx'));
  const page = await loadPage(original);
  const flat = (page.shapes || []).find(shape => !(shape.subShapes || []).length);
  const grow = planResizeShape(page, String(flat.id), 'se',
    flat.pinX + flat.width, flat.pinY - flat.height);
  check('a resize plan carries the geometry along with the cells',
    Array.isArray(grow.geometry), typeof grow.geometry);
  check('and asks for nothing on a shape drawn in fractions of its box',
    grow.geometry.length === 0, JSON.stringify(grow.geometry));

  // A group's contents are placed in the group's own inches, and nothing about
  // the group's box being bigger reaches them by itself — every generation has
  // to be scaled by hand, not just the children.
  const outer = (page.shapes || []).find(shape => (shape.subShapes || []).length);
  const nestedPlan = planGroupShapes(page, [String(outer.id), String(flat.id)]);
  const { buffer: nestedBytes, shapeId: nestedId } =
    await groupVsdxShapes(original, page.id, nestedPlan);
  const nestedPage = await loadPage(nestedBytes, page.id);
  const nested = findShape(nestedPage.shapes, nestedId);
  const wanted = descendantsOf(nested);
  check('the fixture really does nest a group inside a group',
    wanted.length > (nested.subShapes || []).length,
    `${wanted.length} descendants of ${(nested.subShapes || []).length} children`);
  const groupPlan = planResizeShape(nestedPage, String(nestedId), 'se',
    nested.pinX + nested.width, nested.pinY - nested.height);
  check('resizing a group reaches every shape inside it, not only the first layer',
    groupPlan.children.map(child => child.id).sort().join(',') === wanted.sort().join(','),
    groupPlan.children.map(child => child.id).join(','));
}

{
  // The writer half: a geometry row that came out of a resize has to land in the
  // package, on the shape rather than on its master, without disturbing the
  // cells the shape is still inheriting.
  const original = toBuffer(readFileSync('test-files/test9_rect_and_line.vsdx'));
  const page = await loadPage(original);
  const line = findShape(page.shapes, 3);
  const row = line.geometry[0].rows[1];
  check('the fixture has an outline held in inches to write to',
    row.type === 'LineTo' && row.x > 0, `${row?.type} ${row?.x}`);

  const { buffer } = await transformVsdxShapes(original, page.id, [{
    id: '3',
    cells: { width: line.width * 2, height: line.height * 2 },
    geometry: [{
      sectionIx: line.geometry[0].ix, rowIx: row.ix, rowType: row.type,
      cells: { X: { value: row.x * 2, formula: null }, Y: { value: row.y * 2, formula: 'Height*1' } }
    }]
  }]);
  const written = findShape((await loadPage(buffer, page.id)).shapes, 3);
  const back = written.geometry[0].rows[1];
  check('the file comes back with the point where the resize put it',
    near(back.x, row.x * 2, 1e-6) && near(back.y, row.y * 2, 1e-6),
    `${back.x},${back.y} vs ${row.x * 2},${row.y * 2}`);
  check('a cell given a formula keeps it, so Visio goes on working the value out',
    back.formulas?.Y === 'Height*1', JSON.stringify(back.formulas));
  check('and a cell given none carries none',
    back.formulas?.X === undefined, JSON.stringify(back.formulas));
  check('the shape is the one that changed, and it is twice the size',
    near(written.width, line.width * 2, 1e-6), `${written.width} vs ${line.width * 2}`);
}

console.log(`\ngeometry-resize: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
