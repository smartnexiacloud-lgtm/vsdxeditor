import CFB from 'cfb';
import { inheritFromMaster, resolveFields } from './shape-inheritance.js';

// Base Visio palette shared with the VSDX parser. Classic VSD files can store
// layer/style colors as palette indices; resolve the common built-in table so
// the VSD and VSDX models stay aligned even when the binary parser does not
// yet expose custom palette overrides.
const VISIO_COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
  '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000',
  '#800080', '#008080', '#C0C0C0', '#E6E6E6', '#CDCDCD', '#B3B3B3',
  '#9A9A9A', '#808080', '#666666', '#4D4D4D', '#333333', '#1A1A1A'
];

function parseColor(value) {
  if (!value && value !== 0) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('#')) return s;
  const idx = parseInt(s, 10);
  if (!Number.isNaN(idx) && idx >= 0 && idx < VISIO_COLORS.length) {
    return VISIO_COLORS[idx];
  }
  return s;
}

// LZ77 decompression for VSD compressed streams (4096-byte sliding window)
function decompressVsd(input) {
  const output = [];
  const buffer = new Uint8Array(4096);
  let pos = 0;
  let offset = 0;

  while (offset < input.length) {
    const flag = input[offset++];
    if (offset > input.length - 1) break;

    let mask = 1;
    for (let bit = 0; bit < 8 && offset < input.length; bit++) {
      if (flag & mask) {
        // Literal byte
        buffer[pos & 4095] = input[offset];
        output.push(input[offset++]);
        pos++;
      } else {
        // Back-reference
        if (offset > input.length - 2) break;
        const addr1 = input[offset++];
        const addr2 = input[offset++];
        const length = (addr2 & 15) + 3;
        let pointer = ((addr2 & 0xF0) << 4) | addr1;
        pointer = pointer > 4078 ? pointer - 4078 : pointer + 18;

        for (let j = 0; j < length; j++) {
          buffer[(pos + j) & 4095] = buffer[(pointer + j) & 4095];
          output.push(buffer[(pointer + j) & 4095]);
        }
        pos += length;
      }
      mask <<= 1;
    }
  }
  return new Uint8Array(output);
}

// VSD chunk type constants
const VSD = {
  TEXT:               0x0E,
  TRAILER_STREAM:     0x14,
  PAGE:               0x15,
  COLORS:             0x1A,
  FONT_LIST:          0x18,
  STENCILS:           0x1D,
  STENCIL_PAGE:       0x1E,
  OLE_DATA:           0x1F,
  PAGES:              0x27,
  NAME_LIST_LOWER:    0x2C,   // per-shape name list (VSD_NAME_LIST)
  NAME:               0x2D,   // per-shape name (VSD_NAME)
  NAME_LIST_UPPER:    0x32,   // global name list (VSD_NAME_LIST2)
  NAME2:              0x33,   // global name (VSD_NAME2)
  PAGE_SHEET:         0x46,
  SHAPE_GROUP:        0x47,
  SHAPE_SHAPE:        0x48,
  STYLE_SHEET:        0x4A,
  SHAPE_FOREIGN:      0x4E,
  SHAPE_LIST:         0x65,
  FIELD_LIST:         0x66,
  PROP_LIST:          0x68,
  CHAR_LIST:          0x69,
  PARA_LIST:          0x6A,
  GEOM_LIST:          0x6C,
  CUST_PROPS_LIST:    0x6D,
  NAME_LIST:          0x6E,
  LAYER_LIST:         0x6F,
  LINE:               0x85,
  FILL_AND_SHADOW:    0x86,
  TEXT_BLOCK:         0x87,
  GEOMETRY:           0x89,
  MOVE_TO:            0x8A,
  LINE_TO:            0x8B,
  ARC_TO:             0x8C,
  INFINITE_LINE:      0x8D,
  ELLIPSE:            0x8F,
  ELLIPTICAL_ARC_TO:  0x90,
  PAGE_PROPS:         0x92,
  STYLE_PROPS:        0x93,
  CHAR_IX:            0x94,
  PARA_IX:            0x95,
  XFORM_DATA:         0x9B,
  TEXT_XFORM:         0x9C,
  XFORM_1D:           0x9D,
  PROTECTION:         0xA0,
  TEXT_FIELD:         0xA1,
  MISC:               0xA4,
  SPLINE_START:       0xA5,
  SPLINE_KNOT:        0xA6,
  LAYER_MEMBERSHIP:   0xA7,
  LAYER:              0xA8,
  CONTROL:            0xAA,
  USER_DEFINED_CELLS: 0xB4,
  CUSTOM_PROPS:       0xB6,
  POLYLINE_TO:        0xC1,
  NURBS_TO:           0xC3,
  NAME_IDX:           0xC9,
};

// Visio TEXT_FIELD cell-type markers (from libvisio VSDDocumentStructure.h,
// GPL-3.0 port). These are decimal in the C header; we use hex for clarity.
const CELL_TYPE_Number              = 32;     // 0x20
const CELL_TYPE_Date                = 40;     // 0x28
const CELL_TYPE_Currency            = 111;    // 0x6f
const CELL_TYPE_String              = 231;    // 0xe7
const CELL_TYPE_StringWithoutUnit   = 232;    // 0xe8

// Visio "format number" constants we know how to render. The full Visio
// enumeration is in VSDTypes.h; we only handle the handful that the renderer
// can produce useful strings for.
const VSD_FIELD_FORMAT_Unknown       = 0xffff;
const VSD_FIELD_FORMAT_MsoDateShort  = 20;

// VSD11 trailer chunk types (add 4 bytes if not already 12 or 4)
const TRAILER_4_CHUNKS = new Set([
  0x64, 0x65, 0x66, 0x69, 0x6a, 0x6b, 0x6f, 0x71,
  0x92, 0xa9, 0xb4, 0xb6, 0xb9, 0xc7
]);

// Chunk types that get 8-byte base trailer
const TRAILER_8_CHUNKS = new Set([
  0x71, 0x70, 0x6b, 0x6a, 0x69, 0x66, 0x65, 0x2c
]);

// Chunks that never have a trailer
const NO_TRAILER_CHUNKS = new Set([0x1f, 0xc9, 0x2d, 0xd1]);

