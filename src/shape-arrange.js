// Grouping, ungrouping and z-order.
//
// Two of those are trivial — Visio's z-order *is* the document order of the
// <Shape> elements, so front and back are a move within the parent's <Shapes>.
// The other two are the same question asked twice: a shape's PinX/PinY are in
// its parent's coordinate space, so changing its parent changes what those
// numbers have to be if the shape is to stay exactly where it is drawn.
//
// Everything here answers that by going through the matrix the renderer itself
// composes (shape-picker.js `shapeLocalMatrix`, which mirrors svg-renderer's
// "Calculate transform"): take the matrix the shape draws at now, express it
// relative to the new parent, and read the cells back out of it. Reading them
// back is exact rather than approximate, because that matrix is only ever a
// translation, a rotation and a reflection — never a scale or a shear — so it
// decomposes into Pin, Angle and the flip flags with nothing left over.
//
// Angles are Visio's: radians, counter-clockwise, the opposite sense to SVG's
// rotate(). Positions are page inches with Y up.

import { collectShapeBoxes, shapeLocalMatrix } from './shape-picker.js';
import { rendersAsFlatConnector } from './svg-renderer.js';

const DPI = 96;
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

function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) throw new Error('Cannot re-parent a shape through a degenerate transform');
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

// The cells `shape` needs so that, hung off `parentMatrix` in a parent
// `parentHeight` inches tall, it lands exactly where `worldMatrix` puts it.
export function cellsForNewParent(worldMatrix, shape, parentMatrix, parentHeight) {
  const rel = multiply(invert(parentMatrix), worldMatrix);
  const [a, b, c, d, e, f] = rel;

  // A reflection is a reflection whichever axis you name it after, so keep the
  // flags the shape already carries when their parity is right, and only toggle
  // one when the new parent reverses the handedness. Rewriting a FlipY shape as
  // FlipX plus 180° would render the same and diff much worse.
  let flipX = Boolean(shape.flipX);
  let flipY = Boolean(shape.flipY);
  if ((flipX !== flipY) !== (a * d - b * c < 0)) flipX = !flipX;

  // The renderer composes T(pin) · R · T(flip) · S, so peeling S off the linear
  // part leaves the rotation, and S is its own inverse.
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  const rot = [a * sx, b * sx, c * sy, d * sy];
  const angleDeg = Math.atan2(rot[1], rot[0]) * (180 / Math.PI);
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const sin = Math.sin((angleDeg * Math.PI) / 180);

  const w = (shape.width || 0) * DPI;
  const h = (shape.height || 0) * DPI;
  const lpx = (shape.locPinX || 0) * DPI;
  const lpy = ((shape.height || 0) - (shape.locPinY || 0)) * DPI;
  const fx = flipX ? w : 0;
  const fy = flipY ? h : 0;

  // Everything after the pin translation moves the origin too; back that out so
  // the pin is what is left.
  const rtx = lpx - cos * lpx + sin * lpy;
  const rty = lpy - sin * lpx - cos * lpy;
  const kx = rot[0] * fx + rot[2] * fy + rtx;
  const ky = rot[1] * fx + rot[3] * fy + rty;

  return {
    pinX: (e - kx + lpx) / DPI,
    pinY: parentHeight - (f - ky + lpy) / DPI,
    angle: -angleDeg * (Math.PI / 180),
    flipX,
    flipY
  };
}

/**
 * The page flattened to id → entry. Every planner below needs one before it can
 * work out where anything is, and building it walks the whole page — 20 ms on a
 * drawing of a few thousand shapes.
 *
 * A caller planning repeatedly against a page that is not changing underneath
 * it should therefore build one and pass it back in as `options.index`. A drag
 * is exactly that: it re-plans on every mouse move while the model sits still,
 * and without this it was walking the page twice per move.
 *
 * A caller that already has the page's boxes — the app caches them between
 * renders — can hand them in as `entries` rather than have them collected
 * again.
 */
export function buildShapeIndex(page, entries) {
  const byId = new Map();
  for (const entry of entries || collectShapeBoxes(page)) byId.set(entry.id, entry);
  return byId;
}

function indexEntries(page, index) {
  return index instanceof Map ? index : buildShapeIndex(page);
}

