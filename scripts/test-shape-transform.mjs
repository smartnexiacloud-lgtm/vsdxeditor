// Moving, turning and resizing shapes, checked against real drawings.
//
// These are the three things a drag on the canvas has to be able to mean, and
// all three are only trustworthy if they are *exact*: a move must move a shape
// by the distance asked for and leave every other shape alone, a rotation must
// come back to where it started after four quarter turns, and a resize must
// leave the corner the user is not dragging exactly where it was. So each one
// is done for real — rewriting the .vsdx and parsing it back — and measured.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-transform-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx, transformVsdxShapes } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { collectShapeBoxes } = await import(pathToFileURL(join(tmp, 'shape-picker.js')));
const { rendersAsFlatConnector } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));
const { planMoveShapes, planRotateShapes, planResizeShape } =
  await import(pathToFileURL(join(tmp, 'shape-arrange.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const loadPage = async (buffer, pageId = null) => {
  const parsed = await parseVsdx(buffer);
  return pageId === null
    ? (parsed.pages.find(p => !p.isBackground) || parsed.pages[0])
    : parsed.pages.find(p => String(p.id) === String(pageId));
};

const placementOf = (page) => {
  const map = new Map();
  for (const entry of collectShapeBoxes(page)) map.set(entry.id, entry);
  return map;
};
const boundsOf = (page, id) => placementOf(page).get(String(id))?.bounds;
const cornersOf = (page, id) => {
  const entry = placementOf(page).get(String(id));
  if (!entry) return null;
  const m = entry.matrix;
  const w = (entry.shape.width || 0) * 96;
  const h = (entry.shape.height || 0) * 96;
  return [[0, 0], [w, 0], [w, h], [0, h]]
    .map(([x, y]) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }));
};
const worstCornerDrift = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

// A ten-thousandth of an inch is finer than anything Visio stores.
const TOL = 1e-6;
const near = (a, b, tol = TOL) => Math.abs(a - b) <= tol;

const FIXTURES = [
  'test-files/test4_connectors.vsdx',
  'test-files/test3_house.vsdx',
  'test-files/test9_rect_and_line.vsdx',
];