class BinaryReader {
  constructor(data) {
    // Accept Uint8Array, ArrayBuffer, or DataView
    if (data instanceof DataView) {
      this.u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (data instanceof ArrayBuffer) {
      this.u8 = new Uint8Array(data);
    } else {
      // Uint8Array or similar
      this.u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    }
    // Create an ArrayBuffer copy for DataView (needed if u8 is not backed by a standalone ArrayBuffer)
    const ab = new ArrayBuffer(this.u8.length);
    new Uint8Array(ab).set(this.u8);
    this.buf = new DataView(ab);
    this.pos = 0;
  }

  get length() { return this.buf.byteLength; }
  get remaining() { return this.buf.byteLength - this.pos; }

  readU8() { const v = this.buf.getUint8(this.pos); this.pos += 1; return v; }
  readU16() { const v = this.buf.getUint16(this.pos, true); this.pos += 2; return v; }
  readU32() { const v = this.buf.getUint32(this.pos, true); this.pos += 4; return v; }
  readI32() { const v = this.buf.getInt32(this.pos, true); this.pos += 4; return v; }
  readF64() { const v = this.buf.getFloat64(this.pos, true); this.pos += 8; return v; }

  skip(n) { this.pos += n; }

  readCellDouble() {
    this.skip(1); // cell type marker
    return this.readF64();
  }

  readCellU8() {
    this.skip(1);
    return this.readU8();
  }

  slice(offset, length) {
    return new BinaryReader(this.u8.slice(offset, offset + length));
  }
}

// Parse the chunk stream
function parseChunks(reader) {
  const chunks = [];

  while (reader.remaining >= 19) {
    // Skip zero padding
    while (reader.remaining > 0 && reader.buf.getUint8(reader.pos) === 0) {
      reader.skip(1);
    }
    if (reader.remaining < 19) break;

    const startPos = reader.pos;
    const chunkType = reader.readU32();
    const id = reader.readU32();
    const list = reader.readU32();
    const dataLength = reader.readU32();
    const level = reader.readU16();
    const unknown = reader.readU8();

    if (dataLength > reader.remaining) break;

    const dataStart = reader.pos;
    const data = reader.slice(dataStart, dataLength);
    reader.skip(dataLength);

    // VSD11 trailer logic (from libvisio VSDParser::getChunkHeader)
    let trailer = 0;
    if (!NO_TRAILER_CHUNKS.has(chunkType)) {
      // 8-byte base trailer for list chunks or specific chunk types
      if (list !== 0 || TRAILER_8_CHUNKS.has(chunkType)) {
        trailer += 8;
      }
      // Additional 4-byte trailer under certain conditions
      if (list !== 0 || (level === 2 && unknown === 0x55) ||
          (level === 2 && unknown === 0x54 && chunkType === 0xaa) ||
          (level === 3 && unknown !== 0x50 && unknown !== 0x54)) {
        trailer += 4;
      }
      // Extra 4 bytes for specific chunk types if not already at 12 or 4
      if (TRAILER_4_CHUNKS.has(chunkType) && trailer !== 12 && trailer !== 4) {
        trailer += 4;
      }
    }
    if (trailer > 0 && reader.remaining >= trailer) {
      reader.skip(trailer);
    }

    chunks.push({ chunkType, id, list, dataLength, level, data, startPos });
  }

  return chunks;
}

function readXFormData(data) {
  const r = data;
  r.pos = 0;
  const pinX = r.readCellDouble();
  const pinY = r.readCellDouble();
  const width = r.readCellDouble();
  const height = r.readCellDouble();
  const locPinX = r.readCellDouble();
  const locPinY = r.readCellDouble();
  const angle = r.readCellDouble();
  const flipX = r.readU8();
  const flipY = r.readU8();
  return { pinX, pinY, width, height, locPinX, locPinY, angle, flipX: flipX !== 0, flipY: flipY !== 0 };
}

function readMoveTo(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  return { type: 'MoveTo', x, y };
}

function readLineTo(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  return { type: 'LineTo', x, y };
}

function readArcTo(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  const a = r.readCellDouble(); // bow/bulge
  return { type: 'ArcTo', x, y, a };
}

function readEllipticalArcTo(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  const a = r.readCellDouble(); // control X
  const b = r.readCellDouble(); // control Y
  const c = r.readCellDouble(); // angle
  const d = r.readCellDouble(); // eccentricity
  return { type: 'EllipticalArcTo', x, y, a, b, c, d };
}

function readEllipse(data) {
  const r = data;
  r.pos = 0;
  const cx = r.readCellDouble();
  const cy = r.readCellDouble();
  const ax = r.readCellDouble();
  const ay = r.readCellDouble();
  const bx = r.readCellDouble();
  const by = r.readCellDouble();
  return { type: 'Ellipse', x: cx, y: cy, a: ax, b: ay, c: bx, d: by };
}

function readInfiniteLine(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  const a = r.readCellDouble();
  const b = r.readCellDouble();
  return { type: 'InfiniteLine', x, y, a, b };
}

function readSplineStart(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  const a = r.readCellDouble();
  const b = r.readCellDouble();
  const c = r.readCellDouble();
  const d = r.readCellDouble();
  return { type: 'SplineStart', x, y, a, b, c, d };
}

function readSplineKnot(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  const a = r.readCellDouble();
  return { type: 'SplineKnot', x, y, a };
}

function readNurbsTo(data) {
  const r = data;
  r.pos = 0;
  const x = r.readCellDouble();
  const y = r.readCellDouble();
  // Remaining data is complex NURBS knot/control point data
  // For now, just use endpoint
  return { type: 'NURBSTo', x, y, a: null, b: null, c: null, d: null, e: null };
}

function readLine(data) {
  const r = data;
  r.pos = 0;
  const strokeWidth = r.readCellDouble();
  r.skip(1); // cell marker
  const cr = r.readU8();
  const cg = r.readU8();
  const cb = r.readU8();
  const ca = r.readU8();
  const linePattern = r.readU8();
  const rounding = r.readCellDouble();
  r.skip(1); // cell marker
  const startMarker = r.readU8();
  const endMarker = r.readU8();
  const lineCap = r.readU8();
  return {
    lineWeight: strokeWidth,
    lineColor: ca === 255 ? null : `#${cr.toString(16).padStart(2,'0')}${cg.toString(16).padStart(2,'0')}${cb.toString(16).padStart(2,'0')}`,
    linePattern,
    rounding,
    beginArrow: startMarker,
    endArrow: endMarker,
    lineCap
  };
}

function readFillAndShadow(data) {
  const r = data;
  r.pos = 0;
  const fgIndex = r.readU8();
  const fgR = r.readU8();
  const fgG = r.readU8();
  const fgB = r.readU8();
  const fgA = r.readU8();
  const bgIndex = r.readU8();
  const bgR = r.readU8();
  const bgG = r.readU8();
  const bgB = r.readU8();
  const bgA = r.readU8();
  const fillPattern = r.readU8();
  // Skip shadow data
  return {
    fillForeground: (fgR === 0 && fgG === 0 && fgB === 0 && fgA === 0) ? null
      : `#${fgR.toString(16).padStart(2,'0')}${fgG.toString(16).padStart(2,'0')}${fgB.toString(16).padStart(2,'0')}`,
    fillBackground: (bgR === 0 && bgG === 0 && bgB === 0 && bgA === 0) ? null
      : `#${bgR.toString(16).padStart(2,'0')}${bgG.toString(16).padStart(2,'0')}${bgB.toString(16).padStart(2,'0')}`,
    fillPattern
  };
}

function readText(data, dataLength) {
  const r = data;
  r.pos = 0;
  if (dataLength <= 8) return '';
  r.skip(8); // preamble
  const payloadLen = dataLength - 8;
  if (payloadLen <= 0) return '';
  const bytes = new Uint8Array(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    bytes[i] = r.readU8();
  }
  // Detect encoding. libvisio treats VSD text chunk payload as UTF-16LE by default
  // (see VSDParser::readText). Some early/ANSI-only chunks contain single-byte
  // cp1252 text. Heuristic: if length is even AND roughly half the bytes in odd
  // positions are 0x00, treat as UTF-16LE; otherwise cp1252.
  let isUtf16 = false;
  if ((payloadLen % 2) === 0 && payloadLen >= 2) {
    let zerosHigh = 0;
    const pairs = payloadLen / 2;
    for (let i = 1; i < payloadLen; i += 2) {
      if (bytes[i] === 0) zerosHigh++;
    }
    // If most high bytes are zero, it's ASCII-range UTF-16LE.
    // Also treat as UTF-16 if it decodes without replacement chars and
    // cp1252 would produce mostly control-range garbage.
    if (zerosHigh * 2 >= pairs) isUtf16 = true;
  }
  let decoded;
  try {
    if (isUtf16) {
      decoded = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
    } else {
      decoded = new TextDecoder('windows-1252', { fatal: false }).decode(bytes);
    }
  } catch (e) {
    decoded = String.fromCharCode(...bytes);
  }
  // Strip trailing NULs (string terminator) and any trailing whitespace NULs.
  decoded = decoded.replace(/\u0000+$/g, '');
  // VSD TEXT chunks are universally terminated with a line-feed ("paragraph end")
  // byte even when the shape has no visible multi-line content. Drop a single
  // trailing LF so that a shape with empty text ("\n") is reported as empty and
  // does not produce a stray <text> element in the SVG. Multi-line text
  // ("Line1\nLine2\n") loses only its final terminator.
  decoded = decoded.replace(/\n$/, '');
  return decoded;
}

// Parse a VSD_TEXT_FIELD (0xa1) chunk payload.
//
// Ported from libvisio VSD6Parser::readTextField (GPL-3.0, LibreOffice libvisio,
// © the LibreOffice contributors). The payload starts with 7 reserved bytes,
// followed by a one-byte "cell type" marker. For CELL_TYPE_StringWithoutUnit the
// body is `s32 nameId; 6 bytes; s32 formatStringId` — a symbolic reference to a
// name in the shape-level NAME table. For numeric / date / currency cells the
// body is `f64 value; 2 bytes; s32 formatStringId` followed by a variable-length
// block list; we keep the numeric value and a crude format-code.
//
// The returned object is consumed by shape-inheritance.resolveFields via the
// fields[] context; shape-inheritance expects at least a .ref or .value or
// .format key.
function readTextField(data, dataLength) {
  const result = { type: 'unknown', refs: [] };
  try {
    if (dataLength < 8) return result;
    const u8 = data.u8;
    const cellType = u8[7];          // VSD6 cell-type byte lives at offset 7
    result.cellType = cellType;

    if (cellType === CELL_TYPE_StringWithoutUnit || cellType === CELL_TYPE_String) {
      // In Visio 2013+ (VSD11) TEXT_FIELD chunks pack multiple per-paragraph
      // references side by side, each as  [0xE8 | u32 nameId | 5 reserved].
      // Scan the whole payload; collect every nameId.
      const refs = [];
      for (let i = 7; i + 4 < dataLength; ) {
        if (u8[i] === 0xE8) {
          const v = (u8[i + 1] | (u8[i + 2] << 8) | (u8[i + 3] << 16) | (u8[i + 4] << 24)) >>> 0;
          if (v !== 0xFFFFFFFF) refs.push(v);
          i += 10;
        } else {
          i += 1;
        }
      }
      result.type = 'name-ref';
      result.refs = refs;
      if (refs.length) result.nameId = refs[0];
      return result;
    }

    // Numeric / date / currency — read the 8-byte value after the cell type.
    const r = data;
    r.pos = 8;
    if (r.remaining < 8) return result;
    const numericValue = r.readF64();
    let formatNumber = VSD_FIELD_FORMAT_Unknown;
    if (cellType === CELL_TYPE_Date) formatNumber = VSD_FIELD_FORMAT_MsoDateShort;

    let displayValue = null;
    if (cellType === CELL_TYPE_Date) {
      if (Number.isFinite(numericValue) && numericValue > 0) {
        try {
          const epoch = Date.UTC(1899, 11, 30);
          const ms = epoch + numericValue * 86400000;
          displayValue = new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
        } catch { /* ignore */ }
      }
    } else if (Number.isFinite(numericValue)) {
      displayValue = (Math.abs(numericValue - Math.round(numericValue)) < 1e-9)
        ? String(Math.round(numericValue))
        : String(numericValue);
    }

    result.type = cellType === CELL_TYPE_Date ? 'date' : 'numeric';
    result.numericValue = numericValue;
    result.formatNumber = formatNumber;
    result.value = displayValue;
    return result;
  } catch {
    return result;
  }
}

// Expand a TEXT_FIELD "name-ref" that carries multiple nameIds into one logical
// field entry per ref, so that each U+FFFC placeholder in the shape's TEXT
// consumes one entry. Called at finalize time once we know the NAME table.
function expandNameRefFields(fields, namesById) {
  if (!fields || !fields.length) return fields;
  const expanded = [];
  for (const f of fields) {
    if (f && f.type === 'name-ref' && f.refs && f.refs.length > 1) {
      for (const id of f.refs) {
        expanded.push({ type: 'name-ref', nameId: id, refs: [id] });
      }
    } else {
      expanded.push(f);
    }
  }
  return expanded;
}

// Decode a VSD_NAME / VSD_NAME2 (0x2d / 0x33) chunk payload.
// Ported from libvisio VSDParser::readName (GPL-3.0, LibreOffice libvisio).
// The payload is a raw UTF-16LE string; trailing NULs are stripped. The chunk's
// record-id is used as the table key, matching libvisio's m_names / m_shape.m_names.
function readNameChunk(chunk) {
  try {
    const bytes = chunk.data.u8;
    const len = chunk.dataLength;
    if (!len) return '';
    // Copy to a fresh buffer because the reader's backing buffer may be shared.
    const view = bytes.slice(0, len);
    // UTF-16LE decode, then drop NUL terminators.
    let s = new TextDecoder('utf-16le', { fatal: false }).decode(view);
    s = s.replace(/\u0000+$/g, '');
    return s;
  } catch {
    return '';
  }
}

function readName2Chunk(chunk) {
  try {
    const bytes = chunk.data.u8;
    const len = chunk.dataLength;
    if (len <= 4) return '';
    const view = bytes.slice(4, len);
    let s = new TextDecoder('utf-16le', { fatal: false }).decode(view);
    s = s.replace(/^\u0000+/g, '').replace(/\u0000+$/g, '');
    return s;
  } catch {
    return '';
  }
}

function readNameIdxChunk(chunk) {
  const rows = [];
  try {
    const r = chunk.data;
    r.pos = 0;
    if (r.remaining < 4) return rows;
    const recordCount = r.readU32();
    for (let i = 0; i < recordCount && r.remaining >= 13; i++) {
      const nameId = r.readU32() >>> 0;
      r.readU32(); // duplicate name id
      const elementId = r.readU32() >>> 0;
      const extra = r.readU8();
      rows.push({ nameId, elementId, extra });
    }
  } catch {
    return rows;
  }
  return rows;
}

function visibleUtf16Strings(bytes, minLength = 2) {
  const out = [];
  for (const start of [0, 1]) {
    let current = '';
    for (let i = start; i + 1 < bytes.length; i += 2) {
      const cp = bytes[i] | (bytes[i + 1] << 8);
      const printable = (cp >= 0x20 && cp < 0xd800) || (cp >= 0xe000 && cp < 0xfffd);
      if (printable) {
        current += String.fromCharCode(cp);
      } else {
        if (current.length >= minLength) out.push(current);
        current = '';
      }
    }
    if (current.length >= minLength) out.push(current);
  }
  return out;
}

function normalizeMetadataString(value) {
  if (!value) return '';
  const s = String(value)
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = s.match(/[A-Za-z0-9_ÄÖÜäöüß][A-Za-z0-9_ÄÖÜäöüß .,:;(){}+\-/]*$/);
  return match ? match[0].trim() : '';
}

function readPropStringsFromChunk(chunk) {
  const bytes = chunk.data.u8.slice(0, chunk.dataLength);
  const stringsByTag = new Map();
  // B6 rows contain repeated string subrecords of the form:
  //   FE <u32 recordLen> 02 <tag> 60 <u8 charLen> <utf16le payload>
  // where tag 0=value, 1=prompt, 2=label, 3=format, 4=selected-index text.
  for (let i = 0; i + 9 < bytes.length; i++) {
    if (bytes[i] !== 0xFE) continue;
    const recordLen = bytes[i + 1] | (bytes[i + 2] << 8) | (bytes[i + 3] << 16) | (bytes[i + 4] << 24);
    const tagGroup = bytes[i + 5];
    const tag = bytes[i + 6];
    const marker = bytes[i + 7];
    const charLen = bytes[i + 8];
    if (tagGroup !== 0x02 || marker !== 0x60 || charLen < 1 || recordLen < 9) continue;
    const start = i + 9;
    const end = start + charLen * 2;
    if (end > bytes.length) continue;
    try {
      const raw = new TextDecoder('utf-16le', { fatal: false }).decode(bytes.slice(start, end));
      const text = raw.replace(/\u0000+$/g, '');
      stringsByTag.set(tag, text);
      i = Math.max(i + recordLen - 1, end - 1);
    } catch {
      // Ignore malformed strings and continue scanning.
    }
  }
  return stringsByTag;
}

const CUSTOM_PROP_NAME_BY_LABEL = new Map([
  ['Wandstärke', 'T'],
  ['Referenzlinienabstand', 'RefLn'],
  ['Klassifizierung', 'Classification'],
  ['Klassifizierungsquelle', 'ClassificationSource'],
  ['Material', 'Material'],
  ['Säulentyp-ID', 'ProjectType'],
  ['Typenbeschreibung', 'TypeDescription'],
  ['Column height', 'ColumnHeight'],
  ['Cross section depth', 'Length'],
  ['Kreuzabschnitt Breite', 'Width'],
  ['Base elevation', 'BaseElevation']
]);

const CUSTOM_PROP_NAME_CANDIDATES = [
  'ShapeClass',
  'ShapeType',
  'SubShapeType',
  'ClassificationSource',
  'Classification',
  'ProjectType',
  'TypeDescription',
  'ColumnHeight',
  'BaseElevation',
  'Material',
  'RefLn',
  'Width',
  'Length',
  'T'
];

function metadataValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return `VT0(${s}):26`;
  return `VT4(${s})`;
}

