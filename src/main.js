import { parseVsdx, saveVsdxLayerPermissions, saveVsdxWithoutHiddenLayers, saveVsdxWithoutNonSelectedLayers, saveVsdxWithoutNonVisibleData, getVsdxShapeXmlSnippet, replaceVsdxShapeXmlSnippet, addVsdxShapeToPage, groupVsdxShapes, ungroupVsdxShapes, reorderVsdxShapes, deleteVsdxShapes, transformVsdxShapes, shapeCellNumber, normalizeLayerTags, normalizeTagColor, sanitizeLayerTreeSettings, DEFAULT_LAYER_DELIMITER } from './vsdx-parser.js';
import { embedVsdxInSvg, extractVsdxFromSvg } from './svg-vsdx-embed.js';
import { parseVsd } from './vsd-parser.js';
import { renderPage, redrawShape, pageCoordinateWidth, attachVisioMetadata } from './svg-renderer.js';
import { buildPenShapeXml, penPathToSvgD } from './pen-geometry.js';
import {
  shapesAtPoint, shapesOnLayer, shapesOnLayers, searchShapes,
  collectShapeBoxes, topmostFirst, dedupeById
} from './shape-picker.js';
import {
  planGroupShapes, planUngroupShape, isGroupShape, inheritsFromMaster,
  planMoveShapes, planRotateShapes, planResizeShape, buildShapeIndex
} from './shape-arrange.js';
import { openDiffView } from './diff-view.js';
import { splitLayerPath, buildLayerTree, layersUnder, flattenLayerTree, groupKeys } from './layer-tree.js';
import { EXPORT_SIZE_MODES, computeExportSize, describeExportSize, applyExportSize, svgViewBoxSize, defaultSizeMode, PDF_MAX_PX } from './export-scale.js';
import { PINNED_LIBS, loadPdfLibraries, svgToPdfBlob } from './pdf-export.js';
import { groupSvgShapesByLayer } from './svg-layers.js';
import { readSvgEdits, applySvgEdits, summarizeSvgEdits } from './svg-import.js';

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
const layersManage = document.getElementById('layers-manage');
const layersAdd = document.getElementById('layers-add');
const layerTreeEnable = document.getElementById('layer-tree-enable');
const layerTreeDelimiterInput = document.getElementById('layer-tree-delimiter');
const layerTreeToggleAll = document.getElementById('layer-tree-toggle-all');
const layerContextMenu = document.getElementById('layer-context-menu');
const layerContextTitle = document.getElementById('layer-context-title');
const layersResizer = document.getElementById('layers-resizer');
const layersHResizer = document.getElementById('layers-hresizer');
const layersFilterPane = layersSidebar?.querySelector('.layers-filter') || null;
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
const shapeContextRename = document.getElementById('shape-context-rename');
const shapeArrangeSection = document.getElementById('shape-arrange-section');
const shapeArrangeHint = document.getElementById('shape-arrange-hint');
const shapeArrangeGroup = document.getElementById('shape-arrange-group');
const shapeArrangeUngroup = document.getElementById('shape-arrange-ungroup');
const shapeArrangeFront = document.getElementById('shape-arrange-front');
const shapeArrangeBack = document.getElementById('shape-arrange-back');
const shapeArrangeDelete = document.getElementById('shape-arrange-delete');
const shapeContextEditXml = document.getElementById('shape-context-edit-xml');
const shapeContextNewLayer = document.getElementById('shape-context-new-layer');
const shapeXmlModal = document.getElementById('shape-xml-modal');
const shapeXmlClose = document.getElementById('shape-xml-close');
const shapeXmlCancel = document.getElementById('shape-xml-cancel');
const shapeXmlSave = document.getElementById('shape-xml-save');
const shapeXmlTextarea = document.getElementById('shape-xml-textarea');
const exportModal = document.getElementById('export-modal');
const exportClose = document.getElementById('export-close');
const exportCancel = document.getElementById('export-cancel');
const exportRun = document.getElementById('export-run');
const exportFormat = document.getElementById('export-format');
const exportSize = document.getElementById('export-size');
const exportCustomRow = document.getElementById('export-custom-row');
const exportCustomPx = document.getElementById('export-custom-px');
const exportSummary = document.getElementById('export-summary');
const exportEmbed = document.getElementById('export-embed');
const exportEmbedRow = document.getElementById('export-embed-row');
const exportPdfGate = document.getElementById('export-pdf-gate');
const exportPdfLibs = document.getElementById('export-pdf-libs');
const exportPdfConsent = document.getElementById('export-pdf-consent');
const exportStatus = document.getElementById('export-status');
const penButton = document.getElementById('btn-pen');
const selectButton = document.getElementById('btn-select');
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
const shapeSearchInput = document.getElementById('shape-search');
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
//
// True size is the default: it is what the drawing says, and what Visio, an
// export and a print all show. Floors are a reading aid for a drawing that has
// been shrunk to fit a window, and one applied without being asked for makes a
// 1:100 plan's hairlines look heavier than they are.
let strokeMode = 'true';
let renderedZoom = 1;
// How much of `zoom` is baked into the SVG's own layout size rather than into
// the container's transform. See commitLayoutZoom.
let layoutZoom = 1;
let layoutZoomTimer = null;
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
// The whole selection, primary included. `selectedShapeId` stays the one the
// Shape Tree and the layer menu speak for — the last one picked.
let selectedShapeIds = new Set();
let editingShapeId = null;
let editingShapeXmlId = null;
const hiddenShapeIdsByPage = new Map();
const collapsedShapeIdsByPage = new Map();
// Which Shape Tree row the keyboard is standing on. Not the selection: see
// handleShapeTreeKeydown.
let shapeTreeCursorId = null;
// Pen tool. penNodes are in page units (inches, Y up from the page bottom) -
// the space the parser and pen-geometry both speak, so nothing is converted
// twice. penDrag tracks the handle being pulled out of the node just placed.
let penActive = false;
let penNodes = [];
let penDrag = null;
let penCursor = null;
let penCommitting = false;
// Which layer's object list is open in the sidebar, and the shapes offered by
// the last right-click, topmost first. A group row lists the shapes of every
// layer under it, so the open list is a set of indexes and a title rather than
// one index.
let layerObjectsIndex = null;
let layerObjectsGroup = null;
let shapeSearchQuery = '';
let contextPickEntries = [];
// How close (in device pixels) a click has to land to the first anchor to be
// read as "close the path" rather than "place another point".
const PEN_CLOSE_PX = 8;
// A drawing is not necessarily a sheet of paper. Visio measures a site plan or
// a floor layout at full size — a real one in this repo's fixtures is 3962 by
// 2618 inches, which is 380,372 renderer pixels across — and seeing all of that
// at once in a 1200px window is 0.32%. A floor of 10% put the whole drawing
// permanently out of reach, so the floor is set by what the biggest drawings
// actually need rather than by what a page-sized one does.
const MIN_ZOOM = 0.0002;
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
// Placements made on the drawing that the package bytes have not been told
// about yet — see commitPlacementLocally. Rewriting a 20 MB .vsdx to nudge one
// shape is work nobody asked for at the moment they let go of the mouse, so it
// waits until something actually wants the bytes.
//
// Every read of currentFileBuffer therefore goes through here first.
let pendingShapeEdits = [];

async function packageBuffer() {
  if (!currentFileBuffer || !pendingShapeEdits.length) return currentFileBuffer;
  // Taken off the queue before the first await: a second caller arriving while
  // the zip is being rebuilt must not write the same edits in twice.
  const edits = pendingShapeEdits;
  pendingShapeEdits = [];
  let buffer = currentFileBuffer;
  for (const edit of edits) {
    ({ buffer } = await transformVsdxShapes(buffer, edit.pageId, edit.updates));
  }
  currentFileBuffer = buffer;
  return buffer;
}

async function getPackageBufferWithPendingEdits() {
  const buffer = await packageBuffer();
  if (!buffer) return null;
  if (!currentPackageEditable) return buffer;
  commitCurrentPageVisibility();
  return saveVsdxLayerPermissions(buffer, currentPages, viewTemplates, layerTagColors, currentLayerTreeSettings());
}

async function applyUpdatedVsdxBuffer(buffer, pageId = null) {
  // The "Unlayered" row is an editor-only construct with nowhere to live in the
  // file, so it cannot survive the round-trip above; carry it across by hand.
  const unlayeredHidden = hiddenLayers.has(UNLAYERED_LAYER_INDEX);
  const result = await parseVsdx(buffer);
  currentFileBuffer = buffer;
  // Whatever the model was carrying, this is the model now. A queued placement
  // that did not make it into these bytes describes a page that no longer
  // exists in memory, so it is dropped rather than replayed onto a stranger.
  pendingShapeEdits = [];
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
  clearShapeSelection();
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

// Zoom used to be a plain `scale()` on the container, and scaling a composited
// layer does not redraw it — the compositor stretches the pixels it already has,
// which is why the drawing went soft the instant you touched the wheel and
// sharpened again the moment you panned (a pan is what finally invalidated the
// layer). Vectors have no business being blurry at any zoom.
//
// So the scale is *moved into the SVG's own size* as soon as the gesture
// settles: laying the SVG out bigger makes the browser draw the vectors bigger,
// which is sharp by construction. The transform keeps whatever part of the zoom
// has not been committed yet, so the wheel still feels instant — a wheel gesture
// is a stream of ticks and relaying out a large drawing on every one of them
// would stutter — and the picture resolves a frame or two after you stop.
//
// Pan stays a transform: a translate never resamples anything.
// Rounding to whole percent is fine at reading zooms and useless below them:
// the zoom that fits a site plan on screen is a third of one percent, and
// "0%" tells nobody anything, least of all whether the − button did anything.
function formatZoom(value) {
  const percent = value * 100;
  if (percent >= 10) return `${Math.round(percent)}%`;
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  return `${percent.toPrecision(2)}%`;
}

// The size of the drawing on screen right now, in screen pixels, and how far it
// may be pushed around inside the window. A drawing bigger than the window may
// be pulled until either edge meets the window's; one smaller than the window
// stays wholly inside it. Both come out of the same two numbers, which is why
// the range is written as a min and a max of the same expression rather than as
// two cases.
function contentScreenSize() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return null;
  const { width, height } = svgViewBoxSize(svg);
  if (!(width > 0 && height > 0)) return null;
  return { width: width * zoom, height: height * zoom };
}

function panRange() {
  const content = contentScreenSize();
  const view = viewportEl?.getBoundingClientRect?.();
  if (!content || !view || !(view.width > 0 && view.height > 0)) return null;
  const slackX = view.width - content.width;
  const slackY = view.height - content.height;
  return {
    minX: Math.min(0, slackX), maxX: Math.max(0, slackX),
    minY: Math.min(0, slackY), maxY: Math.max(0, slackY),
    // What the scrollbars need: how much of the drawing is off screen, and
    // where in that travel we currently are.
    travelX: Math.abs(slackX), travelY: Math.abs(slackY),
    view, content
  };
}

// Losing the drawing off the side of the window was always possible and never
// wanted, and it is the scrollbars that make it visible: a thumb has to sit
// somewhere on its track.
function clampPan() {
  const range = panRange();
  if (!range) return;
  panX = Math.min(range.maxX, Math.max(range.minX, panX));
  panY = Math.min(range.maxY, Math.max(range.minY, panY));
}

// The transform and nothing else. Dragging writes this every frame, so anything
// that reads layout, writes text or touches a timer stays out of it.
function applyPanTransform() {
  const residual = zoom / (layoutZoom || 1);
  svgContainer.style.transform = residual === 1
    ? `translate(${panX}px, ${panY}px)`
    : `translate(${panX}px, ${panY}px) scale(${residual})`;
}

function updateTransform() {
  clampPan();
  applyPanTransform();
  zoomInfo.textContent = formatZoom(zoom);
  updateRerenderState();
  updateScrollbars();
  scheduleLayoutZoom();
}

// translate() is applied in the parent's coordinates, before the scale, so the
// pan is in screen pixels either way and moving the scale between the two
// leaves the drawing exactly where it was on screen.
function commitLayoutZoom() {
  layoutZoomTimer = null;
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  const { width, height } = svgViewBoxSize(svg);
  if (!(width > 0 && height > 0)) return;
  layoutZoom = zoom;
  svg.style.width = `${width * layoutZoom}px`;
  svg.style.height = `${height * layoutZoom}px`;
  // The renderer pins max-width to the drawing's natural width to keep it from
  // stretching; past 100% that is exactly what we are asking for.
  svg.style.maxWidth = 'none';
  applyPanTransform();
  updateScrollbars();
}

function scheduleLayoutZoom() {
  if (layoutZoom === zoom) return;
  if (layoutZoomTimer !== null) clearTimeout(layoutZoomTimer);
  layoutZoomTimer = setTimeout(commitLayoutZoom, 80);
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

// A page that names a background page is *drawn* as that page's shapes with its
// own on top. Everything that answers "what is under the cursor" has to ask the
// same drawing the renderer built, or the shapes behind are ones you can see and
// cannot pick — which is the whole point of a backdrop.
function backgroundPageFor(page) {
  if (!page?.backPage) return null;
  return currentPages.find(p => String(p.id) === String(page.backPage)) || null;
}

// Flattening a page into shape boxes walks every shape in it, matrices and all,
// which is 20 ms on a drawing of a few thousand shapes. Clicking one asked for
// that twice — once to see what was under the pointer, once to draw the
// selection — so a click cost more than a frame before anything appeared.
//
// Nothing about a page's geometry changes without the drawing being rendered
// again: every edit goes through the package and comes back as a fresh model.
// So both the composition and the boxes are remembered until the next render,
// which throws the lot away.
let composedPages = new WeakMap();
let shapeBoxesByPage = new WeakMap();

function invalidatePageGeometryCaches() {
  composedPages = new WeakMap();
  shapeBoxesByPage = new WeakMap();
}

function composedPage(page) {
  if (!page) return page;
  const cached = composedPages.get(page);
  if (cached) return cached;
  const bgPage = backgroundPageFor(page);
  const composed = bgPage ? { ...page, shapes: [...bgPage.shapes, ...page.shapes] } : page;
  composedPages.set(page, composed);
  return composed;
}

// The rendered group for a shape id, or null if it is not on the canvas.
function shapeGroupElement(shapeId) {
  const key = window.CSS?.escape ? CSS.escape(String(shapeId)) : String(shapeId);
  return svgContainer.querySelector(`g[data-shape-id="${key}"]`);
}

// collectShapeBoxes, but only once per page per render.
function pageShapeBoxes(page) {
  if (!page) return [];
  let entries = shapeBoxesByPage.get(page);
  if (!entries) {
    entries = collectShapeBoxes(page);
    shapeBoxesByPage.set(page, entries);
  }
  return entries;
}

function renderCurrentPage() {
  if (!currentPages.length) return;
  invalidatePageGeometryCaches();
  const page = currentPages[currentPageIndex];
  const renderedPage = composedPage(page);

  // Without the Shape Data blocks: they are three quarters of the elements on a
  // real drawing and not one of them is ever painted or read back off the
  // canvas. buildExportSvg puts them back into the file that leaves the app.
  renderPage(renderedPage, svgContainer, {
    minStrokeWidth: currentMinStrokeWidth(renderedPage),
    metadata: false
  });
  // A brand new SVG is at its natural size whatever the old one had been sized
  // to, so the zoom baked into layout is back to none until it is put there
  // again — which is done now rather than on a timer, since there is no gesture
  // in progress to keep smooth.
  layoutZoom = 1;
  commitLayoutZoom();
  // A page opens showing all of itself. This is here rather than in resetView
  // because there is nothing to measure until the SVG is in the document.
  if (pendingFit && fitToWindow()) pendingFit = false;
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
  clearShapeSelection();
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
  clearShapeSelection();
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

// ── The sidebar's own furniture ───────────────────────────────────────────
// Filtering layers, searching shapes, picking a delimiter and saving a view are
// each occasional; the list of layers is what the pane is for. So every tool
// folds away, closed until asked for, and the list keeps the room. The state is
// the `hidden` attribute on the body — nothing else tracks it.

function sectionToggle(name) {
  return layersSidebar?.querySelector(`[data-section-toggle="${name}"]`) || null;
}

function sectionBody(name) {
  return layersSidebar?.querySelector(`[data-section-body="${name}"]`) || null;
}

function isSectionOpen(name) {
  const body = sectionBody(name);
  return Boolean(body && !body.hidden);
}

function setSectionOpen(name, open) {
  const body = sectionBody(name);
  const toggle = sectionToggle(name);
  if (!body || !toggle) return;
  body.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  const twisty = toggle.querySelector('.sidebar-section-twisty');
  if (twisty) twisty.textContent = open ? '▾' : '▸';
}

function toggleSection(name) {
  setSectionOpen(name, !isSectionOpen(name));
  if (isSectionOpen(name)) {
    const body = sectionBody(name);
    body?.querySelector('input, select, button')?.focus?.();
  }
}

// A folded section still has to say what it is doing, or a filter left on looks
// like a drawing that lost its layers.
function updateSectionBadges() {
  const badge = (name, text) => {
    const el = layersSidebar?.querySelector(`[data-section-badge="${name}"]`);
    if (el) el.textContent = text || '';
  };
  const filter = String(layerFilterText?.value || '').trim();
  badge('filter', filter ? `“${filter}”` : '');
  const search = String(shapeSearchInput?.value || '').trim();
  badge('find', search ? `“${search}”` : '');
  badge('grouping', layerTreeActive() ? `on · ${layerTreeDelimiter}` : '');
  const view = selectedViewIndex !== null ? viewTemplates[selectedViewIndex] : null;
  badge('views', view ? view.name : '');
  badge('tags', getPageTagUsage().length ? String(getPageTagUsage().length) : '');
}

layersSidebar?.addEventListener('click', (event) => {
  const toggle = event.target.closest?.('[data-section-toggle]');
  if (!toggle) return;
  toggleSection(toggle.dataset.sectionToggle);
});

// ── Resizing the pane ─────────────────────────────────────────────────────
// Layer names are as long as their author made them, and a fixed 240px pane
// truncates half of a "Electrical/HV/Feeders" tree. The width is the user's,
// and it outlives page switches because it is a property of the pane, not of
// what is in it.
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 720;
let sidebarWidth = 240;

function setSidebarWidth(width) {
  sidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));
  layersSidebar.style.width = `${sidebarWidth}px`;
  layersSidebar.style.minWidth = `${sidebarWidth}px`;
}

