// Boot the REAL built app (dist/app.html + dist/main.js) in jsdom, load a
// .vsdx via the drop-zone handler, click "Export SVG", capture the downloaded
// blob, verify it carries the embedded vsdx, then drop the exported .svg back
// into the app and confirm it re-opens as the drawing. Run `npm run build`
// first (the test uses the bundled dist/).
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

// Strip the <script src> (jsdom can't fetch it); the bundle is injected inline.
const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    // Capture "downloads": the app hands blobs to URL.createObjectURL.
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    // jsdom quirks (real browsers are unaffected): the "setimmediate" polyfill
    // JSZip pulls in relies on postMessage event.source, which jsdom leaves
    // null, so its callbacks never fire — provide a real setImmediate instead.
    // Likewise hide MutationObserver so lie/immediate falls back to setTimeout.
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
  },
});
const { window } = dom;
const captured = window.__captured;
window.HTMLAnchorElement.prototype.click = function () { /* swallow navigation */ };

// jsdom quirk: Blob.arrayBuffer() returns a Node-realm ArrayBuffer, which
// fails JSZip's in-window `instanceof ArrayBuffer` check. Copy into a
// window-realm buffer, as a browser would give.
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

// Parsing and rendering a drawing is async and has no fixed duration — on a
// busy machine it comfortably outruns any constant we could pick here, which
// used to fail this whole suite spuriously. Poll for the outcome instead, and
// give up early if the app reported an error (nothing more is coming).
const WAIT_TIMEOUT_MS = Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000;
const errorBox = () => window.document.getElementById('error-box');
const waitFor = async (done) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (done()) return true;
    if (errorBox()?.textContent.trim()) return false;
    await sleep(25);
  }
  return false;
};
// Why a check failed, for the detail column: the app's own message if it has
// one, otherwise say we ran out of patience rather than printing an empty box.
const whyNot = () => 'error-box: ' + (errorBox()?.textContent.trim() || `(timed out after ${WAIT_TIMEOUT_MS} ms)`);

// Wait for a *new* <svg> node, not merely for one to exist: dropping a second
// file leaves the previous render in place until the new one replaces it.
const currentSvg = () => window.document.querySelector('#svg-container svg');
const dropFile = async (file) => {
  if (errorBox()) errorBox().textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  window.document.getElementById('drop-zone').dispatchEvent(ev);
  await waitFor(() => currentSvg() && currentSvg() !== previous);
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app svg export round-trip: ${fixture} ──`);

// 1. Load a real vsdx through the app's own drop handler.
const srcBytes = new Uint8Array(readFileSync(fixture));
await dropFile(new window.File([srcBytes], 'roundtrip.vsdm'));
check('app booted and rendered the vsdx',
  !!window.document.querySelector('#svg-container svg'), whyNot());

// 2. Export SVG (through the export dialog) and inspect the blob the user
// would download.
window.document.getElementById('btn-export').click();
window.document.getElementById('export-run').click();
// The handler awaits saveVsdxLayerPermissions before it hands over the blob.
await waitFor(() => captured.some((b) => b.type === 'image/svg+xml'));
const svgBlob = captured.find((b) => b.type === 'image/svg+xml');
check('Export SVG produced an image/svg+xml download', !!svgBlob, whyNot());
const svgText = svgBlob ? Buffer.from(await svgBlob.arrayBuffer()).toString('utf8') : '';
check('exported SVG embeds vsdxeditor-source metadata', svgText.includes('vsdxeditor-source'));

// 3. The embedded payload is a real vsdx zip.
const b64 = /encoding="base64">([A-Za-z0-9+/=]+)</.exec(svgText);
const embedded = b64 ? Buffer.from(b64[1], 'base64') : Buffer.alloc(0);
check('embedded payload is a ZIP (vsdx)', embedded.subarray(0, 2).toString() === 'PK',
  `${embedded.length} bytes`);

// 4. Drop the exported .svg back into the app — it must re-open the drawing.
window.document.getElementById('svg-container').innerHTML = '';
await dropFile(new window.File([svgText], 'exported.svg'));
const reRendered = window.document.querySelector('#svg-container svg');
check('exported .svg re-opens and renders the drawing', !!reRendered, whyNot());
check('file name restored from embedded metadata',
  /\.vsdm$/i.test(window.document.getElementById('file-name').textContent),
  window.document.getElementById('file-name').textContent);

console.log(`\napp-svg-roundtrip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
