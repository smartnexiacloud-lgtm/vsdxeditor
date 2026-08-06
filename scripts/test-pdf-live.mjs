// Live PDF export check. NOT part of `npm test` — it needs the internet.
//
// Two things only a real download can tell us:
//
//  1. Whether the SHA-256 digests pinned in src/pdf-export.js still match what
//     the CDN publishes. If npm or jsdelivr ever republishes those versions,
//     PDF export stops working for every user, and this is how we find out
//     first rather than from a bug report.
//  2. Whether the real jsPDF + svg2pdf.js actually turn one of this app's
//     rendered drawings into a valid PDF of the size we asked for.
//
// jsdom has no layout engine, so getBBox is stubbed below and the *text
// metrics* in the PDF this produces are fabricated. Everything structural —
// the hash gate accepting real bytes, the UMD globals wiring up, jsPDF#svg
// existing, the page geometry, the file being a well-formed PDF — is real.
// Visual fidelity still needs a browser.
//
//   node scripts/test-pdf-live.mjs
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync, mkdtempSync, rmSync, cpSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { webcrypto } from 'crypto';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}

console.log('── live PDF export (needs network) ──');

// Bail out politely when there is no network, so this is safe to run anywhere.
try {
  const probe = await fetch('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/package.json', { method: 'HEAD' });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (e) {
  console.log(`  SKIP — no network access (${e.message})`);
  process.exit(0);
}

const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.__captured = [];
    window.URL.createObjectURL = (b) => { window.__captured.push(b); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
    // jsdom ships neither fetch nor SubtleCrypto; a browser on https:// or
    // localhost has both. This one really does hit the network — that is the
    // point of this test.
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
    window.fetch = (...args) => fetch(...args);
  },
});
const { window } = dom;
window.HTMLAnchorElement.prototype.click = function () {};
const origAB = window.Blob.prototype.arrayBuffer;
window.Blob.prototype.arrayBuffer = async function () {
  const src = new Uint8Array(await origAB.call(this));
  const dst = new window.Uint8Array(src.length);
  dst.set(src);
  return dst.buffer;
};

// The stub layout engine. svg2pdf measures every text run to place it; jsdom
// answers nothing, so glyphs get a plausible constant advance. This is the one
// part of the output that is not faithful.
window.SVGElement.prototype.getBBox = function () {
  const size = parseFloat(window.getComputedStyle(this).fontSize) || 16;
  return { x: 0, y: 0, width: (this.textContent || '').length * size * 0.5, height: size };
};
window.SVGElement.prototype.getComputedTextLength = function () { return this.getBBox().width; };

const scriptEl = window.document.createElement('script');
scriptEl.textContent = bundle;
window.document.body.appendChild(scriptEl);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);
const fire = (el, t) => el.dispatchEvent(new window.Event(t, { bubbles: true }));
const waitFor = async (done, ms = 180000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (done()) return true; await sleep(25); }
  return false;
};

// 1. The pinned digests, against what the CDN serves right now. src/*.js is
// ESM in a CommonJS package, so it is imported through a type:module copy —
// the same trick the other unit tests use.
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-pdflive-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
const { PINNED_LIBS } = await import(pathToFileURL(join(tmp, 'pdf-export.js')));
for (const lib of PINNED_LIBS) {
  const bytes = new Uint8Array(await (await fetch(lib.url)).arrayBuffer());
  const hex = [...new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  check(`${lib.name} ${lib.version} on the CDN still matches its pinned digest`,
    hex === lib.sha256, `served ${hex}, pinned ${lib.sha256}`);
}

// 2. A real export, end to end.
const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
const ev = new window.Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(ev, 'dataTransfer', {
  value: { files: [new window.File([new Uint8Array(readFileSync(fixture))], 'live.vsdx')] },
});
$('drop-zone').dispatchEvent(ev);
await waitFor(() => window.document.querySelector('#svg-container svg'));
check('the drawing rendered', !!window.document.querySelector('#svg-container svg'));

$('btn-export').click();
$('export-format').value = 'pdf';
fire($('export-format'), 'change');
$('export-pdf-consent').checked = true;
fire($('export-pdf-consent'), 'change');
$('export-run').click();

const gotPdf = await waitFor(() =>
  window.__captured.some(b => b.type === 'application/pdf') ||
  ($('export-status').classList.contains('error') && $('export-status').textContent));

const pdfBlob = window.__captured.find(b => b.type === 'application/pdf');
check('the real libraries produced a PDF download', !!pdfBlob,
  `status: ${$('export-status').textContent.slice(0, 300)}`);

if (pdfBlob) {
  const buf = Buffer.from(await pdfBlob.arrayBuffer());
  check('it is a well-formed PDF file',
    buf.subarray(0, 5).toString('latin1') === '%PDF-' && buf.subarray(-1024).includes(Buffer.from('%%EOF')),
    buf.subarray(0, 8).toString('latin1'));
  check('it is not an empty shell', buf.length > 2000, `${buf.length} bytes`);

  // The drawing was an A4 Visio page, so at original size the PDF page must
  // come out A4 (595.28 × 841.89 pt) — proof the px→pt conversion is right.
  const media = /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/.exec(buf.toString('latin1'));
  const svg = window.document.querySelector('#svg-container svg');
  const [, , vbW, vbH] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
  const expectW = (vbW * 72) / 96, expectH = (vbH * 72) / 96;
  check('the page is exactly the drawing at its true physical size',
    media && Math.abs(Number(media[3]) - expectW) < 0.5 && Math.abs(Number(media[4]) - expectH) < 0.5,
    media ? `${media[3]} × ${media[4]}pt, expected ${expectW.toFixed(2)} × ${expectH.toFixed(2)}pt` : 'no /MediaBox found');
  console.log(`     ${buf.length} bytes, page ${media?.[3]} × ${media?.[4]}pt`);
  // PDF_OUT=out.pdf keeps the file, for when you want to open it and look.
  if (process.env.PDF_OUT) {
    writeFileSync(process.env.PDF_OUT, buf);
    console.log(`     wrote ${process.env.PDF_OUT}`);
  }
} else if (!gotPdf) {
  check('the export finished at all', false, 'timed out');
}

// 3. The libraries are cached for the rest of the session.
check('the download gate disappears once the libraries are loaded',
  window.jspdf && $('export-pdf-gate').hidden === true, `jspdf=${!!window.jspdf}`);

console.log(`\npdf-live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