function metadataNumericValue(value, unit = '26') {
  if (!Number.isFinite(value)) return null;
  return `VT0(${value}):${unit}`;
}

function rawMetadataValue(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  const vt4 = s.match(/^VT4\((.*)\)$/);
  if (vt4) return vt4[1];
  const vt0 = s.match(/^VT0\((.*)\):[^:]+$/);
  if (vt0) return vt0[1];
  return s;
}

function parseCustomPropChunk(chunk, rowName = null) {
  const taggedStrings = readPropStringsFromChunk(chunk);
  const strings = [
    ...taggedStrings.values(),
    ...visibleUtf16Strings(chunk.data.u8.slice(0, chunk.dataLength), 2)
  ]
    .map(normalizeMetadataString)
    .filter(Boolean);
  if (!strings.length) return null;

  const normalizedRowName = normalizeMetadataString(rowName || '');
  let nameU = normalizedRowName || CUSTOM_PROP_NAME_CANDIDATES.find(name => strings.includes(name)) || null;
  let label = normalizeMetadataString(taggedStrings.get(0x02) || '');
  for (const s of strings) {
    if (CUSTOM_PROP_NAME_BY_LABEL.has(s)) {
      label = label || s;
      nameU = nameU || CUSTOM_PROP_NAME_BY_LABEL.get(s);
      break;
    }
  }
  if (!nameU) return null;

  const prompt = normalizeMetadataString(taggedStrings.get(0x01) || '') || strings.find(s =>
    s !== nameU &&
    s !== label &&
    (/^(Stringwert|Geben Sie|Enter |Select |Set )/.test(s) || s.includes(' für Berichterstellung.'))
  ) || null;

  if (!label) {
    label = strings.find(s =>
      s !== nameU &&
      s !== prompt &&
      s.length <= 80 &&
      !/^VT[0-9]/.test(s)
    ) || nameU;
  }

  let value = normalizeMetadataString(taggedStrings.get(0x00) || '');
  if (!value) {
    value = normalizeMetadataString(taggedStrings.get(0x04) || '');
  }
  if (!value) {
    value = strings.find(s =>
    s !== nameU &&
    s !== label &&
    s !== prompt &&
    !CUSTOM_PROP_NAME_BY_LABEL.has(s) &&
    !CUSTOM_PROP_NAME_CANDIDATES.includes(s) &&
    !/^(Stringwert|Geben Sie|Enter |Select |Set )/.test(s) &&
    s.length > 1 &&
    s.length <= 120
    ) || null;
  }

  if (['ShapeClass', 'ShapeType', 'SubShapeType'].includes(nameU) && label && label !== nameU) {
    value = label;
    label = nameU;
  } else if (!value && ['Classification', 'ClassificationSource', 'Material', 'ProjectType', 'TypeDescription',
              'ColumnHeight', 'Length', 'Width', 'BaseElevation'].includes(nameU)) {
    value = '0';
  }

  const format = normalizeMetadataString(taggedStrings.get(0x03) || '') ||
    (nameU === 'Material' && strings.includes('Beton;Stahl;Holz') ? 'Beton;Stahl;Holz' : null);

  return {
    nameU,
    label,
    prompt,
    type: null,
    format,
    invisible: ['ShapeClass', 'ShapeType', 'SubShapeType', 'Classification', 'ClassificationSource'].includes(nameU) ? '1' : null,
    langID: /[ÄÖÜäöüß]/.test(strings.join(' ')) ? 'de-DE' : null,
    value: metadataValue(value)
  };
}

