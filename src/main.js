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

let currentPages = [];
let currentPageIndex = 0;
let zoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let panStartX, panStartY;
let hiddenLayers = new Set();

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

  // Render background page first if referenced
  if (page.backPage) {
    const bgPage = currentPages.find(p => p.id === page.backPage);
    if (bgPage) {
      // Merge background shapes into current page for rendering
      const merged = { ...page, shapes: [...bgPage.shapes, ...page.shapes] };
      renderPage(merged, svgContainer);
      return;
    }
  }

  renderPage(page, svgContainer);
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
      hiddenLayers = new Set();
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

  for (const layer of layers) {
    const item = document.createElement('div');
    item.className = 'layer-item';
    if (hiddenLayers.has(layer.index)) item.classList.add('disabled');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hiddenLayers.has(layer.index);
    checkbox.id = `layer-cb-${layer.index}`;

    const label = document.createElement('label');
    label.textContent = layer.name;
    label.setAttribute('for', checkbox.id);
    label.title = layer.name;

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        hiddenLayers.delete(layer.index);
        item.classList.remove('disabled');
      } else {
        hiddenLayers.add(layer.index);
        item.classList.add('disabled');
      }
      applyLayerVisibility();
    });

    item.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });

    item.appendChild(checkbox);
    item.appendChild(label);
    layersList.appendChild(item);
  }
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
    hiddenLayers = new Set();
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
