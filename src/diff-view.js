// Visual diff view: overlay + side-by-side rendering of two VSDX documents.
//
// Self-contained so it doesn't touch the main viewer's pan/zoom/render state.
// Reuses parseVsdx (model), renderPage (SVG, groups tagged with data-shape-id),
// and computeDiff (structural layer/membership/shape diff).

import { parseVsdx } from './vsdx-parser.js';
import { renderPage } from './svg-renderer.js';
import { computeDiff } from './vsdx-diff.js';

const COLORS = {
  added: '#16a34a',
  removed: '#dc2626',
  modified: '#d97706',
  moved: '#2563eb',
};
const LABELS = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
  moved: 'Moved layer',
};

// Draw a crisp bbox outline around a shape group to make the change legible
// regardless of the shape's own styling. getBBox is unavailable under jsdom,
// so this degrades gracefully in headless tests (dataset.diff still set).
function highlightGroup(svg, group, kind) {
  group.dataset.diff = kind;
  const color = COLORS[kind];
  if (kind === 'removed') group.style.opacity = '0.55';
  let box;
  try {
    box = group.getBBox();
  } catch {
    return; // headless / not rendered
  }
  if (!box || (!box.width && !box.height)) return;
  const pad = Math.max(2, Math.max(box.width, box.height) * 0.02);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', box.x - pad);
  rect.setAttribute('y', box.y - pad);
  rect.setAttribute('width', box.width + pad * 2);
  rect.setAttribute('height', box.height + pad * 2);
  rect.setAttribute('fill', kind === 'removed' ? color : 'none');
  rect.setAttribute('fill-opacity', kind === 'removed' ? '0.12' : '0');
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '2');
  rect.setAttribute('stroke-dasharray', kind === 'moved' ? '6 4' : '');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  rect.setAttribute('pointer-events', 'none');
  rect.dataset.diffHighlight = kind;
  svg.appendChild(rect);
}

// Build shapeId -> kind maps for a page diff, split by which side shows them.
function classMaps(pageDiff) {
  const base = new Map(); // shown on the base (left) render
  const head = new Map(); // shown on the head (right / overlay) render
  for (const s of pageDiff.shapes.added) head.set(String(s.id), 'added');
  for (const s of pageDiff.shapes.removed) base.set(String(s.id), 'removed');
  for (const s of pageDiff.shapes.modified) {
    base.set(String(s.id), 'modified');
    head.set(String(s.id), 'modified');
  }
  for (const m of pageDiff.membership) {
    base.set(String(m.shapeId), 'moved');
    head.set(String(m.shapeId), 'moved');
  }
  return { base, head };
}

function colorize(svg, map) {
  for (const [id, kind] of map) {
    const g = svg.querySelector(`[data-shape-id="${cssEscape(id)}"]`);
    if (g) highlightGroup(svg, g, kind);
  }
}

const cssEscape = (s) =>
  window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

const dot = (kind) =>
  el('span', { class: 'diff-dot', style: `background:${COLORS[kind]}` });

function fmt(v) {
  return v === true ? 'on' : v === false ? 'off' : v == null || v === '' ? '(none)' : String(v);
}

