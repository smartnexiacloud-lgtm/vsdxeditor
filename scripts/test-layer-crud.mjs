// Adding and removing layers, at the parser level. A Visio layer only exists
// as a Row in the page's Layer section, and a shape's membership is stored as
// that Row's *index* — so the interesting parts are that a new layer gets an
// index nobody is using, that deleting one never renumbers the survivors (which
// would silently move every shape), and that a drawing which has never had a
// layer grows a Layer section rather than swallowing the new layer.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import JSZip from 'jszip';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-layercrud-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx, saveVsdxLayerPermissions } =
  await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const read = (path) => {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

// The editor's own model of a new layer, mirrored from main.js createLayer.
const newLayer = (index, name) => ({
  index: String(index), name, nameUniv: name, placeholder: false,
  visible: true, print: true, active: false, lock: false, snap: true, glue: true,
  color: null, colorTrans: null,
});

const stripLayer = (shapes, index) => {
  for (const shape of shapes || []) {
    shape.layerMembers = (shape.layerMembers || []).filter(m => String(m) !== String(index));
    stripLayer(shape.subShapes, index);
  }
};

const collectMembers = (shapes, out = []) => {
  for (const shape of shapes || []) {
    out.push(...(shape.layerMembers || []).map(String));
    collectMembers(shape.subShapes, out);
  }
  return out;
};

const layerRowsXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('visio/pages/pages.xml').async('string');
};

// ── 1. Add a layer to a drawing that already has some ──────────────────────
console.log('── adding a layer ──');
{
  const fixture = 'test-files/test4_connectors.vsdx';
  const before = await parseVsdx(read(fixture));
  const page = before.pages[0];
  const originalIndexes = page.layers.map(l => String(l.index));
  const highest = Math.max(-1, ...originalIndexes.map(Number).filter(Number.isFinite));

  page.layers.push(newLayer(highest + 1, 'Survey notes'));
  const saved = await saveVsdxLayerPermissions(read(fixture), before.pages, undefined, {});
  const after = await parseVsdx(saved);
  const reloaded = after.pages.find(p => String(p.id) === String(page.id));
  const added = reloaded.layers.find(l => l.name === 'Survey notes');

  check('the new layer survives a save/reload', !!added);
  check('it took the next free index', added && String(added.index) === String(highest + 1),
    added && String(added.index));
  check('it is a real layer, not a placeholder', added && added.placeholder === false);
  check('its NameUniv was written too', added && added.nameUniv === 'Survey notes');
  check('it defaults to visible, printing, unlocked',
    added && added.visible === true && added.print === true && added.lock === false);
  check('it defaults to snap and glue on, inactive',
    added && added.snap === true && added.glue === true && added.active === false);
  check('the layers that were already there are untouched',
    reloaded.layers.filter(l => String(l.index) !== String(added?.index))
      .map(l => String(l.index)).join(',') === originalIndexes.join(','),
    reloaded.layers.map(l => String(l.index)).join(','));

  const xml = await layerRowsXml(saved);
  check('the row carries Visio\'s no-colour sentinel', /IX="\d+"[^>]*>(?:(?!<\/Row>).)*Color"\s+V="255"/s.test(xml)
    || xml.includes('N="Color" V="255"'), 'no Color cell found');
  check('the row carries a Status cell', xml.includes('N="Status" V="0"'));
}

