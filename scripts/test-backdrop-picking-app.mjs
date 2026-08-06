// End-to-end test against the REAL built app (dist/) for one thing: a page that
// names a background page is *drawn* as the backdrop's shapes with its own on
// top, and the right-click "Select component" list has to offer both. It used to
// hit-test the foreground page alone, so a backdrop shape was one you could see,
// could right-click straight through, and could not pick — exactly the shapes
// behind the ones in front. Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';
import JSZip from 'jszip';

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
    if (!window.CSS) window.CSS = {};
    if (!window.CSS.escape) window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);
const currentSvg = () => window.document.querySelector('#svg-container svg');
const pickRows = () => [...window.document.querySelectorAll('#shape-pick-list .shape-pick-row')];
const rowText = (row) => row.textContent.replace(/\s+/g, ' ').trim();

const WAIT_TIMEOUT_MS = Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000;
const dropFile = async (file) => {
  if ($('error-box')) $('error-box').textContent = '';
  // The second drop replaces an SVG that is already there, so waiting for "an
  // SVG exists" would return before the new file had loaded at all.
  const previous = currentSvg();
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  $('drop-zone').dispatchEvent(ev);
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const svg = currentSvg();
    if (svg && svg !== previous) return true;
    if ($('error-box')?.textContent.trim()) return false;
    await sleep(25);
  }
  return false;
};

// ── A drawing with a backdrop ─────────────────────────────────────────────
// No fixture has one, so build it: a second page marked Background='1' holding
// one big rectangle, and a BackPage cell on Page-1 pointing at it. This is the
// shape of file the bug is about — a title block or frame on a backdrop, with
// the drawing on top of it.
const NS = "xmlns='http://schemas.microsoft.com/office/visio/2012/main' " +
  "xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships' xml:space='preserve'";
const BACKDROP_ID = 900;
const backdropContents =
  `<?xml version='1.0' encoding='utf-8' ?>\n<PageContents ${NS}><Shapes>` +
  `<Shape ID='${BACKDROP_ID}' Type='Shape' LineStyle='3' FillStyle='3' TextStyle='3'>` +
  `<Cell N='PinX' V='4'/><Cell N='PinY' V='5.8'/><Cell N='Width' V='8'/><Cell N='Height' V='11'/>` +
  `<Cell N='LocPinX' V='4' F='Width*0.5'/><Cell N='LocPinY' V='5.5' F='Height*0.5'/>` +
  `<Cell N='Angle' V='0'/><Cell N='FlipX' V='0'/><Cell N='FlipY' V='0'/>` +
  `<Section N='Geometry' IX='0'><Cell N='NoFill' V='0'/><Cell N='NoLine' V='0'/><Cell N='NoShow' V='0'/>` +
  `<Row T='RelMoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>` +
  `<Row T='RelLineTo' IX='2'><Cell N='X' V='1'/><Cell N='Y' V='0'/></Row>` +
  `<Row T='RelLineTo' IX='3'><Cell N='X' V='1'/><Cell N='Y' V='1'/></Row>` +
  `<Row T='RelLineTo' IX='4'><Cell N='X' V='0'/><Cell N='Y' V='1'/></Row>` +
  `<Row T='RelLineTo' IX='5'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row></Section>` +
  `<Text>Title block</Text></Shape></Shapes></PageContents>`;

const zip = await JSZip.loadAsync(readFileSync('test-files/test3_house.vsdx'));

let pagesXml = await zip.file('visio/pages/pages.xml').async('string');
// Page-1 now names the backdrop…
pagesXml = pagesXml.replace("<Cell N='PageWidth'", "<Cell N='BackPage' V='99'/><Cell N='PageWidth'");
// …and the backdrop page itself goes in beside it.
pagesXml = pagesXml.replace('</Pages>',
  `<Page ID='99' NameU='Backdrop' Name='Backdrop' Background='1'><PageSheet>` +
  `<Cell N='PageWidth' V='8.26771653543307'/><Cell N='PageHeight' V='11.69291338582677'/>` +
  `</PageSheet><Rel r:id='rId2'/></Page></Pages>`);
zip.file('visio/pages/pages.xml', pagesXml);

zip.file('visio/pages/page2.xml', backdropContents);
zip.file('visio/pages/_rels/pages.xml.rels',
  (await zip.file('visio/pages/_rels/pages.xml.rels').async('string')).replace('</Relationships>',
    '<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page2.xml"/></Relationships>'));
zip.file('[Content_Types].xml',
  (await zip.file('[Content_Types].xml').async('string')).replace('</Types>',
    '<Override PartName="/visio/pages/page2.xml" ContentType="application/vnd.ms-visio.page+xml"/></Types>'));

const bytes = await zip.generateAsync({ type: 'uint8array' });