if (layersResizer) {
  let dragging = false;
  const onMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    setSidebarWidth(event.clientX - layersSidebar.getBoundingClientRect().left);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    layersResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  layersResizer.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    layersResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  // Double-clicking the handle is the usual "give it what it needs": widen to
  // the longest row rather than making the user aim for it.
  layersResizer.addEventListener('dblclick', () => {
    const rows = [...layersList.querySelectorAll('.layer-item, .layer-group-item')];
    const widest = rows.reduce((max, row) => Math.max(max, row.scrollWidth || 0), 0);
    setSidebarWidth(widest ? widest + 48 : 240);
  });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// The same argument one axis over. How the pane's height divides between the
// tools and the list depends on which of the two you are working in: opening
// three sections to build a filter leaves the list a sliver, and someone
// scrolling two hundred layers wants the tools out of the way. Neither split is
// right for everyone, so it is a handle rather than a rule. Automatic until
// dragged, and a double-click puts it back.
const MIN_TOOLS_HEIGHT = 26;       // one folded section header stays reachable
const MIN_LAYER_LIST_HEIGHT = 80;  // matches #layers-list's own min-height
let toolsHeight = null;            // null = size to content, as the CSS does

function toolsHeightBounds() {
  // A pane that is hidden, or not laid out at all, measures zero — clamping to
  // that would collapse the tools to nothing the moment it became visible. So
  // bounds only apply where there is a measurement to apply them to.
  const room = layersSidebar.getBoundingClientRect().bottom
    - layersFilterPane.getBoundingClientRect().top
    - layersHResizer.offsetHeight;
  const max = [];
  if (room > 0) max.push(room - MIN_LAYER_LIST_HEIGHT);
  // Handing the tools more room than their content fills buys blank space and
  // takes it off the list, so the natural height is the far end of the drag.
  if (layersFilterPane.scrollHeight > 0) max.push(layersFilterPane.scrollHeight);
  return { min: MIN_TOOLS_HEIGHT, max: max.length ? Math.max(MIN_TOOLS_HEIGHT, Math.min(...max)) : Infinity };
}

function setToolsHeight(height) {
  if (!layersFilterPane) return;
  if (height === null) {
    toolsHeight = null;
    layersFilterPane.classList.remove('manual-height');
    layersFilterPane.style.removeProperty('height');
    return;
  }
  const { min, max } = toolsHeightBounds();
  toolsHeight = Math.max(min, Math.min(max, Math.round(height)));
  layersFilterPane.classList.add('manual-height');
  layersFilterPane.style.height = `${toolsHeight}px`;
}

if (layersHResizer && layersFilterPane) {
  let dragging = false;
  const onMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    setToolsHeight(event.clientY - layersFilterPane.getBoundingClientRect().top);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    layersHResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  layersHResizer.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    layersHResizer.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });
  layersHResizer.addEventListener('dblclick', () => setToolsHeight(null));
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // A split that was legal in a tall window can leave no list at all in a short
  // one, so a pinned height is re-clamped whenever the room changes.
  window.addEventListener('resize', () => {
    if (toolsHeight !== null) setToolsHeight(toolsHeight);
  });
}

function updateSidebarChrome() {
  const visible = layersSidebar.classList.contains('visible');
  layersResizer?.classList.toggle('visible', visible);
}

function buildLayersSidebar() {
  layersList.innerHTML = '';
  if (!currentPages.length) {
    updateSidebarChrome();
    return;
  }
  const layers = getCurrentLayers();
  refreshTagUI();

  if (layers.length === 0) {
    layersSidebar.classList.remove('visible');
    document.getElementById('btn-layers').classList.remove('active');
    updateSidebarChrome();
    return;
  }

  const visibleLayers = getFilteredLayers();
  if (!visibleLayers.some(layer => layer.index === focusedLayerIndex)) {
    focusedLayerIndex = visibleLayers[0]?.index ?? null;
  }

  updateLayerTreeControls();
  if (layerTreeActive()) renderLayerTreeRows(visibleLayers);
  else for (const layer of visibleLayers) layersList.appendChild(createLayerRow(layer));

  updateLayersCount(layers.length, visibleLayers.length);
  updateLayerBulkButtons(visibleLayers.length);
  updateSectionBadges();
  updateSidebarChrome();
}

// `label` overrides the visible text without touching the titles or aria
// labels: in tree mode a row sits under its parents already, so repeating the
// whole "Electrical/HV" on it would be noise.
// `node` is the row's place in the delimiter tree, or null with grouping off;
// it decides how much of the name the row's rename button rewrites.
function createLayerRow(layer, depth = 0, label = null, node = null) {
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
  name.textContent = label ?? displayName;
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

  item.appendChild(checkbox);
  item.appendChild(name);

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

  // Everything a row can do other than show and hide is on its menu, which is
  // also what a right-click opens — the button is there because a right-click
  // is not a thing anyone tries on a list they have not been told about.
  item.appendChild(createLayerMenuButton({ layer, node }, displayName));
  attachLayerContextMenu(item, layer, node);

  // Nesting is drawn with padding rather than nested elements, so a row is
  // the same row whether or not the tree view is on.
  if (depth > 0) item.style.paddingLeft = `${8 + depth * 14}px`;
  return item;
}

// ── Grouping flat layer names into a tree ─────────────────────────────────
// Visio has no layer hierarchy, but drawings fake one in the name
// ("Electrical/HV"). Splitting on a delimiter the user picks turns that
// convention into a tree. It is purely a view: no group is ever written to the
// document, and every real layer keeps its own row.

let layerTreeEnabled = false;
let layerTreeDelimiter = DEFAULT_LAYER_DELIMITER;
const collapsedLayerGroups = new Set();
const layerGroupNodes = new Map();

function layerTreeActive() {
  return layerTreeEnabled && layerTreeDelimiter.length > 0;
}

// The grouping settings are saved into the drawing (see the layer-tree
// Solution XML part), because which delimiter a drawing's layer names use is a
// fact about the drawing, not a preference of whoever opened it.
function currentLayerTreeSettings() {
  return sanitizeLayerTreeSettings({
    enabled: layerTreeEnabled,
    delimiter: layerTreeDelimiter,
    collapsed: [...collapsedLayerGroups],
  });
}

// Opening a file adopts its settings, and a file that carries none resets them:
// otherwise the delimiter of the drawing before it would silently apply to a
// drawing that never asked for one.
function applyLayerTreeSettings(settings) {
  const clean = sanitizeLayerTreeSettings(settings || {});
  layerTreeEnabled = clean.enabled;
  layerTreeDelimiter = clean.delimiter;
  collapsedLayerGroups.clear();
  for (const key of clean.collapsed) collapsedLayerGroups.add(key);
}

function currentLayerTree(layers) {
  return buildLayerTree(
    layers.map(layer => ({ layer, name: getLayerDisplayName(layer) })),
    layerTreeDelimiter
  );
}

function updateLayerTreeControls() {
  if (layerTreeEnable) layerTreeEnable.checked = layerTreeEnabled;
  if (layerTreeDelimiterInput && layerTreeDelimiterInput.value !== layerTreeDelimiter) {
    layerTreeDelimiterInput.value = layerTreeDelimiter;
  }
  if (layerTreeToggleAll) {
    layerTreeToggleAll.disabled = !layerTreeActive();
    layerTreeToggleAll.textContent = collapsedLayerGroups.size ? 'Expand all' : 'Collapse all';
  }
}

function setLayerTreeEnabled(enabled) {
  layerTreeEnabled = Boolean(enabled);
  buildLayersSidebar();
}

function setLayerTreeDelimiter(delimiter) {
  // Collapse state is keyed by path, and a different delimiter means different
  // paths, so nothing carries over.
  if (delimiter === layerTreeDelimiter) return;
  layerTreeDelimiter = String(delimiter ?? '');
  collapsedLayerGroups.clear();
  buildLayersSidebar();
}

function toggleAllLayerGroups() {
  if (!layerTreeActive()) return;
  const keys = groupKeys(currentLayerTree(getFilteredLayers()));
  if (collapsedLayerGroups.size) collapsedLayerGroups.clear();
  else for (const key of keys) collapsedLayerGroups.add(key);
  buildLayersSidebar();
}

// Fold every group except the ones the layer in focus lives under. On a drawing
// with a hundred layers in a dozen folders that is the difference between
// finding your way back to what you were doing and scrolling for it.
function collapseUnfocusedLayerGroups() {
  if (!layerTreeActive()) return;
  const keys = groupKeys(currentLayerTree(getFilteredLayers()));
  collapsedLayerGroups.clear();
  for (const key of keys) collapsedLayerGroups.add(key);

  // Open the way back down to the layer in focus, by the tree's own keys rather
  // than by rebuilding its paths — two layers can share a name, and the second
  // one's node is deliberately keyed differently.
  const openTo = (nodes, trail = []) => {
    for (const node of nodes || []) {
      const here = [...trail, node.key];
      if (node.layer && String(node.layer.index) === String(focusedLayerIndex)) {
        for (const key of here) collapsedLayerGroups.delete(key);
        return true;
      }
      if (openTo(node.children, here)) return true;
    }
    return false;
  };
  if (focusedLayerIndex !== null) openTo(currentLayerTree(getFilteredLayers()));
  buildLayersSidebar();
}

function toggleLayerGroup(node) {
  if (collapsedLayerGroups.has(node.key)) collapsedLayerGroups.delete(node.key);
  else collapsedLayerGroups.add(node.key);
  buildLayersSidebar();
}

function createLayerTwisty(node) {
  const twisty = document.createElement('button');
  twisty.type = 'button';
  twisty.className = 'layer-twisty';
  twisty.tabIndex = -1;
  const collapsed = collapsedLayerGroups.has(node.key);
  twisty.textContent = collapsed ? '▸' : '▾';
  twisty.title = `${collapsed ? 'Expand' : 'Collapse'} ${node.path}`;
  twisty.setAttribute('aria-label', twisty.title);
  twisty.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  twisty.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLayerGroup(node);
  });
  return twisty;
}

function spacer() {
  const gap = document.createElement('span');
  gap.className = 'layer-twisty-spacer';
  return gap;
}

// Moving a layer is renaming it. Visio stores no hierarchy, so a row's place
// in the tree is nothing but its name — retype the prefix and it lands
// somewhere else. The same edit therefore covers a rename in place, a move into
// another group, and (on a group row) doing that to every layer underneath at
// once, which is why one function handles all three.
//
// What is edited is always the row's full path, and only the part of each
// layer's name that the row accounts for is replaced: renaming the "HV" row
// under "Electrical" to "Plumbing/HV" moves that one layer and leaves anything
// nested below it hanging off its new home.
function renameLayerPath(node) {
  if (!layerTreeActive()) return false;

  const under = layersUnder(node).filter(layer => !isVirtualLayer(layer)).length - (node.layer ? 1 : 0);
  const answer = window.prompt(
    under
      ? `Rename or move "${node.path}" — the ${under} layer${under === 1 ? '' : 's'} under it come along:`
      : `Rename or move "${node.path}" — put it in another group by giving it that prefix:`,
    node.path
  );
  if (answer === null) return false;

  // A name containing the delimiter is the whole point rather than an error:
  // it is how the row is moved.
  const nextSegments = parseLayerPathSegments(answer);
  if (!nextSegments.length) {
    window.alert('A layer needs a name.');
    return false;
  }
  return applyLayerPathChange(node, nextSegments);
}

// The same edit as above with the leaf held fixed: the row keeps its own name
// and only its parent changes, which is what "move" means when the answer to
// "where is this layer?" is nothing but its name.
function moveLayerPath(node) {
  if (!layerTreeActive()) return false;

  const segments = parseLayerPathSegments(node.path);
  const leaf = segments.pop() ?? node.segment;
  const answer = window.prompt(
    `Move "${node.path}" into which group? Leave blank to put it at the top level:`,
    segments.join(layerTreeDelimiter)
  );
  if (answer === null) return false;

  return applyLayerPathChange(node, [...parseLayerPathSegments(answer), leaf]);
}

// Split by hand rather than with splitLayerPath, whose fallback would take a
// name of nothing but blanks and delimiters literally — reasonable for a layer
// that already exists, but here it is just an empty answer.
function parseLayerPathSegments(text) {
  if (!layerTreeDelimiter) return String(text ?? '').trim() ? [String(text).trim()] : [];
  return String(text ?? '').split(layerTreeDelimiter).map(part => part.trim()).filter(Boolean);
}

// Rewrites every layer under `node` so the part of its name that the row stands
// for reads `nextSegments` instead. One layer or a whole subtree goes through
// here, which is what keeps a rename, a move, and a move-with-children the same
// operation.
function applyLayerPathChange(node, nextSegments) {
  const page = currentPages[currentPageIndex];
  if (!page || !currentPackageEditable || !layerTreeActive()) return false;

  const members = layersUnder(node).filter(layer => !isVirtualLayer(layer));
  if (!members.length) return false;

  const nextPath = nextSegments.join(layerTreeDelimiter);
  if (nextPath === node.path) return false;

  // Rebuilt from segments rather than by slicing the old prefix off the name,
  // so a layer written "Electrical / HV" moves as cleanly as "Electrical/HV".
  const renames = members.map(layer => {
    const segments = splitLayerPath(getLayerDisplayName(layer), layerTreeDelimiter);
    segments.splice(0, node.depth + 1, ...nextSegments);
    return { layer, name: segments.join(layerTreeDelimiter) };
  });

  if (!applyLayerRenames(page, renames)) return false;

  // Collapse state is keyed by path, so the subtree would spring open at its
  // destination unless the keys travel with it.
  for (const key of [...collapsedLayerGroups]) {
    if (key !== node.path && !key.startsWith(`${node.path}${layerTreeDelimiter}`)) continue;
    collapsedLayerGroups.delete(key);
    collapsedLayerGroups.add(`${nextPath}${key.slice(node.path.length)}`);
  }

  afterLayerRename();
  return true;
}

// With grouping off there is no tree to move within, but the delimiter is still
// what a group *would* be, so prefixing the whole name puts the layer in one —
// it simply will not be drawn as a group until grouping is switched on.
function promptMoveLayer(layer) {
  const page = currentPages[currentPageIndex];
  if (!page || !currentPackageEditable || isVirtualLayer(layer) || !layerTreeDelimiter) return false;

  const current = getLayerDisplayName(layer);
  const answer = window.prompt(
    `Move "${current}" into which group? Leave blank to put it at the top level:`,
    parseLayerPathSegments(current).slice(0, -1).join(layerTreeDelimiter)
  );
  if (answer === null) return false;

  const leaf = parseLayerPathSegments(current).pop() ?? current;
  const name = [...parseLayerPathSegments(answer), leaf].join(layerTreeDelimiter);
  if (name === current) return false;

  if (!applyLayerRenames(page, [{ layer, name }])) return false;
  afterLayerRename();
  return true;
}

// With grouping off there is no path to edit, so renaming is just renaming —
// though typing a delimiter into the name still puts the layer in a group, it
// simply will not be visible as one until grouping is switched on.
function promptRenameLayer(layer) {
  const page = currentPages[currentPageIndex];
  if (!page || !currentPackageEditable || isVirtualLayer(layer)) return false;

  const current = getLayerDisplayName(layer);
  const answer = window.prompt(`Rename "${current}":`, current);
  if (answer === null) return false;

  const name = String(answer).trim();
  if (!name) {
    window.alert('A layer needs a name.');
    return false;
  }
  if (name === current) return false;

  if (!applyLayerRenames(page, [{ layer, name }])) return false;
  afterLayerRename();
  return true;
}

// Tags and named views identify layers by name, so two layers on a page sharing
// one would be indistinguishable to both — the same rule that governs creating
// a layer, applied to a whole batch at once so a half-applied move is not
// possible.
function applyLayerRenames(page, renames) {
  const moving = new Set(renames.map(entry => entry.layer));
  const taken = new Set((page.layers || [])
    .filter(layer => !moving.has(layer))
    .map(layer => normalizeLayerText(getLayerDisplayName(layer))));

  for (const { name } of renames) {
    const key = normalizeLayerText(name);
    if (taken.has(key)) {
      window.alert(`Renaming would give this page two layers called "${name}".`);
      return false;
    }
    taken.add(key);
  }

  for (const { layer, name } of renames) setLayerName(layer, name);
  return true;
}

function afterLayerRename() {
  buildLayersSidebar();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
}

