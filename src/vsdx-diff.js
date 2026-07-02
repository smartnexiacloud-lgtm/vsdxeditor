// Structural diff between two parsed VSDX documents (output of parseVsdx).
//
// Operates purely on the parsed model — no DOM, no rendering — so it runs
// headless and feeds either a text report or the viewer's visual overlay.
//
// Design notes (see also the layer-remap logic in vsdx-parser.js):
//  * Layers are matched by NAME, not IX. Removing a layer renumbers the
//    remaining layers' IX and rewrites every shape's LayerMember, so IX is
//    volatile — matching on it would report spurious churn.
//  * Shape LayerMember lists are resolved through each version's own IX->name
//    map BEFORE comparison, so membership changes read as "Walls -> Doors"
//    rather than "1 -> 0".
//  * When a layer is removed, shapes that lived only on it are pruned too.
//    Those shape removals are attributed to the layer (cascade) instead of
//    being reported as independent deletions.

const LAYER_PROPS = ['visible', 'print', 'active', 'lock', 'snap', 'glue', 'color', 'colorTrans'];

// Shape fields that represent a meaningful (visual/semantic) change. Geometry
// and text are handled separately. layerMembers is handled as membership.
const SHAPE_FIELDS = [
  'name', 'nameU', 'title', 'masterId', 'type',
  'pinX', 'pinY', 'width', 'height', 'locPinX', 'locPinY', 'angle',
  'flipX', 'flipY',
  'lineColor', 'lineWeight', 'linePattern',
  'fillForeground', 'fillBackground', 'fillPattern',
  'fillForegroundTrans', 'fillBackgroundTrans',
  'beginX', 'beginY', 'endX', 'endY',
  'rounding', 'beginArrow', 'endArrow',
  'text',
];

const layerKey = (layer) => String(layer.nameUniv || layer.name || `Layer ${layer.index}`);

// Round floats so 2.1653543... vs 2.16535431 don't register as a change.
function norm(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v;
  return v;
}

// Text can differ only in insignificant whitespace introduced by re-serializing
// the package (different XML serializers indent/space text nodes differently).
// Collapse runs of whitespace and trim so those artifacts don't read as edits.
function normField(field, v) {
  if (field === 'text' && v != null) return String(v).replace(/\s+/g, ' ').trim();
  return norm(v);
}

function indexToNameMap(page) {
  const map = new Map();
  for (const layer of page.layers || []) map.set(String(layer.index), layerKey(layer));
  return map;
}

function resolveLayerNames(shape, idxToName) {
  return (shape.layerMembers || [])
    .map((ix) => idxToName.get(String(ix)))
    .filter(Boolean)
    .sort();
}

// Flatten a page's shape tree into a Map keyed by shape id (groups + children).
function flattenShapes(shapes, out = new Map()) {
  for (const s of shapes || []) {
    if (s.id != null) out.set(String(s.id), s);
    if (s.subShapes && s.subShapes.length) flattenShapes(s.subShapes, out);
  }
  return out;
}

function geometryHash(shape) {
  // Stable, normalized string of the geometry rows for equality testing.
  try {
    return JSON.stringify(shape.geometry ?? null, (k, v) => (typeof v === 'number' ? norm(v) : v));
  } catch {
    return '';
  }
}

function shapeFieldChanges(a, b) {
  const changes = [];
  for (const f of SHAPE_FIELDS) {
    const av = normField(f, a[f]);
    const bv = normField(f, b[f]);
    if (av !== bv && !(av == null && bv == null)) changes.push({ field: f, from: a[f] ?? null, to: b[f] ?? null });
  }
  if (geometryHash(a) !== geometryHash(b)) changes.push({ field: 'geometry', from: '(geometry)', to: '(geometry)' });
  return changes;
}

