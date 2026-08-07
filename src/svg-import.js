// Reading an edited SVG back into the drawing.
//
// An SVG exported by this app carries the whole source document as base64
// metadata (src/svg-vsdx-embed.js), and re-opening one used to mean unwrapping
// that and throwing the picture away — so a detour through Inkscape round-
// tripped perfectly and silently lost every edit made there.
//
// What the picture can still be trusted to say is which shapes are *gone* and
// which drawn things are *new*, because renderShape stamps every shape's group
// with data-shape-id. So:
//
//   removed — an id the drawing has and the SVG no longer does. Deleting a
//             group in Inkscape takes its children's ids with it, which reads
//             correctly as deleting the group.
//   added   — a drawable element sitting outside every data-shape-id group.
//             Its geometry is translated into a Visio shape the same way the
//             pen tool's is; it is, after all, the same node model.
//
//   modified — a shape whose group is still there but no longer draws what the
//             drawing says it draws. Telling that apart from the shape as
//             exported means replaying the render and comparing, which is
//             exactly what this does: the page is re-rendered from the embedded
//             document and every shape's transform and outline are compared
//             with the edited file's.
//
// Reading a *modification* back is where it would be easy to do real damage. A
// shape's rendered path is a lossy view of its Visio geometry — rows inherited
// from a master, coordinates driven by formulas, a Width the outline is
// expressed as a fraction of — so importing the drawn outline wholesale would
// flatten a parametric shape into a dumb one that happens to look the same
// today. So nothing is ever replaced wholesale:
//
//   * a changed transform becomes Pin/Angle/Flip cells, which is exactly what
//     it means (and a scale or skew, which those cells cannot express, is
//     refused rather than approximated);
//   * every coordinate of the outline moving by the same amount is a move, and
//     is written as one, rather than as a rewrite of every row;
//   * a moved point becomes that one row's X/Y (or a bezier's A/B/C/D) and
//     nothing else — an inherited row gains an override holding only the cell
//     that changed, so everything else it inherits it goes on inheriting;
//   * a coordinate whose cell carries a formula, or that came out of a row type
//     with no single cell behind it (arcs, splines, NURBS), is refused with a
//     reason. Replacing `Width*0.5` with the number it happens to equal today
//     looks like nothing changed and quietly breaks the shape.
//
// What stays out of reach is a change to the *structure* of an outline — points
// added or removed — since there is no row to attribute them to. Those are
// reported, not guessed at.

import { pathToSubpaths } from './svg-path.js';
import { buildPenShapeXml } from './pen-geometry.js';
import { addVsdxShapeToPage, deleteVsdxShapes, transformVsdxShapes, setVsdxGeometryCells } from './vsdx-parser.js';
import { renderPage } from './svg-renderer.js';
import { planPlaceShapeLocally, buildShapeIndex } from './shape-arrange.js';
import { mapPathSpans, cellValueFor, formulaFor, whyNotWritable, pathNumbers, pathCommands } from './svg-geometry-map.js';

const DPI = 96;
const IDENTITY = [1, 0, 0, 1, 0, 0];

// Containers whose contents are never painted where they stand.
const NON_RENDERED = new Set([
  'defs', 'style', 'metadata', 'title', 'desc', 'symbol', 'marker',
  'clippath', 'mask', 'pattern', 'filter', 'script', 'lineargradient',
  'radialgradient', 'foreignobject'
]);
const CONTAINERS = new Set(['g', 'a', 'switch']);
const DRAWABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
// Painted, but with no outline to turn into geometry.
const UNCONVERTIBLE = new Map([
  ['text', 'text is not converted; add it in the editor instead'],
  ['image', 'a bitmap has no Visio geometry'],
  ['use', 'a <use> reference has no outline of its own']
]);

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

