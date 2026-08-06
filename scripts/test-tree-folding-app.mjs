// Folding the trees up.
//
// Both trees in this app can get long: a drawing where everything is inside a
// group, and a drawing whose layer names fake a folder hierarchy. Each grew a
// twisty per row and nothing to act on the lot, so tidying a hundred rows meant
// a hundred clicks.
//
// The interesting one is "collapse unselected", and the reason it is
// interesting is that the Shape Tree used to reopen the path down to the
// selected shape on *every* render — so folding anything the selection was
// inside came undone the moment the tree redrew for any reason at all.
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

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
    window.Element.prototype.scrollIntoView = function () {};
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

const fixture = process.argv[2] || 'test-files/test3_house.vsdx';
console.log(`── tree folding: ${fixture} ──`);

const ev = new window.Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(ev, 'dataTransfer', {
  value: { files: [new window.File([new Uint8Array(readFileSync(fixture))], 'folding.vsdx')] }
});
$('drop-zone').dispatchEvent(ev);
await waitFor(() => currentSvg());
check('the drawing opened', !!currentSvg(), $('error-box')?.textContent || '');

// ── Shape Tree ───────────────────────────────────────────────────────────────
console.log('\n1. The Shape Tree');

const rows = () => [...$('shape-tree-body').querySelectorAll('.shape-tree-node')];
const rowFor = (id) => rows().find(row => row.dataset.shapeId === String(id));
const openBranches = () => rows().filter(row => row.getAttribute('aria-expanded') === 'true');
const shutBranches = () => rows().filter(row => row.getAttribute('aria-expanded') === 'false');

// Select something so the tree is on screen at all, then find a group deep
// enough to have a branch above it.
const group = [...currentSvg().querySelectorAll('[data-shape-id]')]
  .find(el => el.querySelector('[data-shape-id]'));
check('the drawing has a group to fold', !!group);
const child = group.querySelector('[data-shape-id]');
const childId = child.getAttribute('data-shape-id');
const groupId = group.getAttribute('data-shape-id');

child.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await waitFor(() => rows().length > 0);
check('selecting a shape inside a group shows the tree', rows().length > 0, String(rows().length));
check('…with the way down to it open', !!rowFor(childId), `no row for ${childId}`);
check('the controls are there', !!$('shape-tree-collapse-all') && !!$('shape-tree-expand-all')
  && !!$('shape-tree-collapse-others'));

{
  $('shape-tree-collapse-all').click();
  check('Collapse all folds every group', openBranches().length === 0,
    openBranches().map(r => r.dataset.shapeId).join(','));
  check('…and the shape inside one is no longer listed', !rowFor(childId));
  check('…and it stays folded when the tree redraws',
    (() => { window.dispatchEvent(new window.Event('resize')); return openBranches().length === 0; })(),
    openBranches().map(r => r.dataset.shapeId).join(','));
}
{
  $('shape-tree-expand-all').click();
  check('Expand all opens every group', shutBranches().length === 0,
    shutBranches().map(r => r.dataset.shapeId).join(','));
  check('…so the nested shape is listed again', !!rowFor(childId));
}
{
  $('shape-tree-collapse-others').click();
  check('Collapse unselected keeps the selected shape reachable', !!rowFor(childId),
    rows().map(r => r.dataset.shapeId).join(','));
  check('…by leaving the group it is in open',
    rowFor(groupId)?.getAttribute('aria-expanded') === 'true',
    rowFor(groupId)?.getAttribute('aria-expanded'));
  const strangers = openBranches().filter(row =>
    row.dataset.shapeId !== groupId && row.dataset.shapeId !== childId);
  check('…and folding everything that is not on the way to it',
    strangers.length === 0, strangers.map(r => r.dataset.shapeId).join(','));
}
{
  // The regression the reveal-on-every-render behaviour caused: fold the branch
  // you are working in and it must stay folded.
  $('shape-tree-collapse-all').click();
  const collapsedRows = rows().length;
  $('btn-layers').click();
  $('btn-layers').click();
  check('a branch folded by hand is not reopened by unrelated redraws',
    rows().length === collapsedRows, `${rows().length} vs ${collapsedRows}`);
}
{
  // …but picking a *different* shape still has to show you where it is.
  const other = [...currentSvg().querySelectorAll('[data-shape-id]')]
    .find(el => el.getAttribute('data-shape-id') !== childId
      && el.getAttribute('data-shape-id') !== groupId
      && el.closest('[data-shape-id]:not([data-shape-id="' + el.getAttribute('data-shape-id') + '"])'));
  if (other) {
    const otherId = other.getAttribute('data-shape-id');
    other.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => rowFor(otherId));
    check('selecting a shape still opens the way down to it', !!rowFor(otherId), otherId);
  }
}

// ── Layer tree ───────────────────────────────────────────────────────────────
console.log('\n2. The layer tree');
{
  check('the layer tree has a collapse-unselected control too',
    !!$('layer-tree-collapse-others'), 'no button');
  check('…and the collapse-all it already had', !!$('layer-tree-toggle-all'));
  // Grouping is off by default, and the controls are meaningless without it.
  check('it is disabled while the layers are a flat list',
    $('layer-tree-toggle-all').disabled === true, 'enabled with no tree');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
