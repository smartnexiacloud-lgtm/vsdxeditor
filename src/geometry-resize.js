// Making a shape bigger has to make its *outline* bigger.
//
// A Visio geometry row stores its coordinates one of two ways. The `Rel…` rows
// (RelMoveTo, RelLineTo, RelCubBezTo…) hold fractions of Width and Height, so
// they follow the box for free — change Width and the picture changes with it.
// The plain rows (MoveTo, LineTo, ArcTo, NURBSTo…) hold inches, and inches do
// not follow anything.
//
// In a real Visio file those inch cells usually carry a formula — `Width*0.5` —
// and Visio re-evaluates it whenever Width changes. We do not evaluate formulas;
// the parser reads the cached `V` the formula last produced. So a resize used to
// move the handles, move the pin, write a new Width… and redraw the same
// outline at the same size, which is the shape not resizing at all.
//
// This module supplies the missing evaluation, by the only rule available
// without a formula engine: the outline scales with the box. For the overwhelmingly
// common `Width*k` cell that is exactly what Visio would have computed. For
// anything more elaborate it is an approximation — and only of the cached value,
// because the formula is written straight back out untouched, so Visio still
// recomputes the exact answer when it opens the file. The cache being close
// rather than exact matters to this editor's own next read of the file and to
// nothing else.
//
// Cells that are not coordinates are left alone: a spline knot is a parameter,
// a NURBS weight is a weight, and neither is a length.

import { shapeCellNumber } from './vsdx-parser.js';

// Rows that already hold fractions of the box. Nothing to do for these — which
// is why a drawing built entirely out of them resized correctly all along.
const RELATIVE_ROWS = new Set([
  'RelMoveTo', 'RelLineTo', 'RelCubBezTo', 'RelQuadBezTo', 'RelEllipticalArcTo'
]);

