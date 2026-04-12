import CFB from 'cfb';

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
  SHAPE_GROUP:        0x47,
  SHAPE_SHAPE:        0x48,
  SHAPE_FOREIGN:      0x4E,
  STYLE_SHEET:        0x4A,
  PAGE_SHEET:         0x46,
  SHAPE_LIST:         0x65,
  FIELD_LIST:         0x66,
  PROP_LIST:          0x68,
  CHAR_LIST:          0x69,
  PARA_LIST:          0x6A,
  GEOM_LIST:          0x6C,
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
  MISC:               0xA4,
  SPLINE_START:       0xA5,
  SPLINE_KNOT:        0xA6,
  LAYER_MEMBERSHIP:   0xA7,
  LAYER:              0xA8,
  CONTROL:            0xAA,
  POLYLINE_TO:        0xC1,
  NURBS_TO:           0xC3,
  NAME_IDX:           0xC9,
  PAGES:              0x27,
  OLE_DATA:           0x1F,
};

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
  const bytes = [];
  for (let i = 8; i < dataLength; i++) {
    bytes.push(r.readU8());
  }
  // VSD6 text is ANSI
  return String.fromCharCode(...bytes.filter(b => b !== 0));
}

function readCharIx(data) {
  const r = data;
  r.pos = 0;
  if (r.remaining < 4) return {};
  // Skip complex character formatting, try to extract font size and color
  // The format varies, so we do a best-effort parse
  try {
    r.skip(1); // cell marker
    r.skip(2); // font index
    const colorR = r.readU8();
    const colorG = r.readU8();
    const colorB = r.readU8();
    r.skip(1); // alpha
    r.skip(1); // cell marker
    const style = r.readU8(); // bold/italic flags
    const fontSize = r.readCellDouble();
    return {
      fontColor: `#${colorR.toString(16).padStart(2,'0')}${colorG.toString(16).padStart(2,'0')}${colorB.toString(16).padStart(2,'0')}`,
      bold: (style & 1) !== 0,
      italic: (style & 2) !== 0,
      fontSize: fontSize > 0 ? fontSize : null
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
  return String.fromCharCode(...bytes);
}

function readLayer(data) {
  const r = data;
  r.pos = 0;
  try {
    const bytes = [];
    while (r.remaining > 0) {
      bytes.push(r.readU8());
    }
    const text = String.fromCharCode(...bytes.filter(b => b >= 32 && b < 127));
    return { name: text.trim() || null };
  } catch {
    return { name: null };
  }
}

// Build shapes from flat chunk list using level-based hierarchy
function buildShapesFromChunks(chunks) {
  const pages = [];
  let currentPage = null;
  let currentShape = null;
  let currentGeometry = null;
  let shapes = [];
  let shapeStack = [];

  for (const chunk of chunks) {
    switch (chunk.chunkType) {
      case VSD.PAGE_SHEET: {
        // Start of a new page
        if (currentPage) {
          currentPage.shapes = shapes;
          pages.push(currentPage);
        }
        shapes = [];
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
          connects: []
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
          finalizeShape(currentShape, currentGeometry);
          shapes.push(currentShape);
        }
        currentGeometry = null;
        currentShape = {
          id: String(chunk.id),
          masterId: null,
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
          subShapes: [],
          text: '',
          layerMembers: []
        };
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
          if (!geo.noShow) {
            currentGeometry = { rows: [], noFill: geo.noFill, noLine: geo.noLine };
          } else {
            currentGeometry = null;
          }
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
        }
        break;
      }

      case VSD.TEXT: {
        if (currentShape && chunk.dataLength > 8) {
          currentShape.text = readText(chunk.data, chunk.dataLength);
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
            visible: true
          });
        }
        break;
      }
    }
  }

  // Finalize last shape and page
  if (currentShape) {
    finalizeShape(currentShape, currentGeometry);
    shapes.push(currentShape);
  }
  if (currentPage) {
    currentPage.shapes = shapes;
    pages.push(currentPage);
  }

  return pages;
}

function finalizeShape(shape, currentGeometry) {
  if (currentGeometry) {
    shape.geometry.push(currentGeometry);
  }
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

// Recursively handle a stream: if it's a blob with sub-pointers, recurse; if it's chunks, parse
function handleStream(mainContent, ptr, allChunks, depth) {
  if (depth > 10 || ptr.offset >= mainContent.length || ptr.length === 0) return;
  if (ptr.type === 0) return;

  const streamData = getStreamData(mainContent, ptr);
  if (!streamData || streamData.length === 0) return;

  const compressed = (ptr.format & 2) === 2;
  const shift = compressed ? 4 : 0;
  const formatType = (ptr.format >> 4) & 0xF;

  if (formatType === 0x0 || formatType === 0x4 || formatType === 0x5) {
    // Blob with potential sub-pointers - recurse
    try {
      const { pointers, order } = readPointersFromStream(streamData, shift);
      // Process in order if available, otherwise sequentially
      const ordered = order.length > 0
        ? order.map(i => pointers[i]).filter(Boolean)
        : pointers;
      for (const subPtr of ordered) {
        handleStream(mainContent, subPtr, allChunks, depth + 1);
      }
      // Also process any pointers not in the order list
      if (order.length > 0) {
        const seen = new Set(order);
        for (let i = 0; i < pointers.length; i++) {
          if (!seen.has(i) && pointers[i].type !== 0) {
            handleStream(mainContent, pointers[i], allChunks, depth + 1);
          }
        }
      }
    } catch {
      // If pointer parsing fails, try as chunks
      const chunkReader = new BinaryReader(streamData);
      const chunks = parseChunks(chunkReader);
      allChunks.push(...chunks);
    }
  } else {
    // Chunked stream (format type 0x8, 0xC, 0xD)
    const chunkReader = new BinaryReader(streamData);
    const chunks = parseChunks(chunkReader);
    allChunks.push(...chunks);
  }
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

  // Process in order if available
  const ordered = order.length > 0
    ? order.map(i => pointers[i]).filter(Boolean)
    : pointers;
  for (const ptr of ordered) {
    handleStream(mainContent, ptr, allChunks, 0);
  }
  // Also process unordered pointers
  if (order.length > 0) {
    const seen = new Set(order);
    for (let i = 0; i < pointers.length; i++) {
      if (!seen.has(i) && pointers[i].type !== 0) {
        handleStream(mainContent, pointers[i], allChunks, 0);
      }
    }
  }

  const pages = buildShapesFromChunks(allChunks);

  // If no pages found, return empty
  if (pages.length === 0) {
    return { pages: [{ id: '0', name: 'Page 1', width: 8.5, height: 11, isBackground: false, layers: [], shapes: [], connects: [] }], masters: new Map() };
  }

  // Filter out empty shapes
  for (const page of pages) {
    page.shapes = page.shapes.filter(s =>
      s.geometry.length > 0 || s.text || (s.width > 0 && s.height > 0)
    );
  }

  return { pages, masters: new Map() };
}
