// End-to-end test against the REAL built app (dist/) for how zoom is applied.
//
// Zoom used to be a plain `scale()` on the container. Scaling a composited layer
// does not redraw it — the compositor stretches the pixels it already has — so
// the drawing went soft the instant you touched the wheel and sharpened again
// the moment you panned, which is what finally invalidated the layer. Vectors
// have no business being blurry at any zoom.
//
// The scale is moved into the SVG's own layout size once the gesture settles, so
// the browser draws the vectors bigger instead of magnifying pixels. This test
// is about where the zoom ends up living, and about the drawing not moving on
// screen when it moves from one to the other.
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};
    window.prompt = () => null;
    window.confirm = () => true;
    window.alert = () => {};
    if (!window.CSS) window.CSS = {};
    if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
    window.Element.prototype.scrollIntoView = function () {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
  },
});
const { window } = dom;
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
const waitFor = async (done) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (done()) return true;
    if ($('error-box')?.textContent.trim()) return false;
    await sleep(25);
  }
  return false;
};
const container = () => $('svg-container');
const currentSvg = () => window.document.querySelector('#svg-container svg');
const dropFile = async (file) => {
  if ($('error-box')) $('error-box').textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  await waitFor(() => currentSvg() && currentSvg() !== previous
    && currentSvg().querySelector('g[data-shape-id]'));
};

const viewBox = () => (currentSvg()?.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
const laidOutWidth = () => parseFloat(currentSvg()?.style.width || '');
const laidOutHeight = () => parseFloat(currentSvg()?.style.height || '');
// Everything the container's transform still carries. Vectors are only crisp
// when this has no scale left in it.
const transform = () => container().style.transform || '';
const residualScale = () => {
  const m = /scale\(\s*([\d.]+)/.exec(transform());
  return m ? Number(m[1]) : 1;
};
const zoomPct = () => Number(($('zoom-info').textContent || '').replace('%', ''));
// The zoom the drawing is actually being shown at, wherever it is stored.
const effectiveZoom = () => (laidOutWidth() / viewBox()[2]) * residualScale();
const settle = async () => {
  // The commit is on an 80ms timer so a wheel gesture is not relaid out on every
  // tick; anything past that is the settled state.
  await waitFor(() => residualScale() === 1);
  await sleep(30);
};

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app zoom: ${fixture} ──`);

await dropFile(new window.File([readFileSync(fixture)], 'zoom.vsdx'));
check('app booted and rendered', !!currentSvg(), 'error: ' + $('error-box')?.textContent);

// --- 1. At 100% the SVG is at its natural size, and nothing is scaled --------
const [, , vbW, vbH] = viewBox();
check('the drawing has a viewBox to be sized from', vbW > 0 && vbH > 0, viewBox().join(','));
check('the SVG is laid out at its natural size', Math.abs(laidOutWidth() - vbW) < 0.01,
  `${laidOutWidth()} vs ${vbW}`);
check('and the height with it', Math.abs(laidOutHeight() - vbH) < 0.01, `${laidOutHeight()} vs ${vbH}`);
check('the container carries no scale at 100%', residualScale() === 1, transform());
check('the max-width the renderer pins is lifted, or the size could not grow',
  currentSvg().style.maxWidth === 'none', currentSvg().style.maxWidth);

// --- 2. Zooming in ends up in the layout, not in a transform ----------------
$('btn-zoom-in').click();
check('the zoom readout moves at once', zoomPct() === 120, String(zoomPct()));
check('and the picture with it, before anything is relaid out',
  Math.abs(effectiveZoom() - 1.2) < 0.001, String(effectiveZoom()));

await settle();
check('once the gesture settles the zoom is in the SVG\'s own size',
  Math.abs(laidOutWidth() - vbW * 1.2) < 0.01, `${laidOutWidth()} vs ${vbW * 1.2}`);
check('…so the container has no scale left to stretch pixels with',
  residualScale() === 1, transform());
check('…and the drawing is the same size on screen either way',
  Math.abs(effectiveZoom() - 1.2) < 0.001, String(effectiveZoom()));
check('the readout still agrees', zoomPct() === 120, String(zoomPct()));

// --- 3. Several ticks in a row, as a wheel gesture would be -----------------
for (let i = 0; i < 5; i++) $('btn-zoom-in').click();
const expected = 1.2 ** 6;
check('a run of ticks moves the picture every time',
  Math.abs(effectiveZoom() - expected) < 0.001, `${effectiveZoom()} vs ${expected}`);
await settle();
check('and settles with all of it in the layout',
  Math.abs(laidOutWidth() - vbW * expected) < 0.02, `${laidOutWidth()} vs ${vbW * expected}`);
check('with nothing left in the transform', residualScale() === 1, transform());

// --- 4. Zooming out, and back to fit ----------------------------------------
for (let i = 0; i < 8; i++) $('btn-zoom-out').click();
await settle();
const out = 1.2 ** 6 / 1.2 ** 8;
check('zooming out lands in the layout too',
  Math.abs(laidOutWidth() - vbW * out) < 0.02, `${laidOutWidth()} vs ${vbW * out}`);
check('and the readout matches', Math.abs(zoomPct() - out * 100) < 1, String(zoomPct()));

$('btn-zoom-fit').click();
await settle();
check('fit returns to natural size', Math.abs(laidOutWidth() - vbW) < 0.01,
  `${laidOutWidth()} vs ${vbW}`);
check('with no scale on the container', residualScale() === 1, transform());

// --- 5. Panning is still a transform, and does not resample anything --------
const widthBeforePan = laidOutWidth();
$('btn-zoom-in').click();
await settle();
const viewport = $('viewport');
viewport.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
window.document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 160, clientY: 130 }));
window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
await sleep(120);
check('panning moves the drawing', /translate\(\s*-?[\d.]+px/.test(transform()) && !/translate\(0px, 0px\)/.test(transform()),
  transform());
check('…without putting a scale back on the container', residualScale() === 1, transform());
check('…and without touching the size the vectors are drawn at',
  Math.abs(laidOutWidth() - widthBeforePan * 1.2) < 0.01, `${laidOutWidth()}`);

// --- 6. A re-render starts from a fresh SVG, which has no size of its own ----
const before = currentSvg();
$('btn-rerender').click();
await waitFor(() => currentSvg() && currentSvg() !== before && currentSvg().querySelector('g[data-shape-id]'));
check('re-rendering replaced the SVG', currentSvg() !== before);
check('the new one is sized for the zoom straight away, not left at 100%',
  Math.abs(laidOutWidth() - vbW * 1.2) < 0.01, `${laidOutWidth()} vs ${vbW * 1.2}`);
check('…with no scale on the container', residualScale() === 1, transform());

// --- 7. Export is unaffected by how the viewer sizes its SVG -----------------
// The viewer's inline width/height are on the element the exporter clones, and
// an inline style beats the attribute the exporter sets.
$('btn-export').click();
$('export-size').value = 'original';
$('export-size').dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(40);
const exportedSvg = window.document.querySelector('#svg-container svg');
check('the dialog opened over a zoomed drawing', $('export-modal').classList.contains('visible'));
check('and the viewer SVG is still the zoomed one', Math.abs(parseFloat(exportedSvg.style.width) - vbW * 1.2) < 0.01);
$('export-cancel').click();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
