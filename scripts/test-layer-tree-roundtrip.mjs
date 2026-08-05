// Module-level round-trip for the layer folder settings: which delimiter a
// drawing's layer names use is a fact about the drawing, so it is written into
// the package rather than kept in one browser. This test saves the settings,
// re-parses them, and checks the raw wiring (Solution XML part + `solutionxml`
// relationship) that makes them survive a Microsoft Visio open+save — the same
// channel the named views and layer tags ride (see docs/visio-roundtrip.md).
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import JSZip from 'jszip';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node'])
  globalThis[k] = dom.window[k];

// src/ modules are ESM but the package is commonjs; copy into a tmp
// "type: module" dir (same trick as the other tests).
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-tree-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'));
const parser = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const {
  parseVsdx, saveVsdxLayerPermissions, readVsdxLayerTree,
  sanitizeLayerTreeSettings, DEFAULT_LAYER_DELIMITER,
} = parser;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── layer-tree settings round-trip: ${fixture} ──`);

// --- The sanitizer ---------------------------------------------------------
check('the default delimiter is /', DEFAULT_LAYER_DELIMITER === '/');
const clean = sanitizeLayerTreeSettings({ enabled: true, delimiter: '::', collapsed: ['A', 'A', '', 'A::B'] });
check('settings survive sanitizing', clean.enabled === true && clean.delimiter === '::');
check('collapsed keys are de-duplicated and blanks dropped',
  JSON.stringify(clean.collapsed) === JSON.stringify(['A', 'A::B']), JSON.stringify(clean.collapsed));
check('a missing delimiter falls back to the default',
  sanitizeLayerTreeSettings({ enabled: true }).delimiter === '/');
check('grouping on an empty delimiter is not grouping',
  sanitizeLayerTreeSettings({ enabled: true, delimiter: '' }).enabled === false);
check('an over-long delimiter is cut to a separator',
  sanitizeLayerTreeSettings({ delimiter: '----------' }).delimiter.length === 4);
check('garbage collapse lists are ignored',
  JSON.stringify(sanitizeLayerTreeSettings({ collapsed: 'nope' }).collapsed) === '[]');

// --- Round-trip through the package ---------------------------------------
const src = readFileSync(fixture);
const parsed = await parseVsdx(src);
check('a fresh file carries no layer-tree settings', parsed.layerTree === null,
  JSON.stringify(parsed.layerTree));

const settings = { enabled: true, delimiter: '/', collapsed: ['Electrical', 'Electrical/HV'] };
const saved = await saveVsdxLayerPermissions(src, parsed.pages, undefined, undefined, settings);

const back = await readVsdxLayerTree(saved);
check('the settings come back deep-equal',
  JSON.stringify(back) === JSON.stringify(sanitizeLayerTreeSettings(settings)),
  `want ${JSON.stringify(settings)} got ${JSON.stringify(back)}`);

const reparsed = await parseVsdx(saved);
check('parseVsdx exposes them on reopen (the path the app uses)',
  reparsed.layerTree?.enabled === true && reparsed.layerTree.delimiter === '/');
check('and remembers which groups were collapsed',
  JSON.stringify(reparsed.layerTree.collapsed) === JSON.stringify(settings.collapsed));

// --- Raw package wiring that guarantees Visio survival ---------------------
const zip = await JSZip.loadAsync(saved);
check('solution XML part present', !!zip.file('visio/solutions/vsdxeditor-layer-tree.xml'));
const partXml = await zip.file('visio/solutions/vsdxeditor-layer-tree.xml').async('string');
check('it is a base64 SolutionXML part like the others',
  partXml.includes('<SolutionXML') && partXml.includes('encoding="base64"'), partXml.slice(0, 120));
const rels = await zip.file('visio/_rels/document.xml.rels').async('string');
check('solutionxml relationship present',
  rels.includes('http://schemas.microsoft.com/visio/2010/relationships/solutionxml')
  && rels.includes('solutions/vsdxeditor-layer-tree.xml'));

// --- Saying nothing leaves no part behind ----------------------------------
const cleared = await saveVsdxLayerPermissions(saved, reparsed.pages, undefined, undefined,
  { enabled: false, delimiter: DEFAULT_LAYER_DELIMITER, collapsed: [] });
const zip2 = await JSZip.loadAsync(cleared);
check('turning grouping back off removes the part',
  !zip2.file('visio/solutions/vsdxeditor-layer-tree.xml'));
const rels2 = await zip2.file('visio/_rels/document.xml.rels').async('string');
check('and removes the relationship', !rels2.includes('solutions/vsdxeditor-layer-tree.xml'));

// A non-default delimiter is worth keeping even with grouping switched off:
// it is the drawing's naming convention, not a toggle.
const offButDelimited = await saveVsdxLayerPermissions(saved, reparsed.pages, undefined, undefined,
  { enabled: false, delimiter: '.', collapsed: [] });
const kept = await readVsdxLayerTree(offButDelimited);
check('a non-default delimiter is kept even with grouping off',
  kept?.enabled === false && kept?.delimiter === '.', JSON.stringify(kept));

// --- Other save paths must not disturb them -------------------------------
const untouched = await saveVsdxLayerPermissions(saved, reparsed.pages);
check('omitting the arg preserves the stored settings',
  (await readVsdxLayerTree(untouched))?.enabled === true);

console.log(`\nlayer-tree-roundtrip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