// Summary sidebar for one page diff.
function buildSummary(pageDiff) {
  const rows = [];
  const section = (title) => rows.push(el('div', { class: 'diff-sec-title' }, title));

  const L = pageDiff.layers;
  if (L.added.length || L.removed.length || L.changed.length) {
    section('Layers');
    for (const l of L.added) rows.push(el('div', { class: 'diff-row' }, dot('added'), `layer "${l.name}"`));
    for (const l of L.removed) {
      const n = l.cascadedShapeIds.length;
      rows.push(el('div', { class: 'diff-row' }, dot('removed'),
        `layer "${l.name}"` + (n ? ` — removed ${n} shape${n === 1 ? '' : 's'} with it` : '')));
    }
    for (const l of L.changed) {
      const desc = l.changes.map((c) => `${c.field} ${fmt(c.from)}→${fmt(c.to)}`).join(', ');
      rows.push(el('div', { class: 'diff-row' }, dot('modified'), `layer "${l.name}": ${desc}`));
    }
  }

  if (pageDiff.membership.length) {
    section('Layer membership');
    for (const m of pageDiff.membership) {
      rows.push(el('div', { class: 'diff-row' }, dot('moved'),
        `shape ${m.shapeId}: ${m.from.join('+') || '(none)'} → ${m.to.join('+') || '(none)'}`));
    }
  }

  const S = pageDiff.shapes;
  const indepRemoved = S.removed.filter((s) => !s.cascadedFromLayer);
  if (S.added.length || indepRemoved.length || S.modified.length) {
    section('Shapes');
    if (S.added.length) rows.push(el('div', { class: 'diff-row' }, dot('added'), `${S.added.length} added`));
    if (indepRemoved.length) rows.push(el('div', { class: 'diff-row' }, dot('removed'), `${indepRemoved.length} removed`));
    for (const s of S.modified) {
      rows.push(el('div', { class: 'diff-row' }, dot('modified'),
        `shape ${s.id}: ${s.changes.map((c) => c.field).join(', ')}`));
    }
  }

  if (!rows.length) rows.push(el('div', { class: 'diff-row diff-muted' }, 'No differences on this page.'));
  return rows;
}

// ── Pan / zoom shared across one or two panes ──────────────────────────────
function makePanZoom(panes) {
  const state = { zoom: 1, x: 0, y: 0 };
  const apply = () => {
    for (const p of panes) p.style.transform = `translate(${state.x}px,${state.y}px) scale(${state.zoom})`;
  };
  const container = panes[0].parentElement.parentElement; // the scroll area
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nz = Math.max(0.05, Math.min(state.zoom * delta, 200));
    const scale = nz / state.zoom;
    state.x = mx - scale * (mx - state.x);
    state.y = my - scale * (my - state.y);
    state.zoom = nz;
    apply();
  }, { passive: false });
  let panning = false, sx = 0, sy = 0;
  container.addEventListener('mousedown', (e) => { panning = true; sx = e.clientX - state.x; sy = e.clientY - state.y; });
  window.addEventListener('mousemove', (e) => { if (panning) { state.x = e.clientX - sx; state.y = e.clientY - sy; apply(); } });
  window.addEventListener('mouseup', () => { panning = false; });
  const reset = () => { state.zoom = 1; state.x = 0; state.y = 0; apply(); };
  return { reset, apply, state };
}

