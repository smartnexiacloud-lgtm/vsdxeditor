// Whether opening a drawing says it is opening.
//
// Unzipping, parsing and drawing a .vsdx is seconds of work on a big file, all
// of it on the thread that would otherwise be painting, and none of it used to
// say anything: the window stopped answering, and a load that was working was
// indistinguishable from one that had hung.
//
// Two halves to that, and this checks both:
//
//   * the parsers report where they are, in phases, with a count inside each —
//     and go on parsing whatever the callback does, including throw;
//   * the app draws those reports, on the real built page, and the bar it draws
//     actually moves *while* the file is being read rather than arriving all at
//     once at the end.
//
// The second half is the one that matters. A progress bar whose width is only
// set is a progress bar nobody sees, because the thread that would paint it is
// the thread inside the parse; the test polls the DOM during the load, which it
// can only get a turn to do if the load is handing the event loop back.
//
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. The parsers report ─────────────────────────────────────────────────
console.log('── opening a drawing: what the parsers report ──');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
    globalThis[k] = dom.window[k];
  globalThis.window = dom.window;

  const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-progress-'));
  process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
  writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
  symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');
  for (const name of ['shape-inheritance', 'svg-renderer', 'parse-progress', 'vsdx-parser', 'vsd-parser'])
    writeFileSync(join(tmp, `${name}.js`), readFileSync(`src/${name}.js`, 'utf8'));
  const { parseVsdx } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')).href);
  const { parseVsd } = await import(pathToFileURL(join(tmp, 'vsd-parser.js')).href);

  const bytes = (path) => {
    const buf = readFileSync(path);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };

  const events = [];
  const parsed = await parseVsdx(bytes('test-files/test4_connectors.vsdx'),
    { onProgress: (e) => { events.push(e); } });
  check('the drawing still parses', (parsed.pages || []).length > 0);
  check('and it said so as it went', events.length > 0, `${events.length} reports`);

  const phases = [...new Set(events.map(e => e.stage))];
  check('unpacking is a phase of its own', phases.includes('unzip'), phases.join(','));
  check('so is reading the pages', phases.includes('pages'), phases.join(','));
  check('the phases arrive in the order the work happens',
    phases.indexOf('unzip') < phases.indexOf('pages'), phases.join(','));
  check('every report counts within its phase',
    events.every(e => Number.isFinite(e.done) && Number.isFinite(e.total)
      && e.done >= 0 && e.total > 0 && e.done <= e.total),
    JSON.stringify(events.slice(0, 4)));

  // How far along the whole read is, which is the parser's to say: it is the
  // one that knows this drawing is 133 masters and one page rather than the
  // other way about.
  check('every report says how far along the whole read is',
    events.every(e => Number.isFinite(e.overall) && e.overall >= 0 && e.overall <= 1),
    JSON.stringify(events.map(e => e.overall).slice(0, 4)));
  check('and that never goes backwards',
    events.every((e, i) => i === 0 || e.overall >= events[i - 1].overall),
    JSON.stringify(events.map(e => Math.round(e.overall * 100))));
  check('it starts near the beginning and ends at the end',
    events[0].overall < 0.2 && events.at(-1).overall === 1,
    `${events[0].overall} … ${events.at(-1).overall}`);
  // Shared out by how much there is to read rather than by a fixed idea of what
  // a phase is worth: the masters get the bar in proportion to how many of them
  // there are. A drawing of 133 masters and one page spends its wait in the
  // masters, and the bar has to spend it there too.
  {
    const masterCount = parsed.masters.size;
    const parts = masterCount + parsed.pages.length;
    const firstPage = events.find(e => e.stage === 'pages');
    const expected = 0.05 + 0.95 * (masterCount / parts);
    check('the phases are shared out by how much there is in them',
      masterCount > 0 && Math.abs(firstPage.overall - expected) < 1e-9,
      `${masterCount} masters + ${parsed.pages.length} pages: ${firstPage?.overall} vs ${expected}`);
  }

  const pageReports = events.filter(e => e.stage === 'pages');
  check('the page count is the drawing’s own',
    pageReports.length > 0 && pageReports.every(e => e.total === parsed.pages.length),
    `${pageReports.map(e => `${e.done}/${e.total}`).join(' ')} vs ${parsed.pages.length} pages`);
  check('and it ends on the last page rather than short of it',
    pageReports.at(-1)?.done === parsed.pages.length,
    JSON.stringify(pageReports.at(-1)));

  // Whatever the callback hands back is waited for — that is the whole point of
  // it, since it is the caller's only chance to have the browser draw.
  const order = [];
  await parseVsdx(bytes('test-files/test4_connectors.vsdx'), {
    onProgress: async () => {
      order.push('called');
      await new Promise(resolve => setTimeout(resolve, 0));
      order.push('resumed');
    }
  });
  check('a report that takes its time is waited for, not raced',
    order.length > 1 && order.every((entry, i) => entry === (i % 2 ? 'resumed' : 'called')),
    order.slice(0, 6).join(','));

  // A bar that throws is a bar that throws; it is not worth a drawing.
  let thrown = null;
  const survived = await parseVsdx(bytes('test-files/test4_connectors.vsdx'),
    { onProgress: () => { throw new Error('bar exploded'); } }).catch(e => { thrown = e; return null; });
  check('a progress callback that throws does not cost the drawing',
    thrown === null && (survived?.pages || []).length > 0, String(thrown));

  // Asking for nothing costs nothing, and is what every other caller does.
  const plain = await parseVsdx(bytes('test-files/test4_connectors.vsdx'));
  check('and parsing without asking for progress still works',
    (plain.pages || []).length === parsed.pages.length);

  // The binary format reads nothing like the zip one, so it reports its own
  // phases rather than pretending to have parts and pictures.
  const vsdEvents = [];
  const vsd = await parseVsd(bytes('test-files/multipages.vsd'),
    { onProgress: (e) => { vsdEvents.push(e); } });
  const vsdPhases = [...new Set(vsdEvents.map(e => e.stage))];
  check('a .vsd parses too', (vsd.pages || []).length > 0);
  check('and reports the phases it actually has',
    vsdPhases.includes('streams') && vsdPhases.includes('pages') && !vsdPhases.includes('unzip'),
    vsdPhases.join(','));
  check('counting the streams it walks',
    vsdEvents.filter(e => e.stage === 'streams').length > 1,
    `${vsdEvents.filter(e => e.stage === 'streams').length} stream reports`);
}