const applyMatrix = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export function parseTransform(text) {
  let matrix = IDENTITY;
  const source = String(text || '');
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const args = match[2].trim().split(/[\s,]+/).map(Number);
    const at = (i, fallback = 0) => (Number.isFinite(args[i]) ? args[i] : fallback);
    switch (match[1].toLowerCase()) {
      case 'matrix':
        matrix = multiply(matrix, [at(0, 1), at(1), at(2), at(3, 1), at(4), at(5)]);
        break;
      case 'translate':
        matrix = multiply(matrix, [1, 0, 0, 1, at(0), at(1)]);
        break;
      case 'scale':
        matrix = multiply(matrix, [at(0, 1), 0, 0, args.length > 1 ? at(1, 1) : at(0, 1), 0, 0]);
        break;
      case 'rotate': {
        const rad = (at(0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotation = [cos, sin, -sin, cos, 0, 0];
        if (args.length > 2) {
          const cx = at(1);
          const cy = at(2);
          matrix = multiply(matrix, multiply(multiply([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]));
        } else {
          matrix = multiply(matrix, rotation);
        }
        break;
      }
      case 'skewx':
        matrix = multiply(matrix, [1, 0, Math.tan((at(0) * Math.PI) / 180), 1, 0, 0]);
        break;
      case 'skewy':
        matrix = multiply(matrix, [1, Math.tan((at(0) * Math.PI) / 180), 0, 1, 0, 0]);
        break;
      default:
        break;   // an unknown function is ignored rather than fatal
    }
  }
  return matrix;
}

// Everything from the root down to (and including) `el`, composed.
function matrixOf(el, root) {
  const chain = [];
  for (let node = el; node && node !== root; node = node.parentNode) {
    if (node.nodeType === 1) chain.push(node);
  }
  let matrix = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) {
    const transform = chain[i].getAttribute('transform');
    if (transform) matrix = multiply(matrix, parseTransform(transform));
  }
  return matrix;
}

// ── Style ────────────────────────────────────────────────────────────────────

const NAMED_COLORS = {
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080',
  white: '#ffffff', maroon: '#800000', red: '#ff0000', purple: '#800080',
  fuchsia: '#ff00ff', magenta: '#ff00ff', green: '#008000', lime: '#00ff00',
  olive: '#808000', yellow: '#ffff00', navy: '#000080', blue: '#0000ff',
  teal: '#008080', aqua: '#00ffff', cyan: '#00ffff', orange: '#ffa500',
  pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082'
};

export function normalizeCssColor(value, fallback = null) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'none' || text === 'transparent') return null;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return '#' + text.slice(1).split('').map(c => c + c).join('');
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(part =>
      part.endsWith('%') ? Math.round((parseFloat(part) / 100) * 255) : Math.round(parseFloat(part)));
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return '#' + parts.map(n => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0')).join('');
    }
  }
  if (NAMED_COLORS[text]) return NAMED_COLORS[text];
  // url(#gradient) and anything else unrecognised: the caller decides what a
  // paint it cannot name should become.
  return fallback;
}

const STYLE_PROPS = [
  'fill', 'stroke', 'stroke-width', 'stroke-opacity', 'fill-opacity',
  'opacity', 'stroke-dasharray'
];

function declarationsOf(el) {
  const out = {};
  for (const prop of STYLE_PROPS) {
    const attr = el.getAttribute?.(prop);
    if (attr !== null && attr !== undefined && attr !== '') out[prop] = attr.trim();
  }
  // The style attribute beats the presentation attribute, per CSS.
  for (const declaration of String(el.getAttribute?.('style') || '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    if (STYLE_PROPS.includes(name)) out[name] = declaration.slice(colon + 1).trim();
  }
  return out;
}

// SVG's initial values, so an element that says nothing is a black fill with no
// stroke — which is what a browser draws it as.
const INITIAL_STYLE = { fill: 'black', stroke: 'none', 'stroke-width': '1' };

export function resolveStyle(el, root) {
  const chain = [];
  for (let node = el; node && node !== root?.parentNode; node = node.parentNode) {
    if (node.nodeType === 1) chain.push(node);
    if (node === root) break;
  }
  const resolved = { ...INITIAL_STYLE };
  // opacity does not inherit; it multiplies down the tree.
  let opacity = 1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const declarations = declarationsOf(chain[i]);
    for (const [name, value] of Object.entries(declarations)) {
      if (name === 'opacity') continue;
      if (value === 'inherit') continue;
      resolved[name] = value;
    }
    if (declarations.opacity !== undefined) {
      const parsed = parseFloat(declarations.opacity);
      if (Number.isFinite(parsed)) opacity *= Math.min(1, Math.max(0, parsed));
    }
  }
  resolved.opacity = opacity;
  return resolved;
}

