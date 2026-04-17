import { parseVsdx, saveVsdxLayerPermissions, saveVsdxWithoutHiddenLayers, saveVsdxWithoutNonSelectedLayers, saveVsdxWithoutNonVisibleData, getVsdxShapeXmlSnippet, replaceVsdxShapeXmlSnippet } from './vsdx-parser.js';
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
const layerMatrixSearch = document.getElementById('layer-matrix-search');
const layerMatrixReplace = document.getElementById('layer-matrix-replace');
const layerMatrixReplaceAll = document.getElementById('layer-matrix-replace-all');
const layerMatrixReplaceStatus = document.getElementById('layer-matrix-replace-status');
const saveVsdxButton = document.getElementById('btn-save-vsdx');
const removeNonSelectedButton = document.getElementById('btn-remove-non-selected');
const removeNonVisibleButton = document.getElementById('btn-remove-non-visible');
const shapeTreeSidebar = document.getElementById('shape-tree-sidebar');
const shapeTreeSubtitle = document.getElementById('shape-tree-subtitle');
const shapeTreeBody = document.getElementById('shape-tree-body');
const shapeContextMenu = document.getElementById('shape-context-menu');
const shapeContextSubtitle = document.getElementById('shape-context-subtitle');
const shapeContextSearch = document.getElementById('shape-context-search');
const shapeContextList = document.getElementById('shape-context-list');
const shapeContextEditXml = document.getElementById('shape-context-edit-xml');
const shapeXmlModal = document.getElementById('shape-xml-modal');
const shapeXmlClose = document.getElementById('shape-xml-close');
const shapeXmlCancel = document.getElementById('shape-xml-cancel');
const shapeXmlSave = document.getElementById('shape-xml-save');
const shapeXmlTextarea = document.getElementById('shape-xml-textarea');

let currentPages = [];
let currentPageIndex = 0;
let zoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStartX, panStartY;
let hiddenLayers = new Set();
let focusedLayerIndex = null;
let currentFileBuffer = null;
let currentFileType = null;
let contextShapeId = null;
let selectedShapeId = null;
let editingShapeId = null;
let editingShapeXmlId = null;
const hiddenShapeIdsByPage = new Map();
const collapsedShapeIdsByPage = new Map();
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2000;

async function applyUpdatedVsdxBuffer(buffer, pageId = null) {
  const result = await parseVsdx(buffer);
  currentFileBuffer = buffer;
  currentPages = result.pages;
  hiddenShapeIdsByPage.clear();
  collapsedShapeIdsByPage.clear();

  if (pageId !== null && pageId !== undefined) {
    const nextIndex = currentPages.findIndex(page => String(page.id) === String(pageId));
    currentPageIndex = nextIndex >= 0 ? nextIndex : 0;
  } else {
    const firstFg = currentPages.findIndex(p => !p.isBackground);
    currentPageIndex = firstFg >= 0 ? firstFg : 0;
  }

  hiddenLayers = getInitialHiddenLayers();
  focusedLayerIndex = null;
  selectedShapeId = null;
  editingShapeId = null;
  buildPageTabs();
  buildLayersSidebar();
  renderCurrentPage();
}

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
  applyShapeVisibility();
  syncSelectedShapeHighlight();
  attachSvgLayerFocusHandlers();
  renderShapeTree();
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
      selectedShapeId = null;
      editingShapeId = null;
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

