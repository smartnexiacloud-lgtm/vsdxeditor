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

const fixture = process.argv[2] || 'test-files/test4_connectors.vsdx';
console.log(`── in-app thin-line rendering: ${fixture} ──`);

const ev = new window.Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(ev, 'dataTransfer', {
  value: { files: [new window.File([readFileSync(fixture)], 'render.vsdx')] }
});
$('drop-zone').dispatchEvent(ev);
await sleep(500);

check('app booted and rendered', !!window.document.querySelector('#svg-container svg'),
  'error: ' + $('error-box')?.textContent);

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
check('fit-zoom is the default', strokeMode.value === 'screen', strokeMode.value);

const atFit = thinnestStroke();
check('something thin is on screen to test with', Number.isFinite(atFit) && atFit > 0, String(atFit));

// True size: lines drop to their real Visio weights, so the thinnest line can
// only get thinner (or stay put, when nothing was being floored).
strokeMode.value = 'true';
strokeMode.dispatchEvent(new window.Event('change'));
await sleep(200);
const trueSize = thinnestStroke();
check('true-size mode re-renders', !!window.document.querySelector('#svg-container svg'));
check('true size never draws thicker than fit-zoom', trueSize <= atFit + 1e-9,
  `${trueSize} vs ${atFit}`);
check('true size still draws hairlines, not zero-width lines', trueSize > 0, String(trueSize));

// Zooming does not change the SVG - that is what the Update button is for.
const beforeZoom = thinnestStroke();
for (let i = 0; i < 8; i++) $('btn-zoom-out').click();
await sleep(50);
check('zooming alone leaves the rendered strokes untouched', thinnestStroke() === beforeZoom,
  `${thinnestStroke()} vs ${beforeZoom}`);

// Back to fit-zoom at a much smaller zoom: the minimum has to grow to keep
// hairlines on screen, and only re-rendering applies it.
strokeMode.value = 'screen';
strokeMode.dispatchEvent(new window.Event('change'));
await sleep(200);
const zoomedOut = thinnestStroke();
check('fit-zoom compensates for a zoomed-out view', zoomedOut > trueSize,
  `${zoomedOut} vs ${trueSize}`);

// The Update button goes stale once the view is zoomed away from the render,
// and clears when clicked.
$('btn-zoom-in').click();
$('btn-zoom-in').click();
$('btn-zoom-in').click();
await sleep(50);
check('Update flags a render made for a different zoom', rerender.classList.contains('stale'));
rerender.click();
await sleep(200);
check('Update clears the stale flag', !rerender.classList.contains('stale'));
check('Update re-rendered for the closer zoom', thinnestStroke() < zoomedOut,
  `${thinnestStroke()} vs ${zoomedOut}`);

console.log(`\nrender-modes-app: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
