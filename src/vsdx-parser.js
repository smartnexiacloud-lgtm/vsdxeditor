import JSZip from 'jszip';
import { inheritFromMaster, resolveFields } from './shape-inheritance.js';
import { renderPage } from './svg-renderer.js';

const VISIO_MAIN_NS = 'http://schemas.microsoft.com/office/visio/2012/main';

// MS-VSDX color table (indices 0-23). Values above 23 are resolved through
// visio/document.xml <Colors><ColorEntry .../></Colors>.
const VISIO_COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
  '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000',
  '#800080', '#008080', '#C0C0C0', '#E6E6E6', '#CDCDCD', '#B3B3B3',
  '#9A9A9A', '#808080', '#666666', '#4D4D4D', '#333333', '#1A1A1A'
];

const QUICKSTYLE_COLOR_MAP = {
  0: 'dk1',
  1: 'lt1',
  2: 'dk2',
  3: 'lt2',
  4: 'accent1',
  5: 'accent2',
  6: 'accent3',
  7: 'accent4',
  8: 'accent5',
  9: 'accent6',
  100: 'dk1',
  101: 'lt1',
  102: 'dk2',
  103: 'accent1',
  104: 'accent2',
  105: 'accent3',
  106: 'accent4',
  107: 'accent5',
  108: 'accent6'
};

const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  if (typeof btoa === 'function') return btoa(binary);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  throw new Error('No base64 encoder available');
}

function imageToDataUri(bytes, filename) {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  const mime = IMAGE_MIME_TYPES[ext] || 'image/png';
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function parseColor(value, colorPalette = null) {
  if (!value && value !== 0) return null;
  const s = String(value).trim();
  if (!s || s === 'Themed') return null;
  if (s.startsWith('#')) return s;
  if (s.includes(',')) {
    const parts = s.split(',').map(Number);
    if (parts.length >= 3) {
      return '#' + parts.slice(0, 3).map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    }
  }
  const idx = parseInt(s, 10);
  if (!isNaN(idx)) {
    if (colorPalette?.has(idx)) return colorPalette.get(idx);
    if (idx >= 0 && idx < VISIO_COLORS.length) return VISIO_COLORS[idx];
  }
  return null;
}

function isBlack(color) {
  return !!color && color.toUpperCase() === '#000000';
}

function isLightColor(color) {
  if (!color || !/^#[0-9A-F]{6}$/i.test(color)) return false;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance >= 0.7;
}

function getCellFormula(el, name) {
  const cell = getCell(el, name);
  if (!cell) return null;
  const f = cell.getAttribute('F');
  return f !== null && f !== '' ? f : null;
}

function getCellData(el, name) {
  const cell = getCell(el, name);
  if (!cell) return null;
  return {
    value: getCellValue(el, name),
    formula: getCellFormula(el, name)
  };
}

function resolveQuickStyleColor(value, themeColors) {
  if (!themeColors || !value && value !== 0) return null;
  const n = parseInt(String(value), 10);
  if (isNaN(n)) return null;
  const name = QUICKSTYLE_COLOR_MAP[n];
  return name ? (themeColors[name] || null) : null;
}

function extractThemeToken(formula) {
  if (!formula) return null;
  const match = formula.match(/THEMEVAL\s*\(\s*"?([A-Za-z0-9_]+)"?/i);
  if (match) return match[1];
  const numeric = formula.match(/THEMEVAL\s*\(\s*(\d+)/i);
  return numeric ? numeric[1] : null;
}

function resolveThemedColor(cellData, inheritedCellData, themeColors, options = {}) {
  const value = parseColor(cellData?.value, options.colorPalette);
  const inheritedValue = parseColor(inheritedCellData?.value, options.colorPalette);
  const formula = cellData?.formula || inheritedCellData?.formula || '';
  const token = extractThemeToken(formula);
  const quickStyleColor = resolveQuickStyleColor(options.quickStyle, themeColors);

  if (token && themeColors) {
    if (token === 'FillColor' || token === 'FillColor2' || token === 'LineColor') {
      if (quickStyleColor) return quickStyleColor;
      if (token === 'LineColor') return themeColors.dk1 || value || inheritedValue || '#000000';
      return themeColors.accent1 || value || inheritedValue || null;
    }
    if (themeColors[token]) return themeColors[token];
  }

  if ((formula === 'Inh' || /THEME/i.test(formula)) && themeColors) {
    if (options.role === 'line') return themeColors.dk1 || value || inheritedValue || '#000000';
    if (options.role === 'font') return value || inheritedValue || themeColors.dk1 || '#000000';
    if (quickStyleColor) return quickStyleColor;
  }

  if (value) return value;
  if (quickStyleColor) return quickStyleColor;
  if (inheritedValue) return inheritedValue;
  return null;
}

function parseThemeColors(themeDoc) {
  const themeColors = {};
  const clrScheme = byTag(themeDoc, 'clrScheme')[0];
  if (!clrScheme) return themeColors;
  const names = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  for (const name of names) {
    const el = getDirectChildren(clrScheme, name)[0];
    if (!el) continue;
    const srgb = getDirectChildren(el, 'srgbClr')[0];
    const sysClr = getDirectChildren(el, 'sysClr')[0];
    if (srgb) {
      const val = srgb.getAttribute('val');
      if (val) themeColors[name] = `#${val}`;
    } else if (sysClr) {
      const val = sysClr.getAttribute('lastClr') || sysClr.getAttribute('val');
      if (val && val.length === 6) themeColors[name] = `#${val}`;
    }
  }
  const indexMap = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  indexMap.forEach((name, index) => {
    if (themeColors[name]) themeColors[String(index)] = themeColors[name];
  });
  return themeColors;
}

function parseDocumentColors(documentDoc) {
  const colors = new Map();
  for (let i = 0; i < VISIO_COLORS.length; i++) {
    colors.set(i, VISIO_COLORS[i]);
  }

  const colorEntries = byTag(documentDoc, 'ColorEntry');
  for (const entry of colorEntries) {
    const ix = parseInt(entry.getAttribute('IX') || '', 10);
    const rgb = entry.getAttribute('RGB');
    if (!Number.isNaN(ix) && rgb && /^#[0-9A-F]{6}$/i.test(rgb)) {
      colors.set(ix, rgb);
    }
  }
  return colors;
}

function parseStyleSheets(documentDoc) {
  const styles = new Map();
  for (const styleEl of byTag(documentDoc, 'StyleSheet')) {
    const id = styleEl.getAttribute('ID');
    if (!id) continue;
    styles.set(id, {
      id,
      lineStyle: styleEl.getAttribute('LineStyle'),
      fillStyle: styleEl.getAttribute('FillStyle'),
      textStyle: styleEl.getAttribute('TextStyle'),
      el: styleEl
    });
  }
  return styles;
}

function resolveStyleCellData(styles, styleId, cellName, styleKind, seen = new Set()) {
  if (!styles || !styleId || seen.has(styleId)) return null;
  seen.add(styleId);

  const style = styles.get(String(styleId));
  if (!style) return null;

  const data = getCellData(style.el, cellName);
  if (data && data.formula !== 'Inh') return data;

  const parentId = styleKind === 'line' ? style.lineStyle
    : styleKind === 'fill' ? style.fillStyle
      : style.textStyle;
  return resolveStyleCellData(styles, parentId, cellName, styleKind, seen);
}

function styleCellFloat(styles, styleId, cellName, styleKind) {
  const data = resolveStyleCellData(styles, styleId, cellName, styleKind);
  if (!data || data.value === null || data.value === undefined) return null;
  const n = parseFloat(data.value);
  return Number.isNaN(n) ? null : n;
}

// Character/Paragraph defaults live in a stylesheet's Section rather than in a
// plain Cell, so resolveStyleCellData can't see them. Walk the TextStyle chain
// looking at row IX=0 of the named section. This is where Visio keeps the
// document-wide defaults (e.g. "No Style" carries Size=12pt, HorzAlign=1).
function resolveStyleSectionCell(styles, styleId, sectionName, cellName, seen = new Set()) {
  if (!styles || !styleId || seen.has(String(styleId))) return null;
  seen.add(String(styleId));

  const style = styles.get(String(styleId));
  if (!style) return null;

  const section = getDirectChildren(style.el, 'Section')
    .find(s => s.getAttribute('N') === sectionName);
  if (section) {
    const row = getDirectChildren(section, 'Row')[0];
    if (row) {
      const value = getCellValue(row, cellName);
      if (value !== null) return value;
    }
  }
  return resolveStyleSectionCell(styles, style.textStyle, sectionName, cellName, seen);
}

function styleSectionFloat(styles, styleId, sectionName, cellName) {
  const value = resolveStyleSectionCell(styles, styleId, sectionName, cellName);
  if (value === null) return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function parseXml(text) {
  const parser = new DOMParser();
  return parser.parseFromString(text, 'application/xml');
}

// Use namespace-aware lookups since vsdx XML uses default namespace
function byTag(el, tag) {
  return el.getElementsByTagNameNS('*', tag);
}

function getCell(el, name) {
  if (!el) return null;
  // Only search direct Cell children to avoid picking up cells from nested shapes
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === 1 && child.localName === 'Cell' && child.getAttribute('N') === name) {
      return child;
    }
  }
  return null;
}

function getCellValue(el, name) {
  const cell = getCell(el, name);
  if (!cell) return null;
  // The V attribute holds the resolved value Visio has computed for this cell,
  // regardless of whether F is a formula or the sentinel "Inh" (inherited).
  // Previously we skipped F='Inh' and fell back to the master, but the V value
  // already reflects the inherited/computed value, so the master lookup would
  // pick up the unrelated master-template value instead.
  const v = cell.getAttribute('V');
  if (v !== null && v !== '') return v;
  return null;
}

function getCellAttr(el, name, attr) {
  const cell = getCell(el, name);
  if (!cell) return null;
  const value = cell.getAttribute(attr);
  return value !== null && value !== '' ? value : null;
}

function getCellFloat(el, name) {
  const v = getCellValue(el, name);
  if (v === null || v === undefined) return null;
  const f = parseFloat(v);
  return isNaN(f) ? null : f;
}

function getDirectChildren(el, tagName) {
  const result = [];
  if (!el) return result;
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === 1 && child.localName === tagName) {
      result.push(child);
    }
  }
  return result;
}

// Serialize a <Text> element's children into a string with U+FFFC placeholders
// at every <fld> position. Character/paragraph markers are preserved separately
// as text run metadata so the renderer can emit rich-text <tspan> elements.
// Fields are returned in document order so ctx.fields[i] aligns with the i-th
// placeholder.
function serializeTextWithFields(textEl) {
  let out = '';
  const fields = [];
  const runs = [];
  let currentCp = '0';
  let currentPp = '0';
  function appendRun(text) {
    if (!text) return;
    out += text;
    runs.push({ text, cp: currentCp, pp: currentPp });
  }
  function walk(node) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes[i];
      if (n.nodeType === 3) {
        appendRun(n.nodeValue);
      } else if (n.nodeType === 1) {
        const name = n.localName;
        if (name === 'fld') {
          // <fld IX='N'/> — IX references a Field section row on this shape.
          const ix = n.getAttribute('IX');
          fields.push({ ix: ix != null ? parseInt(ix, 10) : null, _el: n });
          appendRun('\uFFFC');
        } else if (name === 'cp') {
          currentCp = n.getAttribute('IX') || '0';
        } else if (name === 'pp') {
          currentPp = n.getAttribute('IX') || '0';
        } else if (name === 'tp') {
          // Tab properties are formatting-only for now.
        } else {
          walk(n);
        }
        if (n.tail) appendRun(n.tail);
      }
    }
  }
  walk(textEl);
  return { text: out, fields, runs };
}

function getTextContent(shapeEl) {
  const textEls = getDirectChildren(shapeEl, 'Text');
  if (textEls.length === 0) return { text: '', fields: [], runs: [] };
  const { text, fields, runs } = serializeTextWithFields(textEls[0]);
  return {
    text: text.replace(/\n$/, ''),
    fields,
    runs: runs.map(run => ({ ...run, text: run.text.replace(/\n$/, '') })).filter(run => run.text)
  };
}

function valueForVisioMetadata(row, name = 'Value') {
  const v = getCellAttr(row, name, 'V');
  if (v === null || v === undefined) return null;

  const u = getCellAttr(row, name, 'U');
  if (u === 'STR') return `VT4(${v})`;
  if (u) return `VT0(${v}):${u}`;
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(String(v))) return `VT0(${v}):26`;
  return `VT4(${v})`;
}

// Parse a shape's <Section N='Property'> into a name->value map. Names come
// from the row's `N` attribute (e.g. "ShapeClass", "NetworkName") or fall
// back to its IX. Values come from the row's Value cell.
function parsePropSection(shapeEl) {
  const map = {};
  const sections = getDirectChildren(shapeEl, 'Section')
    .filter(s => s.getAttribute('N') === 'Property');
  for (const sec of sections) {
    const rows = getDirectChildren(sec, 'Row');
    for (const row of rows) {
      const n = row.getAttribute('N') || row.getAttribute('IX');
      if (!n) continue;
      const v = getCellValue(row, 'Value');
      if (v !== null && v !== undefined) map[n] = v;
    }
  }
  return map;
}

function parseCustomProps(shapeEl) {
  const props = [];
  const sections = getDirectChildren(shapeEl, 'Section')
    .filter(s => s.getAttribute('N') === 'Property');
  for (const sec of sections) {
    const rows = getDirectChildren(sec, 'Row');
    for (const row of rows) {
      const nameU = row.getAttribute('N') || row.getAttribute('IX');
      if (!nameU) continue;
      props.push({
        nameU,
        label: getCellValue(row, 'Label'),
        prompt: getCellValue(row, 'Prompt'),
        type: getCellValue(row, 'Type'),
        format: getCellValue(row, 'Format'),
        invisible: getCellValue(row, 'Invisible'),
        langID: getCellValue(row, 'LangID'),
        value: valueForVisioMetadata(row)
      });
    }
  }
  return props;
}

function parseUserSection(shapeEl) {
  const map = {};
  const sections = getDirectChildren(shapeEl, 'Section')
    .filter(s => s.getAttribute('N') === 'User');
  for (const sec of sections) {
    const rows = getDirectChildren(sec, 'Row');
    for (const row of rows) {
      const n = row.getAttribute('N') || row.getAttribute('IX');
      if (!n) continue;
      const v = getCellValue(row, 'Value');
      if (v !== null && v !== undefined) map[n] = v;
    }
  }
  return map;
}

