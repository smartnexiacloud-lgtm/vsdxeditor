import { parseVsdx } from './vsdx-parser.js';
import { parseVsd } from './vsd-parser.js';
import { renderPage } from './svg-renderer.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const viewer = document.getElementById('viewer');
const pageTabs = document.getElementById('page-tabs');
const svgContainer = document.getElementById('svg-container');
const zoomInfo = document.getElementById('zoom-info');
const fileName = document.getElementById('file-name');
const errorBox = document.getElementById('error-box');
const layersSidebar = document.getElementById('layers-sidebar');
const layersList = document.getElementById('layers-list');
const layerFilterMode = document.getElementById('layer-filter-mode');
const layerFilterText = document.getElementById('layer-filter-text');
const layersCount = document.getElementById('layers-count');
const layersSelectAll = document.getElementById('layers-select-all');
const layersDeselectAll = document.getElementById('layers-deselect-all');
const layersSelectFiltered = document.getElementById('layers-select-filtered');
const layersDeselectFiltered = document.getElementById('layers-deselect-filtered');
const layerMatrixModal = document.getElementById('layer-matrix-modal');
const layerMatrixBody = document.getElementById('layer-matrix-body');
const layerMatrixClose = document.getElementById('layer-matrix-close');

let currentPages = [];
let currentPageIndex = 0;
let zoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStartX, panStartY;
let hiddenLayers = new Set();
let focusedLayerIndex = null;

function getInitialHiddenLayers(page = currentPages[currentPageIndex]) {
  return new Set((page?.layers || [])
    .filter(layer => layer.visible === false)
    .map(layer => layer.index));
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
  setTimeout(() => { errorBox.style.display = 'none'; }, 5000);
}

function showViewer() {
  dropZone.style.display = 'none';
  viewer.style.display = 'flex';
}

function updateTransform() {
  svgContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  zoomInfo.textContent = `${Math.round(zoom * 100)}%`;
}

function renderCurrentPage() {
  if (!currentPages.length) return;
  const page = currentPages[currentPageIndex];
  let renderedPage = page;

  // Render background page first if referenced
  if (page.backPage) {
    const bgPage = currentPages.find(p => p.id === page.backPage);
    if (bgPage) {
      // Merge background shapes into current page for rendering
      renderedPage = { ...page, shapes: [...bgPage.shapes, ...page.shapes] };
    }
  }

  renderPage(renderedPage, svgContainer);
  applyLayerVisibility();
  attachSvgLayerFocusHandlers();
}

function buildPageTabs() {
  pageTabs.innerHTML = '';
  const foregroundPages = currentPages.filter(p => !p.isBackground);
  foregroundPages.forEach((page, i) => {
    const btn = document.createElement('button');
    btn.textContent = page.name;
    btn.className = 'page-tab' + (currentPages.indexOf(page) === currentPageIndex ? ' active' : '');
    btn.addEventListener('click', () => {
      currentPageIndex = currentPages.indexOf(page);
      buildPageTabs();
      hiddenLayers = getInitialHiddenLayers();
      focusedLayerIndex = null;
      buildLayersSidebar();
      resetView();
      renderCurrentPage();
    });
    pageTabs.appendChild(btn);
  });
}

function buildLayersSidebar() {
  layersList.innerHTML = '';
  if (!currentPages.length) return;
  const page = currentPages[currentPageIndex];
  const layers = page.layers || [];

  if (layers.length === 0) {
    // Collect implicit layers from shapes that have layerMembers
    // but no layer definitions (shouldn't happen, but handle gracefully)
    layersSidebar.classList.remove('visible');
    document.getElementById('btn-layers').classList.remove('active');
    return;
  }

  const visibleLayers = getFilteredLayers();
  if (!visibleLayers.some(layer => layer.index === focusedLayerIndex)) {
    focusedLayerIndex = visibleLayers[0]?.index ?? null;
  }

  for (const layer of visibleLayers) {
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.dataset.layerIndex = layer.index;
    item.tabIndex = layer.index === focusedLayerIndex ? 0 : -1;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', layer.index === focusedLayerIndex ? 'true' : 'false');
    if (hiddenLayers.has(layer.index)) item.classList.add('disabled');
    if (layer.index === focusedLayerIndex) item.classList.add('focused');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hiddenLayers.has(layer.index);
    checkbox.id = `layer-cb-${layer.index}`;
    checkbox.tabIndex = -1;
    checkbox.setAttribute('aria-label', layer.name);

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;
    name.title = layer.name;

    checkbox.addEventListener('change', () => {
      setLayerSelected(layer.index, checkbox.checked);
    });

    item.addEventListener('click', (e) => {
      focusLayerRow(layer.index, false);
      if (e.target !== checkbox) toggleLayer(layer.index);
    });

    item.addEventListener('focus', () => focusLayerRow(layer.index, false));

    item.appendChild(checkbox);
    item.appendChild(name);
    layersList.appendChild(item);
  }

  updateLayersCount(layers.length, visibleLayers.length);
  updateLayerBulkButtons(visibleLayers.length);
}