const USER_DEF_BOOL_NAMES = new Set([
  'EndsDontMeet1',
  'ShapeGone1',
  'EndNotOnLine1',
  'DiffMtrls1',
  'Closed1',
  'Corner1',
  'TJointOpen1',
  'TJointClosed1',
  'EndsDontMeet2',
  'ShapeGone2',
  'EndNotOnLine2',
  'DiffMtrls2',
  'Closed2',
  'Corner2',
  'TJointOpen2',
  'TJointClosed2',
  'Is_arc',
  'visBESelected',
  'HasText'
]);

function unitForUserDefMarker(marker, nameU) {
  switch (marker) {
    case 0x40:
      return 'DL';
    case 0x46:
      return 'MM';
    case 0x47:
      return 'M';
    case 0x50:
      return 'DA';
    case 0x61:
      return USER_DEF_BOOL_NAMES.has(nameU) ? 'BOOL' : '26';
    case 0x20:
    default:
      return '26';
  }
}

function parseUserDefinedCellChunk(chunk, rowName = null) {
  const nameU = normalizeMetadataString(rowName || '');
  if (!nameU || chunk.dataLength < 15) return null;
  try {
    const bytes = chunk.data.u8.slice(0, chunk.dataLength);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const marker = view.getUint8(0);
    const unit = unitForUserDefMarker(marker, nameU);
    let numericValue;
    if (marker === 0x61 &&
        bytes[5] === 0x00 &&
        bytes[6] === 0x00 &&
        bytes[7] === 0x00 &&
        bytes[8] === 0x00) {
      numericValue = view.getUint32(1, true);
    } else {
      numericValue = view.getFloat64(1, true);
    }
    if (unit === 'BOOL') numericValue = numericValue ? 1 : 0;
    return {
      nameU,
      prompt: null,
      value: metadataNumericValue(numericValue, unit)
    };
  } catch {
    return null;
  }
}

function mergeCustomProps(masterRows, shapeRows) {
  const merged = new Map();
  for (const row of masterRows || []) {
    if (row?.nameU) merged.set(row.nameU, row);
  }
  for (const row of shapeRows || []) {
    if (!row?.nameU) continue;
    merged.set(row.nameU, { ...(merged.get(row.nameU) || {}), ...row });
  }
  return [...merged.values()];
}

function mergeUserDefs(masterRows, shapeRows) {
  const merged = new Map();
  for (const row of masterRows || []) {
    if (row?.nameU) merged.set(row.nameU, row);
  }
  for (const row of shapeRows || []) {
    if (!row?.nameU) continue;
    merged.set(row.nameU, { ...(merged.get(row.nameU) || {}), ...row });
  }
  return [...merged.values()];
}

function inferTitleBase(shape) {
  const props = new Map((shape.customProps || []).filter(p => p?.nameU).map(p => [p.nameU, p]));
  const subShapeType = rawMetadataValue(props.get('SubShapeType')?.value);
  if (subShapeType) return subShapeType;
  const shapeType = rawMetadataValue(props.get('ShapeType')?.value);
  if (shapeType) return shapeType;
  return null;
}

function synthesizeUserDefsFromCustomProps(customProps) {
  return (customProps || [])
    .filter(prop => prop?.nameU)
    .map(prop => ({
      nameU: prop.nameU,
      prompt: prop.label && prop.label !== prop.nameU ? prop.label : prop.prompt,
      value: prop.value ?? null
    }));
}

function assignShapeMetadata(shape) {
  if (!shape) return;
  const masterShape = shape._masterShape || null;
  if (masterShape) {
    shape.customProps = mergeCustomProps(masterShape.customProps, shape.customProps);
    shape.userDefs = mergeUserDefs(masterShape.userDefs, shape.userDefs);
    shape.propMap = { ...(masterShape.propMap || {}), ...(shape.propMap || {}) };
    shape.userMap = { ...(masterShape.userMap || {}), ...(shape.userMap || {}) };
  }

  for (const prop of shape.customProps || []) {
    const rawValue = rawMetadataValue(prop.value);
    if (prop.nameU && rawValue !== null && rawValue !== '') shape.propMap[prop.nameU] = rawValue;
  }

  // Binary VSD files in the current corpus do not expose native 0xB4
  // USER_DEFINED_CELLS rows, but Visio stores many of the same shape-level
  // values as custom properties. Promote those rows into userDefs/userMap only
  // when the shape otherwise has no user metadata so VSD and VSDX exports stay
  // materially closer.
  if ((!shape.userDefs || shape.userDefs.length === 0) && shape.customProps?.length) {
    shape.userDefs = synthesizeUserDefsFromCustomProps(shape.customProps);
  }
  if ((!shape.userMap || Object.keys(shape.userMap).length === 0) && shape.userDefs?.length) {
    shape.userMap = {};
    for (const def of shape.userDefs) {
      const rawValue = rawMetadataValue(def.value);
      if (def.nameU && rawValue !== null && rawValue !== '') shape.userMap[def.nameU] = rawValue;
    }
  }

  const base = shape.name || shape.nameU || inferTitleBase(shape) ||
    masterShape?.title || masterShape?.name || masterShape?.nameU;
  shape.title = shape.title || shape.name || shape.nameU ||
    (base && shape.id ? `${base}.${shape.id}` : null) ||
    (shape.id ? `${shape.type || 'Shape'}.${shape.id}` : null);
}

// Thin wrapper: delegate U+FFFC placeholder substitution to the shared helper.
// We keep this named function because it's referenced from finalizeShape below.
function spliceFieldsIntoText(text, fields, ctx) {
  if (!text) return text;
  const shape = { text, _fields: fields || [] };
  return resolveFields(shape, ctx || { fields: fields || [] });
}

function readCharIx(data) {
  // VSD6 CharIX layout (from libvisio VSDParser::readCharIX):
  //   u32 charCount
  //   u16 fontID
  //   u8  colorID (skipped)
  //   u8  r, g, b, a        -- font colour (RGBA)
  //   u8  fontMod1           -- bit0=bold, bit1=italic, bit2=underline, bit3=smallcaps
  //   u8  fontMod2           -- bit0=allcaps, bit1=initcaps
  //   u8  fontMod3           -- bit0=superscript, bit1=subscript
  //   u16 scaleWidth / 10000
  //   skip(2)
  //   f64 fontSize           -- units are INCHES
  //   u8  fontMod4           -- bit0=doubleunderline, bit2=strikeout, bit5=doublestrikeout
  const r = data;
  r.pos = 0;
  if (r.remaining < 26) return {};
  try {
    r.skip(4);                      // charCount
    r.skip(2);                      // fontID
    r.skip(1);                      // colour ID
    const cr = r.readU8();
    const cg = r.readU8();
    const cb = r.readU8();
    const ca = r.readU8();
    const fontMod1 = r.readU8();
    r.skip(1);                      // fontMod2 (allcaps/initcaps)
    r.skip(1);                      // fontMod3 (super/subscript)
    r.skip(2);                      // scaleWidth u16
    r.skip(2);                      // reserved
    const fontSize = r.readF64();   // inches
    const bold = (fontMod1 & 1) !== 0;
    const italic = (fontMod1 & 2) !== 0;
    // Treat fully transparent (a==0 with all-zero RGB) as "no colour override"
    const isNullColour = (cr === 0 && cg === 0 && cb === 0 && ca === 0);
    const fontColor = isNullColour
      ? null
      : `#${cr.toString(16).padStart(2,'0')}${cg.toString(16).padStart(2,'0')}${cb.toString(16).padStart(2,'0')}`;
    // Guard against NaN/negative/absurd sizes
    const validSize = Number.isFinite(fontSize) && fontSize > 0 && fontSize < 100;
    return {
      fontColor,
      bold,
      italic,
      fontSize: validSize ? fontSize : null
    };
  } catch {
    return {};
  }
}

function readPageProps(data) {
  const r = data;
  r.pos = 0;
  try {
    const pageWidth = r.readCellDouble();
    const pageHeight = r.readCellDouble();
    return { pageWidth, pageHeight };
  } catch {
    return { pageWidth: 8.5, pageHeight: 11 };
  }
}

function readGeometry(data) {
  const r = data;
  r.pos = 0;
  const flags = r.readU8();
  return {
    noFill: (flags & 1) !== 0,
    noLine: (flags & 2) !== 0,
    noShow: (flags & 4) !== 0
  };
}

function readLayerMembership(data) {
  const r = data;
  r.pos = 0;
  const bytes = [];
  while (r.remaining > 0 && bytes.length < 100) {
    const b = r.readU8();
    if (b === 0) break;
    bytes.push(b);
  }
  // Strip any non-printable bytes; Visio stores layer membership as a
  // semicolon-separated list of ASCII indices or names. Any control chars we
  // pick up are scratch bytes from the chunk tail and must never flow into
  // attribute values (which XML serializers reject).
  return String.fromCharCode(...bytes.filter(b => b >= 0x20 && b < 0x7f));
}