function parseUserDefs(shapeEl) {
  const defs = [];
  const sections = getDirectChildren(shapeEl, 'Section')
    .filter(s => s.getAttribute('N') === 'User');
  for (const sec of sections) {
    const rows = getDirectChildren(sec, 'Row');
    for (const row of rows) {
      const nameU = row.getAttribute('N') || row.getAttribute('IX');
      if (!nameU) continue;
      defs.push({
        nameU,
        prompt: getCellValue(row, 'Prompt'),
        value: valueForVisioMetadata(row)
      });
    }
  }
  return defs;
}

function mergeMetadataRows(masterRows, shapeRows) {
  const merged = new Map();
  for (const row of masterRows || []) merged.set(row.nameU, row);
  for (const row of shapeRows || []) merged.set(row.nameU, { ...(merged.get(row.nameU) || {}), ...row });
  return [...merged.values()];
}

// Parse a shape's <Section N='Field'> rows. Each row has Value / Format / Type
// cells; we keep the raw Value and Format strings so the resolver can fall
// back to them when the reference itself is unresolvable. Row IX is the index
// used by <fld IX='N'/>.
function parseFieldSection(shapeEl) {
  const fields = [];
  const sections = getDirectChildren(shapeEl, 'Section')
    .filter(s => s.getAttribute('N') === 'Field');
  for (const sec of sections) {
    const rows = getDirectChildren(sec, 'Row');
    for (const row of rows) {
      const ix = parseInt(row.getAttribute('IX') || '0', 10);
      const value = getCellValue(row, 'Value');
      const format = getCellValue(row, 'Format');
      // The formula on the Value cell is the actual reference (e.g. Prop.Foo).
      const cell = getCell(row, 'Value');
      const ref = cell ? cell.getAttribute('F') : null;
      fields[ix] = { ix, value, format, ref };
    }
  }
  return fields;
}

function parseFillGradientStops(shapeEl, themeColors, colorPalette) {
  const sections = getDirectChildren(shapeEl, 'Section')
    .filter(s => s.getAttribute('N') === 'FillGradientDef');
  if (sections.length === 0) return [];

  const stops = [];
  for (const sec of sections) {
    for (const row of getDirectChildren(sec, 'Row')) {
      const position = getCellFloat(row, 'GradientStopPosition');
      const color = resolveThemedColor(getCellData(row, 'GradientStopColor'), null, themeColors, {
        role: 'fill',
        colorPalette
      }) || parseColor(getCellValue(row, 'GradientStopColor'), colorPalette);
      const transparency = getCellFloat(row, 'GradientStopTransparency') ?? 0;
      if (!color) continue;
      stops.push({
        offset: Math.max(0, Math.min(100, (position ?? 0) * 100)),
        color,
        opacity: Math.max(0, Math.min(1, 1 - transparency))
      });
    }
  }
  return stops.sort((a, b) => a.offset - b.offset);
}

function parseCharacterFormats(shapeEl, themeColors, quickStyleFontColor, colorPalette) {
  const formats = {};
  const charSections = getDirectChildren(shapeEl, 'Section').filter(s => s.getAttribute('N') === 'Character');
  for (const section of charSections) {
    for (const row of getDirectChildren(section, 'Row')) {
      const ix = row.getAttribute('IX') || '0';
      const fontSize = getCellFloat(row, 'Size');
      const fontColor = resolveThemedColor(getCellData(row, 'Color'), null, themeColors, {
        role: 'font',
        quickStyle: quickStyleFontColor,
        colorPalette
      });
      const fontFamily = getCellValue(row, 'Font') || getCellValue(row, 'ComplexScriptFont') || getCellValue(row, 'AsianFont');
      const style = getCellValue(row, 'Style');
      const styleNum = style ? parseInt(style, 10) : 0;
      formats[ix] = {
        fontSize,
        fontColor,
        fontFamily,
        bold: (styleNum & 1) !== 0,
        italic: (styleNum & 2) !== 0,
        underline: (styleNum & 4) !== 0
      };
    }
  }
  return formats;
}

function parseForeignData(shapeEl) {
  const foreignDataEls = getDirectChildren(shapeEl, 'ForeignData');
  if (foreignDataEls.length === 0) return null;
  const foreignData = foreignDataEls[0];
  const relEl = getDirectChildren(foreignData, 'Rel')[0];
  let relId = null;
  if (relEl) {
    relId = relEl.getAttribute('r:id')
      || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      || relEl.getAttribute('id');
  }
  return {
    foreignType: foreignData.getAttribute('ForeignType') || '',
    compressionType: foreignData.getAttribute('CompressionType') || '',
    relId
  };
}

function resolveImageData(foreignData, pageRels, media) {
  if (!foreignData?.relId || !pageRels || !media) return null;
  const target = pageRels[foreignData.relId];
  if (!target) return null;
  const filename = target.split('/').pop();
  if (!filename) return null;
  const mediaEntry = media.get(filename);
  if (!mediaEntry) return null;
  return {
    href: mediaEntry.dataUri,
    filename,
    foreignType: foreignData.foreignType
  };
}

function parseRowData(row) {
  const type = row.getAttribute('T');
  const ix = row.getAttribute('IX');
  const del = row.getAttribute('Del') === '1';
  const x = getCellFloat(row, 'X');
  const y = getCellFloat(row, 'Y');
  const rowData = { type, ix, del, x, y };

  if (type === 'ArcTo') {
    rowData.a = getCellFloat(row, 'A');
  } else if (type === 'EllipticalArcTo' || type === 'RelEllipticalArcTo') {
    rowData.a = getCellFloat(row, 'A');
    rowData.b = getCellFloat(row, 'B');
    rowData.c = getCellFloat(row, 'C');
    rowData.d = getCellFloat(row, 'D');
  } else if (type === 'NURBSTo') {
    rowData.a = getCellFloat(row, 'A');
    rowData.b = getCellFloat(row, 'B');
    rowData.c = getCellFloat(row, 'C');
    rowData.d = getCellFloat(row, 'D');
    rowData.e = getCellValue(row, 'E');
  } else if (type === 'SplineStart') {
    rowData.a = getCellFloat(row, 'A');
    rowData.b = getCellFloat(row, 'B');
    rowData.c = getCellFloat(row, 'C');
    rowData.d = getCellFloat(row, 'D');
  } else if (type === 'SplineKnot') {
    rowData.a = getCellFloat(row, 'A');
  } else if (type === 'PolylineTo') {
    rowData.a = getCellValue(row, 'A');
  } else if (type === 'InfiniteLine') {
    rowData.a = getCellFloat(row, 'A');
    rowData.b = getCellFloat(row, 'B');
  } else if (type === 'Ellipse') {
    rowData.a = getCellFloat(row, 'A');
    rowData.b = getCellFloat(row, 'B');
    rowData.c = getCellFloat(row, 'C');
    rowData.d = getCellFloat(row, 'D');
  } else if (type === 'RelCubBezTo') {
    rowData.a = getCellFloat(row, 'A');
    rowData.b = getCellFloat(row, 'B');
    rowData.c = getCellFloat(row, 'C');
    rowData.d = getCellFloat(row, 'D');
  } else if (type === 'RelQuadBezTo') {
    rowData.a = getCellFloat(row, 'A');
    rowData.b = getCellFloat(row, 'B');
  }

  return rowData;
}

