// Boot the REAL built app (dist/app.html + dist/main.js) in jsdom, load a
// .vsdx, and drive the export dialog the way a user would: pick a size, pick a
// format, and inspect the blob that comes back.
//
// Two things are worth proving here beyond "the maths is right" (which
// test-export-scale.mjs covers): that a rescaled SVG really does keep its
// viewBox — a rescale that quietly resampled geometry would be worse than the
// bug it fixes — and that PDF export cannot reach the network until the user
// says so, and refuses to run a library whose bytes do not match the pinned
// digest. Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';
import { webcrypto } from 'crypto';
import JSZip from 'jszip';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

// Every fetch the app attempts, so "nothing is downloaded until you allow it"
// is an assertion rather than a hope. Nothing here ever reaches the real net.
const fetches = [];
let fetchResponder = async () => { throw new Error('no responder installed'); };

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
    // jsdom ships no SubtleCrypto; a browser on https:// or localhost does.
    Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
    window.fetch = async (url, init) => { fetches.push(String(url)); return fetchResponder(String(url), init); };
  },
});
const { window } = dom;
const captured = window.__captured;
window.HTMLAnchorElement.prototype.click = function () { /* swallow navigation */ };

const origArrayBuffer = window.Blob.prototype.arrayBuffer;
window.Blob.prototype.arrayBuffer = async function () {
  const src = new Uint8Array(await origArrayBuffer.call(this));
  const dst = new window.Uint8Array(src.length);
  dst.set(src);
  return dst.buffer;
};

const scriptEl = window.document.createElement('script');
scriptEl.textContent = bundle;
window.document.body.appendChild(scriptEl);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);

