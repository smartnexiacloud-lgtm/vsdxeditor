import { parseVsdx, saveVsdxLayerPermissions, saveVsdxWithoutHiddenLayers, saveVsdxWithoutNonSelectedLayers, saveVsdxWithoutNonVisibleData, getVsdxShapeXmlSnippet, replaceVsdxShapeXmlSnippet, addVsdxShapeToPage, normalizeLayerTags, normalizeTagColor } from './vsdx-parser.js';
import { embedVsdxInSvg, extractVsdxFromSvg } from './svg-vsdx-embed.js';
import { parseVsd } from './vsd-parser.js';
import { renderPage, pageCoordinateWidth } from './svg-renderer.js';
import { buildPenShapeXml, penPathToSvgD } from './pen-geometry.js';
import { shapesAtPoint, shapesOnLayer } from './shape-picker.js';
import { openDiffView } from './diff-view.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const viewer = document.getElementById('viewer');
const pageTabs = document.getElementById('page-tabs');
const pageTabContextMenu = document.getElementById('page-tab-context-menu');
const svgContainer = document.getElementById('svg-container');
const zoomInfo = document.getElementById('zoom-info');
const strokeModeSelect = document.getElementById('stroke-mode');
const rerenderButton = document.getElementById('btn-rerender');
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
const layerMatrixPage = document.getElementById('layer-matrix-page');
const layerMatrixViews = document.getElementById('layer-matrix-views');
const layerMatrixViewSelect = document.getElementById('layer-matrix-view-select');
const btnMatrixViewSave = document.getElementById('btn-matrix-view-save');
const btnMatrixViewUpdate = document.getElementById('btn-matrix-view-update');
const btnMatrixViewDelete = document.getElementById('btn-matrix-view-delete');
const saveVsdxButton = document.getElementById('btn-save-vsdx');
const removeNonSelectedButton = document.getElementById('btn-remove-non-selected');
const removeNonVisibleButton = document.getElementById('btn-remove-non-visible');
const layersViews = document.getElementById('layers-views');
const layersTags = document.getElementById('layers-tags');
const layersTagLegend = document.getElementById('layers-tag-legend');
const layerMatrixTags = document.getElementById('layer-matrix-tags');
const layerMatrixTagLegend = document.getElementById('layer-matrix-tag-legend');
const viewSelect = document.getElementById('view-select');
const btnViewSave = document.getElementById('btn-view-save');
const btnViewUpdate = document.getElementById('btn-view-update');
const btnViewDelete = document.getElementById('btn-view-delete');
const compareButton = document.getElementById('btn-compare');
const compareInput = document.getElementById('compare-input');
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
const penButton = document.getElementById('btn-pen');
const penBar = document.getElementById('pen-bar');
const penStrokeOn = document.getElementById('pen-stroke-on');
const penStrokeColor = document.getElementById('pen-stroke-color');
const penStrokeWidth = document.getElementById('pen-stroke-width');
const penStrokePattern = document.getElementById('pen-stroke-pattern');
const penFillOn = document.getElementById('pen-fill-on');
const penFillColor = document.getElementById('pen-fill-color');
const penFillOpacity = document.getElementById('pen-fill-opacity');
const penClosePath = document.getElementById('pen-close-path');
const penFinishButton = document.getElementById('pen-finish');
const penUndoButton = document.getElementById('pen-undo');
const penCancelButton = document.getElementById('pen-cancel');
const penHint = document.getElementById('pen-hint');
const layerObjectsPanel = document.getElementById('layer-objects');
const layerObjectsTitle = document.getElementById('layer-objects-title');
const layerObjectsList = document.getElementById('layer-objects-list');
const layerObjectsClose = document.getElementById('layer-objects-close');
const shapePickSection = document.getElementById('shape-pick-section');
const shapePickHint = document.getElementById('shape-pick-hint');
const shapePickList = document.getElementById('shape-pick-list');

let currentPages = [];
let currentPageIndex = 0;
let zoom = 1;
// 'screen' keeps Visio hairlines at least one device pixel wide at the zoom the
// page was rendered for; 'true' draws every line at its real Visio weight.
// Either way the minimum is baked into the SVG, so changing zoom does not
// change it until the page is re-rendered - hence the Update button.
let strokeMode = 'screen';
let renderedZoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStartX, panStartY;
let hiddenLayers = new Set();
let focusedLayerIndex = null;
let currentFileBuffer = null;
let currentFileType = null;
let currentFileExtension = '.vsdx';
let currentPackageEditable = false;
let viewTemplates = [];
// Document-wide tag palette: { <lowercased tag>: '#rrggbb' }.
let layerTagColors = {};
let selectedViewIndex = null;
let draggedPageId = null;
let contextPageId = null;
let contextShapeId = null;
let selectedShapeId = null;
let editingShapeId = null;
let editingShapeXmlId = null;
const hiddenShapeIdsByPage = new Map();
const collapsedShapeIdsByPage = new Map();
// Pen tool. penNodes are in page units (inches, Y up from the page bottom) -
// the space the parser and pen-geometry both speak, so nothing is converted
// twice. penDrag tracks the handle being pulled out of the node just placed.
let penActive = false;
let penNodes = [];
let penDrag = null;
let penCursor = null;
let penCommitting = false;
// Which layer's object list is open in the sidebar, and the shapes offered by
// the last right-click, topmost first.
let layerObjectsIndex = null;
let contextPickEntries = [];
// How close (in device pixels) a click has to land to the first anchor to be
// read as "close the path" rather than "place another point".
const PEN_CLOSE_PX = 8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2000;
const XML_VISIO_EXTENSIONS = new Set(['.vsdx', '.vsdm', '.vstx', '.vstm', '.vssx', '.vssm']);
const BINARY_VISIO_EXTENSIONS = new Set(['.vsd', '.vst', '.vss']);

function getFileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function getVisioFormat(name) {
  const extension = getFileExtension(name);
  if (XML_VISIO_EXTENSIONS.has(extension)) return { family: 'xml', extension };
  if (BINARY_VISIO_EXTENSIONS.has(extension)) return { family: 'binary', extension };
  return null;
}

// Rewriting a shape means rebuilding the package and re-parsing it, and the
// sidebar is rebuilt from whatever comes back. Anything the user changed that
// is still only in memory therefore has to be written into the bytes *first* or
// the re-parse reverts it — which is why a hand-edit of one shape's XML used to
// reset the layers. The prune paths already fold this in themselves
// (patchVsdxLayerPermissions); this is the same step for the edit paths.
async function getPackageBufferWithPendingEdits() {
  if (!currentFileBuffer) return null;
  if (!currentPackageEditable) return currentFileBuffer;
  commitCurrentPageVisibility();
  return saveVsdxLayerPermissions(currentFileBuffer, currentPages, viewTemplates, layerTagColors);
}

async function applyUpdatedVsdxBuffer(buffer, pageId = null) {
  // The "Unlayered" row is an editor-only construct with nowhere to live in the
  // file, so it cannot survive the round-trip above; carry it across by hand.
  const unlayeredHidden = hiddenLayers.has(UNLAYERED_LAYER_INDEX);
  const result = await parseVsdx(buffer);
  currentFileBuffer = buffer;
  currentPages = result.pages;
  layerTagColors = { ...(result.layerTagColors || {}) };
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
  if (unlayeredHidden) {
    const page = currentPages[currentPageIndex];
    hiddenLayers.add(UNLAYERED_LAYER_INDEX);
    if (page && hasUnlayeredShapes(page.shapes)) getUnlayeredLayer(page).visible = false;
  }
  focusedLayerIndex = null;
  selectedShapeId = null;
  editingShapeId = null;
  buildPageTabs();
  buildLayersSidebar();
  renderCurrentPage();
}

function getInitialHiddenLayers(page = currentPages[currentPageIndex]) {
  const hidden = new Set((page?.layers || [])
    .filter(layer => layer.visible === false)
    .map(layer => layer.index));
  if (page?._unlayeredLayer?.visible === false) hidden.add(UNLAYERED_LAYER_INDEX);
  return hidden;
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
  updateRerenderState();
}

// Page coordinate units per device pixel at the current zoom. Measured off the
// SVG on screen (its box already includes the container's scale) so it stays
// right whatever the layout does, but only when that SVG is the same page we
// are about to draw; otherwise the container shows a page at 1 unit per CSS
// pixel and the zoom factor is the whole story.
function unitsPerDevicePixel(page) {
  const svg = svgContainer.querySelector('svg');
  const viewBox = svg?.getAttribute('viewBox')?.split(/[\s,]+/);
  const width = svg?.getBoundingClientRect().width;
  if (viewBox && viewBox.length === 4 && width > 0) {
    const units = parseFloat(viewBox[2]);
    const expected = pageCoordinateWidth(page);
    if (Number.isFinite(units) && units > 0 && Math.abs(units - expected) < Math.max(1, expected * 0.01)) {
      return units / width;
    }
  }
  return 1 / Math.max(zoom, 0.0001);
}

