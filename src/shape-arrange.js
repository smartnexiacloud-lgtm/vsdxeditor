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

function indexEntries(page) {
  const byId = new Map();
  for (const entry of collectShapeBoxes(page)) byId.set(entry.id, entry);
  return byId;
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