// One button per row, whatever the row is: it opens the row's menu, which is
// the same menu a right-click opens and speaks for the same thing — the layer,
// or everything under a group.
function createLayerMenuButton(target, displayName) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-menu-btn';
  button.textContent = '⋯';
  button.tabIndex = -1;
  const label = `Actions for ${displayName}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-haspopup', 'menu');
  if (layerObjectsMatchesTarget(target)) button.classList.add('active');
  // The row click toggles visibility; opening the menu must not also flip it.
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = button.getBoundingClientRect();
    showLayerContextMenu(target, rect.left, rect.bottom + 2);
  });
  return button;
}

// A group has no layer of its own to tag, so tagging one means tagging what is
// under it. Only adding, never replacing: the layers in a group each carry
// their own tags, and a bulk edit that overwrote them would be a bulk delete
// wearing a friendly label.
function promptGroupTags(node) {
  const members = layersUnder(node).filter(layer => !isVirtualLayer(layer));
  if (!members.length) return false;

  const answer = window.prompt(
    `Tags to add to the ${members.length} layer${members.length === 1 ? '' : 's'} under "${node.path}" (comma-separated):`,
    ''
  );
  if (answer === null) return false;

  const added = normalizeLayerTags(answer);
  if (!added.length) return false;

  let changed = false;
  for (const layer of members) {
    if (setLayerTags(layer, [...getLayerTags(layer), ...added])) changed = true;
  }
  if (!changed) return false;

  buildLayersSidebar();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
  return true;
}

// ── Layer row context menu ────────────────────────────────────────────────
// The row buttons are deliberately faint until hovered, which is fine for the
// one action a row is mostly used for and poor for the rest; right-clicking a
// row names them instead. It drives the same functions as the buttons, so a
// group row's entries speak for everything underneath it exactly as its ✎ does.
let layerContextTarget = null;

function hideLayerContextMenu() {
  if (!layerContextMenu) return;
  layerContextMenu.style.display = 'none';
  layerContextTarget = null;
}

function showLayerContextMenu(target, x, y) {
  if (!layerContextMenu) return;

  const node = target.node;
  const isGroup = Boolean(node && !node.layer);
  // The virtual "Unlayered" row is an editor fiction with nothing to write to,
  // so it can be listed but not renamed, tagged or deleted. Neither can
  // anything at all in a package that is not editable.
  const virtual = Boolean(target.layer && isVirtualLayer(target.layer));
  const editable = currentPackageEditable && !virtual;
  const label = node ? node.path : getLayerDisplayName(target.layer);
  const under = node ? layersUnder(node).filter(layer => !isVirtualLayer(layer)).length : 1;

  layerContextTarget = target;
  if (layerContextTitle) layerContextTitle.textContent = isGroup ? `${label} (${under} layers)` : label;

  const item = action => layerContextMenu.querySelector(`[data-layer-action="${action}"]`);
  item('objects').textContent = isGroup ? `List shapes under ${node.segment}` : 'List shapes';
  item('rename').textContent = isGroup ? 'Rename group…' : 'Rename…';
  item('rename').disabled = !editable;
  item('move').textContent = isGroup ? 'Move group…' : 'Move to group…';
  // Without a delimiter there is no such thing as a group to move into.
  item('move').disabled = !editable || !layerTreeDelimiter;
  item('tags').textContent = isGroup ? `Add tags to ${under} layers…` : 'Edit tags…';
  item('tags').disabled = !editable;
  item('delete').textContent = isGroup ? `Delete ${under} layer${under === 1 ? '' : 's'}…` : 'Delete…';
  item('delete').disabled = !editable;

  layerContextMenu.style.display = 'block';
  const rect = layerContextMenu.getBoundingClientRect();
  layerContextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  layerContextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
}

// Both row kinds hand the menu the same thing: the layer if there is one, and
// the tree node if the tree is on, so the menu never has to know which row it
// came from.
function attachLayerContextMenu(row, layer, node) {
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showLayerContextMenu({ layer, node }, event.clientX, event.clientY);
  });
}

layerContextMenu?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layer-action]');
  if (!button || button.disabled || !layerContextTarget) return;
  const { layer, node } = layerContextTarget;
  const action = button.dataset.layerAction;
  hideLayerContextMenu();

  if (action === 'objects') {
    if (node && !node.layer) openLayerGroupObjects(node);
    else openLayerObjects(layer ? layer.index : node.layer.index);
  } else if (action === 'rename') {
    if (node) renameLayerPath(node);
    else promptRenameLayer(layer);
  } else if (action === 'move') {
    if (node) moveLayerPath(node);
    else promptMoveLayer(layer);
  } else if (action === 'tags') {
    if (node && !node.layer) promptGroupTags(node);
    else promptLayerTags(layer);
  } else if (action === 'delete') {
    if (node && !node.layer) deleteLayers(layersUnder(node).filter(candidate => !isVirtualLayer(candidate)), node.path);
    else deleteLayers([layer || node.layer]);
  }
});

document.addEventListener('click', (event) => {
  if (!layerContextMenu?.contains(event.target)) hideLayerContextMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideLayerContextMenu();
});

// A group's checkbox and count describe the layers below it, so they are
// derived state: every path that changes a layer's visibility has to put them
// back in step.
function applyLayerGroupState(row, node) {
  const members = layersUnder(node);
  const shown = members.filter(layer => !hiddenLayers.has(layer.index)).length;

  const checkbox = row.querySelector('input[type="checkbox"]');
  if (checkbox) {
    checkbox.checked = shown === members.length && members.length > 0;
    checkbox.indeterminate = shown > 0 && shown < members.length;
  }
  const count = row.querySelector('.layer-group-count');
  if (count) count.textContent = `${shown}/${members.length}`;
}

// Toggling a single layer patches its own row instead of rebuilding the
// sidebar — cheap, and it keeps focus — so the group rows above it would
// otherwise keep showing the count from before the toggle.
function refreshLayerGroupRows() {
  if (!layerTreeActive()) return;
  for (const row of layersList.querySelectorAll('.layer-group-item')) {
    const node = layerGroupNodes.get(row.dataset.layerGroup);
    if (node) applyLayerGroupState(row, node);
  }
}

// A grouping row: no Visio layer of its own, so no index, tags, or delete —
// just a name, a count, and a checkbox that drives everything underneath it.
function createLayerGroupRow(node) {
  const item = document.createElement('div');
  item.className = 'layer-group-item';
  item.dataset.layerGroup = node.key;
  item.style.paddingLeft = `${8 + node.depth * 14}px`;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.tabIndex = -1;
  checkbox.setAttribute('aria-label', `Show every layer under ${node.path}`);
  checkbox.addEventListener('change', () => setLayerSelection(layersUnder(node), checkbox.checked));

  const name = document.createElement('span');
  name.className = 'layer-group-name';
  name.textContent = node.segment;
  name.title = node.path;
  name.addEventListener('click', () => toggleLayerGroup(node));

  const count = document.createElement('span');
  count.className = 'layer-group-count';

  item.append(createLayerTwisty(node), checkbox, name, count);
  item.appendChild(createLayerMenuButton({ layer: null, node }, node.path));
  attachLayerContextMenu(item, null, node);
  applyLayerGroupState(item, node);
  return item;
}

function renderLayerTreeRows(visibleLayers) {
  const tree = currentLayerTree(visibleLayers);
  const rows = flattenLayerTree(tree, node => collapsedLayerGroups.has(node.key));

  // Kept so a row drawn now can be brought up to date later without rebuilding
  // the tree to find out what is underneath it.
  layerGroupNodes.clear();
  for (const node of rows) layerGroupNodes.set(node.key, node);

  for (const node of rows) {
    if (!node.layer) {
      layersList.appendChild(createLayerGroupRow(node));
      continue;
    }
    // A real layer can also be a parent — "Electrical" alongside
    // "Electrical/HV" — so it gets a twisty of its own, and its rename carries
    // its children with it. The rest line up with it via an equally wide gap.
    const row = createLayerRow(node.layer, node.depth, node.segment, node);
    row.insertBefore(node.children.length ? createLayerTwisty(node) : spacer(), row.firstChild);
    layersList.appendChild(row);
  }
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

// ── Adding and removing layers ────────────────────────────────────────────
// Layers are per page, and a shape's membership is stored as the layer's
// *index*, so indexes must never be reused or shuffled: a new layer always
// takes one past the highest, including past the unnamed placeholder rows
// Visio leaves behind, and deleting one leaves its index unused.

function nextLayerIndex(page) {
  let highest = -1;
  for (const layer of page?.layers || []) {
    const index = Number(layer.index);
    if (Number.isFinite(index)) highest = Math.max(highest, index);
  }
  return String(highest + 1);
}

// Tags and named views key layers by name, so two layers sharing one on the
// same page would be indistinguishable to both.
function findLayerByName(page, name) {
  const needle = normalizeLayerText(name);
  return (page?.layers || []).find(layer => normalizeLayerText(layer.name || layer.nameUniv) === needle);
}

function createLayer(page, name) {
  const layer = {
    index: nextLayerIndex(page),
    name,
    nameUniv: name,
    placeholder: false,
    visible: true,
    print: true,
    active: false,
    lock: false,
    snap: true,
    glue: true,
    color: null,
    colorTrans: null,
  };
  if (!page.layers) page.layers = [];
  page.layers.push(layer);
  hiddenLayers.delete(layer.index);
  focusedLayerIndex = layer.index;
  buildLayersSidebar();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
  return layer;
}

// Returns the new layer, or null if the user cancelled or gave an unusable name.
function promptForNewLayer() {
  const page = currentPages[currentPageIndex];
  if (!page || !currentPackageEditable) return null;

  const answer = window.prompt('Name for the new layer:', '');
  if (answer === null) return null;

  const name = String(answer).trim();
  if (!name) {
    window.alert('A layer needs a name.');
    return null;
  }
  const clash = findLayerByName(page, name);
  if (clash) {
    window.alert(`This page already has a layer called "${getLayerDisplayName(clash)}".`);
    return null;
  }
  return createLayer(page, name);
}

function stripLayerFromShapes(shapes, layerIndex) {
  let changed = 0;
  for (const shape of shapes || []) {
    const members = shape.layerMembers || [];
    const remaining = members.filter(member => String(member) !== String(layerIndex));
    if (remaining.length !== members.length) {
      shape.layerMembers = remaining;
      changed++;
    }
    changed += stripLayerFromShapes(shape.subShapes, layerIndex);
  }
  return changed;
}

// One layer or a whole group of them: a group row's delete means every layer
// under it, and asking once for the lot beats asking once per layer.
// `groupLabel` is the group's path when that is what was asked for.
function deleteLayers(layers, groupLabel = null) {
  const page = currentPages[currentPageIndex];
  const doomed = (layers || []).filter(layer => layer && !isVirtualLayer(layer));
  if (!page || !currentPackageEditable || !doomed.length) return false;

  const shapeIds = new Set();
  for (const layer of doomed) {
    for (const entry of shapesOnLayer(page, layer.index)) shapeIds.add(String(entry.id));
  }
  const count = shapeIds.size;
  // Deleting a layer is not deleting its drawing: shapes that were only on it
  // are orphaned to the editor's Unlayered row, where Send Object To Layer can
  // file them again. Shapes on other layers as well simply lose this one.
  const fate = count
    ? `Its ${count} shape${count === 1 ? '' : 's'} stay in the drawing; any that are on no other layer become unlayered.`
    : 'No shapes are on it.';
  const what = groupLabel
    ? `Delete the ${doomed.length} layer${doomed.length === 1 ? '' : 's'} under "${groupLabel}"?`
    : `Delete layer "${getLayerDisplayName(doomed[0])}"?`;
  if (!window.confirm(`${what}\n\n${fate}`)) return false;

  const gone = new Set(doomed.map(layer => String(layer.index)));
  for (const layer of doomed) {
    stripLayerFromShapes(page.shapes, layer.index);
    hiddenLayers.delete(layer.index);
    if (String(focusedLayerIndex) === String(layer.index)) focusedLayerIndex = null;
  }
  page.layers = (page.layers || []).filter(candidate => !gone.has(String(candidate.index)));
  if (layerObjectsIndex !== null && gone.has(String(layerObjectsIndex))) closeLayerObjects();
  if (layerObjectsGroup) closeLayerObjects();

  buildLayersSidebar();
  if (layerMatrixModal.classList.contains('visible')) buildLayerMatrix();
  // Orphaned shapes move under the Unlayered row, which changes what is drawn.
  renderCurrentPage();
  return true;
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

// ── Undoing a change of what is shown ─────────────────────────────────────
// "Hide all" is one click and undoing it by hand is one click per layer, which
// is the wrong trade. Visibility is a small, self-contained piece of state — the
// set of hidden layer indexes — so the undo for it is a stack of those sets
// rather than a general command history. It is per page, because restoring one
// page's visibility onto another would be nonsense; switching pages leaves each
// page's stack where it was.
const MAX_VISIBILITY_UNDO = 60;
const visibilityHistoryByPage = new Map();

function visibilityHistory(pageKey = getCurrentPageKey()) {
  if (!visibilityHistoryByPage.has(pageKey)) visibilityHistoryByPage.set(pageKey, { undo: [], redo: [] });
  return visibilityHistoryByPage.get(pageKey);
}

// Called before the change, never after: what is recorded is what to go back to.
function pushLayerVisibilityUndo() {
  if (!currentPages.length) return;
  const history = visibilityHistory();
  history.undo.push(new Set(hiddenLayers));
  if (history.undo.length > MAX_VISIBILITY_UNDO) history.undo.shift();
  // A fresh change is a new branch; anything undone past this point is gone.
  history.redo.length = 0;
}

function applyLayerVisibilitySnapshot(hidden) {
  hiddenLayers = new Set(hidden);
  for (const layer of getCurrentLayers()) layer.visible = !hiddenLayers.has(layer.index);
  buildLayersSidebar();
  applyLayerVisibility();
}

function stepLayerVisibilityHistory(back) {
  if (!currentPages.length) return false;
  const history = visibilityHistory();
  const from = back ? history.undo : history.redo;
  const to = back ? history.redo : history.undo;
  if (!from.length) return false;

  to.push(new Set(hiddenLayers));
  applyLayerVisibilitySnapshot(from.pop());
  return true;
}

function setLayerSelected(layerIndex, selected) {
  pushLayerVisibilityUndo();
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

  refreshLayerGroupRows();
  updateLayersCount(getCurrentLayers().length, getFilteredLayers().length);
  applyLayerVisibility();
}

function toggleLayer(layerIndex) {
  setLayerSelected(layerIndex, hiddenLayers.has(layerIndex));
}

function setLayerSelection(layers, selected) {
  pushLayerVisibilityUndo();
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
      // Optional-called: not every host implements it, and failing to scroll is
      // never a reason to abandon the rest of a click.
      if (scrollIntoView) item.scrollIntoView?.({ block: 'nearest' });
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

// Finding a shape and finding its layer are the same errand: the answer to
// "where is it?" is a place on the canvas *and* a row in this sidebar, and the
// row is the one that says whether you can see it. So picking a shape from any
// of the lists points the sidebar at the layer it is on — clearing a filter
// that hides the row, and expanding the groups it is buried under, because a
// row that is not drawn cannot be highlighted.
function layerIndexesForShape(shape) {
  const members = (shape?.layerMembers || []).map(String);
  if (members.length) return members;
  // A shape inside a group usually carries no membership of its own; it is on
  // whatever its group is on.
  const path = findShapePath(getCurrentPage()?.shapes || [], shape?.id) || [];
  for (let i = path.length - 2; i >= 0; i--) {
    const inherited = (path[i].layerMembers || []).map(String);
    if (inherited.length) return inherited;
  }
  return [];
}

function revealLayerForShape(shape) {
  if (!shape) return null;
  const uiLayers = getCurrentLayers();
  const known = new Set(uiLayers.map(layer => String(layer.index)));
  const members = layerIndexesForShape(shape).filter(index => known.has(index));
  const layerIndex = members[0]
    ?? (known.has(UNLAYERED_LAYER_INDEX) ? UNLAYERED_LAYER_INDEX : null);
  if (layerIndex === null) return null;

  const layer = uiLayers.find(candidate => String(candidate.index) === String(layerIndex));
  // A row filtered out of the list, or folded into a collapsed group, has no
  // element to focus — so make one exist before asking for it.
  let rebuild = false;
  if (layer && !layerMatchesFilter(layer)) {
    layerFilterText.value = '';
    rebuild = true;
  }
  if (layer && layerTreeActive() && collapsedLayerGroups.size) {
    const segments = parseLayerPathSegments(getLayerDisplayName(layer));
    for (let i = 1; i < segments.length; i++) {
      const key = segments.slice(0, i).join(layerTreeDelimiter);
      if (collapsedLayerGroups.delete(key)) rebuild = true;
    }
  }
  if (rebuild) buildLayersSidebar();

  // Pointing at a row in a pane nobody can see says nothing, so the pane opens
  // — the same thing clicking the shape on the canvas already does.
  layersSidebar.classList.add('visible');
  document.getElementById('btn-layers').classList.add('active');
  updateSidebarChrome();

  focusLayerRow(layerIndex);
  return layerIndex;
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
  const bgPage = backgroundPageFor(currentPage);
  if (bgPage && findShapeById(bgPage.shapes || [], shapeId)) return bgPage;
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

// The page as drawn, for hit tests. Identical to getCurrentPage() unless this
// page has a backdrop.
function getComposedPage() {
  return composedPage(getCurrentPage());
}

// Which of the shapes under the cursor came from the backdrop rather than from
// this page. Only the roots are listed; a nested shape is judged by the root it
// descends from, which is what `ancestors` records.
function backgroundRootIds(page = getCurrentPage()) {
  const bgPage = backgroundPageFor(page);
  return new Set((bgPage?.shapes || []).map(shape => String(shape.id)));
}

function isBackgroundEntry(entry, roots = backgroundRootIds()) {
  if (!roots.size || !entry) return false;
  return roots.has(String(entry.ancestors?.[0] ?? entry.id));
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

function normalizeShapeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// Keys that mean something to the drawing mean something else entirely inside a
// text box, and the field the user is typing in gets to keep them.
function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable === true;
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

// A shape's name is Visio's `Name`/`NameU`, which is what the Shape Tree, the
// "Select component" list and Visio's own Shape Name dialog all show. Renaming
// one has been possible by double-clicking its row in the Shape Tree, but the
// canvas is where you are when you notice the name is wrong, so the right-click
// menu offers it too.
function promptRenameShape(shape) {
  if (!shape || !currentPackageEditable) return false;
  const current = normalizeShapeText(shape.name) || normalizeShapeText(shape.nameU);
  const answer = window.prompt(
    `Rename "${getShapeLabel(shape)}" — the shape's Visio name. Leave blank to clear it:`,
    current
  );
  if (answer === null) return false;
  if (normalizeShapeText(answer) === current) return false;
  setShapeName(shape.id, answer);
  return true;
}

// The selection marker is drawn *last*, as its own overlay, not as an outline
// on the shape's own group. An outline is painted where the shape is painted,
// so selecting something that sits behind another shape drew a marker the shape
// in front covered up — you picked a buried shape out of the list, moved the
// mouse off the row, and it looked like nothing had been selected at all.
//
// The group still carries data-selected, because "is this shape selected" is a
// question the rest of the app and the tests ask of the DOM.
function syncSelectedShapeHighlight() {
  const svg = svgContainer.querySelector('svg');
  const page = getCurrentPage();
  svgContainer.querySelector('#shape-selection')?.remove();

  const entries = new Map();
  if (svg && page) {
    for (const entry of pageShapeBoxes(getComposedPage())) entries.set(String(entry.id), entry);
  }

  // Only the groups that were marked and the ones that should be: walking every
  // shape in the drawing to write two style properties on each cost more than
  // the selection itself on a large file, and there are rarely more than a
  // handful of either.
  const selected = [];
  for (const group of svgContainer.querySelectorAll('g[data-selected]')) {
    if (!isShapeSelected(group.getAttribute('data-shape-id'))) delete group.dataset.selected;
  }
  for (const id of selectedShapeIds) {
    const group = shapeGroupElement(id);
    if (!group) continue;
    // The primary is solid, the rest dashed — with several shapes selected it
    // still has to be clear which one the Shape Tree and the layer list mean.
    const isPrimary = selectedShapeId !== null && String(id) === String(selectedShapeId);
    group.dataset.selected = isPrimary ? 'primary' : 'secondary';
    if (entries.has(String(id))) selected.push({ entry: entries.get(String(id)), isPrimary });
  }
  if (!svg || !page || !selected.length) return;

  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  overlay.setAttribute('id', 'shape-selection');
  overlay.setAttribute('pointer-events', 'none');
  const unit = unitsPerDevicePixel(page);
  for (const { entry, isPrimary } of selected) {
    appendShapeBoxDecoration(overlay, shapeOverlayBox(entry, page), unit, { solid: isPrimary });
  }
  // Handles go on one shape at a time. Resizing several at once is a different
  // question — which of them is the box being dragged? — and rotating several
  // about one point is another, so the drag tools ask about the shape the rest
  // of the app already calls the selected one.
  const primary = selected.find(item => item.isPrimary);
  if (primary && selected.length === 1 && currentPackageEditable && !penActive
      && findShapeById(page.shapes || [], primary.entry.id)) {
    appendShapeHandles(overlay, primary.entry, unit);
  }
  svg.appendChild(overlay);
}

