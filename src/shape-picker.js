// Working out which shapes sit at a point, and which shapes belong to a layer.
//
// Both answers need every shape's box in page space, including shapes nested
// inside groups — whose coordinates are relative to their parent, not the page.
// Rather than guess at that, this mirrors the transform the renderer builds
// (svg-renderer.js, "Calculate transform"): translate to the pin, rotate about
// the local pin, then flip. Composing those down the tree puts a nested shape
// exactly where it is drawn, so a hit test agrees with what the user sees.
//
// Boxes are axis-aligned in page inches with Y up, the same space the parser
// reports PinX/PinY in.

import { rendersAsFlatConnector, connectorRenderBounds } from './svg-renderer.js';

const DPI = 96;

// 2D affine as [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// The same composition renderShape emits, in the same order. Exported because
// regrouping a shape has to reproduce it exactly in reverse: whatever cells it
// ends up with must feed back through here to the matrix it draws at now.
export function shapeLocalMatrix(shape, parentHeight) {
  const px = (shape.pinX || 0) * DPI;
  const py = (parentHeight - (shape.pinY || 0)) * DPI;
  const lpx = (shape.locPinX || 0) * DPI;
  const lpy = ((shape.height || 0) - (shape.locPinY || 0)) * DPI;

  let m = [1, 0, 0, 1, px - lpx, py - lpy];

  const angleDeg = -(shape.angle || 0) * (180 / Math.PI);
  if (Math.abs(angleDeg) > 0.01) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // rotate(angle, cx, cy)
    m = multiply(m, [cos, sin, -sin, cos, lpx - cos * lpx + sin * lpy, lpy - sin * lpx - cos * lpy]);
  }

  if (shape.flipX || shape.flipY) {
    const sx = shape.flipX ? -1 : 1;
    const sy = shape.flipY ? -1 : 1;
    m = multiply(m, [1, 0, 0, 1, shape.flipX ? (shape.width || 0) * DPI : 0, shape.flipY ? (shape.height || 0) * DPI : 0]);
    m = multiply(m, [sx, 0, 0, sy, 0, 0]);
  }

  return m;
}

export function isUnlayered(shape) {
  return !(shape?.layerMembers?.length);
}

function shapeLabel(shape) {
  const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  return text(shape.name) || text(shape.nameU) || text(shape.text).slice(0, 40)
    || (shape.type === 'Group' ? 'Group' : 'Shape');
}

// Flatten the page into one entry per shape, each with its page-space box.
// `order` is paint order: later entries are drawn on top of earlier ones.
export function collectShapeBoxes(page) {
  const entries = [];
  if (!page) return entries;
  const pageHeight = page.height || 0;

  const walk = (shapes, parentMatrix, parentHeight, depth, ancestors) => {
    for (const shape of shapes || []) {
      // A flat connector's group has no transform of its own and its path is
      // already in the parent's coordinates, so its box comes from the drawn
      // path rather than from the shape's own width and height.
      const flatConnector = rendersAsFlatConnector(shape);
      const connectorBox = flatConnector ? connectorRenderBounds(shape, parentHeight) : null;
      const matrix = connectorBox ? parentMatrix : multiply(parentMatrix, shapeLocalMatrix(shape, parentHeight));

      const w = (shape.width || 0) * DPI;
      const h = (shape.height || 0) * DPI;
      const corners = connectorBox
        ? [
          apply(matrix, connectorBox.minX, connectorBox.minY),
          apply(matrix, connectorBox.maxX, connectorBox.minY),
          apply(matrix, connectorBox.maxX, connectorBox.maxY),
          apply(matrix, connectorBox.minX, connectorBox.maxY)
        ]
        : [apply(matrix, 0, 0), apply(matrix, w, 0), apply(matrix, w, h), apply(matrix, 0, h)];
      const xs = corners.map(c => c.x);
      const ys = corners.map(c => c.y);

      // Back out of SVG user units into page inches, Y up.
      const minX = Math.min(...xs) / DPI;
      const maxX = Math.max(...xs) / DPI;
      const minY = pageHeight - Math.max(...ys) / DPI;
      const maxY = pageHeight - Math.min(...ys) / DPI;

      entries.push({
        shape,
        id: String(shape.id),
        label: shapeLabel(shape),
        isGroup: shape.type === 'Group' || (shape.subShapes?.length > 0),
        depth,
        ancestors,
        layerMembers: shape.layerMembers || [],
        bounds: { minX, minY, maxX, maxY },
        area: Math.max(maxX - minX, 0) * Math.max(maxY - minY, 0),
        // The local→page matrix in SVG user units, so callers (and the tests
        // that check this against the renderer's own output) can place an
        // overlay on the shape without recomputing the chain.
        matrix,
        order: entries.length
      });

      if (shape.subShapes?.length) {
        // Children live in the parent's local space, flipped about the
        // parent's own height — the renderer passes shape.height down as the
        // page height for exactly this reason.
        walk(shape.subShapes, matrix, shape.height || 0, depth + 1, [...ancestors, String(shape.id)]);
      }
    }
  };

  walk(page.shapes, IDENTITY, pageHeight, 0, []);
  return entries;
}

// Every shape whose box contains the point, topmost first. Groups are included
// alongside their children so the menu can offer either the component or the
// individual part inside it.
export function shapesAtPoint(page, x, y, options = {}) {
  const slop = Number.isFinite(options.slop) ? options.slop : 0;
  const hits = collectShapeBoxes(page).filter((entry) => {
    const b = entry.bounds;
    return x >= b.minX - slop && x <= b.maxX + slop && y >= b.minY - slop && y <= b.maxY + slop;
  });

  // Paint order puts the topmost last; the user expects it first. Ties on a
  // group and its child resolve to the child, which is the more specific pick.
  return hits.sort((a, b) => (b.order - a.order) || (b.depth - a.depth));
}

// Every shape whose name or text matches, in paint order. Visio's own Find
// searches shape text, but a drawing's useful handle is often the shape *name*
// instead ("Feeder cable"), so both count — as does `#7`, which searches by ID
// and matches on a prefix so the list narrows as you type.
export function searchShapes(page, query, options = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
  const byId = needle.startsWith('#') ? needle.slice(1).trim() : null;

  const results = [];
  for (const entry of collectShapeBoxes(page)) {
    const hit = byId !== null
      ? byId.length > 0 && entry.id.toLowerCase().startsWith(byId)
      : [entry.label, entry.shape.name, entry.shape.nameU, entry.shape.text]
        .some(value => String(value ?? '').toLowerCase().includes(needle));
    if (!hit) continue;
    results.push(entry);
    if (results.length >= limit) break;
  }
  return results;
}

// Every shape carrying a layer, in paint order. `layerIndex` may be the
// editor's virtual unlayered marker, in which case it means "no layer at all".
export function shapesOnLayer(page, layerIndex, options = {}) {
  const unlayeredMarker = options.unlayeredIndex;
  const wanted = String(layerIndex);
  return collectShapeBoxes(page).filter((entry) => (
    unlayeredMarker !== undefined && wanted === String(unlayeredMarker)
      ? isUnlayered(entry.shape)
      : entry.layerMembers.some(member => String(member) === wanted)
  ));
}