function diffLayers(basePage, headPage) {
  const baseByName = new Map((basePage.layers || []).map((l) => [layerKey(l), l]));
  const headByName = new Map((headPage.layers || []).map((l) => [layerKey(l), l]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [name, l] of headByName) {
    if (!baseByName.has(name)) added.push({ name, index: l.index });
  }
  for (const [name, l] of baseByName) {
    if (!headByName.has(name)) removed.push({ name, index: l.index, cascadedShapeIds: [] });
  }
  for (const [name, bl] of baseByName) {
    const hl = headByName.get(name);
    if (!hl) continue;
    const propChanges = [];
    for (const p of LAYER_PROPS) {
      if (norm(bl[p]) !== norm(hl[p])) propChanges.push({ field: p, from: bl[p] ?? null, to: hl[p] ?? null });
    }
    if (propChanges.length) changed.push({ name, changes: propChanges });
  }
  return { added, removed, changed };
}

function diffPage(basePage, headPage) {
  const layers = diffLayers(basePage, headPage);
  const removedLayerNames = new Set(layers.removed.map((l) => l.name));
  const removedLayerByName = new Map(layers.removed.map((l) => [l.name, l]));

  const baseIdxToName = indexToNameMap(basePage);
  const headIdxToName = indexToNameMap(headPage);

  const baseShapes = flattenShapes(basePage.shapes);
  const headShapes = flattenShapes(headPage.shapes);

  const shapes = { added: [], removed: [], modified: [] };
  const membership = [];

  for (const [id, hs] of headShapes) {
    if (!baseShapes.has(id)) shapes.added.push({ id });
  }
  for (const [id, bs] of baseShapes) {
    if (!headShapes.has(id)) {
      // Was this shape pruned because its only layer(s) were removed?
      const names = resolveLayerNames(bs, baseIdxToName);
      const cascadedFromLayer =
        names.length > 0 && names.every((n) => removedLayerNames.has(n)) ? names[0] : null;
      if (cascadedFromLayer && removedLayerByName.has(cascadedFromLayer)) {
        removedLayerByName.get(cascadedFromLayer).cascadedShapeIds.push(id);
      }
      shapes.removed.push({ id, cascadedFromLayer });
      continue;
    }
    // present in both: field/geometry change + membership change (by name)
    const hs = headShapes.get(id);
    const changes = shapeFieldChanges(bs, hs);
    if (changes.length) shapes.modified.push({ id, changes });

    const from = resolveLayerNames(bs, baseIdxToName);
    const to = resolveLayerNames(hs, headIdxToName);
    if (from.join('|') !== to.join('|')) membership.push({ shapeId: id, from, to });
  }

  const status =
    layers.added.length || layers.removed.length || layers.changed.length ||
    shapes.added.length || shapes.removed.length || shapes.modified.length || membership.length
      ? 'modified'
      : 'unchanged';

  return { pageId: headPage.id, name: headPage.name, status, layers, membership, shapes };
}

export function computeDiff(base, head) {
  const basePages = new Map((base.pages || []).map((p) => [String(p.id), p]));
  const headPages = new Map((head.pages || []).map((p) => [String(p.id), p]));
  const pages = [];

  for (const [id, hp] of headPages) {
    const bp = basePages.get(id);
    if (!bp) {
      pages.push({ pageId: hp.id, name: hp.name, status: 'added', layers: emptyLayers(), membership: [], shapes: emptyShapes() });
    } else {
      pages.push(diffPage(bp, hp));
    }
  }
  for (const [id, bp] of basePages) {
    if (!headPages.has(id)) {
      pages.push({ pageId: bp.id, name: bp.name, status: 'removed', layers: emptyLayers(), membership: [], shapes: emptyShapes() });
    }
  }
  return { pages };
}

const emptyLayers = () => ({ added: [], removed: [], changed: [] });
const emptyShapes = () => ({ added: [], removed: [], modified: [] });

// Human-readable summary (for CLI / debugging).
export function summarizeDiff(diff) {
  const lines = [];
  for (const page of diff.pages) {
    if (page.status === 'unchanged') continue;
    lines.push(`Page "${page.name}" [${page.status}]`);
    for (const l of page.layers.added) lines.push(`  + layer "${l.name}"`);
    for (const l of page.layers.removed) {
      const n = l.cascadedShapeIds.length;
      lines.push(`  - layer "${l.name}"${n ? ` (removed ${n} shape${n === 1 ? '' : 's'} with it)` : ''}`);
    }
    for (const l of page.layers.changed) {
      const cs = l.changes.map((c) => `${c.field}: ${fmt(c.from)}→${fmt(c.to)}`).join(', ');
      lines.push(`  ~ layer "${l.name}" (${cs})`);
    }
    for (const m of page.membership) {
      lines.push(`  ~ shape ${m.shapeId} layer ${fmt(m.from.join('+') || '(none)')}→${fmt(m.to.join('+') || '(none)')}`);
    }
    for (const s of page.shapes.added) lines.push(`  + shape ${s.id}`);
    for (const s of page.shapes.removed) {
      if (!s.cascadedFromLayer) lines.push(`  - shape ${s.id}`);
    }
    for (const s of page.shapes.modified) {
      const cs = s.changes.map((c) => c.field).join(', ');
      lines.push(`  ~ shape ${s.id} (${cs})`);
    }
  }
  return lines.join('\n') || '(no differences)';
}

const fmt = (v) => (v === true ? 'on' : v === false ? 'off' : v == null ? '(none)' : String(v));
