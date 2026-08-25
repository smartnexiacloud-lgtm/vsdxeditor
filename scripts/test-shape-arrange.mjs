// Grouping, ungrouping and z-order, checked against real drawings.
//
// The one thing that must be true of group and ungroup is that *nothing moves*:
// a shape's PinX/PinY are in its parent's coordinates, so changing its parent
// has to change those numbers by exactly the right amount or the drawing comes
// apart. So this test records where every shape is before the operation, does
// it for real (rewriting the .vsdx and parsing it back), and checks every shape
// is still drawn in the same place — matrix and bounding box both.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-arrange-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx, groupVsdxShapes, ungroupVsdxShapes, reorderVsdxShapes } =
  await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { collectShapeBoxes } = await import(pathToFileURL(join(tmp, 'shape-picker.js')));
const { rendersAsFlatConnector } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));
const { planGroupShapes, planUngroupShape, cellsForNewParent, inheritsFromMaster } =
  await import(pathToFileURL(join(tmp, 'shape-arrange.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const loadPage = async (buffer, pageId = null) => {
  const parsed = await parseVsdx(buffer);
  const page = pageId === null
    ? (parsed.pages.find(p => !p.isBackground) || parsed.pages[0])
    : parsed.pages.find(p => String(p.id) === String(pageId));
  return page;
};

// Where every shape is drawn, keyed by ID: the composed matrix (what the
// renderer will use) and the page-space box (what the eye sees).
const placementOf = (page) => {
  const map = new Map();
  for (const entry of collectShapeBoxes(page)) {
    map.set(entry.id, { matrix: entry.matrix, bounds: entry.bounds, depth: entry.depth, order: entry.order });
  }
  return map;
};

const worstDrift = (before, after, ids) => {
  let worst = 0;
  for (const id of ids) {
    const a = before.get(id), b = after.get(id);
    if (!a || !b) return Infinity;
    for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
      worst = Math.max(worst, Math.abs(a.bounds[key] - b.bounds[key]));
    }
    for (let i = 0; i < 6; i++) worst = Math.max(worst, Math.abs(a.matrix[i] - b.matrix[i]) / (i < 4 ? 1 : 96));
  }
  return worst;
};

const topLevelIds = (page) => (page.shapes || []).map(shape => String(shape.id));
const groupable = (page) => (page.shapes || [])
  .filter(shape => !rendersAsFlatConnector(shape))
  .map(shape => String(shape.id));

// A drift under a ten-thousandth of an inch is below anything Visio stores.
const TOLERANCE = 1e-6;

// Some of these drawings are big private samples that live beside the repo
// rather than in it (see .gitignore), so a fixture that is not here is skipped
// rather than failing the run: on a machine that has it the checks run, and on
// a machine that does not — CI, a fresh clone — the rest of the suite still does.
const FIXTURES = [
  'test-files/test4_connectors.vsdx',
  'test-files/test3_house.vsdx',
  'test-files/test9_rect_and_line.vsdx',
  'testraum mit Legende.vsdx',
].filter(existsSync);

for (const fixture of FIXTURES) {
  console.log(`\narrange: ${fixture}`);
  const original = toBuffer(readFileSync(fixture));
  const page = await loadPage(original);
  const before = placementOf(page);
  const everyId = [...before.keys()];

  const members = groupable(page).slice(0, 3);
  if (members.length < 2) {
    // Said out loud rather than skipped quietly: this fixture is a single
    // shape plus a connector, so there is nothing here to group.
    console.log(`  skip grouping — only ${members.length} groupable top-level shape(s)`);
    continue;
  }

  // --- Group ---------------------------------------------------------------
  const plan = planGroupShapes(page, members);
  check('the plan covers every member', plan.members.length === members.length);
  check('the group is a box around them all',
    plan.groupCells.width >= 0 && plan.groupCells.height >= 0
    && Math.abs(plan.groupCells.locPinX - plan.groupCells.width / 2) < 1e-12);

  const { buffer: grouped, shapeId: groupId } = await groupVsdxShapes(original, page.id, plan);
  const groupedPage = await loadPage(grouped, page.id);
  const afterGroup = placementOf(groupedPage);

  check('a new group shape exists', afterGroup.has(String(groupId)), String(groupId));
  check('the members are inside it',
    members.every(id => afterGroup.get(id)?.depth === 1), members.map(id => afterGroup.get(id)?.depth).join(','));
  check('the page has one shape where the members were',
    topLevelIds(groupedPage).length === topLevelIds(page).length - members.length + 1,
    `${topLevelIds(groupedPage).length} vs ${topLevelIds(page).length}`);
  check('grouping moved nothing on the page',
    worstDrift(before, afterGroup, everyId) < TOLERANCE,
    `worst ${worstDrift(before, afterGroup, everyId)}`);

  // --- Ungroup the group we just made --------------------------------------
  const undonePlan = planUngroupShape(groupedPage, groupId);
  check('the ungroup plan lists every child', undonePlan.children.length === members.length);
  const { buffer: undone } = await ungroupVsdxShapes(grouped, page.id, undonePlan);
  const undonePage = await loadPage(undone, page.id);
  const afterUndo = placementOf(undonePage);

  check('the group is gone', !afterUndo.has(String(groupId)));
  check('its shapes are back at the top level',
    members.every(id => afterUndo.get(id)?.depth === 0));
  check('ungrouping moved nothing on the page',
    worstDrift(before, afterUndo, everyId) < TOLERANCE,
    `worst ${worstDrift(before, afterUndo, everyId)}`);
  check('the page is the size it started',
    topLevelIds(undonePage).length === topLevelIds(page).length,
    `${topLevelIds(undonePage).length} vs ${topLevelIds(page).length}`);

  // --- Ungrouping a group the drawing already had --------------------------
  const existing = (page.shapes || []).find(shape => (shape.subShapes?.length || 0) > 0
    && !inheritsFromMaster(shape)
    && !(shape.subShapes || []).some(child => rendersAsFlatConnector(child)));
  const fromMaster = (page.shapes || []).find(shape => inheritsFromMaster(shape));
  if (fromMaster) {
    let message = '';
    try { planUngroupShape(page, fromMaster.id); } catch (e) { message = e.message; }
    check(`"${fromMaster.name || fromMaster.id}" comes from a master, so ungrouping it is refused`,
      /comes from a master/i.test(message), message || '(no error)');
  }
  if (existing) {
    const childIds = (existing.subShapes || []).map(child => String(child.id));
    const { buffer: flattened } = await ungroupVsdxShapes(
      original, page.id, planUngroupShape(page, existing.id));
    const flatPage = await loadPage(flattened, page.id);
    const afterFlatten = placementOf(flatPage);
    check(`ungrouping the drawing's own group "${existing.name || existing.id}" keeps its children put`,
      worstDrift(before, afterFlatten, childIds) < TOLERANCE,
      `worst ${worstDrift(before, afterFlatten, childIds)}`);
    check('and lifts them a level',
      childIds.every(id => afterFlatten.get(id)?.depth === (before.get(id).depth - 1)));
  }

  // --- Z-order -------------------------------------------------------------
  const first = topLevelIds(page)[0];
  const { buffer: fronted } = await reorderVsdxShapes(original, page.id, [first], 'front');
  const frontPage = await loadPage(fronted, page.id);
  check('bring to front puts the shape last in paint order',
    topLevelIds(frontPage).at(-1) === first, topLevelIds(frontPage).join(','));
  check('and leaves every shape where it was drawn',
    worstDrift(before, placementOf(frontPage), everyId) < TOLERANCE);

  const last = topLevelIds(page).at(-1);
  const { buffer: backed } = await reorderVsdxShapes(original, page.id, [last], 'back');
  const backPage = await loadPage(backed, page.id);
  check('send to back puts the shape first', topLevelIds(backPage)[0] === last, topLevelIds(backPage).join(','));
  check('the page keeps every shape it had',
    topLevelIds(backPage).length === topLevelIds(page).length);

  // Moving everything changes nothing about their order.
  const { buffer: allFront } = await reorderVsdxShapes(original, page.id, topLevelIds(page), 'front');
  check('bringing everything to the front is a no-op on the order',
    topLevelIds(await loadPage(allFront, page.id)).join(',') === topLevelIds(page).join(','));
}

// --- The refusals ----------------------------------------------------------
console.log('\narrange: what it refuses to do');
{
  const bytes = readFileSync('test-files/test4_connectors.vsdx');
  const page = await loadPage(toBuffer(bytes));
  const connector = (page.shapes || []).find(shape => rendersAsFlatConnector(shape));
  const other = (page.shapes || []).find(shape => !rendersAsFlatConnector(shape));

  const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
  check('grouping one shape is refused',
    /at least two/i.test(throws(() => planGroupShapes(page, [String(other.id)])) || ''));
  if (connector) {
    const message = throws(() => planGroupShapes(page, [String(connector.id), String(other.id)]));
    check('grouping a connector is refused, and says why',
      /connector/i.test(message || ''), String(message));
  }
  check('ungrouping something that is not a group is refused',
    /not a group/i.test(throws(() => planUngroupShape(page, String(other.id))) || ''));
  check('ungrouping a shape that is not there is refused',
    /no longer on the page/i.test(throws(() => planUngroupShape(page, '999999')) || ''));

  // The decomposition has to survive rotation and flips, which the fixtures may
  // not have: build the cases directly and check they round-trip.
  const identity = [1, 0, 0, 1, 0, 0];
  for (const shape of [
    { width: 2, height: 1, locPinX: 1, locPinY: 0.5, pinX: 3, pinY: 4, angle: 0, flipX: false, flipY: false },
    { width: 2, height: 1, locPinX: 1, locPinY: 0.5, pinX: 3, pinY: 4, angle: 0.7, flipX: false, flipY: false },
    { width: 2, height: 1, locPinX: 0.3, locPinY: 0.9, pinX: 3, pinY: 4, angle: -1.2, flipX: true, flipY: false },
    { width: 2, height: 1, locPinX: 1, locPinY: 0.5, pinX: 3, pinY: 4, angle: 2.4, flipX: false, flipY: true },
    { width: 2, height: 1, locPinX: 1, locPinY: 0.5, pinX: 3, pinY: 4, angle: 1.1, flipX: true, flipY: true },
  ]) {
    // A parent that is itself moved and turned, to make the arithmetic work.
    const parent = { width: 6, height: 5, locPinX: 3, locPinY: 2.5, pinX: 4, pinY: 3, angle: 0.4, flipX: false, flipY: false };
    const { shapeLocalMatrix } = await import(pathToFileURL(join(tmp, 'shape-picker.js')));
    const mul = (m, n) => [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

    const PAGE_H = 11;
    const parentMatrix = shapeLocalMatrix(parent, PAGE_H);
    const world = mul(parentMatrix, shapeLocalMatrix(shape, parent.height));
    // Take it out of the parent and put it straight on the page…
    const onPage = cellsForNewParent(world, shape, identity, PAGE_H);
    const rebuilt = shapeLocalMatrix({ ...shape, ...onPage }, PAGE_H);
    const drift = Math.max(...world.map((v, i) => Math.abs(v - rebuilt[i])));
    check(`re-parenting a shape at angle ${shape.angle} flip ${shape.flipX ? 'X' : ''}${shape.flipY ? 'Y' : ''} is exact`,
      drift < 1e-9, `drift ${drift}`);

    // …and back into it again.
    const backIn = cellsForNewParent(world, { ...shape, ...onPage }, parentMatrix, parent.height);
    const restored = mul(parentMatrix, shapeLocalMatrix({ ...shape, ...backIn }, parent.height));
    const roundTrip = Math.max(...world.map((v, i) => Math.abs(v - restored[i])));
    check('and putting it back is exact too', roundTrip < 1e-9, `drift ${roundTrip}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