// Where the handles sit: the corners and edge midpoints of the shape's *own*
// box, not of the upright box that contains it, so a shape turned 30° gets
// handles turned 30° with it and dragging one resizes along the shape's own
// axes. Local px run right and down from the shape's top-left corner.
const RESIZE_HANDLE_SPOTS = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['w', 0, 0.5], ['e', 1, 0.5],
  ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1]
];

function applyMatrix(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function appendShapeHandles(overlay, entry, unit) {
  const ns = 'http://www.w3.org/2000/svg';
  const m = entry.matrix;
  const w = (entry.shape.width || 0) * 96;
  const h = (entry.shape.height || 0) * 96;
  if (!(w > 0 && h > 0) || !m) return;

  const size = unit * 8;
  for (const [handle, fx, fy] of RESIZE_HANDLE_SPOTS) {
    const p = applyMatrix(m, fx * w, fy * h);
    const box = document.createElementNS(ns, 'rect');
    box.setAttribute('x', String(p.x - size / 2));
    box.setAttribute('y', String(p.y - size / 2));
    box.setAttribute('width', String(size));
    box.setAttribute('height', String(size));
    box.setAttribute('fill', '#ffffff');
    box.setAttribute('stroke', '#e94560');
    box.setAttribute('stroke-width', String(unit * 1.5));
    box.setAttribute('pointer-events', 'all');
    box.setAttribute('data-handle', handle);
    box.setAttribute('data-handle-shape', String(entry.id));
    overlay.appendChild(box);
  }

  // The rotation grip stands off the top edge, along the shape's own up
  // direction — the same direction the "n" handle would move in.
  const top = applyMatrix(m, w / 2, 0);
  const centre = applyMatrix(m, w / 2, h / 2);
  const away = Math.hypot(top.x - centre.x, top.y - centre.y) || 1;
  const ux = (top.x - centre.x) / away;
  const uy = (top.y - centre.y) / away;
  const grip = { x: top.x + ux * unit * 22, y: top.y + uy * unit * 22 };

  const stem = document.createElementNS(ns, 'line');
  stem.setAttribute('x1', String(top.x));
  stem.setAttribute('y1', String(top.y));
  stem.setAttribute('x2', String(grip.x));
  stem.setAttribute('y2', String(grip.y));
  stem.setAttribute('stroke', '#e94560');
  stem.setAttribute('stroke-width', String(unit * 1.5));
  overlay.appendChild(stem);

  const knob = document.createElementNS(ns, 'circle');
  knob.setAttribute('cx', String(grip.x));
  knob.setAttribute('cy', String(grip.y));
  knob.setAttribute('r', String(unit * 5));
  knob.setAttribute('fill', '#ffffff');
  knob.setAttribute('stroke', '#e94560');
  knob.setAttribute('stroke-width', String(unit * 1.5));
  knob.setAttribute('pointer-events', 'all');
  knob.setAttribute('data-handle', 'rotate');
  knob.setAttribute('data-handle-shape', String(entry.id));
  overlay.appendChild(knob);
}

function applyShapeVisibility(root = null) {
  const svg = root || svgContainer.querySelector('svg');
  if (!svg) return;
  const hiddenShapeIds = getHiddenShapeIds();
  const groups = scopedGroups(svg, 'g[data-shape-id]');
  for (const group of groups) {
    if (hiddenShapeIds.has(group.getAttribute('data-shape-id'))) {
      group.style.display = 'none';
    }
  }
}

// --- The selection ---------------------------------------------------------
// One shape is the common case and the one every other panel is built around,
// so `selectedShapeId` stays what it was — the shape the Shape Tree opens on.
// A multiple selection is that plus the rest, and only the arrange actions
// (group, ungroup, z-order) ask for the whole set.

function clearShapeSelection() {
  selectedShapeId = null;
  selectedShapeIds = new Set();
}

function isShapeSelected(shapeId) {
  return selectedShapeIds.has(String(shapeId));
}

function getSelectedShapes() {
  const shapes = (getCurrentPage()?.shapes) || [];
  return [...selectedShapeIds]
    .map(id => findShapeById(shapes, id))
    .filter(Boolean);
}

// Takes any iterable of ids — callers pass an array or the Set they just built.
function selectShapes(shapeIds, primaryId = null) {
  const next = new Set([...(shapeIds || [])].map(String));
  const preferred = primaryId === null || primaryId === undefined ? null : String(primaryId);
  const nextPrimary = preferred && next.has(preferred)
    ? preferred
    : ([...next].pop() ?? null);

  // Selecting what is already selected is not a change, and re-rendering for it
  // would throw away the row that was just clicked — which is what stopped a
  // double-click on a Shape Tree row from ever reaching its second click.
  if (nextPrimary === selectedShapeId
    && next.size === selectedShapeIds.size
    && [...next].every(id => selectedShapeIds.has(id))) {
    return;
  }

  selectedShapeIds = next;
  selectedShapeId = nextPrimary;
  editingShapeId = null;
  refreshSelectionUI();
}

// A selection is drawn *over* the page, never into it — the shapes themselves
// are identical whether or not one of them is selected — so a click has no
// business re-rendering the drawing. It used to: clicking a shape rebuilt all
// 32,785 elements of a large page and then walked every group again to reapply
// layer and shape visibility, which is a second and a half of work before the
// selection box appears. What actually depends on the selection is the overlay
// and the two panels that list it.
function refreshSelectionUI() {
  syncSelectedShapeHighlight();
  refreshShapeTreeSelection();
  renderLayerObjects();
}

function setSelectedShape(shapeId) {
  if (shapeId === null || shapeId === undefined) {
    clearShapeSelection();
    editingShapeId = null;
    refreshSelectionUI();
    return;
  }
  selectShapes([shapeId], shapeId);
}

// Ctrl/⌘/Shift-click: add the shape, or drop it if it was already in.
function toggleSelectedShape(shapeId) {
  const key = String(shapeId);
  const next = new Set(selectedShapeIds);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectShapes(next, next.has(key) ? key : null);
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

// Editing happens in the row itself, so the tree is redrawn with that row as an
// input. A read-only package has nowhere to put the new name.
function startShapeRename(shapeId) {
  if (!currentPackageEditable) return false;
  editingShapeId = String(shapeId);
  renderShapeTree();
  return true;
}

function toggleShapeTreeBranch(shapeId) {
  const collapsedShapeIds = getCollapsedShapeIds();
  const key = String(shapeId);
  if (collapsedShapeIds.has(key)) collapsedShapeIds.delete(key);
  else collapsedShapeIds.add(key);
  renderShapeTree();
}

// Every shape on the page that has something inside it — the rows that can be
// folded at all.
function shapeTreeBranchIds(shapes = shapeTreeRoots(), out = []) {
  for (const shape of shapes || []) {
    if (shape.subShapes?.length) {
      out.push(String(shape.id));
      shapeTreeBranchIds(shape.subShapes, out);
    }
  }
  return out;
}

// A drawing where everything is inside something is a tree nobody can read at a
// glance. Fold it, open it, or fold everything except the branch you are
// working in — which is the useful one, and the one that has to survive
// renderShapeTree opening the path to the selection again.
function setShapeTreeFolding(mode) {
  const collapsed = getCollapsedShapeIds();
  const branches = shapeTreeBranchIds();
  collapsed.clear();
  if (mode === 'expand') {
    renderShapeTree();
    return;
  }
  for (const id of branches) collapsed.add(id);
  if (mode === 'others') {
    // expandToSelectedShape reopens the path down to the selected shape, and a
    // selected group is worth opening too — collapsing it would hide the thing
    // that was just asked about.
    const path = selectedShapeId === null ? null : findShapePath(shapeTreeRoots(), selectedShapeId);
    for (const ancestor of path || []) collapsed.delete(String(ancestor.id));
  }
  renderShapeTree();
}

// The row's ✕. It used to splice the shape out of the in-memory page only,
// which looked like a delete and then quietly came back on Save VSDX, because
// saving patches the original package and simply skips shapes it no longer
// knows about. It deletes for real now, through the same path as everything
// else that edits the drawing.
function deleteShapeFromTree(shapeId) {
  const key = String(shapeId);
  if (!findShapeById(getCurrentPage()?.shapes || [], key)) return;
  return runArrange('Delete', async (page, base) => {
    const { buffer } = await deleteVsdxShapes(base, page.id, [key]);
    return { buffer };
  });
}

function createShapeTreeNode(shape, depth, rootShapeId) {
  const hiddenShapeIds = getHiddenShapeIds();
  const collapsedShapeIds = getCollapsedShapeIds();
  const hasChildren = (shape.subShapes || []).length > 0;
  const row = document.createElement('div');
  row.className = 'shape-tree-node';
  row.dataset.shapeId = String(shape.id);
  if (isShapeSelected(shape.id)) row.classList.add('selected');
  if (hiddenShapeIds.has(String(shape.id))) row.classList.add('hidden');
  row.style.paddingLeft = `${8 + depth * 18}px`;

  // The row is the thing the keyboard lands on, not the buttons inside it: one
  // tab stop for the whole tree, and the arrows take it from there. syncShapeTreeCursor
  // hands the one row that is the cursor a tabIndex of 0.
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-level', String(depth + 1));
  row.setAttribute('aria-selected', isShapeSelected(shape.id) ? 'true' : 'false');
  if (hasChildren) row.setAttribute('aria-expanded', collapsedShapeIds.has(String(shape.id)) ? 'false' : 'true');
  row.tabIndex = -1;

  // Reading a tree of Shape.7, Shape.8, Shape.9 tells you nothing about which is
  // which on the canvas, so hovering a row draws the same selection square the
  // "Select component" list does, and the row carries the shape's own text —
  // often the only thing that identifies it — as its tooltip.
  const shapeText = normalizeShapeText(shape.text);
  row.title = shapeText ? `${getShapeLabel(shape)} — “${shapeText}”` : getShapeLabel(shape);
  row.addEventListener('mouseenter', () => highlightShapeById(shape.id));
  row.addEventListener('mouseleave', () => clearShapeHighlight());

  // The same menu the canvas opens, on the same rules: right-clicking inside a
  // multiple selection acts on all of it, right-clicking anything else moves
  // the selection there first. There is no stack of shapes under a tree row, so
  // the "Select component" list has nothing to offer and stays folded away.
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    shapeTreeCursorId = String(shape.id);
    if (!isShapeSelected(shape.id)) setSelectedShape(shape.id);
    openShapeContextMenu(shape.id, e.clientX, e.clientY, []);
  });

  const expander = document.createElement('button');
  expander.type = 'button';
  expander.tabIndex = -1;
  expander.className = 'shape-tree-expander';
  expander.textContent = hasChildren && collapsedShapeIds.has(String(shape.id)) ? '+' : '-';
  expander.disabled = !hasChildren;
  expander.addEventListener('click', () => {
    if (hasChildren) toggleShapeTreeBranch(shape.id);
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'shape-tree-checkbox';
  checkbox.tabIndex = -1;
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
    label.tabIndex = -1;
    label.className = 'shape-tree-label';
    label.textContent = getShapeLabel(shape);
    const meta = document.createElement('span');
    meta.className = 'shape-tree-meta';
    meta.textContent = getShapeTreeMeta(shape);
    label.appendChild(meta);
    // Clicking is also where the keyboard picks up from, so the cursor comes
    // with it — click a row, then arrow away from there.
    label.addEventListener('click', () => {
      shapeTreeCursorId = String(shape.id);
      setSelectedShape(shape.id);
    });
    label.addEventListener('dblclick', (e) => {
      e.preventDefault();
      startShapeRename(shape.id);
    });
  }

  // Double-clicking the name still works, but only once the row is the selected
  // one — before that the click that selects it redraws the tree out from under
  // the second click. A button is a button whatever the row's state.
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.tabIndex = -1;
  rename.className = 'shape-tree-rename';
  rename.textContent = '✎';
  rename.disabled = !currentPackageEditable;
  rename.title = currentPackageEditable
    ? `Rename ${getShapeLabel(shape)} (its Visio name)`
    : 'This package is read-only';
  rename.setAttribute('aria-label', `Rename ${getShapeLabel(shape)}`);
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    startShapeRename(shape.id);
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.tabIndex = -1;
  remove.className = 'shape-tree-delete';
  remove.textContent = '×';
  // The root used to be exempt, from back when this spliced the in-memory tree
  // and had nowhere to put a tree with no root. It deletes through the package
  // now, and the tree simply closes, so there is nothing left to protect it
  // from: a shape you opened the tree on is as deletable as any other.
  remove.disabled = !currentPackageEditable;
  remove.title = currentPackageEditable
    ? `Delete ${getShapeLabel(shape)}${(shape.subShapes || []).length ? ', and everything in it,' : ''} from the drawing`
    : 'This package is read-only';
  remove.setAttribute('aria-label', `Delete ${getShapeLabel(shape)}`);
  remove.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteShapeFromTree(shape.id);
  });

  const editXml = document.createElement('button');
  editXml.type = 'button';
  editXml.tabIndex = -1;
  editXml.className = 'shape-tree-xml';
  editXml.textContent = '</>';
  editXml.title = 'Edit this shape XML';
  editXml.addEventListener('click', () => openShapeXmlEditor(shape.id));

  row.appendChild(expander);
  row.appendChild(checkbox);
  row.appendChild(label);
  if (!isEditing) row.appendChild(rename);
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

// A tree of one row is not a tree. This used to open on the selected shape's
// parent group, so selecting a shape that was not in a group listed that shape
// and nothing else — every row you could click was the row already selected,
// which looks exactly like clicking rows does nothing. It shows the page now,
// so the panel answers "what is in this drawing, and where is this shape in
// it", and clicking a row moves the selection somewhere.
function shapeTreeRoots() {
  return getCurrentPage()?.shapes || [];
}

// A selected shape inside a folded group has no row to be marked on, so the
// branches leading to it are opened.
// Picking a shape shows you where it lives. Doing that on *every* render is
// something else: it means a branch you folded springs open again the next time
// anything at all redraws the tree, so folding the branch you are working in —
// or folding the lot — never sticks. So the path is opened when the selection
// moves to a shape, and left alone after that.
let revealedShapeId = null;

function expandToSelectedShape() {
  if (selectedShapeId === null) { revealedShapeId = null; return; }
  if (String(selectedShapeId) === String(revealedShapeId)) return;
  revealedShapeId = String(selectedShapeId);
  const path = findShapePath(shapeTreeRoots(), selectedShapeId);
  if (!path) return;
  const collapsed = getCollapsedShapeIds();
  for (const ancestor of path.slice(0, -1)) collapsed.delete(String(ancestor.id));
}

function updateShapeTreeSubtitle(page, roots) {
  const selected = findShapeById(roots, selectedShapeId);
  const total = pageShapeBoxes(page).length;
  shapeTreeSubtitle.textContent = selected
    ? `${page.name || 'Page'} · ${total} shape${total === 1 ? '' : 's'} · selected ${getShapeLabel(selected)}`
    : `${page.name || 'Page'} · ${total} shape${total === 1 ? '' : 's'}`;
}

// Moving the selection changes two attributes on two rows. Rebuilding the tree
// to do it builds a row for every shape on the page — 67,760 elements on a
// drawing of 8,470 — which is most of what a click on a big drawing used to
// cost. So the rows are only rebuilt when which rows there *are* has changed:
// no tree yet, no selection to show, a row being renamed (it holds a live
// input), or a selection inside a folded branch, which opens it.
function refreshShapeTreeSelection() {
  const page = getCurrentPage();
  const roots = shapeTreeRoots();
  if (!page || !roots.length || selectedShapeId === null || editingShapeId !== null
    || !shapeTreeBody.querySelector('.shape-tree-node')) {
    renderShapeTree();
    return;
  }
  const folded = getCollapsedShapeIds().size;
  expandToSelectedShape();
  if (getCollapsedShapeIds().size !== folded) {
    renderShapeTree();
    return;
  }
  // Only the rows that were marked and the ones that should be — the same
  // argument as on the canvas, and for the same reason: there are 8,470 rows
  // and at most a handful of either.
  for (const row of shapeTreeBody.querySelectorAll('.shape-tree-node.selected')) {
    if (isShapeSelected(row.dataset.shapeId)) continue;
    row.classList.remove('selected');
    row.setAttribute('aria-selected', 'false');
  }
  for (const id of selectedShapeIds) {
    const row = shapeTreeRow(id);
    if (!row) continue;
    row.classList.add('selected');
    row.setAttribute('aria-selected', 'true');
  }
  updateShapeTreeSubtitle(page, roots);
  syncShapeTreeCursor(false);
}