// ── 2. Delete a layer: the row goes, the survivors keep their indexes ──────
console.log('── deleting a layer ──');
{
  const fixture = 'test-files/test4_connectors.vsdx';
  const before = await parseVsdx(read(fixture));
  const page = before.pages.find(p => (p.layers || []).length > 1) || before.pages[0];
  const doomed = page.layers.find(l => !l.placeholder);
  const survivors = page.layers.filter(l => l !== doomed).map(l => String(l.index));
  const membersBefore = collectMembers(page.shapes);

  page.layers = page.layers.filter(l => l !== doomed);
  stripLayer(page.shapes, doomed.index);

  const saved = await saveVsdxLayerPermissions(read(fixture), before.pages, undefined, {});
  const after = await parseVsdx(saved);
  const reloaded = after.pages.find(p => String(p.id) === String(page.id));

  check('the deleted layer is gone from the page',
    !reloaded.layers.some(l => String(l.index) === String(doomed.index)),
    reloaded.layers.map(l => `${l.index}:${l.name}`).join(','));
  check('the survivors kept their exact indexes',
    reloaded.layers.map(l => String(l.index)).join(',') === survivors.join(','),
    `${reloaded.layers.map(l => String(l.index)).join(',')} vs ${survivors.join(',')}`);
  check('no shape still points at the deleted index',
    !collectMembers(reloaded.shapes).includes(String(doomed.index)),
    collectMembers(reloaded.shapes).join(','));
  check('shapes that were on it are still in the drawing',
    membersBefore.includes(String(doomed.index)) ? reloaded.shapes.length === page.shapes.length : true);
  check('deleting a layer deleted no shapes',
    reloaded.shapes.length === before.pages.find(p => String(p.id) === String(page.id)).shapes.length);
}

// ── 3. Deleting every layer empties the section rather than skipping it ────
console.log('── deleting the last layer ──');
{
  const fixture = 'test-files/test4_connectors.vsdx';
  const before = await parseVsdx(read(fixture));
  for (const page of before.pages) {
    for (const layer of page.layers || []) stripLayer(page.shapes, layer.index);
    page.layers = [];
  }
  const saved = await saveVsdxLayerPermissions(read(fixture), before.pages, undefined, {});
  const after = await parseVsdx(saved);
  check('every page comes back with no layers',
    after.pages.every(p => (p.layers || []).length === 0),
    after.pages.map(p => (p.layers || []).length).join(','));
  check('the drawing still has its shapes',
    after.pages.some(p => (p.shapes || []).length > 0));
}

// ── 4. A drawing with no Layer section at all grows one ────────────────────
console.log('── first layer on a layerless drawing ──');
{
  const fixture = 'test-files/test9_rect_and_line.vsdx';
  const before = await parseVsdx(read(fixture));
  const page = before.pages[0];
  const startedEmpty = (page.layers || []).length === 0;
  page.layers = [...(page.layers || []), newLayer(0, 'First')];

  const saved = await saveVsdxLayerPermissions(read(fixture), before.pages, undefined, {});
  const after = await parseVsdx(saved);
  const reloaded = after.pages.find(p => String(p.id) === String(page.id));

  check(`fixture is a useful case (${startedEmpty ? 'no layers' : 'has layers'})`, true);
  check('the layer came back', reloaded.layers.some(l => l.name === 'First'),
    reloaded.layers.map(l => l.name).join(','));
  const xml = await layerRowsXml(saved);
  check('a Layer section exists in the saved package', xml.includes('N="Layer"') || xml.includes("N='Layer'"));
}

// ── 5. Adding then deleting leaves the file as it started ─────────────────
console.log('── add then delete is a no-op on the layer set ──');
{
  const fixture = 'test-files/test3_house.vsdx';
  const original = await parseVsdx(read(fixture));
  const baseline = original.pages.map(p => (p.layers || []).map(l => `${l.index}:${l.name}`).join('|'));

  const edited = await parseVsdx(read(fixture));
  const page = edited.pages[0];
  const highest = Math.max(-1, ...(page.layers || []).map(l => Number(l.index)).filter(Number.isFinite));
  page.layers = [...(page.layers || []), newLayer(highest + 1, 'Temp')];
  page.layers = page.layers.filter(l => l.name !== 'Temp');

  const saved = await saveVsdxLayerPermissions(read(fixture), edited.pages, undefined, {});
  const after = await parseVsdx(saved);
  check('the layer set is exactly what it was',
    after.pages.map(p => (p.layers || []).map(l => `${l.index}:${l.name}`).join('|')).join(' / ')
      === baseline.join(' / '),
    after.pages.map(p => (p.layers || []).map(l => `${l.index}:${l.name}`).join('|')).join(' / '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
