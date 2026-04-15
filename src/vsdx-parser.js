import JSZip from 'jszip';
import { inheritFromMaster, resolveFields } from './shape-inheritance.js';

// Visio standard color palette (indices 0-25)
const VISIO_COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
  '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000',
  '#800080', '#008080', '#C0C0C0', '#808080', '#9999FF', '#993366',
  '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
  '#000080', '#FF00FF'
];

function parseColor(value) {
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
  if (!isNaN(idx) && idx >= 0 && idx < VISIO_COLORS.length) return VISIO_COLORS[idx];
  return null;
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
// at every <fld>/<cp>/<pp>/<tp> position. The resulting string can be fed to
// resolveFields() which substitutes each placeholder with the resolved field
// value. We use U+FFFC uniformly so both the .vsd and .vsdx sides share the
// same splicer. Fields are returned in document order so ctx.fields[i] aligns
// with the i-th placeholder.
function serializeTextWithFields(textEl) {
  let out = '';
  const fields = [];
  function walk(node) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes[i];
      if (n.nodeType === 3) {
        out += n.nodeValue;
      } else if (n.nodeType === 1) {
        const name = n.localName;
        if (name === 'fld') {
          // <fld IX='N'/> — IX references a Field section row on this shape.
          const ix = n.getAttribute('IX');
          fields.push({ ix: ix != null ? parseInt(ix, 10) : null, _el: n });
          out += '\uFFFC';
        } else if (name === 'cp' || name === 'pp' || name === 'tp') {
          // Character / paragraph / tab properties index — purely formatting,
          // no runtime value. Skip silently.
        } else {
          walk(n);
        }
      }
    }
  }
  walk(textEl);
  return { text: out, fields };
}

function getTextContent(shapeEl) {
  const textEls = getDirectChildren(shapeEl, 'Text');
  if (textEls.length === 0) return { text: '', fields: [] };
  const { text, fields } = serializeTextWithFields(textEls[0]);
  return { text: text.replace(/\n$/, ''), fields };
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
    sections.push({ ix, rowMap, noFill: noFill === '1', noLine: noLine === '1', noShow: noShow === '1' });
  }
  return sections;
}