function renderShapeTree() {
  const page = getCurrentPage();
  const roots = shapeTreeRoots();
  // Emptying the body blurs whatever was focused inside it, so whether the tree
  // had the keyboard has to be asked before, not after.
  const hadFocus = shapeTreeBody.contains(document.activeElement);
  shapeTreeBody.innerHTML = '';

  if (!page || !roots.length) {
    shapeTreeSidebar.classList.remove('visible');
    shapeTreeSubtitle.textContent = 'Select a shape to inspect the drawing.';
    const empty = document.createElement('div');
    empty.className = 'shape-tree-empty';
    empty.textContent = page ? 'This page has no shapes.' : 'Select a shape to inspect the drawing.';
    shapeTreeBody.appendChild(empty);
    shapeTreeCursorId = null;
    return;
  }
  if (selectedShapeId === null) {
    shapeTreeSidebar.classList.remove('visible');
    shapeTreeCursorId = null;
    return;
  }

  shapeTreeSidebar.classList.add('visible');
  expandToSelectedShape();
  updateShapeTreeSubtitle(page, roots);
  for (const root of roots) shapeTreeBody.appendChild(createShapeTreeNode(root, 0, null));
  // A row being renamed puts an input on screen that focuses itself; taking the
  // keyboard back for the tree would close it the moment it opened.
  syncShapeTreeCursor(hadFocus && editingShapeId === null);
}

// ---------------------------------------------------------------------------
// Walking the tree from the keyboard
//
// A page is thirty rows called Shape.7, Shape.8, Shape.9, which is not a list
// anyone wants to hunt through with a mouse. The tree moves under the arrows
// like any other tree: up and down step through the rows you can see, right
// opens a group and then walks into it, left closes it and then walks back out.
//
// The cursor is not the selection. Moving it only *shows* you a shape — it
// draws the same box hovering a row does — so you can walk a drawing looking at
// the canvas without losing the selection you already have, and Enter is what
// commits it.
// ---------------------------------------------------------------------------

function shapeTreeRows() {
  return [...shapeTreeBody.querySelectorAll('.shape-tree-node')];
}

// One row by shape id, without walking all of them.
function shapeTreeRow(shapeId) {
  if (shapeId === null || shapeId === undefined) return null;
  const key = window.CSS?.escape ? CSS.escape(String(shapeId)) : String(shapeId);
  return shapeTreeBody.querySelector(`.shape-tree-node[data-shape-id="${key}"]`);
}

function shapeTreeCursorRow() {
  return shapeTreeRow(shapeTreeCursorId);
}

// The cursor belongs to a row, not to a shape: fold a group away and the shape
// it was on has no row left, so it falls back to the selected row and then to
// the first one rather than leaving the tree with nowhere to put the keyboard.
function syncShapeTreeCursor(refocus = false) {
  const first = shapeTreeBody.querySelector('.shape-tree-node');
  if (!first) {
    shapeTreeCursorId = null;
    return;
  }
  let row = shapeTreeRow(shapeTreeCursorId);
  if (!row) {
    row = shapeTreeBody.querySelector('.shape-tree-node.selected') || first;
    shapeTreeCursorId = row.dataset.shapeId;
  }
  // Rows are built with tabIndex -1, so only the row that *was* the cursor has
  // anything to put back — no reason to touch the other 8,469.
  for (const previous of shapeTreeBody.querySelectorAll('.shape-tree-node.cursor')) {
    if (previous === row) continue;
    previous.classList.remove('cursor');
    previous.tabIndex = -1;
  }
  row.classList.add('cursor');
  row.tabIndex = 0;
  if (refocus) row.focus?.({ preventScroll: true });
}

function moveShapeTreeCursor(shapeId) {
  shapeTreeCursorId = shapeId === null ? null : String(shapeId);
  syncShapeTreeCursor(true);
  const row = shapeTreeCursorRow();
  // Optional-called: not every host implements it, and failing to scroll is no
  // reason to give up on the rest of the move.
  row?.scrollIntoView?.({ block: 'nearest' });
  if (row) highlightShapeById(row.dataset.shapeId);
  else clearShapeHighlight();
}

function stepShapeTreeCursor(delta) {
  const rows = shapeTreeRows();
  if (!rows.length) return;
  const at = rows.findIndex(row => row.dataset.shapeId === String(shapeTreeCursorId));
  const next = Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + delta));
  moveShapeTreeCursor(rows[next].dataset.shapeId);
}

function handleShapeTreeKeydown(e) {
  // The inline rename editor is a text field, and Enter and the arrows mean
  // something else entirely inside one.
  if (isTypingTarget(e.target)) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const rows = shapeTreeRows();
  if (!rows.length) return;

  const cursorId = shapeTreeCursorId;
  const shape = cursorId === null ? null : findShapeById(shapeTreeRoots(), cursorId);
  const hasChildren = (shape?.subShapes || []).length > 0;
  const isOpen = hasChildren && !getCollapsedShapeIds().has(String(cursorId));

  switch (e.key) {
    case 'ArrowDown': stepShapeTreeCursor(1); break;
    case 'ArrowUp': stepShapeTreeCursor(-1); break;
    case 'PageDown': stepShapeTreeCursor(10); break;
    case 'PageUp': stepShapeTreeCursor(-10); break;
    case 'Home': moveShapeTreeCursor(rows[0].dataset.shapeId); break;
    case 'End': moveShapeTreeCursor(rows[rows.length - 1].dataset.shapeId); break;
    case 'ArrowRight':
      // Closed group: open it. Open group: step into it. Leaf: nothing to do.
      if (hasChildren && !isOpen) toggleShapeTreeBranch(cursorId);
      else if (isOpen) moveShapeTreeCursor(shape.subShapes[0].id);
      break;
    case 'ArrowLeft': {
      // The mirror image: close what is open, otherwise climb out of it.
      if (isOpen) { toggleShapeTreeBranch(cursorId); break; }
      const path = cursorId === null ? null : findShapePath(shapeTreeRoots(), cursorId);
      const parent = path && path.length > 1 ? path[path.length - 2] : null;
      if (parent) moveShapeTreeCursor(parent.id);
      break;
    }
    case 'Enter':
      if (cursorId !== null) setSelectedShape(cursorId);
      break;
    case ' ':
      // What the row's checkbox does, since that is the other thing a row is.
      if (shape) setShapeVisible(cursorId, getHiddenShapeIds().has(String(cursorId)));
      break;
    case 'F2':
      if (cursorId !== null) startShapeRename(cursorId);
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}

shapeTreeBody.addEventListener('keydown', handleShapeTreeKeydown);
// Walking the tree paints a box on the canvas for the row you are standing on;
// it belongs to the walk, so it goes when the keyboard does.
shapeTreeBody.addEventListener('focusout', (e) => {
  if (!shapeTreeBody.contains(e.relatedTarget)) clearShapeHighlight();
});

function getContextShape() {
  // The backdrop is searched too, or picking one of its shapes out of the list
  // would find nothing and shut the menu the user just opened.
  return contextShapeId !== null ? findShapeById(getComposedPage()?.shapes || [], contextShapeId) : null;
}

function isContextShapeOnBackdrop() {
  if (contextShapeId === null) return false;
  return !findShapeById(getCurrentPage()?.shapes || [], contextShapeId);
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
    shapeXmlTextarea.value = await getVsdxShapeXmlSnippet(await packageBuffer(), page.id, shapeId);
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
  shapeContextList.innerHTML = '';

  // A backdrop shape is drawn here but lives on another page, and its layer
  // numbers mean nothing in this page's table. Say so rather than offering an
  // assignment that would write the wrong layer onto the wrong page.
  if (isContextShapeOnBackdrop()) {
    const backdrop = backgroundPageFor(page);
    shapeContextSubtitle.textContent =
      `${shape.title || shape.name || `Shape ${shape.id}`} · on the background page`;
    const note = document.createElement('div');
    note.className = 'shape-context-empty';
    note.textContent = backdrop?.name
      ? `This shape belongs to the background page “${backdrop.name}” and is edited there.`
      : 'This shape belongs to the background page and is edited there.';
    shapeContextList.appendChild(note);
    return;
  }

  shapeContextSubtitle.textContent = `${shape.title || shape.name || `Shape ${shape.id}`} · current layer ${currentLayer || 'none'}`;

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

// --- Arrange: group, ungroup, z-order --------------------------------------
// Z-order in Visio *is* the order the <Shape> elements appear in, and a shape's
// position is written in its parent's coordinates — so all four of these are a
// move of an element in the page part, not an in-memory tweak. They go through
// the package the way the pen tool commits a path: serialize what is pending,
// edit the XML, reload. The arithmetic that keeps a re-parented shape where it
// is drawn lives in shape-arrange.js.

function isTopLevelShape(shape) {
  return (getCurrentPage()?.shapes || []).some(candidate => String(candidate.id) === String(shape.id));
}

function renderShapeArrangeSection() {
  if (!shapeArrangeSection) return;
  const page = getCurrentPage();
  const shapes = getSelectedShapes();
  shapeArrangeSection.hidden = !page || !currentPackageEditable || shapes.length === 0;
  if (shapeArrangeSection.hidden) return;

  const groups = shapes.filter(isGroupShape);
  // A group whose parts come from its master cannot be dissolved without
  // emptying them, so it does not count as ungroupable.
  const dissolvable = groups.filter(shape => !inheritsFromMaster(shape));
  const nested = shapes.filter(shape => !isTopLevelShape(shape));
  shapeArrangeHint.textContent = shapes.length === 1
    ? `${getShapeLabel(shapes[0])} · Ctrl-click a shape to select more`
    : `${shapes.length} shapes selected`;

  shapeArrangeGroup.disabled = shapes.length < 2 || nested.length > 0;
  shapeArrangeGroup.title = shapes.length < 2
    ? 'Select two or more shapes to group them'
    : nested.length > 0
      ? 'Only top-level shapes can be grouped — ungroup the outer group first'
      : `Wrap these ${shapes.length} shapes in a new group`;

  shapeArrangeUngroup.disabled = dissolvable.length === 0;
  shapeArrangeUngroup.title = dissolvable.length > 0
    ? `Dissolve ${dissolvable.length === 1 ? getShapeLabel(dissolvable[0]) : `${dissolvable.length} groups`}, keeping the shapes inside`
    : groups.length > 0
      ? 'This group comes from a master — its shapes read their geometry from it and would be emptied'
      : 'Select a group to dissolve it';

  shapeArrangeFront.title = 'Draw these shapes on top of their siblings';
  shapeArrangeBack.title = 'Draw these shapes behind their siblings';

  // getSelectedShapes only ever finds shapes on this page, which is the same
  // test deletableSelectionIds makes — a backdrop shape is not in either.
  if (shapeArrangeDelete) {
    shapeArrangeDelete.textContent = shapes.length > 1 ? `Delete ${shapes.length} shapes` : 'Delete';
    shapeArrangeDelete.title = shapes.length === 1
      ? `Delete ${getShapeLabel(shapes[0])}, and anything grouped inside it, from this page`
      : `Delete these ${shapes.length} shapes, and anything grouped inside them, from this page`;
  }
}

async function runArrange(label, work) {
  const page = getCurrentPage();
  if (!page || !currentPackageEditable || !currentFileBuffer) return false;
  closeShapeContextMenu();
  try {
    const { buffer, select } = await work(page, await getPackageBufferWithPendingEdits());
    await applyUpdatedVsdxBuffer(buffer, page.id);
    if (select?.length) selectShapes(select);
    return true;
  } catch (e) {
    console.error(e);
    showError(`${label} failed: ${e.message}`);
    return false;
  }
}

// --- Committing a placement without reloading the file ----------------------
// Group, ungroup, z-order and delete all change the *shape* of the document —
// which element lives inside which, and in what order — so they go through the
// package and come back as a fresh model. A move, a resize or a turn does not.
// It changes at most six numbers on a handful of shapes, and every one of them
// is already in memory and already on the canvas.
//
// So it is made where it can be seen. The model gets the numbers, the shapes
// that moved are drawn again and nothing else is, and the package is left to
// catch up whenever something next wants the bytes (packageBuffer).
//
// The long way round meant rewriting the .vsdx, parsing it again and drawing
// every shape on the page from the result — 18 seconds of parse on a 20 MB
// drawing to nudge one group, plus the selection, the folded rows of the Shape
// Tree and the scroll position all thrown away on the way past.

// The cells a placement can write, under the names the model gives them.
const PLACEMENT_CELLS = ['pinX', 'pinY', 'width', 'height', 'locPinX', 'locPinY'];

// True when applying this plan to the model would say something the file will
// not. transformVsdxShapes leaves Angle, FlipX and FlipY alone when the plan
// asks for the default *and* the shape has no cell of its own to overwrite, so
// a shape inheriting a turn from its master and turned back to exactly square
// would come back turned. Nothing in the model says whether the cell is the
// shape's own, so that case goes the long way round instead of guessing.
function planKeepsInheritedPlacement(shape, cells) {
  if ('angle' in cells && Math.abs(cells.angle || 0) < 1e-9 && Math.abs(shape.angle || 0) >= 1e-9) return true;
  if ('flipX' in cells && !cells.flipX && shape.flipX) return true;
  if ('flipY' in cells && !cells.flipY && shape.flipY) return true;
  return false;
}

/**
 * Apply a move/resize/rotate plan to the drawing on screen. Returns false —
 * having changed nothing — if any part of it cannot be mirrored, in which case
 * the caller should fall back to the package round-trip.
 */
function commitPlacementLocally(updates) {
  const svg = svgContainer.querySelector('svg');
  const page = getCurrentPage();
  if (!svg || !page || !currentPackageEditable || !currentFileBuffer || !updates?.length) return false;

  const composed = composedPage(page);
  const byId = buildShapeIndex(composed, pageShapeBoxes(composed));
  const wanted = new Set(updates.map(update => String(update.id)));

  // Everything is checked before anything is changed. A plan applied to half
  // the model with the package still holding the old numbers is a worse
  // outcome than a slow drag.
  const roots = [];
  for (const update of updates) {
    const shape = findShapeById(page.shapes || [], update.id);
    const entry = byId.get(String(update.id));
    if (!shape || !entry || entry.shape !== shape) return false;
    if (planKeepsInheritedPlacement(shape, update.cells || {})) return false;
    if (!shapeGroupElement(update.id)) return false;
    // A shape inside another shape in the same plan is drawn again as part of
    // its parent, so it is not a root of the redraw.
    if (!entry.ancestors.some(id => wanted.has(String(id)))) roots.push(entry);
  }

  for (const update of updates) {
    const shape = byId.get(String(update.id)).shape;
    const cells = update.cells || {};
    // Rounded the way the writer rounds it, so what is on screen is what the
    // file would come back as rather than a hair away from it.
    for (const name of PLACEMENT_CELLS) {
      if (Number.isFinite(cells[name])) shape[name] = shapeCellNumber(cells[name]);
    }
    if ('angle' in cells) shape.angle = shapeCellNumber(cells.angle || 0);
    if ('flipX' in cells) shape.flipX = Boolean(cells.flipX);
    if ('flipY' in cells) shape.flipY = Boolean(cells.flipY);
  }

  // The shapes are somewhere else now, so everything derived from where they
  // were — the flattened boxes the picker and the selection overlay read — is
  // no longer true.
  invalidatePageGeometryCaches();
  for (const entry of roots) {
    const parentId = entry.ancestors[entry.ancestors.length - 1];
    const parent = parentId ? byId.get(String(parentId)) : null;
    const drawn = redrawShape(svg, composed, entry.shape, {
      minStrokeWidth: currentMinStrokeWidth(composed),
      metadata: false,
      parentHeight: parent ? (parent.shape.height || 0) : composed.height
    });
    if (!drawn) continue;
    applyLayerVisibility(drawn);
    applyShapeVisibility(drawn);
  }

  pendingShapeEdits.push({ pageId: page.id, updates });
  // The Shape Tree lists what is on the page, not where any of it is, so a
  // placement leaves it alone. The selection markers are drawn from the boxes
  // that just changed.
  syncSelectedShapeHighlight();
  renderLayerObjects();
  return true;
}

function groupSelection() {
  const ids = [...selectedShapeIds];
  return runArrange('Group', async (page, base) => {
    const plan = planGroupShapes(page, ids);
    const { buffer, shapeId } = await groupVsdxShapes(base, page.id, plan);
    return { buffer, select: [shapeId] };
  });
}

function ungroupSelection() {
  const groupIds = getSelectedShapes()
    .filter(shape => isGroupShape(shape) && !inheritsFromMaster(shape))
    .map(shape => String(shape.id));
  return runArrange('Ungroup', async (page, base) => {
    if (!groupIds.length) throw new Error('Nothing selected is a group that can be dissolved');
    let buffer = base;
    let workingPage = page;
    const released = [];
    for (const groupId of groupIds) {
      const result = await ungroupVsdxShapes(buffer, page.id, planUngroupShape(workingPage, groupId));
      buffer = result.buffer;
      released.push(...result.shapeIds);
      // One of the selected groups may have been inside another, so the next
      // plan has to be made against the drawing as it now stands.
      if (groupIds.length > 1) {
        const reparsed = await parseVsdx(buffer);
        workingPage = reparsed.pages.find(candidate => String(candidate.id) === String(page.id)) || workingPage;
      }
    }
    return { buffer, select: released };
  });
}

function reorderSelection(place) {
  const ids = [...selectedShapeIds];
  return runArrange(place === 'front' ? 'Bring to front' : 'Send to back', async (page, base) => {
    if (!ids.length) throw new Error('Nothing is selected');
    const { buffer } = await reorderVsdxShapes(base, page.id, ids, place);
    return { buffer, select: ids };
  });
}

// Deleting goes through the package like the other three, so what is gone is
// gone from the file and not only from the drawing on screen.
//
// Shapes on the background page are drawn here but belong to another page, so
// they are dropped from the request rather than deleted out from under whoever
// owns them — the same reason the layer list refuses to reassign them.
function deletableSelectionIds() {
  const shapes = getCurrentPage()?.shapes || [];
  return [...selectedShapeIds].filter(id => findShapeById(shapes, id));
}

function deleteSelection() {
  const ids = deletableSelectionIds();
  return runArrange('Delete', async (page, base) => {
    if (!ids.length) throw new Error('Nothing on this page is selected');
    const { buffer } = await deleteVsdxShapes(base, page.id, ids);
    // Nothing to re-select: reloading the package clears the selection, and
    // every id in it just stopped existing.
    return { buffer };
  });
}

function openShapeContextMenu(shapeId, clientX, clientY, pickEntries = []) {
  contextShapeId = String(shapeId);
  contextPickEntries = pickEntries;
  shapeContextSearch.value = '';
  renderShapeContextMenu();
  renderShapePickList();
  renderShapeArrangeSection();
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

// Where a shape is *drawn*, in SVG user units.
//
// A shape's Width/Height box is where its geometry lives, and that is not where
// the ink ends up: a 50pt stroke on a thin path puts most of the shape outside
// the box, and a box drawn on the box alone has the shape hanging out of it.
// The browser has already worked out the real extent, stroke and markers and
// all, so ask it — getBoundingClientRect on the rendered group — and only fall
// back to the geometric box where there is no layout to ask (headless DOMs, a
// group that is display:none).
function renderedShapeBox(shapeId) {
  const group = shapeGroupElement(shapeId);
  const rect = group?.getBoundingClientRect?.();
  if (!rect || !(rect.width > 0 || rect.height > 0)) return null;
  const topLeft = clientToUserUnits(rect.left, rect.top);
  const bottomRight = clientToUserUnits(rect.right, rect.bottom);
  if (!topLeft || !bottomRight) return null;
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    w: Math.abs(bottomRight.x - topLeft.x),
    h: Math.abs(bottomRight.y - topLeft.y)
  };
}

function geometricShapeBox(entry, page) {
  const dpi = getPageDpi(page);
  const box = entry.bounds;
  return {
    x: box.minX * dpi,
    y: (page.height - box.maxY) * dpi,
    w: (box.maxX - box.minX) * dpi,
    h: (box.maxY - box.minY) * dpi
  };
}

// One box per shape, padded, with a floor so a horizontal line still gets
// something grabbable rather than a zero-height sliver.
function shapeOverlayBox(entry, page) {
  const unit = unitsPerDevicePixel(page);
  const pad = unit * 2;
  const box = renderedShapeBox(entry.id) || geometricShapeBox(entry, page);
  return {
    x: box.x - pad,
    y: box.y - pad,
    w: Math.max(box.w, unit) + pad * 2,
    h: Math.max(box.h, unit) + pad * 2
  };
}

function appendShapeBoxDecoration(group, { x, y, w, h }, unit, { solid }) {
  const ns = 'http://www.w3.org/2000/svg';
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('fill', '#e94560');
  rect.setAttribute('fill-opacity', solid ? '0.08' : '0.12');
  rect.setAttribute('stroke', '#e94560');
  rect.setAttribute('stroke-width', String(unit * 1.5));
  if (!solid) rect.setAttribute('stroke-dasharray', `${unit * 4} ${unit * 3}`);
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
}

// The same square, for callers that have an id rather than a collected entry —
// the Shape Tree walks the page model, not the box list.
function highlightShapeById(shapeId) {
  const entry = pageShapeBoxes(getComposedPage())
    .find(candidate => String(candidate.id) === String(shapeId));
  if (entry) highlightShapeBox(entry);
  else clearShapeHighlight();
}

function highlightShapeBox(entry) {
  clearShapeHighlight();
  const svg = svgContainer.querySelector('svg');
  const page = getCurrentPage();
  if (!svg || !page || !entry) return;

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('id', 'shape-highlight');
  group.setAttribute('pointer-events', 'none');
  appendShapeBoxDecoration(group, shapeOverlayBox(entry, page), unitsPerDevicePixel(page), { solid: false });
  svg.appendChild(group);
}

// A shape the user cannot currently see is still worth listing — it is often
// exactly what they are hunting for — but it has to say so.
function isEntryHidden(entry) {
  // A backdrop shape's layer numbers index the backdrop page's own layer table,
  // not this page's, so this page's hidden set says nothing about it.
  if (isBackgroundEntry(entry)) return false;
  if (getHiddenShapeIds().has(String(entry.id))) return true;
  if (!entry.layerMembers.length) return hiddenLayers.has(UNLAYERED_LAYER_INDEX);
  return entry.layerMembers.every(member => hiddenLayers.has(String(member)));
}

function createShapePickRow(entry, className, onPick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = className;
  row.dataset.shapeId = entry.id;
  if (isShapeSelected(entry.id)) row.classList.add('selected');

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
  if (isBackgroundEntry(entry)) bits.push('background');
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
    onPick(entry, e);
  });
  return row;
}