function currentMinStrokeWidth(page) {
  return strokeMode === 'screen' ? unitsPerDevicePixel(page) : 0;
}

// The Update button lights up once the view has been zoomed away from the zoom
// the SVG was rendered for, since that is when hairlines are off.
function updateRerenderState() {
  if (!rerenderButton) return;
  const stale = strokeMode === 'screen' && currentPages.length > 0
    && Math.abs(Math.log(zoom / renderedZoom)) > 0.1;
  rerenderButton.classList.toggle('stale', stale);
  rerenderButton.title = stale
    ? `Re-render for ${Math.round(zoom * 100)}% (drawn for ${Math.round(renderedZoom * 100)}%)`
    : 'Re-render this page for the current zoom';
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

  renderPage(renderedPage, svgContainer, { minStrokeWidth: currentMinStrokeWidth(renderedPage) });
  renderedZoom = zoom;
  updateRerenderState();
  applyLayerVisibility();
  applyShapeVisibility();
  syncSelectedShapeHighlight();
  attachSvgLayerFocusHandlers();
  renderShapeTree();
  // The overlay lives inside the SVG that was just replaced, and the shape list
  // may now be stale.
  renderLayerObjects();
}

function activatePage(page) {
  const index = currentPages.indexOf(page);
  if (index < 0) return;
  // A half-drawn path, and a shape list, belong to the page they came from.
  cancelPenPath();
  closeLayerObjects();
  currentPageIndex = index;
  buildPageTabs();
  hiddenLayers = getInitialHiddenLayers();
  focusedLayerIndex = null;
  selectedShapeId = null;
  editingShapeId = null;
  buildLayersSidebar();
  resetView();
  renderCurrentPage();
}

function closePages(pages) {
  const foregroundPages = currentPages.filter(page => !page.isBackground);
  const closeIds = new Set((pages || []).filter(page => !page.isBackground).map(page => String(page.id)));
  const closingPages = foregroundPages.filter(page => closeIds.has(String(page.id)));
  if (!closingPages.length || foregroundPages.length - closingPages.length < 1) return;

  const activePage = currentPages[currentPageIndex];
  const activePageClosed = closeIds.has(String(activePage?.id));
  const firstClosedIndex = Math.min(...closingPages.map(page => foregroundPages.indexOf(page)));
  currentPages = currentPages.filter(page => !closeIds.has(String(page.id)));

  for (const pageId of closeIds) {
    hiddenShapeIdsByPage.delete(pageId);
    collapsedShapeIdsByPage.delete(pageId);
  }
  for (const view of viewTemplates) {
    view.pages = (view.pages || []).filter(page => !closeIds.has(String(page.id)));
  }

  if (activePageClosed) {
    const remaining = currentPages.filter(page => !page.isBackground);
    const nextPage = remaining[Math.min(firstClosedIndex, remaining.length - 1)];
    currentPageIndex = currentPages.indexOf(nextPage);
  } else {
    currentPageIndex = currentPages.indexOf(activePage);
  }

  hidePageTabContextMenu();
  hiddenLayers = getInitialHiddenLayers();
  focusedLayerIndex = null;
  selectedShapeId = null;
  editingShapeId = null;
  buildPageTabs();
  buildLayersSidebar();
  refreshViewsUI();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
  resetView();
  renderCurrentPage();
}

function reorderPage(sourcePage, targetPage, placeAfter) {
  if (!sourcePage || !targetPage || sourcePage === targetPage) return;
  const activePage = currentPages[currentPageIndex];
  const foregroundPages = currentPages.filter(page => !page.isBackground);
  const sourceIndex = foregroundPages.indexOf(sourcePage);
  if (sourceIndex < 0) return;
  foregroundPages.splice(sourceIndex, 1);
  const targetIndex = foregroundPages.indexOf(targetPage);
  foregroundPages.splice(targetIndex + (placeAfter ? 1 : 0), 0, sourcePage);

  let foregroundIndex = 0;
  currentPages = currentPages.map(page => page.isBackground ? page : foregroundPages[foregroundIndex++]);
  currentPageIndex = currentPages.indexOf(activePage);
  buildPageTabs();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
}

function renamePage(page) {
  if (!page) return;
  const name = (window.prompt('Rename sheet:', page.name || '') || '').trim();
  if (!name || name === page.name) return;
  page.name = name;
  for (const view of viewTemplates) {
    const snapshot = (view.pages || []).find(candidate => String(candidate.id) === String(page.id));
    if (snapshot) snapshot.name = name;
  }
  buildPageTabs();
  buildLayersSidebar();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
}

function hidePageTabContextMenu() {
  if (!pageTabContextMenu) return;
  pageTabContextMenu.style.display = 'none';
  contextPageId = null;
}

function showPageTabContextMenu(page, x, y) {
  if (!pageTabContextMenu) return;
  const foregroundPages = currentPages.filter(candidate => !candidate.isBackground);
  const pageIndex = foregroundPages.indexOf(page);
  contextPageId = String(page.id);
  pageTabContextMenu.querySelector('[data-tab-action="close"]').disabled = foregroundPages.length <= 1;
  pageTabContextMenu.querySelector('[data-tab-action="close-left"]').disabled = pageIndex <= 0;
  pageTabContextMenu.querySelector('[data-tab-action="close-right"]').disabled = pageIndex >= foregroundPages.length - 1;
  pageTabContextMenu.querySelector('[data-tab-action="close-others"]').disabled = foregroundPages.length <= 1;
  pageTabContextMenu.style.display = 'block';
  const rect = pageTabContextMenu.getBoundingClientRect();
  pageTabContextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  pageTabContextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
}

function buildPageTabs() {
  pageTabs.innerHTML = '';
  const foregroundPages = currentPages.filter(page => !page.isBackground);
  for (const page of foregroundPages) {
    const tab = document.createElement('div');
    tab.className = 'page-tab' + (currentPages.indexOf(page) === currentPageIndex ? ' active' : '');
    tab.dataset.pageId = String(page.id);
    tab.draggable = true;
    tab.setAttribute('role', 'tab');

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'page-tab-label';
    label.textContent = page.name;
    label.title = page.name;
    label.addEventListener('click', () => activatePage(page));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'page-tab-close';
    close.innerHTML = '&times;';
    close.title = `Delete ${page.name}`;
    close.setAttribute('aria-label', `Delete sheet ${page.name}`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closePages([page]);
    });

    tab.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showPageTabContextMenu(page, event.clientX, event.clientY);
    });
    tab.addEventListener('dragstart', (event) => {
      draggedPageId = String(page.id);
      tab.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedPageId);
    });
    tab.addEventListener('dragover', (event) => {
      if (draggedPageId === null || draggedPageId === String(page.id)) return;
      event.preventDefault();
      const placeAfter = event.clientX >= tab.getBoundingClientRect().left + tab.offsetWidth / 2;
      tab.classList.toggle('drop-before', !placeAfter);
      tab.classList.toggle('drop-after', placeAfter);
    });
    tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
    tab.addEventListener('drop', (event) => {
      event.preventDefault();
      const sourcePage = currentPages.find(candidate => String(candidate.id) === draggedPageId);
      const placeAfter = event.clientX >= tab.getBoundingClientRect().left + tab.offsetWidth / 2;
      reorderPage(sourcePage, page, placeAfter);
    });
    tab.addEventListener('dragend', () => {
      draggedPageId = null;
      for (const candidate of pageTabs.querySelectorAll('.page-tab')) {
        candidate.classList.remove('dragging', 'drop-before', 'drop-after');
      }
    });

    tab.append(label, close);
    pageTabs.appendChild(tab);
  }
}

pageTabContextMenu?.addEventListener('click', (event) => {
  const action = event.target.closest('[data-tab-action]')?.dataset.tabAction;
  const foregroundPages = currentPages.filter(page => !page.isBackground);
  const page = foregroundPages.find(candidate => String(candidate.id) === contextPageId);
  const pageIndex = foregroundPages.indexOf(page);
  if (!action || !page || pageIndex < 0) return;
  if (action === 'rename') {
    hidePageTabContextMenu();
    renamePage(page);
  } else if (action === 'close') closePages([page]);
  else if (action === 'close-left') closePages(foregroundPages.slice(0, pageIndex));
  else if (action === 'close-right') closePages(foregroundPages.slice(pageIndex + 1));
  else if (action === 'close-others') closePages(foregroundPages.filter(candidate => candidate !== page));
});
document.addEventListener('click', (event) => {
  if (!pageTabContextMenu?.contains(event.target)) hidePageTabContextMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hidePageTabContextMenu();
});

