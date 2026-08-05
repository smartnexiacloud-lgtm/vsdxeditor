// Pen-tool geometry: turn an Illustrator-style path (anchors plus bezier
// handles) into a Visio <Shape>.
//
// The mapping is exact rather than a fit. Visio's RelCubBezTo row *is* SVG's
// cubic "C" command: cells A,B and C,D hold the two control points and X,Y the
// endpoint. Only two things need translating:
//
//   - the Y flip, because Visio measures up from the shape's bottom-left; and
//   - normalisation, because Visio has no *absolute* cubic. Every curve is
//     expressed as a fraction of the shape's Width/Height, so the bounding box
//     has to be settled before a single curve can be written down. That is why
//     a path is committed as a whole rather than point by point.
//
// Straight runs stay as plain MoveTo/LineTo rows (absolute local inches plus a
// Width*fraction formula, the way Visio writes its own), so a path drawn with
// no handles produces exactly the geometry the line tool would.

// A path with no extent along one axis (a perfectly horizontal drag) would give
// Width or Height 0, and every fraction multiplied by it collapses to a point.
// Floor the box and centre the path inside it instead.
const MIN_SPAN = 1e-4;

const DEFAULT_STYLE = {
  stroke: true,
  strokeColor: '#1a1a1a',
  strokeWidthPt: 1,
  strokePattern: 1,
  strokeTrans: 0,
  fill: false,
  fillColor: '#9ec6ff',
  fillPattern: 1,
  fillTrans: 0
};

function normalizeColor(value, fallback) {
  const text = String(value ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    return ('#' + text.slice(1).split('').map(c => c + c).join('')).toLowerCase();
  }
  return fallback;
}

function num(value) {
  if (!Number.isFinite(value)) return '0';
  // Enough precision for a 1:1000 drawing without pages of noise digits.
  const text = value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cell(name, value, formula = null) {
  const f = formula === null ? '' : ` F="${escapeAttr(formula)}"`;
  return `<Cell N="${name}" V="${escapeAttr(value)}"${f}/>`;
}

// The anchor a segment leaves from / arrives at when its handle is unset. A
// missing handle means "control point sits on the anchor", which is how
// Illustrator degrades a smooth point to a corner - and it stays a valid cubic.
function outControl(node) {
  return node.cOut || { x: node.x, y: node.y };
}

function inControl(node) {
  return node.cIn || { x: node.x, y: node.y };
}

function segmentIsStraight(from, to) {
  return !from.cOut && !to.cIn;
}

export function normalizePenNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter(node => node && Number.isFinite(node.x) && Number.isFinite(node.y))
    .map(node => ({
      x: node.x,
      y: node.y,
      cIn: node.cIn && Number.isFinite(node.cIn.x) && Number.isFinite(node.cIn.y)
        ? { x: node.cIn.x, y: node.cIn.y } : null,
      cOut: node.cOut && Number.isFinite(node.cOut.x) && Number.isFinite(node.cOut.y)
        ? { x: node.cOut.x, y: node.cOut.y } : null
    }));
}

// Ordered list of segments, each already carrying the two control points it
// will be drawn with. Shared by the bounding box, the XML writer, and the live
// preview so all three agree on what the path is.
export function penSegments(nodes, closed = false) {
  const segments = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    segments.push({ from: nodes[i], to: nodes[i + 1] });
  }
  if (closed && nodes.length > 2) {
    segments.push({ from: nodes[nodes.length - 1], to: nodes[0] });
  }
  return segments;
}

// The box has to cover the control points too, not just the anchors: a handle
// dragged outside the anchor hull would otherwise normalise to a fraction
// outside 0..1. Visio accepts that (it is only Width*1.2), but the selection
// rectangle would no longer match what is drawn.
export function penBounds(nodes, closed = false) {
  const points = [];
  for (const node of nodes) points.push({ x: node.x, y: node.y });
  for (const segment of penSegments(nodes, closed)) {
    if (segmentIsStraight(segment.from, segment.to)) continue;
    points.push(outControl(segment.from));
    points.push(inControl(segment.to));
  }
  if (!points.length) return null;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  return {
    minX, minY, maxX, maxY, spanX, spanY,
    width: Math.max(spanX, MIN_SPAN),
    height: Math.max(spanY, MIN_SPAN),
    pinX: minX + spanX / 2,
    pinY: minY + spanY / 2
  };
}

function fractions(bounds, point) {
  return {
    fx: bounds.spanX > 0 ? (point.x - bounds.minX) / bounds.spanX : 0.5,
    fy: bounds.spanY > 0 ? (point.y - bounds.minY) / bounds.spanY : 0.5
  };
}