// Rendering every shape in a big drawing would cost more than it tells anyone,
// and nobody scrolls past a few hundred rows to find their shape — they type
// more of the name instead. The title says when the list was cut short.
const MAX_SHAPE_SEARCH_RESULTS = 300;

function closeLayerObjects() {
  layerObjectsIndex = null;
  layerObjectsGroup = null;
  shapeSearchQuery = '';
  if (shapeSearchInput) shapeSearchInput.value = '';
  clearShapeHighlight();
  if (layerObjectsPanel) layerObjectsPanel.hidden = true;
}

// Whether the row a menu button belongs to is the one whose list is open — the
// button lights up so the panel is traceable back to what asked for it.
function layerObjectsMatchesTarget(target) {
  if (target?.node && !target.node.layer) return layerObjectsGroup?.key === target.node.key;
  const layer = target?.layer || target?.node?.layer;
  return layer !== undefined && layer !== null
    && layerObjectsIndex !== null
    && String(layer.index) === String(layerObjectsIndex);
}

// One panel, two questions — "what is on this layer?" and "where is the shape
// called X?" — because the answer to both is a list of shapes you hover to
// highlight. A search wins over a layer: it is the more recent thing asked.
function renderLayerObjects() {
  if (!layerObjectsPanel) return;
  const page = getCurrentPage();
  const searching = shapeSearchQuery.trim().length > 0;
  if ((!searching && layerObjectsIndex === null && !layerObjectsGroup) || !page) {
    layerObjectsPanel.hidden = true;
    return;
  }

  let entries;
  let title;
  let emptyText;
  if (searching) {
    entries = searchShapes(page, shapeSearchQuery, { limit: MAX_SHAPE_SEARCH_RESULTS });
    const capped = entries.length >= MAX_SHAPE_SEARCH_RESULTS;
    title = `“${shapeSearchQuery.trim()}” — ${capped ? 'first ' : ''}${entries.length} match${entries.length === 1 ? '' : 'es'}`;
    emptyText = 'No shape on this page matches.';
  } else if (layerObjectsGroup) {
    entries = shapesOnLayers(page, layerObjectsGroup.indexes, { unlayeredIndex: UNLAYERED_LAYER_INDEX });
    title = `${layerObjectsGroup.path} — ${entries.length} object${entries.length === 1 ? '' : 's'}`;
    emptyText = 'No shapes on the layers in this group.';
  } else {
    const layer = getUiLayers(page).find(candidate => String(candidate.index) === String(layerObjectsIndex));
    entries = shapesOnLayer(page, layerObjectsIndex, { unlayeredIndex: UNLAYERED_LAYER_INDEX });
    title = `${layer ? getLayerDisplayName(layer) : 'Layer'} — ${entries.length} object${entries.length === 1 ? '' : 's'}`;
    emptyText = 'No shapes on this layer.';
  }

  layerObjectsPanel.hidden = false;
  layerObjectsTitle.textContent = title;
  layerObjectsList.innerHTML = '';

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'layer-objects-empty';
    empty.textContent = emptyText;
    layerObjectsList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    layerObjectsList.appendChild(createShapePickRow(entry, 'layer-object-row', (picked, event) => {
      if (event?.ctrlKey || event?.metaKey || event?.shiftKey) toggleSelectedShape(picked.id);
      else setSelectedShape(picked.id);
      // Finding a shape and finding out which layer it is on are the same
      // question asked twice, so the answer to the second comes for free.
      revealLayerForShape(picked.shape);
      renderLayerObjects();
    }));
  }
}

function openLayerObjects(layerIndex) {
  const reopening = layerObjectsGroup === null && String(layerIndex) === String(layerObjectsIndex);
  layerObjectsGroup = null;
  layerObjectsIndex = reopening ? null : layerIndex;
  // The panel shows one list at a time, so asking for a layer drops the search.
  shapeSearchQuery = '';
  if (shapeSearchInput) shapeSearchInput.value = '';
  if (layerObjectsIndex === null) closeLayerObjects();
  else renderLayerObjects();
  buildLayersSidebar();
}

// A group row's list is every shape on every layer under it, which is the only
// way to ask "what is in Electrical?" when Electrical is a naming convention
// rather than a layer.
function openLayerGroupObjects(node) {
  const reopening = layerObjectsGroup?.key === node.key;
  layerObjectsIndex = null;
  layerObjectsGroup = reopening ? null : {
    key: node.key,
    path: node.path,
    indexes: layersUnder(node).map(layer => String(layer.index)),
  };
  shapeSearchQuery = '';
  if (shapeSearchInput) shapeSearchInput.value = '';
  if (!layerObjectsGroup) closeLayerObjects();
  else renderLayerObjects();
  buildLayersSidebar();
}

function runShapeSearch(query) {
  shapeSearchQuery = String(query ?? '');
  // A search and a layer's object list compete for the same panel; typing
  // takes it over, and clearing the box hands it back to nothing at all.
  const hadLayerList = layerObjectsIndex !== null || layerObjectsGroup !== null;
  if (shapeSearchQuery.trim()) {
    layerObjectsIndex = null;
    layerObjectsGroup = null;
  }
  clearShapeHighlight();
  renderLayerObjects();
  // Only to drop the ⊙ button's active mark, which the sidebar rows own.
  if (hadLayerList && layerObjectsIndex === null) buildLayersSidebar();
}

function renderShapePickList() {
  if (!shapePickSection) return;
  shapePickSection.hidden = contextPickEntries.length === 0;
  if (!contextPickEntries.length) return;

  shapePickHint.textContent =
    `${contextPickEntries.length} shape${contextPickEntries.length === 1 ? '' : 's'} here · hover to highlight`;
  shapePickList.innerHTML = '';
  for (const entry of contextPickEntries) {
    const row = createShapePickRow(entry, 'shape-pick-row', (picked, event) => {
      contextShapeId = String(picked.id);
      if (event?.ctrlKey || event?.metaKey || event?.shiftKey) toggleSelectedShape(picked.id);
      else setSelectedShape(picked.id);
      // A backdrop shape's layer numbers belong to the backdrop's table, so
      // jumping to the row they happen to match here would point at a stranger.
      if (!isBackgroundEntry(picked)) revealLayerForShape(picked.shape);
      renderShapeContextMenu();
      renderShapePickList();
      renderShapeArrangeSection();
    });
    if (contextShapeId !== null && String(entry.id) === String(contextShapeId)) row.classList.add('active');
    shapePickList.appendChild(row);
  }
}

// --- What is under the cursor ----------------------------------------------
// Two ways of asking, because neither is right on its own.
//
// Geometry — every shape whose box covers the point — is the question the menu
// wants, but it is answered in page inches, so it is only as good as this app's
// screen→page transform, and a box is not the shape: a rotated or L-shaped
// piece claims corners it does not occupy.
//
// The browser already knows the answer for what it actually drew.
// elementsFromPoint returns the whole stack at a client point — everything
// underneath included, not just the top one — hit-tested against real geometry
// with no coordinate maths of ours in the way. What it misses is the inside of
// an unfilled shape, which has no hit region at all.
//
// So both are asked and the answers merged. That is what "everything that
// passes through this point" has to mean: a shape you have to send to the back
// before you can pick it is a shape this list failed to offer.
function domShapeEntriesAt(clientX, clientY, byId) {
  if (typeof document.elementsFromPoint !== 'function') return [];
  const found = [];
  for (const el of document.elementsFromPoint(clientX, clientY) || []) {
    // Walk up from each hit: a nested shape's <g> sits inside its group's, and
    // both are worth offering.
    for (let node = el; node && node.getAttribute; node = node.parentNode) {
      const id = node.getAttribute('data-shape-id');
      if (id && byId.has(String(id))) found.push(byId.get(String(id)));
    }
  }
  return found;
}

function shapesUnderCursor(clientX, clientY) {
  const page = getComposedPage();
  if (!page) return [];
  const entries = pageShapeBoxes(page);
  const byId = new Map(entries.map(entry => [String(entry.id), entry]));

  const point = clientToPageUnits(clientX, clientY);
  // A few device pixels of slop, so a hairline is still catchable.
  const geometric = point
    ? shapesAtPoint(page, point.x, point.y, { slop: pageInchesPerDevicePixel(page) * 3, entries })
    : [];

  return topmostFirst(dedupeById([...geometric, ...domShapeEntriesAt(clientX, clientY, byId)]));
}

function attachSvgLayerFocusHandlers() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return;
  svg.addEventListener('click', (e) => {
    // While drawing, a click is a path point - not a selection.
    if (penActive) return;
    // Letting go after a drag is not a click. Without this, dragging several
    // shapes at once would end with the selection collapsed onto whichever one
    // the pointer happened to be over.
    if (suppressNextCanvasClick) {
      suppressNextCanvasClick = false;
      return;
    }
    focusLayerFromSvgElement(e.target);
    const group = e.target.closest?.('g[data-shape-id]');
    if (!group) return;
    const id = group.getAttribute('data-shape-id');
    if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelectedShape(id);
    else setSelectedShape(id);
  });
  svg.addEventListener('contextmenu', (e) => {
    if (penActive) return;
    const entries = shapesUnderCursor(e.clientX, e.clientY);

    const group = e.target.closest?.('g[data-shape-id]');
    const targetId = group?.getAttribute('data-shape-id') ?? entries[0]?.id ?? null;
    if (targetId === null) return;

    e.preventDefault();
    // Right-clicking inside a multiple selection acts on all of it; right-
    // clicking anything else means the user has moved on to that shape.
    if (!isShapeSelected(targetId)) setSelectedShape(targetId);
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

// Every group in `root` matching `selector`, `root` itself included. A redraw
// hands in the single group it just built, and that group is one of the ones
// the rule below has to be applied to.
function scopedGroups(root, selector) {
  const groups = [...root.querySelectorAll(selector)];
  if (root.matches?.(selector)) groups.unshift(root);
  return groups;
}

function applyLayerVisibility(root = null) {
  const svg = root || svgContainer.querySelector('svg');
  if (!svg) return;
  const groups = scopedGroups(svg, 'g[data-layers]');
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
  for (const g of scopedGroups(svg, 'g[data-shape-id]:not([data-layers])')) {
    if (unlayeredHidden) {
      g.style.display = 'none';
    } else {
      g.style.removeProperty('display');
      g.removeAttribute('display');
    }
  }
}

// Opening a page shows all of it. That used to happen by accident: the SVG was
// laid out at width:100% with its natural size as a maximum, so the browser
// shrank a large drawing to the window and "100%" meant "as big as fits".
// Sizing the SVG in layout — which is what stopped zooming from going blurry —
// made 100% mean 100%, and a drawing hundreds of feet across opened hundreds of
// screens wide with no way to pull far enough back. So the fit is now done
// deliberately, and the zoom the drawing opens at is the fit.
let pendingFit = false;

function resetView() {
  zoom = 1;
  panX = 0;
  panY = 0;
  pendingFit = true;
  updateTransform();
}

// The scale at which the whole page is on screen at once. `magnify` allows a
// drawing smaller than the window to be blown up to fill it — what the Fit
// button should do, but not what opening a business card should do.
function fitZoom({ magnify = false } = {}) {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return null;
  const { width, height } = svgViewBoxSize(svg);
  const view = viewportEl.getBoundingClientRect();
  const room = { width: view.width - 32, height: view.height - 32 };
  if (!(width > 0 && height > 0 && room.width > 0 && room.height > 0)) return null;
  const scale = Math.min(room.width / width, room.height / height);
  return Math.max(MIN_ZOOM, Math.min(magnify ? scale : Math.min(scale, 1), MAX_ZOOM));
}

function fitToWindow(options = {}) {
  const scale = fitZoom(options);
  if (scale === null) return false;
  zoom = scale;
  const svg = svgContainer.querySelector('svg');
  const { width, height } = svgViewBoxSize(svg);
  const view = viewportEl.getBoundingClientRect();
  // Centre what is left over, so a wide drawing in a tall window sits in the
  // middle rather than against the top-left corner.
  panX = Math.max(0, (view.width - width * scale) / 2);
  panY = Math.max(0, (view.height - height * scale) / 2);
  layoutZoom = 1;
  commitLayoutZoom();
  updateTransform();
  return true;
}

// An SVG this app exported carries the whole drawing inside it, so re-opening
// one has always round-tripped perfectly — including round-tripping away
// anything done to the picture in between. What the picture can still be
// trusted to say is which shapes are gone and which are new (src/svg-import.js
// explains why it stops there), and since applying that rewrites the drawing it
// is asked for rather than assumed.
async function applySvgPictureEdits(svgText, embedded) {
  const bytes = embedded.buffer;
  const original = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const format = getVisioFormat(embedded.name);
  if (!format || format.family !== 'xml') return original;   // legacy .vsd is read-only

  let plan;
  try {
    plan = readSvgEdits(svgText, await parseVsdx(original), { pageId: embedded.pageId });
  } catch (e) {
    console.error('Could not compare the SVG against the drawing it carries:', e);
    return original;
  }

  if (!plan.ok) {
    if (plan.reason) showError(`Opened the embedded drawing without checking for edits: ${plan.reason}`);
    return original;
  }
  if (!plan.added.length && !plan.removed.length && !plan.modified.length) {
    if (plan.skipped.length) showError(describeSkippedSvgElements(plan));
    return original;
  }

  const detail = [
    `This SVG has been edited since it was exported: ${summarizeSvgEdits(plan)}.`,
    '',
    ...plan.added.slice(0, 8).map(entry =>
      `  + ${entry.label}${entry.layer ? ` on layer "${entry.layer}"` : ''}`),
    ...(plan.added.length > 8 ? [`  + …and ${plan.added.length - 8} more`] : []),
    ...plan.removed.slice(0, 8).map(entry => `  − ${entry.label}`),
    ...(plan.removed.length > 8 ? [`  − …and ${plan.removed.length - 8} more`] : []),
    ...plan.modified.slice(0, 8).map(entry => `  ~ ${entry.label} (${entry.kinds.join(', ')})`),
    ...(plan.modified.length > 8 ? [`  ~ …and ${plan.modified.length - 8} more`] : []),
    ...(plan.skipped.length ? ['', describeSkippedSvgElements(plan)] : []),
    '',
    'Apply them to the drawing? Cancel opens the drawing as it was exported.'
  ].join('\n');

  if (!window.confirm(detail)) return original;
  try {
    const applied = await applySvgEdits(original, plan);
    return applied.buffer;
  } catch (e) {
    console.error('Could not apply the SVG edits:', e);
    showError('Could not apply the SVG edits: ' + (e?.message || e));
    return original;
  }
}

function describeSkippedSvgElements(plan) {
  const shown = plan.skipped.slice(0, 4).map(entry => `${entry.label} — ${entry.reason}`);
  if (plan.skipped.length > shown.length) shown.push(`…and ${plan.skipped.length - shown.length} more`);
  return `Not imported:\n  ${shown.join('\n  ')}`;
}

async function loadFile(file) {
  // Each document gets its own export default: a size chosen for the last
  // drawing is meaningless for this one, and the drawing most in need of being
  // rescaled would otherwise be the one that opens on "Original size".
  exportSizeMode = null;
  let name = file.name.toLowerCase();
  if (name.endsWith('.svg')) {
    // SVGs exported by this app carry the source document as base64 metadata;
    // unwrap it and load the embedded .vsdx/.vsd as if it were opened directly.
    const svgText = await file.text();
    const embedded = extractVsdxFromSvg(svgText);
    if (!embedded) {
      showError('This SVG has no embedded VSDX data (only SVGs exported by this app can be re-opened)');
      return;
    }
    const embeddedName = getVisioFormat(embedded.name)
      ? embedded.name
      : file.name.replace(/\.svg$/i, '') + '.vsdx';
    const buffer = await applySvgPictureEdits(svgText, embedded);
    file = new File([buffer], embeddedName);
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
    pendingShapeEdits = [];
    currentFileType = format.family === 'xml' ? 'vsdx' : 'vsd';
    currentFileExtension = format.extension;
    const result = currentFileType === 'vsd' ? await parseVsd(buffer) : await parseVsdx(buffer);
    if (!result.pages?.length) throw new Error(`No renderable pages or masters found in ${currentFileExtension}`);
    currentPackageEditable = currentFileType === 'vsdx' && result.hasPagesPart !== false;
    currentPages = result.pages;
    viewTemplates = Array.isArray(result.viewTemplates) ? result.viewTemplates : [];
    layerTagColors = { ...(result.layerTagColors || {}) };
    applyLayerTreeSettings(result.layerTree);
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
    if (selectButton) selectButton.disabled = !currentPackageEditable;
    // So does adding a layer — a read-only stencil has nowhere to put one.
    if (layersManage) layersManage.style.display = currentPackageEditable ? '' : 'none';
    if (shapeContextNewLayer) shapeContextNewLayer.style.display = currentPackageEditable ? '' : 'none';
    // A rename is written back into the package, so a read-only stencil has
    // nowhere to put one.
    if (shapeContextRename) shapeContextRename.style.display = currentPackageEditable ? '' : 'none';
    setPenActive(false);
    closeLayerObjects();
    // Default to first foreground page
    const firstFg = currentPages.findIndex(p => !p.isBackground);
    currentPageIndex = firstFg >= 0 ? firstFg : 0;
    showViewer();
    buildPageTabs();
    hiddenLayers = getInitialHiddenLayers();
    focusedLayerIndex = null;
    clearShapeSelection();
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

// Zoom about a point on screen: whatever is under the cursor stays under it.
// Written as "where is this screen point in the drawing" and then "put it back
// there", because the clamp may refuse part of the move and the arithmetic has
// to survive that.
function zoomAbout(newZoom, clientX, clientY) {
  const rect = viewportEl.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const target = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));
  const scale = target / zoom;
  panX = mx - scale * (mx - panX);
  panY = my - scale * (my - panY);
  zoom = target;
  updateTransform();
}

// A wheel notch in line mode is a line, not a pixel; in page mode it is a
// screenful. Chrome sends pixels, Firefox lines.
function wheelPixels(e) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewportEl.clientHeight || 600 : 1;
  return { x: e.deltaX * unit, y: e.deltaY * unit };
}

// The wheel scrolls and Ctrl+wheel zooms, which is what Visio does, what the
// browser does, and what a trackpad pinch already sends. Shift swaps the axis
// for a mouse that only has the one wheel.
viewportEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // A pinch arrives as a large ctrl+wheel deltaY; a notch arrives as a small
    // one. Scaling by the delta keeps both proportionate.
    zoomAbout(zoom * Math.exp(-wheelPixels(e).y / 320), e.clientX, e.clientY);
    return;
  }
  const delta = wheelPixels(e);
  const dx = e.shiftKey ? delta.y || delta.x : delta.x;
  const dy = e.shiftKey ? 0 : delta.y;
  panBy(-dx, -dy);
}, { passive: false });