// Which cell of a Row holds which field of the parsed row, so a plan made of
// Visio cell names can be applied to the model the renderer draws from.
const ROW_FIELD = { X: 'x', Y: 'y', A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' };

const isNum = (value) => Number.isFinite(value);

/**
 * A Visio geometry formula that lists points inline: `NURBS(…)` and
 * `POLYLINE(…)`. Both start with a pair of type flags — 0 meaning "a fraction of
 * Width/Height", anything else meaning inches — and only the inch ones scale.
 *
 * `layout` says where the flags are and how wide a point is: NURBS spends four
 * numbers per control point (x, y, knot, weight) after a leading knot and
 * degree; POLYLINE spends two and leads with nothing.
 */
const POINT_FORMULAS = [
  { name: 'NURBS', flagAt: 2, firstPoint: 4, stride: 4 },
  { name: 'POLYLINE', flagAt: 0, firstPoint: 2, stride: 2 }
];

function scalePointFormula(text, sx, sy) {
  if (typeof text !== 'string') return null;
  for (const { name, flagAt, firstPoint, stride } of POINT_FORMULAS) {
    const match = new RegExp(`^(\\s*${name}\\s*\\()([^)]*)(\\).*)$`, 'i').exec(text);
    if (!match) continue;
    const parts = match[2].split(',');
    const values = parts.map(part => Number.parseFloat(part));
    if (values.some(value => Number.isNaN(value)) || values.length < firstPoint + stride) return null;
    // A flag of 0 is "already a fraction of the box", so that axis holds still.
    const fx = values[flagAt] === 0 ? 1 : sx;
    const fy = values[flagAt + 1] === 0 ? 1 : sy;
    if (fx === 1 && fy === 1) return null;
    // The spacing each number arrived with is kept, so a formula Visio wrote
    // with spaces comes back looking the way Visio writes it.
    const rewrite = (part, value) =>
      `${/^\s*/.exec(part)[0]}${shapeCellNumber(value)}${/\s*$/.exec(part)[0]}`;
    for (let i = firstPoint; i + 1 < values.length; i += stride) {
      parts[i] = rewrite(parts[i], values[i] * fx);
      parts[i + 1] = rewrite(parts[i + 1], values[i + 1] * fy);
    }
    return `${match[1]}${parts.join(',')}${match[3]}`;
  }
  return null;
}

/**
 * An ArcTo's A is the sagitta: how far the arc bows out from the middle of its
 * chord, measured at right angles to it. Under an even scale it is just a
 * length and scales with everything else; under an uneven one the right angle
 * is no longer a right angle, and the bow has to be re-measured against the
 * chord the scale left behind.
 *
 * Scaling the sagitta vector A·(-dy, dx)/|c| and projecting it back onto the
 * normal of the new chord collapses to a single factor:
 *
 *     A' = A · sx · sy · |c| / |c'|
 *
 * which is A·s for sx = sy = s, as it must be.
 */
function bulgeFactor(dx, dy, sx, sy) {
  const chord = Math.hypot(dx, dy);
  const scaled = Math.hypot(dx * sx, dy * sy);
  if (!(chord > 0) || !(scaled > 0)) return null;
  return (sx * sy * chord) / scaled;
}

/**
 * An EllipticalArcTo carries the ellipse's shape as an angle (C, where the major
 * axis points) and a ratio (D, major over minor). An uneven scale turns one
 * ellipse into a different ellipse, so both change.
 *
 * The ellipse is the unit circle under M = R(C)·diag(D, 1); scaling makes it
 * diag(sx, sy)·M, and the new axes are that matrix's singular vectors. This is
 * the closed-form 2×2 SVD — the rotation of U, and the ratio of the singular
 * values.
 */
function scaleEllipseAxes(angle, aspect, sx, sy) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const a = sx * cos * aspect;
  const b = -sx * sin;
  const c = sy * sin * aspect;
  const d = sy * cos;

  const e = (a + d) / 2;
  const f = (a - d) / 2;
  const g = (c + b) / 2;
  const h = (c - b) / 2;
  const q = Math.hypot(e, h);
  const r = Math.hypot(f, g);
  const major = q + r;
  const minor = Math.abs(q - r);
  if (!(major > 0) || !(minor > 0)) return null;
  return { angle: (Math.atan2(h, e) + Math.atan2(g, f)) / 2, aspect: major / minor };
}

// The cells of one row, scaled. Returns null when the row has nothing to scale.
// `curX`/`curY` are where the pen is in the shape's *old* inches, which only the
// ArcTo sagitta needs.
function scaleRowCells(row, sx, sy, curX, curY) {
  if (!row || row.del || RELATIVE_ROWS.has(row.type)) return null;
  const cells = {};
  if (isNum(row.x)) cells.X = row.x * sx;
  if (isNum(row.y)) cells.Y = row.y * sy;

  switch (row.type) {
    case 'MoveTo':
    case 'LineTo':
    // A spline's A, B and C are knots and D is the degree — parameters along the
    // curve, not places on it. Only the control point moves.
    case 'SplineStart':
    case 'SplineKnot':
      break;

    case 'ArcTo': {
      if (isNum(row.a) && row.a !== 0 && isNum(row.x) && isNum(row.y)) {
        const factor = bulgeFactor(row.x - curX, row.y - curY, sx, sy);
        if (factor !== null) cells.A = row.a * factor;
      }
      break;
    }

    case 'EllipticalArcTo': {
      // A, B is a point the arc passes through, in inches like X and Y.
      if (isNum(row.a)) cells.A = row.a * sx;
      if (isNum(row.b)) cells.B = row.b * sy;
      if (sx !== sy && isNum(row.c) && isNum(row.d) && Math.abs(row.d) > 1e-9) {
        const axes = scaleEllipseAxes(row.c, Math.abs(row.d), sx, sy);
        if (axes) {
          cells.C = axes.angle;
          cells.D = Math.sign(row.d) * axes.aspect;
        }
      }
      break;
    }

    // An Ellipse is a centre and a point on each axis; an InfiniteLine is two
    // points on it. Nothing in either row is anything but inches, so all of it
    // scales, and both come out exact however uneven the scale is.
    case 'Ellipse': {
      if (isNum(row.a)) cells.A = row.a * sx;
      if (isNum(row.b)) cells.B = row.b * sy;
      if (isNum(row.c)) cells.C = row.c * sx;
      if (isNum(row.d)) cells.D = row.d * sy;
      break;
    }

    case 'InfiniteLine': {
      if (isNum(row.a)) cells.A = row.a * sx;
      if (isNum(row.b)) cells.B = row.b * sy;
      break;
    }

    case 'NURBSTo': {
      // A and C are knots, B and D weights. The control points live in E.
      const scaled = scalePointFormula(row.e, sx, sy);
      if (scaled) cells.E = scaled;
      break;
    }

    case 'PolylineTo': {
      const scaled = scalePointFormula(row.a, sx, sy);
      if (scaled) cells.A = scaled;
      break;
    }

    default:
      // A row type this file has not been taught scales its X and Y and no more,
      // which is right for a point and harmless for a row that has none.
      break;
  }

  return Object.keys(cells).length ? cells : null;
}

