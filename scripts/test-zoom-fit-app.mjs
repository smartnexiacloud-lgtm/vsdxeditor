// Being able to see the whole drawing.
//
// A Visio drawing is not necessarily a sheet of paper. A site plan or a floor
// layout is measured at full size, and one of the fixtures here is 3962 by 2618
// *inches* — 380,372 renderer pixels across. Fitting that into a window is a
// third of one percent.
//
// It used to fit by accident: the SVG was laid out at width:100% with its
// natural size as a maximum, so the browser shrank it and "100%" quietly meant
// "as big as fits". Sizing the SVG in layout instead — which is what stopped
// zooming from going blurry — made 100% mean 100%, and left a large drawing
// opening hundreds of screens wide against a zoom floor of 10% that could not
// be pushed past. So what is checked here is the thing the user actually wants:
// open a drawing, see all of it; press −, get further out.
//
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';
import JSZip from 'jszip';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

// jsdom has no layout, so nothing has a size unless it is given one. The
// viewport is the thing a fit is measured against, so it gets a believable one.
const VIEW = { width: 1200, height: 800 };

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
    window.Element.prototype.getBoundingClientRect = function () {
      const size = this.id === 'viewport' ? VIEW : { width: 0, height: 0 };
      return { x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, ...size };
    };
  },
});
const { window } = dom;
window.HTMLAnchorElement.prototype.click = function () {};

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
const waitFor = async (done) => {
  const deadline = Date.now() + (Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000);
  while (Date.now() < deadline) {
    if (done()) return true;
    await sleep(25);
  }
  return false;
};
const currentSvg = () => window.document.querySelector('#svg-container svg');
const zoomText = () => $('zoom-info').textContent.trim();
// The readout is rounded for people to read, so it is checked as text and never
// used as a measurement. What is actually on screen is the layout width the SVG
// was given times whatever residual scale the container's transform still
// carries — the two together are the real zoom, whichever of them holds it.
const drawnWidth = () => {
  const svg = currentSvg();
  const laid = parseFloat(svg.style.width) || 0;
  const scale = /scale\(([-\d.]+)\)/.exec($('svg-container').style.transform || '');
  return laid * (scale ? Number(scale[1]) : 1);
};
const shownZoom = () => drawnWidth() / pageWidth;

