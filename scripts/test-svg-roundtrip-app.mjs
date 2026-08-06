// The whole detour, in the real app: open a drawing, export it as SVG, edit
// that SVG the way another editor would, drop it back, and see the drawing
// change.
//
// This is the bug the user hit. Every piece of it was already exercised in
// isolation — but the pieces were also all present before, and the round trip
// still silently discarded everything: loadFile unwrapped the embedded document
// and never looked at the picture. So the check that matters is this one, made
// against the built bundle rather than against the modules.
//
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

const confirms = [];
let confirmAnswer = true;

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.__captured = [];
    window.URL.createObjectURL = (blob) => { window.__captured.push(blob); return 'blob:fake-' + window.__captured.length; };
    window.URL.revokeObjectURL = () => {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
    window.confirm = (message) => { confirms.push(String(message)); return confirmAnswer; };
  },
});
const { window } = dom;
const captured = window.__captured;
window.HTMLAnchorElement.prototype.click = function () { /* swallow navigation */ };

// jsdom's Blob and the app's Uint8Array come from different realms.
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);
const WAIT_TIMEOUT_MS = Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000;
const waitFor = async (done) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (done()) return true;
    await sleep(25);
  }
  return false;
};
const errorBox = () => $('error-box');
const whyNot = () => 'error-box: ' + (errorBox()?.textContent.trim() || '(timed out)');
const currentSvg = () => window.document.querySelector('#svg-container svg');
const shapeIds = () => [...(currentSvg()?.querySelectorAll('[data-shape-id]') || [])]
  .map(el => el.getAttribute('data-shape-id'));

const dropFile = async (file) => {
  if (errorBox()) errorBox().textContent = '';
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  return waitFor(() => currentSvg() && currentSvg() !== previous);
};

const fixture = process.argv[2] || 'test-files/test9_rect_and_line.vsdx';
console.log(`── in-app SVG round trip: ${fixture} ──`);

const openFixture = async () => {
  confirms.length = 0;
  return dropFile(new window.File([new Uint8Array(readFileSync(fixture))], 'round-trip.vsdx'));
};

await openFixture();
check('app booted and rendered the drawing', !!currentSvg(), whyNot());
const original = shapeIds();
check('the drawing has shapes to work with', original.length > 0, String(original.length));

// ── Export it, the way a user does ──────────────────────────────────────────
async function exportSvgText() {
  const before = captured.length;
  $('btn-export').click();
  $('export-run').click();
  const got = await waitFor(() => captured.length > before);
  if (!got) throw new Error('nothing was exported');
  return captured[captured.length - 1].text();
}