// ── 2. The app draws them ─────────────────────────────────────────────────
// Twice over: once where there is no requestAnimationFrame, which is the
// fallback, and once where there is, which is the branch every browser takes.
// The two schedule the pause differently and only one of them can be wrong.
if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

async function appCase({ visual }) {
console.log(`\n── opening a drawing: what the app shows (${visual ? 'with' : 'without'} requestAnimationFrame) ──`);

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: visual,
  beforeParse(window) {
    if (!visual) {
      delete window.requestAnimationFrame;
      delete window.cancelAnimationFrame;
    }
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

const $ = (id) => window.document.getElementById(id);
const overlay = () => $('load-progress');
const fill = () => $('load-progress-fill');
const shown = () => !overlay().hidden;
const width = () => Number.parseFloat(fill().style.width) || 0;

check('the app has an overlay for it', !!overlay() && !!fill() && !!$('load-progress-stage'));
check('and it is out of the way before anything is opened', !shown());

// Drop a file and watch, rather than await: the point of the exercise is that
// there is something to see *during* the load, so the polling has to happen
// while it is going on.
const frames = [];
const dropFile = async (file) => {
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    frames.push({ shown: shown(), width: width(), stage: $('load-progress-stage').textContent });
    if (window.document.querySelector('#svg-container svg g[data-shape-id]') && !shown()) break;
    if ($('error-box')?.textContent.trim()) break;
    await sleep(4);
  }
};

await dropFile(new window.File([readFileSync('test-files/test4_connectors.vsdx')], 'progress.vsdx'));

check('the drawing opened', !!window.document.querySelector('#svg-container svg g[data-shape-id]'),
  $('error-box')?.textContent || '');

const during = frames.filter(f => f.shown);
check('the overlay was up while it was reading', during.length > 0);
check('it named the file it was reading', $('load-progress-name').textContent === 'progress.vsdx',
  $('load-progress-name').textContent);
check('the bar was drawn part-way, not only at the two ends',
  during.some(f => f.width > 0 && f.width < 100),
  JSON.stringify(during.map(f => f.width)));
check('it moved through more than one position',
  new Set(during.map(f => f.width)).size > 1, JSON.stringify([...new Set(during.map(f => f.width))]));
check('and never went backwards',
  during.every((f, i) => i === 0 || f.width >= during[i - 1].width),
  JSON.stringify(during.map(f => f.width)));
check('it said what it was doing at each step',
  new Set(during.map(f => f.stage)).size > 1, JSON.stringify([...new Set(during.map(f => f.stage))]));
check('including that it was reading the pages',
  during.some(f => /page/i.test(f.stage)), JSON.stringify([...new Set(during.map(f => f.stage))]));
check('the last thing it says is that it is drawing, which is the last thing it does',
  /draw/i.test(during.at(-1)?.stage || ''), during.at(-1)?.stage);
check('and the overlay is gone once the drawing is on screen', !shown());

// A file that cannot be read must not leave the overlay sitting over the app.
frames.length = 0;
$('error-box').textContent = '';
await dropFile(new window.File([Buffer.from('not a drawing')], 'broken.vsdx'));
check('a file that fails to parse is reported', /Failed to parse/.test($('error-box').textContent),
  $('error-box').textContent);
check('and takes the overlay down with it rather than covering the app', !shown());

check('the app used the frame callback when it had one',
  visual === (typeof window.requestAnimationFrame === 'function'));
dom.window.close();
}

await appCase({ visual: false });
await appCase({ visual: true });

console.log(`\nload-progress: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