function getCurrentLayer(layerIndex) {
  return getCurrentLayers().find(layer => String(layer.index) === String(layerIndex));
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
  const layer = getCurrentLayer(layerIndex);
  if (layer) layer.visible = selected;

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
    layer.visible = selected;
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

function findShapeById(shapes, shapeId) {
  for (const shape of shapes || []) {
    if (String(shape.id) === String(shapeId)) return shape;
    const child = findShapeById(shape.subShapes || [], shapeId);
    if (child) return child;
  }
  return null;
}

function findPageForShape(shapeId) {
  const currentPage = getCurrentPage();
  if (!currentPage) return null;

  if (findShapeById(currentPage.shapes || [], shapeId)) return currentPage;
  if (currentPage.backPage) {
    const bgPage = currentPages.find(page => String(page.id) === String(currentPage.backPage));
    if (bgPage && findShapeById(bgPage.shapes || [], shapeId)) return bgPage;
  }
  return null;
}

function findShapePath(shapes, shapeId, path = []) {
  for (const shape of shapes || []) {
    const nextPath = [...path, shape];
    if (String(shape.id) === String(shapeId)) return nextPath;
    const childPath = findShapePath(shape.subShapes || [], shapeId, nextPath);
    if (childPath) return childPath;
  }
  return null;
}

function getCurrentPage() {
  return currentPages[currentPageIndex] || null;
}

function getCurrentPageKey() {
  const page = getCurrentPage();
  return page ? String(page.id) : '';
}

function getHiddenShapeIds(pageKey = getCurrentPageKey()) {
  if (!hiddenShapeIdsByPage.has(pageKey)) hiddenShapeIdsByPage.set(pageKey, new Set());
  return hiddenShapeIdsByPage.get(pageKey);
}

function getCollapsedShapeIds(pageKey = getCurrentPageKey()) {
  if (!collapsedShapeIdsByPage.has(pageKey)) collapsedShapeIdsByPage.set(pageKey, new Set());
  return collapsedShapeIdsByPage.get(pageKey);
}

function getTreeRootShape(shapeId = selectedShapeId) {
  if (shapeId === null || shapeId === undefined) return null;
  const path = findShapePath(getCurrentPage()?.shapes || [], shapeId);
  if (!path || path.length === 0) return null;
  return path.length > 1 ? path[path.length - 2] : path[0];
}

function normalizeShapeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isGenericShapeTitle(shape) {
  if (!shape?.title || shape?.id === null || shape?.id === undefined) return false;
  const title = String(shape.title).trim();
  return title === `Shape.${shape.id}` || title === `Group.${shape.id}`;
}

function getShapeLabel(shape) {
  if (!shape) return '';
  const text = normalizeShapeText(shape.text);
  const title = normalizeShapeText(shape.title);
  const name = normalizeShapeText(shape.name);
  const nameU = normalizeShapeText(shape.nameU);

  if (name) return name;
  if (nameU) return nameU;
  if (text && isGenericShapeTitle(shape)) return text;
  if (title) return title;
  if (text) return text;
  return `${shape.type || 'Shape'} ${shape.id}`;
}

function getShapeTreeMeta(shape) {
  if (!shape) return '';
  const parts = [`${shape.type || 'Shape'} #${shape.id}`];
  const text = normalizeShapeText(shape.text);
  if (text && text !== getShapeLabel(shape)) parts.push(text);
  return parts.join(' · ');
}

function setShapeName(shapeId, nextName) {
  const shape = findShapeById(getCurrentPage()?.shapes || [], shapeId);
  if (!shape) return;
  const trimmed = normalizeShapeText(nextName);
  shape.name = trimmed || null;
  shape.nameU = trimmed || null;
  shape.title = trimmed || (normalizeShapeText(shape.text) || `${shape.type || 'Shape'}.${shape.id}`);
  editingShapeId = null;
  renderCurrentPage();
}

function syncSelectedShapeHighlight() {
  const groups = svgContainer.querySelectorAll('g[data-shape-id]');
  for (const group of groups) {
    const isSelected = selectedShapeId !== null && group.getAttribute('data-shape-id') === String(selectedShapeId);
    group.style.outline = isSelected ? '2px solid #e94560' : '';
    group.style.outlineOffset = isSelected ? '2px' : '';
  }
}

function applyShapeVisibility() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  const hiddenShapeIds = getHiddenShapeIds();
  const groups = svg.querySelectorAll('g[data-shape-id]');
  for (const group of groups) {
    if (hiddenShapeIds.has(group.getAttribute('data-shape-id'))) {
      group.style.display = 'none';
    }
  }
}

function removeShapeById(shapes, shapeId) {
  for (let i = 0; i < (shapes || []).length; i++) {
    const shape = shapes[i];
    if (String(shape.id) === String(shapeId)) {
      shapes.splice(i, 1);
      return true;
    }
    if (removeShapeById(shape.subShapes || [], shapeId)) return true;
  }
  return false;
}