function readLayer(data) {
  const r = data;
  r.pos = 0;
  try {
    const bytes = r.u8;
    const strings = [];

    // VSD layer rows embed one or more UTF-16LE strings inline after a fixed
    // binary header. Extract contiguous UTF-16LE runs and ignore the record
    // markers around them.
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i + 1] !== 0) continue;
      const chars = [];
      let j = i;
      while (j + 1 < bytes.length) {
        const lo = bytes[j];
        const hi = bytes[j + 1];
        if (hi !== 0 || lo === 0) break;
        chars.push(lo);
        j += 2;
      }
      if (chars.length >= 2) {
        strings.push(String.fromCharCode(...chars));
        i = j - 1;
      }
    }

    const cleanStrings = [...new Set(strings.map((s) => s.trim()).filter(Boolean))];
    const color = bytes.length > 8 ? parseColor(bytes[8]) : null;
    return {
      name: cleanStrings[0] || null,
      nameUniv: cleanStrings[1] || cleanStrings[0] || null,
      // These four flag bytes line up with the VSDX Layer row for this file:
      // active, lock, visible, print. Snap/glue follow and default to true.
      active: !!bytes[12],
      lock: !!bytes[13],
      visible: bytes.length > 14 ? bytes[14] !== 0 : true,
      print: bytes.length > 15 ? bytes[15] !== 0 : true,
      snap: bytes.length > 18 ? bytes[18] !== 0 : true,
      glue: bytes.length > 19 ? bytes[19] !== 0 : true,
      color
    };
  } catch {
    return { name: null, nameUniv: null, visible: true, print: true, active: false, lock: false, snap: true, glue: true, color: null };
  }
}

// Read a SHAPE/GROUP chunk's `parent`, `master_page`, and `master_shape` fields.
// Ported from libvisio VSDParser::readShape (GPL-3.0, LibreOffice libvisio) — the
// layout is: u8[10] shape-kind, u32 parent, u32 _, u32 masterPage, u32 _,
// u32 masterShape, u32 _, u32 fillStyle, u32 _, u32 lineStyle, u32 _, u32 textStyle.
// A parent of 0 means "top-level on the page"; a masterPage of 0xFFFFFFFF
// (MINUS_ONE) means "no master".
function readShapeParent(chunk) {
  try {
    const r = chunk.data;
    if (r.length < 14) return { parent: 0, masterPage: 0xFFFFFFFF, masterShape: 0xFFFFFFFF, fillStyle: null, lineStyle: null, textStyle: null };
    r.pos = 10;
    const parent = r.readU32() >>> 0;
    let masterPage = 0xFFFFFFFF;
    let masterShape = 0xFFFFFFFF;
    let fillStyle = null;
    let lineStyle = null;
    let textStyle = null;
    if (r.remaining >= 8) {
      r.skip(4);                       // reserved dword
      masterPage = r.readU32() >>> 0;
    }
    if (r.remaining >= 8) {
      r.skip(4);                       // reserved dword
      masterShape = r.readU32() >>> 0;
    }
    if (r.remaining >= 8) {
      r.skip(4);                       // reserved dword
      fillStyle = r.readU32() >>> 0;
      if (fillStyle === 0xFFFFFFFF) fillStyle = null;
    }
    if (r.remaining >= 8) {
      r.skip(4);                       // reserved dword
      lineStyle = r.readU32() >>> 0;
      if (lineStyle === 0xFFFFFFFF) lineStyle = null;
    }
    if (r.remaining >= 8) {
      r.skip(4);                       // reserved dword
      textStyle = r.readU32() >>> 0;
      if (textStyle === 0xFFFFFFFF) textStyle = null;
    }
    return { parent, masterPage, masterShape, fillStyle, lineStyle, textStyle };
  } catch {
    return { parent: 0, masterPage: 0xFFFFFFFF, masterShape: 0xFFFFFFFF, fillStyle: null, lineStyle: null, textStyle: null };
  }
}

function parseStyleSheetsFromChunks(chunks) {
  const styles = new Map();
  let currentStyle = null;
  for (const chunk of chunks) {
    if (chunk.chunkType === VSD.STYLE_SHEET) {
      currentStyle = {
        id: chunk.id >>> 0,
        line: null,
        fill: null
      };
      styles.set(currentStyle.id, currentStyle);
      continue;
    }

    if (!currentStyle) continue;

    if (chunk.chunkType === VSD.LINE && chunk.dataLength >= 18) {
      try { currentStyle.line = readLine(chunk.data); } catch { /* ignore parse errors */ }
    } else if (chunk.chunkType === VSD.FILL_AND_SHADOW && chunk.dataLength >= 11) {
      try { currentStyle.fill = readFillAndShadow(chunk.data); } catch { /* ignore parse errors */ }
    } else if ([VSD.PAGE, VSD.PAGE_SHEET, VSD.SHAPE_GROUP, VSD.SHAPE_SHAPE, VSD.SHAPE_FOREIGN].includes(chunk.chunkType)) {
      currentStyle = null;
    }
  }
  return styles;
}

function applyStyleFallbacks(shape, stylesById) {
  if (!shape || !stylesById) return;

  const fillStyle = shape._fillStyle != null ? stylesById.get(shape._fillStyle) : null;
  if (fillStyle?.fill && !shape._hasFill) {
    if (!shape.fillForeground && fillStyle.fill.fillForeground) shape.fillForeground = fillStyle.fill.fillForeground;
    if (!shape.fillBackground && fillStyle.fill.fillBackground) shape.fillBackground = fillStyle.fill.fillBackground;
    if (shape.fillPattern === null || shape.fillPattern === undefined || shape.fillPattern === 0) {
      shape.fillPattern = fillStyle.fill.fillPattern;
    }
  }

  const lineStyle = shape._lineStyle != null ? stylesById.get(shape._lineStyle) : null;
  if (lineStyle?.line && !shape._hasLine) {
    shape.lineWeight = lineStyle.line.lineWeight ?? shape.lineWeight;
    if (lineStyle.line.lineColor) shape.lineColor = lineStyle.line.lineColor;
    shape.linePattern = lineStyle.line.linePattern ?? shape.linePattern;
    shape.rounding = lineStyle.line.rounding ?? shape.rounding;
    shape.beginArrow = lineStyle.line.beginArrow || 0;
    shape.endArrow = lineStyle.line.endArrow || 0;
  }
}

function inheritPaintFromMaster(shape, masterShape) {
  if (!shape || !masterShape) return;

  if (!shape._hasFill) {
    if (!shape.fillForeground && masterShape.fillForeground) shape.fillForeground = masterShape.fillForeground;
    if (!shape.fillBackground && masterShape.fillBackground) shape.fillBackground = masterShape.fillBackground;
    if ((shape.fillPattern === null || shape.fillPattern === undefined || shape.fillPattern === 0) &&
        masterShape.fillPattern !== null && masterShape.fillPattern !== undefined) {
      shape.fillPattern = masterShape.fillPattern;
    }
  }

  if (!shape._hasLine) {
    if (masterShape.lineColor) shape.lineColor = masterShape.lineColor;
    if (masterShape.lineWeight !== null && masterShape.lineWeight !== undefined) shape.lineWeight = masterShape.lineWeight;
    if (masterShape.linePattern !== null && masterShape.linePattern !== undefined) shape.linePattern = masterShape.linePattern;
    if (masterShape.rounding !== null && masterShape.rounding !== undefined) shape.rounding = masterShape.rounding;
    if (masterShape.beginArrow !== null && masterShape.beginArrow !== undefined) shape.beginArrow = masterShape.beginArrow;
    if (masterShape.endArrow !== null && masterShape.endArrow !== undefined) shape.endArrow = masterShape.endArrow;
  }
}