// --- Scrolling -------------------------------------------------------------
// Panning is a transform rather than a scroll — that is what keeps the vectors
// crisp at any zoom, see commitLayoutZoom — so the browser has no scrollable
// box here and would show no scrollbars and honour no wheel. Both are drawn and
// driven from the same pan the drag uses.

const scrollbarX = document.getElementById('viewport-scroll-x');
const scrollbarY = document.getElementById('viewport-scroll-y');
const scrollThumbX = document.getElementById('viewport-scroll-x-thumb');
const scrollThumbY = document.getElementById('viewport-scroll-y-thumb');
const MIN_THUMB = 24;

// Every pan goes through here, so nothing has to remember to clamp or to move
// the thumbs. The transform itself is written on the next frame: a drag or a
// trackpad flick delivers events faster than the screen refreshes, and writing
// a transform per event on a drawing this size is what makes it feel heavy.
let panFrame = null;
function panBy(dx, dy) {
  panX += dx;
  panY += dy;
  clampPan();
  if (panFrame !== null) return;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  panFrame = schedule(() => {
    panFrame = null;
    applyPanTransform();
    updateScrollbars();
  });
}

// Held while a gesture is in flight so the compositor keeps the drawing on its
// own layer and a pan is a move rather than a repaint of every path.
let panIdleTimer = null;
function markPanActive() {
  svgContainer.style.willChange = 'transform';
  if (panIdleTimer !== null) clearTimeout(panIdleTimer);
  panIdleTimer = setTimeout(() => {
    panIdleTimer = null;
    svgContainer.style.removeProperty('will-change');
  }, 400);
}

function updateScrollbars() {
  if (!scrollbarX || !scrollbarY) return;
  const range = panRange();
  if (!range) {
    scrollbarX.hidden = true;
    scrollbarY.hidden = true;
    return;
  }
  layoutScrollbar(scrollbarX, scrollThumbX, 'width', 'left',
    range.view.width - 12, range.view.width, range.content.width, range.maxX - panX, range.travelX);
  layoutScrollbar(scrollbarY, scrollThumbY, 'height', 'top',
    range.view.height - 12, range.view.height, range.content.height, range.maxY - panY, range.travelY);
}

// `offset` is how far the drawing has been pulled away from its furthest
// top-left position, and `travel` is how far it can go — the same pair a real
// scrollbar is built from, just measured off the pan.
//
// A drawing smaller than the window has travel too — the margin it can be
// nudged about in — but a bar for that says "there is more over there" when
// there is not, so the test is whether the drawing overflows the window.
function layoutScrollbar(bar, thumb, sizeProp, posProp, track, view, content, offset, travel) {
  if (!(content - view > 0.5) || !(travel > 0.5) || !(track > 0)) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const length = Math.max(MIN_THUMB, Math.min(track, track * (track / content)));
  const position = travel > 0 ? (offset / travel) * (track - length) : 0;
  thumb.style[sizeProp] = `${length}px`;
  thumb.style[posProp] = `${Math.min(track - length, Math.max(0, position))}px`;
  thumb.setAttribute('aria-valuemin', '0');
  thumb.setAttribute('aria-valuemax', '100');
  thumb.setAttribute('aria-valuenow', String(Math.round(travel > 0 ? (offset / travel) * 100 : 0)));
}

// Dragging a thumb, and clicking the track to jump. Both work in the pan's own
// units: a thumb moved by one pixel of its track moves the drawing by however
// much of it that pixel stands for.
function bindScrollbar(bar, thumb, axis) {
  if (!bar || !thumb) return;
  let dragging = null;

  const trackLength = () => (axis === 'x' ? bar.clientWidth : bar.clientHeight)
    || ((axis === 'x' ? viewportEl.getBoundingClientRect().width : viewportEl.getBoundingClientRect().height) - 12);
  const thumbLength = () => parseFloat(axis === 'x' ? thumb.style.width : thumb.style.height) || MIN_THUMB;

  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = { at: axis === 'x' ? e.clientX : e.clientY, panAt: axis === 'x' ? panX : panY };
    bar.classList.add('active');
    markPanActive();
  });

  bar.addEventListener('mousedown', (e) => {
    if (e.target === thumb) return;
    e.preventDefault();
    e.stopPropagation();
    const range = panRange();
    if (!range) return;
    const travel = axis === 'x' ? range.travelX : range.travelY;
    const rect = bar.getBoundingClientRect();
    const at = axis === 'x' ? e.clientX - rect.left : e.clientY - rect.top;
    const room = trackLength() - thumbLength();
    if (!(room > 0) || !(travel > 0)) return;
    const wanted = Math.min(1, Math.max(0, (at - thumbLength() / 2) / room));
    const target = (axis === 'x' ? range.maxX : range.maxY) - wanted * travel;
    panBy(axis === 'x' ? target - panX : 0, axis === 'x' ? 0 : target - panY);
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const range = panRange();
    if (!range) return;
    const travel = axis === 'x' ? range.travelX : range.travelY;
    const room = trackLength() - thumbLength();
    if (!(room > 0) || !(travel > 0)) return;
    const moved = (axis === 'x' ? e.clientX : e.clientY) - dragging.at;
    const target = dragging.panAt - (moved / room) * travel;
    markPanActive();
    panBy(axis === 'x' ? target - panX : 0, axis === 'x' ? 0 : target - panY);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = null;
    bar.classList.remove('active');
  });
}

bindScrollbar(scrollbarX, scrollThumbX, 'x');
bindScrollbar(scrollbarY, scrollThumbY, 'y');

// A narrower window means less room to scroll through, and a drawing that was
// wholly on screen may no longer be.
window.addEventListener('resize', () => {
  if (!svgContainer.querySelector('svg')) return;
  clampPan();
  applyPanTransform();
  updateScrollbars();
});

// Arrow keys pan, the page keys pan a screenful, Home goes back to the corner.
// The canvas has to be focused for this, which is what its tabindex is for.
viewportEl.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const view = viewportEl.getBoundingClientRect();
  const step = e.shiftKey ? 240 : 60;
  const range = panRange();
  let dx = 0, dy = 0;
  switch (e.key) {
    case 'ArrowLeft': dx = step; break;
    case 'ArrowRight': dx = -step; break;
    case 'ArrowUp': dy = step; break;
    case 'ArrowDown': dy = -step; break;
    case 'PageUp': dy = view.height * 0.9; break;
    case 'PageDown': dy = -view.height * 0.9; break;
    case 'Home': if (range) { dx = range.maxX - panX; dy = range.maxY - panY; } break;
    case 'End': if (range) { dx = range.minX - panX; dy = range.minY - panY; } break;
    default: return;
  }
  e.preventDefault();
  markPanActive();
  panBy(dx, dy);
});

viewportEl.addEventListener('mousedown', (e) => {
  if (penActive && e.button === 0) {
    e.preventDefault();
    penMouseDown(e);
    return;
  }
  // A press on a selected shape, or on one of its handles, drags the shape.
  // Anywhere else is the canvas, and the canvas pans.
  if (beginShapeDrag(e)) {
    e.preventDefault();
    return;
  }
  if (e.button === 0 || e.button === 1) {
    // The canvas takes focus so the arrow keys pan the drawing the user just
    // put their hand on rather than whichever panel was last clicked.
    viewportEl.focus?.({ preventScroll: true });
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    viewportEl.style.cursor = 'grabbing';
    markPanActive();
  }
});

window.addEventListener('mousemove', (e) => {
  if (penActive) penMouseMove(e);
  if (shapeDrag) {
    queueShapeDrag(e);
    return;
  }
  if (!isPanning) return;
  // Anchored to where the press was, so a drag that runs into the edge and
  // comes back lands where the hand says rather than where the clamp left it.
  markPanActive();
  panBy((e.clientX - panStartX) - panX, (e.clientY - panStartY) - panY);
});