// A shape's own local→page matrix. `entry.matrix` is not always it: a flat
// connector is drawn straight into its parent's coordinates and the picker
// reports the parent's matrix for it, which is exactly why one cannot be
// re-parented without rewriting its Begin/End cells.
function worldMatrixOf(entry, byId, page) {
  let matrix = shapeLocalMatrix(entry.shape, parentHeightOf(entry, byId, page));
  for (let i = entry.ancestors.length - 1; i >= 0; i--) {
    const ancestor = byId.get(entry.ancestors[i]);
    if (!ancestor) break;
    matrix = multiply(shapeLocalMatrix(ancestor.shape, parentHeightOf(ancestor, byId, page)), matrix);
  }
  return matrix;
}

function parentHeightOf(entry, byId, page) {
  const parentId = entry.ancestors[entry.ancestors.length - 1];
  const parent = parentId ? byId.get(parentId) : null;
  return parent ? (parent.shape.height || 0) : (page.height || 0);
}

// Reparenting a connector would move it, so say so rather than doing it.
function rejectFlatConnectors(shapes, verb) {
  const bad = shapes.filter(shape => rendersAsFlatConnector(shape));
  if (!bad.length) return;
  const names = bad.map(shape => shape.name || shape.nameU || `Shape ${shape.id}`).join(', ');
  throw new Error(
    `${verb} ${names}: a connector is drawn in its parent's own coordinates, so moving it into or out of a group would move it on the page.`
  );
}

export function isGroupShape(shape) {
  return Boolean(shape) && ((shape.subShapes?.length || 0) > 0 || shape.type === 'Group');
}

// A group whose children carry MasterShape are reading their cells and their
// geometry out of the group's master. That inheritance only reaches them
// through the group, so dissolving it would leave hollow shapes behind —
// Visio's own ungroup breaks the master link and copies everything down, which
// is a different and much larger operation than moving elements about.
export function inheritsFromMaster(groupShape) {
  return (groupShape?.subShapes || []).some(child => Boolean(child.masterShapeId));
}

// What it would take to wrap `memberIds` in a new group: where the group goes,
// and what each member's cells become once they hang off it instead of the
// page. Members must be top-level siblings — a group's own coordinate space is
// what makes the bounding box meaningful, and shapes nested at different depths
// have no shared one.
export function planGroupShapes(page, memberIds) {
  const byId = indexEntries(page);
  const wanted = [...new Set((memberIds || []).map(String))];
  const members = wanted.map(id => byId.get(id)).filter(Boolean);
  if (members.length !== wanted.length) throw new Error('Some of those shapes are no longer on the page');
  if (members.length < 2) throw new Error('Grouping needs at least two shapes');
  if (members.some(entry => entry.depth !== 0)) {
    throw new Error('Only top-level shapes can be grouped — ungroup the outer group first');
  }
  rejectFlatConnectors(members.map(entry => entry.shape), 'Cannot group');

  // Paint order, so the group lands where the front-most member was and the
  // members keep their order relative to each other inside it.
  members.sort((a, b) => a.order - b.order);

  const minX = Math.min(...members.map(entry => entry.bounds.minX));
  const minY = Math.min(...members.map(entry => entry.bounds.minY));
  const maxX = Math.max(...members.map(entry => entry.bounds.maxX));
  const maxY = Math.max(...members.map(entry => entry.bounds.maxY));
  const width = maxX - minX;
  const height = maxY - minY;

  const groupCells = {
    pinX: minX + width / 2,
    pinY: minY + height / 2,
    width,
    height,
    locPinX: width / 2,
    locPinY: height / 2,
    angle: 0,
    flipX: false,
    flipY: false
  };
  const groupMatrix = shapeLocalMatrix(groupCells, page.height || 0);

  // A layer the group can claim only if every member agrees; a group straddling
  // two layers has no honest answer, so it gets none.
  const layerSets = members.map(entry => (entry.layerMembers || []).map(String).sort().join(','));
  const layerMembers = layerSets.every(set => set === layerSets[0]) && layerSets[0]
    ? layerSets[0].split(',')
    : [];

  return {
    groupCells,
    layerMembers,
    // The group takes the front-most member's place in the z-order.
    anchorId: members[members.length - 1].id,
    members: members.map(entry => ({
      id: entry.id,
      cells: cellsForNewParent(worldMatrixOf(entry, byId, page), entry.shape, groupMatrix, height)
    }))
  };
}

