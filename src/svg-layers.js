// Real, switchable layers in the exported SVG.
//
// A Visio layer is a property of a shape, not a container: the page is a flat
// list of <Shape> elements and each one carries a LayerMember cell naming the
// layers it belongs to. SVG has no layer concept at all, but every editor that
// pretends to have one agrees on the same convention — a <g> carrying
// inkscape:groupmode="layer" and a label — so the way to hand Inkscape real
// layers is to regroup the shapes on the way out.
//
// The catch is z-order. In SVG, paint order *is* document order; in Visio,
// z-order and layer membership are independent, so a drawing can perfectly well
// stack wall, door, wall, door. Collecting every wall into one group therefore
// moves shapes past each other, and where they overlap that changes the
// picture. Silently redrawing someone's drawing to tidy up its XML is not a
// trade worth making, so this module only merges a layer's shapes into one
// group when it can show the reordering is invisible: every pair of shapes that
// swapped has to have disjoint bounding boxes. When it cannot, the layer is
// emitted as several groups following the original order — the panel in
// Inkscape is uglier, but what it draws is exactly what Visio draws.

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
export const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
export const SODIPODI_NS = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd';

// Shapes on no layer at all. The editor already shows these under an
// "Unlayered" row, so the exported SVG calls the group the same thing.
export const UNLAYERED_LABEL = 'Unlayered';

function boxesOverlap(a, b) {
  // A shape whose box is unknown has to be assumed to overlap: the whole point
  // of the test is to refuse to move anything we cannot prove is safe to move.
  if (!a || !b) return true;
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function contiguousRuns(entries) {
  const runs = [];
  entries.forEach((entry, i) => {
    const last = runs[runs.length - 1];
    if (last && last.key === entry.key) last.members.push(i);
    else runs.push({ key: entry.key, label: entry.label, members: [i] });
  });
  return runs;
}

// `order` is the document order the merged grouping would produce, as indexes
// into `entries`. Two shapes that swapped only matter if they can be seen to
// have swapped, which needs them to overlap.
function reorderIsInvisible(entries, order) {
  const position = new Array(entries.length);
  order.forEach((original, i) => { position[original] = i; });
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].key === entries[j].key) continue;   // never swaps: same group
      if (position[i] < position[j]) continue;           // order kept
      if (boxesOverlap(entries[i].bounds, entries[j].bounds)) return false;
    }
  }
  return true;
}

/**
 * Decide how to bucket shapes into layer groups.
 *
 * `entries` are the page's top-level shapes in document order, each
 * `{ key, label, bounds }` — `key` identifying the layer (or the combination of
 * layers) the shape is on, `bounds` its page-space box or null when unknown.
 *
 * Returns `{ mode, groups }` where mode is:
 *   'layers' — one group per layer, which is what everyone wants;
 *   'runs'   — a layer split across several groups to keep the stacking order;
 *   'none'   — nothing to group.
 */
export function planLayerGroups(entries) {
  if (!entries || !entries.length) return { mode: 'none', groups: [], split: 0 };

  const runs = contiguousRuns(entries);
  const distinct = new Set(entries.map(entry => entry.key));

  // Already contiguous by layer: the merged grouping *is* the original order,
  // no proof needed.
  if (runs.length === distinct.size) return { mode: 'layers', groups: runs, split: 0 };

  const merged = [];
  const byKey = new Map();
  for (const run of runs) {
    let group = byKey.get(run.key);
    if (!group) {
      group = { key: run.key, label: run.label, members: [] };
      byKey.set(run.key, group);
      merged.push(group);
    }
    group.members.push(...run.members);
  }

  if (reorderIsInvisible(entries, merged.flatMap(group => group.members))) {
    return { mode: 'layers', groups: merged, split: 0 };
  }
  return { mode: 'runs', groups: runs, split: runs.length - distinct.size };
}

function layerNameMap(page) {
  const names = new Map();
  for (const layer of page?.layers || []) {
    names.set(String(layer.index), layer.name || layer.nameUniv || `Layer ${layer.index}`);
  }
  return names;
}