const exported = await exportSvgText();
check('exporting produced an SVG', /^<svg|<svg /.test(exported.slice(0, 200)), exported.slice(0, 80));
check('…carrying the drawing inside it', exported.includes('vsdxeditor-source'));
check('…and saying which page it is', /\bpage="/.test(exported), exported.slice(0, 400));

console.log('\n1. Layers come out as layers');
check('the exported SVG has Inkscape layer groups', /inkscape:groupmode="layer"/.test(exported));
check('…that are labelled with the drawing\'s layer names', /inkscape:label="/.test(exported));
check('…and every shape sits inside one', (() => {
  const doc = new window.DOMParser().parseFromString(exported, 'image/svg+xml');
  const loose = [...doc.documentElement.children].filter(el => el.getAttribute('data-shape-id') !== null);
  return loose.length === 0;
})(), 'a shape is still at the top level');

// ── Edit it the way another editor would ────────────────────────────────────
function editSvg(text, { remove = [], add = '' } = {}) {
  const doc = new window.DOMParser().parseFromString(text, 'image/svg+xml');
  for (const id of remove) {
    const el = doc.querySelector(`[data-shape-id="${id}"]`);
    if (!el) throw new Error(`no shape ${id} in the exported SVG`);
    el.parentNode.removeChild(el);
  }
  if (add) {
    const fragment = new window.DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${add}</svg>`, 'image/svg+xml');
    for (const child of [...fragment.documentElement.children]) {
      doc.documentElement.appendChild(doc.importNode(child, true));
    }
  }
  return new window.XMLSerializer().serializeToString(doc);
}

const doomed = original[0];
const TRIANGLE = '<path id="inkscape-drawn" d="M 96 96 L 192 96 L 192 192 Z" '
  + 'style="fill:#ff0000;stroke:#0000ff;stroke-width:2"/>';

console.log('\n2. An untouched SVG still round-trips silently');
{
  confirms.length = 0;
  await dropFile(new window.File([exported], 'untouched.svg'));
  check('re-opening an unedited export asks nothing', confirms.length === 0, confirms.join(' | '));
  check('…and shows the same drawing', JSON.stringify(shapeIds()) === JSON.stringify(original),
    `${shapeIds().length} vs ${original.length}`);
}

console.log('\n3. Deletions and additions come back');
{
  await openFixture();
  const edited = editSvg(exported, { remove: [doomed], add: TRIANGLE });
  confirms.length = 0;
  confirmAnswer = true;
  const loaded = await dropFile(new window.File([edited], 'edited.svg'));
  check('the edited SVG loaded', loaded, whyNot());
  check('the app asked before rewriting the drawing', confirms.length === 1, String(confirms.length));
  check('…and said what it found',
    /1 shape added, 1 shape deleted/.test(confirms[0] || ''), confirms[0] || '');

  const after = shapeIds();
  check('the shape deleted in Inkscape is gone', !after.includes(doomed), after.join(','));
  check('the path drawn in Inkscape is there', after.length === original.length,
    `${after.length} shapes, was ${original.length}`);
  check('…and it is a shape the app can see', after.some(id => !original.includes(id)),
    `${after.join(',')} vs ${original.join(',')}`);
}

console.log('\n3b. So do changes to a shape that is still there');
{
  await openFixture();
  // Push one shape an inch across, the way dragging it in another editor does.
  const doc = new window.DOMParser().parseFromString(exported, 'image/svg+xml');
  const group = doc.querySelector(`[data-shape-id="${doomed}"]`);
  group.setAttribute('transform', `translate(96,0) ${group.getAttribute('transform') || ''}`);
  const edited = new window.XMLSerializer().serializeToString(doc);

  const before = currentSvg().querySelector(`[data-shape-id="${doomed}"]`).getAttribute('transform');
  confirms.length = 0;
  confirmAnswer = true;
  await dropFile(new window.File([edited], 'moved.svg'));
  check('the app noticed the shape had been moved', /1 shape changed/.test(confirms[0] || ''),
    confirms[0] || '(asked nothing)');

  const after = currentSvg().querySelector(`[data-shape-id="${doomed}"]`)?.getAttribute('transform');
  const dx = (t) => Number(/translate\(\s*(-?[\d.]+)/.exec(t || '')?.[1] ?? NaN);
  check('…and the drawing now draws it an inch further across',
    Math.abs(dx(after) - dx(before) - 96) < 0.01, `${before} → ${after}`);
  check('every shape is still on the page',
    shapeIds().length === original.length, `${shapeIds().length} vs ${original.length}`);
}

console.log('\n4. Saying no leaves the drawing alone');
{
  await openFixture();
  const edited = editSvg(exported, { remove: [doomed], add: TRIANGLE });
  confirms.length = 0;
  confirmAnswer = false;
  await dropFile(new window.File([edited], 'edited-cancelled.svg'));
  check('it asked', confirms.length === 1, String(confirms.length));
  check('and opened the drawing exactly as exported',
    JSON.stringify(shapeIds()) === JSON.stringify(original), shapeIds().join(','));
  confirmAnswer = true;
}

console.log('\n5. What it will not guess at');
{
  await openFixture();
  const stripped = exported.replace(/ data-shape-id="[^"]*"/g, '');
  confirms.length = 0;
  await dropFile(new window.File([stripped], 'stripped.svg'));
  check('an SVG with its shape ids stripped is not treated as a mass deletion',
    JSON.stringify(shapeIds()) === JSON.stringify(original), shapeIds().join(','));
  check('…without asking to delete everything', confirms.length === 0, confirms.join(' | '));
  check('…and it says why it did not compare',
    /shape ids/.test(errorBox()?.textContent || ''), errorBox()?.textContent || '(nothing)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