function buildLayersSidebar() {
  layersList.innerHTML = '';
  if (!currentPages.length) return;
  const layers = getCurrentLayers();
  refreshTagUI();

  if (layers.length === 0) {
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
    if (isUnnamedLayer(layer)) item.classList.add('unnamed-layer');
    if (isVirtualLayer(layer)) item.classList.add('virtual-layer');

    const displayName = getLayerDisplayName(layer);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hiddenLayers.has(layer.index);
    checkbox.id = `layer-cb-${layer.index}`;
    checkbox.tabIndex = -1;
    checkbox.setAttribute('aria-label', displayName);

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = displayName;
    name.title = isVirtualLayer(layer)
      ? 'Editor-only layer for shapes with no Visio layer membership'
      : (isUnnamedLayer(layer) ? `${displayName} (unnamed layer)` : displayName);

    checkbox.addEventListener('change', () => {
      setLayerSelected(layer.index, checkbox.checked);
    });

    item.addEventListener('click', (e) => {
      focusLayerRow(layer.index, false);
      if (e.target !== checkbox) toggleLayer(layer.index);
    });

    item.addEventListener('focus', () => focusLayerRow(layer.index, false));

    const objects = document.createElement('button');
    objects.type = 'button';
    objects.className = 'layer-objects-btn';
    if (String(layer.index) === String(layerObjectsIndex)) objects.classList.add('active');
    objects.textContent = '⊙';
    objects.tabIndex = -1;
    objects.title = `List every shape on ${displayName}`;
    objects.setAttribute('aria-label', `List shapes on ${displayName}`);
    objects.addEventListener('click', (e) => {
      e.stopPropagation();
      openLayerObjects(layer.index);
    });

    item.appendChild(checkbox);
    item.appendChild(name);
    item.appendChild(objects);

    const tags = document.createElement('span');
    tags.className = 'layer-tags';
    for (const tag of getLayerTags(layer)) {
      const chip = document.createElement('span');
      chip.className = 'layer-tag';
      chip.textContent = tag;
      chip.title = `Tag: ${tag}`;
      styleTagChip(chip, tag);
      tags.appendChild(chip);
    }
    item.appendChild(tags);

    // Tags need somewhere to be written back to, which only editable XML
    // packages have.
    if (!isVirtualLayer(layer) && currentPackageEditable) {
      const tagButton = document.createElement('button');
      tagButton.type = 'button';
      tagButton.className = 'layer-tag-edit';
      tagButton.textContent = '🏷';
      tagButton.tabIndex = -1;
      tagButton.title = `Edit tags for ${displayName}`;
      tagButton.setAttribute('aria-label', `Edit tags for ${displayName}`);
      // The row click toggles visibility; tagging must not also flip the layer.
      tagButton.addEventListener('click', (e) => {
        e.stopPropagation();
        promptLayerTags(layer);
      });
      item.appendChild(tagButton);
    }

    layersList.appendChild(item);
  }

  updateLayersCount(layers.length, visibleLayers.length);
  updateLayerBulkButtons(visibleLayers.length);
}

function normalizeLayerText(value) {
  return String(value || '').trim().toLowerCase();
}

// Visio keeps unnamed placeholder rows for deleted layers so indexes remain
// stable. Only surface a placeholder when a shape still references it; this
// avoids resurrecting historical tombstones while keeping every live layer
// controllable.
function isRealLayer(layer) {
  return !layer.placeholder;
}

const UNLAYERED_LAYER_INDEX = '__vsdxeditor_unlayered__';

function isVirtualLayer(layer) {
  return layer?.virtual === true;
}

function hasUnlayeredShapes(shapes) {
  for (const shape of shapes || []) {
    if (!(shape.layerMembers || []).length) return true;
    if (hasUnlayeredShapes(shape.subShapes)) return true;
  }
  return false;
}

function getUnlayeredLayer(page) {
  if (!page._unlayeredLayer) {
    page._unlayeredLayer = {
      index: UNLAYERED_LAYER_INDEX,
      name: UNLAYERED_LAYER_INDEX,
      nameUniv: UNLAYERED_LAYER_INDEX,
      virtual: true,
      visible: true,
      print: true,
      active: false,
      lock: false,
      snap: true,
      glue: true,
    };
  }
  return page._unlayeredLayer;
}

function collectReferencedLayerIndexes(shapes, indexes = new Set()) {
  for (const shape of shapes || []) {
    for (const index of shape.layerMembers || []) indexes.add(String(index));
    collectReferencedLayerIndexes(shape.subShapes, indexes);
  }
  return indexes;
}

function getUiLayers(page) {
  if (!page) return [];
  const declaredLayers = page.layers || [];
  const referenced = collectReferencedLayerIndexes(page.shapes);
  const layers = declaredLayers.filter(layer => isRealLayer(layer) || referenced.has(String(layer.index)));
  const declaredIndexes = new Set(declaredLayers.map(layer => String(layer.index)));
  for (const index of referenced) {
    if (!declaredIndexes.has(index)) {
      layers.push({ index, name: '', nameUniv: null, placeholder: true, implicit: true, visible: true });
    }
  }
  if (hasUnlayeredShapes(page.shapes)) layers.push(getUnlayeredLayer(page));
  return layers;
}

function getCurrentLayers() {
  return getUiLayers(currentPages[currentPageIndex]);
}

function isUnnamedLayer(layer) {
  return !String(layer?.name || layer?.nameUniv || '').trim();
}

function getLayerDisplayName(layer) {
  if (isVirtualLayer(layer)) return 'Unlayered';
  return isUnnamedLayer(layer) ? `Layer ${layer.index}` : layer.name;
}

// ── Layer tags ────────────────────────────────────────────────────────────
// Labels a user sticks on a layer ("electrical", "draft"). They are not a Visio
// concept, so they are persisted into the drawing's Solution XML store, which
// survives a real Visio open+save (see docs/visio-roundtrip.md).
function getLayerTags(layer) {
  return Array.isArray(layer?.tags) ? layer.tags : [];
}

function setLayerTags(layer, tags) {
  // The virtual "Unlayered" row is an editor fiction with nowhere to persist to.
  if (!layer || isVirtualLayer(layer)) return false;
  const next = normalizeLayerTags(tags);
  if (next.join(',') === getLayerTags(layer).join(',')) return false;
  if (next.length) layer.tags = next;
  else delete layer.tags;
  return true;
}

function tagKey(tag) {
  return String(tag || '').trim().toLowerCase();
}

