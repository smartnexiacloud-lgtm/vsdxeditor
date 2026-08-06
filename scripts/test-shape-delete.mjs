// Deleting shapes, checked against real drawings.
//
// Deleting is the one edit with nothing to compare afterwards, so what this
// test watches is the damage: everything that was *not* asked for has to still
// be there and still be drawn where it was, a group has to take its children
// with it, and no <Connect> may be left pointing at a shape that no longer
// exists — a dangling reference is a file Visio complains about opening.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-delete-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx, deleteVsdxShapes, groupVsdxShapes } =
  await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { collectShapeBoxes } = await import(pathToFileURL(join(tmp, 'shape-picker.js')));
const { planGroupShapes } = await import(pathToFileURL(join(tmp, 'shape-arrange.js')));

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

// Every id anywhere in the tree, not only the top level: a deleted group takes
// its children, and a surviving group must not have lost any.
const allIds = (page) => new Set(collectShapeBoxes(page).map(entry => String(entry.id)));
const boxesById = (page) => new Map(collectShapeBoxes(page).map(entry => [String(entry.id), entry.bounds]));
const drifted = (before, after, ids) => {
  let worst = 0;
  for (const id of ids) {
    const a = before.get(id), b = after.get(id);
    if (!a || !b) return Infinity;
    for (const key of ['minX', 'minY', 'maxX', 'maxY']) worst = Math.max(worst, Math.abs(a[key] - b[key]));
  }
  return worst;
};
const connectKeys = (page) => (page.connects || [])
  .map(c => `${c.fromSheet}->${c.toSheet}`).sort();

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── delete: ${fixture} ──`);

const original = toBuffer(readFileSync(fixture));
const page = await loadPage(original);
check('the fixture parsed', !!page?.shapes?.length);

// --- 1. One shape, and nothing else -----------------------------------------
const startIds = allIds(page);
const startBoxes = boxesById(page);
const victim = String(page.shapes[0].id);

const { buffer: afterOne } = await deleteVsdxShapes(original, page.id, [victim]);
const onePage = await loadPage(afterOne, page.id);
const oneIds = allIds(onePage);
check('the shape asked for is gone', !oneIds.has(victim), [...oneIds].join(','));
check('exactly one shape went', oneIds.size === startIds.size - 1, `${oneIds.size} vs ${startIds.size}`);
check('every other shape survived',
  [...startIds].filter(id => id !== victim).every(id => oneIds.has(id)), [...oneIds].join(','));
check('and none of them moved',
  drifted(startBoxes, boxesById(onePage), oneIds) < 1e-9, String(drifted(startBoxes, boxesById(onePage), oneIds)));

// --- 2. No connection is left pointing at nothing ---------------------------
const startConnects = connectKeys(page);
const hadConnects = startConnects.filter(key => key.split('->').includes(victim));
check('the fixture had a connection to the deleted shape', hadConnects.length > 0, startConnects.join(' '));
const leftDangling = (onePage.connects || [])
  .filter(c => String(c.fromSheet) === victim || String(c.toSheet) === victim);
check('connections to it were dropped with it', leftDangling.length === 0, JSON.stringify(leftDangling));
check('connections between surviving shapes were left alone',
  connectKeys(onePage).join(' ') === startConnects.filter(key => !key.split('->').includes(victim)).join(' '),
  connectKeys(onePage).join(' '));

// --- 3. A group takes what is inside it -------------------------------------
const members = page.shapes.slice(0, 2).map(shape => String(shape.id));
const { buffer: grouped, shapeId: groupId } =
  await groupVsdxShapes(original, page.id, planGroupShapes(page, members));
const groupedPage = await loadPage(grouped, page.id);
check('two shapes were grouped to set this up',
  allIds(groupedPage).has(String(groupId)) && members.every(id => allIds(groupedPage).has(id)),
  [...allIds(groupedPage)].join(','));

const { buffer: afterGroup } = await deleteVsdxShapes(grouped, page.id, [String(groupId)]);
const groupGone = await loadPage(afterGroup, page.id);
check('deleting the group removes the group', !allIds(groupGone).has(String(groupId)));
check('and every shape that was inside it', members.every(id => !allIds(groupGone).has(id)),
  [...allIds(groupGone)].join(','));
check('and nothing outside it', [...startIds].filter(id => !members.includes(id))
  .every(id => allIds(groupGone).has(id)), [...allIds(groupGone)].join(','));

// A selection can perfectly well hold a group *and* something inside it; the
// child is already gone by the time its turn comes, and that is not an error.
const { buffer: afterBoth } = await deleteVsdxShapes(grouped, page.id, [String(groupId), members[0]]);
check('deleting a group and one of its children together is not an error',
  !allIds(await loadPage(afterBoth, page.id)).has(members[0]));

// --- 4. What it refuses -----------------------------------------------------
let refusedMissing = null;
try { await deleteVsdxShapes(original, page.id, ['999999']); }
catch (e) { refusedMissing = e.message; }
check('deleting a shape that is not there is an error', !!refusedMissing, String(refusedMissing));

let refusedEmpty = null;
try { await deleteVsdxShapes(original, page.id, []); }
catch (e) { refusedEmpty = e.message; }
check('deleting nothing is an error rather than a silent rewrite', !!refusedEmpty, String(refusedEmpty));

// --- 5. Everything at once --------------------------------------------------
const { buffer: emptied } = await deleteVsdxShapes(original, page.id, page.shapes.map(s => String(s.id)));
const emptyPage = await loadPage(emptied, page.id);
check('a page can be emptied', (emptyPage?.shapes || []).length === 0,
  (emptyPage?.shapes || []).map(s => s.id).join(','));
check('and it still parses as a page', !!emptyPage && String(emptyPage.id) === String(page.id));
check('with no connections left over', (emptyPage.connects || []).length === 0,
  JSON.stringify(emptyPage.connects));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