const WAIT_TIMEOUT_MS = Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000;
const errorBox = () => $('error-box');
const waitFor = async (done) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (done()) return true;
    await sleep(25);
  }
  return false;
};
const whyNot = () => 'error-box: ' + (errorBox()?.textContent.trim() || `(timed out after ${WAIT_TIMEOUT_MS} ms)`);
const currentSvg = () => window.document.querySelector('#svg-container svg');
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app export dialog: ${fixture} ──`);

const dropFile = async (file) => {
  if (errorBox()) errorBox().textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  await waitFor(() => currentSvg() && currentSvg() !== previous);
};

await dropFile(new window.File([new Uint8Array(readFileSync(fixture))], 'export.vsdx'));
check('app booted and rendered the vsdx', !!currentSvg(), whyNot());

const viewBox = currentSvg().getAttribute('viewBox');
const [, , vbW, vbH] = viewBox.split(/[\s,]+/).map(Number);
console.log(`     drawing is ${vbW} × ${vbH} renderer px (${(vbW / 96).toFixed(1)} × ${(vbH / 96).toFixed(1)} in)`);

// ---------------------------------------------------------------------------
console.log('\n1. The dialog');

check('the rendered SVG has no intrinsic size — which is the bug',
  currentSvg().getAttribute('width') === '100%', currentSvg().getAttribute('width'));

check('the export dialog is closed until asked for', !$('export-modal').classList.contains('visible'));
$('btn-export').click();
check('Export… opens the dialog instead of downloading blindly',
  $('export-modal').classList.contains('visible') && captured.length === 0, `${captured.length} downloads`);
check('every size mode is offered', $('export-size').options.length === 4,
  [...$('export-size').options].map(o => o.value).join(','));
check('the size modes are the documented ones',
  [...$('export-size').options].map(o => o.value).join(',') === 'original,viewer,screen,custom');
check('a normal-sized drawing defaults to original size', $('export-size').value === 'original', $('export-size').value);
check('the summary says what will be produced', /px/.test($('export-summary').textContent), $('export-summary').textContent);
check('the custom field is hidden until custom is chosen', $('export-custom-row').hidden === true);
check('the PDF download gate is hidden for SVG export', $('export-pdf-gate').hidden === true);

// …and hidden has to mean *not on screen*. In a browser an author rule beats
// the one the browser itself has for the hidden attribute, so laying these rows
// out with `display: flex` left every row the dialog thought it had folded away
// sitting there fully usable: "Longest side" while exporting at original size,
// the PDF library consent while exporting an SVG, the SVG embed checkbox while
// exporting a PDF — each of them controlling something the chosen format has no
// use for.
//
// getComputedStyle cannot see this: jsdom gives the hidden attribute a
// precedence real browsers do not, and answers "none" either way. So the rule
// that puts it right is checked for directly.
const hiddenRules = [...window.document.styleSheets]
  .flatMap(sheet => [...sheet.cssRules])
  .filter(rule => rule.selectorText?.includes('[hidden]') && rule.style?.display === 'none')
  .map(rule => rule.selectorText)
  .join(' ');
for (const cls of ['.export-field', '.export-check', '.export-gate']) {
  check(`${cls} rows stay laid out but go when hidden`, hiddenRules.includes(`${cls}[hidden]`), hiddenRules);
}
const shown = (id) => $(id).hidden !== true;

// ---------------------------------------------------------------------------
console.log('\n2. Original size');

const exportNow = async () => {
  const before = captured.length;
  $('export-run').click();
  await waitFor(() => captured.length > before);
  return captured.at(-1);
};
const svgTextOf = async (blob) => Buffer.from(await blob.arrayBuffer()).toString('utf8');

let text = await svgTextOf(await exportNow());
const rootAttrs = (s) => /<svg[^>]*>/.exec(s)?.[0] || '';
check('exporting at original size stamps the true width',
  new RegExp(`width="${vbW}"`).test(rootAttrs(text)), rootAttrs(text).slice(0, 220));
check('…and the true height', new RegExp(`height="${vbH}"`).test(rootAttrs(text)));
check('…so the file no longer claims to be 100% of nothing',
  !/width="100%"/.test(rootAttrs(text)), rootAttrs(text).slice(0, 220));
check('the source Visio document is still embedded', text.includes('vsdxeditor-source'));
check('the dialog closes after a successful export', !$('export-modal').classList.contains('visible'));

// ---------------------------------------------------------------------------
console.log('\n3. Rescaling is metadata only');

$('btn-export').click();
$('export-size').value = 'screen';
fire($('export-size'), 'change');
// This fixture is A4-sized, comfortably inside every preset's ceiling — the
// presets are ceilings, not magnifiers, so it must come out untouched.
check('a preset leaves an already-sensible drawing alone',
  /unchanged/.test($('export-summary').textContent), $('export-summary').textContent);

// Force an actual rescale, which for this fixture means asking for one.
const TARGET = 512;
$('export-size').value = 'custom';
fire($('export-size'), 'change');
$('export-custom-px').value = String(TARGET);
fire($('export-custom-px'), 'input');
check('the summary shows the rescale', /→/.test($('export-summary').textContent), $('export-summary').textContent);

text = await svgTextOf(await exportNow());
const scaled = rootAttrs(text);
const outW = Number(/width="([\d.]+)"/.exec(scaled)?.[1]);
const outH = Number(/height="([\d.]+)"/.exec(scaled)?.[1]);
const expected = TARGET / Math.max(vbW, vbH);
check('the longest side lands on the requested size', Math.abs(Math.max(outW, outH) - TARGET) < 0.01, `${outW} × ${outH}`);
check('the width matches the requested scale', Math.abs(outW - vbW * expected) < 0.01, `${outW} vs ${vbW * expected}`);
check('the aspect ratio survives', Math.abs(outW / outH - vbW / vbH) < 1e-4, `${outW}/${outH}`);
check('THE VIEWBOX IS UNTOUCHED — no precision was thrown away',
  new RegExp(`viewBox="${viewBox}"`).test(scaled), scaled.slice(0, 220));

// The real proof that this is a metadata change: at two different export sizes
// the drawing content must be byte-identical.
const strip = (s) => s.replace(/<svg[^>]*>/, '<svg>').replace(/<metadata[\s\S]*?<\/metadata>/g, '');
$('btn-export').click();
$('export-size').value = 'original';
fire($('export-size'), 'change');
const originalText = await svgTextOf(await exportNow());
check('a rescaled export and an original one differ only in the root attributes',
  strip(originalText) === strip(text),
  `${strip(originalText).length} vs ${strip(text).length} bytes`);

// ---------------------------------------------------------------------------
console.log('\n4. Custom size and the embed toggle');

$('btn-export').click();
$('export-size').value = 'custom';
fire($('export-size'), 'change');
check('choosing custom reveals the number field', $('export-custom-row').hidden === false);
check('…on screen, not merely un-hidden', shown('export-custom-row'));
$('export-custom-px').value = '640';
fire($('export-custom-px'), 'input');
$('export-embed').checked = false;
text = await svgTextOf(await exportNow());
const customW = Number(/width="([\d.]+)"/.exec(rootAttrs(text))?.[1]);
const customH = Number(/height="([\d.]+)"/.exec(rootAttrs(text))?.[1]);
check('a custom longest side is honoured', Math.abs(Math.max(customW, customH) - 640) < 0.01, `${customW} × ${customH}`);
check('unticking the embed box leaves the source document out',
  !text.includes('vsdxeditor-source'), `${text.length} bytes`);
check('…which is a much smaller file', text.length < originalText.length,
  `${text.length} vs ${originalText.length}`);

$('btn-export').click();
$('export-embed').checked = true;

// ---------------------------------------------------------------------------
console.log('\n5. PDF export cannot touch the network unasked');

check('no network request has been made by any SVG export', fetches.length === 0, JSON.stringify(fetches));

$('export-format').value = 'pdf';
fire($('export-format'), 'change');
check('choosing PDF reveals the download gate', $('export-pdf-gate').hidden === false);
check('…on screen, not merely un-hidden', shown('export-pdf-gate'));
check('the embed option is hidden for PDF', $('export-embed-row').hidden === true);
check('…and really off screen, since a PDF cannot carry the source document',
  !shown('export-embed-row'), window.getComputedStyle($('export-embed-row')).display);

// PDF's 200in ceiling is the reason the whole rescale exists, so asking for a
// page past it must be refused up front rather than producing a broken file.
$('export-size').value = 'custom';
fire($('export-size'), 'change');
$('export-custom-px').value = '30000'; // 22500pt — well past 14400
fire($('export-custom-px'), 'input');
check('a PDF page beyond 200in is refused before anything is downloaded',
  $('export-run').disabled === true && fetches.length === 0, `disabled=${$('export-run').disabled}`);
check('…and the reason names the limit', /14400pt/.test($('export-status').textContent), $('export-status').textContent);
$('export-size').value = 'original';
fire($('export-size'), 'change');
check('going back to a legal size re-enables the button', $('export-run').disabled === false);
check('…and clears the complaint', $('export-status').textContent === '', $('export-status').textContent);

const gateText = $('export-pdf-gate').textContent;
check('the gate names both libraries', /jsPDF/.test(gateText) && /svg2pdf\.js/.test(gateText));
check('the gate shows a full SHA-256 for each', ($('export-pdf-libs').textContent.match(/[0-9a-f]{64}/g) || []).length === 2,
  $('export-pdf-libs').textContent);
check('the gate names the host bytes come from', /jsdelivr/.test(gateText));
check('consent starts unticked', $('export-pdf-consent').checked === false);

$('export-run').click();
await sleep(60);
check('exporting without consent downloads nothing at all', fetches.length === 0, JSON.stringify(fetches));
check('…and says why', /Allow this download/.test($('export-status').textContent), $('export-status').textContent);
check('…and leaves the dialog open', $('export-modal').classList.contains('visible'));

// ---------------------------------------------------------------------------
console.log('\n6. A library that fails its digest never runs');

// Stand in for a compromised, typosquatted or MITM'd CDN: correct URL, correct
// content type, wrong bytes.
window.__evilRan = false;
// The app logs the rejection, which is right — but an IntegrityError stack in
// the middle of a passing suite reads like a broken test, so hold it back and
// confirm afterwards that it was reported.
const logged = [];
const realErr = console.error;
console.error = (...a) => logged.push(a.map(String).join(' '));
const TAMPERED = 'globalThis.__evilRan = true; globalThis.jspdf = {};';
fetchResponder = async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode(TAMPERED).buffer,
});

$('export-pdf-consent').checked = true;
fire($('export-pdf-consent'), 'change');
$('export-run').click();
await waitFor(() => /SHA-256/.test($('export-status').textContent));

check('the rejection is logged for the console too',
  logged.some(l => /Export failed/.test(l) && /SHA-256/.test(l)), JSON.stringify(logged).slice(0, 200));
check('consent lets it try to download', fetches.length > 0, JSON.stringify(fetches));
check('it asked jsdelivr for jsPDF first', /jsdelivr\.net.*jspdf/.test(fetches[0] || ''), fetches[0]);
check('the tampered payload was NOT executed', window.__evilRan === false);
check('the failure is reported to the user', /failed its SHA-256 check/.test($('export-status').textContent),
  $('export-status').textContent);
check('the message shows the expected and actual digests',
  ($('export-status').textContent.match(/[0-9a-f]{64}/g) || []).length === 2, $('export-status').textContent);
check('no PDF was produced', !captured.some(b => b.type === 'application/pdf'));
check('the second library was never fetched — it stops at the first failure',
  fetches.filter(u => /svg2pdf/.test(u)).length === 0, JSON.stringify(fetches));
check('the dialog stays open so the export can be retried', $('export-modal').classList.contains('visible'));

// A failed download must not wedge the feature: the loader clears its cache so
// a retry re-fetches rather than replaying the failure.
const beforeRetry = fetches.length;
$('export-run').click();
await waitFor(() => fetches.length > beforeRetry);
check('a retry really re-fetches instead of replaying the old failure',
  fetches.length > beforeRetry, `${beforeRetry} → ${fetches.length}`);

// ---------------------------------------------------------------------------
console.log('\n7. The case this exists for: a drawing too big for a PDF page');

// The fixtures are all ordinary page sizes, so build the reported case: a
// 345 × 90in engineering drawing, which renders as 33120 × 8640 units — and at
// original size is 24840pt wide, 72% past what a PDF page may be.
const zip = await JSZip.loadAsync(readFileSync(fixture));
const pagesXml = (await zip.file('visio/pages/pages.xml').async('string'))
  .replace(/PageWidth' V='[\d.]+'/g, "PageWidth' V='345'")
  .replace(/PageHeight' V='[\d.]+'/g, "PageHeight' V='90'");
zip.file('visio/pages/pages.xml', pagesXml);
const bigBytes = await zip.generateAsync({ type: 'uint8array' });

// Section 6 left the dialog on PDF with a hostile responder installed; this
// section is about sizing, so put both back.
fetchResponder = async () => { throw new Error('no responder installed'); };
$('export-format').value = 'svg';
fire($('export-format'), 'change');

await dropFile(new window.File([bigBytes], 'big.vsdx'));
const bigSvg = currentSvg();
const [, , bigW, bigH] = bigSvg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
check('the oversized drawing rendered', bigW === 33120 && bigH === 8640, `${bigW} × ${bigH}`, whyNot());
check('and on screen it still has no intrinsic size — the original complaint',
  bigSvg.getAttribute('width') === '100%');

$('btn-export').click();
check('the dialog opens on Viewer-safe, not Original, for a drawing PDF cannot hold',
  $('export-size').value === 'viewer', $('export-size').value);
check('the summary spells out the rescale',
  /33120 × 8640px → 19200 × 5009px \(200 × 52\.17in\)/.test($('export-summary').textContent),
  $('export-summary').textContent);

text = await svgTextOf(await exportNow());
let bigRoot = rootAttrs(text);
check('the rescaled SVG is 19200px wide — 200in, the PDF ceiling',
  /width="19200"/.test(bigRoot), bigRoot.slice(0, 200));
check('…and still carries the full 33120-unit viewBox',
  /viewBox="0 0 33120 8640"/.test(bigRoot), bigRoot.slice(0, 200));

// Original size stays available for anyone who wants it.
$('btn-export').click();
$('export-size').value = 'original';
fire($('export-size'), 'change');
text = await svgTextOf(await exportNow());
bigRoot = rootAttrs(text);
check('original size is still one dropdown entry away', /width="33120"/.test(bigRoot), bigRoot.slice(0, 200));

// And PDF refuses the impossible page outright.
$('btn-export').click();
$('export-format').value = 'pdf';
fire($('export-format'), 'change');
const fetchesBefore = fetches.length;
check('a PDF at original size is refused — 24840pt is past the format limit',
  $('export-run').disabled === true, `disabled=${$('export-run').disabled}`);
$('export-run').click();
await sleep(40);
check('…without downloading anything to find that out', fetches.length === fetchesBefore);
$('export-size').value = 'viewer';
fire($('export-size'), 'change');
check('Viewer-safe makes PDF export possible again', $('export-run').disabled === false);
check('…at exactly 14400 × 3757pt', (() => {
  // The dialog reports px; the PDF page is those px in points.
  const m = /→ (\d+) × (\d+)px/.exec($('export-summary').textContent);
  return m && Math.abs(Number(m[1]) * 0.75 - 14400) < 1;
})(), $('export-summary').textContent);

// The retry above rejects asynchronously too, so console.error stays captured
// until here rather than spilling an IntegrityError stack into a green suite.
console.error = realErr;

console.log(`\nexport-app: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
