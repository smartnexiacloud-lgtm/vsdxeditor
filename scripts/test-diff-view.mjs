// Headless (jsdom) exercise of the diff VIEW: mount openDiffView on real diffs
// and assert the produced DOM — classifications, cascade summary, mode toggle,
// removed-shape cloning. getBBox is unavailable in jsdom so highlight rects are
// skipped (guarded); dataset.diff is still set, which is what we assert on.

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import JSZip from 'jszip';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

// jsdom has no layout engine, so getBBox throws. Stub it so the highlight-rect
// code path in diff-view actually executes and can be asserted (a real browser
// supplies the true geometry). renderPage itself never calls getBBox.
dom.window.SVGElement.prototype.getBBox = function () {
  return { x: 10, y: 20, width: 100, height: 60 };
};

// OS tmpdir + cleanup on exit, so no .tmp-esm-* dirs are left in the repo.
const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-diffview-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
// Symlink the project's node_modules so bare imports still resolve out of tree.
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');
const copy = (src, dst, reps = []) => {
  let code = readFileSync(src, 'utf8');
  for (const [a, b] of reps) code = code.replace(a, b);
  writeFileSync(join(tmp, dst), code);
};
copy('src/shape-inheritance.js', 'shape-inheritance.mjs');
copy('src/parse-progress.js', 'parse-progress.mjs');
copy('src/svg-renderer.js', 'svg-renderer.mjs');
copy('src/vsdx-diff.js', 'vsdx-diff.mjs');
copy('src/vsdx-parser.js', 'vsdx-parser.mjs', [
  [/from '\.\/shape-inheritance\.js'/g, "from './shape-inheritance.mjs'"],
  [/from '\.\/parse-progress\.js'/g, "from './parse-progress.mjs'"],
  [/from '\.\/svg-renderer\.js'/g, "from './svg-renderer.mjs'"],
]);
copy('src/diff-view.js', 'diff-view.mjs', [
  [/from '\.\/vsdx-parser\.js'/g, "from './vsdx-parser.mjs'"],
  [/from '\.\/svg-renderer\.js'/g, "from './svg-renderer.mjs'"],
  [/from '\.\/vsdx-diff\.js'/g, "from './vsdx-diff.mjs'"],
]);
const imp = (n) => import(pathToFileURL(join(tmp, n)).href);
const { parseVsdx, saveVsdxWithoutNonSelectedLayers } = await imp('vsdx-parser.mjs');
const { openDiffView } = await imp('diff-view.mjs');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};
const q = (sel) => document.querySelectorAll(sel);

// ── Scenario 1: layer removal (cascade) ─────────────────────────────────────
{
  console.log('\n── scenario: layer removal ──');
  const buf = new Uint8Array(readFileSync('test-files/test4_connectors.vsdx')).buffer;
  const base = await parseVsdx(buf);
  const page = base.pages.find((p) => (p.layers || []).length > 0);
  const keep = new Set(page.layers.slice(1).map((l) => String(l.index)));
  const doomed = page.layers[0].name;
  const { buffer: headBuf } = await saveVsdxWithoutNonSelectedLayers(buf, base.pages, page.id, keep);

  const mount = document.createElement('div');
  document.body.append(mount);
  const ctrl = await openDiffView({ baseBuffer: buf, headBuffer: headBuf, baseName: 'base', headName: 'pruned', mount });

  check('diff-root mounted', !!document.querySelector('.diff-root'));
  const summaryText = document.querySelector('.diff-summary').textContent;
  check('summary reports removed layer by name', summaryText.includes(`layer "${doomed}"`), summaryText);
  check('summary reports cascade shape removal', /removed \d+ shapes? with it/.test(summaryText), summaryText);

  // overlay mode (default): removed shapes cloned from base and flagged
  const removedInOverlay = q('.diff-canvas [data-diff="removed"]').length;
  check('overlay clones removed shapes flagged removed', removedInOverlay >= 1, `count=${removedInOverlay}`);
  check('overlay has exactly one svg', q('.diff-canvas svg').length === 1, `svgs=${q('.diff-canvas svg').length}`);

  // highlight rects actually drawn, in the removed color (#dc2626)
  const redRects = [...q('.diff-canvas rect[data-diff-highlight="removed"]')];
  check('removed highlight rects drawn', redRects.length >= 1, `count=${redRects.length}`);
  check('removed rects use red stroke', redRects.every((r) => r.getAttribute('stroke') === '#dc2626'));

  // side-by-side
  ctrl.setMode('sidebyside');
  check('side-by-side renders two panes', q('.diff-split .diff-pane').length === 2);
  const leftRemoved = q('.diff-split .diff-pane:first-child [data-diff="removed"]').length;
  check('base (left) pane flags removed shapes', leftRemoved >= 1, `count=${leftRemoved}`);

  ctrl.close();
  check('exit removes diff-root', !document.querySelector('.diff-root'));
}

// ── Scenario 2: modified shape (edit a PinX in head) ────────────────────────
{
  console.log('\n── scenario: modified shape ──');
  const raw = readFileSync('test-files/test9_rect_and_line.vsdx');
  const buf = new Uint8Array(raw).buffer;

  // Build a head buffer with one shape moved (PinX changed) by rewriting page XML.
  const zip = await JSZip.loadAsync(raw);
  const pagePath = Object.keys(zip.files).find((p) => /visio\/pages\/page\d+\.xml$/i.test(p));
  let xml = await zip.file(pagePath).async('string');
  const before = xml;
  xml = xml.replace(/(N=['"]PinX['"]\s+V=['"])[^'"]*(['"])/, '$14.5$2');
  if (xml === before) throw new Error('could not find a PinX cell to edit');
  zip.file(pagePath, xml);
  const headBuf = await zip.generateAsync({ type: 'arraybuffer' });

  const mount = document.createElement('div');
  document.body.append(mount);
  const ctrl = await openDiffView({ baseBuffer: buf, headBuffer: headBuf, baseName: 'base', headName: 'moved', mount });
  ctrl.setMode('sidebyside');

  const summaryText = document.querySelector('.diff-summary').textContent;
  check('summary lists a modified shape (pinX)', /shape .*pinX/i.test(summaryText) || /shape .*: .*pinX/i.test(summaryText), summaryText);
  const modBase = q('.diff-split .diff-pane:first-child [data-diff="modified"]').length;
  const modHead = q('.diff-split .diff-pane:last-child [data-diff="modified"]').length;
  check('modified shape flagged on both panes', modBase >= 1 && modHead >= 1, `base=${modBase} head=${modHead}`);
  ctrl.close();
}

console.log(`\ndiff-view: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