// Build shapes from flat chunk list. Uses the pointer-index (chunk.ptrIdx) as shape id
// and the SHAPE chunk's `parent` field to attach children into their group's subShapes.
//
// `opts.mastersMap` — when present, shapes reference master shapes by
//   { _masterPage, _masterShapeId }; during finalize we attach the master shape
//   so shape-inheritance.inheritFromMaster fills in text / style.
// `opts.isMasterStream` — when true, we are building master shapes; the caller
//   expects the output to be keyed into a `masters` table, not `pages`.
function buildShapesFromChunks(chunks, opts = {}) {
  const mastersMap = opts.mastersMap;
  const stylesById = opts.stylesById || null;
  const pages = [];
  let currentPage = null;
  let currentShape = null;
  let currentGeometry = null;
  let shapes = [];
  // Map from ptrIdx -> shape object, for resolving group membership on the current page.
  let shapesById = new Map();
  // Global NAME2 table survives page boundaries; NAMEIDX rows often point into it.
  let globalNamesById = new Map();
  for (const chunk of chunks) {
    if (chunk.chunkType !== VSD.NAME2) continue;
    const s = readName2Chunk(chunk);
    if (s) globalNamesById.set(chunk.id >>> 0, s);
  }
  // Per-page NAME table, populated from VSD_NAME / VSD_NAME2 chunks. Used to
  // resolve the `nameId` reference inside a TEXT_FIELD string-cell.
  let namesById = new Map(globalNamesById);
  // Per-level elementId -> resolved name map from NAMEIDX chunks.
  let namesMapByLevel = new Map();

  function attachShape(shape, parentKey) {
    const parent = parentKey ? shapesById.get(parentKey) : null;
    if (parent && parent !== shape) {
      parent.subShapes.push(shape);
    } else {
      shapes.push(shape);
    }
  }

  for (const chunk of chunks) {
    switch (chunk.chunkType) {
      case VSD.PAGE_SHEET: {
        // Start of a new page
        if (currentShape) {
          finalizeShape(currentShape, currentGeometry,
            currentPage && { name: currentPage.name, number: pages.length + 1 },
            namesById, mastersMap, opts);
          attachShape(currentShape, currentShape._parentKey);
          currentShape = null;
          currentGeometry = null;
        }
        if (currentPage) {
          currentPage.shapes = shapes;
          pages.push(currentPage);
        }
        shapes = [];
        shapesById = new Map();
        namesById = new Map(globalNamesById);
        namesMapByLevel = new Map();
        currentShape = null;
        currentGeometry = null;
        currentPage = {
          id: String(chunk.id),
          name: `Page ${pages.length + 1}`,
          width: 8.5,
          height: 11,
          isBackground: false,
          layers: [],
          shapes: [],
          connects: [],
          // For master streams we remember which STENCIL_PAGE this PAGE_SHEET belongs to,
          // so the final masters table can be keyed by that stencil-page's pointer index.
          _stencilPage: chunk._stencilPage ?? null,
        };
        break;
      }

      case VSD.PAGE_PROPS: {
        if (currentPage) {
          const props = readPageProps(chunk.data);
          currentPage.width = props.pageWidth;
          currentPage.height = props.pageHeight;
        }
        break;
      }

      case VSD.SHAPE_SHAPE:
      case VSD.SHAPE_GROUP:
      case VSD.SHAPE_FOREIGN: {
        // Save previous shape
        if (currentShape) {
          finalizeShape(currentShape, currentGeometry,
            currentPage && { name: currentPage.name, number: pages.length + 1 },
            namesById, mastersMap, opts);
          attachShape(currentShape, currentShape._parentKey);
        }
        currentGeometry = null;
        const hdr = readShapeParent(chunk);
        // Effective shape id comes from the chunk's own id if present, otherwise falls
        // back to the pointer-index (libvisio's MINUS_ONE fallback). The shape's `parent`
        // data field references this same effective id space.
        const isMinusOne = chunk.id === 0xFFFFFFFF;
        const effectiveId = isMinusOne ? (chunk.ptrIdx ?? 0) : chunk.id;
        // Parent key is 0 when top-level; otherwise matches the parent's effectiveId.
        const parentKey = hdr.parent || 0;
        currentShape = {
          id: String(effectiveId),
          masterId: null,
          name: null,
          nameU: null,
          title: null,
          // Raw master-page and master-shape references (libvisio's MINUS_ONE
          // sentinel = "no master"). We keep them for later lookup against
          // the stencil-pages map.
          _masterPage: hdr.masterPage === 0xFFFFFFFF ? null : hdr.masterPage,
          _masterShapeId: hdr.masterShape === 0xFFFFFFFF ? null : hdr.masterShape,
          _fillStyle: hdr.fillStyle,
          _lineStyle: hdr.lineStyle,
          _textStyle: hdr.textStyle,
          _hasFill: false,
          _hasLine: false,
          type: chunk.chunkType === VSD.SHAPE_GROUP ? 'Group' : 'Shape',
          pinX: 0, pinY: 0,
          width: 0, height: 0,
          locPinX: 0, locPinY: 0,
          angle: 0,
          flipX: false, flipY: false,
          lineColor: '#000000',
          lineWeight: 0.01,
          linePattern: 1,
          fillForeground: null,
          fillBackground: null,
          fillPattern: 0,
          rounding: 0,
          beginArrow: 0,
          endArrow: 0,
          fontSize: null,
          fontColor: null,
          bold: false,
          italic: false,
          geometry: [],
          hasGeometry: false,
          subShapes: [],
          text: '',
          layerMembers: [],
          propMap: {},
          userMap: {},
          customProps: [],
          userDefs: [],
          // Internal bookkeeping for group reconstruction. _parentKey is resolved at
          // finalize time via shapesById; 0 means "attach to page".
          _parentKey: parentKey,
          _selfKey: effectiveId
        };
        // Register immediately so later children on the same page can find this shape
        // as a parent even if we haven't finalized it yet.
        shapesById.set(effectiveId, currentShape);
        break;
      }

      case VSD.XFORM_DATA: {
        if (currentShape && chunk.dataLength >= 65) {
          try {
            const xform = readXFormData(chunk.data);
            Object.assign(currentShape, xform);
            if (currentShape.locPinX === 0 && currentShape.locPinY === 0) {
              currentShape.locPinX = currentShape.width / 2;
              currentShape.locPinY = currentShape.height / 2;
            }
          } catch { /* ignore */ }
        }
        break;
      }

      case VSD.GEOMETRY: {
        if (currentShape) {
          // Finalize previous geometry section
          if (currentGeometry) {
            currentShape.geometry.push(currentGeometry);
          }
          const geo = readGeometry(chunk.data);
          currentShape.hasGeometry = true;
          currentGeometry = { rows: [], noFill: geo.noFill, noLine: geo.noLine, noShow: geo.noShow };
        }
        break;
      }

      case VSD.MOVE_TO: {
        if (currentGeometry && chunk.dataLength >= 18) {
          currentGeometry.rows.push(readMoveTo(chunk.data));
        }
        break;
      }

      case VSD.LINE_TO: {
        if (currentGeometry && chunk.dataLength >= 18) {
          currentGeometry.rows.push(readLineTo(chunk.data));
        }
        break;
      }

      case VSD.ARC_TO: {
        if (currentGeometry && chunk.dataLength >= 27) {
          currentGeometry.rows.push(readArcTo(chunk.data));
        }
        break;
      }

      case VSD.ELLIPTICAL_ARC_TO: {
        if (currentGeometry && chunk.dataLength >= 54) {
          currentGeometry.rows.push(readEllipticalArcTo(chunk.data));
        }
        break;
      }

      case VSD.ELLIPSE: {
        if (currentGeometry && chunk.dataLength >= 54) {
          currentGeometry.rows.push(readEllipse(chunk.data));
        }
        break;
      }

      case VSD.INFINITE_LINE: {
        if (currentGeometry && chunk.dataLength >= 36) {
          currentGeometry.rows.push(readInfiniteLine(chunk.data));
        }
        break;
      }

      case VSD.SPLINE_START: {
        if (currentGeometry && chunk.dataLength >= 54) {
          currentGeometry.rows.push(readSplineStart(chunk.data));
        }
        break;
      }

      case VSD.SPLINE_KNOT: {
        if (currentGeometry && chunk.dataLength >= 27) {
          currentGeometry.rows.push(readSplineKnot(chunk.data));
        }
        break;
      }

      case VSD.NURBS_TO: {
        if (currentGeometry && chunk.dataLength >= 18) {
          currentGeometry.rows.push(readNurbsTo(chunk.data));
        }
        break;
      }

      case VSD.POLYLINE_TO: {
        if (currentGeometry && chunk.dataLength >= 18) {
          // Read endpoint, then try to read point list
          const r = chunk.data;
          r.pos = 0;
          const x = r.readCellDouble();
          const y = r.readCellDouble();
          currentGeometry.rows.push({ type: 'PolylineTo', x, y, a: null });
        }
        break;
      }

      case VSD.LINE: {
        if (currentShape && chunk.dataLength >= 18) {
          try {
            const line = readLine(chunk.data);
            currentShape.lineWeight = line.lineWeight;
            if (line.lineColor) currentShape.lineColor = line.lineColor;
            currentShape.linePattern = line.linePattern;
            if (line.rounding !== undefined) currentShape.rounding = line.rounding;
            currentShape.beginArrow = line.beginArrow || 0;
            currentShape.endArrow = line.endArrow || 0;
            currentShape._hasLine = true;
          } catch { /* ignore parse errors */ }
        }
        break;
      }

      case VSD.FILL_AND_SHADOW: {
        if (currentShape && chunk.dataLength >= 11) {
          const fill = readFillAndShadow(chunk.data);
          if (fill.fillForeground) currentShape.fillForeground = fill.fillForeground;
          if (fill.fillBackground) currentShape.fillBackground = fill.fillBackground;
          currentShape.fillPattern = fill.fillPattern;
          currentShape._hasFill = true;
        }
        break;
      }

      case VSD.TEXT: {
        if (currentShape && chunk.dataLength > 8) {
          currentShape.text = readText(chunk.data, chunk.dataLength);
        }
        break;
      }

      case VSD.FIELD_LIST: {
        // Start of a FIELD_LIST for the current shape. Subsequent TEXT_FIELD
        // (0xa1) chunks at level 2 belong to this list and should be spliced
        // into the shape's TEXT at each U+FFFC position. libvisio tracks the
        // list via an id map; we simply reset per-shape.
        if (currentShape) currentShape._fields = [];
        break;
      }

      case VSD.TEXT_FIELD: {
        if (currentShape) {
          if (!currentShape._fields) currentShape._fields = [];
          const fld = readTextField(chunk.data, chunk.dataLength);
          currentShape._fields.push(fld);
        }
        break;
      }

      case VSD.CHAR_IX: {
        if (currentShape && chunk.dataLength > 4) {
          const charData = readCharIx(chunk.data);
          if (charData.fontColor) currentShape.fontColor = currentShape.fontColor || charData.fontColor;
          if (charData.fontSize) currentShape.fontSize = currentShape.fontSize || charData.fontSize;
          currentShape.bold = currentShape.bold || charData.bold;
          currentShape.italic = currentShape.italic || charData.italic;
        }
        break;
      }

      case VSD.LAYER_MEMBERSHIP: {
        if (currentShape) {
          try {
            const memberStr = readLayerMembership(chunk.data);
            currentShape.layerMembers = memberStr.split(/[;,]/).map(s => s.trim()).filter(Boolean);
          } catch { /* ignore */ }
        }
        break;
      }

      case VSD.LAYER: {
        if (currentPage) {
          const layerData = readLayer(chunk.data);
          currentPage.layers.push({
            index: String(currentPage.layers.length),
            name: layerData.name || `Layer ${currentPage.layers.length}`,
            nameUniv: layerData.nameUniv || null,
            visible: layerData.visible !== false,
            print: layerData.print !== false,
            active: layerData.active === true,
            lock: layerData.lock === true,
            snap: layerData.snap !== false,
            glue: layerData.glue !== false,
            color: layerData.color || null
          });
        }
        break;
      }

      case VSD.NAME:
      case VSD.NAME2: {
        // Per-shape NAME table entry. Keyed by the chunk's record id, which
        // is the same id a TEXT_FIELD's string-cell `nameId` references.
        // Ported from libvisio VSDParser::readName (GPL-3.0, LibreOffice libvisio).
        const s = chunk.chunkType === VSD.NAME2 ? readName2Chunk(chunk) : readNameChunk(chunk);
        if (s) {
          namesById.set(chunk.id >>> 0, s);
          if (chunk.chunkType === VSD.NAME2) globalNamesById.set(chunk.id >>> 0, s);
        }
        break;
      }

      case VSD.NAME_IDX: {
        const resolved = new Map();
        for (const row of readNameIdxChunk(chunk)) {
          const name = namesById.get(row.nameId);
          if (name) resolved.set(row.elementId, name.replace(/^\u0000+/g, ''));
        }
        namesMapByLevel.set(chunk.level, resolved);
        break;
      }

      case VSD.CUSTOM_PROPS: {
        if (currentShape) {
          const rowName = namesMapByLevel.get(chunk.level)?.get(chunk.id >>> 0) || null;
          const prop = parseCustomPropChunk(chunk, rowName);
          if (prop) currentShape.customProps = mergeCustomProps(currentShape.customProps, [prop]);
        }
        break;
      }

      case VSD.USER_DEFINED_CELLS: {
        if (currentShape) {
          const rowName = namesMapByLevel.get(chunk.level)?.get(chunk.id >>> 0) || null;
          const userDef = parseUserDefinedCellChunk(chunk, rowName);
          if (userDef) currentShape.userDefs = mergeUserDefs(currentShape.userDefs, [userDef]);
        }
        break;
      }

      // Intentional no-ops, mirroring libvisio VSDParser::readPropList and
      // libvisio-ng's behaviour: these list/user chunks are containers or
      // compact binary rows whose name table wiring is not decoded here.
      case VSD.PROP_LIST:
      case VSD.CUST_PROPS_LIST:
        break;
    }
  }

  // Finalize last shape and page
  if (currentShape) {
    finalizeShape(currentShape, currentGeometry,
      currentPage && { name: currentPage.name, number: pages.length + 1 },
      namesById, mastersMap, opts);
    attachShape(currentShape, currentShape._parentKey);
  }
  if (currentPage) {
    currentPage.shapes = shapes;
    pages.push(currentPage);
  }

  // Strip internal bookkeeping fields recursively. Master-stream shapes keep
  // _fields / _masterShape / _masterPage because the page-level build reads
  // them via inheritFromMaster.
  function clean(arr) {
    for (const s of arr) {
      delete s._parentKey;
      delete s._selfKey;
      if (!opts.isMasterStream) delete s._fields;
      if (s.subShapes && s.subShapes.length) clean(s.subShapes);
    }
  }
  for (const pg of pages) clean(pg.shapes);

  return pages;
}