// Merge master geometry with shape geometry (shape overrides master by IX)
function mergeGeometry(masterEl, shapeEl) {
  const masterGeo = masterEl ? parseGeometryRaw(masterEl) : [];
  const shapeGeo = parseGeometryRaw(shapeEl);

  // If shape has its own geometry sections, merge with master by section IX
  if (shapeGeo.length === 0 && masterGeo.length === 0) return [];
  if (shapeGeo.length === 0) {
    // Use master geometry as-is
    return masterGeo.filter(s => !s.noShow).map(sec => ({
      rows: [...sec.rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
      noFill: sec.noFill,
      noLine: sec.noLine
    }));
  }
  if (masterGeo.length === 0) {
    return shapeGeo.filter(s => !s.noShow).map(sec => ({
      rows: [...sec.rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
      noFill: sec.noFill,
      noLine: sec.noLine
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
    // Override with shape rows
    for (const [ix, row] of shapeSec.rowMap) mergedRowMap.set(ix, row);

    const noShow = shapeSec.noShow || (masterSec?.noShow && !shapeGeo.find(s => s.ix === shapeSec.ix));
    if (noShow) continue;

    merged.push({
      rows: [...mergedRowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
      noFill: shapeSec.noFill || (masterSec?.noFill ?? false),
      noLine: shapeSec.noLine || (masterSec?.noLine ?? false)
    });
  }
  // Add master sections not present in shape
  for (const masterSec of masterGeo) {
    if (!seenIx.has(masterSec.ix) && !masterSec.noShow) {
      merged.push({
        rows: [...masterSec.rowMap.values()].filter(r => !r.del).sort((a, b) => parseInt(a.ix) - parseInt(b.ix)),
        noFill: masterSec.noFill,
        noLine: masterSec.noLine
      });
    }
  }

  return merged;
}

function parseShape(shapeEl, masters, parentMaster) {
  const id = shapeEl.getAttribute('ID');
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
  const angle = getCellFloat(shapeEl, 'Angle') ?? (masterShape ? getCellFloat(masterShape.el, 'Angle') : null) ?? 0;
  const flipX = getCellValue(shapeEl, 'FlipX') ?? (masterShape ? getCellValue(masterShape.el, 'FlipX') : null);
  const flipY = getCellValue(shapeEl, 'FlipY') ?? (masterShape ? getCellValue(masterShape.el, 'FlipY') : null);

  // Style cells
  const lineColor = parseColor(getCellValue(shapeEl, 'LineColor')) ?? (masterShape ? parseColor(getCellValue(masterShape.el, 'LineColor')) : null) ?? '#000000';
  const lineWeight = getCellFloat(shapeEl, 'LineWeight') ?? (masterShape ? getCellFloat(masterShape.el, 'LineWeight') : null) ?? 0.01;
  const linePattern = getCellFloat(shapeEl, 'LinePattern') ?? (masterShape ? getCellFloat(masterShape.el, 'LinePattern') : null) ?? 1;
  const fillForeground = parseColor(getCellValue(shapeEl, 'FillForegnd')) ?? (masterShape ? parseColor(getCellValue(masterShape.el, 'FillForegnd')) : null);
  const fillBackground = parseColor(getCellValue(shapeEl, 'FillBkgnd')) ?? (masterShape ? parseColor(getCellValue(masterShape.el, 'FillBkgnd')) : null);
  const fillPattern = getCellFloat(shapeEl, 'FillPattern') ?? (masterShape ? getCellFloat(masterShape.el, 'FillPattern') : null) ?? 1;
  const rounding = getCellFloat(shapeEl, 'Rounding') ?? (masterShape ? getCellFloat(masterShape.el, 'Rounding') : null) ?? 0;
  const beginArrow = getCellFloat(shapeEl, 'BeginArrow') ?? (masterShape ? getCellFloat(masterShape.el, 'BeginArrow') : null) ?? 0;
  const endArrow = getCellFloat(shapeEl, 'EndArrow') ?? (masterShape ? getCellFloat(masterShape.el, 'EndArrow') : null) ?? 0;

  // Text style
  const charSections = getDirectChildren(shapeEl, 'Section').filter(s => s.getAttribute('N') === 'Character');
  let fontSize = null;
  let fontColor = null;
  let bold = false;
  let italic = false;
  if (charSections.length > 0) {
    const charRows = getDirectChildren(charSections[0], 'Row');
    if (charRows.length > 0) {
      fontSize = getCellFloat(charRows[0], 'Size');
      fontColor = parseColor(getCellValue(charRows[0], 'Color'));
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
        fontColor = fontColor ?? parseColor(getCellValue(mCharRows[0], 'Color'));
      }
    }
  }

  // Layer membership - can be a single index or semicolon-separated list
  const layerMemberRaw = getCellValue(shapeEl, 'LayerMember') ?? (masterShape ? getCellValue(masterShape.el, 'LayerMember') : null);
  const layerMembers = layerMemberRaw
    ? layerMemberRaw.split(';').map(s => s.trim()).filter(Boolean)
    : [];

  // Geometry - merge shape geometry with master geometry
  const geometry = mergeGeometry(masterShape?.el ?? null, shapeEl);

  // Sub-shapes (groups). Propagate the current shape's master so that nested
  // children with only a `MasterShape` attribute can resolve the sibling
  // definition inside the same master.
  const subShapes = [];
  const shapesContainer = getDirectChildren(shapeEl, 'Shapes');
  if (shapesContainer.length > 0) {
    const childShapeEls = getDirectChildren(shapesContainer[0], 'Shape');
    for (const childEl of childShapeEls) {
      subShapes.push(parseShape(childEl, masters, master));
    }
  }

  const { text: rawText, fields: inlineFields } = getTextContent(shapeEl);

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

  const shape = {
    id,
    masterId,
    type,
    pinX, pinY,
    width, height,
    locPinX, locPinY,
    angle,
    flipX: flipX === '1',
    flipY: flipY === '1',
    lineColor,
    lineWeight,
    linePattern,
    fillForeground,
    fillBackground,
    fillPattern,
    rounding,
    beginArrow,
    endArrow,
    fontSize,
    fontColor,
    bold,
    italic,
    geometry,
    subShapes,
    text: rawText,
    layerMembers,
    propMap,
    userMap,
    _fields: orderedFields
  };

  // Inherit text (and any character style we still don't have) from the
  // master. When the shape has no text of its own, the master's text + its
  // ordered field table become the defaults.
  if (masterShape) {
    const masterText = serializeTextWithFields(masterShape.el);
    const masterInherit = {
      text: masterText.text.replace(/\n$/, ''),
      fontSize: null, fontColor: null, bold: null, italic: null,
      _fields: masterText.fields.map(f => f.ix != null && masterFields[f.ix] ? masterFields[f.ix] : f),
      propMap: {}, userMap: {}
    };
    // Master character row 0
    const mCharSections = getDirectChildren(masterShape.el, 'Section').filter(s => s.getAttribute('N') === 'Character');
    if (mCharSections.length > 0) {
      const mCharRows = getDirectChildren(mCharSections[0], 'Row');
      if (mCharRows.length > 0) {
        masterInherit.fontSize = getCellFloat(mCharRows[0], 'Size');
        masterInherit.fontColor = parseColor(getCellValue(mCharRows[0], 'Color'));
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
    if (pageSheet) {
      const pwCell = getCell(pageSheet, 'PageWidth');
      const u = pwCell ? pwCell.getAttribute('U') : null;
      if (u === 'MM') drawingUnitInInches = 1 / 25.4;
      else if (u === 'CM') drawingUnitInInches = 1 / 2.54;
      else if (u === 'M') drawingUnitInInches = 1 / 0.0254;
      else if (u === 'PT') drawingUnitInInches = 1 / 72;
      else if (u === 'FT' || u === 'FT_C') drawingUnitInInches = 12;
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
            shapes.push(parseShape(shapeEl, masters));
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
      isBackground,
      backPage,
      layers,
      shapes,
      connects
    });
  }

  return { pages, masters };
}
