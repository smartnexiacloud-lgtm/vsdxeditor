// Module-level round-trip for named view templates: parse a real .vsdx, build
// per-page visibility snapshots, save them via saveVsdxLayerPermissions, then
// (a) re-parse and assert the templates come back deep-equal, and (b) assert
// the raw package carries the Visio Solution XML part + `solutionxml`
// relationship — the wiring proven to survive a Microsoft Visio round-trip
// (see docs/visio-roundtrip.md).
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
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-views-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'));
const parser = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { parseVsdx, saveVsdxLayerPermissions, readVsdxViewTemplates } = parser;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── view-template round-trip: ${fixture} ──`);

const src = readFileSync(fixture);
const parsed = await parseVsdx(src);
check('fresh file has no view templates', Array.isArray(parsed.viewTemplates) && parsed.viewTemplates.length === 0);

// Build two views: "All on" (every layer visible) and "Hide connectors"
// (every layer named "Connector" hidden), captured per page.
const snapshot = (mut) => parsed.pages
  .filter(p => (p.layers || []).length)
  .map(p => ({
    id: String(p.id),
    name: p.name || '',
    layers: p.layers.map(l => ({ name: l.name, visible: mut(l) })),
  }));
const views = [
  { name: 'All on', pages: snapshot(() => true) },
  { name: 'Hide connectors', pages: snapshot(l => l.name !== 'Connector') },
];

const saved = await saveVsdxLayerPermissions(src, parsed.pages, views);

// (a) Templates re-parse deep-equal.
const back = await readVsdxViewTemplates(saved);
check('two templates round-trip', back.length === 2, `got ${back.length}`);
check('template names preserved', JSON.stringify(back.map(v => v.name)) === JSON.stringify(['All on', 'Hide connectors']));
check('per-page layer snapshots preserved deep-equal',
  JSON.stringify(back) === JSON.stringify(views),
  'mismatch:\n    want ' + JSON.stringify(views) + '\n    got  ' + JSON.stringify(back));
const hideView = back.find(v => v.name === 'Hide connectors');
const anyConnectorHidden = hideView.pages.some(p => p.layers.some(l => l.name === 'Connector' && l.visible === false));
check('"Hide connectors" actually records Connector hidden', anyConnectorHidden);

// parseVsdx surfaces them too (the path the app uses on open).
const reparsed = await parseVsdx(saved);
check('parseVsdx exposes viewTemplates on reopen', (reparsed.viewTemplates || []).length === 2);

// (b) Raw package wiring that guarantees Visio survival.
const zip = await JSZip.loadAsync(saved);
check('solution XML part present', !!zip.file('visio/solutions/vsdxeditor-views.xml'));
const rels = await zip.file('visio/_rels/document.xml.rels').async('string');
check('solutionxml relationship present',
  rels.includes('http://schemas.microsoft.com/visio/2010/relationships/solutionxml')
  && rels.includes('solutions/vsdxeditor-views.xml'));

// (c) Deleting all views removes the part + relationship (clean package).
const cleared = await saveVsdxLayerPermissions(saved, reparsed.pages, []);
const zip2 = await JSZip.loadAsync(cleared);
check('clearing views removes the solution part', !zip2.file('visio/solutions/vsdxeditor-views.xml'));
const rels2 = await zip2.file('visio/_rels/document.xml.rels').async('string');
check('clearing views removes the relationship', !rels2.includes('solutions/vsdxeditor-views.xml'));

// (d) A save that does NOT pass viewTemplates must not disturb existing views.
const untouched = await saveVsdxLayerPermissions(saved, reparsed.pages);
check('omitting the arg preserves existing views', (await readVsdxViewTemplates(untouched)).length === 2);

console.log(`\nview-templates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