// The style a Visio shape needs, from the style the SVG element has. `scale` is
// how much the element's transform stretches lengths, so a stroke drawn inside
// a scaled group keeps the width it appears to have.
export function penStyleFromSvg(style, scale = 1) {
  const opacity = Number.isFinite(style.opacity) ? style.opacity : 1;
  const strokeColor = normalizeCssColor(style.stroke, '#000000');
  const fillColor = normalizeCssColor(style.fill, '#000000');
  const strokeOn = String(style.stroke ?? 'none').trim().toLowerCase() !== 'none' && strokeColor !== null;
  const fillOn = String(style.fill ?? 'none').trim().toLowerCase() !== 'none' && fillColor !== null;

  const widthUser = parseFloat(style['stroke-width']);
  // Visio's LineWeight is a real length; the SVG's is in user units, which are
  // page inches × 96 here, and points are what buildPenShapeXml asks for.
  const strokeWidthPt = ((Number.isFinite(widthUser) ? widthUser : 1) * scale / DPI) * 72;

  const dash = String(style['stroke-dasharray'] || '').trim().toLowerCase();
  const dashed = dash && dash !== 'none';

  const alpha = (name) => {
    const parsed = parseFloat(style[name]);
    return (Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1) * opacity;
  };

  return {
    stroke: strokeOn,
    strokeColor: strokeColor || '#000000',
    strokeWidthPt: Math.max(0, strokeWidthPt),
    strokePattern: dashed ? 2 : 1,
    strokeTrans: 1 - alpha('stroke-opacity'),
    fill: fillOn,
    fillColor: fillColor || '#000000',
    fillPattern: 1,
    fillTrans: 1 - alpha('fill-opacity')
  };
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const numberAttr = (el, name, fallback = 0) => {
  const parsed = parseFloat(el.getAttribute(name));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const corner = (x, y) => ({ x, y, cIn: null, cOut: null });

// Four cubics is the standard circle approximation; the magic number is
// 4/3·tan(π/8), the same constant arcToCubics uses per quarter turn.
const KAPPA = 0.5522847498307936;

function ellipseSubpath(cx, cy, rx, ry) {
  const nodes = [
    corner(cx + rx, cy), corner(cx, cy + ry), corner(cx - rx, cy), corner(cx, cy - ry)
  ];
  const handles = [
    [{ x: cx + rx, y: cy + ry * KAPPA }, { x: cx + rx * KAPPA, y: cy + ry }],
    [{ x: cx - rx * KAPPA, y: cy + ry }, { x: cx - rx, y: cy + ry * KAPPA }],
    [{ x: cx - rx, y: cy - ry * KAPPA }, { x: cx - rx * KAPPA, y: cy - ry }],
    [{ x: cx + rx * KAPPA, y: cy - ry }, { x: cx + rx, y: cy - ry * KAPPA }]
  ];
  handles.forEach(([out, into], i) => {
    nodes[i].cOut = out;
    nodes[(i + 1) % 4].cIn = into;
  });
  return { nodes, closed: true };
}

function pointsSubpath(el, closed) {
  const numbers = String(el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
  const nodes = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    if (Number.isFinite(numbers[i]) && Number.isFinite(numbers[i + 1])) nodes.push(corner(numbers[i], numbers[i + 1]));
  }
  return nodes.length >= 2 ? [{ nodes, closed }] : [];
}

/**
 * The outline of a drawable element, in its own user units, as pen subpaths.
 * Throws with a readable message when the element has nothing convertible.
 */
export function elementSubpaths(el) {
  switch (el.localName.toLowerCase()) {
    case 'path': {
      const subpaths = pathToSubpaths(el.getAttribute('d') || '');
      if (!subpaths.length) throw new Error('the path draws nothing');
      return subpaths;
    }
    case 'rect': {
      const x = numberAttr(el, 'x');
      const y = numberAttr(el, 'y');
      const w = numberAttr(el, 'width');
      const h = numberAttr(el, 'height');
      if (!(w > 0 && h > 0)) throw new Error('the rectangle has no size');
      // Rounded corners are dropped: Visio rounds a shape's corners with a
      // Rounding cell, not with geometry, and guessing which the drawing wants
      // is worse than an honest square corner.
      return [{ nodes: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)], closed: true }];
    }
    case 'circle': {
      const r = numberAttr(el, 'r');
      if (!(r > 0)) throw new Error('the circle has no radius');
      return [ellipseSubpath(numberAttr(el, 'cx'), numberAttr(el, 'cy'), r, r)];
    }
    case 'ellipse': {
      const rx = numberAttr(el, 'rx');
      const ry = numberAttr(el, 'ry');
      if (!(rx > 0 && ry > 0)) throw new Error('the ellipse has no radii');
      return [ellipseSubpath(numberAttr(el, 'cx'), numberAttr(el, 'cy'), rx, ry)];
    }
    case 'line':
      return [{
        nodes: [
          corner(numberAttr(el, 'x1'), numberAttr(el, 'y1')),
          corner(numberAttr(el, 'x2'), numberAttr(el, 'y2'))
        ],
        closed: false
      }];
    case 'polyline':
    case 'polygon': {
      const subpaths = pointsSubpath(el, el.localName.toLowerCase() === 'polygon');
      if (!subpaths.length) throw new Error('fewer than two points');
      return subpaths;
    }
    default:
      throw new Error(`<${el.localName}> has no outline`);
  }
}