function normalizeLayerText(value) {
  return String(value || '').trim().toLowerCase();
}

function getCurrentLayers() {
  return currentPages[currentPageIndex]?.layers || [];
}

function layerMatchesFilter(layer) {
  const needle = normalizeLayerText(layerFilterText.value);
  if (!needle) return true;

  const haystack = normalizeLayerText(layer.name);
  switch (layerFilterMode.value) {
    case 'starts':
      return haystack.startsWith(needle);
    case 'ends':
      return haystack.endsWith(needle);
    case 'equals':
      return haystack === needle;
    case 'notContains':
      return !haystack.includes(needle);
    case 'contains':
    default:
      return haystack.includes(needle);
  }
}

function getFilteredLayers() {
  return getCurrentLayers().filter(layerMatchesFilter);
}

function updateLayersCount(total, visible) {
  const selected = getCurrentLayers().filter(layer => !hiddenLayers.has(layer.index)).length;
  layersCount.textContent = `${visible} of ${total} shown, ${selected} selected`;
}

function updateLayerBulkButtons(visibleCount) {
  const disabled = getCurrentLayers().length === 0;
  layersSelectAll.disabled = disabled;
  layersDeselectAll.disabled = disabled;
  layersSelectFiltered.disabled = disabled || visibleCount === 0;
  layersDeselectFiltered.disabled = disabled || visibleCount === 0;
}

function setLayerSelected(layerIndex, selected) {
  if (selected) {
    hiddenLayers.delete(layerIndex);
  } else {
    hiddenLayers.add(layerIndex);
  }

  const item = layersList.querySelector(`[data-layer-index="${CSS.escape(String(layerIndex))}"]`);
  if (item) {
    item.classList.toggle('disabled', !selected);
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = selected;
  }

  updateLayersCount(getCurrentLayers().length, getFilteredLayers().length);
  applyLayerVisibility();
}

function toggleLayer(layerIndex) {
  setLayerSelected(layerIndex, hiddenLayers.has(layerIndex));
}

function setLayerSelection(layers, selected) {
  for (const layer of layers) {
    if (selected) hiddenLayers.delete(layer.index);
    else hiddenLayers.add(layer.index);
  }
  buildLayersSidebar();
  applyLayerVisibility();
}

function focusLayerRow(layerIndex, scrollIntoView = true) {
  focusedLayerIndex = layerIndex;
  const items = [...layersList.querySelectorAll('.layer-item')];
  for (const item of items) {
    const isFocused = item.dataset.layerIndex === String(layerIndex);
    item.classList.toggle('focused', isFocused);
    item.tabIndex = isFocused ? 0 : -1;
    item.setAttribute('aria-selected', isFocused ? 'true' : 'false');
    if (isFocused) {
      item.focus({ preventScroll: true });
      if (scrollIntoView) item.scrollIntoView({ block: 'nearest' });
    }
  }
}

function moveLayerFocus(delta) {
  const items = [...layersList.querySelectorAll('.layer-item')];
  if (!items.length) return;
  const focusedItem = document.activeElement?.closest?.('.layer-item');
  const current = focusedItem
    ? items.indexOf(focusedItem)
    : items.findIndex(item => item.dataset.layerIndex === String(focusedLayerIndex));
  const startingBeforeList = !focusedItem && document.activeElement === layersList;
  const nextBase = startingBeforeList ? -1 : (current >= 0 ? current : 0);
  const next = Math.max(0, Math.min(items.length - 1, nextBase + delta));
  focusLayerRow(items[next].dataset.layerIndex);
}

function focusFirstOrLastLayer(first) {
  const items = [...layersList.querySelectorAll('.layer-item')];
  if (!items.length) return;
  focusLayerRow(items[first ? 0 : items.length - 1].dataset.layerIndex);
}