for (const fixture of FIXTURES) {
  console.log(`\ntransform: ${fixture}`);
  const original = toBuffer(readFileSync(fixture));
  const page = await loadPage(original);
  const before = placementOf(page);

  // A shape placed by its pin. A flat connector is drawn between its endpoints
  // instead, and says so rather than pretending to move.
  const movable = (page.shapes || []).filter(shape => !rendersAsFlatConnector(shape));
  if (!movable.length) {
    console.log('  skip — this page has nothing but connectors');
    continue;
  }
  const target = String(movable[0].id);
  const others = [...before.keys()].filter(id => id !== target
    && !before.get(id).ancestors.includes(target));

  // --- Move ----------------------------------------------------------------
  const DX = 0.75, DY = -0.4;
  const movePlan = planMoveShapes(page, [target], DX, DY);
  check('the move plan names the shape asked for', movePlan.length === 1 && movePlan[0].id === target);
  check('and comes with an outline to draw while dragging',
    movePlan[0].preview?.length === 4, JSON.stringify(movePlan[0].preview));

  const { buffer: moved } = await transformVsdxShapes(original, page.id, movePlan);
  const movedPage = await loadPage(moved, page.id);
  const movedBounds = boundsOf(movedPage, target);
  const wasBounds = before.get(target).bounds;
  check('the shape moved by exactly the distance asked for',
    near(movedBounds.minX - wasBounds.minX, DX) && near(movedBounds.minY - wasBounds.minY, DY),
    `${movedBounds.minX - wasBounds.minX} , ${movedBounds.minY - wasBounds.minY}`);
  check('…and kept its size', near(movedBounds.maxX - movedBounds.minX, wasBounds.maxX - wasBounds.minX)
    && near(movedBounds.maxY - movedBounds.minY, wasBounds.maxY - wasBounds.minY));
  const movedAll = placementOf(movedPage);
  check('nothing else on the page moved',
    others.every(id => {
      const a = before.get(id).bounds, b = movedAll.get(id)?.bounds;
      return b && near(a.minX, b.minX) && near(a.minY, b.minY) && near(a.maxX, b.maxX) && near(a.maxY, b.maxY);
    }), others.join(','));
  check('the outline drawn while dragging is where the shape ended up',
    worstCornerDrift(movePlan[0].preview, cornersOf(movedPage, target)) < 1e-6,
    String(worstCornerDrift(movePlan[0].preview, cornersOf(movedPage, target))));

  // Moving back returns it, which is the same statement made twice but is the
  // one an undo depends on.
  const backPlan = planMoveShapes(movedPage, [target], -DX, -DY);
  const { buffer: back } = await transformVsdxShapes(moved, page.id, backPlan);
  check('moving it back returns it to where it was',
    worstCornerDrift(cornersOf(await loadPage(back, page.id), target), cornersOf(page, target)) < 1e-6);

  // --- Rotate ---------------------------------------------------------------
  let turningBuffer = original;
  let turningPage = page;
  for (let quarter = 0; quarter < 4; quarter++) {
    const plan = planRotateShapes(turningPage, [target], Math.PI / 2);
    turningBuffer = (await transformVsdxShapes(turningBuffer, page.id, plan)).buffer;
    turningPage = await loadPage(turningBuffer, page.id);
  }
  check('four quarter turns come back to exactly where it started',
    worstCornerDrift(cornersOf(turningPage, target), cornersOf(page, target)) < 1e-6,
    String(worstCornerDrift(cornersOf(turningPage, target), cornersOf(page, target))));

  const quarterPlan = planRotateShapes(page, [target], Math.PI / 2);
  const quarterPage = await loadPage((await transformVsdxShapes(original, page.id, quarterPlan)).buffer, page.id);
  const qb = boundsOf(quarterPage, target);
  check('a quarter turn swaps the shape\'s width and height on the page',
    near(qb.maxX - qb.minX, wasBounds.maxY - wasBounds.minY, 1e-6)
    && near(qb.maxY - qb.minY, wasBounds.maxX - wasBounds.minX, 1e-6),
    `${qb.maxX - qb.minX} × ${qb.maxY - qb.minY} vs ${wasBounds.maxX - wasBounds.minX} × ${wasBounds.maxY - wasBounds.minY}`);
  check('turning it does not move it off its pin',
    worstCornerDrift(quarterPlan[0].preview, cornersOf(quarterPage, target)) < 1e-6);

  // --- Resize ---------------------------------------------------------------
  // Drag the bottom-right handle out to a point, and the top-left corner must
  // not budge. Local px run down the page, so the shape's own "se" is whichever
  // corner that is once the rotation and the flips have had their say.
  const targetShape = before.get(target).shape;
  const grow = { x: wasBounds.maxX + 0.5, y: wasBounds.minY - 0.5 };
  const resizePlan = planResizeShape(page, target, 'se', grow.x, grow.y);
  const { buffer: resized } = await transformVsdxShapes(original, page.id,
    [{ id: resizePlan.id, cells: resizePlan.cells }, ...resizePlan.children]);
  const resizedPage = await loadPage(resized, page.id);
  const resizedShape = placementOf(resizedPage).get(target).shape;
  check('resizing changed the shape\'s own Width and Height',
    !near(resizedShape.width, targetShape.width, 1e-9) || !near(resizedShape.height, targetShape.height, 1e-9),
    `${resizedShape.width} × ${resizedShape.height} vs ${targetShape.width} × ${targetShape.height}`);
  check('…and it is still a real size', resizedShape.width > 0 && resizedShape.height > 0);

  // The anchor is the shape's own opposite corner, which is corner 0 of the
  // local box for an "se" drag.
  const cornersBefore = cornersOf(page, target);
  const cornersAfter = cornersOf(resizedPage, target);
  check('the corner opposite the handle stayed exactly where it was',
    Math.hypot(cornersBefore[0].x - cornersAfter[0].x, cornersBefore[0].y - cornersAfter[0].y) < 1e-6,
    `${JSON.stringify(cornersBefore[0])} vs ${JSON.stringify(cornersAfter[0])}`);
  check('the outline drawn while dragging is where the shape ended up',
    worstCornerDrift(resizePlan.preview, cornersAfter) < 1e-6,
    String(worstCornerDrift(resizePlan.preview, cornersAfter)));

  // Every handle keeps *its* opposite corner still.
  for (const [handle, anchorCorner] of [['nw', 2], ['ne', 3], ['sw', 1], ['se', 0]]) {
    const plan = planResizeShape(page, target, handle, grow.x, grow.y);
    const after = await loadPage(
      (await transformVsdxShapes(original, page.id, [{ id: plan.id, cells: plan.cells }, ...plan.children])).buffer,
      page.id
    );
    const now = cornersOf(after, target);
    check(`dragging ${handle} leaves the opposite corner alone`,
      Math.hypot(cornersBefore[anchorCorner].x - now[anchorCorner].x,
        cornersBefore[anchorCorner].y - now[anchorCorner].y) < 1e-6,
      handle);
  }

  // An edge handle changes one axis and leaves the other alone.
  const eastPlan = planResizeShape(page, target, 'e', grow.x, grow.y);
  const eastPage = await loadPage(
    (await transformVsdxShapes(original, page.id, [{ id: eastPlan.id, cells: eastPlan.cells }, ...eastPlan.children])).buffer,
    page.id
  );
  check('an edge handle only changes the axis it is on',
    near(placementOf(eastPage).get(target).shape.height, targetShape.height, 1e-9),
    `${placementOf(eastPage).get(target).shape.height} vs ${targetShape.height}`);

  // A resize never touches anything that is not inside the shape.
  const eastAll = placementOf(eastPage);
  check('and never anything outside the shape',
    others.every(id => {
      const a = before.get(id).bounds, b = eastAll.get(id)?.bounds;
      return b && near(a.minX, b.minX) && near(a.minY, b.minY);
    }));
}