// User units (Y down from the page top) -> page inches (Y up from the bottom),
// which is the space the parser and the pen both speak.
function toPageNodes(subpath, matrix, pageHeight) {
  const place = (point) => {
    const { x, y } = applyMatrix(matrix, point.x, point.y);
    return { x: x / DPI, y: pageHeight - y / DPI };
  };
  return {
    closed: subpath.closed,
    nodes: subpath.nodes.map(node => ({
      ...place(node),
      cIn: node.cIn ? place(node.cIn) : null,
      cOut: node.cOut ? place(node.cOut) : null
    }))
  };
}

// ── Walking the document ─────────────────────────────────────────────────────

const INKSCAPE_LABEL = ['inkscape:label', 'label'];

function layerLabelOf(el, root) {
  for (let node = el; node && node !== root; node = node.parentNode) {
    if (node.nodeType !== 1) continue;
    const isLayer = node.getAttribute('inkscape:groupmode') === 'layer'
      || node.getAttributeNS?.('http://www.inkscape.org/namespaces/inkscape', 'groupmode') === 'layer';
    if (!isLayer) continue;
    for (const name of INKSCAPE_LABEL) {
      const label = node.getAttribute(name) ?? node.getAttributeNS?.('http://www.inkscape.org/namespaces/inkscape', 'label');
      if (label) return label;
    }
  }
  return null;
}

/** Every element in the SVG that carries a shape id, as a Set of id strings. */
export function shapeIdsInSvg(root) {
  const ids = new Set();
  for (const el of root.querySelectorAll('[data-shape-id]')) {
    const id = el.getAttribute('data-shape-id');
    if (id) ids.add(String(id));
  }
  return ids;
}

/**
 * Drawable elements that belong to no shape — what someone added in another
 * editor. Elements inside a data-shape-id group are the drawing's own and are
 * not descended into.
 */
export function foreignElements(root) {
  const found = [];
  const walk = (el) => {
    for (const child of el.children || []) {
      const tag = child.localName?.toLowerCase();
      if (!tag || NON_RENDERED.has(tag)) continue;
      if (child.getAttribute('data-shape-id') !== null) continue;   // the drawing's own
      if (CONTAINERS.has(tag)) { walk(child); continue; }
      if (DRAWABLE.has(tag) || UNCONVERTIBLE.has(tag)) found.push(child);
    }
  };
  walk(root);
  return found;
}

function flattenShapeIds(shapes, out = new Set()) {
  for (const shape of shapes || []) {
    if (shape.id !== undefined && shape.id !== null) out.add(String(shape.id));
    if (shape.subShapes?.length) flattenShapeIds(shape.subShapes, out);
  }
  return out;
}