// The layer a rendered shape says it is on. renderShape writes the membership
// out as layer *indexes*; the label needs their names, and a shape on two
// layers belongs to neither alone, so the pair is its own group.
export function layerIdentity(indexes, names) {
  const parsed = [...new Set((indexes || []).map(String).map(s => s.trim()).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b));
  if (!parsed.length) return { key: '', label: UNLAYERED_LABEL };
  return {
    key: parsed.join(','),
    label: parsed.map(index => names.get(index) || `Layer ${index}`).join(' + ')
  };
}

function slugify(label, fallback) {
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `layer-${slug}` : `layer-${fallback}`;
}

/**
 * Move `svg`'s top-level shape groups into `<g inkscape:groupmode="layer">`
 * containers, in place. `options.bounds` is a Map of shape id to page-space box
 * (see collectShapeBoxes) and is what lets a split layer be merged; without it
 * nothing is ever reordered.
 *
 * Returns a summary: `{ mode, groups, split, labels }`.
 */
export function groupSvgShapesByLayer(svg, page, options = {}) {
  if (!svg) return { mode: 'none', groups: 0, split: 0, labels: [] };
  const bounds = options.bounds instanceof Map ? options.bounds : new Map();
  // Walked sibling by sibling rather than spread out of svg.children: that is a
  // live collection, and indexing it repeatedly turns this into quadratic work
  // on a drawing of several thousand shapes.
  const shapeEls = [];
  for (let node = svg.firstElementChild; node; node = node.nextElementSibling) {
    if (node.getAttribute('data-shape-id') !== null) shapeEls.push(node);
  }
  if (!shapeEls.length) return { mode: 'none', groups: 0, split: 0, labels: [] };

  const names = layerNameMap(page);
  const entries = shapeEls.map(el => {
    const identity = layerIdentity((el.getAttribute('data-layers') || '').split(','), names);
    return {
      ...identity,
      bounds: bounds.get(String(el.getAttribute('data-shape-id'))) || null,
      el
    };
  });

  const plan = planLayerGroups(entries);
  if (plan.mode === 'none') return { mode: 'none', groups: 0, split: 0, labels: [] };

  const doc = svg.ownerDocument;
  svg.setAttributeNS(XMLNS_NS, 'xmlns:inkscape', INKSCAPE_NS);
  svg.setAttributeNS(XMLNS_NS, 'xmlns:sodipodi', SODIPODI_NS);

  // Where the shapes were, so <defs> and <style> keep their place at the top.
  // The groups are assembled off to one side and put back in one go: a big
  // drawing can be thousands of shapes in hundreds of layers, and inserting
  // each group into a parent that large one at a time is what makes that slow.
  const tail = shapeEls[shapeEls.length - 1].nextSibling;
  const staging = doc.createDocumentFragment();
  const seen = new Map();
  const labels = [];

  for (const group of plan.groups) {
    const nth = (seen.get(group.key) || 0) + 1;
    seen.set(group.key, nth);
    // A layer that had to be split is named for it rather than quietly
    // appearing twice in Inkscape's panel.
    const label = nth === 1 ? group.label : `${group.label} (${nth})`;
    labels.push(label);

    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttributeNS(INKSCAPE_NS, 'inkscape:groupmode', 'layer');
    g.setAttributeNS(INKSCAPE_NS, 'inkscape:label', label);
    g.setAttribute('id', slugify(label, labels.length));

    const members = group.members.map(index => entries[index].el);
    // Shapes hidden because their layer is switched off carry display:none
    // each. Hiding the group instead — and only when every member of it is
    // hidden, which is the same condition — makes Inkscape's eye a real toggle
    // rather than something that reveals nothing.
    if (members.every(el => el.getAttribute('display') === 'none')) {
      for (const el of members) el.removeAttribute('display');
      g.setAttribute('style', 'display:none');
    } else {
      g.setAttribute('style', 'display:inline');
    }
    for (const el of members) g.appendChild(el);
    staging.appendChild(g);
  }
  svg.insertBefore(staging, tail);

  return { mode: plan.mode, groups: plan.groups.length, split: plan.split, labels };
}