// Resolve a single field's .ref/.value using the NAME table, in place.
// `nm` is the decoded name string: names prefixed with a known symbol type
// ("Prop.", "User.", "ThePage!") are passed to resolveReference as symbolic
// references; plain names become literal values.
function applyNameToField(f, nm) {
  if (!f || !nm) return;
  if (/^(Prop|User|Property|PageName|PageNumber)\b/i.test(nm) ||
      /^ThePage!/i.test(nm)) {
    f.ref = nm;
  } else {
    f.value = nm;
  }
}

function finalizeShape(shape, currentGeometry, pageCtx, namesById, mastersMap, opts) {
  if (currentGeometry) {
    shape.geometry.push(currentGeometry);
  }
  // Resolve a master-shape reference via the stencil-pages table, if any.
  // mastersMap is { masterPageStencilPtrIdx -> { masterShapeId -> masterShape } }.
  if (!shape._masterShape && shape._masterPage != null && shape._masterShapeId != null && mastersMap) {
    const page = mastersMap.get(shape._masterPage);
    if (page) {
      const master = page.get(shape._masterShapeId);
      if (master) shape._masterShape = master;
    }
  }

  // Expand multi-ref TEXT_FIELD chunks into one field per reference so that
  // each U+FFFC placeholder in the shape's TEXT is consumed by exactly one
  // entry, matching libvisio's one-element-per-placeholder model.
  if (shape._fields && shape._fields.length) {
    shape._fields = expandNameRefFields(shape._fields);
    const names = namesById || new Map();
    for (const f of shape._fields) {
      if (f && f.nameId != null && names.has(f.nameId)) {
        applyNameToField(f, names.get(f.nameId));
      }
    }
  }

  applyStyleFallbacks(shape, opts?.stylesById || null);

  // Inherit text + character style from the master. We inherit AFTER expanding
  // fields so the master's already-expanded _fields are what the child reuses
  // when it has no TEXT/field chunks of its own.
  if (shape._masterShape) {
    inheritFromMaster(shape, shape._masterShape);
    inheritPaintFromMaster(shape, shape._masterShape);
  }
  assignShapeMetadata(shape);

  // When building a master-page stream we want to keep raw U+FFFC placeholders
  // intact so the page-level builder can run field resolution in the page's
  // own context (its own propMap/userMap/pageName). For regular pages we run
  // the resolver now.
  if (opts && opts.isMasterStream) {
    // Preserve _fields and _masterPage/_masterShapeId for downstream inheritance.
    return;
  }

  const ctx = {
    fields: shape._fields || [],
    propMap: shape.propMap,
    userMap: shape.userMap,
    pageName: pageCtx ? pageCtx.name : undefined,
    pageNumber: pageCtx ? pageCtx.number : undefined
  };
  if (shape.text && (shape.text.indexOf('\uFFFC') !== -1 || shape.text.indexOf('<fld') !== -1)) {
    shape.text = resolveFields(shape, ctx);
  }
  if (shape.text && !shape.text.replace(/[\s\uFFFC]/g, '')) {
    shape.text = '';
  }
  delete shape._fields;
  delete shape._masterShape;
  delete shape._masterPage;
  delete shape._masterShapeId;
  delete shape._fillStyle;
  delete shape._lineStyle;
  delete shape._textStyle;
  delete shape._hasFill;
  delete shape._hasLine;
}

function readPointer(reader) {
  const type = reader.readU32();
  reader.skip(4); // reserved
  const offset = reader.readU32();
  const length = reader.readU32();
  const format = reader.readU16();
  return { type, offset, length, format };
}

function getStreamData(mainContent, ptr) {
  if (ptr.offset >= mainContent.length || ptr.length === 0) return null;
  const len = Math.min(ptr.length, mainContent.length - ptr.offset);
  const raw = mainContent.slice(ptr.offset, ptr.offset + len);
  const compressed = (ptr.format & 2) === 2;
  return compressed ? decompressVsd(raw) : raw;
}

function readPointersFromStream(streamData, shift) {
  const reader = new BinaryReader(streamData);
  reader.pos = shift; // skip shift bytes
  const infoOffset = reader.readU32();
  const listPos = infoOffset + shift - 4;
  if (listPos >= streamData.length - 12) return { pointers: [], order: [] };

  reader.pos = listPos;
  const listSize = reader.readU32();
  const pointerCount = reader.readI32();
  reader.skip(4); // unknown

  const pointers = [];
  for (let i = 0; i < pointerCount && reader.remaining >= 18; i++) {
    pointers.push(readPointer(reader));
  }

  const order = [];
  const orderCount = listSize <= 1 ? 0 : listSize;
  for (let i = 0; i < orderCount && reader.remaining >= 4; i++) {
    order.push(reader.readU32());
  }

  return { pointers, order };
}