/** Which page of the drawing an SVG was exported from. */
export function matchPage(root, pages, hintedPageId = null) {
  const candidates = pages || [];
  if (!candidates.length) return null;
  if (hintedPageId !== null && hintedPageId !== undefined) {
    const hinted = candidates.find(page => String(page.id) === String(hintedPageId));
    if (hinted) return hinted;
  }
  if (candidates.length === 1) return candidates[0];

  // No hint (an SVG from before the page id was embedded): the page whose
  // shapes the SVG actually holds, and only if one page clearly wins.
  const drawn = shapeIdsInSvg(root);
  const scored = candidates
    .map(page => ({ page, hits: [...flattenShapeIds(page.shapes)].filter(id => drawn.has(id)).length }))
    .sort((a, b) => b.hits - a.hits);
  if (!scored[0].hits) return null;
  if (scored[1] && scored[1].hits === scored[0].hits) return null;
  return scored[0].page;
}

// ── What changed inside a shape ──────────────────────────────────────────────

// How far a number has to move before it counts as an edit. SVG editors rewrite
// path data to their own precision, so every coordinate in a file that has been
// through one differs a little from the one this app wrote. A hundredth of a
// renderer pixel is a ten-thousandth of an inch — far below anything anybody
// drew on purpose, and far above the rounding.
const MOVED_PX = 0.01;

const matrixIsRigid = (m) => {
  // The renderer only ever emits translate · rotate · flip, so the linear part
  // is orthonormal. Anything else — a scale, a skew — has no home in Visio's
  // transform cells, which hold a pin, an angle and two flip flags.
  const [a, b, c, d] = m;
  return Math.abs(a * a + b * b - 1) < 1e-6
    && Math.abs(c * c + d * d - 1) < 1e-6
    && Math.abs(a * c + b * d) < 1e-6;
};

const matricesMatch = (m, n) =>
  m.slice(0, 4).every((value, i) => Math.abs(value - n[i]) < 1e-9)
  && Math.abs(m[4] - n[4]) < MOVED_PX && Math.abs(m[5] - n[5]) < MOVED_PX;

function directPaths(group) {
  const out = [];
  for (let node = group.firstElementChild; node; node = node.nextElementSibling) {
    if (node.localName === 'path') out.push(node);
  }
  return out;
}

// Only path data made of plain x,y pairs can be read as "everything moved by
// the same amount" — an arc command's numbers are radii and flags, not points.
const isPairwise = (commands) => /^[MLCQZ]*$/.test(commands);

function uniformShift(pairs) {
  if (!pairs.length) return null;
  const [dx, dy] = pairs[0];
  if (Math.abs(dx) < MOVED_PX && Math.abs(dy) < MOVED_PX) return null;
  const same = pairs.every(([x, y]) => Math.abs(x - dx) < MOVED_PX && Math.abs(y - dy) < MOVED_PX);
  return same ? { dx, dy } : null;
}

/**
 * Compare every shape still present in the edited SVG with what the drawing
 * says it should look like. Returns `{ modified, skipped }`, where each
 * modification is `{ id, label, kinds, transformCells, geometry }` and
 * `geometry` is a list of `{ sectionIx, rowIx, rowType, cells }` ready for
 * setVsdxGeometryCells.
 */
