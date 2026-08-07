// The canvas is rendered without Visio's property blocks, and they are put back
// on the way out to a file. This is the test that says the two halves of that
// bargain add up.
//
// Why it matters: on a real drawing (8,470 shapes) the v:custProps and
// v:userDefs blocks are 66,734 of the SVG's 99,519 elements — three quarters of
// a document the browser has to build, keep, style and search on every hit
// test, and not one of those elements is ever painted or read back off the
// canvas. Leaving them out is the single biggest thing that can be done about a
// large drawing feeling heavy. Losing them from an exported file, on the other
// hand, would be a much worse bug than the slowness it fixed.
//
// So the check here is not "some metadata came back": it is that a lean render
// with the blocks reattached is *character for character* the document the full
// render produces. Anything that drifts — a block in the wrong place, an
// attribute dropped, a shape missed — fails.
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const dom = new JSDOM('<!doctype html><html><body><div id="a"></div><div id="b"></div></body></html>');
for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-meta-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { parseVsdx } = await import(pathToFileURL(join(tmp, 'vsdx-parser.js')));
const { renderPage, attachVisioMetadata } = await import(pathToFileURL(join(tmp, 'svg-renderer.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};

const serialize = (svg) => new XMLSerializer().serializeToString(svg);
const count = (svg, tag) => svg.getElementsByTagNameNS('*', tag).length;

const fixtures = process.argv.slice(2);
if (!fixtures.length) fixtures.push('test-files/test3_house.vsdx', 'test-files/test4_connectors.vsdx');

for (const fixture of fixtures) {
  console.log(`── render metadata: ${fixture} ──`);
  const pkg = await parseVsdx(readFileSync(fixture));

  for (const page of pkg.pages) {
    const label = `page ${page.name || page.id}`;

    // What the model actually has, so a fixture that carries no properties at
    // all cannot pass this by having nothing to lose.
    let userDefs = 0, customProps = 0, shapes = 0;
    const walk = (list) => {
      for (const shape of list || []) {
        shapes++;
        userDefs += (shape.userDefs || []).length;
        customProps += (shape.customProps || []).length;
        walk(shape.subShapes);
      }
    };
    walk(page.shapes);

    const full = renderPage(page, document.getElementById('a'));
    const lean = renderPage(page, document.getElementById('b'), { metadata: false });

    check(`${label}: the full render carries every user cell the model has`,
      count(full, 'ud') === userDefs, `${count(full, 'ud')} v:ud vs ${userDefs}`);
    check(`${label}: …and every Shape Data row`,
      count(full, 'cp') === customProps, `${count(full, 'cp')} v:cp vs ${customProps}`);

    check(`${label}: the lean render has none of them`,
      count(lean, 'ud') === 0 && count(lean, 'cp') === 0
      && count(lean, 'userDefs') === 0 && count(lean, 'custProps') === 0,
      `${count(lean, 'ud')} v:ud, ${count(lean, 'cp')} v:cp`);
    check(`${label}: but keeps the titles, which are what the browser shows on hover`,
      count(lean, 'title') === count(full, 'title'),
      `${count(lean, 'title')} vs ${count(full, 'title')}`);
    check(`${label}: and draws exactly the same shapes`,
      count(lean, 'path') === count(full, 'path') && count(lean, 'g') === count(full, 'g'),
      `${count(lean, 'path')}/${count(lean, 'g')} vs ${count(full, 'path')}/${count(full, 'g')}`);

    if (userDefs + customProps > 0) {
      const saved = count(full, '*') - count(lean, '*');
      check(`${label}: which is a smaller document — ${saved} elements fewer`, saved > 0, String(saved));
    }

    const wanted = serialize(full);
    const restored = serialize(attachVisioMetadata(lean, page));
    check(`${label}: putting the blocks back rebuilds the full render exactly`,
      restored === wanted, firstDifference(restored, wanted));
  }
}

// A 4 MB diff is no use to anyone; say where they part company and show that.
function firstDifference(got, want) {
  if (got === want) return '';
  let i = 0;
  while (i < got.length && i < want.length && got[i] === want[i]) i++;
  return `differ at ${i}:\n    got  …${got.slice(Math.max(0, i - 60), i + 120)}\n    want …${want.slice(Math.max(0, i - 60), i + 120)}`;
}

console.log(`\nrender-metadata: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