function focusLayerFromSvgElement(target) {
  const group = target.closest?.('g[data-layers]');
  if (!group) return;

  const layerIndexes = group.getAttribute('data-layers').split(',').filter(Boolean);
  const visibleLayerIndexes = new Set(getFilteredLayers().map(layer => String(layer.index)));
  const layerIndex = layerIndexes.find(index => visibleLayerIndexes.has(index)) || layerIndexes[0];
  if (!layerIndex) return;

  layersSidebar.classList.add('visible');
  document.getElementById('btn-layers').classList.add('active');

  if (!visibleLayerIndexes.has(layerIndex)) {
    layerFilterText.value = '';
    buildLayersSidebar();
  }
  focusLayerRow(layerIndex);
}

function attachSvgLayerFocusHandlers() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  svg.addEventListener('click', (e) => focusLayerFromSvgElement(e.target));
}

function formatLayerBool(value, defaultValue = null) {
  const resolved = value ?? defaultValue;
  if (resolved === null || resolved === undefined) {
    const span = document.createElement('span');
    span.className = 'matrix-muted';
    span.textContent = '-';
    return span;
  }

  const span = document.createElement('span');
  span.className = resolved ? 'matrix-yes' : 'matrix-no';
  span.textContent = resolved ? 'Yes' : 'No';
  return span;
}

function createTextCell(text, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text;
  cell.title = text;
  return cell;
}

function createBoolCell(value, defaultValue = null) {
  const cell = document.createElement('td');
  cell.appendChild(formatLayerBool(value, defaultValue));
  return cell;
}

function buildLayerMatrix() {
  layerMatrixBody.innerHTML = '';
  const pages = currentPages.filter(page => !page.isBackground);

  if (!pages.length) {
    layerMatrixBody.textContent = 'No foreground pages loaded.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'layer-matrix';

  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Page', 'Layer', 'Index', 'File Visible', 'Displayed Now', 'Print', 'Active', 'Lock', 'Snap', 'Glue', 'Color', 'Transparency'].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  head.appendChild(headerRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  let rowCount = 0;

  for (const page of pages) {
    const layers = page.layers || [];
    if (!layers.length) {
      const row = document.createElement('tr');
      row.appendChild(createTextCell(page.name || 'Page'));
      const emptyCell = createTextCell('No layers', 'matrix-muted');
      emptyCell.colSpan = 11;
      row.appendChild(emptyCell);
      body.appendChild(row);
      continue;
    }

    for (const layer of layers) {
      const isCurrentPage = currentPages.indexOf(page) === currentPageIndex;
      const displayedNow = isCurrentPage ? !hiddenLayers.has(layer.index) : layer.visible !== false;
      const row = document.createElement('tr');
      row.appendChild(createTextCell(page.name || 'Page'));
      row.appendChild(createTextCell(layer.name || `Layer ${layer.index}`, 'matrix-layer-name'));
      row.appendChild(createTextCell(String(layer.index)));
      row.appendChild(createBoolCell(layer.visible, true));
      row.appendChild(createBoolCell(displayedNow, true));
      row.appendChild(createBoolCell(layer.print, true));
      row.appendChild(createBoolCell(layer.active, false));
      row.appendChild(createBoolCell(layer.lock, false));
      row.appendChild(createBoolCell(layer.snap, true));
      row.appendChild(createBoolCell(layer.glue, true));
      row.appendChild(createTextCell(layer.color || '-', layer.color ? '' : 'matrix-muted'));
      row.appendChild(createTextCell(layer.colorTrans || '-', layer.colorTrans ? '' : 'matrix-muted'));
      body.appendChild(row);
      rowCount++;
    }
  }

  table.appendChild(body);
  layerMatrixBody.appendChild(table);

  if (rowCount === 0) {
    layerMatrixBody.textContent = 'No layer matrix data found in this file.';
  }
}

function showLayerMatrix() {
  buildLayerMatrix();
  layerMatrixModal.classList.add('visible');
}

function hideLayerMatrix() {
  layerMatrixModal.classList.remove('visible');
}

function applyLayerVisibility() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  const groups = svg.querySelectorAll('g[data-layers]');
  for (const g of groups) {
    const shapeLayers = g.getAttribute('data-layers').split(',');
    // Hide if ALL of the shape's layers are hidden
    const allHidden = shapeLayers.every(l => hiddenLayers.has(l));
    g.style.display = allHidden ? 'none' : '';
  }
}

