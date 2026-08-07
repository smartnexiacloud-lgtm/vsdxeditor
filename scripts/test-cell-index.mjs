// Reading a shape means asking for dozens of its cells by name, and a shape in
// a real drawing carries dozens of them — so a scan per name is a scan of the
// whole shape per cell read. It was the most expensive thing in opening a large
// file: caching it took a 20 MB drawing from 34.5 s to 17.9 s.
//
// A cache in a parser that also *writes* XML is only safe if it cannot go
// stale, and vsdx-parser.js adds and removes Cell elements in five places, with
// more to come. So getCell does not trust its writers to tell it: it records
// how many children the element had when it built the table and rebuilds when
// that changes. This test is what says so — it mutates the DOM behind the
// cache's back, with no invalidation call at all, and expects the truth.
//
// getCell is private to the parser and should stay that way, so this reaches it
// by exporting it from a *copy* of the source. If this file stops compiling
// because getCell was renamed, the thing to check is that whatever replaced it
// still cannot serve a stale cell.
import { JSDOM } from 'jsdom';
import { mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-cell-index-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');
appendFileSync(join(tmp, 'vsdx-parser.js'),
  '\nexport { getCell as __getCell, removeCell as __removeCell, getOrCreateCell as __getOrCreateCell };\n');

const {
  __getCell: getCell,
  __removeCell: removeCell,
  __getOrCreateCell: getOrCreateCell
} = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

const VISIO = 'http://schemas.microsoft.com/office/visio/2012/main';
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const cellOf = (doc, name, value) => {
  const cell = doc.createElementNS(VISIO, 'Cell');
  cell.setAttribute('N', name);
  cell.setAttribute('V', value);
  return cell;
};

console.log('── the parser\'s cell index ──');

const doc = parse(`<Shape xmlns="${VISIO}" ID="7">`
  + '<Cell N="PinX" V="1"/><Cell N="PinY" V="2"/>'
  + '<Shapes><Shape ID="8"><Cell N="PinX" V="99"/></Shape></Shapes>'
  + '</Shape>');
const shape = doc.documentElement;

check('a cell is found by name', getCell(shape, 'PinX')?.getAttribute('V') === '1',
  getCell(shape, 'PinX')?.getAttribute('V'));
check('and asking twice gives the same element', getCell(shape, 'PinX') === getCell(shape, 'PinX'));
check('a cell that is not there is null', getCell(shape, 'Width') === null);
check('a nested shape\'s cells are not this shape\'s',
  getCell(shape, 'PinX')?.getAttribute('V') !== '99');

// Now go behind the cache's back: no invalidation, no notification, nothing.
const width = cellOf(doc, 'Width', '3');
shape.appendChild(width);
check('a cell appended without telling the cache is still found',
  getCell(shape, 'Width')?.getAttribute('V') === '3', String(getCell(shape, 'Width')));

shape.removeChild(width);
check('and once removed it is gone again', getCell(shape, 'Width') === null,
  String(getCell(shape, 'Width')?.getAttribute('V')));
check('the cells around it still read correctly',
  getCell(shape, 'PinX')?.getAttribute('V') === '1' && getCell(shape, 'PinY')?.getAttribute('V') === '2');

// The value is on the element the table holds, so changing it needs no
// invalidation — and must not be missed either.
getCell(shape, 'PinX').setAttribute('V', '42');
check('a changed value is read back, not the one that was cached',
  getCell(shape, 'PinX')?.getAttribute('V') === '42', getCell(shape, 'PinX')?.getAttribute('V'));

// One cell out, another in, between two reads: the child count comes back to
// where it started, which is the case the counter alone cannot see. This is why
// the parser's own writers invalidate as well — so it is done through them,
// which is how every cell in this file is added and removed.
const doc2 = parse(`<Row xmlns="${VISIO}" IX="0"><Cell N="Visible" V="1"/></Row>`);
const row = doc2.documentElement;
check('the row reads before it is rewritten', getCell(row, 'Visible')?.getAttribute('V') === '1');
removeCell(row, 'Visible');
getOrCreateCell(doc2, row, 'Print').setAttribute('V', '0');
check('a swap that leaves the child count where it was still reports the removal',
  getCell(row, 'Visible') === null, String(getCell(row, 'Visible')?.getAttribute('V')));
check('…and finds what replaced it', getCell(row, 'Print')?.getAttribute('V') === '0',
  String(getCell(row, 'Print')?.getAttribute('V')));

// The same swap done straight on the DOM: a removal is caught whichever way it
// was made, because a cell that is no longer a child of the element cannot be
// that element's cell.
const doc3 = parse(`<Row xmlns="${VISIO}" IX="1"><Cell N="Visible" V="1"/></Row>`);
const raw = doc3.documentElement;
check('the second row reads too', getCell(raw, 'Visible')?.getAttribute('V') === '1');
raw.removeChild(getCell(raw, 'Visible'));
raw.appendChild(cellOf(doc3, 'Print', '0'));
check('a cell taken off the element is not handed back',
  getCell(raw, 'Visible') === null, String(getCell(raw, 'Visible')?.getAttribute('V')));

console.log(`\ncell-index: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