function geometryRows(nodes, bounds, closed) {
  const rows = [];
  let ix = 1;

  const moveTo = fractions(bounds, nodes[0]);
  rows.push(
    `<Row T="MoveTo" IX="${ix++}">`
    + cell('X', num(moveTo.fx * bounds.width), `Width*${num(moveTo.fx)}`)
    + cell('Y', num(moveTo.fy * bounds.height), `Height*${num(moveTo.fy)}`)
    + '</Row>'
  );

  for (const segment of penSegments(nodes, closed)) {
    const end = fractions(bounds, segment.to);
    if (segmentIsStraight(segment.from, segment.to)) {
      rows.push(
        `<Row T="LineTo" IX="${ix++}">`
        + cell('X', num(end.fx * bounds.width), `Width*${num(end.fx)}`)
        + cell('Y', num(end.fy * bounds.height), `Height*${num(end.fy)}`)
        + '</Row>'
      );
      continue;
    }

    // RelCubBezTo is SVG's C, one for one: A,B = first control point,
    // C,D = second, X,Y = endpoint, every value a fraction of Width/Height.
    const cp1 = fractions(bounds, outControl(segment.from));
    const cp2 = fractions(bounds, inControl(segment.to));
    rows.push(
      `<Row T="RelCubBezTo" IX="${ix++}">`
      + cell('X', num(end.fx))
      + cell('Y', num(end.fy))
      + cell('A', num(cp1.fx))
      + cell('B', num(cp1.fy))
      + cell('C', num(cp2.fx))
      + cell('D', num(cp2.fy))
      + '</Row>'
    );
  }

  return rows;
}

// Build the <Shape> XML for a drawn path. `nodes` are in page units (inches,
// Y measured up from the bottom of the page) - the same space the parser
// reports shape geometry in. The ID is a placeholder; addVsdxShapeToPage
// assigns the real one when it knows what is free on the page.
export function buildPenShapeXml(nodes, style = {}, options = {}) {
  const path = normalizePenNodes(nodes);
  if (path.length < 2) throw new Error('A path needs at least two points');

  const closed = Boolean(options.closed) && path.length > 2;
  const bounds = penBounds(path, closed);
  const merged = { ...DEFAULT_STYLE, ...style };

  const strokeOn = merged.stroke !== false;
  const fillOn = merged.fill === true;
  const strokeColor = normalizeColor(merged.strokeColor, DEFAULT_STYLE.strokeColor);
  const fillColor = normalizeColor(merged.fillColor, DEFAULT_STYLE.fillColor);
  const strokeWidthPt = Number.isFinite(merged.strokeWidthPt) ? Math.max(0, merged.strokeWidthPt) : 1;
  const strokePattern = strokeOn ? Math.max(1, Math.round(merged.strokePattern) || 1) : 0;
  const fillPattern = fillOn ? Math.max(1, Math.round(merged.fillPattern) || 1) : 0;
  const strokeTrans = Math.min(1, Math.max(0, Number(merged.strokeTrans) || 0));
  const fillTrans = Math.min(1, Math.max(0, Number(merged.fillTrans) || 0));

  const cells = [
    cell('PinX', num(bounds.pinX)),
    cell('PinY', num(bounds.pinY)),
    cell('Width', num(bounds.width)),
    cell('Height', num(bounds.height)),
    cell('LocPinX', num(bounds.width / 2), 'Width*0.5'),
    cell('LocPinY', num(bounds.height / 2), 'Height*0.5'),
    cell('Angle', '0'),
    cell('FlipX', '0'),
    cell('FlipY', '0'),
    cell('ResizeMode', '0'),
    // Visio stores LineWeight in inches; points are what the UI asks for.
    cell('LineWeight', num(strokeWidthPt / 72)),
    cell('LineColor', strokeColor),
    cell('LinePattern', String(strokePattern)),
    cell('LineCap', '0'),
    cell('Rounding', '0'),
    cell('LineColorTrans', num(strokeTrans)),
    cell('FillForegnd', fillColor),
    cell('FillBkgnd', fillColor),
    cell('FillPattern', String(fillPattern)),
    cell('FillForegndTrans', num(fillTrans)),
    cell('FillBkgndTrans', num(fillTrans)),
    cell('ShdwPattern', '0')
  ];

  const geometry = [
    '<Section N="Geometry" IX="0">',
    cell('NoFill', fillOn ? '0' : '1'),
    cell('NoLine', strokeOn ? '0' : '1'),
    cell('NoShow', '0'),
    cell('NoSnap', '0'),
    ...geometryRows(path, bounds, closed),
    '</Section>'
  ].join('');

  const id = options.id === undefined || options.id === null ? 1 : options.id;
  return `<Shape ID="${escapeAttr(id)}" Type="Shape">${cells.join('')}${geometry}</Shape>`;
}

// Live preview path, in the same user units renderPage draws shapes in
// (page inches x dpi, Y already flipped). Built from the same segment list as
// the XML so what is on screen while drawing is what gets committed.
export function penPathToSvgD(nodes, options = {}) {
  const path = normalizePenNodes(nodes);
  if (!path.length) return '';

  const closed = Boolean(options.closed) && path.length > 2;
  const dpi = Number.isFinite(options.dpi) ? options.dpi : 96;
  const pageHeight = Number.isFinite(options.pageHeight) ? options.pageHeight : 0;
  const px = (point) => `${(point.x * dpi).toFixed(4)} ${((pageHeight - point.y) * dpi).toFixed(4)}`;

  let d = `M ${px(path[0])}`;
  for (const segment of penSegments(path, closed)) {
    if (segmentIsStraight(segment.from, segment.to)) {
      d += ` L ${px(segment.to)}`;
    } else {
      d += ` C ${px(outControl(segment.from))} ${px(inControl(segment.to))} ${px(segment.to)}`;
    }
  }
  return closed ? `${d} Z` : d;
}