function setSelectedShape(shapeId) {
  selectedShapeId = shapeId === null || shapeId === undefined ? null : String(shapeId);
  editingShapeId = null;
  renderCurrentPage();
}

function setShapeVisible(shapeId, visible) {
  const hiddenShapeIds = getHiddenShapeIds();
  const key = String(shapeId);
  if (visible) hiddenShapeIds.delete(key);
  else hiddenShapeIds.add(key);
  applyLayerVisibility();
  applyShapeVisibility();
  syncSelectedShapeHighlight();
  renderShapeTree();
}

function toggleShapeTreeBranch(shapeId) {
  const collapsedShapeIds = getCollapsedShapeIds();
  const key = String(shapeId);
  if (collapsedShapeIds.has(key)) collapsedShapeIds.delete(key);
  else collapsedShapeIds.add(key);
  renderShapeTree();
}

function deleteShapeFromTree(shapeId) {
  const page = getCurrentPage();
  const key = String(shapeId);
  if (!page) return;
  const root = getTreeRootShape();
  const path = findShapePath(page.shapes || [], key);
  if (!path) return;

  removeShapeById(page.shapes || [], key);
  getHiddenShapeIds().delete(key);
  getCollapsedShapeIds().delete(key);
  if (editingShapeId === key) editingShapeId = null;

  if (selectedShapeId !== null) {
    const selectedPath = findShapePath([root].filter(Boolean), selectedShapeId) || findShapePath(page.shapes || [], selectedShapeId);
    if (!selectedPath) selectedShapeId = root && String(root.id) !== key ? String(root.id) : null;
  }

  renderCurrentPage();
}