// ── Public entry ───────────────────────────────────────────────────────────
export async function openDiffView({ baseBuffer, headBuffer, baseName, headName, mount }) {
  const base = await parseVsdx(baseBuffer);
  const head = await parseVsdx(headBuffer);
  const diff = computeDiff(base, head);

  const basePages = new Map(base.pages.map((p) => [String(p.id), p]));
  const headPages = new Map(head.pages.map((p) => [String(p.id), p]));

  let mode = 'overlay'; // 'overlay' | 'sidebyside'
  let pageIdx = diff.pages.findIndex((p) => p.status !== 'unchanged');
  if (pageIdx < 0) pageIdx = 0;

  const root = el('div', { class: 'diff-root' });
  const canvas = el('div', { class: 'diff-canvas' });
  const summary = el('div', { class: 'diff-summary' });

  const modeBtn = (m, label) => el('button', {
    class: 'diff-mode-btn' + (mode === m ? ' active' : ''),
    'data-mode': m,
    onclick: () => { mode = m; render(); },
  }, label);

  let header, tabsEl, panZoom;

  function buildHeader() {
    const tabs = diff.pages.map((p, i) =>
      el('button', {
        class: 'diff-tab' + (i === pageIdx ? ' active' : '') + (p.status === 'unchanged' ? ' diff-muted' : ''),
        onclick: () => { pageIdx = i; render(); },
      }, `${p.name || 'Page'}${p.status !== 'unchanged' ? ' •' : ''}`));
    tabsEl = el('div', { class: 'diff-tabs' }, tabs);

    const legend = el('div', { class: 'diff-legend' },
      ...Object.keys(COLORS).map((k) => el('span', { class: 'diff-legend-item' }, dot(k), LABELS[k])));

    return el('div', { class: 'diff-header' },
      el('div', { class: 'diff-title' }, `Diff: ${baseName || 'base'} ↔ ${headName || 'head'}`),
      el('div', { class: 'diff-modes' }, modeBtn('overlay', 'Overlay'), modeBtn('sidebyside', 'Side by side')),
      legend,
      el('button', { class: 'diff-exit', onclick: () => close() }, 'Exit diff'),
      tabsEl,
    );
  }

  // Build a pane's DOM. Highlighting is deferred: getBBox only works once the
  // SVG is attached to the live document, so callers colorize AFTER append.
  function renderPane(pageModel, label) {
    const inner = el('div', { class: 'diff-pane-inner' });
    let svg = null;
    if (pageModel) svg = renderPage(pageModel, inner);
    else inner.append(el('div', { class: 'diff-missing' }, label + ' — page absent'));
    const pane = el('div', { class: 'diff-pane' },
      el('div', { class: 'diff-pane-label' }, label),
      el('div', { class: 'diff-pane-scroll' }, inner));
    return { pane, inner, svg };
  }

  function render() {
    // header
    const newHeader = buildHeader();
    if (header) header.replaceWith(newHeader); else root.prepend(newHeader);
    header = newHeader;

    const pd = diff.pages[pageIdx];
    const bp = basePages.get(String(pd.pageId));
    const hp = headPages.get(String(pd.pageId));
    const maps = classMaps(pd);

    canvas.innerHTML = '';
    let panes;
    if (mode === 'overlay') {
      // Render head; splice in removed shapes cloned from a base render.
      const { pane, inner, svg } = renderPane(hp || bp, 'Overlay (head + removed)');
      const removedClones = [];
      if (svg && hp && bp) {
        const ghost = el('div');
        const baseSvg = renderPage(bp, ghost);
        for (const s of pd.shapes.removed) {
          const g = baseSvg.querySelector(`[data-shape-id="${cssEscape(s.id)}"]`);
          if (g) { const clone = g.cloneNode(true); svg.appendChild(clone); removedClones.push(clone); }
        }
      }
      canvas.append(pane); // attach BEFORE highlighting so getBBox has layout
      if (svg) {
        colorize(svg, hp ? maps.head : maps.base);
        for (const clone of removedClones) highlightGroup(svg, clone, 'removed');
      }
      panes = [inner];
    } else {
      const left = renderPane(bp, `Base: ${baseName || 'base'}`);
      const right = renderPane(hp, `Head: ${headName || 'head'}`);
      canvas.append(el('div', { class: 'diff-split' }, left.pane, right.pane));
      if (left.svg) colorize(left.svg, maps.base);
      if (right.svg) colorize(right.svg, maps.head);
      panes = [left.inner, right.inner].filter((p) => p.querySelector('svg'));
    }

    // summary
    summary.innerHTML = '';
    summary.append(el('div', { class: 'diff-sec-title diff-sec-head' }, `Page: ${pd.name || 'Page'} [${pd.status}]`), ...buildSummary(pd));

    if (panes.length) panZoom = makePanZoom(panes);
  }

  function close() {
    root.remove();
    if (typeof onClose === 'function') onClose();
  }
  const onClose = mount.__onDiffClose;

  root.append(el('div', { class: 'diff-body' }, canvas, summary));
  mount.append(root);
  render();

  return { close, get diff() { return diff; }, setMode(m) { mode = m; render(); }, setPage(i) { pageIdx = i; render(); } };
}
