// The layer-tree module on its own: no DOM, no document, just the rule that
// turns a flat list of Visio layer names into a tree by splitting on a
// delimiter. Everything the sidebar does — nesting, collapse, group
// checkboxes, group rename — is built on these four functions, so the awkward
// names (a layer that is also a parent, duplicate full names, names that are
// nothing but delimiters) are worth pinning down here rather than through the UI.
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-layertree-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));

const { splitLayerPath, buildLayerTree, layersUnder, flattenLayerTree, groupKeys } =
  await import(pathToFileURL(join(tmp, 'layer-tree.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const layers = (...names) => names.map((name, i) => ({ layer: { index: String(i), name }, name }));
const paths = (nodes) => flattenLayerTree(nodes).map(node => `${node.path}${node.layer ? '*' : ''}`);

console.log('\nsplitLayerPath');
check('splits on the delimiter', String(splitLayerPath('a/b/c', '/')) === 'a,b,c');
check('trims each segment', String(splitLayerPath('a / b', '/')) === 'a,b');
check('no delimiter means one segment', String(splitLayerPath('a/b', '')) === 'a/b');
check('a multi-character delimiter works', String(splitLayerPath('a::b', '::')) === 'a,b');
// Otherwise a layer called "/" would have no segments at all and vanish.
check('a name of nothing but delimiters stays a leaf', String(splitLayerPath('//', '/')) === '//');
check('empty segments are dropped', String(splitLayerPath('a//b', '/')) === 'a,b');

console.log('\nbuildLayerTree');
{
  const tree = buildLayerTree(layers('Electrical/HV', 'Electrical/LV', 'Plumbing/Cold'), '/');
  check('shared prefixes become one group', tree.length === 2, paths(tree).join(' '));
  check('rows come out in tree order',
    paths(tree).join(' ') === 'Electrical Electrical/HV* Electrical/LV* Plumbing Plumbing/Cold*',
    paths(tree).join(' '));
  check('a group node carries no layer', tree[0].layer === null);
  check('depth counts from zero', tree[0].depth === 0 && tree[0].children[0].depth === 1);
  check('a leaf keeps its own layer', tree[0].children[0].layer.name === 'Electrical/HV');
  check('segment is the last part only', tree[0].children[0].segment === 'HV');
}
{
  const tree = buildLayerTree(layers('A/B/C/D'), '/');
  check('nesting goes as deep as the name does',
    paths(tree).join(' ') === 'A A/B A/B/C A/B/C/D*', paths(tree).join(' '));
}
{
  // "Electrical" is a real layer AND the parent of "Electrical/HV".
  const tree = buildLayerTree(layers('Electrical', 'Electrical/HV'), '/');
  check('a layer can also be a parent', tree.length === 1 && tree[0].layer?.name === 'Electrical');
  check('its children still nest under it', tree[0].children.length === 1);
}
{
  // Order reversed: the parent arrives after the child has already made the node.
  const tree = buildLayerTree(layers('Electrical/HV', 'Electrical'), '/');
  check('parent-after-child fills in the same node',
    tree.length === 1 && tree[0].layer?.name === 'Electrical' && tree[0].children.length === 1);
}
{
  // Duplicate names are rejected by the editor, but a file can already contain
  // them, and a row that silently disappears is worse than two identical rows.
  const tree = buildLayerTree(layers('Dup', 'Dup'), '/');
  check('two layers with one name get two rows', tree.length === 2, paths(tree).join(' '));
  check('their keys differ so collapse state cannot collide', tree[0].key !== tree[1].key);
}
{
  const flat = buildLayerTree(layers('Electrical/HV', 'Plumbing/Cold'), '');
  check('no delimiter leaves every layer at the top',
    flat.length === 2 && flat.every(node => node.layer && !node.children.length));
}
{
  const dotted = buildLayerTree(layers('Electrical.HV', 'Electrical.LV'), '.');
  check('the delimiter is taken literally, not as a regex',
    paths(dotted).join(' ') === 'Electrical Electrical.HV* Electrical.LV*', paths(dotted).join(' '));
}

console.log('\nlayersUnder');
{
  const tree = buildLayerTree(layers('E', 'E/HV', 'E/LV', 'P/Cold'), '/');
  const under = layersUnder(tree[0]).map(layer => layer.name);
  check('a group collects every layer below it', under.join(' ') === 'E E/HV E/LV', under.join(' '));
  check('a leaf collects only itself', layersUnder(tree[1]).length === 1);
}

console.log('\nflattenLayerTree');
{
  const tree = buildLayerTree(layers('Electrical/HV', 'Electrical/LV', 'Plumbing/Cold'), '/');
  const rows = flattenLayerTree(tree, node => node.path === 'Electrical');
  check('a collapsed group hides its children but keeps itself',
    rows.map(node => node.path).join(' ') === 'Electrical Plumbing Plumbing/Cold',
    rows.map(node => node.path).join(' '));
}

console.log('\ngroupKeys');
{
  const tree = buildLayerTree(layers('A/B/C', 'A/D', 'E'), '/');
  check('every node with children, nothing else',
    groupKeys(tree).join(' ') === 'A A/B', groupKeys(tree).join(' '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