function mergeRowData(masterRow, shapeRow) {
  if (!masterRow) return shapeRow;
  if (!shapeRow) return masterRow;

  const merged = { ...masterRow };
  for (const [key, value] of Object.entries(shapeRow)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  merged.del = shapeRow.del;
  return merged;
}

function parseSectionFlag(value) {
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

// Parse raw geometry sections from a shape element (returns row elements indexed by IX)
function parseGeometryRaw(shapeEl) {
  const sections = [];
  const sectionEls = getDirectChildren(shapeEl, 'Section');
  for (const sec of sectionEls) {
    if (sec.getAttribute('N') !== 'Geometry') continue;
    const ix = sec.getAttribute('IX') || '0';
    const noFill = getCellValue(sec, 'NoFill');
    const noLine = getCellValue(sec, 'NoLine');
    const noShow = getCellValue(sec, 'NoShow');
    const rowMap = new Map();
    const rowEls = getDirectChildren(sec, 'Row');
    for (const row of rowEls) {
      const rowData = parseRowData(row);
      if (rowData.ix) rowMap.set(rowData.ix, rowData);
    }
    sections.push({
      ix,
      rowMap,
      noFill: parseSectionFlag(noFill),
      noLine: parseSectionFlag(noLine),
      noShow: parseSectionFlag(noShow)
    });
  }
  return sections;
}

function hasGeometrySections(shapeEl) {
  if (!shapeEl) return false;
  return getDirectChildren(shapeEl, 'Section').some(sec => sec.getAttribute('N') === 'Geometry');
}

// Merge master geometry with shape geometry (shape overrides master by IX)
function mergeGeometry(masterEl, shapeEl, is1D) {
  const masterGeo = masterEl ? parseGeometryRaw(masterEl) : [];
  const shapeGeo = parseGeometryRaw(shapeEl);

  // If shape has its own geometry sections, merge with master by section IX
  if (shapeGeo.length === 0 && masterGeo.length === 0) return [];
  if (shapeGeo.length === 0) {
    // Use master geometry as-is
    return masterGeo.map(sec => ({
      rows: [...sec.rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
      noFill: sec.noFill ?? false,
      noLine: sec.noLine ?? false,
      noShow: sec.noShow ?? false
    }));
  }
  if (is1D) {
    // Shape rows win, but they only carry the cells that differ from the
    // master - an inherited coordinate is simply absent. Merging per cell (and
    // inheriting the section flags, which usually exist only on the master)
    // keeps such rows from collapsing to zero-length segments.
    const masterByIx = new Map(masterGeo.map(sec => [sec.ix, sec]));
    return shapeGeo.map(sec => {
      const masterSec = masterByIx.get(sec.ix);
      const rowMap = new Map();
      if (masterSec) {
        for (const [ix, row] of masterSec.rowMap) rowMap.set(ix, row);
      }
      for (const [ix, row] of sec.rowMap) {
        rowMap.set(ix, mergeRowData(rowMap.get(ix), row));
      }
      return {
        rows: [...rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
        noFill: sec.noFill ?? masterSec?.noFill ?? false,
        noLine: sec.noLine ?? masterSec?.noLine ?? false,
        noShow: sec.noShow ?? masterSec?.noShow ?? false
      };
    });
  }
  if (masterGeo.length === 0) {
    return shapeGeo.map(sec => ({
      rows: [...sec.rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
      noFill: sec.noFill ?? false,
      noLine: sec.noLine ?? false,
      noShow: sec.noShow ?? false
    }));
  }

  // Merge: index master sections by IX
  const masterByIx = new Map();
  for (const sec of masterGeo) masterByIx.set(sec.ix, sec);

  const merged = [];
  // Use shape sections, but fill in missing rows from master
  const seenIx = new Set();
  for (const shapeSec of shapeGeo) {
    seenIx.add(shapeSec.ix);
    const masterSec = masterByIx.get(shapeSec.ix);
    const mergedRowMap = new Map();

    // Start with master rows
    if (masterSec) {
      for (const [ix, row] of masterSec.rowMap) mergedRowMap.set(ix, row);
    }
    // Override at cell granularity. Shape rows commonly contain only the cells
    // that differ from the master; replacing the whole row drops inherited X/Y
    // cells and can collapse rectangles into triangles.
    for (const [ix, row] of shapeSec.rowMap) {
      mergedRowMap.set(ix, mergeRowData(mergedRowMap.get(ix), row));
    }

    const noShow = shapeSec.noShow ?? masterSec?.noShow ?? false;

    merged.push({
      rows: [...mergedRowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
      noFill: shapeSec.noFill ?? masterSec?.noFill ?? false,
      noLine: shapeSec.noLine ?? masterSec?.noLine ?? false,
      noShow
    });
  }
  // Add master sections not present in shape
  for (const masterSec of masterGeo) {
    if (!seenIx.has(masterSec.ix)) {
      merged.push({
        rows: [...masterSec.rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
        noFill: masterSec.noFill ?? false,
        noLine: masterSec.noLine ?? false,
        noShow: masterSec.noShow ?? false
      });
    }
  }

  return merged;
}

function parseShape(shapeEl, masters, parentMaster, themeColors, context = {}) {
  const colorPalette = context.colorPalette || null;
  const styleSheets = context.styleSheets || null;
  const id = shapeEl.getAttribute('ID');
  const name = shapeEl.getAttribute('Name');
  const nameU = shapeEl.getAttribute('NameU');
  const masterId = shapeEl.getAttribute('Master');
  const masterShapeId = shapeEl.getAttribute('MasterShape');
  const type = shapeEl.getAttribute('Type');

  // Resolution rules:
  //   - `Master` attribute: the shape is a direct master instance; look up that
  //     master and (if `MasterShape` is also set) its named sub-shape.
  //   - Only `MasterShape` set: the shape is a nested child of a group whose
  //     parent references a master. `MasterShape` then identifies WHICH shape
  //     inside the parent's master this child inherits from. Without this
  //     fallback, children-of-group instances report zero size because their
  //     own cells are all F='Inh' placeholders with no direct master.
  let master = masterId ? masters.get(masterId) : null;
  let masterShape = null;
  if (master) {
    if (masterShapeId && master.shapesById) {
      masterShape = master.shapesById.get(masterShapeId);
    } else if (master.shapes && master.shapes.length > 0) {
      masterShape = master.shapes[0];
    }
  } else if (masterShapeId && parentMaster && parentMaster.shapesById) {
    masterShape = parentMaster.shapesById.get(masterShapeId) || null;
    master = parentMaster;
  }

  // Position & size - shape values override master values
  const pinX = getCellFloat(shapeEl, 'PinX') ?? (masterShape ? getCellFloat(masterShape.el, 'PinX') : null) ?? 0;
  const pinY = getCellFloat(shapeEl, 'PinY') ?? (masterShape ? getCellFloat(masterShape.el, 'PinY') : null) ?? 0;
  const width = getCellFloat(shapeEl, 'Width') ?? (masterShape ? getCellFloat(masterShape.el, 'Width') : null) ?? 0;
  const height = getCellFloat(shapeEl, 'Height') ?? (masterShape ? getCellFloat(masterShape.el, 'Height') : null) ?? 0;
  const locPinX = getCellFloat(shapeEl, 'LocPinX') ?? (masterShape ? getCellFloat(masterShape.el, 'LocPinX') : null) ?? width / 2;
  const locPinY = getCellFloat(shapeEl, 'LocPinY') ?? (masterShape ? getCellFloat(masterShape.el, 'LocPinY') : null) ?? height / 2;
  const txtPinX = getCellFloat(shapeEl, 'TxtPinX') ?? (masterShape ? getCellFloat(masterShape.el, 'TxtPinX') : null) ?? width / 2;
  const txtPinY = getCellFloat(shapeEl, 'TxtPinY') ?? (masterShape ? getCellFloat(masterShape.el, 'TxtPinY') : null) ?? height / 2;
  const txtWidth = getCellFloat(shapeEl, 'TxtWidth') ?? (masterShape ? getCellFloat(masterShape.el, 'TxtWidth') : null) ?? width;
  const txtHeight = getCellFloat(shapeEl, 'TxtHeight') ?? (masterShape ? getCellFloat(masterShape.el, 'TxtHeight') : null) ?? height;
  // Where TxtPin sits *inside* the text block. Usually the block's centre, but
  // shapes such as dimension lines offset it so the label floats above the
  // line; defaulting to the centre keeps the common case unchanged.
  const txtLocPinX = getCellFloat(shapeEl, 'TxtLocPinX') ?? (masterShape ? getCellFloat(masterShape.el, 'TxtLocPinX') : null) ?? txtWidth / 2;
  const txtLocPinY = getCellFloat(shapeEl, 'TxtLocPinY') ?? (masterShape ? getCellFloat(masterShape.el, 'TxtLocPinY') : null) ?? txtHeight / 2;
  const angle = getCellFloat(shapeEl, 'Angle') ?? (masterShape ? getCellFloat(masterShape.el, 'Angle') : null) ?? 0;
  const flipX = getCellValue(shapeEl, 'FlipX') ?? (masterShape ? getCellValue(masterShape.el, 'FlipX') : null);
  const flipY = getCellValue(shapeEl, 'FlipY') ?? (masterShape ? getCellValue(masterShape.el, 'FlipY') : null);
  const beginX = getCellFloat(shapeEl, 'BeginX') ?? (masterShape ? getCellFloat(masterShape.el, 'BeginX') : null);
  const beginY = getCellFloat(shapeEl, 'BeginY') ?? (masterShape ? getCellFloat(masterShape.el, 'BeginY') : null);
  const endX = getCellFloat(shapeEl, 'EndX') ?? (masterShape ? getCellFloat(masterShape.el, 'EndX') : null);
  const endY = getCellFloat(shapeEl, 'EndY') ?? (masterShape ? getCellFloat(masterShape.el, 'EndY') : null);
  const objType = getCellValue(shapeEl, 'ObjType') ?? (masterShape ? getCellValue(masterShape.el, 'ObjType') : null);
  const quickStyleLineColor = getCellValue(shapeEl, 'QuickStyleLineColor') ?? (masterShape ? getCellValue(masterShape.el, 'QuickStyleLineColor') : null);
  const quickStyleFillColor = getCellValue(shapeEl, 'QuickStyleFillColor') ?? (masterShape ? getCellValue(masterShape.el, 'QuickStyleFillColor') : null);
  const quickStyleFontColor = getCellValue(shapeEl, 'QuickStyleFontColor') ?? (masterShape ? getCellValue(masterShape.el, 'QuickStyleFontColor') : null);
  const is1D = (beginX !== null && endX !== null) || objType === '2';

  // Style cells
  const lineStyleId = shapeEl.getAttribute('LineStyle') ?? (masterShape ? masterShape.el.getAttribute('LineStyle') : null);
  const fillStyleId = shapeEl.getAttribute('FillStyle') ?? (masterShape ? masterShape.el.getAttribute('FillStyle') : null);
  const lineColorData = getCellData(shapeEl, 'LineColor');
  const masterLineColorData = masterShape ? getCellData(masterShape.el, 'LineColor') : null;
  const styleLineColorData = resolveStyleCellData(styleSheets, lineStyleId, 'LineColor', 'line');
  const lineColor = resolveThemedColor(lineColorData, masterLineColorData || styleLineColorData, themeColors, {
    role: 'line',
    quickStyle: quickStyleLineColor,
    colorPalette
  }) ?? '#000000';
  const lineWeight = getCellFloat(shapeEl, 'LineWeight') ?? (masterShape ? getCellFloat(masterShape.el, 'LineWeight') : null) ?? styleCellFloat(styleSheets, lineStyleId, 'LineWeight', 'line') ?? 0.01;
  const linePattern = getCellFloat(shapeEl, 'LinePattern') ?? (masterShape ? getCellFloat(masterShape.el, 'LinePattern') : null) ?? styleCellFloat(styleSheets, lineStyleId, 'LinePattern', 'line') ?? 1;
  const fillForegroundData = getCellData(shapeEl, 'FillForegnd');
  const masterFillForegroundData = masterShape ? getCellData(masterShape.el, 'FillForegnd') : null;
  const styleFillForegroundData = resolveStyleCellData(styleSheets, fillStyleId, 'FillForegnd', 'fill');
  let fillForeground = resolveThemedColor(fillForegroundData, masterFillForegroundData || styleFillForegroundData, themeColors, {
    role: 'fill',
    quickStyle: quickStyleFillColor,
    colorPalette
  });
  const fillBackgroundData = getCellData(shapeEl, 'FillBkgnd');
  const masterFillBackgroundData = masterShape ? getCellData(masterShape.el, 'FillBkgnd') : null;
  const styleFillBackgroundData = resolveStyleCellData(styleSheets, fillStyleId, 'FillBkgnd', 'fill');
  const fillBackground = resolveThemedColor(fillBackgroundData, masterFillBackgroundData || styleFillBackgroundData, themeColors, {
    role: 'fill',
    quickStyle: quickStyleFillColor,
    colorPalette
  });
  const fillForegroundTrans = getCellFloat(shapeEl, 'FillForegndTrans')
    ?? (masterShape ? getCellFloat(masterShape.el, 'FillForegndTrans') : null)
    ?? styleCellFloat(styleSheets, fillStyleId, 'FillForegndTrans', 'fill')
    ?? 0;
  const fillBackgroundTrans = getCellFloat(shapeEl, 'FillBkgndTrans')
    ?? (masterShape ? getCellFloat(masterShape.el, 'FillBkgndTrans') : null)
    ?? styleCellFloat(styleSheets, fillStyleId, 'FillBkgndTrans', 'fill')
    ?? fillForegroundTrans;
  const fillPattern = getCellFloat(shapeEl, 'FillPattern') ?? (masterShape ? getCellFloat(masterShape.el, 'FillPattern') : null) ?? styleCellFloat(styleSheets, fillStyleId, 'FillPattern', 'fill') ?? 1;
  const fillGradientDir = getCellFloat(shapeEl, 'FillGradientDir') ?? (masterShape ? getCellFloat(masterShape.el, 'FillGradientDir') : null);
  const shapeGradientStops = parseFillGradientStops(shapeEl, themeColors, colorPalette);
  const masterGradientStops = masterShape ? parseFillGradientStops(masterShape.el, themeColors, colorPalette) : [];
  const fillGradientStops = shapeGradientStops.length > 0 ? shapeGradientStops : masterGradientStops;
  const rounding = getCellFloat(shapeEl, 'Rounding') ?? (masterShape ? getCellFloat(masterShape.el, 'Rounding') : null) ?? 0;
  // Arrowheads frequently live only in the LineStyle stylesheet (Visio's
  // built-in "Dimension" style carries EndArrow=13), so the style chain has to
  // be consulted as well or dimension lines come out with no arrowheads.
  const beginArrow = getCellFloat(shapeEl, 'BeginArrow')
    ?? (masterShape ? getCellFloat(masterShape.el, 'BeginArrow') : null)
    ?? styleCellFloat(styleSheets, lineStyleId, 'BeginArrow', 'line')
    ?? 0;
  const endArrow = getCellFloat(shapeEl, 'EndArrow')
    ?? (masterShape ? getCellFloat(masterShape.el, 'EndArrow') : null)
    ?? styleCellFloat(styleSheets, lineStyleId, 'EndArrow', 'line')
    ?? 0;
  const imgOffsetX = getCellFloat(shapeEl, 'ImgOffsetX') ?? (masterShape ? getCellFloat(masterShape.el, 'ImgOffsetX') : null) ?? 0;
  const imgOffsetY = getCellFloat(shapeEl, 'ImgOffsetY') ?? (masterShape ? getCellFloat(masterShape.el, 'ImgOffsetY') : null) ?? 0;
  const imgWidth = getCellFloat(shapeEl, 'ImgWidth') ?? (masterShape ? getCellFloat(masterShape.el, 'ImgWidth') : null) ?? width;
  const imgHeight = getCellFloat(shapeEl, 'ImgHeight') ?? (masterShape ? getCellFloat(masterShape.el, 'ImgHeight') : null) ?? height;

  // Text style
  const charSections = getDirectChildren(shapeEl, 'Section').filter(s => s.getAttribute('N') === 'Character');
  const charFormats = parseCharacterFormats(shapeEl, themeColors, quickStyleFontColor, colorPalette);
  let fontSize = null;
  let fontColor = null;
  let fontFamily = null;
  let bold = false;
  let italic = false;
  if (charSections.length > 0) {
    const charRows = getDirectChildren(charSections[0], 'Row');
    if (charRows.length > 0) {
      fontSize = getCellFloat(charRows[0], 'Size');
      fontFamily = getCellValue(charRows[0], 'Font') || getCellValue(charRows[0], 'ComplexScriptFont') || getCellValue(charRows[0], 'AsianFont');
      fontColor = resolveThemedColor(getCellData(charRows[0], 'Color'), null, themeColors, {
        role: 'font',
        quickStyle: quickStyleFontColor,
        colorPalette
      });
      const style = getCellValue(charRows[0], 'Style');
      if (style) {
        const styleNum = parseInt(style, 10);
        bold = (styleNum & 1) !== 0;
        italic = (styleNum & 2) !== 0;
      }
    }
  }
  // Fallback to master character section
  if (masterShape && fontSize === null) {
    const mCharSections = getDirectChildren(masterShape.el, 'Section').filter(s => s.getAttribute('N') === 'Character');
    if (mCharSections.length > 0) {
      const mCharRows = getDirectChildren(mCharSections[0], 'Row');
      if (mCharRows.length > 0) {
        fontSize = fontSize ?? getCellFloat(mCharRows[0], 'Size');
        fontFamily = fontFamily ?? getCellValue(mCharRows[0], 'Font') ?? getCellValue(mCharRows[0], 'ComplexScriptFont') ?? getCellValue(mCharRows[0], 'AsianFont');
        fontColor = fontColor ?? resolveThemedColor(getCellData(mCharRows[0], 'Color'), null, themeColors, {
          role: 'font',
          quickStyle: quickStyleFontColor,
          colorPalette
        });
      }
    }
  }

  // Last resort for character formatting: the TextStyle stylesheet chain. A
  // shape that never overrides its font (no Character section on shape or
  // master) still has a real size - it just lives in the stylesheet. Without
  // this the renderer had to guess, and guessed a page-unit constant that is
  // invisible in scaled drawings.
  const textStyleId = shapeEl.getAttribute('TextStyle')
    ?? (masterShape ? masterShape.el.getAttribute('TextStyle') : null);
  if (fontSize === null) {
    fontSize = styleSectionFloat(styleSheets, textStyleId, 'Character', 'Size');
  }
  if (!fontFamily) {
    fontFamily = resolveStyleSectionCell(styleSheets, textStyleId, 'Character', 'Font');
  }

  // Paragraph horizontal alignment: shape section -> master section -> style
  // chain. Visio's built-in default is 1 (centred) and comes from "No Style".
  const paragraphAlign = (el) => {
    const sections = getDirectChildren(el, 'Section').filter(s => s.getAttribute('N') === 'Paragraph');
    if (sections.length === 0) return null;
    const rows = getDirectChildren(sections[0], 'Row');
    return rows.length > 0 ? getCellFloat(rows[0], 'HorzAlign') : null;
  };
  const horzAlign = paragraphAlign(shapeEl)
    ?? (masterShape ? paragraphAlign(masterShape.el) : null)
    ?? styleSectionFloat(styleSheets, textStyleId, 'Paragraph', 'HorzAlign');

  // HideText suppresses a shape's text without removing it. Stencils use it for
  // optional labels (e.g. a window's width caption), so ignoring it made text
  // appear that Visio never draws.
  const hideText = (getCellFloat(shapeEl, 'HideText')
    ?? (masterShape ? getCellFloat(masterShape.el, 'HideText') : null)
    ?? 0) === 1;

  // VerticalAlign is a plain cell on the shape, not a section row.
  const vertAlign = getCellFloat(shapeEl, 'VerticalAlign')
    ?? (masterShape ? getCellFloat(masterShape.el, 'VerticalAlign') : null)
    ?? styleCellFloat(styleSheets, textStyleId, 'VerticalAlign', 'text');

  if (!fillForeground && fillPattern !== 0) {
    if (fillBackground && fontColor && isLightColor(fontColor)) {
      fillForeground = fillBackground;
    } else if (themeColors.lt1 && fontColor && !isLightColor(fontColor)) {
      fillForeground = themeColors.lt1;
    } else if (fillBackground) {
      fillForeground = fillBackground;
    }
  }

  // Layer membership - can be a single index or semicolon-separated list.
  // An empty V is meaningful here rather than absent: it is how Visio says
  // "on no layer", overriding the membership the master would otherwise
  // supply. getCellValue collapses "" to null, which would fall through to the
  // master and put a shape straight back on a layer it was taken off, so read
  // the shape's own cell directly.
  const ownLayerMemberCell = getCell(shapeEl, 'LayerMember');
  const ownLayerMember = ownLayerMemberCell ? ownLayerMemberCell.getAttribute('V') : null;
  const layerMemberRaw = ownLayerMember !== null
    ? ownLayerMember
    : (masterShape ? getCellValue(masterShape.el, 'LayerMember') : null);
  const layerMembers = layerMemberRaw
    ? layerMemberRaw.split(';').map(s => s.trim()).filter(Boolean)
    : [];
  // Remembered so a save knows whether clearing this shape's layers needs an
  // explicit empty cell to block the master, or whether removing the cell is
  // enough. Writing the override everywhere would add a cell to shapes that
  // never had one.
  const layerMemberInherited = ownLayerMember === null && layerMembers.length > 0;

  // Geometry - merge shape geometry with master geometry
  const geometry = mergeGeometry(masterShape?.el ?? null, shapeEl, is1D);
  const hasGeometry = hasGeometrySections(shapeEl) || hasGeometrySections(masterShape?.el ?? null);

  // Sub-shapes (groups). Propagate the current shape's master so that nested
  // children with only a `MasterShape` attribute can resolve the sibling
  // definition inside the same master.
  const subShapes = [];
  const shapesContainer = getDirectChildren(shapeEl, 'Shapes');
  if (shapesContainer.length > 0) {
    const childShapeEls = getDirectChildren(shapesContainer[0], 'Shape');
    for (const childEl of childShapeEls) {
      subShapes.push(parseShape(childEl, masters, master, themeColors, context));
    }
  }

  const { text: rawText, fields: inlineFields, runs: rawTextRuns } = getTextContent(shapeEl);

  // Field section rows (indexed by IX). Prefer shape's own Field section,
  // then fall back to the master's.
  const shapeFields = parseFieldSection(shapeEl);
  const masterFields = masterShape ? parseFieldSection(masterShape.el) : [];
  const fieldTable = shapeFields.length > 0 ? shapeFields : masterFields;

  // Map <fld IX=N> references to their Field-section definitions so the
  // resolver can walk inlineFields in text-document order.
  const orderedFields = inlineFields.map(f => {
    if (f.ix != null && fieldTable[f.ix]) return fieldTable[f.ix];
    return f;
  });

  // Custom-property and user-defined maps. Shape overrides master.
  const propMap = { ...(masterShape ? parsePropSection(masterShape.el) : {}), ...parsePropSection(shapeEl) };
  const userMap = { ...(masterShape ? parseUserSection(masterShape.el) : {}), ...parseUserSection(shapeEl) };
  const customProps = mergeMetadataRows(masterShape ? parseCustomProps(masterShape.el) : [], parseCustomProps(shapeEl));
  const userDefs = [...(masterShape ? parseUserDefs(masterShape.el) : []), ...parseUserDefs(shapeEl)];
  const title = name || nameU || (master?.name && id ? `${master.name}.${id}` : null) || (id ? `${type || 'Shape'}.${id}` : null);
  const foreignData = parseForeignData(shapeEl) || (masterShape ? parseForeignData(masterShape.el) : null);
  const image = resolveImageData(foreignData, context.pageRels, context.media);
  if (image) {
    image.x = imgOffsetX;
    image.y = imgOffsetY;
    image.width = imgWidth;
    image.height = imgHeight;
  }

  const shape = {
    id,
    name,
    nameU,
    title,
    masterId,
    // Which shape inside the master this one takes its unstated cells from.
    // Set on the children of a group that came from a stencil, and the reason
    // such a group cannot simply be dissolved: pull the child out and the
    // master it was reading its size and geometry from is no longer in scope.
    masterShapeId,
    type,
    pinX, pinY,
    width, height,
    locPinX, locPinY,
    txtPinX, txtPinY,
    txtWidth, txtHeight,
    txtLocPinX, txtLocPinY,
    angle,
    flipX: flipX === '1',
    flipY: flipY === '1',
    lineColor,
    lineWeight,
    linePattern,
    fillForeground,
    fillBackground,
    fillForegroundTrans,
    fillBackgroundTrans,
    fillPattern,
    fillGradientDir,
    fillGradientStops,
    image,
    rounding,
    beginArrow,
    endArrow,
    beginX,
    beginY,
    endX,
    endY,
    objType,
    is1D,
    fontSize,
    fontFamily,
    fontColor,
    bold,
    italic,
    horzAlign,
    vertAlign,
    hideText,
    charFormats,
    textRuns: rawTextRuns.map(run => ({
      ...run,
      ...(charFormats[run.cp] || charFormats['0'] || {})
    })),
    geometry,
    hasGeometry,
    subShapes,
    text: rawText,
    layerMembers,
    layerMemberInherited,
    propMap,
    userMap,
    customProps,
    userDefs,
    styleMeta: {
      lineColorFormula: lineColorData?.formula || masterLineColorData?.formula || null,
      fillForegroundFormula: fillForegroundData?.formula || masterFillForegroundData?.formula || null,
      fillBackgroundFormula: fillBackgroundData?.formula || masterFillBackgroundData?.formula || null,
      quickStyleLineColor,
      quickStyleFillColor,
      quickStyleFontColor
    },
    _fields: orderedFields
  };

  // Inherit text (and any character style we still don't have) from the
  // master. When the shape has no text of its own, the master's text + its
  // ordered field table become the defaults.
  if (masterShape) {
    const masterText = serializeTextWithFields(masterShape.el);
    const masterInherit = {
      text: masterText.text.replace(/\n$/, ''),
      fontSize: null, fontFamily: null, fontColor: null, bold: null, italic: null,
      // Resolve the master's <fld> placeholders against the *shape's* field
      // table first. A dimension line inherits its text layout from the master
      // but the measured value lives in the instance's Field section, so using
      // the master's table would show the stencil's placeholder measurement.
      _fields: masterText.fields.map(f => (f.ix != null && fieldTable[f.ix]) || (f.ix != null && masterFields[f.ix]) || f),
      propMap: {}, userMap: {}
    };
    // Master character row 0
    const mCharSections = getDirectChildren(masterShape.el, 'Section').filter(s => s.getAttribute('N') === 'Character');
    if (mCharSections.length > 0) {
      const mCharRows = getDirectChildren(mCharSections[0], 'Row');
      if (mCharRows.length > 0) {
        masterInherit.fontSize = getCellFloat(mCharRows[0], 'Size');
        masterInherit.fontFamily = getCellValue(mCharRows[0], 'Font') || getCellValue(mCharRows[0], 'ComplexScriptFont') || getCellValue(mCharRows[0], 'AsianFont');
        masterInherit.fontColor = resolveThemedColor(getCellData(mCharRows[0], 'Color'), null, themeColors, {
          role: 'font',
          quickStyle: quickStyleFontColor,
          colorPalette
        });
        const style = getCellValue(mCharRows[0], 'Style');
        if (style) {
          const sNum = parseInt(style, 10);
          masterInherit.bold = (sNum & 1) !== 0;
          masterInherit.italic = (sNum & 2) !== 0;
        }
      }
    }
    inheritFromMaster(shape, masterInherit);
  }

  return shape;
}

function parseMasterShapes(masterDoc) {
  const shapes = [];
  const shapesById = new Map();
  const shapeEls = byTag(masterDoc, 'Shape');
  for (let i = 0; i < shapeEls.length; i++) {
    const shapeEl = shapeEls[i];
    const id = shapeEl.getAttribute('ID');
    const entry = { el: shapeEl, id };
    shapes.push(entry);
    if (id) shapesById.set(id, entry);
  }
  return { shapes, shapesById };
}

export async function parseVsdx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Helper to read a file from zip
  async function readFile(path) {
    // Try exact path first, then with leading /
    let file = zip.file(path) || zip.file(path.replace(/^\//, ''));
    if (!file) {
      // Case-insensitive search
      const lowerPath = path.toLowerCase().replace(/^\//, '');
      zip.forEach((relativePath, entry) => {
        if (relativePath.toLowerCase() === lowerPath) {
          file = entry;
        }
      });
    }
    if (!file) return null;
    return await file.async('string');
  }

  const media = new Map();
  const mediaPromises = [];
  zip.forEach((relativePath, entry) => {
    if (!entry.dir && relativePath.toLowerCase().startsWith('visio/media/')) {
      mediaPromises.push(entry.async('uint8array').then(bytes => {
        const filename = relativePath.split('/').pop();
        if (filename) {
          media.set(filename, {
            bytes,
            dataUri: imageToDataUri(bytes, filename)
          });
        }
      }));
    }
  });
  await Promise.all(mediaPromises);

  // Parse relationships to find page and master files
  async function parseRels(basePath) {
    const relsPath = basePath.replace(/([^/]*)$/, '_rels/$1.rels');
    const content = await readFile(relsPath);
    if (!content) return {};
    const doc = parseXml(content);
    const rels = {};
    const relEls = byTag(doc, 'Relationship');
    for (let i = 0; i < relEls.length; i++) {
      const id = relEls[i].getAttribute('Id');
      const target = relEls[i].getAttribute('Target');
      rels[id] = target;
    }
    return rels;
  }

  let themeColors = {};
  let colorPalette = new Map(VISIO_COLORS.map((color, index) => [index, color]));
  let styleSheets = new Map();
  const documentXml = await readFile('visio/document.xml');
  if (documentXml) {
    const documentDoc = parseXml(documentXml);
    colorPalette = parseDocumentColors(documentDoc);
    styleSheets = parseStyleSheets(documentDoc);
  }

  const themeXml = await readFile('visio/theme/theme1.xml') || await readFile('visio/theme/theme2.xml');
  if (themeXml) {
    themeColors = parseThemeColors(parseXml(themeXml));
  }

  // Parse masters
  const masters = new Map();
  const mastersXml = await readFile('visio/masters/masters.xml');
  if (mastersXml) {
    const mastersDoc = parseXml(mastersXml);
    const mastersRels = await parseRels('visio/masters/masters.xml');
    const masterEls = byTag(mastersDoc, 'Master');
    for (let i = 0; i < masterEls.length; i++) {
      const masterEl = masterEls[i];
      const id = masterEl.getAttribute('ID');
      const name = masterEl.getAttribute('Name');
      const relEl = byTag(masterEl, 'Rel')[0];
      const rId = relEl ? (relEl.getAttribute('r:id') || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : null;
      const target = rId ? mastersRels[rId] : null;

      let masterShapes = { shapes: [], shapesById: new Map() };
      let masterDoc = null;
      let masterPath = null;
      if (target) {
        masterPath = 'visio/masters/' + target;
        const masterContent = await readFile(masterPath);
        if (masterContent) {
          masterDoc = parseXml(masterContent);
          masterShapes = parseMasterShapes(masterDoc);
        }
      }
      masters.set(id, { id, name, document: masterDoc, path: masterPath, ...masterShapes });
    }
  }

  // Parse pages
  const pages = [];
  const pagesXml = await readFile('visio/pages/pages.xml');
  if (!pagesXml) {
    // Stencil packages have masters but no drawing pages. Expose every master
    // as a synthetic, read-only page so .vssx/.vssm files are useful in the
    // viewer without pretending those pages can be written back as drawings.
    for (const master of masters.values()) {
      if (!master.document) continue;
      const root = master.document.documentElement;
      const pageSheet = getDirectChildren(root, 'PageSheet')[0];
      const shapesElement = getDirectChildren(root, 'Shapes')[0];
      const masterRels = master.path ? await parseRels(master.path) : {};
      const shapes = shapesElement
        ? getDirectChildren(shapesElement, 'Shape').map(shapeEl => parseShape(
          shapeEl,
          masters,
          null,
          themeColors,
          { pageRels: masterRels, media, colorPalette, styleSheets }
        ))
        : [];
      pages.push({
        id: `master-${master.id}`,
        name: master.name || `Master ${master.id}`,
        width: pageSheet ? (getCellFloat(pageSheet, 'PageWidth') || 8.5) : 8.5,
        height: pageSheet ? (getCellFloat(pageSheet, 'PageHeight') || 11) : 11,
        drawingUnitInInches: 1,
        drawingScale: 1,
        isBackground: false,
        backPage: null,
        layers: [],
        shapes,
        connects: [],
        themeColors,
        colorPalette,
        styleSheets,
        isStencilMaster: true,
      });
    }
    return {
      pages,
      masters,
      themeColors,
      colorPalette,
      styleSheets,
      viewTemplates: [],
      layerTags: [],
      layerTagColors: {},
      layerTree: null,
      hasPagesPart: false,
      isStencil: true,
    };
  }

  const pagesDoc = parseXml(pagesXml);
  const pagesRels = await parseRels('visio/pages/pages.xml');
  const pageEls = byTag(pagesDoc, 'Page');

  for (let i = 0; i < pageEls.length; i++) {
    const pageEl = pageEls[i];
    const pageId = pageEl.getAttribute('ID');
    const pageName = pageEl.getAttribute('Name') || `Page ${i + 1}`;
    const isBackground = pageEl.getAttribute('Background') === '1';

    // Get page dimensions from PageSheet
    const pageSheet = getDirectChildren(pageEl, 'PageSheet')[0];
    const pageWidth = pageSheet ? getCellFloat(pageSheet, 'PageWidth') : null;
    const pageHeight = pageSheet ? getCellFloat(pageSheet, 'PageHeight') : null;

    // Drawing unit: V values in this page are stored in whatever unit the
    // document was authored in (usually inches, sometimes MM/CM/M). The cell's
    // `U` attribute on PageWidth tells us. We convert that to an inch-scale
    // factor so the renderer can multiply stroke weights (always stored in
    // inches) by it to match the geometry's coordinate space.
    let drawingUnitInInches = 1;
    let drawingScale = 1;
    if (pageSheet) {
      const pwCell = getCell(pageSheet, 'PageWidth');
      const u = pwCell ? pwCell.getAttribute('U') : null;
      if (u === 'MM') drawingUnitInInches = 1 / 25.4;
      else if (u === 'CM') drawingUnitInInches = 1 / 2.54;
      else if (u === 'M') drawingUnitInInches = 1 / 0.0254;
      else if (u === 'PT') drawingUnitInInches = 1 / 72;
      else if (u === 'FT' || u === 'FT_C') drawingUnitInInches = 12;

      const pageScale = getCellFloat(pageSheet, 'PageScale');
      const drawingScaleValue = getCellFloat(pageSheet, 'DrawingScale');
      if (pageScale && drawingScaleValue && pageScale > 0 && drawingScaleValue > 0) {
        drawingScale = drawingScaleValue / pageScale;
      }
    }

    // Get background page reference
    const backPage = pageSheet ? getCellValue(pageSheet, 'BackPage') : null;

    // Parse layers from PageSheet
    const layers = [];
    if (pageSheet) {
      const layerSections = getDirectChildren(pageSheet, 'Section').filter(s => s.getAttribute('N') === 'Layer');
      if (layerSections.length > 0) {
        const layerRows = getDirectChildren(layerSections[0], 'Row');
        for (const row of layerRows) {
          const ix = row.getAttribute('IX');
          // Visio keeps an unnamed placeholder row for every layer that was
          // ever deleted, so indexes stay stable. Those rows are not layers -
          // Visio's own UI and SVG export both omit their names. Inventing a
          // "Layer <n>" name for them conjured dozens of phantom layers.
          const realName = getCellValue(row, 'Name') || getCellValue(row, 'NameUniv');
          const name = realName || '';
          const visible = getCellValue(row, 'Visible');
          const print = getCellValue(row, 'Print');
          const active = getCellValue(row, 'Active');
          const lock = getCellValue(row, 'Lock');
          const snap = getCellValue(row, 'Snap');
          const glue = getCellValue(row, 'Glue');
          layers.push({
            index: ix,
            name,
            // Kept in the list so layer indexes stay stable for save/prune,
            // but flagged so the UI can leave them out.
            placeholder: !realName,
            nameUniv: getCellValue(row, 'NameUniv') || null,
            visible: visible !== '0',
            print: print !== '0',
            active: active === '1',
            lock: lock === '1',
            snap: snap !== '0',
            glue: glue !== '0',
            color: parseColor(getCellValue(row, 'Color'), colorPalette) || getCellValue(row, 'Color') || null,
            colorTrans: getCellValue(row, 'ColorTrans') || null,
            cells: {
              Visible: visible ?? null,
              Print: print ?? null,
              Active: active ?? null,
              Lock: lock ?? null,
              Snap: snap ?? null,
              Glue: glue ?? null,
              Color: getCellValue(row, 'Color') ?? null,
              ColorTrans: getCellValue(row, 'ColorTrans') ?? null
            }
          });
        }
      }
    }

    const relEl = byTag(pageEl, 'Rel')[0];
    const rId = relEl ? (relEl.getAttribute('r:id') || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : null;
    const target = rId ? pagesRels[rId] : null;

    const shapes = [];
    let connects = [];
    if (target) {
      const pagePath = 'visio/pages/' + target;
      const pageContent = await readFile(pagePath);
      if (pageContent) {
        const pageDoc = parseXml(pageContent);
        const pageRels = await parseRels(pagePath);

        // Parse connects
        const connectsEls = byTag(pageDoc, 'Connect');
        for (let j = 0; j < connectsEls.length; j++) {
          connects.push({
            fromSheet: connectsEls[j].getAttribute('FromSheet'),
            fromCell: connectsEls[j].getAttribute('FromCell'),
            toSheet: connectsEls[j].getAttribute('ToSheet'),
          });
        }

        // Parse shapes
        const pageShapes = byTag(pageDoc, 'Shapes');
        if (pageShapes.length > 0) {
          const shapeEls = getDirectChildren(pageShapes[0], 'Shape');
          for (const shapeEl of shapeEls) {
            shapes.push(parseShape(shapeEl, masters, null, themeColors, { pageRels, media, colorPalette, styleSheets }));
          }
        }
      }
    }

    // Resolve fields for all shapes on this page, now that propMap/userMap
    // are populated and the page name/number are known. Walk recursively
    // through sub-shapes (groups) as well.
    const resolveCtx = { pageName, pageNumber: i + 1 };
    function applyFields(shape) {
      const ctx = {
        ...resolveCtx,
        propMap: shape.propMap,
        userMap: shape.userMap,
        fields: shape._fields
      };
      if (shape.text) shape.text = resolveFields(shape, ctx);
      // Clean up internal bookkeeping.
      delete shape._fields;
      for (const child of shape.subShapes || []) applyFields(child);
    }
    for (const sh of shapes) applyFields(sh);

    pages.push({
      id: pageId,
      name: pageName,
      width: pageWidth || 8.5,
      height: pageHeight || 11,
      drawingUnitInInches,
      drawingScale,
      isBackground,
      backPage,
      layers,
      shapes,
      connects,
      themeColors,
      colorPalette,
      styleSheets
    });
  }

  const viewTemplates = await readViewTemplatesFromZip(zip);
  const { pages: layerTags, tagColors: layerTagColors } = await readLayerTagsFromZip(zip);
  applyLayerTagsToPages(pages, layerTags);
  const layerTree = await readLayerTreeFromZip(zip);

  return {
    pages, masters, themeColors, colorPalette, styleSheets, viewTemplates,
    layerTags, layerTagColors, layerTree, hasPagesPart: true, isStencil: false,
  };
}

// ── Named view templates ("layer presets") ────────────────────────────────
// A view template is a per-page snapshot of layer visibility, saved under a
// name so different teams can flip a collaborative drawing between the sets of
// layers each cares about. They are stored in the drawing's Visio Solution XML
// store — the one extensibility channel that survives a Microsoft Visio
// open+save round-trip (see docs/visio-roundtrip.md) — so the presets travel
// with the file and are shared by everyone who opens it.
//
// Shape:  { name, pages: [ { id, name, layers: [ { name, visible } ] } ] }
const VIEWS_PART = 'visio/solutions/vsdxeditor-views.xml';
const VIEWS_REL_TYPE = 'http://schemas.microsoft.com/visio/2010/relationships/solutionxml';
const VIEWS_REL_ID = 'rIdVsdxViews';
const VIEWS_NS = 'urn:vsdxeditor:views';
const VIEWS_RELS_PATH = 'visio/_rels/document.xml.rels';
const VIEWS_REL_TARGET = 'solutions/vsdxeditor-views.xml';

function encodeUtf8Base64(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  return bytesToBase64(new TextEncoder().encode(str));
}

function decodeUtf8Base64(b64) {
  const clean = String(b64).replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function sanitizeViewTemplates(views) {
  if (!Array.isArray(views)) return [];
  const boolProps = ['print', 'active', 'lock', 'snap', 'glue'];
  return views
    .filter(v => v && typeof v.name === 'string' && Array.isArray(v.pages))
    .map(v => ({
      name: v.name,
      pages: v.pages
        .filter(p => p && Array.isArray(p.layers))
        .map(p => ({
          id: String(p.id ?? ''),
          name: String(p.name ?? ''),
          layers: p.layers
            .filter(l => l && typeof l.name === 'string')
            .map(l => {
              const layer = { name: l.name, visible: l.visible !== false };
              for (const prop of boolProps) {
                if (typeof l[prop] === 'boolean') layer[prop] = l[prop];
              }
              return layer;
            }),
        })),
    }));
}

async function readViewTemplatesFromZip(zip) {
  const json = await readSolutionPayload(zip, VIEWS_PART);
  return sanitizeViewTemplates(json && json.views);
}

export async function readVsdxViewTemplates(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  return readViewTemplatesFromZip(zip);
}

// The Solution XML store is reached through a relationship off
// visio/document.xml.rels; without that relationship Visio treats the part as
// unreachable and drops it on save. Both the named views and the layer tags
// below ride this same channel.
async function ensureSolutionRelationship(zip, { relId, relTarget }) {
  const file = zip.file(VIEWS_RELS_PATH);
  if (!file) return; // no document relationships part — nothing to hang it off
  const doc = parseXml(await file.async('string'));
  const relsEl = byTag(doc, 'Relationships')[0];
  if (!relsEl) return;
  const already = [...byTag(doc, 'Relationship')].some(r =>
    r.getAttribute('Target') === relTarget || r.getAttribute('Id') === relId);
  if (already) return;
  const rel = doc.createElementNS(relsEl.namespaceURI, 'Relationship');
  rel.setAttribute('Id', relId);
  rel.setAttribute('Type', VIEWS_REL_TYPE);
  rel.setAttribute('Target', relTarget);
  relsEl.appendChild(rel);
  zip.file(VIEWS_RELS_PATH, new XMLSerializer().serializeToString(doc));
}

async function removeSolutionRelationship(zip, { relId, relTarget }) {
  const file = zip.file(VIEWS_RELS_PATH);
  if (!file) return;
  const doc = parseXml(await file.async('string'));
  let changed = false;
  for (const r of [...byTag(doc, 'Relationship')]) {
    if (r.getAttribute('Target') === relTarget || r.getAttribute('Id') === relId) {
      r.parentNode.removeChild(r);
      changed = true;
    }
  }
  if (changed) zip.file(VIEWS_RELS_PATH, new XMLSerializer().serializeToString(doc));
}

// Reads the base64 JSON payload out of a `<SolutionXML>` part; returns null for
// a missing or unreadable part so callers can fall back to "no data".
async function readSolutionPayload(zip, part) {
  const file = zip.file(part);
  if (!file) return null;
  try {
    const doc = parseXml(await file.async('string'));
    const el = byTag(doc, 'SolutionXML')[0] || doc.documentElement;
    const payload = (el && el.textContent || '').trim();
    if (!payload) return null;
    return JSON.parse(decodeUtf8Base64(payload));
  } catch {
    return null;
  }
}

async function writeSolutionPayload(zip, { part, relId, relTarget, ns, name }, data) {
  if (data === null) {
    zip.remove(part);
    await removeSolutionRelationship(zip, { relId, relTarget });
    return;
  }
  const payload = encodeUtf8Base64(JSON.stringify({ app: 'vsdxeditor', version: 1, ...data }));
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<SolutionXML xmlns="${ns}" Name="${name}" encoding="base64">${payload}</SolutionXML>`;
  zip.file(part, xml);
  await ensureSolutionRelationship(zip, { relId, relTarget });
}

const VIEWS_SLOT = {
  part: VIEWS_PART,
  relId: VIEWS_REL_ID,
  relTarget: VIEWS_REL_TARGET,
  ns: VIEWS_NS,
  name: 'vsdxeditor-views',
};

async function writeViewTemplatesToZip(zip, viewTemplates) {
  const views = sanitizeViewTemplates(viewTemplates);
  await writeSolutionPayload(zip, VIEWS_SLOT, views.length === 0 ? null : { views });
}

// ── Layer tags ────────────────────────────────────────────────────────────
// Free-form labels on a layer ("electrical", "draft", "as-built") so a drawing
// can be filtered by concern instead of by layer name. Visio's layer object
// model has no tag slot, and an extra Cell in a Layer row would be dropped the
// moment Visio re-serializes the page — so the labels ride the same Solution
// XML channel as named views, the one extensibility store Visio preserves
// across an open+save (see docs/visio-roundtrip.md).
//
// Shape:  { pages: [ { id, name, layers: [ { name, tags: [string] } ] } ] }
// Layers are matched by name (not index) so tags survive Visio renumbering
// layers, exactly like named views do.
const TAGS_PART = 'visio/solutions/vsdxeditor-layer-tags.xml';
const TAGS_REL_ID = 'rIdVsdxLayerTags';
const TAGS_NS = 'urn:vsdxeditor:layertags';
const TAGS_REL_TARGET = 'solutions/vsdxeditor-layer-tags.xml';
const TAGS_SLOT = {
  part: TAGS_PART,
  relId: TAGS_REL_ID,
  relTarget: TAGS_REL_TARGET,
  ns: TAGS_NS,
  name: 'vsdxeditor-layer-tags',
};
const MAX_TAG_LENGTH = 64;

// A layer's key in the tag store: its name, or `#<index>` for the unnamed
// placeholder rows Visio keeps around.
function layerTagKey(layer) {
  const name = String(layer?.name ?? '').trim();
  return name || `#${layer?.index ?? ''}`;
}

// Commas separate tags in the UI, so they can never appear inside one. Tags are
// trimmed, length-capped, and de-duplicated case-insensitively (first casing
// wins) so "Draft" and "draft" don't both stick to the same layer.
export function normalizeLayerTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    for (const piece of String(raw ?? '').split(',')) {
      const tag = piece.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

// Tag colours are document-wide (a "draft" chip looks the same on every page),
// so they live beside the per-page tag lists as { <lowercased tag>: '#rrggbb' }.
export function normalizeTagColor(value) {
  const raw = String(value ?? '').trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const long = /^#?([0-9a-f]{6})$/i.exec(raw);
  return long ? `#${long[1].toLowerCase()}` : null;
}

function sanitizeTagColors(colors, allowedTags = null) {
  const out = {};
  if (!colors || typeof colors !== 'object') return out;
  for (const [tag, value] of Object.entries(colors)) {
    const key = String(tag).trim().toLowerCase();
    if (!key) continue;
    if (allowedTags && !allowedTags.has(key)) continue;
    const color = normalizeTagColor(value);
    if (color) out[key] = color;
  }
  return out;
}

function sanitizeLayerTagStore(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter(p => p && Array.isArray(p.layers))
    .map(p => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      layers: p.layers
        .filter(l => l && typeof l.name === 'string')
        .map(l => ({ name: l.name, tags: normalizeLayerTags(l.tags) }))
        .filter(l => l.tags.length > 0),
    }))
    .filter(p => p.layers.length > 0);
}

async function readLayerTagsFromZip(zip) {
  const json = await readSolutionPayload(zip, TAGS_PART);
  const pages = sanitizeLayerTagStore(json && json.pages);
  return { pages, tagColors: sanitizeTagColors(json && json.tagColors) };
}

export async function readVsdxLayerTags(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  return readLayerTagsFromZip(zip);
}

// Hangs stored tags onto the freshly parsed page/layer objects, so the rest of
// the app can treat `layer.tags` as just another layer property.
function applyLayerTagsToPages(pages, store) {
  if (!store.length) return;
  const byPageId = new Map(store.map(entry => [String(entry.id), entry]));
  const byPageName = new Map(store.map(entry => [String(entry.name), entry]));
  for (const page of pages) {
    const entry = byPageId.get(String(page.id)) || byPageName.get(String(page.name));
    if (!entry) continue;
    const tagsByKey = new Map(entry.layers.map(l => [l.name, l.tags]));
    for (const layer of page.layers || []) {
      const tags = tagsByKey.get(layerTagKey(layer));
      if (tags && tags.length) layer.tags = [...tags];
    }
  }
}

// Rebuilds the store from the live page objects. Called on every save path, so
// tags travel with the drawing without each caller having to pass them along.
// `tagColors` is optional: omitting it keeps whatever palette the package
// already carries, so prune/export paths never drop a colour they didn't know
// about.
async function writeLayerTagsToZip(zip, pages, tagColors) {
  const store = sanitizeLayerTagStore((pages || []).map(page => ({
    id: page.id,
    name: page.name,
    layers: (page.layers || []).map(layer => ({ name: layerTagKey(layer), tags: layer.tags })),
  })));

  const existing = tagColors === undefined ? await readSolutionPayload(zip, TAGS_PART) : null;
  // Colours for tags nobody uses any more are dropped rather than accumulated.
  const usedTags = new Set(store.flatMap(p => p.layers.flatMap(l => l.tags.map(t => t.toLowerCase()))));
  const colors = sanitizeTagColors(tagColors === undefined ? existing?.tagColors : tagColors, usedTags);

  const empty = store.length === 0 && Object.keys(colors).length === 0;
  await writeSolutionPayload(zip, TAGS_SLOT, empty ? null : { pages: store, tagColors: colors });
}

// ── Layer folder settings ─────────────────────────────────────────────────
// Visio's layers are flat, but drawings fake a hierarchy in the name
// ("Electrical/HV"). Which delimiter a drawing uses for that is a property of
// the drawing rather than of whoever opens it — a document written that way is
// grouped by "/" for everybody — so the setting rides the same Solution XML
// channel as views and tags instead of living in one browser's storage, and
// everyone who opens the file sees the tree its author saw. The groups
// themselves are still never written: only the delimiter, whether grouping is
// on, and which groups were left collapsed.
//
// Shape:  { enabled, delimiter, collapsed: [path] }
const LAYER_TREE_PART = 'visio/solutions/vsdxeditor-layer-tree.xml';
const LAYER_TREE_REL_ID = 'rIdVsdxLayerTree';
const LAYER_TREE_NS = 'urn:vsdxeditor:layertree';
const LAYER_TREE_REL_TARGET = 'solutions/vsdxeditor-layer-tree.xml';
const LAYER_TREE_SLOT = {
  part: LAYER_TREE_PART,
  relId: LAYER_TREE_REL_ID,
  relTarget: LAYER_TREE_REL_TARGET,
  ns: LAYER_TREE_NS,
  name: 'vsdxeditor-layer-tree',
};
export const DEFAULT_LAYER_DELIMITER = '/';
// Matches the delimiter input's maxlength: a delimiter is a separator, not a
// name fragment.
const MAX_LAYER_DELIMITER_LENGTH = 4;
// Collapse state is a convenience, not data — a drawing with hundreds of
// collapsed groups has bigger problems than a truncated list.
const MAX_COLLAPSED_GROUPS = 500;

export function sanitizeLayerTreeSettings(settings) {
  const delimiter = String(settings?.delimiter ?? DEFAULT_LAYER_DELIMITER).slice(0, MAX_LAYER_DELIMITER_LENGTH);
  const collapsed = [];
  const seen = new Set();
  for (const raw of Array.isArray(settings?.collapsed) ? settings.collapsed : []) {
    const key = String(raw ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    collapsed.push(key);
    if (collapsed.length >= MAX_COLLAPSED_GROUPS) break;
  }
  // Grouping on an empty delimiter would split nothing, so it is not "on".
  return { enabled: Boolean(settings?.enabled) && delimiter.length > 0, delimiter, collapsed };
}

// Saying nothing is said by leaving the part out, so a drawing nobody grouped
// never grows one, and switching grouping back off at the default delimiter
// takes it away again.
function isDefaultLayerTreeSettings(settings) {
  return !settings.enabled
    && settings.delimiter === DEFAULT_LAYER_DELIMITER
    && settings.collapsed.length === 0;
}

async function readLayerTreeFromZip(zip) {
  const json = await readSolutionPayload(zip, LAYER_TREE_PART);
  if (!json) return null;
  return sanitizeLayerTreeSettings(json.layerTree || json);
}

export async function readVsdxLayerTree(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  return readLayerTreeFromZip(zip);
}

async function writeLayerTreeToZip(zip, settings) {
  const clean = sanitizeLayerTreeSettings(settings);
  await writeSolutionPayload(zip, LAYER_TREE_SLOT, isDefaultLayerTreeSettings(clean) ? null : { layerTree: clean });
}

function getOrCreateCell(doc, row, name) {
  let cell = getCell(row, name);
  if (cell) return cell;

  cell = doc.createElementNS(row.namespaceURI || VISIO_MAIN_NS, 'Cell');
  cell.setAttribute('N', name);
  row.appendChild(cell);
  return cell;
}

function setCellValue(doc, row, name, value) {
  const cell = getOrCreateCell(doc, row, name);
  cell.setAttribute('V', value);
  cell.removeAttribute('F');
}

function removeCell(row, name) {
  const cell = getCell(row, name);
  if (cell) row.removeChild(cell);
}

function boolToCellValue(value, defaultValue) {
  return (value ?? defaultValue) ? '1' : '0';
}

async function readZipText(zip, path) {
  let file = zip.file(path) || zip.file(path.replace(/^\//, ''));
  if (!file) {
    const lowerPath = path.toLowerCase().replace(/^\//, '');
    zip.forEach((relativePath, entry) => {
      if (relativePath.toLowerCase() === lowerPath) file = entry;
    });
  }
  return file ? file.async('string') : null;
}

async function parseZipRels(zip, basePath) {
  const relsPath = basePath.replace(/([^/]*)$/, '_rels/$1.rels');
  const content = await readZipText(zip, relsPath);
  if (!content) return {};
  const doc = parseXml(content);
  const rels = {};
  for (const relEl of byTag(doc, 'Relationship')) {
    rels[relEl.getAttribute('Id')] = relEl.getAttribute('Target');
  }
  return rels;
}

function resolveZipTarget(basePath, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);

  const parts = basePath.split('/');
  parts.pop();
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function findShapeElementById(parentEl, shapeId) {
  for (const shapesEl of getDirectChildren(parentEl, 'Shapes')) {
    const found = findShapeElementById(shapesEl, shapeId);
    if (found) return found;
  }

  for (const shapeEl of getDirectChildren(parentEl, 'Shape')) {
    if (String(shapeEl.getAttribute('ID')) === String(shapeId)) return shapeEl;
    const found = findShapeElementById(shapeEl, shapeId);
    if (found) return found;
  }
  return null;
}

async function resolvePagePart(zip, pageId) {
  const pagesXml = await readZipText(zip, 'visio/pages/pages.xml');
  if (!pagesXml) throw new Error('VSDX package is missing visio/pages/pages.xml');

  const pagesDoc = parseXml(pagesXml);
  const pagesRels = await parseZipRels(zip, 'visio/pages/pages.xml');
  const pageEl = [...byTag(pagesDoc, 'Page')].find(el => String(el.getAttribute('ID')) === String(pageId));
  if (!pageEl) throw new Error('Could not find the current page in the VSDX package');

  const relEl = byTag(pageEl, 'Rel')[0];
  const rId = relEl ? (relEl.getAttribute('r:id') || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : null;
  const pagePath = resolveZipTarget('visio/pages/pages.xml', rId ? pagesRels[rId] : null);
  if (!pagePath) throw new Error('Could not resolve the current page drawing part');
  return { pagePath };
}

export async function getVsdxShapeXmlSnippet(arrayBuffer, pageId, shapeId) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const { pagePath } = await resolvePagePart(zip, pageId);
  const pageXml = await readZipText(zip, pagePath);
  if (!pageXml) throw new Error(`VSDX package is missing ${pagePath}`);

  const pageDoc = parseXml(pageXml);
  const shapeEl = findShapeElementById(pageDoc.documentElement, shapeId);
  if (!shapeEl) throw new Error(`Could not find shape ${shapeId} in ${pagePath}`);
  return new XMLSerializer().serializeToString(shapeEl);
}

export async function replaceVsdxShapeXmlSnippet(arrayBuffer, pageId, shapeId, shapeXmlSnippet) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const { pagePath } = await resolvePagePart(zip, pageId);
  const pageXml = await readZipText(zip, pagePath);
  if (!pageXml) throw new Error(`VSDX package is missing ${pagePath}`);

  const pageDoc = parseXml(pageXml);
  const currentShapeEl = findShapeElementById(pageDoc.documentElement, shapeId);
  if (!currentShapeEl) throw new Error(`Could not find shape ${shapeId} in ${pagePath}`);

  const snippetDoc = parseXml(`<Root xmlns="${VISIO_MAIN_NS}">${String(shapeXmlSnippet || '').trim()}</Root>`);
  const parseError = byTag(snippetDoc, 'parsererror')[0];
  if (parseError) throw new Error('Shape XML is not well-formed');

  const replacementShapeEl = getDirectChildren(snippetDoc.documentElement, 'Shape')[0];
  if (!replacementShapeEl) throw new Error('Shape XML must contain exactly one <Shape> element');
  if (String(replacementShapeEl.getAttribute('ID') || '') !== String(shapeId)) {
    throw new Error(`Shape XML must keep ID=\"${shapeId}\"`);
  }

  currentShapeEl.parentNode.replaceChild(replacementShapeEl.cloneNode(true), currentShapeEl);
  zip.file(pagePath, new XMLSerializer().serializeToString(pageDoc));
  return zip.generateAsync({ type: 'arraybuffer' });
}

// Shape IDs only have to be unique within a page, so the next free one is one
// past the highest in use - including IDs nested inside groups, which are in
// the same number space as the top-level shapes.
function collectShapeIds(parentEl, ids = new Set()) {
  for (const shapesEl of getDirectChildren(parentEl, 'Shapes')) collectShapeIds(shapesEl, ids);
  for (const shapeEl of getDirectChildren(parentEl, 'Shape')) {
    const id = Number.parseInt(shapeEl.getAttribute('ID'), 10);
    if (Number.isFinite(id)) ids.add(id);
    collectShapeIds(shapeEl, ids);
  }
  return ids;
}

function nextFreeShapeId(rootEl) {
  const ids = collectShapeIds(rootEl);
  return ids.size ? Math.max(...ids) + 1 : 1;
}

// Add a new top-level shape to a page. The counterpart to
// replaceVsdxShapeXmlSnippet, which deliberately refuses anything whose ID does
// not already exist: here the ID in the snippet is a placeholder and gets
// rewritten to whatever is free on the target page.
export async function addVsdxShapeToPage(arrayBuffer, pageId, shapeXmlSnippet) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const { pagePath } = await resolvePagePart(zip, pageId);
  const pageXml = await readZipText(zip, pagePath);
  if (!pageXml) throw new Error(`VSDX package is missing ${pagePath}`);

  const pageDoc = parseXml(pageXml);
  const root = pageDoc.documentElement;

  const snippetDoc = parseXml(`<Root xmlns="${VISIO_MAIN_NS}">${String(shapeXmlSnippet || '').trim()}</Root>`);
  const parseError = byTag(snippetDoc, 'parsererror')[0];
  if (parseError) throw new Error('Shape XML is not well-formed');

  const newShapeEl = getDirectChildren(snippetDoc.documentElement, 'Shape')[0];
  if (!newShapeEl) throw new Error('Shape XML must contain exactly one <Shape> element');

  // An untouched page can legitimately have no <Shapes> container yet.
  let shapesEl = getDirectChildren(root, 'Shapes')[0];
  if (!shapesEl) {
    shapesEl = pageDoc.createElementNS(root.namespaceURI || VISIO_MAIN_NS, 'Shapes');
    root.appendChild(shapesEl);
  }

  const shapeId = nextFreeShapeId(root);
  const inserted = newShapeEl.cloneNode(true);
  inserted.setAttribute('ID', String(shapeId));
  shapesEl.appendChild(inserted);

  zip.file(pagePath, new XMLSerializer().serializeToString(pageDoc));
  return { buffer: await zip.generateAsync({ type: 'arraybuffer' }), shapeId };
}

// ── Grouping, ungrouping and z-order ─────────────────────────────────────────
// Visio's z-order *is* document order — the last <Shape> in a <Shapes> is drawn
// on top — so front and back are a move within the parent. Grouping and
// ungrouping are a move too, plus the Pin/Angle/Flip cells the caller worked out
// (src/shape-arrange.js) to keep each shape where it is drawn under its new
// parent. The geometry lives there; what lives here is the XML.

// A Shape's cells have to come before its <Shapes>, <Text> and Sections, so a
// cell that does not exist yet cannot simply be appended the way a Layer row's
// can.
function setShapeCell(doc, shapeEl, name, value) {
  let cell = getCell(shapeEl, name);
  if (!cell) {
    cell = doc.createElementNS(shapeEl.namespaceURI || VISIO_MAIN_NS, 'Cell');
    cell.setAttribute('N', name);
    const firstNonCell = [...shapeEl.childNodes].find(node => node.nodeType === 1 && node.localName !== 'Cell');
    shapeEl.insertBefore(cell, firstNonCell || null);
  }
  cell.setAttribute('V', value);
  cell.removeAttribute('F');
}

// Visio writes plain decimals; floating-point noise from a matrix round-trip is
// not a change worth recording.
function formatShapeNumber(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(9));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function applyShapePlacementCells(doc, shapeEl, cells) {
  setShapeCell(doc, shapeEl, 'PinX', formatShapeNumber(cells.pinX));
  setShapeCell(doc, shapeEl, 'PinY', formatShapeNumber(cells.pinY));
  // Only write the cells that have something to say: a shape with no Angle cell
  // and no rotation should not grow one.
  for (const [name, value, isDefault] of [
    ['Angle', formatShapeNumber(cells.angle), Math.abs(cells.angle || 0) < 1e-9],
    ['FlipX', cells.flipX ? '1' : '0', !cells.flipX],
    ['FlipY', cells.flipY ? '1' : '0', !cells.flipY]
  ]) {
    if (!isDefault || getCell(shapeEl, name)) setShapeCell(doc, shapeEl, name, value);
  }
}

function createGroupShapeElement(doc, root, shapeId, cells, layerMembers) {
  const ns = root.namespaceURI || VISIO_MAIN_NS;
  const shapeEl = doc.createElementNS(ns, 'Shape');
  shapeEl.setAttribute('ID', String(shapeId));
  shapeEl.setAttribute('NameU', `Group.${shapeId}`);
  shapeEl.setAttribute('Name', `Group.${shapeId}`);
  shapeEl.setAttribute('Type', 'Group');
  shapeEl.setAttribute('LineStyle', '0');
  shapeEl.setAttribute('FillStyle', '0');
  shapeEl.setAttribute('TextStyle', '0');

  for (const [name, value] of [
    ['PinX', formatShapeNumber(cells.pinX)],
    ['PinY', formatShapeNumber(cells.pinY)],
    ['Width', formatShapeNumber(cells.width)],
    ['Height', formatShapeNumber(cells.height)],
    ['LocPinX', formatShapeNumber(cells.locPinX)],
    ['LocPinY', formatShapeNumber(cells.locPinY)],
    ['Angle', '0'],
    ['FlipX', '0'],
    ['FlipY', '0'],
    // Visio's own groups resize their children with the group rather than
    // scaling them, which is what the renderer here assumes as well.
    ['ResizeMode', '0'],
    ['DisplayLevel', '1']
  ]) {
    setShapeCell(doc, shapeEl, name, value);
  }
  if (layerMembers?.length) setShapeCell(doc, shapeEl, 'LayerMember', layerMembers.join(';'));

  shapeEl.appendChild(doc.createElementNS(ns, 'Shapes'));
  return shapeEl;
}

async function withPageDocument(arrayBuffer, pageId, mutate) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const { pagePath } = await resolvePagePart(zip, pageId);
  const pageXml = await readZipText(zip, pagePath);
  if (!pageXml) throw new Error(`VSDX package is missing ${pagePath}`);

  const pageDoc = parseXml(pageXml);
  const result = mutate(pageDoc, pageDoc.documentElement) || {};
  zip.file(pagePath, new XMLSerializer().serializeToString(pageDoc));
  return { ...result, buffer: await zip.generateAsync({ type: 'arraybuffer' }) };
}

// Move shapes to the front or the back of whatever <Shapes> already holds them,
// keeping their order relative to each other. Shapes inside a group move within
// that group: z-order is a question about siblings, so nothing changes parent.
export async function reorderVsdxShapes(arrayBuffer, pageId, shapeIds, place) {
  if (place !== 'front' && place !== 'back') throw new Error(`Unknown z-order target "${place}"`);
  return withPageDocument(arrayBuffer, pageId, (doc, root) => {
    const wanted = new Set((shapeIds || []).map(String));
    const moving = new Set();
    for (const id of wanted) {
      const shapeEl = findShapeElementById(root, id);
      if (!shapeEl) throw new Error(`Could not find shape ${id} on this page`);
      moving.add(shapeEl);
    }

    for (const parent of new Set([...moving].map(shapeEl => shapeEl.parentNode))) {
      const siblings = getDirectChildren(parent, 'Shape');
      const ordered = siblings.filter(shapeEl => moving.has(shapeEl));
      // insertBefore(el, null) appends, which is what "front" wants and also
      // what "back" degrades to when every sibling is selected.
      const anchor = place === 'front' ? null : (siblings.find(shapeEl => !moving.has(shapeEl)) || null);
      for (const shapeEl of ordered) parent.insertBefore(shapeEl, anchor);
    }
    return {};
  });
}

// Wrap the planned members in a new group. The plan (planGroupShapes) has
// already decided where the group goes and what each member's cells become.
export async function groupVsdxShapes(arrayBuffer, pageId, plan) {
  return withPageDocument(arrayBuffer, pageId, (doc, root) => {
    const memberEls = plan.members.map(member => {
      const shapeEl = findShapeElementById(root, member.id);
      if (!shapeEl) throw new Error(`Could not find shape ${member.id} on this page`);
      return shapeEl;
    });

    const parents = new Set(memberEls.map(shapeEl => shapeEl.parentNode));
    if (parents.size !== 1) throw new Error('Those shapes do not share a parent, so they cannot be grouped');
    const shapesEl = memberEls[0].parentNode;

    const anchorEl = findShapeElementById(root, plan.anchorId);
    const shapeId = nextFreeShapeId(root);
    const groupEl = createGroupShapeElement(doc, root, shapeId, plan.groupCells, plan.layerMembers);
    shapesEl.insertBefore(groupEl, anchorEl ? anchorEl.nextSibling : null);

    const innerShapes = getDirectChildren(groupEl, 'Shapes')[0];
    plan.members.forEach((member, index) => {
      applyShapePlacementCells(doc, memberEls[index], member.cells);
      innerShapes.appendChild(memberEls[index]);
    });
    return { shapeId };
  });
}

// Dissolve a group: its children move up into the group's own parent, keeping
// the place the group held in the z-order, and the group element goes away.
export async function ungroupVsdxShapes(arrayBuffer, pageId, plan) {
  return withPageDocument(arrayBuffer, pageId, (doc, root) => {
    const groupEl = findShapeElementById(root, plan.groupId);
    if (!groupEl) throw new Error(`Could not find shape ${plan.groupId} on this page`);
    const parentShapes = groupEl.parentNode;
    const innerShapes = getDirectChildren(groupEl, 'Shapes')[0];
    const childEls = innerShapes ? getDirectChildren(innerShapes, 'Shape') : [];
    if (!childEls.length) throw new Error('That group has no shapes in it');
    // Checked again here, not only in the plan: a child with MasterShape reads
    // its size and geometry out of the group's master, and that inheritance
    // does not survive being lifted out of the group.
    if (childEls.some(childEl => childEl.getAttribute('MasterShape'))) {
      throw new Error('This group comes from a master, and its shapes would be emptied by dissolving it');
    }

    const cellsById = new Map(plan.children.map(child => [String(child.id), child.cells]));
    const shapeIds = [];
    for (const childEl of childEls) {
      const id = String(childEl.getAttribute('ID'));
      const cells = cellsById.get(id);
      if (cells) applyShapePlacementCells(doc, childEl, cells);
      // A child on no layer of its own was showing and hiding with the group;
      // without the group it would answer to nothing, so it inherits by value.
      if (plan.layerMembers?.length && !getShapeLayerMembers(childEl).length) {
        setShapeCell(doc, childEl, 'LayerMember', plan.layerMembers.join(';'));
      }
      parentShapes.insertBefore(childEl, groupEl);
      shapeIds.push(id);
    }

    parentShapes.removeChild(groupEl);
    // Anything glued to the group itself has nothing left to point at.
    removeDanglingConnects(doc, new Set([String(plan.groupId)]));
    return { shapeIds };
  });
}

// Delete shapes outright. A group takes everything inside it, which is what
// deleting a group means and also all the XML can express — a <Shape> holds its
// children. So the ids that vanish are the ones asked for *plus* their
// descendants, and the connections pointing at any of them go too: a <Connect>
// naming a shape that no longer exists is a dangling reference Visio will
// complain about.
export async function deleteVsdxShapes(arrayBuffer, pageId, shapeIds) {
  return withPageDocument(arrayBuffer, pageId, (doc, root) => {
    const wanted = [...new Set((shapeIds || []).map(String))];
    if (!wanted.length) throw new Error('Nothing to delete');

    const removed = new Set();
    for (const id of wanted) {
      const shapeEl = findShapeElementById(root, id);
      // Already gone: deleting a group and one of its children in the same call
      // is a perfectly ordinary selection, and the child went with the group.
      if (!shapeEl) {
        if (removed.has(id)) continue;
        throw new Error(`Could not find shape ${id} on this page`);
      }
      removed.add(String(shapeEl.getAttribute('ID')));
      for (const childId of collectShapeIds(shapeEl)) removed.add(String(childId));
      shapeEl.parentNode.removeChild(shapeEl);
    }

    removeDanglingConnects(doc, removed);
    return { shapeIds: [...removed] };
  });
}

// Push a shape somewhere else, turn it, or change its size — whatever the
// caller worked out in src/shape-arrange.js. Everything a drag can do to a
// shape is some of these six cells, so there is one entry point rather than
// three near-identical ones.
//
// Only the cells that were asked for are written: a plain move must not start
// pinning down a Width the shape was happily inheriting from its master, and a
// resize must not invent an Angle cell for a shape that has never been turned.
export async function transformVsdxShapes(arrayBuffer, pageId, updates) {
  return withPageDocument(arrayBuffer, pageId, (doc, root) => {
    const wanted = (updates || []).filter(update => update && update.id !== undefined);
    if (!wanted.length) throw new Error('Nothing to move');

    const touched = [];
    for (const { id, cells } of wanted) {
      const shapeEl = findShapeElementById(root, String(id));
      if (!shapeEl) throw new Error(`Could not find shape ${id} on this page`);
      for (const name of ['PinX', 'PinY', 'Width', 'Height', 'LocPinX', 'LocPinY']) {
        const value = cells?.[name.charAt(0).toLowerCase() + name.slice(1)];
        if (Number.isFinite(value)) setShapeCell(doc, shapeEl, name, formatShapeNumber(value));
      }
      // Angle, FlipX and FlipY fall out of the same matrix as the pin does, so
      // they come back even from a move — a move never changes them, and
      // writing back what is already there is not a change.
      if (cells && ('angle' in cells || 'flipX' in cells || 'flipY' in cells)) {
        for (const [name, value, isDefault] of [
          ['Angle', formatShapeNumber(cells.angle || 0), Math.abs(cells.angle || 0) < 1e-9],
          ['FlipX', cells.flipX ? '1' : '0', !cells.flipX],
          ['FlipY', cells.flipY ? '1' : '0', !cells.flipY]
        ]) {
          if (!isDefault || getCell(shapeEl, name)) setShapeCell(doc, shapeEl, name, value);
        }
      }
      touched.push(String(id));
    }
    return { shapeIds: touched };
  });
}

// A Visio layer exists in exactly one place: a Row in the page's Layer
// section. So adding or removing a layer is adding or removing a Row here, and
// the in-memory page is the source of truth — a Row whose IX no longer appears
// in page.layers was deleted in the editor, and a layer with no Row is new.
//
// Deleted rows are dropped without renumbering the survivors, so every
// remaining layer keeps the index that shapes' LayerMember cells already point
// at. (The prune paths do renumber, but they remap LayerMember in the same
// pass; here there is nothing to remap.)
function reconcileLayerRows(doc, layerSection, layers) {
  const wanted = new Map((layers || []).map(layer => [String(layer.index), layer]));

  // getDirectChildren returns a snapshot, so removing while iterating is safe.
  for (const row of getDirectChildren(layerSection, 'Row')) {
    if (!wanted.has(String(row.getAttribute('IX') ?? ''))) layerSection.removeChild(row);
  }

  const rowsByIndex = new Map(getDirectChildren(layerSection, 'Row')
    .map(row => [String(row.getAttribute('IX') ?? ''), row]));

  const paired = [];
  for (const [index, layer] of wanted) {
    let row = rowsByIndex.get(index);
    if (!row) {
      row = doc.createElementNS(layerSection.namespaceURI || VISIO_MAIN_NS, 'Row');
      row.setAttribute('IX', index);
      // Visio writes these on every layer row it creates. Colour 255 is its
      // "no layer colour" sentinel, which is what a new layer should have.
      setCellValue(doc, row, 'Color', '255');
      setCellValue(doc, row, 'Status', '0');
      setCellValue(doc, row, 'ColorTrans', '0');
      layerSection.appendChild(row);
    }
    paired.push([layer, row]);
  }
  return paired;
}

// A drawing that has never had a layer has no Layer section at all, so the
// first layer added needs one. Visio puts Sections after the PageSheet's Cells.
function getOrCreateLayerSection(doc, pageSheet) {
  const existing = getDirectChildren(pageSheet, 'Section')
    .find(section => section.getAttribute('N') === 'Layer');
  if (existing) return existing;

  const section = doc.createElementNS(pageSheet.namespaceURI || VISIO_MAIN_NS, 'Section');
  section.setAttribute('N', 'Layer');
  pageSheet.appendChild(section);
  return section;
}

async function patchVsdxLayerPermissions(zip, pages, tagColors) {
  const pagesFile = zip.file('visio/pages/pages.xml');
  if (!pagesFile) throw new Error('VSDX package is missing visio/pages/pages.xml');
  const pagesXml = await pagesFile.async('string');
  const doc = parseXml(pagesXml);
  const pageEls = byTag(doc, 'Page');
  const pageById = new Map((pages || []).map(page => [String(page.id), page]));

  for (let i = 0; i < pageEls.length; i++) {
    const pageEl = pageEls[i];
    const page = pageById.get(String(pageEl.getAttribute('ID')));
    // An array is enough of a signal: `[]` means "this page's layers were all
    // deleted", which still has rows to clear, while a page we never parsed
    // layers for must be left alone.
    if (!Array.isArray(page?.layers)) continue;

    const pageSheet = getDirectChildren(pageEl, 'PageSheet')[0];
    if (!pageSheet) continue;

    const hasSection = getDirectChildren(pageSheet, 'Section')
      .some(section => section.getAttribute('N') === 'Layer');
    if (!hasSection && !page.layers.length) continue;

    const layerSection = getOrCreateLayerSection(doc, pageSheet);

    for (const [layer, row] of reconcileLayerRows(doc, layerSection, page.layers)) {
      setCellValue(doc, row, 'Name', String(layer.name || `Layer ${layer.index}`));
      setCellValue(doc, row, 'NameUniv', String(layer.nameUniv || layer.name || `Layer ${layer.index}`));
      setCellValue(doc, row, 'Visible', boolToCellValue(layer.visible, true));
      setCellValue(doc, row, 'Print', boolToCellValue(layer.print, true));
      setCellValue(doc, row, 'Active', boolToCellValue(layer.active, false));
      setCellValue(doc, row, 'Lock', boolToCellValue(layer.lock, false));
      setCellValue(doc, row, 'Snap', boolToCellValue(layer.snap, true));
      setCellValue(doc, row, 'Glue', boolToCellValue(layer.glue, true));
      if (layer.color !== null && layer.color !== undefined && layer.color !== '') {
        setCellValue(doc, row, 'Color', String(layer.color));
      }
      if (layer.colorTrans !== null && layer.colorTrans !== undefined && layer.colorTrans !== '') {
        setCellValue(doc, row, 'ColorTrans', String(layer.colorTrans));
      }
    }
  }

  const xml = new XMLSerializer().serializeToString(doc);
  zip.file('visio/pages/pages.xml', xml);

  // Tags have no native cell to live in, so they go to the Solution XML store.
  // Doing it here (rather than in one caller) means every save path — plain
  // save, prune, export — carries them along.
  await writeLayerTagsToZip(zip, pages, tagColors);
}

async function reconcileVsdxPages(zip, pages) {
  if (!Array.isArray(pages)) return;
  const pagesPath = 'visio/pages/pages.xml';
  const pagesXml = await readZipText(zip, pagesPath);
  if (!pagesXml) throw new Error('VSDX package is missing visio/pages/pages.xml');

  const pagesDoc = parseXml(pagesXml);
  const pageEls = [...byTag(pagesDoc, 'Page')];
  const wantedIds = new Set(pages.map(page => String(page.id)));
  const pageElById = new Map(pageEls.map(pageEl => [String(pageEl.getAttribute('ID')), pageEl]));
  const removedPageEls = pageEls.filter(pageEl => !wantedIds.has(String(pageEl.getAttribute('ID'))));

  const relsPath = 'visio/pages/_rels/pages.xml.rels';
  const relsXml = await readZipText(zip, relsPath);
  const relsDoc = relsXml ? parseXml(relsXml) : null;
  const relationshipEls = relsDoc ? [...byTag(relsDoc, 'Relationship')] : [];
  const relationshipById = new Map(relationshipEls.map(rel => [rel.getAttribute('Id'), rel]));
  const removedPartNames = new Set();

  for (const pageEl of removedPageEls) {
    const relEl = byTag(pageEl, 'Rel')[0];
    const rId = relEl ? (relEl.getAttribute('r:id') || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : null;
    const relationship = rId ? relationshipById.get(rId) : null;
    const pagePath = resolveZipTarget(pagesPath, relationship?.getAttribute('Target'));
    if (pagePath) {
      zip.remove(pagePath);
      zip.remove(pagePath.replace(/([^/]*)$/, '_rels/$1.rels'));
      removedPartNames.add('/' + pagePath.toLowerCase());
    }
    if (relationship?.parentNode) relationship.parentNode.removeChild(relationship);
    if (pageEl.parentNode) pageEl.parentNode.removeChild(pageEl);
  }

  const pagesParent = pageEls.find(pageEl => pageEl.parentNode)?.parentNode;
  if (pagesParent) {
    for (const page of pages) {
      const pageEl = pageElById.get(String(page.id));
      if (pageEl?.parentNode) {
        if (page.name) pageEl.setAttribute('Name', String(page.name));
        pagesParent.appendChild(pageEl);
      }
    }
  }

  if (relsDoc && removedPageEls.length) {
    zip.file(relsPath, new XMLSerializer().serializeToString(relsDoc));
  }
  if (removedPartNames.size) {
    const contentTypesPath = '[Content_Types].xml';
    const contentTypesXml = await readZipText(zip, contentTypesPath);
    if (contentTypesXml) {
      const contentTypesDoc = parseXml(contentTypesXml);
      for (const override of [...byTag(contentTypesDoc, 'Override')]) {
        if (removedPartNames.has(String(override.getAttribute('PartName')).toLowerCase())) {
          override.parentNode.removeChild(override);
        }
      }
      zip.file(contentTypesPath, new XMLSerializer().serializeToString(contentTypesDoc));
    }
  }
  zip.file(pagesPath, new XMLSerializer().serializeToString(pagesDoc));
}

function indexShapesById(shapes, index = new Map()) {
  for (const shape of shapes || []) {
    if (shape?.id !== null && shape?.id !== undefined) index.set(String(shape.id), shape);
    indexShapesById(shape.subShapes, index);
  }
  return index;
}

function patchShapeLayerMembers(doc, parentEl, shapesById) {
  for (const shapeEl of getDirectChildren(parentEl, 'Shape')) {
    const id = shapeEl.getAttribute('ID');
    const shape = id ? shapesById.get(String(id)) : null;
    if (shape) {
      const nextName = String(shape.name || '').trim();
      const nextNameU = String(shape.nameU || nextName).trim();
      if (nextName) shapeEl.setAttribute('Name', nextName);
      else shapeEl.removeAttribute('Name');
      if (nextNameU) shapeEl.setAttribute('NameU', nextNameU);
      else shapeEl.removeAttribute('NameU');

      const members = (shape.layerMembers || []).map(value => String(value)).filter(Boolean);
      if (members.length > 0) {
        setCellValue(doc, shapeEl, 'LayerMember', members.join(';'));
      } else if (getCell(shapeEl, 'LayerMember') || shape.layerMemberInherited) {
        // Deleting the cell is not the same as clearing it: LayerMember is
        // inherited, so a shape stripped of its layers would silently pick its
        // master's up again. Visio's own "on no layer" value is the empty
        // string (see the document defaults), so write that as an override.
        setCellValue(doc, shapeEl, 'LayerMember', '');
      } else {
        // Nothing to inherit from, so leave the shape as bare as it was.
        removeCell(shapeEl, 'LayerMember');
      }
    }
    for (const shapesEl of getDirectChildren(shapeEl, 'Shapes')) {
      patchShapeLayerMembers(doc, shapesEl, shapesById);
    }
  }
}

async function patchVsdxShapeAssignments(zip, pages) {
  const pagesXml = await readZipText(zip, 'visio/pages/pages.xml');
  if (!pagesXml) throw new Error('VSDX package is missing visio/pages/pages.xml');

  const pagesDoc = parseXml(pagesXml);
  const pagesRels = await parseZipRels(zip, 'visio/pages/pages.xml');
  const pageById = new Map((pages || []).map(page => [String(page.id), page]));

  for (const pageEl of byTag(pagesDoc, 'Page')) {
    const page = pageById.get(String(pageEl.getAttribute('ID')));
    if (!page?.shapes?.length) continue;

    const relEl = byTag(pageEl, 'Rel')[0];
    const rId = relEl ? (relEl.getAttribute('r:id') || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : null;
    const pagePath = resolveZipTarget('visio/pages/pages.xml', rId ? pagesRels[rId] : null);
    if (!pagePath) continue;

    const pageXml = await readZipText(zip, pagePath);
    if (!pageXml) continue;

    const pageDoc = parseXml(pageXml);
    const shapesById = indexShapesById(page.shapes);
    for (const shapesEl of getDirectChildren(pageDoc.documentElement, 'Shapes')) {
      patchShapeLayerMembers(pageDoc, shapesEl, shapesById);
    }
    zip.file(pagePath, new XMLSerializer().serializeToString(pageDoc));
  }
}

export async function saveVsdxLayerPermissions(arrayBuffer, pages, viewTemplates, tagColors, layerTree) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  await reconcileVsdxPages(zip, pages);
  await patchVsdxLayerPermissions(zip, pages, tagColors);
  await patchVsdxShapeAssignments(zip, pages);
  // Only touch the view-template store when the caller passes the arg, so
  // other save paths leave any existing presets untouched. Same for the layer
  // folder settings below.
  if (viewTemplates !== undefined) await writeViewTemplatesToZip(zip, viewTemplates);
  if (layerTree !== undefined) await writeLayerTreeToZip(zip, layerTree);
  return zip.generateAsync({ type: 'arraybuffer' });
}

function getShapeLayerMembers(shapeEl) {
  return (getCellValue(shapeEl, 'LayerMember') || '')
    .split(/[;,]/)
    .map(value => value.trim())
    .filter(Boolean);
}

function shapeHasContent(shapeEl) {
  if (getDirectChildren(shapeEl, 'Text').length > 0) return true;
  if (getDirectChildren(shapeEl, 'ForeignData').length > 0) return true;
  if (getDirectChildren(shapeEl, 'Section').some((section) => section.getAttribute('N') === 'Geometry')) return true;
  return false;
}

function pruneShapeElements(parentEl, selectedLayerIndexes, removedShapeIds) {
  let removedCount = 0;
  for (const shapeEl of [...getDirectChildren(parentEl, 'Shape')]) {
    const layerMembers = getShapeLayerMembers(shapeEl);
    const removeShape = layerMembers.length > 0 && layerMembers.every(index => !selectedLayerIndexes.has(index));

    if (removeShape) {
      const id = shapeEl.getAttribute('ID');
      if (id) removedShapeIds.add(id);
      shapeEl.parentNode.removeChild(shapeEl);
      removedCount++;
      continue;
    }

    for (const shapesEl of getDirectChildren(shapeEl, 'Shapes')) {
      removedCount += pruneShapeElements(shapesEl, selectedLayerIndexes, removedShapeIds);
    }

    const remainingChildren = getDirectChildren(shapeEl, 'Shapes')
      .flatMap((shapesEl) => getDirectChildren(shapesEl, 'Shape'));
    const shouldRemoveEmptyGroup = remainingChildren.length === 0 && !shapeHasContent(shapeEl) && layerMembers.length === 0;
    if (shouldRemoveEmptyGroup) {
      const id = shapeEl.getAttribute('ID');
      if (id) removedShapeIds.add(id);
      shapeEl.parentNode.removeChild(shapeEl);
      removedCount++;
    }
  }
  return removedCount;
}

function removeDanglingConnects(pageDoc, removedShapeIds) {
  if (!removedShapeIds.size) return;
  for (const connectEl of [...byTag(pageDoc, 'Connect')]) {
    const fromSheet = connectEl.getAttribute('FromSheet');
    const toSheet = connectEl.getAttribute('ToSheet');
    if (removedShapeIds.has(fromSheet) || removedShapeIds.has(toSheet)) {
      connectEl.parentNode.removeChild(connectEl);
    }
  }
}

function prunePageLayerRows(pageEl, selectedLayerIndexes) {
  const pageSheet = getDirectChildren(pageEl, 'PageSheet')[0];
  if (!pageSheet) return { removedCount: 0, layerIndexMap: new Map() };

  const layerSection = getDirectChildren(pageSheet, 'Section')
    .find((section) => section.getAttribute('N') === 'Layer');
  if (!layerSection) return { removedCount: 0, layerIndexMap: new Map() };

  let removedCount = 0;
  let nextIndex = 0;
  const layerIndexMap = new Map();
  for (const row of [...getDirectChildren(layerSection, 'Row')]) {
    const index = String(row.getAttribute('IX') || '');
    if (!selectedLayerIndexes.has(index)) {
      row.parentNode.removeChild(row);
      removedCount++;
      continue;
    }

    layerIndexMap.set(index, String(nextIndex));
    row.setAttribute('IX', String(nextIndex));
    nextIndex++;
  }
  return { removedCount, layerIndexMap };
}

function remapLayerMemberValue(value, layerIndexMap) {
  const mapped = String(value || '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => layerIndexMap.get(part))
    .filter(Boolean);

  return mapped.length > 0 ? mapped.join(';') : null;
}

function remapShapeLayerMembers(parentEl, layerIndexMap) {
  for (const shapeEl of getDirectChildren(parentEl, 'Shape')) {
    const layerMember = getCell(shapeEl, 'LayerMember');
    if (layerMember) {
      const mappedValue = remapLayerMemberValue(layerMember.getAttribute('V'), layerIndexMap);
      if (mappedValue) layerMember.setAttribute('V', mappedValue);
      else shapeEl.removeChild(layerMember);
    }

    for (const shapesEl of getDirectChildren(shapeEl, 'Shapes')) {
      remapShapeLayerMembers(shapesEl, layerIndexMap);
    }
  }
}

function collectVisibleShapeIdsFromRenderedPage(page, hiddenLayerIndexes) {
  const renderHost = document.createElement('div');
  const hiddenIndexes = new Set([...hiddenLayerIndexes].map(index => String(index)));
  const renderedPage = {
    ...page,
    layers: (page.layers || []).map(layer => ({
      ...layer,
      visible: !hiddenIndexes.has(String(layer.index))
    }))
  };

  renderPage(renderedPage, renderHost);
  const visibleShapeIds = new Set();
  const groups = renderHost.querySelectorAll('g[data-shape-id]');

  for (const group of groups) {
    const id = group.getAttribute('data-shape-id');
    if (!id) continue;

    let hidden = false;
    let node = group;
    while (node && node !== renderHost) {
      if (node.nodeType === 1) {
        const displayAttr = node.getAttribute?.('display');
        const displayStyle = node.style?.display;
        if (displayAttr === 'none' || displayStyle === 'none') {
          hidden = true;
          break;
        }
      }
      node = node.parentNode;
    }

    if (!hidden) visibleShapeIds.add(String(id));
  }

  return visibleShapeIds;
}

function pruneNonVisibleShapeElements(parentEl, visibleShapeIds, removedShapeIds) {
  let removedCount = 0;
  for (const shapeEl of [...getDirectChildren(parentEl, 'Shape')]) {
    const id = shapeEl.getAttribute('ID');
    const keepShape = id && visibleShapeIds.has(String(id));

    if (!keepShape) {
      if (id) removedShapeIds.add(id);
      shapeEl.parentNode.removeChild(shapeEl);
      removedCount++;
      continue;
    }

    for (const shapesEl of getDirectChildren(shapeEl, 'Shapes')) {
      removedCount += pruneNonVisibleShapeElements(shapesEl, visibleShapeIds, removedShapeIds);
    }
  }
  return removedCount;
}

export async function saveVsdxWithoutNonSelectedLayers(arrayBuffer, pages, pageId, selectedLayerIndexes) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  await patchVsdxLayerPermissions(zip, pages);
  await patchVsdxShapeAssignments(zip, pages);

  const pagesXml = await readZipText(zip, 'visio/pages/pages.xml');
  if (!pagesXml) throw new Error('VSDX package is missing visio/pages/pages.xml');

  const pagesDoc = parseXml(pagesXml);
  const pagesRels = await parseZipRels(zip, 'visio/pages/pages.xml');
  const pageEl = [...byTag(pagesDoc, 'Page')].find(el => String(el.getAttribute('ID')) === String(pageId));
  if (!pageEl) throw new Error('Could not find the current page in the VSDX package');

  const relEl = byTag(pageEl, 'Rel')[0];
  const rId = relEl ? (relEl.getAttribute('r:id') || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : null;
  const pagePath = resolveZipTarget('visio/pages/pages.xml', rId ? pagesRels[rId] : null);
  if (!pagePath) throw new Error('Could not resolve the current page drawing part');

  const pageXml = await readZipText(zip, pagePath);
  if (!pageXml) throw new Error(`VSDX package is missing ${pagePath}`);

  const pageDoc = parseXml(pageXml);
  const removedShapeIds = new Set();
  let removedCount = 0;
  for (const shapesEl of getDirectChildren(pageDoc.documentElement, 'Shapes')) {
    removedCount += pruneShapeElements(shapesEl, selectedLayerIndexes, removedShapeIds);
  }
  removeDanglingConnects(pageDoc, removedShapeIds);

  const { removedCount: removedLayerRows, layerIndexMap } = prunePageLayerRows(pageEl, selectedLayerIndexes);
  if (layerIndexMap.size > 0) {
    for (const shapesEl of getDirectChildren(pageDoc.documentElement, 'Shapes')) {
      remapShapeLayerMembers(shapesEl, layerIndexMap);
    }
  }
  zip.file(pagePath, new XMLSerializer().serializeToString(pageDoc));
  zip.file('visio/pages/pages.xml', new XMLSerializer().serializeToString(pagesDoc));
  return {
    buffer: await zip.generateAsync({ type: 'arraybuffer' }),
    removedCount: removedCount + removedLayerRows
  };
}

export async function saveVsdxWithoutHiddenLayers(arrayBuffer, pages, pageId, hiddenLayerIndexes) {
  const page = (pages || []).find(candidate => String(candidate.id) === String(pageId));
  if (!page) throw new Error('Could not find the current page in the parsed model');

  const selectedLayerIndexes = new Set((page.layers || [])
    .map(layer => String(layer.index))
    .filter(index => !hiddenLayerIndexes.has(index)));

  return saveVsdxWithoutNonSelectedLayers(arrayBuffer, pages, pageId, selectedLayerIndexes);
}

export async function saveVsdxWithoutNonVisibleData(arrayBuffer, pages, pageId, hiddenLayerIndexes = new Set()) {
  const page = (pages || []).find(candidate => String(candidate.id) === String(pageId));
  if (!page) throw new Error('Could not find the current page in the parsed model');

  const hiddenIndexes = new Set([...hiddenLayerIndexes].map(index => String(index)));
  const visibleShapeIds = collectVisibleShapeIdsFromRenderedPage(page, hiddenIndexes);

  const zip = await JSZip.loadAsync(arrayBuffer);
  await patchVsdxLayerPermissions(zip, pages);
  await patchVsdxShapeAssignments(zip, pages);

  const pagesXml = await readZipText(zip, 'visio/pages/pages.xml');
  if (!pagesXml) throw new Error('VSDX package is missing visio/pages/pages.xml');

  const pagesDoc = parseXml(pagesXml);
  const pagesRels = await parseZipRels(zip, 'visio/pages/pages.xml');
  const pageEl = [...byTag(pagesDoc, 'Page')].find(el => String(el.getAttribute('ID')) === String(pageId));
  if (!pageEl) throw new Error('Could not find the current page in the VSDX package');

  const relEl = byTag(pageEl, 'Rel')[0];
  const rId = relEl ? (relEl.getAttribute('r:id') || relEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : null;
  const pagePath = resolveZipTarget('visio/pages/pages.xml', rId ? pagesRels[rId] : null);
  if (!pagePath) throw new Error('Could not resolve the current page drawing part');

  const pageXml = await readZipText(zip, pagePath);
  if (!pageXml) throw new Error(`VSDX package is missing ${pagePath}`);

  const pageDoc = parseXml(pageXml);
  const removedShapeIds = new Set();
  let removedCount = 0;
  for (const shapesEl of getDirectChildren(pageDoc.documentElement, 'Shapes')) {
    removedCount += pruneNonVisibleShapeElements(shapesEl, visibleShapeIds, removedShapeIds);
  }
  removeDanglingConnects(pageDoc, removedShapeIds);

  zip.file(pagePath, new XMLSerializer().serializeToString(pageDoc));
  return {
    buffer: await zip.generateAsync({ type: 'arraybuffer' }),
    removedCount
  };
}
