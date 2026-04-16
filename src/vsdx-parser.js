import JSZip from 'jszip';
import { inheritFromMaster, resolveFields } from './shape-inheritance.js';

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
    return shapeGeo.map(sec => ({
      rows: [...sec.rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
      noFill: sec.noFill ?? false,
      noLine: sec.noLine ?? false,
      noShow: sec.noShow ?? false
    }));
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
  const fillPattern = getCellFloat(shapeEl, 'FillPattern') ?? (masterShape ? getCellFloat(masterShape.el, 'FillPattern') : null) ?? styleCellFloat(styleSheets, fillStyleId, 'FillPattern', 'fill') ?? 1;
  const fillGradientDir = getCellFloat(shapeEl, 'FillGradientDir') ?? (masterShape ? getCellFloat(masterShape.el, 'FillGradientDir') : null);
  const shapeGradientStops = parseFillGradientStops(shapeEl, themeColors, colorPalette);
  const masterGradientStops = masterShape ? parseFillGradientStops(masterShape.el, themeColors, colorPalette) : [];
  const fillGradientStops = shapeGradientStops.length > 0 ? shapeGradientStops : masterGradientStops;
  const rounding = getCellFloat(shapeEl, 'Rounding') ?? (masterShape ? getCellFloat(masterShape.el, 'Rounding') : null) ?? 0;
  const beginArrow = getCellFloat(shapeEl, 'BeginArrow') ?? (masterShape ? getCellFloat(masterShape.el, 'BeginArrow') : null) ?? 0;
  const endArrow = getCellFloat(shapeEl, 'EndArrow') ?? (masterShape ? getCellFloat(masterShape.el, 'EndArrow') : null) ?? 0;
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

  if (!fillForeground && fillPattern !== 0) {
    if (fillBackground && fontColor && isLightColor(fontColor)) {
      fillForeground = fillBackground;
    } else if (themeColors.lt1 && fontColor && !isLightColor(fontColor)) {
      fillForeground = themeColors.lt1;
    } else if (fillBackground) {
      fillForeground = fillBackground;
    }
  }

  // Layer membership - can be a single index or semicolon-separated list
  const layerMemberRaw = getCellValue(shapeEl, 'LayerMember') ?? (masterShape ? getCellValue(masterShape.el, 'LayerMember') : null);
  const layerMembers = layerMemberRaw
    ? layerMemberRaw.split(';').map(s => s.trim()).filter(Boolean)
    : [];

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
    type,
    pinX, pinY,
    width, height,
    locPinX, locPinY,
    txtPinX, txtPinY,
    txtWidth, txtHeight,
    angle,
    flipX: flipX === '1',
    flipY: flipY === '1',
    lineColor,
    lineWeight,
    linePattern,
    fillForeground,
    fillBackground,
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
      _fields: masterText.fields.map(f => f.ix != null && masterFields[f.ix] ? masterFields[f.ix] : f),
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
      if (target) {
        const masterPath = 'visio/masters/' + target;
        const masterContent = await readFile(masterPath);
        if (masterContent) {
          const masterDoc = parseXml(masterContent);
          masterShapes = parseMasterShapes(masterDoc);
        }
      }
      masters.set(id, { id, name, ...masterShapes });
    }
  }

  // Parse pages
  const pages = [];
  const pagesXml = await readFile('visio/pages/pages.xml');
  if (!pagesXml) return { pages: [], masters };

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
          const name = getCellValue(row, 'Name') || getCellValue(row, 'NameUniv') || `Layer ${ix}`;
          const visible = getCellValue(row, 'Visible');
          layers.push({
            index: ix,
            name,
            visible: visible !== '0'
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

  return { pages, masters, themeColors, colorPalette, styleSheets };
}
