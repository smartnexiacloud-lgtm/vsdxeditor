// Where each geometry row came from, and what is driving it.
//
// The parser used to answer only "what does this shape draw": mergeGeometry
// flattened the master's rows and the shape's own rows into one effective list
// and handed back plain numbers. That is everything the renderer needs and
// nothing an editor does. Dragging a point has to know *which* <Section
// N="Geometry" IX="…"> and *which* <Row IX="…"> to write, on whose element it
// sits — a row inherited from a master has no element on the shape at all until
// one is written — which cells that row actually carries, and whether the
// coordinate is a number someone typed or the current answer to `Width*0.5`.
//
// This test is about that metadata being right, and about it staying invisible
// to everything that only cares what the drawing looks like.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-geom-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { computeDiff } = await import(pathToFileURL(join(tmp, 'vsdx-diff.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const allShapes = (shapes, out = []) => {
  for (const shape of shapes || []) { out.push(shape); allShapes(shape.subShapes, out); }
  return out;
};
const allRows = (shape) => (shape.geometry || []).flatMap(section =>
  (section.rows || []).map(row => ({ row, section })));

const FIXTURES = [
  'test-files/test3_house.vsdx',
  'test-files/test4_connectors.vsdx',
  'test-files/test9_rect_and_line.vsdx',
  'testraum mit Legende.vsdx',
].filter(existsSync);

const SOURCES = new Set(['shape', 'master', 'override']);
let sawMaster = false, sawShape = false, sawOverride = false, sawFormula = false;

for (const fixture of FIXTURES) {
  console.log(`\ngeometry provenance: ${fixture}`);
  const parsed = await parseVsdx(toBuffer(readFileSync(fixture)));
  const shapes = parsed.pages.flatMap(page => allShapes(page.shapes));
  const withGeometry = shapes.filter(shape => (shape.geometry || []).length);
  check('the fixture has geometry to talk about', withGeometry.length > 0, String(shapes.length));

  // --- Every section says which one it is ------------------------------------
  const sections = withGeometry.flatMap(shape => shape.geometry);
  check('every geometry section carries its own IX',
    sections.every(section => section.ix !== undefined && section.ix !== null && section.ix !== ''),
    JSON.stringify(sections.find(s => !s.ix) || null));
  check('…and says whether the shape owns it or inherits it',
    sections.every(section => SOURCES.has(section.source)),
    [...new Set(sections.map(s => s.source))].join(','));

  // --- Every row says where it lives ------------------------------------------
  const rows = withGeometry.flatMap(allRows);
  check('every row says which section it belongs to',
    rows.every(({ row, section }) => row.sectionIx === section.ix),
    JSON.stringify(rows.find(({ row, section }) => row.sectionIx !== section.ix)?.row || null));
  check('every row says which document it came out of',
    rows.every(({ row }) => SOURCES.has(row.source)),
    [...new Set(rows.map(({ row }) => row.source))].join(','));
  check('every row still has the IX that identifies it in the XML',
    rows.every(({ row }) => row.ix !== undefined && row.ix !== null));
  check('every row lists the cells it actually carries',
    rows.every(({ row }) => Array.isArray(row.ownCells)),
    JSON.stringify(rows.find(({ row }) => !Array.isArray(row.ownCells))?.row || null));
  check('and every row has a formula map, even when it is empty',
    rows.every(({ row }) => row.formulas && typeof row.formulas === 'object'));

  // A row that came from the shape has to carry the cells it was read from; a
  // row the shape does not have cannot claim to.
  const shapeOwned = rows.filter(({ row }) => row.source === 'shape');
  check('a row the shape owns carries at least one cell of its own',
    shapeOwned.every(({ row }) => row.ownCells.length > 0 || row.type === 'Ellipse'),
    JSON.stringify(shapeOwned.find(({ row }) => !row.ownCells.length)?.row || null));

  // --- The coordinates still mean what they meant ----------------------------
  // Provenance is metadata; it must not have moved a single number.
  check('rows still carry the values the renderer draws from',
    rows.every(({ row }) => typeof row.type === 'string'
      && (row.x === null || Number.isFinite(row.x))
      && (row.y === null || Number.isFinite(row.y))),
    JSON.stringify(rows.find(({ row }) => typeof row.type !== 'string')?.row || null));

  for (const { row, section } of rows) {
    if (row.source === 'master') sawMaster = true;
    if (row.source === 'shape') sawShape = true;
    if (row.source === 'override') sawOverride = true;
    if (Object.keys(row.formulas).length) sawFormula = true;
    // A section the shape does not own cannot hold a row the shape does own.
    if (section.source === 'master' && row.source === 'shape') {
      check('a master-only section holds no shape-owned rows', false, JSON.stringify(row));
    }
  }
}