// The reverse: what each child's cells become once the group holding it is gone
// and it answers to the group's own parent instead.
export function planUngroupShape(page, groupId) {
  const byId = indexEntries(page);
  const group = byId.get(String(groupId));
  if (!group) throw new Error('That shape is no longer on the page');
  if (!(group.shape.subShapes?.length)) throw new Error(`${group.label} is not a group`);

  const children = [...byId.values()].filter(
    entry => entry.ancestors[entry.ancestors.length - 1] === group.id
  );
  // Asked first because it is a fact about the group itself rather than about
  // any one shape in it.
  if (inheritsFromMaster(group.shape)) {
    throw new Error(
      `${group.label} comes from a master, and its parts read their size and geometry from that master through the group. Pulling them out would empty them, so this group cannot be dissolved.`
    );
  }
  rejectFlatConnectors(children.map(entry => entry.shape), 'Cannot ungroup');

  const parentId = group.ancestors[group.ancestors.length - 1];
  const parent = parentId ? byId.get(parentId) : null;
  const parentMatrix = parent ? worldMatrixOf(parent, byId, page) : IDENTITY;
  const parentHeight = parent ? (parent.shape.height || 0) : (page.height || 0);

  return {
    groupId: group.id,
    layerMembers: (group.layerMembers || []).map(String),
    children: children.map(entry => ({
      id: entry.id,
      cells: cellsForNewParent(worldMatrixOf(entry, byId, page), entry.shape, parentMatrix, parentHeight)
    }))
  };
}

// ---------------------------------------------------------------------------
// Direct manipulation: move, rotate, resize
//
// The drawing was editable only through dialogs and the XML editor — you could
// say where a shape belonged but not push it there. These three turn a drag on
// the canvas into the cells that make it true.
//
// Move and rotate are the same trick grouping already uses: work out the matrix
// the shape should end up drawing at, then ask cellsForNewParent to read the
// cells back out of it relative to the parent it already has. That is exact,
// and it costs nothing to support a shape nested three groups deep, because the
// matrix chain is the same one the renderer walks.
//
// Resize is the one that cannot go through a matrix: Width and Height are not
// in it. A shape's local box is always (0,0)–(w,h), so growing it moves three of
// its four corners; the pin is then nudged to put the corner the user is *not*
// dragging back exactly where it was.
// ---------------------------------------------------------------------------

function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// The four corners of a shape's box, in the renderer's own user units, under a
// matrix it is not drawn at yet. Dragging shows this outline rather than moving
// the drawing itself: the shape is not edited until the mouse comes up, and an
// outline that is exactly where the shape is about to be says so honestly. It is
// the shape's *own* box, corners and all, so a turned shape gets a turned
// outline rather than the upright box that contains it.
function boxCorners(matrix, shape) {
  const w = (shape.width || 0) * DPI;
  const h = (shape.height || 0) * DPI;
  return [apply(matrix, 0, 0), apply(matrix, w, 0), apply(matrix, w, h), apply(matrix, 0, h)];
}

function contextOf(page, id, index) {
  const byId = indexEntries(page, index);
  const entry = byId.get(String(id));
  if (!entry) throw new Error('That shape is no longer on the page');
  const parentId = entry.ancestors[entry.ancestors.length - 1];
  const parent = parentId ? byId.get(parentId) : null;
  return {
    byId,
    entry,
    parent,
    parentMatrix: parent ? worldMatrixOf(parent, byId, page) : IDENTITY,
    parentHeight: parent ? (parent.shape.height || 0) : (page.height || 0),
    world: worldMatrixOf(entry, byId, page)
  };
}

// A flat connector is drawn from its Begin/End cells straight into its parent's
// coordinates — its Pin says nothing about where it appears, so moving it by
// moving the pin moves nothing at all. Saying so beats a drag that visibly does
// nothing.
function rejectFlatConnector(shape, verb) {
  if (!rendersAsFlatConnector(shape)) return;
  const name = shape.name || shape.nameU || `Shape ${shape.id}`;
  throw new Error(
    `Cannot ${verb} ${name}: a connector is drawn between its endpoints rather than placed by its pin, so it has to be re-routed instead of moved.`
  );
}