window.addEventListener('mouseup', () => {
  if (penActive) penMouseUp();
  if (shapeDrag) endShapeDrag();
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

// Client pixels → the SVG's own user units. Everything drawn as an overlay on
// the page lives in these, so this is the step that has to be right; turning
// them into page inches afterwards is only arithmetic.
function clientToUserUnits(clientX, clientY) {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return null;

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

  return { x: ux, y: uy };
}

function clientToPageUnits(clientX, clientY) {
  const page = getCurrentPage();
  const local = clientToUserUnits(clientX, clientY);
  if (!page || !local) return null;
  const dpi = getPageDpi(page);
  return { x: local.x / dpi, y: page.height - local.y / dpi };
}

// ---------------------------------------------------------------------------
// Dragging shapes: move, resize, rotate
//
// Until now the drawing could only be edited through dialogs and the XML
// editor — you could say where a shape belonged but not push it there, and a
// press on a shape panned the canvas instead. Pressing a *selected* shape now
// drags it, and the selected shape carries eight resize handles and a rotation
// grip.
//
// What is dragged is an outline, not the drawing. The shape itself is not
// touched until the mouse comes up, at which point the edit goes through the
// package like every other one — so a drag is one durable edit rather than a
// hundred, and it survives Save Visio. Visio's own drag preview is an outline
// too, for the same reason.
//
// The maths is all in src/shape-arrange.js: the planners answer "what cells
// would put the shape there", and they answer it for a shape nested three
// groups deep just as readily as for one on the page.
// ---------------------------------------------------------------------------

let shapeDrag = null;
let suppressNextCanvasClick = false;

// A press has to travel a little before it is a drag: without this, the tiny
// movement between pressing and releasing a mouse button would rewrite the file
// every time anyone selected anything.
const DRAG_SLOP_PX = 3;

function movableSelectionIds() {
  const shapes = getCurrentPage()?.shapes || [];
  return [...selectedShapeIds].filter(id => findShapeById(shapes, id));
}

function clearDragPreview() {
  svgContainer.querySelector('#shape-drag-preview')?.remove();
}

// The outline, drawn last so nothing can cover it, as a closed polygon through
// the four corners the shape is about to have.
function drawDragPreview(outlines) {
  clearDragPreview();
  const svg = svgContainer.querySelector('svg');
  const page = getCurrentPage();
  if (!svg || !page || !outlines?.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const unit = unitsPerDevicePixel(page);
  const layer = document.createElementNS(ns, 'g');
  layer.setAttribute('id', 'shape-drag-preview');
  layer.setAttribute('pointer-events', 'none');
  for (const corners of outlines) {
    if (!corners?.length) continue;
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', corners.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('fill', '#e94560');
    poly.setAttribute('fill-opacity', '0.10');
    poly.setAttribute('stroke', '#e94560');
    poly.setAttribute('stroke-width', String(unit * 1.5));
    poly.setAttribute('stroke-dasharray', `${unit * 4} ${unit * 3}`);
    layer.appendChild(poly);
  }
  svg.appendChild(layer);
}

function beginShapeDrag(e) {
  if (penActive || !currentPackageEditable || e.button !== 0) return false;
  const page = getCurrentPage();
  const start = page ? clientToPageUnits(e.clientX, e.clientY) : null;
  if (!start) return false;

  const handleEl = e.target?.closest?.('[data-handle]');
  if (handleEl) {
    const handle = handleEl.getAttribute('data-handle');
    const id = handleEl.getAttribute('data-handle-shape');
    if (!findShapeById(page.shapes || [], id)) return false;
    shapeDrag = {
      kind: handle === 'rotate' ? 'rotate' : 'resize',
      handle, ids: [String(id)], start, index: buildShapeIndex(page, pageShapeBoxes(page)),
      clientX: e.clientX, clientY: e.clientY, moved: false, plan: null
    };
    return true;
  }

  // Modifier-clicks are for building a selection; the click handler owns those,
  // and taking the press to mean "drag" would fight it.
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
  const group = e.target?.closest?.('g[data-shape-id]');
  const id = group?.getAttribute('data-shape-id');
  // Shapes drawn from the background page belong to another page and are not
  // this page's to move — the same rule the layer list and Delete both follow.
  if (!id || !findShapeById(page.shapes || [], id)) return false;
  // Pressing something not yet selected selects it first, so a shape can be
  // grabbed and moved in one gesture rather than needing a click to arm it.
  if (!isShapeSelected(id)) setSelectedShape(id);

  shapeDrag = {
    // The page is flattened once here rather than on every mouse move. Nothing
    // in the model changes until the drag is let go, so the index that says
    // where everything is stays true for the whole gesture — and rebuilding it
    // per move was 39 ms of arithmetic per event on a drawing of 8,470 shapes,
    // which is what made dragging drop frames.
    kind: 'move', handle: null, ids: movableSelectionIds(), start, index: buildShapeIndex(page, pageShapeBoxes(page)),
    clientX: e.clientX, clientY: e.clientY, moved: false, plan: null
  };
  return true;
}

// Pointers report far faster than the screen redraws — a 1000 Hz mouse is 16
// moves per frame — and planning for a position that is already stale is work
// thrown away. So a move only records where the pointer is, and the planning
// happens once, on the frame, with wherever it ended up.
let shapeDragFrame = null;
let shapeDragPending = null;

function queueShapeDrag(e) {
  shapeDragPending = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
  if (shapeDragFrame !== null) return;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
  shapeDragFrame = schedule(() => {
    shapeDragFrame = null;
    flushShapeDrag();
  });
}

function flushShapeDrag() {
  const at = shapeDragPending;
  shapeDragPending = null;
  if (at && shapeDrag) updateShapeDrag(at);
}

function updateShapeDrag(e) {
  if (!shapeDrag) return;
  if (!shapeDrag.moved) {
    if (Math.hypot(e.clientX - shapeDrag.clientX, e.clientY - shapeDrag.clientY) < DRAG_SLOP_PX) return;
    shapeDrag.moved = true;
  }
  const page = getCurrentPage();
  const at = page ? clientToPageUnits(e.clientX, e.clientY) : null;
  if (!at) return;

  try {
    const index = shapeDrag.index;
    if (shapeDrag.kind === 'move') {
      shapeDrag.plan = planMoveShapes(page, shapeDrag.ids, at.x - shapeDrag.start.x, at.y - shapeDrag.start.y, { index });
      drawDragPreview(shapeDrag.plan.map(item => item.preview));
    } else if (shapeDrag.kind === 'resize') {
      const plan = planResizeShape(page, shapeDrag.ids[0], shapeDrag.handle, at.x, at.y,
        { keepAspect: e.shiftKey, index });
      shapeDrag.plan = [{ id: plan.id, cells: plan.cells }, ...plan.children];
      drawDragPreview([plan.preview]);
    } else {
      shapeDrag.plan = planRotateShapes(page, shapeDrag.ids,
        rotationFromPointer(page, shapeDrag, at, e.shiftKey), { index });
      drawDragPreview(shapeDrag.plan.map(item => item.preview));
    }
    shapeDrag.error = null;
  } catch (err) {
    // A drag that cannot be expressed (a connector, a shape that has gone) says
    // so when it is let go rather than throwing on every mouse move.
    shapeDrag.plan = null;
    shapeDrag.error = err;
    clearDragPreview();
  }
}

// How far round the shape's pin the pointer has travelled since the press.
// Shift snaps to 15°, which is what everyone reaches for when they want 90.
function rotationFromPointer(page, drag, at, snap) {
  const entry = drag.index?.get(String(drag.ids[0]))
    || pageShapeBoxes(page).find(candidate => candidate.id === drag.ids[0]);
  if (!entry) return 0;
  const shape = entry.shape;
  const pin = applyMatrix(entry.matrix, (shape.locPinX || 0) * 96,
    ((shape.height || 0) - (shape.locPinY || 0)) * 96);
  const dpi = getPageDpi(page);
  const centre = { x: pin.x / dpi, y: page.height - pin.y / dpi };
  const from = Math.atan2(drag.start.y - centre.y, drag.start.x - centre.x);
  const to = Math.atan2(at.y - centre.y, at.x - centre.x);
  let delta = to - from;
  if (snap) {
    const step = Math.PI / 12;
    delta = Math.round(delta / step) * step;
  }
  return delta;
}

function endShapeDrag() {
  // The last move may still be waiting for its frame, and it is the one that
  // says where the shape was let go — so it is planned now rather than dropped.
  flushShapeDrag();
  const drag = shapeDrag;
  shapeDrag = null;
  if (!drag) return;
  clearDragPreview();
  // A press that never travelled is a click, and a click is a selection.
  if (!drag.moved) return;
  suppressNextCanvasClick = true;
  if (drag.error) {
    showError(drag.error.message);
    return;
  }
  if (!drag.plan?.length) return;

  const label = drag.kind === 'move' ? 'Move' : drag.kind === 'resize' ? 'Resize' : 'Rotate';
  const updates = drag.plan;
  // Letting go of a shape should cost what the shape cost, not what the file
  // costs. The package is rewritten later, if at all.
  if (commitPlacementLocally(updates)) return;
  runArrange(label, async (page, base) => {
    const { buffer } = await transformVsdxShapes(base, page.id, updates);
    return { buffer, select: drag.ids };
  });
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
  // Two tools, one at a time, and the toolbar says which. Select is not a mode
  // with any state of its own — it is what the canvas does when the pen is not
  // holding it — but calling it nothing at all left people looking for it.
  selectButton?.classList.toggle('active', !next);
  if (penBar) penBar.hidden = !next;
  viewportEl.classList.toggle('pen-active', next);
  if (!next) {
    penNodes = [];
    penCursor = null;
    penDrag = null;
    clearPenPreview();
  }
  updatePenBarState();
  // The pen owns the pointer while it is out, so the drag handles step aside
  // rather than competing with it for clicks.
  syncSelectedShapeHighlight();
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

let shapeSearchTimer = null;
shapeSearchInput?.addEventListener('input', () => {
  // Every keystroke re-walks the page's shape tree, so wait for a pause first.
  if (shapeSearchTimer) clearTimeout(shapeSearchTimer);
  shapeSearchTimer = setTimeout(() => {
    shapeSearchTimer = null;
    runShapeSearch(shapeSearchInput.value);
  }, 120);
});
shapeSearchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeLayerObjects();
  } else if (e.key === 'Enter') {
    // Enter takes the top match — the common case is one obvious answer.
    e.preventDefault();
    if (shapeSearchTimer) {
      clearTimeout(shapeSearchTimer);
      shapeSearchTimer = null;
      runShapeSearch(shapeSearchInput.value);
    }
    layerObjectsList?.querySelector('.layer-object-row')?.click();
  }
});

selectButton?.addEventListener('click', () => setPenActive(false));
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
  if (isTypingTarget(e.target)) return;

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
// The buttons zoom about the middle of the window, which is where the thing
// being looked at is. Zooming about the corner instead walks the drawing out of
// the window a step at a time.
function zoomAboutCentre(factor) {
  const view = viewportEl.getBoundingClientRect();
  if (view.width > 0 && view.height > 0) {
    zoomAbout(zoom * factor, view.left + view.width / 2, view.top + view.height / 2);
  } else {
    zoom = Math.max(MIN_ZOOM, Math.min(zoom * factor, MAX_ZOOM));
    updateTransform();
  }
}
document.getElementById('btn-zoom-in').addEventListener('click', () => zoomAboutCentre(1.2));
document.getElementById('btn-zoom-out').addEventListener('click', () => zoomAboutCentre(1 / 1.2));
document.getElementById('btn-zoom-fit').addEventListener('click', () => {
  // Fit means fit, including on a drawing smaller than the window.
  if (!fitToWindow({ magnify: true })) resetView();
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
      baseBuffer: await packageBuffer(),
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
  // Picking a view is a bulk change of what is shown, so it is undoable like
  // any other — on this page, which is the one the undo stack speaks for.
  pushLayerVisibilityUndo();
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
  // Only meaningful for writable OPC/XML packages. The whole section goes, not
  // just its contents: a heading you can open onto nothing is worse than no
  // heading.
  const enabled = currentPackageEditable;
  const viewsSection = layersViews?.closest('.sidebar-section');
  if (viewsSection) viewsSection.style.display = enabled ? '' : 'none';
  else if (layersViews) layersViews.style.display = enabled ? '' : 'none';
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
    const output = await saveVsdxLayerPermissions(await packageBuffer(), currentPages, viewTemplates, layerTagColors, currentLayerTreeSettings());
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
    // Pruning re-parses what it wrote, and the sidebar and tab strip are rebuilt
    // from that — so anything still only in memory has to be in the bytes first.
    // Closed tabs are the visible case: the pages they stood for are only gone
    // once reconciled, and pruning the raw buffer brought every one of them back.
    const { buffer, removedCount } = await saveVsdxWithoutNonSelectedLayers(
      await getPackageBufferWithPendingEdits(),
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
      await getPackageBufferWithPendingEdits(),
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
shapeContextRename?.addEventListener('click', () => {
  // The menu is closed first: renaming re-renders the page under it, and the
  // shape has to be taken before closing clears which one it was.
  const shape = getContextShape();
  closeShapeContextMenu();
  promptRenameShape(shape);
});
shapeArrangeGroup?.addEventListener('click', () => groupSelection());
shapeArrangeUngroup?.addEventListener('click', () => ungroupSelection());
shapeArrangeFront?.addEventListener('click', () => reorderSelection('front'));
shapeArrangeBack?.addEventListener('click', () => reorderSelection('back'));
shapeArrangeDelete?.addEventListener('click', () => deleteSelection());
shapeContextEditXml?.addEventListener('click', () => {
  if (contextShapeId !== null) openShapeXmlEditor(contextShapeId);
});
// Filing a shape onto a layer that does not exist yet is the common case right
// after drawing one, so the layer list can grow a layer instead of only listing
// them.
shapeContextNewLayer?.addEventListener('click', () => {
  const shape = getContextShape();
  const layer = promptForNewLayer();
  if (layer && shape) assignShapeToLayer(shape.id, layer.index);
  else if (layer) renderShapeContextMenu();
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
// Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y too) take back the last change to what is
// shown. Inside a text box the browser's own undo is the right one, and while
// drawing Backspace already owns "take that point back", so neither is touched.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const tag = e.target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (shapeXmlModal.classList.contains('visible')) return;
  if (exportModal.classList.contains('visible')) return;

  const key = e.key.toLowerCase();
  const undo = key === 'z' && !e.shiftKey;
  const redo = (key === 'z' && e.shiftKey) || key === 'y';
  if (!undo && !redo) return;

  e.preventDefault();
  if (!stepLayerVisibilityHistory(undo)) {
    showError(undo ? 'Nothing to undo on this page' : 'Nothing to redo on this page');
  }
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && layerMatrixModal.classList.contains('visible')) {
    e.preventDefault();
    layerMatrixSearch.focus();
    layerMatrixSearch.select();
    return;
  }
  if (e.key === 'Escape' && exportModal.classList.contains('visible')) {
    closeExportDialog();
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

  // Delete what is selected. Backspace does it too, since that is the key half
  // of everyone reaches for — but not while the pen tool owns it for taking
  // back the last node, and not while a modal is up, where the selection behind
  // it is not what the user is looking at.
  if ((e.key === 'Delete' || e.key === 'Backspace') && !penActive && !isTypingTarget(e.target)) {
    if (layerMatrixModal.classList.contains('visible') || shapeXmlModal.classList.contains('visible')) return;
    if (exportModal.classList.contains('visible')) return;
    if (!selectedShapeIds.size || !currentPackageEditable) return;
    e.preventDefault();
    deleteSelection();
  }
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
layersAdd?.addEventListener('click', () => promptForNewLayer());

layerTreeEnable?.addEventListener('change', () => setLayerTreeEnabled(layerTreeEnable.checked));
// An empty box means no delimiter, which is simply flat again rather than an
// error, so it needs no validation beyond taking the text as typed.
layerTreeDelimiterInput?.addEventListener('input', () => setLayerTreeDelimiter(layerTreeDelimiterInput.value));
layerTreeToggleAll?.addEventListener('click', toggleAllLayerGroups);
document.getElementById('layer-tree-collapse-others')?.addEventListener('click', collapseUnfocusedLayerGroups);
document.getElementById('shape-tree-collapse-all')?.addEventListener('click', () => setShapeTreeFolding('all'));
document.getElementById('shape-tree-expand-all')?.addEventListener('click', () => setShapeTreeFolding('expand'));
document.getElementById('shape-tree-collapse-others')?.addEventListener('click', () => setShapeTreeFolding('others'));

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

// ---------------------------------------------------------------------------
// Export
//
// The rendered SVG is sized for the viewport (width/height="100%") and its
// viewBox is in renderer px, 96 to the inch. A large drawing is therefore tens
// of thousands of units across with no intrinsic size at all, which is exactly
// what tips browsers, Inkscape and PDF viewers over. The dialog lets you stamp
// a sane intrinsic size on the way out — a pure metadata change, the viewBox is
// never touched — or keep the original if you know what you are doing.
// ---------------------------------------------------------------------------

let exportSizeMode = null;      // null until the first open picks a default
let exportCustomValue = PDF_MAX_PX;
let pdfLibrariesReady = false;

// The SVG as it should leave the app: no live editing scaffolding, and an
// intrinsic size honouring the chosen scale.
function buildExportSvg(size) {
  const svg = svgContainer.querySelector('svg');
  if (!svg) return null;
  // The pen's live overlay (anchors, handles, rubber band) lives inside the
  // rendered SVG; it is scaffolding, not part of the drawing.
  const exported = svg.cloneNode(true);
  exported.querySelector('#pen-preview')?.remove();
  exported.querySelector('#shape-highlight')?.remove();
  exported.querySelector('#shape-selection')?.remove();
  exported.querySelector('#shape-drag-preview')?.remove();
  // The canvas is rendered without the Visio property blocks, for speed. A file
  // is not, so they go back on here — from the model the canvas was drawn from,
  // matched to the shapes by id.
  const page = getComposedPage();
  if (page) attachVisioMetadata(exported, page);
  groupExportedSvgByLayer(exported);
  return applyExportSize(exported, size);
}

// Visio layers are a cell on each shape; SVG has no layers at all and Inkscape
// reads them off a container. Regrouping on the way out is what makes the
// exported file's layers switchable in the editor the user opens it in — and
// src/svg-layers.js only does it where the drawing's stacking survives it,
// which is what the shape boxes are for.
function groupExportedSvgByLayer(exported) {
  const page = currentPages[currentPageIndex];
  if (!page) return null;
  const bounds = new Map();
  for (const entry of pageShapeBoxes(page)) {
    if (entry.depth === 0) bounds.set(String(entry.id), entry.bounds);
  }
  try {
    return groupSvgShapesByLayer(exported, page, { bounds });
  } catch (e) {
    console.error('Could not group the exported SVG into layers:', e);
    return null;
  }
}

function currentExportSize() {
  const svg = svgContainer.querySelector('svg');
  const { width, height } = svgViewBoxSize(svg);
  return computeExportSize(width, height, exportSizeMode || 'original', { customPx: exportCustomValue });
}

function exportBaseName() {
  return (fileName.textContent || 'diagram').replace(/\.[^.]+$/i, '');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function setExportStatus(text, kind = '') {
  exportStatus.textContent = text;
  exportStatus.className = 'export-status' + (kind ? ' ' + kind : '');
}

async function exportSvgFile(size) {
  const exported = buildExportSvg(size);
  if (!exported) return;
  let svgStr = new XMLSerializer().serializeToString(exported);
  if (exportEmbed.checked) {
    try {
      if (currentFileBuffer) {
        // Embed what "Save Visio" would produce, so layer edits and named views
        // round-trip too.
        const base = await packageBuffer();
        const source = currentPackageEditable
          ? await saveVsdxLayerPermissions(base, currentPages, viewTemplates, layerTagColors, currentLayerTreeSettings())
          : base;
        svgStr = embedVsdxInSvg(svgStr, source, fileName.textContent || 'diagram.vsdx', {
          pageId: currentPages[currentPageIndex]?.id
        });
      }
    } catch (e) {
      console.error('Failed to embed VSDX metadata in SVG, exporting plain SVG:', e);
    }
  }
  downloadBlob(new Blob([svgStr], { type: 'image/svg+xml' }), exportBaseName() + '.svg');
}

async function exportPdfFile(size) {
  if (!exportPdfConsent.checked) {
    setExportStatus('Tick "Allow this download" to let PDF export fetch its libraries.', 'error');
    return false;
  }
  await loadPdfLibraries({
    scope: window,
    onProgress: (msg) => setExportStatus(msg, 'busy'),
  });
  pdfLibrariesReady = true;

  const exported = buildExportSvg(size);
  if (!exported) return false;
  // svg2pdf resolves styles and measures text through getComputedStyle/getBBox,
  // which only answer for an element that is actually in the document — so the
  // clone is parked off-screen rather than converted detached.
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = 'position:absolute;left:-100000px;top:0;width:1px;height:1px;overflow:hidden';
  stage.appendChild(exported);
  document.body.appendChild(stage);
  try {
    setExportStatus('Rendering PDF…', 'busy');
    const blob = await svgToPdfBlob(exported, { widthPt: size.widthPt, heightPt: size.heightPt, scope: window });
    downloadBlob(blob, exportBaseName() + '.pdf');
  } finally {
    stage.remove();
  }
  return true;
}

function renderPdfGate() {
  const isPdf = exportFormat.value === 'pdf';
  exportPdfGate.hidden = !isPdf || pdfLibrariesReady;
  exportEmbedRow.hidden = isPdf;
  if (!exportPdfLibs.childElementCount) {
    for (const lib of PINNED_LIBS) {
      const li = document.createElement('li');
      li.textContent = `${lib.name} ${lib.version} — ${new URL(lib.url).host}`;
      const code = document.createElement('code');
      code.textContent = 'sha256 ' + lib.sha256;
      li.appendChild(code);
      exportPdfLibs.appendChild(li);
    }
  }
}

function updateExportSummary() {
  const size = currentExportSize();
  exportSummary.textContent = describeExportSize(size);
  exportCustomRow.hidden = exportSizeMode !== 'custom';
  const overPdf = exportFormat.value === 'pdf' && size.exceedsPdfLimit;
  exportRun.disabled = !size.sourceWidth || overPdf;
  if (overPdf) {
    setExportStatus('A PDF page cannot exceed 200in (14400pt) per side — pick a smaller size.', 'error');
  } else if (!exportStatus.classList.contains('busy')) {
    setExportStatus('');
  }
  renderPdfGate();
}

function openExportDialog() {
  const svg = svgContainer.querySelector('svg');
  if (!svg) {
    showError('Open a drawing before exporting');
    return;
  }
  if (!exportSize.childElementCount) {
    for (const mode of EXPORT_SIZE_MODES) {
      const opt = document.createElement('option');
      opt.value = mode.id;
      opt.textContent = mode.label;
      exportSize.appendChild(opt);
    }
  }
  if (exportSizeMode === null) {
    // Don't silently shrink a drawing that was fine as it was — but don't hand
    // someone a PDF the format cannot represent, either.
    const { width, height } = svgViewBoxSize(svg);
    exportSizeMode = defaultSizeMode(width, height);
  }
  exportSize.value = exportSizeMode;
  exportCustomPx.value = String(Math.round(exportCustomValue));
  setExportStatus('');
  updateExportSummary();
  exportModal.classList.add('visible');
  exportFormat.focus();
}

function closeExportDialog() {
  exportModal.classList.remove('visible');
}

document.getElementById('btn-export').addEventListener('click', openExportDialog);
exportClose.addEventListener('click', closeExportDialog);
exportCancel.addEventListener('click', closeExportDialog);
exportModal.addEventListener('click', (e) => { if (e.target === exportModal) closeExportDialog(); });
exportFormat.addEventListener('change', updateExportSummary);
exportSize.addEventListener('change', () => {
  exportSizeMode = exportSize.value;
  updateExportSummary();
});
exportCustomPx.addEventListener('input', () => {
  const value = Number(exportCustomPx.value);
  if (Number.isFinite(value) && value > 0) exportCustomValue = value;
  updateExportSummary();
});
exportPdfConsent.addEventListener('change', updateExportSummary);

exportRun.addEventListener('click', async () => {
  const size = currentExportSize();
  if (!size.sourceWidth) return;
  exportRun.disabled = true;
  try {
    if (exportFormat.value === 'pdf') {
      if (!await exportPdfFile(size)) return;
    } else {
      await exportSvgFile(size);
    }
    closeExportDialog();
  } catch (e) {
    console.error('Export failed:', e);
    setExportStatus(e?.message || String(e), 'error');
  } finally {
    exportRun.disabled = false;
    renderPdfGate();
  }
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