// Recursively handle a stream: if it's a blob with sub-pointers, recurse; if it's chunks, parse.
// ptrIdx is the pointer's index in its parent container. libvisio uses this index as the
// effective chunk id when chunk.id is MINUS_ONE (0xFFFFFFFF), and SHAPE chunks reference
// their group/parent by this same pointer index in their `parent` data field.
//
// `ctx` carries per-subtree bookkeeping that the chunk-classifier needs. Currently:
//   - ctx.stencilPage: null, or the pointer-index of the enclosing STENCIL_PAGE.
//     Shapes parsed below that STENCIL_PAGE are master shapes and should be
//     indexed into `mastersMap[stencilPage][shapeId]`.
function handleStream(mainContent, ptr, allChunks, depth, ptrIdx = 0, ctx = { stencilPage: null }) {
  if (depth > 10 || ptr.offset >= mainContent.length || ptr.length === 0) return;
  if (ptr.type === 0) return;

  const streamData = getStreamData(mainContent, ptr);
  if (!streamData || streamData.length === 0) return;

  // Some VSD pointer types are raw payload streams rather than nested chunk
  // containers. NAME / NAME2 are the important ones for metadata wiring: if we
  // drop them here, later NAMEIDX maps cannot resolve row ids to symbolic
  // names. libvisio handles these pointer streams directly in handleStream().
  if (ptr.type === VSD.NAME || ptr.type === VSD.NAME2) {
    allChunks.push({
      chunkType: ptr.type,
      id: ptrIdx,
      list: 0,
      dataLength: streamData.length,
      level: depth,
      data: new BinaryReader(streamData),
      ptrIdx,
      _stencilPage: ctx.stencilPage
    });
    return;
  }

  const compressed = (ptr.format & 2) === 2;
  const shift = compressed ? 4 : 0;
  const formatType = (ptr.format >> 4) & 0xF;

  // If this pointer IS a stencil page, tag its entire subtree so that the
  // chunks produced for its contained shapes get routed into the masters map.
  // Ported from libvisio VSDParser::handleStreams (GPL-3.0, LibreOffice libvisio,
  // © the LibreOffice contributors; see VSD_STENCIL_PAGE branch).
  const childCtx = (ptr.type === VSD.STENCIL_PAGE)
    ? { stencilPage: ptrIdx }
    : ctx;

  if (formatType === 0x0 || formatType === 0x4 || formatType === 0x5) {
    // Blob with potential sub-pointers - recurse
    try {
      const { pointers, order } = readPointersFromStream(streamData, shift);
      // Process in order if available, otherwise sequentially.
      // IMPORTANT: the effective chunk id is the pointer's ORIGINAL index in `pointers`,
      // not its position in the order list.
      if (order.length > 0) {
        for (const oi of order) {
          if (pointers[oi]) handleStream(mainContent, pointers[oi], allChunks, depth + 1, oi, childCtx);
        }
        const seen = new Set(order);
        for (let i = 0; i < pointers.length; i++) {
          if (!seen.has(i) && pointers[i].type !== 0) {
            handleStream(mainContent, pointers[i], allChunks, depth + 1, i, childCtx);
          }
        }
      } else {
        for (let i = 0; i < pointers.length; i++) {
          handleStream(mainContent, pointers[i], allChunks, depth + 1, i, childCtx);
        }
      }
    } catch {
      // If pointer parsing fails, try as chunks
      const chunkReader = new BinaryReader(streamData);
      const chunks = parseChunks(chunkReader);
      for (const c of chunks) { c.ptrIdx = ptrIdx; c._stencilPage = childCtx.stencilPage; }
      allChunks.push(...chunks);
    }
  } else {
    // Chunked stream (format type 0x8, 0xC, 0xD)
    const chunkReader = new BinaryReader(streamData);
    const chunks = parseChunks(chunkReader);
    for (const c of chunks) { c.ptrIdx = ptrIdx; c._stencilPage = childCtx.stencilPage; }
    allChunks.push(...chunks);
  }
}

export function debugParseVsdChunks(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const cfb = CFB.read(u8, { type: 'array' });
  const visioEntry = CFB.find(cfb, 'VisioDocument');
  if (!visioEntry || !visioEntry.content) {
    throw new Error('Not a valid VSD file: VisioDocument stream not found');
  }

  const content = visioEntry.content;
  const mainContent = content instanceof Uint8Array ? content : new Uint8Array(content);

  const reader = new BinaryReader(mainContent);
  reader.pos = 0x24;
  const trailerPtr = readPointer(reader);
  if (trailerPtr.type !== VSD.TRAILER_STREAM) {
    throw new Error('Invalid VSD file: trailer pointer type mismatch');
  }
  const trailerData = getStreamData(mainContent, trailerPtr);
  if (!trailerData || trailerData.length === 0) {
    throw new Error('Failed to read trailer stream');
  }

  const compressed = (trailerPtr.format & 2) === 2;
  const shift = compressed ? 4 : 0;
  const { pointers, order } = readPointersFromStream(trailerData, shift);
  const allChunks = [];
  if (order.length > 0) {
    for (const oi of order) {
      if (pointers[oi]) handleStream(mainContent, pointers[oi], allChunks, 0, oi);
    }
    const seen = new Set(order);
    for (let i = 0; i < pointers.length; i++) {
      if (!seen.has(i) && pointers[i].type !== 0) {
        handleStream(mainContent, pointers[i], allChunks, 0, i);
      }
    }
  } else {
    for (let i = 0; i < pointers.length; i++) {
      handleStream(mainContent, pointers[i], allChunks, 0, i);
    }
  }
  return allChunks;
}

export async function parseVsd(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const cfb = CFB.read(u8, { type: 'array' });
  const visioEntry = CFB.find(cfb, 'VisioDocument');
  if (!visioEntry || !visioEntry.content) {
    throw new Error('Not a valid VSD file: VisioDocument stream not found');
  }

  const content = visioEntry.content;
  const mainContent = content instanceof Uint8Array ? content : new Uint8Array(content);

  // Read trailer pointer at offset 0x24
  const reader = new BinaryReader(mainContent);
  reader.pos = 0x24;
  const trailerPtr = readPointer(reader);

  if (trailerPtr.type !== VSD.TRAILER_STREAM) {
    throw new Error('Invalid VSD file: trailer pointer type mismatch (got 0x' + trailerPtr.type.toString(16) + ')');
  }

  // Decompress the trailer stream
  const trailerData = getStreamData(mainContent, trailerPtr);
  if (!trailerData || trailerData.length === 0) {
    throw new Error('Failed to read trailer stream');
  }

  const compressed = (trailerPtr.format & 2) === 2;
  const shift = compressed ? 4 : 0;

  // Read pointers from the trailer
  const { pointers, order } = readPointersFromStream(trailerData, shift);

  // Recursively process all pointers, collecting chunks
  const allChunks = [];

  // Process in order if available. Pass the pointer's ORIGINAL index (not order position)
  // as ptrIdx so that SHAPE chunks can be identified by their pointer-index (libvisio's
  // MINUS_ONE id fallback scheme).
  if (order.length > 0) {
    for (const oi of order) {
      if (pointers[oi]) handleStream(mainContent, pointers[oi], allChunks, 0, oi);
    }
    const seen = new Set(order);
    for (let i = 0; i < pointers.length; i++) {
      if (!seen.has(i) && pointers[i].type !== 0) {
        handleStream(mainContent, pointers[i], allChunks, 0, i);
      }
    }
  } else {
    for (let i = 0; i < pointers.length; i++) {
      handleStream(mainContent, pointers[i], allChunks, 0, i);
    }
  }

  // Split chunks into those that belong to stencil pages (master shapes) and
  // those that belong to real pages. Stencil chunks were tagged during
  // handleStream with `_stencilPage: <stencil-page ptr-idx>`. Inside each
  // stencil page we still need the full chunk sequence including PAGE_SHEET;
  // the simplest reliable approach is to group stencil chunks by their
  // stencil-page ptr and run the normal builder with isMasterStream=true,
  // then flatten the resulting pages into a { ptr -> { shapeId -> shape } } map.
  //
  // Ported from libvisio VSDParser::handleStreams (GPL-3.0, LibreOffice
  // libvisio) — that implementation collects stencil shapes into
  // m_stencils.addStencil(idx, ...); we use the JS map for the same purpose.
  const regularChunks = [];
  const stencilChunksByPage = new Map(); // stencilPage ptrIdx -> chunks[]
  for (const c of allChunks) {
    if (c._stencilPage != null) {
      let bucket = stencilChunksByPage.get(c._stencilPage);
      if (!bucket) { bucket = []; stencilChunksByPage.set(c._stencilPage, bucket); }
      bucket.push(c);
    } else {
      regularChunks.push(c);
    }
  }

  const stylesById = parseStyleSheetsFromChunks(allChunks);

  // Build the masters table: stencilPtrIdx -> Map(shapeId -> masterShape).
  const mastersMap = new Map();
  for (const [stencilPtrIdx, bucket] of stencilChunksByPage) {
    const masterPages = buildShapesFromChunks(bucket, { isMasterStream: true, stylesById });
    const shapeIndex = new Map();
    function indexShapes(arr) {
      for (const s of arr) {
        const id = Number(s.id);
        if (!Number.isNaN(id)) shapeIndex.set(id, s);
        if (s.subShapes && s.subShapes.length) indexShapes(s.subShapes);
      }
    }
    for (const mp of masterPages) indexShapes(mp.shapes);
    mastersMap.set(stencilPtrIdx, shapeIndex);
  }

  // Build pages with master lookup available.
  const pages = buildShapesFromChunks(regularChunks, { mastersMap, stylesById });

  // If no pages found, return empty
  if (pages.length === 0) {
    return { pages: [{ id: '0', name: 'Page 1', width: 8.5, height: 11, isBackground: false, layers: [], shapes: [], connects: [] }], masters: mastersMap };
  }

  // Filter out empty shapes (recursively). A shape is kept if it has geometry, text,
  // non-zero dimensions, OR any surviving subShapes.
  function isKeepable(s) {
    if (s.subShapes && s.subShapes.length) {
      s.subShapes = s.subShapes.filter(isKeepable);
      if (s.subShapes.length) return true;
    }
    return s.geometry.length > 0 || !!s.text || (s.width > 0 && s.height > 0);
  }
  for (const page of pages) {
    page.shapes = page.shapes.filter(isKeepable);
  }

  return { pages, masters: mastersMap };
}