function createShapeTreeNode(shape, depth, rootShapeId) {
  const hiddenShapeIds = getHiddenShapeIds();
  const collapsedShapeIds = getCollapsedShapeIds();
  const hasChildren = (shape.subShapes || []).length > 0;
  const row = document.createElement('div');
  row.className = 'shape-tree-node';
  if (selectedShapeId !== null && String(shape.id) === String(selectedShapeId)) row.classList.add('selected');
  if (hiddenShapeIds.has(String(shape.id))) row.classList.add('hidden');
  row.style.paddingLeft = `${8 + depth * 18}px`;

  const expander = document.createElement('button');
  expander.type = 'button';
  expander.className = 'shape-tree-expander';
  expander.textContent = hasChildren && collapsedShapeIds.has(String(shape.id)) ? '+' : '-';
  expander.disabled = !hasChildren;
  expander.addEventListener('click', () => {
    if (hasChildren) toggleShapeTreeBranch(shape.id);
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'shape-tree-checkbox';
  checkbox.checked = !hiddenShapeIds.has(String(shape.id));
  checkbox.setAttribute('aria-label', `Toggle visibility for ${getShapeLabel(shape)}`);
  checkbox.addEventListener('change', () => setShapeVisible(shape.id, checkbox.checked));

  const isEditing = editingShapeId !== null && String(shape.id) === String(editingShapeId);
  let label;
  if (isEditing) {
    label = document.createElement('input');
    label.type = 'text';
    label.className = 'shape-tree-editor';
    label.value = normalizeShapeText(shape.name) || normalizeShapeText(shape.nameU) || normalizeShapeText(shape.text) || '';
    label.placeholder = getShapeLabel(shape);
    label.addEventListener('click', (e) => e.stopPropagation());
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        setShapeName(shape.id, label.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editingShapeId = null;
        renderShapeTree();
      }
    });
    label.addEventListener('blur', () => setShapeName(shape.id, label.value));
    queueMicrotask(() => {
      label.focus();
      label.select();
    });
  } else {
    label = document.createElement('button');
    label.type = 'button';
    label.className = 'shape-tree-label';
    label.textContent = getShapeLabel(shape);
    const meta = document.createElement('span');
    meta.className = 'shape-tree-meta';
    meta.textContent = getShapeTreeMeta(shape);
    label.appendChild(meta);
    label.addEventListener('click', () => setSelectedShape(shape.id));
    label.addEventListener('dblclick', (e) => {
      e.preventDefault();
      editingShapeId = String(shape.id);
      renderShapeTree();
    });
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'shape-tree-delete';
  remove.textContent = '×';
  remove.disabled = String(shape.id) === String(rootShapeId);
  remove.title = remove.disabled ? 'Root shape cannot be deleted from this view' : 'Delete this shape from the current view';
  remove.addEventListener('click', () => deleteShapeFromTree(shape.id));

  const editXml = document.createElement('button');
  editXml.type = 'button';
  editXml.className = 'shape-tree-xml';
  editXml.textContent = '</>';
  editXml.title = 'Edit this shape XML';
  editXml.addEventListener('click', () => openShapeXmlEditor(shape.id));

  row.appendChild(expander);
  row.appendChild(checkbox);
  row.appendChild(label);
  row.appendChild(editXml);
  row.appendChild(remove);

  const fragment = document.createDocumentFragment();
  fragment.appendChild(row);

  if (hasChildren && !collapsedShapeIds.has(String(shape.id))) {
    for (const child of shape.subShapes) {
      fragment.appendChild(createShapeTreeNode(child, depth + 1, rootShapeId));
    }
  }

  return fragment;
}

function renderShapeTree() {
  const root = getTreeRootShape();
  shapeTreeBody.innerHTML = '';

  if (!root || !findShapeById(getCurrentPage()?.shapes || [], root.id)) {
    shapeTreeSidebar.classList.remove('visible');
    shapeTreeSubtitle.textContent = 'Select a shape to inspect its parent group.';
    const empty = document.createElement('div');
    empty.className = 'shape-tree-empty';
    empty.textContent = 'Select a shape to inspect its parent group.';
    shapeTreeBody.appendChild(empty);
    return;
  }

  shapeTreeSidebar.classList.add('visible');
  const selected = findShapeById(getCurrentPage()?.shapes || [], selectedShapeId);
  shapeTreeSubtitle.textContent = `${getShapeLabel(root)} · selected ${getShapeLabel(selected)}`;
  shapeTreeBody.appendChild(createShapeTreeNode(root, 0, root.id));
}

function getContextShape() {
  return contextShapeId !== null ? findShapeById(currentPages[currentPageIndex]?.shapes || [], contextShapeId) : null;
}

function hideShapeXmlEditor() {
  editingShapeXmlId = null;
  shapeXmlModal.classList.remove('visible');
}

async function openShapeXmlEditor(shapeId) {
  if (currentFileType !== 'vsdx' || !currentFileBuffer) {
    showError('Shape XML editing is only available for .vsdx files');
    return;
  }

  const page = findPageForShape(shapeId);
  if (!page) return;

  try {
    editingShapeXmlId = String(shapeId);
    shapeXmlTextarea.value = await getVsdxShapeXmlSnippet(currentFileBuffer, page.id, shapeId);
    shapeXmlModal.classList.add('visible');
    closeShapeContextMenu();
    shapeXmlTextarea.focus();
    shapeXmlTextarea.select();
  } catch (e) {
    console.error(e);
    showError('Failed to load shape XML: ' + e.message);
  }
}

async function applyShapeXmlEditor() {
  if (editingShapeXmlId === null || currentFileType !== 'vsdx' || !currentFileBuffer) return;
  const page = findPageForShape(editingShapeXmlId);
  if (!page) return;

  try {
    const editedShapeId = editingShapeXmlId;
    const buffer = await replaceVsdxShapeXmlSnippet(currentFileBuffer, page.id, editedShapeId, shapeXmlTextarea.value);
    hideShapeXmlEditor();
    await applyUpdatedVsdxBuffer(buffer, getCurrentPage()?.id || page.id);
    setSelectedShape(editedShapeId);
  } catch (e) {
    console.error(e);
    showError('Failed to apply shape XML: ' + e.message);
  }
}

function closeShapeContextMenu() {
  contextShapeId = null;
  shapeContextMenu.classList.remove('visible');
}

function layerMatchesContextFilter(layer) {
  const needle = normalizeLayerText(shapeContextSearch?.value);
  if (!needle) return true;
  const haystack = [layer.name, layer.nameUniv, layer.index].map(normalizeLayerText).join(' ');
  return haystack.includes(needle);
}

function assignShapeToLayer(shapeId, layerIndex) {
  const shape = findShapeById(currentPages[currentPageIndex]?.shapes || [], shapeId);
  if (!shape) return;
  shape.layerMembers = [String(layerIndex)];
  closeShapeContextMenu();
  renderCurrentPage();
}

function renderShapeContextMenu() {
  const page = currentPages[currentPageIndex];
  const shape = getContextShape();
  if (!page || !shape) {
    closeShapeContextMenu();
    return;
  }

  const currentLayer = String(shape.layerMembers?.[0] || '');
  const layers = (page.layers || []).filter(layerMatchesContextFilter);
  shapeContextSubtitle.textContent = `${shape.title || shape.name || `Shape ${shape.id}`} · current layer ${currentLayer || 'none'}`;
  shapeContextList.innerHTML = '';

  if (!layers.length) {
    const empty = document.createElement('div');
    empty.className = 'shape-context-empty';
    empty.textContent = 'No matching layers.';
    shapeContextList.appendChild(empty);
    return;
  }

  for (const layer of layers) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'shape-context-item';
    if (String(layer.index) === currentLayer) item.classList.add('current');
    item.addEventListener('click', () => assignShapeToLayer(shape.id, layer.index));

    const name = document.createElement('span');
    name.className = 'shape-context-item-name';
    name.textContent = layer.name || `Layer ${layer.index}`;

    const meta = document.createElement('span');
    meta.className = 'shape-context-item-meta';
    meta.textContent = `#${layer.index}${String(layer.index) === currentLayer ? ' · current' : ''}`;

    item.appendChild(name);
    item.appendChild(meta);
    shapeContextList.appendChild(item);
  }
}