/**
 * What every geometry row of `shape` becomes when its box is scaled by
 * (`sx`, `sy`). Returns a list of `{ sectionIx, rowIx, rowType, cells }` in the
 * form both `transformVsdxShapes` (to write the file) and `applyGeometryScale`
 * (to change the model the canvas is drawn from) take.
 *
 * `cells` maps a Visio cell name to `{ value, formula }`. The formula is the one
 * the cell already had, handed straight back: a coordinate reading `Width*0.5`
 * goes on reading `Width*0.5`, and only the number cached beside it is brought
 * up to date. A cell that never had a formula gets a plain number and no
 * formula, which is the case this whole module exists for.
 */
export function planGeometryScale(shape, sx, sy) {
  const updates = [];
  if (!shape || !isNum(sx) || !isNum(sy)) return updates;
  if (Math.abs(sx - 1) < 1e-12 && Math.abs(sy - 1) < 1e-12) return updates;

  const width = shape.width || 0;
  const height = shape.height || 0;
  for (const geo of shape.geometry || []) {
    // Where the pen is, in the shape's old inches. A `Rel…` row moves it too, so
    // an ArcTo that follows one still knows what chord it is bowing away from.
    let curX = 0;
    let curY = 0;
    for (const row of geo.rows || []) {
      const cells = scaleRowCells(row, sx, sy, curX, curY);
      if (isNum(row.x)) curX = RELATIVE_ROWS.has(row.type) ? row.x * width : row.x;
      if (isNum(row.y)) curY = RELATIVE_ROWS.has(row.type) ? row.y * height : row.y;
      if (!cells) continue;

      const payload = {};
      for (const [name, value] of Object.entries(cells)) {
        const formula = row.formulas?.[name] || null;
        payload[name] = { value: typeof value === 'string' ? value : shapeCellNumber(value), formula };
      }
      updates.push({ sectionIx: geo.ix, rowIx: row.ix, rowType: row.type, cells: payload });
    }
  }
  return updates;
}

/**
 * Fold a plan from `planGeometryScale` back into the parsed shape, so the
 * renderer draws the new outline without the package having to be rewritten and
 * re-parsed. Rows are matched the way the file matches them: by which Geometry
 * section they are in and which IX they carry.
 */
export function applyGeometryScale(shape, plan) {
  if (!shape || !plan?.length) return;
  const byRow = new Map(plan.map(update => [`${update.sectionIx} ${update.rowIx}`, update.cells]));
  for (const geo of shape.geometry || []) {
    for (const row of geo.rows || []) {
      const cells = byRow.get(`${geo.ix} ${row.ix}`);
      if (!cells) continue;
      for (const [name, entry] of Object.entries(cells)) {
        const field = ROW_FIELD[name];
        if (field) row[field] = entry.value;
      }
    }
  }
}