/**
 * Move shapes by (dx, dy) page inches, Y up. Returns [{id, cells}].
 */
export function planMoveShapes(page, shapeIds, dx, dy, options = {}) {
  const wanted = [...new Set((shapeIds || []).map(String))];
  if (!wanted.length) throw new Error('Nothing to move');
  // Dragging a group drags what is inside it, and its children's cells are in
  // *its* coordinates — they have not moved at all. Dropping them keeps a
  // selection of "the group and something in it" from moving that child twice.
  const byId = indexEntries(page, options.index);
  const carried = new Set();
  for (const id of wanted) {
    const entry = byId.get(id);
    if (entry && wanted.some(other => other !== id && entry.ancestors.includes(other))) carried.add(id);
  }

  return wanted.filter(id => !carried.has(id)).map(id => {
    const { entry, parentMatrix, parentHeight, world } = contextOf(page, id, byId);
    rejectFlatConnector(entry.shape, 'move');
    // Page inches are Y-up; the matrices are in renderer px, Y-down.
    const moved = [world[0], world[1], world[2], world[3], world[4] + dx * DPI, world[5] - dy * DPI];
    return {
      id,
      cells: cellsForNewParent(moved, entry.shape, parentMatrix, parentHeight),
      preview: boxCorners(moved, entry.shape)
    };
  });
}

/**
 * Place a shape by the matrix its *own* group carries — the local→parent
 * transform the renderer emits for it. Returns `{id, cells}`.
 *
 * This is how an edit made to the picture somewhere else comes back
 * (src/svg-import.js): SVG nests a shape's transform inside its parent's
 * exactly as Visio measures a child's cells in its parent's coordinates, so a
 * changed transform on one group is a changed placement of one shape, whatever
 * its ancestors did.
 */
export function planPlaceShapeLocally(page, shapeId, localMatrix, options = {}) {
  const { entry, parentMatrix, parentHeight } = contextOf(page, shapeId, options.index);
  rejectFlatConnector(entry.shape, 'move');
  return {
    id: String(shapeId),
    cells: cellsForNewParent(multiply(parentMatrix, localMatrix), entry.shape, parentMatrix, parentHeight)
  };
}

/**
 * Turn shapes by `deltaRad` (Visio's sense: counter-clockwise), each about its
 * own pin. Returns [{id, cells}].
 */
export function planRotateShapes(page, shapeIds, deltaRad, options = {}) {
  const wanted = [...new Set((shapeIds || []).map(String))];
  if (!wanted.length) throw new Error('Nothing to rotate');
  if (!Number.isFinite(deltaRad)) throw new Error('That is not an angle');
  const byId = indexEntries(page, options.index);

  return wanted.map(id => {
    const { entry, parentMatrix, parentHeight, world } = contextOf(page, id, byId);
    rejectFlatConnector(entry.shape, 'rotate');
    // The pin in world px: it is the shape's own LocPin, which is where every
    // rotation in the file is measured from.
    const shape = entry.shape;
    const pin = apply(world, (shape.locPinX || 0) * DPI, ((shape.height || 0) - (shape.locPinY || 0)) * DPI);
    // Visio turns counter-clockwise, the screen turns clockwise.
    const a = -deltaRad;
    const cos = Math.cos(a), sin = Math.sin(a);
    const about = [cos, sin, -sin, cos, pin.x - cos * pin.x + sin * pin.y, pin.y - sin * pin.x - cos * pin.y];
    const turned = multiply(about, world);
    return {
      id,
      cells: cellsForNewParent(turned, entry.shape, parentMatrix, parentHeight),
      preview: boxCorners(turned, entry.shape)
    };
  });
}

// Which corner of the local box a handle drags, and which one therefore has to
// stay put. Local px run right and *down* from the shape's top-left, so 'n' is
// y = 0 whatever the shape's rotation is doing on screen.
const RESIZE_HANDLES = {
  nw: { fx: 0, fy: 0 }, n: { fx: null, fy: 0 }, ne: { fx: 1, fy: 0 },
  w: { fx: 0, fy: null }, e: { fx: 1, fy: null },
  sw: { fx: 0, fy: 1 }, s: { fx: null, fy: 1 }, se: { fx: 1, fy: 1 }
};