export function readShapeModifications(root, page, byId) {
  const modified = [];
  const skipped = [];

  const container = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (!container) return { modified, skipped };

  const pathSpans = new Map();
  let shapeIndex = null;
  let reference;
  try {
    // Only the geometry and the transforms are compared, so the Visio property
    // blocks would be three quarters of a document nobody looks at.
    reference = renderPage(page, container, { pathSpans, metadata: false });
  } catch (e) {
    skipped.push({ tag: 'page', label: 'the page', reason: `it could not be re-rendered to compare against (${e.message})` });
    return { modified, skipped };
  }

  for (const refGroup of reference.querySelectorAll('[data-shape-id]')) {
    const id = String(refGroup.getAttribute('data-shape-id'));
    const editedGroup = root.querySelector(`[data-shape-id="${id}"]`);
    if (!editedGroup) continue;               // deleted; that is a removal, not an edit
    const shape = byId.get(id);
    if (!shape) continue;
    const label = shape.name || shape.nameU || `Shape ${id}`;

    const kinds = [];
    const reasons = [];
    let transformCells = null;

    // ── where the shape sits ────────────────────────────────────────────────
    const refMatrix = parseTransform(refGroup.getAttribute('transform'));
    const editedMatrix = parseTransform(editedGroup.getAttribute('transform'));
    let placement = refMatrix;
    if (!matricesMatch(refMatrix, editedMatrix)) {
      if (!matrixIsRigid(editedMatrix)) {
        reasons.push('it was scaled or skewed, which a Visio shape transform cannot express — resize it here instead');
      } else {
        placement = editedMatrix;
        kinds.push('moved');
      }
    }

    // ── what the shape draws ────────────────────────────────────────────────
    const refPaths = directPaths(refGroup);
    const editedPaths = directPaths(editedGroup);
    const cellUpdates = new Map();
    let localShift = null;
    let geometryBlocked = false;

    if (refPaths.length !== editedPaths.length) {
      reasons.push(`its outline went from ${refPaths.length} path${refPaths.length === 1 ? '' : 's'} to ${editedPaths.length}`);
      geometryBlocked = true;
    } else {
      const shiftPairs = [];
      let allPairwise = true;

      for (let i = 0; i < refPaths.length && !geometryBlocked; i++) {
        const before = refPaths[i].getAttribute('d') || '';
        const after = editedPaths[i].getAttribute('d') || '';
        const commands = pathCommands(before);
        if (commands !== pathCommands(after)) {
          reasons.push('points were added to or removed from its outline, and there is no row to attribute them to');
          geometryBlocked = true;
          break;
        }
        const from = pathNumbers(before);
        const to = pathNumbers(after);
        if (from.length !== to.length) {
          reasons.push('its outline no longer has the same number of coordinates');
          geometryBlocked = true;
          break;
        }
        if (!isPairwise(commands)) allPairwise = false;
        else for (let k = 0; k + 1 < from.length; k += 2) shiftPairs.push([to[k] - from[k], to[k + 1] - from[k + 1]]);

        const changed = [];
        for (let k = 0; k < from.length; k++) {
          if (Math.abs(to[k] - from[k]) > MOVED_PX) changed.push(k);
        }
        if (!changed.length) continue;

        const spans = pathSpans.get(refPaths[i]);
        if (!spans) {
          reasons.push('its outline is drawn from its endpoints rather than from geometry rows');
          geometryBlocked = true;
          break;
        }
        const descriptors = mapPathSpans(spans);
        if (descriptors.length !== from.length) {
          // The map and the renderer disagree about what was emitted, so no
          // number here can be named with confidence.
          reasons.push('its outline could not be traced back to the rows that drew it');
          geometryBlocked = true;
          break;
        }

        for (const k of changed) {
          const descriptor = descriptors[k];
          const why = whyNotWritable(descriptor);
          if (why) {
            reasons.push(why);
            geometryBlocked = true;
            break;
          }
          const value = cellValueFor(descriptor, to[k], shape.width, shape.height);
          if (!Number.isFinite(value)) {
            reasons.push('the shape has no size for its outline to be measured against');
            geometryBlocked = true;
            break;
          }
          const key = `${descriptor.section?.ix}|${descriptor.row.ix}`;
          if (!cellUpdates.has(key)) {
            cellUpdates.set(key, {
              sectionIx: descriptor.section?.ix ?? descriptor.row.sectionIx,
              rowIx: descriptor.row.ix,
              rowType: descriptor.row.type,
              cells: {}
            });
          }
          const entry = cellUpdates.get(key);
          const existing = entry.cells[descriptor.cell];
          if (existing !== undefined && Math.abs(existing.value - value) > 1e-9) {
            // The same row is drawn twice (a filled outline is stroked as a
            // second path) and the two copies were edited differently.
            reasons.push('the same point was edited to two different places');
            geometryBlocked = true;
            break;
          }
          // A coordinate Visio wrote as a proportion of the shape stays a
          // proportion of the shape; only the proportion changes.
          entry.cells[descriptor.cell] = {
            value,
            formula: formulaFor(descriptor, value, shape.width, shape.height)
          };
        }
      }

      // Every coordinate moving together is the shape moving, not its outline
      // being redrawn — and that is what an SVG editor writes when it is set to
      // bake transforms into path data, which is the usual default.
      if (!geometryBlocked && allPairwise && cellUpdates.size) {
        localShift = uniformShift(shiftPairs);
      }
    }

    if (localShift) {
      cellUpdates.clear();
      // Shifting every local coordinate by (dx, dy) is the same as translating
      // the shape's own transform by it.
      placement = [
        placement[0], placement[1], placement[2], placement[3],
        placement[4] + placement[0] * localShift.dx + placement[2] * localShift.dy,
        placement[5] + placement[1] * localShift.dx + placement[3] * localShift.dy
      ];
      if (!kinds.includes('moved')) kinds.push('moved');
    } else if (cellUpdates.size) {
      kinds.push(`${cellUpdates.size} point${cellUpdates.size === 1 ? '' : 's'} moved`);
    }

    if (kinds.includes('moved')) {
      try {
        // One index for the whole import: the page does not change while it is
        // being read, and rebuilding it per shape made a big drawing crawl.
        shapeIndex = shapeIndex || buildShapeIndex(page);
        transformCells = planPlaceShapeLocally(page, id, placement, { index: shapeIndex }).cells;
      } catch (e) {
        reasons.push(e.message);
        transformCells = null;
        kinds.splice(kinds.indexOf('moved'), 1);
      }
    }

    if (reasons.length) {
      skipped.push({ tag: 'shape', label, reason: [...new Set(reasons)].join('; ') });
    }
    if (!transformCells && !cellUpdates.size) continue;
    modified.push({ id, label, kinds, transformCells, geometry: [...cellUpdates.values()] });
  }

  return { modified, skipped };
}