// Until someone picks a colour, a tag gets a stable one derived from its name,
// so chips are already distinguishable on a freshly tagged drawing.
function defaultTagColor(tag) {
  const key = tagKey(tag);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const [r, g, b] = hslToRgb(hue / 360, 0.52, 0.55);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function getTagColor(tag) {
  return layerTagColors[tagKey(tag)] || defaultTagColor(tag);
}

function setTagColor(tag, color) {
  const normalized = normalizeTagColor(color);
  if (!normalized) return;
  layerTagColors[tagKey(tag)] = normalized;
}

// Chip text has to stay readable on whatever colour the user picked.
function contrastTextColor(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return '#f0f0f5';
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? '#141a2e' : '#f4f2ff';
}

function styleTagChip(chip, tag) {
  const color = getTagColor(tag);
  chip.style.background = color;
  chip.style.borderColor = color;
  chip.style.color = contrastTextColor(color);
}

// Every tag in use on the current page, with how many layers carry it.
function getPageTagUsage(page = currentPages[currentPageIndex]) {
  const usage = new Map();
  for (const layer of getUiLayers(page)) {
    for (const tag of getLayerTags(layer)) {
      const key = tagKey(tag);
      const entry = usage.get(key) || { tag, count: 0 };
      entry.count += 1;
      usage.set(key, entry);
    }
  }
  return [...usage.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

function getDocumentTagUsage() {
  const usage = new Map();
  for (const page of currentPages) {
    for (const { tag, count } of getPageTagUsage(page)) {
      const key = tagKey(tag);
      const entry = usage.get(key) || { tag, count: 0 };
      entry.count += count;
      usage.set(key, entry);
    }
  }
  return [...usage.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

function buildTagLegend(container, usage, onPick) {
  container.innerHTML = '';
  for (const { tag, count } of usage) {
    const item = document.createElement('span');
    item.className = 'tag-legend-item';

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.value = getTagColor(tag);
    swatch.title = `Colour for "${tag}"`;
    swatch.setAttribute('aria-label', `Colour for tag ${tag}`);
    swatch.addEventListener('input', () => {
      setTagColor(tag, swatch.value);
      refreshTagUI();
    });

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'tag-legend-name';
    name.textContent = tag;
    name.title = `Filter layers tagged "${tag}"`;
    name.addEventListener('click', () => onPick(tag));

    const countEl = document.createElement('span');
    countEl.className = 'tag-legend-count';
    countEl.textContent = String(count);

    item.append(swatch, name, countEl);
    container.appendChild(item);
  }
}

function refreshTagUI() {
  const pageUsage = getPageTagUsage();
  if (layersTags) layersTags.style.display = pageUsage.length ? '' : 'none';
  if (layersTagLegend) {
    buildTagLegend(layersTagLegend, pageUsage, (tag) => {
      layerFilterMode.value = 'contains';
      layerFilterText.value = `tag:${tag}`;
      buildLayersSidebar();
    });
  }

  const docUsage = getDocumentTagUsage();
  if (layerMatrixTags) layerMatrixTags.style.display = docUsage.length ? '' : 'none';
  if (layerMatrixTagLegend) {
    buildTagLegend(layerMatrixTagLegend, docUsage, (tag) => {
      if (!layerMatrixSearch) return;
      layerMatrixSearch.value = tag;
      buildLayerMatrix();
      updateMatrixReplaceState();
    });
  }

  // Chips already on screen need the new colour without a full rebuild.
  for (const chip of layersList.querySelectorAll('.layer-tag')) styleTagChip(chip, chip.textContent);
}

function promptLayerTags(layer) {
  if (isVirtualLayer(layer)) return;
  const answer = window.prompt(
    `Tags for "${getLayerDisplayName(layer)}" (comma-separated):`,
    getLayerTags(layer).join(', ')
  );
  if (answer === null) return;
  if (!setLayerTags(layer, answer)) return;
  buildLayersSidebar();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
}

function getCurrentLayer(layerIndex) {
  // Unfiltered on purpose: a shape may still reference a placeholder index.
  return (currentPages[currentPageIndex]?.layers || [])
    .find(layer => String(layer.index) === String(layerIndex));
}

function needleMatches(haystack, needle, mode) {
  switch (mode) {
    case 'starts':
      return haystack.startsWith(needle);
    case 'ends':
      return haystack.endsWith(needle);
    case 'equals':
      return haystack === needle;
    case 'notContains':
    case 'contains':
    default:
      return haystack.includes(needle);
  }
}

function layerMatchesFilter(layer) {
  const raw = String(layerFilterText.value || '').trim();
  // `tag:foo` narrows the search to tags, so "Deselect filter" can hide every
  // layer carrying a tag without name collisions getting in the way.
  const tagsOnly = /^tag:/i.test(raw);
  const needle = normalizeLayerText(tagsOnly ? raw.slice(4) : raw);
  if (!needle) return true;

  const tags = getLayerTags(layer).map(normalizeLayerText);
  const haystacks = tagsOnly ? tags : [normalizeLayerText(getLayerDisplayName(layer)), ...tags];
  const mode = layerFilterMode.value;
  const hit = haystacks.some(haystack => needleMatches(haystack, needle, mode));
  return mode === 'notContains' ? !hit : hit;
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
  if (layerIndex === UNLAYERED_LAYER_INDEX) getUnlayeredLayer(currentPages[currentPageIndex]).visible = selected;

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
    if (isVirtualLayer(layer)) getUnlayeredLayer(currentPages[currentPageIndex]).visible = selected;
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
  if (!currentPackageEditable || !currentFileBuffer) {
    showError('Shape XML editing is only available for editable XML Visio packages');
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
  if (editingShapeXmlId === null || !currentPackageEditable || !currentFileBuffer) return;
  const page = findPageForShape(editingShapeXmlId);
  if (!page) return;

  try {
    const editedShapeId = editingShapeXmlId;
    const base = await getPackageBufferWithPendingEdits();
    const buffer = await replaceVsdxShapeXmlSnippet(base, page.id, editedShapeId, shapeXmlTextarea.value);
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
  contextPickEntries = [];
  clearShapeHighlight();
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
  const layers = (page.layers || []).filter(isRealLayer).filter(layerMatchesContextFilter);
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

function openShapeContextMenu(shapeId, clientX, clientY, pickEntries = []) {
  contextShapeId = String(shapeId);
  contextPickEntries = pickEntries;
  shapeContextSearch.value = '';
  renderShapeContextMenu();
  renderShapePickList();
  shapeContextMenu.classList.add('visible');

  const margin = 12;
  const maxLeft = window.innerWidth - shapeContextMenu.offsetWidth - margin;
  const maxTop = window.innerHeight - shapeContextMenu.offsetHeight - margin;
  shapeContextMenu.style.left = `${Math.max(margin, Math.min(clientX, maxLeft))}px`;
  shapeContextMenu.style.top = `${Math.max(margin, Math.min(clientY, maxTop))}px`;
  shapeContextSearch.focus();
  shapeContextSearch.select();
}

// --- Picking shapes: highlight, the layer object list, the right-click stack --
// Both surfaces answer the same question — "which shape is this?" — so they
// share a row renderer and one highlight overlay: hovering a row draws a
// selection square around that shape on the canvas.

function clearShapeHighlight() {
  svgContainer.querySelector('#shape-highlight')?.remove();
}

function highlightShapeBox(entry) {
  clearShapeHighlight();
  const svg = svgContainer.querySelector('svg');
  const page = getCurrentPage();
  if (!svg || !page || !entry) return;

  const ns = 'http://www.w3.org/2000/svg';
  const dpi = getPageDpi(page);
  const unit = unitsPerDevicePixel(page);
  const box = entry.bounds;
  const pad = unit * 2;
  const x = box.minX * dpi - pad;
  const y = (page.height - box.maxY) * dpi - pad;
  // A zero-extent shape (a horizontal line) still needs a grabbable box.
  const w = Math.max((box.maxX - box.minX) * dpi, unit) + pad * 2;
  const h = Math.max((box.maxY - box.minY) * dpi, unit) + pad * 2;

  const group = document.createElementNS(ns, 'g');
  group.setAttribute('id', 'shape-highlight');
  group.setAttribute('pointer-events', 'none');

  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('fill', '#e94560');
  rect.setAttribute('fill-opacity', '0.12');
  rect.setAttribute('stroke', '#e94560');
  rect.setAttribute('stroke-width', String(unit * 1.5));
  rect.setAttribute('stroke-dasharray', `${unit * 4} ${unit * 3}`);
  group.appendChild(rect);

  // Corner ticks, so it reads as a selection square rather than a fill.
  const tick = unit * 5;
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]
  ]) {
    const corner = document.createElementNS(ns, 'path');
    corner.setAttribute('d', `M ${cx} ${cy + dy * tick} L ${cx} ${cy} L ${cx + dx * tick} ${cy}`);
    corner.setAttribute('fill', 'none');
    corner.setAttribute('stroke', '#e94560');
    corner.setAttribute('stroke-width', String(unit * 2));
    group.appendChild(corner);
  }

  svg.appendChild(group);
}

// A shape the user cannot currently see is still worth listing — it is often
// exactly what they are hunting for — but it has to say so.
function isEntryHidden(entry) {
  if (getHiddenShapeIds().has(String(entry.id))) return true;
  if (!entry.layerMembers.length) return hiddenLayers.has(UNLAYERED_LAYER_INDEX);
  return entry.layerMembers.every(member => hiddenLayers.has(String(member)));
}

function createShapePickRow(entry, className, onPick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = className;
  row.dataset.shapeId = entry.id;
  if (selectedShapeId !== null && String(entry.id) === String(selectedShapeId)) row.classList.add('selected');

  const label = document.createElement('span');
  label.className = 'shape-pick-label';
  if (entry.depth > 0) {
    const indent = document.createElement('span');
    indent.className = 'shape-pick-depth';
    indent.textContent = '›'.repeat(entry.depth) + ' ';
    label.appendChild(indent);
  }
  label.appendChild(document.createTextNode(entry.label));

  const meta = document.createElement('span');
  meta.className = 'shape-pick-meta';
  const bits = [`#${entry.id}`];
  if (entry.isGroup) bits.push('group');
  if (isEntryHidden(entry)) bits.push('hidden');
  meta.textContent = bits.join(' · ');

  row.title = `${entry.label} (ID ${entry.id})`;
  row.appendChild(label);
  row.appendChild(meta);

  row.addEventListener('mouseenter', () => highlightShapeBox(entry));
  row.addEventListener('focus', () => highlightShapeBox(entry));
  row.addEventListener('mouseleave', () => clearShapeHighlight());
  row.addEventListener('blur', () => clearShapeHighlight());
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    onPick(entry);
  });
  return row;
}

function closeLayerObjects() {
  layerObjectsIndex = null;
  clearShapeHighlight();
  if (layerObjectsPanel) layerObjectsPanel.hidden = true;
}

function renderLayerObjects() {
  if (!layerObjectsPanel) return;
  const page = getCurrentPage();
  if (layerObjectsIndex === null || !page) {
    layerObjectsPanel.hidden = true;
    return;
  }

  const layer = getUiLayers(page).find(candidate => String(candidate.index) === String(layerObjectsIndex));
  const entries = shapesOnLayer(page, layerObjectsIndex, { unlayeredIndex: UNLAYERED_LAYER_INDEX });

  layerObjectsPanel.hidden = false;
  layerObjectsTitle.textContent =
    `${layer ? getLayerDisplayName(layer) : 'Layer'} — ${entries.length} object${entries.length === 1 ? '' : 's'}`;
  layerObjectsList.innerHTML = '';

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'layer-objects-empty';
    empty.textContent = 'No shapes on this layer.';
    layerObjectsList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    layerObjectsList.appendChild(createShapePickRow(entry, 'layer-object-row', (picked) => {
      setSelectedShape(picked.id);
      renderLayerObjects();
    }));
  }
}

function openLayerObjects(layerIndex) {
  layerObjectsIndex = String(layerIndex) === String(layerObjectsIndex) ? null : layerIndex;
  if (layerObjectsIndex === null) closeLayerObjects();
  else renderLayerObjects();
}

function renderShapePickList() {
  if (!shapePickSection) return;
  shapePickSection.hidden = contextPickEntries.length === 0;
  if (!contextPickEntries.length) return;

  shapePickHint.textContent =
    `${contextPickEntries.length} shape${contextPickEntries.length === 1 ? '' : 's'} here · hover to highlight`;
  shapePickList.innerHTML = '';
  for (const entry of contextPickEntries) {
    const row = createShapePickRow(entry, 'shape-pick-row', (picked) => {
      contextShapeId = String(picked.id);
      setSelectedShape(picked.id);
      renderShapeContextMenu();
      renderShapePickList();
    });
    if (contextShapeId !== null && String(entry.id) === String(contextShapeId)) row.classList.add('active');
    shapePickList.appendChild(row);
  }
}

function attachSvgLayerFocusHandlers() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  svg.addEventListener('click', (e) => {
    // While drawing, a click is a path point - not a selection.
    if (penActive) return;
    focusLayerFromSvgElement(e.target);
    const group = e.target.closest?.('g[data-shape-id]');
    if (group) setSelectedShape(group.getAttribute('data-shape-id'));
  });
  svg.addEventListener('contextmenu', (e) => {
    if (penActive) return;
    const page = getCurrentPage();
    const point = clientToPageUnits(e.clientX, e.clientY);
    // Everything whose box covers the click, topmost first, with a few pixels
    // of slop so a hairline is still catchable.
    const entries = page && point
      ? shapesAtPoint(page, point.x, point.y, { slop: pageInchesPerDevicePixel(page) * 3 })
      : [];

    const group = e.target.closest?.('g[data-shape-id]');
    const targetId = group?.getAttribute('data-shape-id') ?? entries[0]?.id ?? null;
    if (targetId === null) return;

    e.preventDefault();
    openShapeContextMenu(targetId, e.clientX, e.clientY, entries);
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

function createLayerTagsCell(page, layer, matrixRow = null, matrixCol = null, onChange = null) {
  const cell = document.createElement('td');
  cell.className = 'matrix-layer-tags';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'matrix-text-input';
  input.value = getLayerTags(layer).join(', ');
  input.placeholder = 'tags…';
  input.disabled = !currentPackageEditable;
  // Page-qualified: the matrix lists the same layer name once per page.
  input.setAttribute('aria-label', `${page.name || 'Page'} ${getLayerDisplayName(layer)} tags`);
  if (matrixRow !== null && matrixCol !== null) {
    input.dataset.matrixRow = String(matrixRow);
    input.dataset.matrixCol = String(matrixCol);
  }
  input.addEventListener('change', () => {
    const changed = setLayerTags(layer, input.value);
    input.value = getLayerTags(layer).join(', ');
    if (changed && onChange) onChange();
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
  if (isVirtualLayer(layer)) return;
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

  for (const page of getMatrixFilteredPages()) {
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

function getMatrixForegroundPages() {
  return currentPages.filter(page => !page.isBackground);
}

// Page filter selection, keyed by the page's index in currentPages ('' = all).
let layerMatrixPageFilter = '';

function refreshMatrixPageFilter() {
  if (!layerMatrixPage) return;
  const pages = getMatrixForegroundPages();
  const prev = layerMatrixPage.value;
  layerMatrixPage.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All pages';
  layerMatrixPage.appendChild(all);
  for (const page of pages) {
    const opt = document.createElement('option');
    opt.value = String(currentPages.indexOf(page));
    opt.textContent = page.name || `Page ${currentPages.indexOf(page) + 1}`;
    layerMatrixPage.appendChild(opt);
  }
  // Keep the previous selection if the page still exists.
  layerMatrixPage.value = (prev && [...layerMatrixPage.options].some(o => o.value === prev)) ? prev : layerMatrixPageFilter;
}

function getMatrixFilteredPages() {
  const pages = getMatrixForegroundPages();
  const selected = layerMatrixPage?.value ?? '';
  if (selected === '') return pages;
  return pages.filter(page => currentPages.indexOf(page) === Number(selected));
}

function layerMatchesMatrixFilter(page, layer) {
  const needle = normalizeMatrixText(layerMatrixSearch?.value);
  if (!needle) return true;

  const haystack = [
    page.name || 'Page',
    getLayerDisplayName(layer),
    layer.nameUniv || '',
    layer.index,
    layer.color || '',
    layer.colorTrans || '',
    ...getLayerTags(layer)
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
  refreshMatrixPageFilter();
  const pages = getMatrixFilteredPages();

  if (!pages.length) {
    layerMatrixBody.textContent = 'No foreground pages loaded.';
    return;
  }

  const table = document.createElement('table');
  table.className = 'layer-matrix';

  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Page', 'Layer', 'Tags', 'Index', 'File Visible', 'Displayed Now', 'Print', 'Active', 'Lock', 'Snap', 'Glue', 'Color', 'Transparency'].forEach(label => {
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
    const layers = getUiLayers(page).filter(layer => layerMatchesMatrixFilter(page, layer));
    if (!layers.length) {
      const row = document.createElement('tr');
      row.appendChild(createTextCell(page.name || 'Page'));
      const emptyCell = createTextCell(layerMatrixSearch?.value ? 'No matching layers' : 'No layers', 'matrix-muted');
      emptyCell.colSpan = 12;
      row.appendChild(emptyCell);
      body.appendChild(row);
      continue;
    }

    for (const layer of layers) {
      const isCurrentPage = currentPages.indexOf(page) === currentPageIndex;
      const displayedNow = isCurrentPage ? !hiddenLayers.has(layer.index) : layer.visible !== false;
      const row = document.createElement('tr');
      if (isUnnamedLayer(layer)) row.classList.add('matrix-unnamed-layer');
      if (isVirtualLayer(layer)) row.classList.add('matrix-virtual-layer');
      const matrixRow = editableRowCount++;
      row.appendChild(createTextCell(page.name || 'Page'));
      if (isVirtualLayer(layer)) {
        row.appendChild(createTextCell('Unlayered'));
        row.appendChild(createTextCell('-', 'matrix-muted'));
        row.appendChild(createTextCell('Editor only', 'matrix-muted'));
      } else {
        row.appendChild(createEditableTextCell(page, layer, 'name', `Layer ${layer.index}`, matrixRow, 0, () => {
          if (isCurrentPage) buildLayersSidebar();
          buildLayerMatrix();
        }));
        row.appendChild(createLayerTagsCell(page, layer, matrixRow, 1, () => {
          if (isCurrentPage) buildLayersSidebar();
          else refreshTagUI();
        }));
        row.appendChild(createTextCell(String(layer.index)));
      }
      row.appendChild(createEditableBoolCell(page, layer, 'visible', true, matrixRow, 2, (selected) => {
        if (isCurrentPage) {
          if (selected) hiddenLayers.delete(layer.index);
          else hiddenLayers.add(layer.index);
          buildLayersSidebar();
          applyLayerVisibility();
        }
        buildLayerMatrix();
      }));
      row.appendChild(createBoolCell(displayedNow, true));
      row.appendChild(createEditableBoolCell(page, layer, 'print', true, matrixRow, 3));
      row.appendChild(createEditableBoolCell(page, layer, 'active', false, matrixRow, 4));
      row.appendChild(createEditableBoolCell(page, layer, 'lock', false, matrixRow, 5));
      row.appendChild(createEditableBoolCell(page, layer, 'snap', true, matrixRow, 6));
      row.appendChild(createEditableBoolCell(page, layer, 'glue', true, matrixRow, 7));
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
    if (allHidden) {
      g.style.display = 'none';
    } else {
      g.style.removeProperty('display');
      // renderShape uses the SVG presentation attribute for the initial file
      // state. Removing only the CSS property leaves that attribute active,
      // so a layer hidden on load can otherwise never be revealed live.
      g.removeAttribute('display');
    }
  }
  const unlayeredHidden = hiddenLayers.has(UNLAYERED_LAYER_INDEX);
  for (const g of svg.querySelectorAll('g[data-shape-id]:not([data-layers])')) {
    if (unlayeredHidden) {
      g.style.display = 'none';
    } else {
      g.style.removeProperty('display');
      g.removeAttribute('display');
    }
  }
}

function resetView() {
  zoom = 1;
  panX = 0;
  panY = 0;
  updateTransform();
}

async function loadFile(file) {
  let name = file.name.toLowerCase();
  if (name.endsWith('.svg')) {
    // SVGs exported by this app carry the source document as base64 metadata;
    // unwrap it and load the embedded .vsdx/.vsd as if it were opened directly.
    const embedded = extractVsdxFromSvg(await file.text());
    if (!embedded) {
      showError('This SVG has no embedded VSDX data (only SVGs exported by this app can be re-opened)');
      return;
    }
    const embeddedName = getVisioFormat(embedded.name)
      ? embedded.name
      : file.name.replace(/\.svg$/i, '') + '.vsdx';
    file = new File([embedded.buffer], embeddedName);
    name = embeddedName.toLowerCase();
  }
  const format = getVisioFormat(name);
  if (!format) {
    showError('Please select a supported Visio drawing, template, stencil, or exported SVG file');
    return;
  }
  try {
    fileName.textContent = file.name;
    const buffer = await file.arrayBuffer();
    currentFileBuffer = buffer;
    currentFileType = format.family === 'xml' ? 'vsdx' : 'vsd';
    currentFileExtension = format.extension;
    const result = currentFileType === 'vsd' ? await parseVsd(buffer) : await parseVsdx(buffer);
    if (!result.pages?.length) throw new Error(`No renderable pages or masters found in ${currentFileExtension}`);
    currentPackageEditable = currentFileType === 'vsdx' && result.hasPagesPart !== false;
    currentPages = result.pages;
    viewTemplates = Array.isArray(result.viewTemplates) ? result.viewTemplates : [];
    layerTagColors = { ...(result.layerTagColors || {}) };
    selectedViewIndex = null;
    hiddenShapeIdsByPage.clear();
    collapsedShapeIdsByPage.clear();
    saveVsdxButton.disabled = !currentPackageEditable;
    saveVsdxButton.textContent = currentPackageEditable
      ? `Save ${currentFileExtension.slice(1).toUpperCase()}`
      : 'Save Visio';
    removeNonSelectedButton.disabled = !currentPackageEditable;
    removeNonVisibleButton.disabled = !currentPackageEditable;
    compareButton.disabled = currentFileType !== 'vsdx';
    // Drawing writes back into the package, so it needs an editable one.
    if (penButton) penButton.disabled = !currentPackageEditable;
    setPenActive(false);
    closeLayerObjects();
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
    refreshViewsUI();
    resetView();
    renderCurrentPage();
  } catch (e) {
    console.error(e);
    showError('Failed to parse Visio file: ' + e.message);
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
  if (penActive && e.button === 0) {
    e.preventDefault();
    penMouseDown(e);
    return;
  }
  if (e.button === 0) {
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    viewportEl.style.cursor = 'grabbing';
  }
});

window.addEventListener('mousemove', (e) => {
  if (penActive) penMouseMove(e);
  if (!isPanning) return;
  panX = e.clientX - panStartX;
  panY = e.clientY - panStartY;
  updateTransform();
});

window.addEventListener('mouseup', () => {
  if (penActive) penMouseUp();
  isPanning = false;
  viewportEl.style.cursor = 'grab';
});

viewportEl.addEventListener('dblclick', (e) => {
  if (!penActive) return;
  e.preventDefault();
  finishPenPathFromDoubleClick();
});

// --- Pen tool -------------------------------------------------------------
// Click places a corner, drag pulls a bezier handle out of the point just
// placed (mirrored on both sides, like Illustrator's smooth point). The path is
// only turned into a shape on commit, because Visio's cubics are fractions of
// the shape's bounding box and that box is not known until the path is done.

function getPageDpi(page) {
  const width = page?.width;
  if (!width) return 96;
  const units = pageCoordinateWidth(page);
  return units > 0 ? units / width : 96;
}

// One device pixel expressed in page inches, for hit tests and for keeping the
// preview handles the same size on screen at any zoom.
function pageInchesPerDevicePixel(page) {
  return unitsPerDevicePixel(page) / getPageDpi(page);
}

function clientToPageUnits(clientX, clientY) {
  const svg = svgContainer.querySelector('svg');
  const page = getCurrentPage();
  if (!svg || !page) return null;

  let ux = null;
  let uy = null;

  // In a browser the SVG knows its own screen transform, which folds in pan,
  // zoom, and whatever layout did to it.
  if (typeof svg.getScreenCTM === 'function' && typeof svg.createSVGPoint === 'function') {
    const ctm = svg.getScreenCTM();
    if (ctm && Number.isFinite(ctm.a) && ctm.a !== 0) {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const local = point.matrixTransform(ctm.inverse());
      ux = local.x;
      uy = local.y;
    }
  }

  // Headless DOMs have no SVG geometry: fall back to the rendered box, then to
  // the pan/zoom transform, which is exact when the SVG is at its natural size.
  if (ux === null) {
    const rect = svg.getBoundingClientRect?.();
    const viewBox = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    if (rect && rect.width > 0 && rect.height > 0 && viewBox?.length === 4) {
      ux = viewBox[0] + ((clientX - rect.left) / rect.width) * viewBox[2];
      uy = viewBox[1] + ((clientY - rect.top) / rect.height) * viewBox[3];
    } else {
      const viewportRect = viewportEl.getBoundingClientRect?.() || { left: 0, top: 0 };
      ux = (clientX - viewportRect.left - panX) / zoom;
      uy = (clientY - viewportRect.top - panY) / zoom;
    }
  }

  const dpi = getPageDpi(page);
  return { x: ux / dpi, y: page.height - uy / dpi };
}

function readPenStyle() {
  const opacity = Number.parseFloat(penFillOpacity?.value);
  return {
    stroke: penStrokeOn ? penStrokeOn.checked : true,
    strokeColor: penStrokeColor?.value || '#1a1a1a',
    strokeWidthPt: Number.isFinite(Number.parseFloat(penStrokeWidth?.value))
      ? Number.parseFloat(penStrokeWidth.value)
      : 1,
    strokePattern: Number.parseInt(penStrokePattern?.value, 10) || 1,
    fill: penFillOn ? penFillOn.checked : false,
    fillColor: penFillColor?.value || '#9ec6ff',
    fillTrans: Number.isFinite(opacity) ? Math.min(1, Math.max(0, 1 - opacity / 100)) : 0
  };
}

function updatePenBarState() {
  const drawing = penNodes.length > 0;
  if (penFinishButton) penFinishButton.disabled = penNodes.length < 2 || penCommitting;
  if (penUndoButton) penUndoButton.disabled = !drawing || penCommitting;
  if (penCancelButton) penCancelButton.disabled = !drawing || penCommitting;
  if (penHint) {
    penHint.textContent = !drawing
      ? 'Click to place a corner · drag to pull a curve'
      : `${penNodes.length} point${penNodes.length === 1 ? '' : 's'} · Enter or double-click finishes · Esc cancels`;
  }
}

function setPenActive(active) {
  const next = Boolean(active) && currentPackageEditable && currentPages.length > 0;
  penActive = next;
  penButton?.classList.toggle('active', next);
  if (penBar) penBar.hidden = !next;
  viewportEl.classList.toggle('pen-active', next);
  if (!next) {
    penNodes = [];
    penCursor = null;
    penDrag = null;
    clearPenPreview();
  }
  updatePenBarState();
}

function clearPenPreview() {
  svgContainer.querySelector('#pen-preview')?.remove();
}

function renderPenPreview() {
  clearPenPreview();
  const svg = svgContainer.querySelector('svg');
  const page = getCurrentPage();
  if (!svg || !page || !penActive || !penNodes.length) return;

  const ns = 'http://www.w3.org/2000/svg';
  const dpi = getPageDpi(page);
  const unit = unitsPerDevicePixel(page);
  const style = readPenStyle();
  const closed = Boolean(penClosePath?.checked) && penNodes.length > 2;
  const toUser = (point) => ({ x: point.x * dpi, y: (page.height - point.y) * dpi });

  const group = document.createElementNS(ns, 'g');
  group.setAttribute('id', 'pen-preview');
  group.setAttribute('pointer-events', 'none');

  const addPath = (d, attrs) => {
    if (!d) return;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    for (const [key, value] of Object.entries(attrs)) path.setAttribute(key, value);
    group.appendChild(path);
  };

  // The committed part of the path, painted with the style it will be saved
  // with so the fill and stroke controls mean something before you commit.
  const committed = penPathToSvgD(penNodes, { closed, dpi, pageHeight: page.height });
  addPath(committed, {
    fill: style.fill ? style.fillColor : 'none',
    'fill-opacity': style.fill ? String(1 - style.fillTrans) : '0',
    'fill-rule': 'evenodd',
    stroke: style.stroke ? style.strokeColor : 'none',
    'stroke-width': String(Math.max((style.strokeWidthPt / 72) * dpi, unit)),
    'stroke-linejoin': 'round'
  });

  // The segment chasing the cursor, dashed so it reads as not-yet-placed.
  if (penCursor && !penDrag) {
    const last = penNodes[penNodes.length - 1];
    addPath(
      penPathToSvgD([last, { x: penCursor.x, y: penCursor.y, cIn: null, cOut: null }], { dpi, pageHeight: page.height }),
      {
        fill: 'none',
        stroke: '#7b52b9',
        'stroke-width': String(unit),
        'stroke-dasharray': `${unit * 4} ${unit * 3}`
      }
    );
  }

  const addCircle = (point, radius, fill, stroke) => {
    const user = toUser(point);
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(user.x));
    circle.setAttribute('cy', String(user.y));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', fill);
    circle.setAttribute('stroke', stroke);
    circle.setAttribute('stroke-width', String(unit));
    group.appendChild(circle);
  };

  const addHandleLine = (from, to) => {
    const a = toUser(from);
    const b = toUser(to);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('stroke', '#7b52b9');
    line.setAttribute('stroke-width', String(unit));
    group.appendChild(line);
  };

  for (let i = 0; i < penNodes.length; i++) {
    const node = penNodes[i];
    for (const control of [node.cIn, node.cOut]) {
      if (!control) continue;
      addHandleLine(node, control);
      addCircle(control, unit * 2.5, '#7b52b9', '#ffffff');
    }
    // The first anchor is the one you click to close the path, so mark it.
    const isFirst = i === 0 && penNodes.length > 2;
    addCircle(node, unit * 3.5, isFirst ? '#7b52b9' : '#ffffff', '#7b52b9');
  }

  svg.appendChild(group);
}

function penMouseDown(e) {
  const point = clientToPageUnits(e.clientX, e.clientY);
  if (!point) return;

  const closeDistance = pageInchesPerDevicePixel(getCurrentPage()) * PEN_CLOSE_PX;
  if (penNodes.length > 2) {
    const first = penNodes[0];
    if (Math.hypot(point.x - first.x, point.y - first.y) <= closeDistance) {
      if (penClosePath) penClosePath.checked = true;
      penCursor = null;
      commitPenPath();
      return;
    }
  }

  penNodes.push({ x: point.x, y: point.y, cIn: null, cOut: null });
  penDrag = { index: penNodes.length - 1, moved: false };
  penCursor = null;
  renderPenPreview();
  updatePenBarState();
}

function penMouseMove(e) {
  const point = clientToPageUnits(e.clientX, e.clientY);
  if (!point) return;

  if (penDrag) {
    const node = penNodes[penDrag.index];
    if (!node) return;
    const dx = point.x - node.x;
    const dy = point.y - node.y;
    // Ignore the shake in a plain click; a corner point should stay a corner.
    if (!penDrag.moved && Math.hypot(dx, dy) < pageInchesPerDevicePixel(getCurrentPage()) * 2) return;
    penDrag.moved = true;
    node.cOut = { x: point.x, y: point.y };
    node.cIn = { x: node.x - dx, y: node.y - dy };
    renderPenPreview();
    return;
  }

  if (penNodes.length) {
    penCursor = point;
    renderPenPreview();
  }
}

function penMouseUp() {
  if (!penDrag) return;
  penDrag = null;
  renderPenPreview();
}

function removeLastPenNode() {
  if (!penNodes.length) return;
  penNodes.pop();
  penDrag = null;
  renderPenPreview();
  updatePenBarState();
}

function cancelPenPath() {
  penNodes = [];
  penCursor = null;
  penDrag = null;
  clearPenPreview();
  updatePenBarState();
}

// A double-click lands after its own mousedown has already placed a point on
// top of the previous one; drop that duplicate before committing.
function finishPenPathFromDoubleClick() {
  if (penNodes.length > 2) {
    const last = penNodes[penNodes.length - 1];
    const previous = penNodes[penNodes.length - 2];
    const slop = pageInchesPerDevicePixel(getCurrentPage()) * PEN_CLOSE_PX;
    if (Math.hypot(last.x - previous.x, last.y - previous.y) <= slop) penNodes.pop();
  }
  commitPenPath();
}

async function commitPenPath() {
  if (penCommitting) return;
  if (penNodes.length < 2) {
    showError('A path needs at least two points');
    return;
  }
  const page = getCurrentPage();
  if (!page || !currentPackageEditable || !currentFileBuffer) return;

  penCommitting = true;
  updatePenBarState();
  try {
    const closed = Boolean(penClosePath?.checked) && penNodes.length > 2;
    const shapeXml = buildPenShapeXml(penNodes, readPenStyle(), { closed });
    const base = await getPackageBufferWithPendingEdits();
    const { buffer, shapeId } = await addVsdxShapeToPage(base, page.id, shapeXml);
    penNodes = [];
    penCursor = null;
    penDrag = null;
    clearPenPreview();
    await applyUpdatedVsdxBuffer(buffer, page.id);
    setSelectedShape(shapeId);
  } catch (e) {
    console.error(e);
    showError('Failed to add the path: ' + e.message);
  } finally {
    penCommitting = false;
    updatePenBarState();
  }
}

layerObjectsClose?.addEventListener('click', () => closeLayerObjects());

penButton?.addEventListener('click', () => setPenActive(!penActive));
penFinishButton?.addEventListener('click', () => commitPenPath());
penUndoButton?.addEventListener('click', () => removeLastPenNode());
penCancelButton?.addEventListener('click', () => cancelPenPath());
for (const control of [penStrokeOn, penStrokeColor, penStrokeWidth, penStrokePattern, penFillOn, penFillColor, penFillOpacity, penClosePath]) {
  control?.addEventListener('input', () => renderPenPreview());
  control?.addEventListener('change', () => renderPenPreview());
}

document.addEventListener('keydown', (e) => {
  if (!penActive) return;
  const tag = e.target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (penNodes.length) cancelPenPath();
    else setPenActive(false);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    commitPenPath();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    removeLastPenNode();
  }
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
// Thin-line handling is deliberately not applied live: the minimum is part of
// the SVG, so following the zoom would mean re-rendering the whole page on
// every wheel tick. Re-render on demand instead.
strokeModeSelect.addEventListener('change', () => {
  strokeMode = strokeModeSelect.value === 'true' ? 'true' : 'screen';
  renderCurrentPage();
});
rerenderButton.addEventListener('click', () => {
  renderCurrentPage();
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

// Compare against another .vsdx (visual diff overlay / side-by-side)
compareButton.addEventListener('click', () => {
  if (currentFileType !== 'vsdx' || !currentFileBuffer) {
    showError('Compare is only available for .vsdx files');
    return;
  }
  compareInput.click();
});
compareInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  compareInput.value = '';
  if (!file) return;
  try {
    const headBuffer = await file.arrayBuffer();
    await openDiffView({
      baseBuffer: currentFileBuffer,
      headBuffer,
      baseName: fileName.textContent || 'base',
      headName: file.name,
      mount: document.body,
    });
  } catch (err) {
    console.error(err);
    showError('Failed to diff: ' + err.message);
  }
});

// ── Named views (layer-visibility presets) ────────────────────────────────
// A view is a per-page snapshot of layer visibility saved under a name. They
// live in the drawing's Visio Solution XML store so they travel with the file
// (shared across a collaborating team) and survive a Microsoft Visio round-trip.
// They are embedded into the download whenever the user does Save VSDX / Export
// SVG — same as every other edit, which is in-memory until saved.

// Push the current page's live checkbox state back onto layer.visible so a
// capture reflects unsaved toggles on the active page (other pages already
// mirror their state in layer.visible).
function commitCurrentPageVisibility() {
  const page = currentPages[currentPageIndex];
  for (const layer of (page?.layers || [])) {
    layer.visible = !hiddenLayers.has(layer.index);
  }
  if (page && hasUnlayeredShapes(page.shapes)) {
    getUnlayeredLayer(page).visible = !hiddenLayers.has(UNLAYERED_LAYER_INDEX);
  }
}

function captureCurrentView(name) {
  commitCurrentPageVisibility();
  return {
    name,
    pages: currentPages
      .filter(page => getUiLayers(page).length)
      .map(page => ({
        id: String(page.id),
        name: page.name || '',
        layers: getUiLayers(page).map(layer => ({
          name: layer.name,
          visible: layer.visible !== false,
          print: layer.print !== false,
          active: layer.active === true,
          lock: layer.lock === true,
          snap: layer.snap !== false,
          glue: layer.glue !== false,
        })),
      })),
  };
}

const VIEW_LAYER_BOOL_PROPS = ['visible', 'print', 'active', 'lock', 'snap', 'glue'];
const VIEW_LAYER_CELL_NAMES = {
  visible: 'Visible',
  print: 'Print',
  active: 'Active',
  lock: 'Lock',
  snap: 'Snap',
  glue: 'Glue',
};

function applyView(view) {
  if (!view) return;
  const pageById = new Map(currentPages.map(page => [String(page.id), page]));
  for (const snapshot of (view.pages || [])) {
    const page = pageById.get(String(snapshot.id))
      || currentPages.find(p => (p.name || '') === snapshot.name);
    if (!page) continue;
    const wanted = new Map((snapshot.layers || []).map(layer => [layer.name, layer]));
    for (const layer of getUiLayers(page)) {
      const savedLayer = wanted.get(layer.name);
      if (!savedLayer) continue;
      for (const prop of VIEW_LAYER_BOOL_PROPS) {
        if (!Object.prototype.hasOwnProperty.call(savedLayer, prop)) continue;
        layer[prop] = savedLayer[prop];
        if (!isVirtualLayer(layer)) {
          layer.cells = layer.cells || {};
          layer.cells[VIEW_LAYER_CELL_NAMES[prop]] = savedLayer[prop] ? '1' : '0';
        }
      }
    }
  }
  hiddenLayers = getInitialHiddenLayers();
  buildLayersSidebar();
  applyLayerVisibility();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
}

function refreshViewsUI() {
  // Only meaningful for writable OPC/XML packages.
  const enabled = currentPackageEditable;
  if (layersViews) layersViews.style.display = enabled ? '' : 'none';
  if (layerMatrixViews) layerMatrixViews.style.display = enabled ? '' : 'none';
  if (selectedViewIndex !== null && selectedViewIndex >= viewTemplates.length) selectedViewIndex = null;
  for (const select of [viewSelect, layerMatrixViewSelect]) {
    if (!select) continue;
    select.innerHTML = '<option value="">— Select a view —</option>';
    viewTemplates.forEach((view, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = view.name;
      select.appendChild(opt);
    });
    select.value = selectedViewIndex === null ? '' : String(selectedViewIndex);
  }
  updateViewButtons();
}

function updateViewButtons() {
  const hasSelection = selectedViewIndex !== null;
  for (const button of [btnViewUpdate, btnViewDelete, btnMatrixViewUpdate, btnMatrixViewDelete]) {
    if (button) button.disabled = !hasSelection;
  }
}

function changeSelectedView(value) {
  selectedViewIndex = value === '' ? null : Number(value);
  for (const select of [viewSelect, layerMatrixViewSelect]) {
    if (select) select.value = selectedViewIndex === null ? '' : String(selectedViewIndex);
  }
  updateViewButtons();
  if (selectedViewIndex !== null) applyView(viewTemplates[selectedViewIndex]);
}

for (const select of [viewSelect, layerMatrixViewSelect]) {
  if (select) select.addEventListener('change', () => changeSelectedView(select.value));
}

function saveNamedView() {
  if (!currentPackageEditable) return;
  const name = (window.prompt('Name this view (captures the current layer settings):') || '').trim();
  if (!name) return;
  const view = captureCurrentView(name);
  const existing = viewTemplates.findIndex(v => v.name === name);
  if (existing >= 0) viewTemplates[existing] = view;
  else viewTemplates.push(view);
  selectedViewIndex = viewTemplates.findIndex(v => v.name === name);
  refreshViewsUI();
}

function updateNamedView() {
  if (selectedViewIndex === null) return;
  viewTemplates[selectedViewIndex] = captureCurrentView(viewTemplates[selectedViewIndex].name);
}

function deleteNamedView() {
  if (selectedViewIndex === null) return;
  viewTemplates.splice(selectedViewIndex, 1);
  selectedViewIndex = null;
  refreshViewsUI();
}

for (const button of [btnViewSave, btnMatrixViewSave]) {
  if (button) button.addEventListener('click', saveNamedView);
}
for (const button of [btnViewUpdate, btnMatrixViewUpdate]) {
  if (button) button.addEventListener('click', updateNamedView);
}
for (const button of [btnViewDelete, btnMatrixViewDelete]) {
  if (button) button.addEventListener('click', deleteNamedView);
}

saveVsdxButton.addEventListener('click', async () => {
  if (!currentPackageEditable || !currentFileBuffer) {
    showError('Saving is only available for Visio XML drawings and templates');
    return;
  }

  try {
    const output = await saveVsdxLayerPermissions(currentFileBuffer, currentPages, viewTemplates, layerTagColors);
    const blob = new Blob([output], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sourceName = fileName.textContent || `diagram${currentFileExtension}`;
    a.download = sourceName.replace(/\.[^.]+$/i, '') + `-edited${currentFileExtension}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    showError('Failed to save VSDX: ' + e.message);
  }
});
removeNonSelectedButton.addEventListener('click', async () => {
  if (!currentPackageEditable || !currentFileBuffer) {
    showError('Remove non-selected is only available for editable Visio XML packages');
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
  if (!currentPackageEditable || !currentFileBuffer) {
    showError('Remove non-visible is only available for editable Visio XML packages');
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
layerMatrixPage?.addEventListener('change', () => {
  layerMatrixPageFilter = layerMatrixPage.value;
  buildLayerMatrix();
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

// Export SVG — with the source document embedded as base64 metadata so the
// exported SVG can be re-opened (or converted back to .vsdx) losslessly.
document.getElementById('btn-export').addEventListener('click', async () => {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  const serializer = new XMLSerializer();
  // The pen's live overlay (anchors, handles, rubber band) lives inside the
  // rendered SVG; it is scaffolding, not part of the drawing.
  const exported = svg.cloneNode(true);
  exported.querySelector('#pen-preview')?.remove();
  exported.querySelector('#shape-highlight')?.remove();
  let svgStr = serializer.serializeToString(exported);
  try {
    if (currentFileBuffer) {
      // Embed what "Save VSDX" would produce, so layer edits and named views
      // round-trip too.
      const source = currentPackageEditable
        ? await saveVsdxLayerPermissions(currentFileBuffer, currentPages, viewTemplates, layerTagColors)
        : currentFileBuffer;
      svgStr = embedVsdxInSvg(svgStr, source, fileName.textContent || 'diagram.vsdx');
    }
  } catch (e) {
    console.error('Failed to embed VSDX metadata in SVG, exporting plain SVG:', e);
  }
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (fileName.textContent || 'diagram').replace(/\.[^.]+$/i, '') + '.svg';
  a.click();
  URL.revokeObjectURL(url);
});

// Auto-load from URL query params — used by the `git difftool` integration
// (scripts/git-difftool-serve.mjs) to open two revisions in the visual diff:
//   ?diff=1&base=<url>&head=<url>&baseName=<label>&headName=<label>
// A single ?file=<url> just loads that file into the viewer.
async function initFromQuery() {
  const params = new URLSearchParams(location.search);
  try {
    if (params.get('base') && params.get('head')) {
      const [baseBuffer, headBuffer] = await Promise.all([
        fetch(params.get('base')).then(r => r.arrayBuffer()),
        fetch(params.get('head')).then(r => r.arrayBuffer()),
      ]);
      await openDiffView({
        baseBuffer,
        headBuffer,
        baseName: params.get('baseName') || 'base',
        headName: params.get('headName') || 'head',
        mount: document.body,
      });
    } else if (params.get('file')) {
      const url = params.get('file');
      const buffer = await fetch(url).then(r => r.arrayBuffer());
      const name = params.get('fileName') || url.split('/').pop() || 'file.vsdx';
      await loadFile(new File([buffer], name));
    }
  } catch (err) {
    console.error(err);
    showError('Failed to auto-load from URL: ' + err.message);
  }
}
initFromQuery();