function openShapeContextMenu(shapeId, clientX, clientY) {
  contextShapeId = String(shapeId);
  shapeContextSearch.value = '';
  renderShapeContextMenu();
  shapeContextMenu.classList.add('visible');

  const margin = 12;
  const maxLeft = window.innerWidth - shapeContextMenu.offsetWidth - margin;
  const maxTop = window.innerHeight - shapeContextMenu.offsetHeight - margin;
  shapeContextMenu.style.left = `${Math.max(margin, Math.min(clientX, maxLeft))}px`;
  shapeContextMenu.style.top = `${Math.max(margin, Math.min(clientY, maxTop))}px`;
  shapeContextSearch.focus();
  shapeContextSearch.select();
}

function attachSvgLayerFocusHandlers() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  svg.addEventListener('click', (e) => {
    focusLayerFromSvgElement(e.target);
    const group = e.target.closest?.('g[data-shape-id]');
    if (group) setSelectedShape(group.getAttribute('data-shape-id'));
  });
  svg.addEventListener('contextmenu', (e) => {
    const group = e.target.closest?.('g[data-shape-id]');
    if (!group) return;
    e.preventDefault();
    openShapeContextMenu(group.getAttribute('data-shape-id'), e.clientX, e.clientY);
  });
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

function createEditableBoolCell(page, layer, prop, defaultValue, matrixRow = null, matrixCol = null, onChange = null) {
  const cell = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = layer[prop] ?? defaultValue;
  input.setAttribute('aria-label', `${layer.name} ${prop}`);
  if (matrixRow !== null && matrixCol !== null) {
    input.dataset.matrixRow = String(matrixRow);
    input.dataset.matrixCol = String(matrixCol);
  }
  input.addEventListener('change', () => {
    layer[prop] = input.checked;
    layer.cells = layer.cells || {};
    layer.cells[prop[0].toUpperCase() + prop.slice(1)] = input.checked ? '1' : '0';
    if (onChange) onChange(input.checked);
  });
  cell.appendChild(input);
  return cell;
}

