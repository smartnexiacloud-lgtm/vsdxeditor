// Working backwards from a drawn outline to the cells that drew it.
//
// geometryToPath turns a shape's Geometry rows into an SVG `d`. Reading an edit
// to that `d` back into the drawing needs the inverse: given the nth number in
// the path data, which Geometry section, which row, and which cell of that row
// produced it, and what value would that cell need to hold for the number to
// come out as it now is.
//
// The mapping is not guessed at. The renderer hands over the exact slice of
// path data each row produced (its `spans` option), so all this has to do is
// count the numbers in each slice and name them — and where the count does not
// match what the row type is expected to emit, it says so rather than naming
// them wrongly. That way a row type the renderer grows later, or one this file
// does not model (arcs, splines, NURBS), degrades to "not editable here"
// instead of silently writing a number into the wrong cell.
//
// Everything the parser recorded about where a row lives — its section IX, its
// own IX, whether the shape owns it or inherits it from a master, and the
// formula behind each cell — comes along, because writing the value back needs
// all four.

const DPI = 96;

// Which cell each number a row emits comes from, in the order geometryToPath
// writes them. `rel` marks the fraction-of-Width/Height rows: Visio has no
// absolute cubic, so every RelCubBezTo value is a fraction.
const ROW_COORDS = {
  MoveTo: [{ cell: 'X', axis: 'x', rel: false }, { cell: 'Y', axis: 'y', rel: false }],
  LineTo: [{ cell: 'X', axis: 'x', rel: false }, { cell: 'Y', axis: 'y', rel: false }],
  RelMoveTo: [{ cell: 'X', axis: 'x', rel: true }, { cell: 'Y', axis: 'y', rel: true }],
  RelLineTo: [{ cell: 'X', axis: 'x', rel: true }, { cell: 'Y', axis: 'y', rel: true }],
  RelCubBezTo: [
    { cell: 'A', axis: 'x', rel: true }, { cell: 'B', axis: 'y', rel: true },
    { cell: 'C', axis: 'x', rel: true }, { cell: 'D', axis: 'y', rel: true },
    { cell: 'X', axis: 'x', rel: true }, { cell: 'Y', axis: 'y', rel: true }
  ]
};

const NUMBER_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/** Every number in path data, in order. */
export function pathNumbers(d) {
  return (String(d || '').match(NUMBER_RE) || []).map(Number);
}

/** The command letters of path data, in order — the shape of the outline. */
export function pathCommands(d) {
  return (String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]/g) || []).join('');
}

function descriptorsFor(span) {
  const row = span.row;
  if (!row) return null;                       // the implicit opening MoveTo
  const layout = ROW_COORDS[row.type];
  if (!layout) return null;                    // an arc, a spline, a NURBS…

  // geometryToPath falls back to the current point for a coordinate the row
  // does not carry, and for the Rel* rows it falls back to the absolute branch
  // entirely. Either way the number on the page did not come from the cell this
  // layout names, so it must not be written back to it.
  const relative = row.type.startsWith('Rel');
  if (relative && (row.x === null || row.x === undefined || row.y === null || row.y === undefined)) return null;
  if (!relative && (row.x === null || row.x === undefined || row.y === null || row.y === undefined)) return null;
  return layout;
}

/**
 * Name every number a path's data holds.
 *
 * `spans` is what the renderer collected for that path. The result has one
 * entry per number in the path data — either a descriptor
 * `{ cell, axis, rel, row, section }` or null where the number cannot be traced
 * to a single cell.
 */
export function mapPathSpans(spans) {
  const out = [];
  for (const span of spans || []) {
    const count = pathNumbers(span.text).length;
    const layout = descriptorsFor(span);
    // The self-check: the renderer emitted a different number of coordinates
    // than this file expects for that row type, so the naming would be wrong.
    const usable = layout && layout.length === count ? layout : null;
    for (let i = 0; i < count; i++) {
      out.push(usable ? { ...usable[i], row: span.row, section: span.section } : null);
    }
  }
  return out;
}

/**
 * What the cell would have to hold for the drawn coordinate to be `value`
 * (in the renderer's shape-local px). The exact inverse of geometryToPath's
 * arithmetic — including the Y flip, since Visio measures up from the shape's
 * bottom-left and SVG down from its top-left.
 */
export function cellValueFor(descriptor, value, width, height) {
  if (!descriptor) return null;
  if (descriptor.rel) {
    const span = descriptor.axis === 'x' ? width : height;
    if (!(span > 0)) return null;
    const fraction = value / (DPI * span);
    return descriptor.axis === 'x' ? fraction : 1 - fraction;
  }
  return descriptor.axis === 'x' ? value / DPI : height - value / DPI;
}

// The formula Visio itself writes for a coordinate that is a fixed proportion
// of the shape — and what the pen tool writes, because it is what Visio writes.
// A coordinate expressed this way is not a number that happens to sit there; it
// is "sixty percent of the way across", and it has to stay that when the point
// moves, or the shape stops resizing properly the moment it is edited.
const PROPORTIONAL = /^\s*(Width|Height)\s*\*\s*([-+0-9.eE]+)\s*$/;

/**
 * Why a coordinate cannot be written, or null when it can.
 *
 * A row inherited from a master has no element on the shape yet — that is not a
 * refusal, it is an override waiting to be written. A cell driven by a formula
 * usually is: replacing `Width*0.5` with the number it currently evaluates to
 * looks like nothing has changed and quietly de-parametrises the shape, which
 * is the entire point of a Visio master. The exception is a plain proportion,
 * which can be rewritten *as a proportion* — see formulaFor.
 */
export function whyNotWritable(descriptor) {
  if (!descriptor) return 'this part of the outline is not a plain point (an arc, a spline, or a row type with no single cell behind it)';
  const row = descriptor.row;
  if (!row) return 'this point belongs to no geometry row';
  if (row.sectionIx === undefined || row.ix === undefined) {
    return 'the drawing does not record where this row lives';
  }
  const formula = row.formulas?.[descriptor.cell];
  if (!formula) return null;
  const proportional = PROPORTIONAL.exec(formula);
  const axis = proportional && proportional[1] === 'Width' ? 'x' : 'y';
  if (proportional && !descriptor.rel && axis === descriptor.axis) return null;
  return `cell ${descriptor.cell} is driven by the formula ${formula}`;
}

/**
 * The formula the cell should carry once the point has moved, or null when it
 * should carry none. A coordinate written as a proportion of the shape stays a
 * proportion; the proportion is simply the new one.
 */
export function formulaFor(descriptor, cellValue, width, height) {
  const formula = descriptor?.row?.formulas?.[descriptor.cell];
  const proportional = formula ? PROPORTIONAL.exec(formula) : null;
  if (!proportional) return null;
  const span = proportional[1] === 'Width' ? width : height;
  if (!(span > 0) || !Number.isFinite(cellValue)) return null;
  return `${proportional[1]}*${Number((cellValue / span).toFixed(10))}`;
}