const MIN_SIZE_IN = 1 / DPI;   // one renderer pixel: smaller is not a shape

/**
 * Resize `shapeId` by dragging `handle` to the page point (x, y), in inches
 * with Y up. Returns {id, cells, children} — `children` being what a group's
 * contents become, since a group's local space is its own size.
 */
export function planResizeShape(page, shapeId, handle, x, y, options = {}) {
  const spec = RESIZE_HANDLES[handle];
  if (!spec) throw new Error(`Unknown resize handle "${handle}"`);
  const { entry, parentMatrix, parentHeight, world } = contextOf(page, shapeId, options.index);
  const shape = entry.shape;
  rejectFlatConnector(shape, 'resize');

  const w = (shape.width || 0) * DPI;
  const h = (shape.height || 0) * DPI;
  if (!(w > 0 && h > 0)) throw new Error('That shape has no size to change');

  // Where the pointer is in the shape's own coordinates, so a rotated shape
  // resizes along its own axes rather than the screen's.
  const local = apply(invert(world), x * DPI, (page.height - y) * DPI);

  let newW = w;
  let newH = h;
  if (spec.fx === 1) newW = local.x;
  else if (spec.fx === 0) newW = w - local.x;
  if (spec.fy === 1) newH = local.y;
  else if (spec.fy === 0) newH = h - local.y;

  // Shift keeps the shape's proportions, on whichever axis moved most.
  if (options.keepAspect && spec.fx !== null && spec.fy !== null) {
    const scale = Math.max(Math.abs(newW / w), Math.abs(newH / h));
    newW = w * scale * Math.sign(newW || 1);
    newH = h * scale * Math.sign(newH || 1);
  }

  const floor = MIN_SIZE_IN * DPI;
  newW = Math.max(floor, newW);
  newH = Math.max(floor, newH);
  const sx = newW / w;
  const sy = newH / h;

  // The corner not being dragged. An edge handle has no fixed corner on its
  // free axis, so it keeps that axis's origin, which is what "the top edge
  // stayed put" means.
  const anchorX = spec.fx === 1 ? 0 : spec.fx === 0 ? w : 0;
  const anchorY = spec.fy === 1 ? 0 : spec.fy === 0 ? h : 0;
  const target = apply(world, anchorX, anchorY);

  const resized = {
    ...shape,
    width: newW / DPI,
    height: newH / DPI,
    locPinX: (shape.locPinX || 0) * sx,
    locPinY: (shape.locPinY || 0) * sy
  };
  const anchorNewX = spec.fx === 1 ? 0 : spec.fx === 0 ? newW : 0;
  const anchorNewY = spec.fy === 1 ? 0 : spec.fy === 0 ? newH : 0;
  // The pin translates the local frame in the parent's coordinates before
  // anything else happens to it, so the correction is a straight subtraction —
  // no matter what the rotation and the flips are doing.
  const landed = apply(shapeLocalMatrix(resized, parentHeight), anchorNewX, anchorNewY);
  const wanted = apply(invert(parentMatrix), target.x, target.y);

  const cells = {
    pinX: (resized.pinX || 0) + (wanted.x - landed.x) / DPI,
    pinY: (resized.pinY || 0) - (wanted.y - landed.y) / DPI,
    width: resized.width,
    height: resized.height,
    locPinX: resized.locPinX,
    locPinY: resized.locPinY
  };

  // A group's children are placed in inches inside the group's own box, so the
  // box growing has to take them with it or the group would resize around a
  // stationary picture. Visio does the same thing.
  //
  // Only the immediate children: a grandchild is placed inside *its* parent,
  // whose size is being scaled here, so it comes along with it.
  const children = (shape.subShapes || []).map(child => ({
    id: String(child.id),
    cells: {
      pinX: (child.pinX || 0) * sx,
      pinY: (child.pinY || 0) * sy,
      width: (child.width || 0) * sx,
      height: (child.height || 0) * sy,
      locPinX: (child.locPinX || 0) * sx,
      locPinY: (child.locPinY || 0) * sy
    }
  }));

  const placed = { ...resized, pinX: cells.pinX, pinY: cells.pinY };
  return {
    id: String(entry.id),
    cells,
    children,
    preview: boxCorners(multiply(parentMatrix, shapeLocalMatrix(placed, parentHeight)), placed)
  };
}