function createEditableTextCell(page, layer, prop, fallbackValue = '', matrixRow = null, matrixCol = null, onChange = null) {
  const cell = document.createElement('td');
  cell.className = 'matrix-layer-name';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'matrix-text-input';
  input.value = layer[prop] ?? fallbackValue;
  input.placeholder = fallbackValue;
  input.setAttribute('aria-label', `${page.name || 'Page'} ${prop}`);
  if (matrixRow !== null && matrixCol !== null) {
    input.dataset.matrixRow = String(matrixRow);
    input.dataset.matrixCol = String(matrixCol);
  }
  input.addEventListener('change', () => {
    const nextValue = input.value.trim() || fallbackValue;
    if (prop === 'name') setLayerName(layer, nextValue);
    else layer[prop] = nextValue;
    input.value = nextValue;
    if (onChange) onChange(nextValue);
  });
  cell.appendChild(input);
  return cell;
}

function normalizeMatrixText(value) {
  return String(value || '').toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setLayerName(layer, name) {
  layer.name = name;
  layer.nameUniv = name;
  layer.cells = layer.cells || {};
  layer.cells.Name = name;
  layer.cells.NameUniv = name;
}

function updateMatrixReplaceState() {
  if (!layerMatrixReplaceAll) return;
  layerMatrixReplaceAll.disabled = !String(layerMatrixSearch?.value || '').trim();
}

function setMatrixReplaceStatus(text) {
  if (!layerMatrixReplaceStatus) return;
  layerMatrixReplaceStatus.textContent = text;
}

function replaceAllMatrixLayerNames() {
  const findText = String(layerMatrixSearch?.value || '').trim();
  if (!findText) {
    setMatrixReplaceStatus('Enter search text');
    updateMatrixReplaceState();
    return;
  }

  const replacement = String(layerMatrixReplace?.value || '');
  const matcher = new RegExp(escapeRegExp(findText), 'gi');
  let changed = 0;

  for (const page of currentPages.filter(page => !page.isBackground)) {
    for (const layer of page.layers || []) {
      const currentName = layer.name || `Layer ${layer.index}`;
      if (!matcher.test(currentName)) {
        matcher.lastIndex = 0;
        continue;
      }

      matcher.lastIndex = 0;
      setLayerName(layer, currentName.replace(matcher, () => replacement));
      changed += 1;
    }
  }

  if (changed > 0) {
    buildLayersSidebar();
    buildLayerMatrix();
  }
  setMatrixReplaceStatus(changed === 1 ? '1 renamed' : `${changed} renamed`);
  updateMatrixReplaceState();
}

function layerMatchesMatrixFilter(page, layer) {
  const needle = normalizeMatrixText(layerMatrixSearch?.value);
  if (!needle) return true;

  const haystack = [
    page.name || 'Page',
    layer.name || `Layer ${layer.index}`,
    layer.nameUniv || '',
    layer.index,
    layer.color || '',
    layer.colorTrans || ''
  ].map(normalizeMatrixText).join(' ');

  return haystack.includes(needle);
}

function focusMatrixInput(row, col) {
  const target = layerMatrixBody.querySelector(
    `input[data-matrix-row="${CSS.escape(String(row))}"][data-matrix-col="${CSS.escape(String(col))}"]`
  );
  if (!target) return false;
  target.focus();
  return true;
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
  let editableRowCount = 0;

  for (const page of pages) {
    const layers = (page.layers || []).filter(layer => layerMatchesMatrixFilter(page, layer));
    if (!layers.length) {
      const row = document.createElement('tr');
      row.appendChild(createTextCell(page.name || 'Page'));
      const emptyCell = createTextCell(layerMatrixSearch?.value ? 'No matching layers' : 'No layers', 'matrix-muted');
      emptyCell.colSpan = 11;
      row.appendChild(emptyCell);
      body.appendChild(row);
      continue;
    }

    for (const layer of layers) {
      const isCurrentPage = currentPages.indexOf(page) === currentPageIndex;
      const displayedNow = isCurrentPage ? !hiddenLayers.has(layer.index) : layer.visible !== false;
      const row = document.createElement('tr');
      const matrixRow = editableRowCount++;
      row.appendChild(createTextCell(page.name || 'Page'));
      row.appendChild(createEditableTextCell(page, layer, 'name', `Layer ${layer.index}`, matrixRow, 0, () => {
        if (isCurrentPage) buildLayersSidebar();
        buildLayerMatrix();
      }));
      row.appendChild(createTextCell(String(layer.index)));
      row.appendChild(createEditableBoolCell(page, layer, 'visible', true, matrixRow, 1, (selected) => {
        if (isCurrentPage) {
          if (selected) hiddenLayers.delete(layer.index);
          else hiddenLayers.add(layer.index);
          buildLayersSidebar();
          applyLayerVisibility();
        }
        buildLayerMatrix();
      }));
      row.appendChild(createBoolCell(displayedNow, true));
      row.appendChild(createEditableBoolCell(page, layer, 'print', true, matrixRow, 2));
      row.appendChild(createEditableBoolCell(page, layer, 'active', false, matrixRow, 3));
      row.appendChild(createEditableBoolCell(page, layer, 'lock', false, matrixRow, 4));
      row.appendChild(createEditableBoolCell(page, layer, 'snap', true, matrixRow, 5));
      row.appendChild(createEditableBoolCell(page, layer, 'glue', true, matrixRow, 6));
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
  updateMatrixReplaceState();
  setMatrixReplaceStatus('');
  layerMatrixModal.classList.add('visible');
  layerMatrixSearch?.focus();
  layerMatrixSearch?.select();
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
    currentFileBuffer = buffer;
    currentFileType = name.endsWith('.vsdx') ? 'vsdx' : 'vsd';
    const result = currentFileType === 'vsd' ? await parseVsd(buffer) : await parseVsdx(buffer);
    currentPages = result.pages;
    hiddenShapeIdsByPage.clear();
    collapsedShapeIdsByPage.clear();
    saveVsdxButton.disabled = currentFileType !== 'vsdx';
    removeNonSelectedButton.disabled = currentFileType !== 'vsdx';
    removeNonVisibleButton.disabled = currentFileType !== 'vsdx';
    // Default to first foreground page
    const firstFg = currentPages.findIndex(p => !p.isBackground);
    currentPageIndex = firstFg >= 0 ? firstFg : 0;
    showViewer();
    buildPageTabs();
    hiddenLayers = getInitialHiddenLayers();
    focusedLayerIndex = null;
    selectedShapeId = null;
    editingShapeId = null;
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
  const newZoom = Math.max(MIN_ZOOM, Math.min(zoom * delta, MAX_ZOOM));
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
  zoom = Math.min(zoom * 1.2, MAX_ZOOM);
  updateTransform();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  zoom = Math.max(zoom / 1.2, MIN_ZOOM);
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
saveVsdxButton.addEventListener('click', async () => {
  if (currentFileType !== 'vsdx' || !currentFileBuffer) {
    showError('Save VSDX is only available for .vsdx files');
    return;
  }

  try {
    const output = await saveVsdxLayerPermissions(currentFileBuffer, currentPages);
    const blob = new Blob([output], { type: 'application/vnd.ms-visio.drawing.main+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fileName.textContent || 'diagram.vsdx').replace(/\.vsdx$/i, '') + '-layers.vsdx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    showError('Failed to save VSDX: ' + e.message);
  }
});
removeNonSelectedButton.addEventListener('click', async () => {
  if (currentFileType !== 'vsdx' || !currentFileBuffer) {
    showError('Remove non-selected is only available for .vsdx files');
    return;
  }

  const page = currentPages[currentPageIndex];
  const selectedLayerIndexes = new Set(getCurrentLayers()
    .filter(layer => !hiddenLayers.has(layer.index))
    .map(layer => String(layer.index)));

  if (!selectedLayerIndexes.size) {
    showError('Select at least one layer before removing non-selected shapes');
    return;
  }
  if (selectedLayerIndexes.size === getCurrentLayers().length) {
    showError('Deselect at least one layer before removing non-selected shapes');
    return;
  }

  try {
    const { buffer, removedCount } = await saveVsdxWithoutNonSelectedLayers(
      currentFileBuffer,
      currentPages,
      page.id,
      selectedLayerIndexes
    );
    if (removedCount === 0) {
      showError('No shapes matched the non-selected layers on this page');
      return;
    }
    await applyUpdatedVsdxBuffer(buffer, page.id);
  } catch (e) {
    console.error(e);
    showError('Failed to remove non-selected layers: ' + e.message);
  }
});
removeNonVisibleButton.addEventListener('click', async () => {
  if (currentFileType !== 'vsdx' || !currentFileBuffer) {
    showError('Remove non-visible is only available for .vsdx files');
    return;
  }

  const page = currentPages[currentPageIndex];
  const hiddenLayerIndexes = new Set(getCurrentLayers()
    .filter(layer => hiddenLayers.has(layer.index))
    .map(layer => String(layer.index)));

  try {
    const { buffer, removedCount } = await saveVsdxWithoutNonVisibleData(
      currentFileBuffer,
      currentPages,
      page.id,
      hiddenLayerIndexes
    );
    if (removedCount === 0) {
      showError('No non-visible data was removed from this page');
      return;
    }
    await applyUpdatedVsdxBuffer(buffer, page.id);
  } catch (e) {
    console.error(e);
    showError('Failed to remove non-visible data: ' + e.message);
  }
});
layerMatrixClose.addEventListener('click', hideLayerMatrix);
layerMatrixModal.addEventListener('click', (e) => {
  if (e.target === layerMatrixModal) hideLayerMatrix();
});
layerMatrixSearch.addEventListener('input', () => {
  buildLayerMatrix();
  updateMatrixReplaceState();
  setMatrixReplaceStatus('');
});
layerMatrixReplace?.addEventListener('input', () => setMatrixReplaceStatus(''));
layerMatrixReplace?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  replaceAllMatrixLayerNames();
});
layerMatrixReplaceAll?.addEventListener('click', replaceAllMatrixLayerNames);
shapeContextSearch.addEventListener('input', renderShapeContextMenu);
shapeContextEditXml?.addEventListener('click', () => {
  if (contextShapeId !== null) openShapeXmlEditor(contextShapeId);
});
shapeXmlClose?.addEventListener('click', hideShapeXmlEditor);
shapeXmlCancel?.addEventListener('click', hideShapeXmlEditor);
shapeXmlSave?.addEventListener('click', applyShapeXmlEditor);
shapeXmlModal?.addEventListener('click', (e) => {
  if (e.target === shapeXmlModal) hideShapeXmlEditor();
});
document.addEventListener('click', (e) => {
  if (!shapeContextMenu.classList.contains('visible')) return;
  if (shapeContextMenu.contains(e.target)) return;
  closeShapeContextMenu();
});
layerMatrixBody.addEventListener('keydown', (e) => {
  const input = e.target?.closest?.('input[data-matrix-row][data-matrix-col]');
  if (!input) return;

  const row = Number.parseInt(input.dataset.matrixRow, 10);
  const col = Number.parseInt(input.dataset.matrixCol, 10);
  if (Number.isNaN(row) || Number.isNaN(col)) return;

  let nextRow = row;
  let nextCol = col;
  if (e.key === 'ArrowUp') nextRow -= 1;
  else if (e.key === 'ArrowDown') nextRow += 1;
  else if (e.key === 'ArrowLeft') {
    if (input.type === 'text' && (input.selectionStart !== 0 || input.selectionEnd !== 0)) return;
    nextCol -= 1;
  } else if (e.key === 'ArrowRight') {
    if (input.type === 'text' && (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length)) return;
    nextCol += 1;
  }
  else return;

  e.preventDefault();
  focusMatrixInput(nextRow, nextCol);
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && layerMatrixModal.classList.contains('visible')) {
    e.preventDefault();
    layerMatrixSearch.focus();
    layerMatrixSearch.select();
    return;
  }
  if (e.key === 'Escape' && shapeXmlModal.classList.contains('visible')) {
    hideShapeXmlEditor();
    return;
  }
  if (e.key === 'Escape' && shapeContextMenu.classList.contains('visible')) {
    closeShapeContextMenu();
    return;
  }
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