// The drawings that make this fail are site plans measured in hundreds of feet,
// and none of those are small enough to keep in the repository. So one is made:
// a tracked fixture with its page grown to 3000 by 2000 inches, which is the
// size of the real thing that could not be zoomed out to.
async function hugeFixture() {
  const zip = await JSZip.loadAsync(readFileSync('test-files/test3_house.vsdx'));
  const pages = await zip.file('visio/pages/pages.xml').async('string');
  zip.file('visio/pages/pages.xml', pages
    .replace(/<Cell N='PageWidth' V='[^']*'/, "<Cell N='PageWidth' V='3000'")
    .replace(/<Cell N='PageHeight' V='[^']*'/, "<Cell N='PageHeight' V='2000'"));
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

const fixture = process.argv[2] || null;
if (fixture && !existsSync(fixture)) {
  console.log(`(skipped: ${fixture} is not in this checkout)`);
  process.exit(0);
}
const fixtureBytes = fixture ? new Uint8Array(readFileSync(fixture)) : await hugeFixture();
console.log(`── zoom and fit: ${fixture || 'a 3000 × 2000 inch page'} ──`);

const dropFile = async (file) => {
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  return waitFor(() => currentSvg() && currentSvg() !== previous);
};

await dropFile(new window.File([fixtureBytes], 'huge.vsdx'));
check('the drawing opened', !!currentSvg(), $('error-box')?.textContent || '');

const viewBox = (currentSvg().getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
let [, , pageWidth, pageHeight] = viewBox;
const fitsAt = () => Math.min((VIEW.width - 32) / pageWidth, (VIEW.height - 32) / pageHeight);
console.log(`     the page is ${pageWidth.toFixed(0)} × ${pageHeight.toFixed(0)} renderer px `
  + `(${(pageWidth / 96).toFixed(0)} × ${(pageHeight / 96).toFixed(0)} in)`);
check('the fixture really is bigger than any window', pageWidth > VIEW.width * 4,
  `${pageWidth} vs ${VIEW.width}`);

console.log('\n1. Opening a page shows the page');
{
  const shown = drawnWidth();
  check('all of it is on screen', shown > 0 && shown <= VIEW.width + 1, `${shown.toFixed(1)}px of ${VIEW.width}`);
  check('…and it fills the window rather than sitting in a corner of it',
    shown > VIEW.width * 0.5 || (pageHeight / pageWidth) * shown > VIEW.height * 0.5,
    `${shown.toFixed(1)} × ${((pageHeight / pageWidth) * shown).toFixed(1)}`);
  check('the zoom it opened at is the one that fits',
    Math.abs(shownZoom() - fitsAt()) < fitsAt() * 1e-6,
    `${zoomText()} — fits at ${(fitsAt() * 100).toFixed(3)}%`);
}

console.log('\n2. The readout says something usable');
{
  check('a zoom under one percent is not displayed as 0%', !/^0%$/.test(zoomText()), zoomText());
  check('…and still reads as a percentage', /^[\d.]+%$/.test(zoomText()), zoomText());
}

console.log('\n3. Zooming out keeps going');
{
  const before = shownZoom();
  for (let i = 0; i < 5; i++) $('btn-zoom-out').click();
  const after = shownZoom();
  check('pressing − five times actually zooms out', after < before * 0.9,
    `${(before * 100).toFixed(3)}% → ${(after * 100).toFixed(3)}%`);
  check('…and the drawing on screen got smaller with it', drawnWidth() < VIEW.width,
    String(drawnWidth()));
}

console.log('\n4. Fit brings it back');
{
  const before = shownZoom();
  for (let i = 0; i < 12; i++) $('btn-zoom-in').click();
  check('zooming in works too', shownZoom() > before * 2,
    `${(before * 100).toFixed(3)}% → ${(shownZoom() * 100).toFixed(3)}%`);
  $('btn-zoom-fit').click();
  const shown = drawnWidth();
  check('Fit puts the whole page back on screen', shown > 0 && shown <= VIEW.width + 1,
    `${shown.toFixed(1)}px of ${VIEW.width}`);
  check('…at exactly the zoom that fits it', Math.abs(shownZoom() - fitsAt()) < fitsAt() * 1e-6,
    `${zoomText()} vs ${(fitsAt() * 100).toFixed(3)}%`);
}

console.log('\n5. An ordinary page is shown whole too, and never magnified on opening');
{
  const small = 'test-files/test3_house.vsdx';
  if (existsSync(small)) {
    await dropFile(new window.File([new Uint8Array(readFileSync(small))], 'small.vsdx'));
    const box = (currentSvg().getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    check('the small drawing opened', box[2] > 0, String(box[2]));
    [pageWidth, pageHeight] = [box[2], box[3]];
    check('all of it is on screen', drawnWidth() <= VIEW.width + 1,
      `${drawnWidth().toFixed(1)}px of ${VIEW.width}`);
    // Opening must never magnify: a stencil master an inch across should not
    // fill the screen just because it could.
    check('it opens at the fit, and never above its own size',
      Math.abs(shownZoom() - Math.min(1, fitsAt())) < 1e-6,
      `${zoomText()} for a ${box[2].toFixed(0)}×${box[3].toFixed(0)}px page in ${VIEW.width}×${VIEW.height}`);
    $('btn-zoom-fit').click();
    check('…and Fit is willing to magnify when there is room to',
      Math.abs(shownZoom() - fitsAt()) < 1e-6, `${zoomText()} vs ${(fitsAt() * 100).toFixed(1)}%`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