console.log('── in-app backdrop picking ──');
check('the app booted with a drawing that has a backdrop',
  await dropFile(new window.File([bytes], 'backdrop.vsdx')), $('error-box')?.textContent);

// ── 1. The backdrop is drawn ──────────────────────────────────────────────
const drawn = (id) => !!window.document.querySelector(`#svg-container svg g[data-shape-id="${id}"]`);
check('the backdrop shape is on the canvas', drawn(BACKDROP_ID));
check('and it is drawn behind the page\'s own shapes',
  [...currentSvg().querySelectorAll('g[data-shape-id]')][0]?.getAttribute('data-shape-id') === String(BACKDROP_ID),
  [...currentSvg().querySelectorAll('g[data-shape-id]')].slice(0, 3).map(g => g.getAttribute('data-shape-id')).join(','));
check('only the foreground page gets a tab — the backdrop is not one you switch to',
  [...window.document.querySelectorAll('#page-tabs .page-tab')].length <= 1,
  String(window.document.querySelectorAll('#page-tabs .page-tab').length));

// ── 2. The case this exists for ───────────────────────────────────────────
// Right-click on a spot covered by both the house group and the backdrop. The
// house is in front; the backdrop is the shape behind, and it used to be
// unreachable.
const houseGroup = [...currentSvg().querySelectorAll('g[data-shape-id="7"]')][0];
check('the drawing has a shape in front to click through', !!houseGroup);

const svgRect = currentSvg().getBoundingClientRect?.() || {};
// The fallback path in clientToPageUnits maps client pixels through the viewBox;
// with no layout it uses pan/zoom, which at 1:1 makes user units client pixels.
const dpi = 96;
const pageHeight = 11.69291338582677;
const clientX = 5.4 * dpi;
const clientY = (pageHeight - 9.0) * dpi;
houseGroup.dispatchEvent(new window.MouseEvent('contextmenu', {
  bubbles: true, cancelable: true, clientX, clientY,
}));
await sleep(60);

check('the context menu opened', $('shape-context-menu').classList.contains('visible'));
const rows = pickRows();
const ids = rows.map(r => r.dataset.shapeId);
check('the list offers more than the shape on top', rows.length > 1, `${rows.length} rows: ${ids.join(',')}`);
check('the shape in front is offered', ids.includes('7') || ids.includes('8') || ids.includes('9'), ids.join(','));
check('and so is the one behind it, on the backdrop', ids.includes(String(BACKDROP_ID)), ids.join(','));

const backdropRow = rows.find(r => r.dataset.shapeId === String(BACKDROP_ID));
check('the backdrop row says where it comes from, so it is not mistaken for this page\'s',
  /background/i.test(rowText(backdropRow)), rowText(backdropRow));
check('the hint counts everything under the cursor, backdrop included',
  new RegExp(`\\b${rows.length}\\b`).test($('shape-pick-hint').textContent), $('shape-pick-hint').textContent);

// ── 3. Picking the one behind ─────────────────────────────────────────────
backdropRow.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
check('hovering it draws a selection square, same as any other row',
  !!window.document.querySelector('#svg-container #shape-highlight'));
backdropRow.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));

backdropRow.click();
await sleep(60);
check('clicking it does not shut the menu it was offered in',
  $('shape-context-menu').classList.contains('visible'));
check('and it selects the shape on the canvas',
  (window.document.querySelector(`#svg-container svg g[data-shape-id="${BACKDROP_ID}"]`)?.style.outline || '').includes('solid'),
  window.document.querySelector(`#svg-container svg g[data-shape-id="${BACKDROP_ID}"]`)?.style.outline);
check('the menu says the shape lives on the background page rather than offering this page\'s layers',
  /background page/i.test($('shape-context-list').textContent), $('shape-context-list').textContent.trim().slice(0, 120));
check('and no layer of this page is presented as assignable to it',
  window.document.querySelectorAll('#shape-context-list .shape-context-item').length === 0,
  String(window.document.querySelectorAll('#shape-context-list .shape-context-item').length));

// ── 4. A page with no backdrop is untouched ───────────────────────────────
check('a plain page still lists only its own shapes',
  await dropFile(new window.File([readFileSync('test-files/test3_house.vsdx')], 'plain.vsdx')),
  $('error-box')?.textContent);
const plainHouse = currentSvg().querySelector('g[data-shape-id="7"]');
plainHouse?.dispatchEvent(new window.MouseEvent('contextmenu', {
  bubbles: true, cancelable: true, clientX, clientY,
}));
await sleep(60);
const plainIds = pickRows().map(r => r.dataset.shapeId);
check('nothing from a backdrop appears where there is no backdrop',
  plainIds.length > 0 && !plainIds.includes(String(BACKDROP_ID)), plainIds.join(','));
check('and no row claims to be from a background page',
  pickRows().every(r => !/background/i.test(rowText(r))),
  pickRows().map(rowText).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