// ── The plan ─────────────────────────────────────────────────────────────────

const NOTHING = { ok: false, reason: null, page: null, removed: [], added: [], modified: [], skipped: [] };

/**
 * Compare an edited SVG against the drawing it was exported from.
 *
 * Returns `{ ok, reason, page, removed, added, skipped }`. `ok` is false when
 * the comparison cannot be trusted — an SVG whose shape ids have been stripped
 * says nothing about what was deleted, and guessing would delete the drawing.
 */
export function readSvgEdits(svgText, drawing, options = {}) {
  const doc = new DOMParser().parseFromString(String(svgText || ''), 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || root.getElementsByTagName('parsererror').length) {
    return { ...NOTHING, reason: 'the SVG could not be parsed' };
  }

  const page = matchPage(root, drawing?.pages, options.pageId);
  if (!page) return { ...NOTHING, reason: 'could not tell which page of the drawing this SVG came from' };

  const drawn = shapeIdsInSvg(root);
  if (!drawn.size) {
    return {
      ...NOTHING,
      page,
      reason: 'the SVG has no shape ids left (it was saved by something that strips them), '
        + 'so there is no way to tell what was deleted'
    };
  }

  const known = flattenShapeIds(page.shapes);
  const byId = new Map();
  const parentOf = new Map();
  const index = (shapes, parentId) => {
    for (const shape of shapes || []) {
      const id = String(shape.id);
      byId.set(id, shape);
      if (parentId !== null) parentOf.set(id, parentId);
      index(shape.subShapes, id);
    }
  };
  index(page.shapes, null);

  const removed = [...known]
    .filter(id => !drawn.has(id))
    // A child whose group went too was deleted *with* the group; listing it
    // separately would overstate what happened, and deleting the group already
    // takes it.
    .filter(id => {
      const parent = parentOf.get(id);
      return parent === undefined || drawn.has(parent);
    })
    .map(id => ({ id, label: byId.get(id)?.name || byId.get(id)?.nameU || `Shape ${id}` }));

  const layerByName = new Map();
  for (const layer of page.layers || []) {
    layerByName.set(String(layer.name || layer.nameUniv || '').toLowerCase(), String(layer.index));
  }

  const added = [];
  const skipped = [];
  for (const el of foreignElements(root)) {
    const tag = el.localName.toLowerCase();
    const describe = el.getAttribute('id') ? `<${tag} id="${el.getAttribute('id')}">` : `<${tag}>`;
    if (UNCONVERTIBLE.has(tag)) {
      skipped.push({ tag, label: describe, reason: UNCONVERTIBLE.get(tag) });
      continue;
    }
    let subpaths;
    try {
      subpaths = elementSubpaths(el);
    } catch (e) {
      skipped.push({ tag, label: describe, reason: e.message });
      continue;
    }

    const matrix = matrixOf(el, root);
    const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1;
    const style = penStyleFromSvg(resolveStyle(el, root), scale);
    const layerLabel = layerLabelOf(el, root);
    // A path drawn into an Inkscape layer belongs on the Visio layer that group
    // stands for — but only when the name is one the page actually has.
    const layerIndex = layerLabel ? layerByName.get(layerLabel.trim().toLowerCase()) : undefined;

    for (const subpath of subpaths) {
      const placed = toPageNodes(subpath, matrix, page.height || 0);
      try {
        added.push({
          label: describe,
          layer: layerIndex === undefined ? null : layerLabel,
          xml: buildPenShapeXml(placed.nodes, style, {
            closed: placed.closed,
            layerMembers: layerIndex === undefined ? [] : [layerIndex]
          })
        });
      } catch (e) {
        skipped.push({ tag, label: describe, reason: e.message });
      }
    }
  }

  const changes = readShapeModifications(root, page, byId);
  skipped.push(...changes.skipped);

  return { ok: true, reason: null, page, removed, added, modified: changes.modified, skipped };
}

