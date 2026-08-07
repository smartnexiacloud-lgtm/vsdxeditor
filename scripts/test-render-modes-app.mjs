// End-to-end check of the thin-line rendering control against the REAL built
// app (dist/). Boots the bundle in jsdom, loads a .vsdx, and drives the
// "Hairlines" select and the Update button: the minimum line width is baked
// into the SVG, so the viewer must re-render to change it rather than follow
// the zoom live. Run `npm run build` first.
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
    if (!window.CSS) window.CSS = {};
    if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
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

// Parsing and rendering a drawing is async with no fixed duration — on a busy
// machine it outruns any constant we could pick, so poll for the outcome and
// bail early once the app reports an error.
const WAIT_TIMEOUT_MS = Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000;
const currentSvg = () => window.document.querySelector('#svg-container svg');
const waitFor = async (done) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (done()) return true;
    if ($('error-box')?.textContent.trim()) return false;
    await sleep(25);
  }
  return false;
};
// A re-render swaps in a fresh <svg>; wait for that rather than a delay.
const waitForRerender = (previous) => waitFor(() => currentSvg() && currentSvg() !== previous);

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app thin-line rendering: ${fixture} ──`);

const ev = new window.Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(ev, 'dataTransfer', {
  value: { files: [new window.File([readFileSync(fixture)], 'render.vsdx')] }
});
$('drop-zone').dispatchEvent(ev);
await waitFor(() => !!currentSvg());

check('app booted and rendered', !!currentSvg(),
  'error: ' + ($('error-box')?.textContent.trim() || `(timed out after ${WAIT_TIMEOUT_MS} ms)`));

// Thinnest stroke anywhere in the drawing: that is the one the minimum bites on.
const thinnestStroke = () => {
  const widths = [...window.document.querySelectorAll('#svg-container svg [stroke-width]')]
    .map(el => parseFloat(el.getAttribute('stroke-width')))
    .filter(Number.isFinite);
  return widths.length ? Math.min(...widths) : NaN;
};

const strokeMode = $('stroke-mode');
const rerender = $('btn-rerender');
check('toolbar offers the hairline mode control', !!strokeMode && !!rerender);
// True size is the default: it is what the drawing says, and what Visio, an
// export and a print all show. A floor is a reading aid, and one applied
// without being asked for makes a scaled plan's hairlines look heavier than
// they are.
check('true size is the default', strokeMode.value === 'true', strokeMode.value);

const trueSize = thinnestStroke();
check('something thin is on screen to test with', Number.isFinite(trueSize) && trueSize > 0,
  String(trueSize));
check('true size draws hairlines, not zero-width lines', trueSize > 0, String(trueSize));

// Fit zoom: no line thinner than a screen pixel, so the thinnest line can only
// get thicker (or stay put, when nothing needed flooring).
const beforeFit = currentSvg();
strokeMode.value = 'screen';
strokeMode.dispatchEvent(new window.Event('change'));
await waitForRerender(beforeFit);
const atFit = thinnestStroke();
check('fit-zoom mode re-renders', !!currentSvg() && currentSvg() !== beforeFit);
check('fit-zoom never draws thinner than true size', atFit >= trueSize - 1e-9,
  `${atFit} vs ${trueSize}`);

// Zooming does not change the SVG - that is what the Update button is for.
const beforeZoom = thinnestStroke();
for (let i = 0; i < 8; i++) $('btn-zoom-out').click();
await sleep(50);
check('zooming alone leaves the rendered strokes untouched', thinnestStroke() === beforeZoom,
  `${thinnestStroke()} vs ${beforeZoom}`);

// Re-rendered for a much smaller zoom, the minimum has to grow to keep
// hairlines on screen.
const beforeZoomedOut = currentSvg();
rerender.click();
await waitForRerender(beforeZoomedOut);
const zoomedOut = thinnestStroke();
check('fit-zoom compensates for a zoomed-out view', zoomedOut > atFit,
  `${zoomedOut} vs ${atFit}`);

// The Update button goes stale once the view is zoomed away from the render,
// and clears when clicked.
$('btn-zoom-in').click();
$('btn-zoom-in').click();
$('btn-zoom-in').click();
await sleep(50);
check('Update flags a render made for a different zoom', rerender.classList.contains('stale'));
const beforeUpdate = currentSvg();
rerender.click();
await waitForRerender(beforeUpdate);
check('Update clears the stale flag', !rerender.classList.contains('stale'));
check('Update re-rendered for the closer zoom', thinnestStroke() < zoomedOut,
  `${thinnestStroke()} vs ${zoomedOut}`);

console.log(`\nrender-modes-app: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
