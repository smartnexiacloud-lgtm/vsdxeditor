// Module-level round-trip for layer tags + tag colours: parse a real .vsdx,
// tag some layers, save, and assert (a) the tags/colours come back on re-parse,
// (b) the package carries the Visio Solution XML part + `solutionxml`
// relationship, (c) they survive a simulated Microsoft Visio re-save — the
// package rebuilt with only the parts reachable from a relationship, which is
// the rule established in docs/visio-roundtrip.md — and (d) other save paths
// (prune/export) don't drop them.
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
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-tags-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'));
const parser = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const {
  parseVsdx, saveVsdxLayerPermissions, saveVsdxWithoutHiddenLayers,
  readVsdxLayerTags, normalizeLayerTags, normalizeTagColor,
} = parser;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

const SOLUTION_REL_TYPE = 'http://schemas.microsoft.com/visio/2010/relationships/solutionxml';
const TAGS_PART = 'visio/solutions/vsdxeditor-layer-tags.xml';

// Visio rebuilds the package from its in-memory document on save: parts that no
// relationship points at are dropped, everything reachable (including the
// Solution XML store) is kept. Rebuilding the zip under that rule is a cheap
// stand-in for the real desktop round-trip.
async function simulateVisioResave(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const reachable = new Set(['[Content_Types].xml']);
  const relsPaths = Object.entries(zip.files)
    .filter(([path, entry]) => !entry.dir && /_rels\/[^/]+\.rels$/.test(path))
    .map(([path]) => path);
  for (const relsPath of relsPaths) {
    reachable.add(relsPath);
    const base = relsPath.replace(/_rels\/([^/]*)\.rels$/, '$1');
    reachable.add(base.replace(/\/$/, ''));
    const xml = await zip.file(relsPath).async('string');
    for (const target of [...xml.matchAll(/Target="([^"]+)"/g)].map(m => m[1])) {
      if (/^https?:/i.test(target)) continue;
      const dir = relsPath.replace(/_rels\/[^/]*\.rels$/, '');
      reachable.add(new URL(target, 'file:///' + dir).pathname.slice(1));
    }
  }
  const out = new JSZip();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!reachable.has(path)) continue;                     // dropped, like Visio does
    out.file(path, await entry.async('uint8array'));
  }
  return out.generateAsync({ type: 'arraybuffer' });
}

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── layer-tag round-trip: ${fixture} ──`);

// Normalization is the contract the UI leans on (comma-splitting, trimming,
// case-insensitive de-duplication).
check('tags split on commas and trim', JSON.stringify(normalizeLayerTags(' a , b ')) === '["a","b"]');
check('tags de-duplicate case-insensitively', JSON.stringify(normalizeLayerTags(['Draft', 'draft'])) === '["Draft"]');
check('blank tags are dropped', JSON.stringify(normalizeLayerTags(',, ,')) === '[]');
check('#abc colours expand to #aabbcc', normalizeTagColor('#abc') === '#aabbcc');
check('non-colours are rejected', normalizeTagColor('rebeccapurple') === null);

const src = readFileSync(fixture);
const parsed = await parseVsdx(src);
check('fresh file has no layer tags', Array.isArray(parsed.layerTags) && parsed.layerTags.length === 0);

const taggable = parsed.pages
  .flatMap(page => (page.layers || []).map(layer => ({ page, layer })))
  .filter(({ layer }) => String(layer.name || '').trim());
if (!taggable.length) {
  console.error(`fixture ${fixture} has no named layers to tag`);
  process.exit(1);
}
const first = taggable[0];
first.layer.tags = ['electrical', 'as-built'];
const tagColors = { electrical: '#ff8800', 'as-built': '#3366CC' };

const saved = await saveVsdxLayerPermissions(src, parsed.pages, undefined, tagColors);

// (a) Tags and colours re-parse.
const back = await readVsdxLayerTags(saved);
const savedLayer = back.pages.flatMap(p => p.layers).find(l => l.name === first.layer.name);
check('tags round-trip through the package',
  JSON.stringify(savedLayer?.tags) === JSON.stringify(['electrical', 'as-built']),
  `got ${JSON.stringify(savedLayer)}`);
check('tag colours round-trip (and normalize to lowercase hex)',
  back.tagColors.electrical === '#ff8800' && back.tagColors['as-built'] === '#3366cc',
  JSON.stringify(back.tagColors));

const reparsed = await parseVsdx(saved);
const reparsedLayer = reparsed.pages
  .flatMap(p => p.layers || [])
  .find(l => l.name === first.layer.name);
check('parseVsdx hangs tags back on the layer objects',
  JSON.stringify(reparsedLayer?.tags) === JSON.stringify(['electrical', 'as-built']),
  JSON.stringify(reparsedLayer?.tags));
check('parseVsdx exposes the tag palette', reparsed.layerTagColors?.electrical === '#ff8800');
check('untagged layers stay untagged',
  reparsed.pages.flatMap(p => p.layers || []).filter(l => l.tags).length === 1);

// (b) Raw package wiring that guarantees Visio survival.
const zip = await JSZip.loadAsync(saved);
check('solution XML part present', !!zip.file(TAGS_PART));
const rels = await zip.file('visio/_rels/document.xml.rels').async('string');
check('solutionxml relationship present',
  rels.includes(SOLUTION_REL_TYPE) && rels.includes('solutions/vsdxeditor-layer-tags.xml'));
const partXml = await zip.file(TAGS_PART).async('string');
check('payload is base64 in a <SolutionXML> element',
  /<SolutionXML[^>]*encoding="base64"[^>]*>[A-Za-z0-9+/=\s]+<\/SolutionXML>/.test(partXml));

// (c) Survives a Visio-style rebuild that keeps only reachable parts.
const resaved = await simulateVisioResave(saved);
const afterVisio = await readVsdxLayerTags(resaved);
check('tags survive a simulated Visio re-save',
  JSON.stringify(afterVisio.pages) === JSON.stringify(back.pages));
check('tag colours survive a simulated Visio re-save',
  JSON.stringify(afterVisio.tagColors) === JSON.stringify(back.tagColors));

// (d) Other save paths keep them. Saving without passing colours must preserve
// the palette already in the file.
const untouched = await saveVsdxLayerPermissions(saved, reparsed.pages, undefined);
const untouchedTags = await readVsdxLayerTags(untouched);
check('omitting the colour arg preserves the stored palette',
  JSON.stringify(untouchedTags.tagColors) === JSON.stringify(back.tagColors),
  JSON.stringify(untouchedTags.tagColors));
check('re-saving preserves the tags', JSON.stringify(untouchedTags.pages) === JSON.stringify(back.pages));

const prunePage = reparsed.pages.find(p => String(p.id) === String(first.page.id));
const pruned = await saveVsdxWithoutHiddenLayers(saved, reparsed.pages, prunePage.id, new Set());
const prunedTags = await readVsdxLayerTags(pruned.buffer || pruned);
check('pruning keeps the tags of surviving layers',
  prunedTags.pages.flatMap(p => p.layers).some(l => l.name === first.layer.name),
  JSON.stringify(prunedTags.pages));

// (e) Clearing every tag removes the part and its relationship again.
for (const layer of reparsed.pages.flatMap(p => p.layers || [])) delete layer.tags;
const cleared = await saveVsdxLayerPermissions(saved, reparsed.pages, undefined, {});
const zip2 = await JSZip.loadAsync(cleared);
check('clearing tags removes the solution part', !zip2.file(TAGS_PART));
const rels2 = await zip2.file('visio/_rels/document.xml.rels').async('string');
check('clearing tags removes the relationship', !rels2.includes('solutions/vsdxeditor-layer-tags.xml'));

console.log(`\nlayer-tags: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