/**
 * Apply a plan to the package the SVG was carrying. Deletions happen first, so
 * the ids the additions get cannot collide with something on its way out.
 */
export async function applySvgEdits(arrayBuffer, plan) {
  let buffer = arrayBuffer;
  const pageId = plan.page.id;
  const removedIds = [];
  const addedIds = [];
  const modifiedIds = [];

  // Modifications first: they name shapes by the id they have now, and a
  // deletion elsewhere on the page must not have moved anything underneath.
  const placements = (plan.modified || [])
    .filter(entry => entry.transformCells)
    .map(entry => ({ id: entry.id, cells: entry.transformCells }));
  if (placements.length) {
    buffer = (await transformVsdxShapes(buffer, pageId, placements)).buffer;
    modifiedIds.push(...placements.map(entry => entry.id));
  }
  const rowEdits = (plan.modified || []).flatMap(entry =>
    (entry.geometry || []).map(row => ({ ...row, id: entry.id })));
  if (rowEdits.length) {
    buffer = (await setVsdxGeometryCells(buffer, pageId, rowEdits)).buffer;
    modifiedIds.push(...rowEdits.map(entry => entry.id));
  }

  if (plan.removed.length) {
    const result = await deleteVsdxShapes(buffer, pageId, plan.removed.map(entry => entry.id));
    buffer = result.buffer;
    removedIds.push(...(result.shapeIds || plan.removed.map(entry => entry.id)));
  }
  for (const addition of plan.added) {
    const result = await addVsdxShapeToPage(buffer, pageId, addition.xml);
    buffer = result.buffer;
    addedIds.push(result.shapeId);
  }
  return { buffer, addedIds, removedIds, modifiedIds: [...new Set(modifiedIds)] };
}

/** One line per change, for the confirmation the user is shown. */
export function summarizeSvgEdits(plan) {
  const lines = [];
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (plan.added.length) lines.push(`${count(plan.added.length, 'shape', 'shapes')} added`);
  if (plan.removed.length) lines.push(`${count(plan.removed.length, 'shape', 'shapes')} deleted`);
  if (plan.modified?.length) lines.push(`${count(plan.modified.length, 'shape', 'shapes')} changed`);
  if (plan.skipped.length) lines.push(`${count(plan.skipped.length, 'element', 'elements')} skipped`);
  return lines.join(', ');
}