console.log('\nthe fixtures between them cover every case');
check('rows inherited whole from a master', sawMaster);
check('rows the shape owns outright', sawShape);
check('rows on a shape that override a master row', sawOverride,
  'no fixture has a shape row overriding a master row by IX');
check('at least one coordinate driven by a formula rather than typed', sawFormula,
  'no fixture has an F attribute on a geometry cell');

// ---------------------------------------------------------------------------
console.log('\nnone of it is a visible difference');

// A shape that inherits its outline from a master draws exactly what a shape
// with the same outline written out locally draws. The diff engine used to
// stringify the whole row object, so carrying provenance in it would have
// started reporting geometry changes between two identical drawings.
{
  const buffer = toBuffer(readFileSync(FIXTURES[0]));
  const a = await parseVsdx(buffer);
  const b = await parseVsdx(toBuffer(readFileSync(FIXTURES[0])));
  const changed = (computeDiff(a, b).pages || []).flatMap(page => page.shapes?.modified || []);
  check('a drawing compared against itself reports nothing modified',
    changed.length === 0, JSON.stringify(changed.slice(0, 3)));

  // The check above would pass whatever the hash did — both sides carry the
  // same provenance because both sides are the same file. The case that matters
  // is the same outline reached two different ways: a shape that inherits its
  // rows from a master draws exactly what a shape holding those rows locally
  // draws, and that is the pair a round-trip through this app (or through
  // Visio) can produce. Nothing here has moved, so nothing may be reported.
  const reworded = await parseVsdx(toBuffer(readFileSync(FIXTURES[0])));
  let touched = 0;
  for (const shape of allShapes(reworded.pages[0].shapes)) {
    for (const section of shape.geometry || []) {
      section.source = section.source === 'shape' ? 'master' : 'shape';
      for (const row of section.rows || []) {
        row.source = row.source === 'shape' ? 'master' : 'shape';
        row.ownCells = [];
        row.formulas = { X: 'Width*0.5' };
        touched++;
      }
    }
  }
  check('there was provenance to disturb', touched > 0, String(touched));
  const reworkedDiff = (computeDiff(a, reworded).pages || [])
    .flatMap(page => page.shapes?.modified || [])
    .filter(entry => (entry.changes || []).some(change => change.field === 'geometry'));
  check('the same outline reached a different way is not a geometry change',
    reworkedDiff.length === 0,
    `${reworkedDiff.length} shapes reported: ${reworkedDiff.slice(0, 3).map(e => e.id).join(',')}`);

  // And the hash has to still notice a real change: move one point.
  const c = await parseVsdx(toBuffer(readFileSync(FIXTURES[0])));
  const victim = allShapes(c.pages[0].shapes).find(shape =>
    (shape.geometry || []).some(section => (section.rows || []).some(row => Number.isFinite(row.x))));
  check('there is a shape with a coordinate to disturb', !!victim);
  if (victim) {
    const row = victim.geometry.flatMap(section => section.rows).find(r => Number.isFinite(r.x));
    row.x += 1;
    const modified = (computeDiff(a, c).pages || []).flatMap(page => page.shapes?.modified || []);
    const hit = modified.find(entry => String(entry.id) === String(victim.id));
    check('moving one point is still reported as a geometry change',
      !!hit && (hit.changes || []).some(change => change.field === 'geometry'),
      JSON.stringify(hit?.changes || null));
  }
}

console.log(`\ngeometry provenance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