function resetView() {
  zoom = 1;
  panX = 0;
  panY = 0;
  updateTransform();
}

async function loadFile(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.vsdx') && !name.endsWith('.vsd')) {
    showError('Please select a .vsd or .vsdx file');
    return;
  }
  try {
    fileName.textContent = file.name;
    const buffer = await file.arrayBuffer();
    const result = name.endsWith('.vsd') ? await parseVsd(buffer) : await parseVsdx(buffer);
    currentPages = result.pages;
    // Default to first foreground page
    const firstFg = currentPages.findIndex(p => !p.isBackground);
    currentPageIndex = firstFg >= 0 ? firstFg : 0;
    showViewer();
    buildPageTabs();
    hiddenLayers = getInitialHiddenLayers();
    focusedLayerIndex = null;
    layerFilterText.value = '';
    buildLayersSidebar();
    resetView();
    renderCurrentPage();
  } catch (e) {
    console.error(e);
    showError('Failed to parse VSDX file: ' + e.message);
  }
}

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) loadFile(files[0]);
});

// File input
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) loadFile(e.target.files[0]);
});

dropZone.addEventListener('click', () => fileInput.click());

// Pan & zoom on viewer
const viewportEl = document.getElementById('viewport');

viewportEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const rect = viewportEl.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Zoom towards mouse position
  const newZoom = Math.max(0.1, Math.min(zoom * delta, 20));
  const scale = newZoom / zoom;
  panX = mx - scale * (mx - panX);
  panY = my - scale * (my - panY);
  zoom = newZoom;
  updateTransform();
}, { passive: false });

viewportEl.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    viewportEl.style.cursor = 'grabbing';
  }
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = e.clientX - panStartX;
  panY = e.clientY - panStartY;
  updateTransform();
});

window.addEventListener('mouseup', () => {
  isPanning = false;
  viewportEl.style.cursor = 'grab';
});

// Toolbar buttons
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  zoom = Math.min(zoom * 1.2, 20);
  updateTransform();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  zoom = Math.max(zoom / 1.2, 0.1);
  updateTransform();
});
document.getElementById('btn-zoom-fit').addEventListener('click', () => {
  resetView();
});
document.getElementById('btn-open').addEventListener('click', () => {
  fileInput.click();
});
document.getElementById('btn-layers').addEventListener('click', () => {
  const btn = document.getElementById('btn-layers');
  layersSidebar.classList.toggle('visible');
  btn.classList.toggle('active');
});
document.getElementById('btn-layer-matrix').addEventListener('click', showLayerMatrix);
layerMatrixClose.addEventListener('click', hideLayerMatrix);
layerMatrixModal.addEventListener('click', (e) => {
  if (e.target === layerMatrixModal) hideLayerMatrix();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layerMatrixModal.classList.contains('visible')) hideLayerMatrix();
});

layerFilterMode.addEventListener('change', () => {
  focusedLayerIndex = null;
  buildLayersSidebar();
});

layerFilterText.addEventListener('input', () => {
  focusedLayerIndex = null;
  buildLayersSidebar();
});

layersSelectAll.addEventListener('click', () => setLayerSelection(getCurrentLayers(), true));
layersDeselectAll.addEventListener('click', () => setLayerSelection(getCurrentLayers(), false));
layersSelectFiltered.addEventListener('click', () => setLayerSelection(getFilteredLayers(), true));
layersDeselectFiltered.addEventListener('click', () => setLayerSelection(getFilteredLayers(), false));

layersList.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveLayerFocus(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveLayerFocus(-1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusFirstOrLastLayer(true);
  } else if (e.key === 'End') {
    e.preventDefault();
    focusFirstOrLastLayer(false);
  } else if (e.key === 'PageDown') {
    e.preventDefault();
    moveLayerFocus(10);
  } else if (e.key === 'PageUp') {
    e.preventDefault();
    moveLayerFocus(-10);
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    const item = document.activeElement?.closest?.('.layer-item');
    const layerIndex = item?.dataset.layerIndex ?? focusedLayerIndex;
    if (layerIndex !== null) toggleLayer(layerIndex);
  }
});

// Export SVG
document.getElementById('btn-export').addEventListener('click', () => {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (fileName.textContent || 'diagram').replace('.vsdx', '') + '.svg';
  a.click();
  URL.revokeObjectURL(url);
});