// ---------------------------------------------------------------------------
console.log('\ngroups take their contents with them');

{
  const original = toBuffer(readFileSync('test-files/test3_house.vsdx'));
  const page = await loadPage(original);
  const entries = collectShapeBoxes(page);
  const group = (page.shapes || []).find(shape => (shape.subShapes || []).length > 0);
  if (!group) {
    console.log('  skip — no group in this fixture');
  } else {
    const groupId = String(group.id);
    const childIds = (group.subShapes || []).map(child => String(child.id));
    const before = new Map(entries.map(entry => [entry.id, entry.bounds]));

    const movePlan = planMoveShapes(page, [groupId], 0.3, 0.2);
    const movedPage = await loadPage((await transformVsdxShapes(original, page.id, movePlan)).buffer, page.id);
    const movedAll = placementOf(movedPage);
    check('moving a group moves everything in it',
      childIds.every(id => near(movedAll.get(id).bounds.minX - before.get(id).minX, 0.3)
        && near(movedAll.get(id).bounds.minY - before.get(id).minY, 0.2)),
      childIds.join(','));
    check('…by writing one shape\'s cells, not every shape\'s',
      movePlan.length === 1, String(movePlan.length));

    // Selecting a group *and* something inside it must not move that child twice.
    const bothPlan = planMoveShapes(page, [groupId, childIds[0]], 0.3, 0.2);
    check('a group and a child of it selected together move once, not twice',
      bothPlan.length === 1 && bothPlan[0].id === groupId,
      bothPlan.map(p => p.id).join(','));

    const gb = before.get(groupId);
    const resizePlan = planResizeShape(page, groupId, 'se', gb.maxX + 1, gb.minY - 1);
    check('resizing a group comes with new cells for its children',
      resizePlan.children.length === childIds.length,
      `${resizePlan.children.length} vs ${childIds.length}`);
    const grownPage = await loadPage((await transformVsdxShapes(original, page.id,
      [{ id: resizePlan.id, cells: resizePlan.cells }, ...resizePlan.children])).buffer, page.id);
    const grownAll = placementOf(grownPage);
    const groupGrewX = (grownAll.get(groupId).bounds.maxX - grownAll.get(groupId).bounds.minX)
      / (gb.maxX - gb.minX);
    const childGrewX = childIds.map(id =>
      (grownAll.get(id).bounds.maxX - grownAll.get(id).bounds.minX)
      / (before.get(id).maxX - before.get(id).minX));
    check('a group that grows takes its contents with it rather than resizing around them',
      childGrewX.every(ratio => near(ratio, groupGrewX, 1e-6)),
      `group ×${groupGrewX} vs children ×${childGrewX.join(',')}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nwhat it refuses');

{
  const original = toBuffer(readFileSync('test-files/test4_connectors.vsdx'));
  const page = await loadPage(original);
  const id = String((page.shapes || [])[0].id);
  const fails = async (name, fn, wanted) => {
    try {
      await fn();
      check(name, false, 'no error thrown');
    } catch (err) {
      check(name, wanted.test(err.message), err.message);
    }
  };
  await fails('an unknown handle', async () => planResizeShape(page, id, 'middle', 1, 1), /handle/i);
  await fails('a shape that is not there', async () => planMoveShapes(page, ['999999'], 1, 1), /no longer on the page/i);
  await fails('an empty selection', async () => planMoveShapes(page, [], 1, 1), /nothing to move/i);
  await fails('an angle that is not a number', async () => planRotateShapes(page, [id], NaN), /not an angle/i);
  await fails('writing to a shape that is not there',
    async () => transformVsdxShapes(original, page.id, [{ id: '999999', cells: { pinX: 1, pinY: 1 } }]),
    /could not find shape/i);

  const connector = (page.shapes || []).find(shape => rendersAsFlatConnector(shape));
  if (connector) {
    await fails('a connector, which is drawn between its ends rather than placed',
      async () => planMoveShapes(page, [String(connector.id)], 1, 1), /connector/i);
  } else {
    console.log('  skip — no flat connector in this fixture');
  }
}

console.log(`\ntransform: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
