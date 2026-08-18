const DPI = 96; // Visio inches to pixels
const VISIO_NS = 'http://schemas.microsoft.com/visio/2003/SVGExtensions/';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

// Visio's built-in text defaults, in *paper* inches. Both are multiplied by the
// drawing scale so they end up the same size relative to the page as the
// explicit Char.Size values Visio stores - matching Visio's own SVG export,
// which emits 12pt text as 12 units in a 72-units-per-paper-inch viewBox.
const DEFAULT_FONT_SIZE_IN = 12 / 72; // 12pt
const DEFAULT_TEXT_MARGIN_IN = 4 / 72; // textBlock margins rect(4,4,4,4)

// Visio HorzAlign: 0=left 1=centre 2=right 3=justify. Default is 1.
function textAnchorFor(horzAlign) {
  if (horzAlign === 0) return 'start';
  if (horzAlign === 2) return 'end';
  return 'middle';
}

// Visio VerticalAlign: 0=top 1=middle 2=bottom. Default is 1.
function baselineFor(vertAlign) {
  if (vertAlign === 0) return 'text-before-edge';
  if (vertAlign === 2) return 'text-after-edge';
  return 'central';
}

function inToPx(inches) {
  return inches * DPI;
}

// Visio stores LineWeight 0 as a *hairline*: the thinnest line the device can
// draw. Its own SVG export renders those at 0.25pt. Everything we emit lives in
// the drawing's unit space (inches × 96 × the drawing scale), so a constant
// minimum is meaningless there - a 1:100 floor plan emits 9600 units per inch,
// where the old floor of 0.5 units is 1/19200 of an inch and vanishes. Express
// the minimum in points and scale it like every other line weight.
const HAIRLINE_PT = 0.25;
function hairlineStroke(strokeScale) {
  return inToPx(HAIRLINE_PT / 72) * (strokeScale || 1);
}

export { geometryToPath };

// Width of a page in the coordinate units renderPage emits, so a caller can
// work out how many units one device pixel covers before rendering.
export function pageCoordinateWidth(page) {
  return inToPx(page?.width || 0);
}

function isLightColor(color) {
  if (!color || !/^#[0-9A-F]{6}$/i.test(color)) return false;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance >= 0.7;
}

// XML 1.0 allows only TAB, LF, CR and the range 0x20+ as character data.
// Anything else in an attribute value or text node makes rsvg/libxml2 reject
// the serialized SVG. Strip defensively before emitting.
function xmlSafe(s) {
  if (s == null) return s;
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '');
}

function hasMultipleSubpaths(pathData) {
  return (pathData.match(/[Mm]/g) || []).length > 1;
}

function setVisioAttr(el, name, value) {
  if (value === null || value === undefined || value === '') return;
  el.setAttributeNS(VISIO_NS, `v:${name}`, xmlSafe(value));
}

function createVisioElement(localName) {
  return document.createElementNS(VISIO_NS, `v:${localName}`);
}

function addClass(el, className) {
  const existing = el.getAttribute('class');
  el.setAttribute('class', existing ? `${existing} ${className}` : className);
}

function parseNurbsControlPoints(formula, width, height) {
  if (!formula) return null;
  const match = String(formula).match(/NURBS\(([^)]*)\)/i);
  if (!match) return null;

  const values = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (values.some((value) => Number.isNaN(value)) || values.length < 8) return null;

  const [, degree, xType, yType, ...pointValues] = values;
  const points = [];
  for (let i = 0; i + 3 < pointValues.length; i += 4) {
    const rawX = pointValues[i];
    const rawY = pointValues[i + 1];

    points.push({
      x: xType === 0 ? rawX * width : rawX,
      y: yType === 0 ? rawY * height : rawY
    });
  }

  return { degree, points };
}

function ellipticalArcCommand(row, startX, startY, endX, endY, width, height, relative = false) {
  if (row.a === null || row.b === null) return `L ${endX} ${endY} `;

  const cpX = inToPx(relative ? row.a * width : row.a);
  const cpY = inToPx(relative ? (1 - row.b) * height : height - row.b);
  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);
  let rx = Math.max(dx, Math.abs(cpX - startX), Math.abs(endX - cpX));
  let ry = Math.max(dy, Math.abs(cpY - startY), Math.abs(endY - cpY));

  const aspect = row.d && Math.abs(row.d) > 0.001 ? Math.abs(row.d) : null;
  if (aspect) {
    if (rx >= ry) ry = rx / aspect;
    else rx = ry * aspect;
  }

  if (rx < 0.001 || ry < 0.001) return `L ${endX} ${endY} `;

  const rotation = row.c !== null ? -row.c * (180 / Math.PI) : 0;
  const v1x = cpX - startX;
  const v1y = cpY - startY;
  const v2x = endX - cpX;
  const v2y = endY - cpY;
  const sweep = (v1x * v2y - v1y * v2x) >= 0 ? 1 : 0;
  return `A ${rx} ${ry} ${rotation} 0 ${sweep} ${endX} ${endY} `;
}

function catmullRomToBezier(points) {
  if (points.length < 2) return '';
  let d = '';
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y} `;
  }
  return d;
}

// Convert geometry rows to SVG path data
// Coordinates are in shape-local space (0,0 to width,height) with Y-up
//
// `options.spans`, when given an array, is filled with `{ row, text }` for each
// row in turn — the exact slice of path data that row produced, and null for
// the implicit opening MoveTo that belongs to no row. That is what lets an edit
// to the drawn path be traced back to the cell it came from
// (src/svg-geometry-map.js); it costs nothing when nobody asks for it, and
// deliberately measures what was emitted rather than predicting it, so a row
// type this file grows later cannot silently fall out of step.
function geometryToPath(rows, width, height, options = {}) {
  let d = '';
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;
  const spans = Array.isArray(options.spans) ? options.spans : null;

  // If first row is not a MoveTo, add implicit MoveTo(0,0)
  if (rows.length > 0 && rows[0].type !== 'MoveTo' && rows[0].type !== 'RelMoveTo') {
    d += `M 0 ${inToPx(height)} `;
    if (spans) spans.push({ row: null, text: d });
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const spanStart = d.length;
    const x = row.x !== null ? inToPx(row.x) : curX;
    // Flip Y: Visio Y-up → SVG Y-down within shape local coords
    const y = row.y !== null ? inToPx(height - row.y) : curY;

    switch (row.type) {
      case 'MoveTo':
      case 'RelMoveTo': {
        let mx = x, my = y;
        if (row.type === 'RelMoveTo' && row.x !== null && row.y !== null) {
          mx = inToPx(row.x * width);
          my = inToPx((1 - row.y) * height);
        }
        if (options.connectInternalMoves && d) {
          d += `L ${mx} ${my} `;
        } else {
          d += `M ${mx} ${my} `;
        }
        curX = mx; curY = my;
        startX = mx; startY = my;
        break;
      }

      case 'LineTo':
      case 'RelLineTo': {
        let lx = x, ly = y;
        if (row.type === 'RelLineTo' && row.x !== null && row.y !== null) {
          lx = inToPx(row.x * width);
          ly = inToPx((1 - row.y) * height);
        }
        d += `L ${lx} ${ly} `;
        curX = lx; curY = ly;
        break;
      }

      case 'ArcTo': {
        // Visio ArcTo: endpoint (X,Y) and bulge A
        // A is the distance from the arc midpoint to the chord midpoint
        const bulge = row.a !== null ? inToPx(row.a) : 0;
        if (Math.abs(bulge) < 0.001) {
          // Straight line
          d += `L ${x} ${y} `;
        } else {
          // Calculate arc from chord and bulge
          const dx = x - curX;
          const dy = y - curY;
          const chordLen = Math.sqrt(dx * dx + dy * dy);
          if (chordLen < 0.001) {
            d += `L ${x} ${y} `;
          } else {
            // radius from bulge and chord
            const h = bulge; // sagitta (can be negative)
            const r = Math.abs((chordLen * chordLen / 4 + h * h) / (2 * h));
            const largeArc = Math.abs(h) > chordLen / 2 ? 1 : 0;
            const sweep = h > 0 ? 0 : 1;
            d += `A ${r} ${r} 0 ${largeArc} ${sweep} ${x} ${y} `;
          }
        }
        curX = x; curY = y;
        break;
      }

      case 'EllipticalArcTo': {
        d += ellipticalArcCommand(row, curX, curY, x, y, width, height);
        curX = x; curY = y;
        break;
      }

      case 'NURBSTo': {
        const nurbs = parseNurbsControlPoints(row.e, width, height);
        if (nurbs?.degree === 3 && nurbs.points.length >= 2) {
          const cp1 = nurbs.points[0];
          const cp2 = nurbs.points[1];
          d += `C ${inToPx(cp1.x)} ${inToPx(height - cp1.y)} ${inToPx(cp2.x)} ${inToPx(height - cp2.y)} ${x} ${y} `;
        } else if (nurbs?.points.length) {
          for (const point of nurbs.points) {
            d += `L ${inToPx(point.x)} ${inToPx(height - point.y)} `;
          }
          d += `L ${x} ${y} `;
        } else {
          d += `L ${x} ${y} `;
        }
        curX = x; curY = y;
        break;
      }

      case 'PolylineTo': {
        // Parse POLYLINE formula: POLYLINE(lastX, lastY, x1, y1, x2, y2, ...)
        if (row.a) {
          const match = row.a.match(/POLYLINE\(([^)]+)\)/i);
          if (match) {
            const nums = match[1].split(',').map(s => parseFloat(s.trim()));
            // First two are flags/last point, then pairs of x,y
            for (let i = 2; i + 1 < nums.length; i += 2) {
              const px = inToPx(nums[i]);
              const py = inToPx(height - nums[i + 1]);
              d += `L ${px} ${py} `;
            }
          }
        }
        d += `L ${x} ${y} `;
        curX = x; curY = y;
        break;
      }

      case 'SplineStart': {
        const points = [{ x: curX, y: curY }, { x, y }];
        while (rowIndex + 1 < rows.length && rows[rowIndex + 1].type === 'SplineKnot') {
          rowIndex++;
          const knot = rows[rowIndex];
          points.push({
            x: knot.x !== null ? inToPx(knot.x) : points[points.length - 1].x,
            y: knot.y !== null ? inToPx(height - knot.y) : points[points.length - 1].y
          });
        }
        d += catmullRomToBezier(points);
        const last = points[points.length - 1];
        curX = last.x; curY = last.y;
        break;
      }

      case 'SplineKnot': {
        d += `L ${x} ${y} `;
        curX = x; curY = y;
        break;
      }

      case 'InfiniteLine': {
        // Just draw a line segment for display
        if (row.a !== null && row.b !== null) {
          const ax = inToPx(row.a);
          const ay = inToPx(height - row.b);
          d += `M ${ax} ${ay} L ${x} ${y} `;
        }
        curX = x; curY = y;
        break;
      }

      case 'Ellipse': {
        // Special: defines an ellipse with center (X,Y) and control points A,B,C,D
        if (row.a !== null && row.b !== null) {
          // X,Y = center, A,B = endpoint of semi-major axis
          const cx = x;
          const cy = y;
          const ax = inToPx(row.a);
          const ay = inToPx(height - row.b);
          const rx = Math.sqrt((ax - cx) ** 2 + (ay - cy) ** 2);
          let ry = rx;
          if (row.c !== null && row.d !== null) {
            const dx = inToPx(row.c);
            const dy = inToPx(height - row.d);
            ry = Math.sqrt((dx - cx) ** 2 + (dy - cy) ** 2);
          }
          // Draw ellipse as two arcs
          d += `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} `;
        }
        curX = x; curY = y;
        break;
      }

      case 'RelCubBezTo': {
        // Relative cubic bezier (values 0-1 relative to shape)
        if (row.a !== null && row.b !== null) {
          const cp1x = inToPx((row.a) * width);
          const cp1y = inToPx((1 - row.b) * height);
          const cp2x = inToPx((row.c ?? row.a) * width);
          const cp2y = inToPx((1 - (row.d ?? row.b)) * height);
          const ex = inToPx(row.x * width);
          const ey = inToPx((1 - row.y) * height);
          d += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${ex} ${ey} `;
          curX = ex; curY = ey;
        }
        break;
      }

      case 'RelEllipticalArcTo': {
        // Relative elliptical arc
        const ex = inToPx(row.x * width);
        const ey = inToPx((1 - row.y) * height);
        d += ellipticalArcCommand(row, curX, curY, ex, ey, width, height, true);
        curX = ex; curY = ey;
        break;
      }

      case 'RelQuadBezTo': {
        if (row.a !== null && row.b !== null) {
          const cpX = inToPx(row.a * width);
          const cpY = inToPx((1 - row.b) * height);
          const ex = inToPx(row.x * width);
          const ey = inToPx((1 - row.y) * height);
          d += `Q ${cpX} ${cpY} ${ex} ${ey} `;
          curX = ex; curY = ey;
        }
        break;
      }

      default:
        // Unknown row type - skip
        break;
    }
    if (spans) spans.push({ row, text: d.slice(spanStart) });
  }
  return d.trim();
}

// Visio's built-in line patterns, as dash/gap runs measured in *line weights*
// - that is how Visio scales them, so a 0.25pt and a 0.72pt dashed line keep
// the same rhythm. The three marked "verified" were read straight out of a
// Visio 16 SVG export (pattern 2 → "1.75,1.25" at width 0.25, pattern 4 →
// "1.75,1.25,0,1.25", pattern 23 → "0.24,0.48" at width 0.24); the rest follow
// the same dash/dot families at Visio's coarse, medium and fine spacings.
// A zero-length run is a dot and needs a round cap to show up.
const LINE_PATTERNS = {
  2: [7, 5], // verified: dash
  3: [0, 4], // dot
  4: [7, 5, 0, 5], // verified: dash-dot
  5: [7, 5, 0, 5, 0, 5], // dash-dot-dot
  6: [14, 5], // long dash
  7: [14, 5, 0, 5],
  8: [14, 5, 0, 5, 0, 5],
  9: [3, 3],
  10: [0, 3],
  11: [3, 3, 0, 3],
  12: [3, 3, 0, 3, 0, 3],
  13: [7, 3],
  14: [7, 3, 0, 3],
  15: [7, 3, 0, 3, 0, 3],
  16: [11, 5],
  17: [0, 5],
  18: [11, 5, 0, 5],
  19: [11, 5, 0, 5, 0, 5],
  20: [23, 5],
  21: [23, 5, 11, 5],
  22: [23, 5, 11, 5, 11, 5],
  23: [1, 2] // verified: fine dot
};

// Build stroke-dasharray from Visio LinePattern. Returns '' for a solid line,
// null when the shape draws no line at all.
function getDashArray(linePattern, lineWeight) {
  const pattern = Math.round(linePattern);
  if (pattern === 0) return null; // no line
  const runs = LINE_PATTERNS[pattern];
  if (!runs) return ''; // solid, and anything we don't have a definition for
  const w = lineWeight > 0 ? lineWeight : 1;
  return runs.map((run) => run * w).join(' ');
}

// A dash array with a zero-length run only paints if the cap is round.
function dashNeedsRoundCap(dashArray) {
  return typeof dashArray === 'string' && /(^|\s)0(\s|$)/.test(dashArray);
}

function getFallbackFill(shape, themeColors) {
  return shape.fillForeground || ((!shape.fillForeground && shape.fillBackground && shape.fontColor && isLightColor(shape.fontColor))
    ? shape.fillBackground
    : ((!shape.fillForeground && themeColors.lt1 && shape.fontColor && !isLightColor(shape.fontColor)) ? themeColors.lt1 : shape.fillBackground));
}

function getShapeLayerInfo(shape, pageContext) {
  if (!pageContext?.layersByIndex || !shape.layerMembers?.length) return { hidden: false, monochromeColor: null };

  const matchedLayers = shape.layerMembers
    .map((index) => pageContext.layersByIndex.get(String(index)))
    .filter(Boolean);

  if (matchedLayers.length === 0) return { hidden: false, monochromeColor: null };

  const visibleLayers = matchedLayers.filter((layer) => layer.visible !== false);
  if (visibleLayers.length === 0) return { hidden: true, monochromeColor: null };

  const themedAccentStroke = /AccentColor|LineColor/i.test(shape.styleMeta?.lineColorFormula || '');
  const themedAccentFill = /LineColor|FillColor/i.test(shape.styleMeta?.fillForegroundFormula || '');
  const monochromeColor = visibleLayers.length === 1
    && /^#[0-9a-f]{6}$/i.test(visibleLayers[0].color || '')
    && themedAccentStroke
    && themedAccentFill
    ? visibleLayers[0].color
    : null;

  return { hidden: false, monochromeColor };
}

function getShapeStrokeColor(shape, themeColors, pageContext) {
  const { monochromeColor } = getShapeLayerInfo(shape, pageContext);
  return monochromeColor || shape.lineColor || themeColors.dk1 || '#000000';
}

function getGradientAngle(shape) {
  if (shape.fillGradientDir) return shape.fillGradientDir * 45;
  const patternAngles = {
    25: 0,
    26: 90,
    27: 45,
    28: 315,
    29: 0,
    30: 90,
    33: 0,
    34: 90,
    35: 45,
    36: 315,
    40: 0
  };
  return patternAngles[Math.round(shape.fillPattern)] ?? 0;
}

function isRadialGradientPattern(fillPattern) {
  return [29, 30, 31, 32, 37, 38, 39].includes(Math.round(fillPattern));
}

function appendGradientStops(gradient, svgNS, stops) {
  for (const stopData of stops) {
    const stop = document.createElementNS(svgNS, 'stop');
    stop.setAttribute('offset', `${stopData.offset}%`);
    stop.setAttribute('stop-color', stopData.color);
    if (stopData.opacity < 1) stop.setAttribute('stop-opacity', String(stopData.opacity));
    gradient.appendChild(stop);
  }
}

function clampOpacityFromTransparency(transparency, fallback = 0) {
  const value = Number.isFinite(transparency) ? transparency : fallback;
  return Math.max(0, Math.min(1, 1 - value));
}

function createGradientDef(svgNS, id, shape) {
  const isRadial = isRadialGradientPattern(shape.fillPattern);
  const gradient = document.createElementNS(svgNS, isRadial ? 'radialGradient' : 'linearGradient');
  gradient.setAttribute('id', id);

  if (isRadial) {
    gradient.setAttribute('cx', '50%');
    gradient.setAttribute('cy', '50%');
    gradient.setAttribute('r', '50%');
  } else {
    const rad = getGradientAngle(shape) * Math.PI / 180;
    const x1 = 50 - 50 * Math.cos(rad);
    const y1 = 50 + 50 * Math.sin(rad);
    const x2 = 50 + 50 * Math.cos(rad);
    const y2 = 50 - 50 * Math.sin(rad);
    gradient.setAttribute('x1', `${x1.toFixed(1)}%`);
    gradient.setAttribute('y1', `${y1.toFixed(1)}%`);
    gradient.setAttribute('x2', `${x2.toFixed(1)}%`);
    gradient.setAttribute('y2', `${y2.toFixed(1)}%`);
  }

  const stops = shape.fillGradientStops && shape.fillGradientStops.length > 0
    ? shape.fillGradientStops
    : [
      {
        offset: 0,
        color: shape.fillBackground || '#FFFFFF',
        opacity: clampOpacityFromTransparency(shape.fillBackgroundTrans, shape.fillForegroundTrans || 0)
      },
      {
        offset: 100,
        color: shape.fillForeground || shape.fillBackground || '#CCCCCC',
        opacity: clampOpacityFromTransparency(shape.fillForegroundTrans, 0)
      }
    ];
  appendGradientStops(gradient, svgNS, stops);
  return gradient;
}

// Visio's built-in hatches, drawn as vector geometry rather than the 8×8 raster
// tile its own SVG export embeds. Visio lays them out as a 6pt square tile with
// a 64-unit viewBox holding an 8×8 image, so one "cell" is an eighth of the
// tile - these definitions use those same 8×8 cell coordinates.
//
// Patterns 2-7, 11 and 24 were decoded from the tiles in a Visio 16 export and
// match it cell for cell. Visio has no published table for the rest; those
// reuse the same six motifs at a finer spacing, which keeps a hatched shape
// reading as hatched instead of as a solid block.
const HATCH_TILE_PT = 6;
const HATCH_CELLS = 8;

// lines: [x1, y1, x2, y2] in cell coordinates; dots: [x, y] one-cell squares.
const HATCH_PATTERNS = {
  2: { lines: [[0, 8, 8, 0], [-1, 1, 1, -1], [7, 9, 9, 7]] }, // "/" verified
  3: { lines: [[0, 0.5, 8, 0.5], [0.5, 0, 0.5, 8]] }, // grid, verified
  4: { lines: [[0, 0, 8, 8], [0, 8, 8, 0], [-1, 7, 1, 9], [7, -1, 9, 1], [-1, 1, 1, -1], [7, 9, 9, 7]] }, // "X" verified
  5: { lines: [[0, 0, 8, 8], [-1, 7, 1, 9], [7, -1, 9, 1]] }, // "\" verified
  6: { lines: [[0, 0.5, 8, 0.5]] }, // horizontal, verified
  7: { lines: [[0.5, 0, 0.5, 8]] }, // vertical, verified
  11: { dots: [[0, 0], [4, 0], [2, 2], [6, 2], [0, 4], [4, 4], [2, 6], [6, 6]] }, // verified
  24: {
    dots: [[3, 0], [7, 0], [0, 1], [2, 1], [4, 1], [6, 1], [1, 2], [5, 2], [0, 3], [2, 3], [4, 3], [6, 3],
      [3, 4], [7, 4], [0, 5], [2, 5], [4, 5], [6, 5], [1, 6], [5, 6], [0, 7], [2, 7], [4, 7], [6, 7]]
  } // fine dither, verified
};

// The six coarse motifs repeated at half the tile size for the indices Visio
// does not document (8-10, 12-23). Approximate on purpose - see above.
function getHatchDefinition(pattern) {
  const known = HATCH_PATTERNS[pattern];
  if (known) return { def: known, repeat: 1 };
  const motif = [2, 3, 4, 5, 6, 7][(pattern - 2) % 6];
  return { def: HATCH_PATTERNS[motif], repeat: pattern >= 14 ? 4 : 2 };
}

function isHatchPattern(fillPattern) {
  const pattern = Math.round(fillPattern);
  return pattern >= 2 && pattern <= 24;
}

function createHatchPattern(svgNS, id, pattern, foreground, background, opacities, strokeScale) {
  const { def, repeat } = getHatchDefinition(pattern);
  const tile = inToPx(HATCH_TILE_PT / 72) * (strokeScale || 1) / repeat;
  const cell = tile / HATCH_CELLS;

  const el = document.createElementNS(svgNS, 'pattern');
  el.setAttribute('id', id);
  el.setAttribute('patternUnits', 'userSpaceOnUse');
  el.setAttribute('width', String(tile));
  el.setAttribute('height', String(tile));

  if (background) {
    const bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(tile));
    bg.setAttribute('height', String(tile));
    bg.setAttribute('fill', background);
    if (opacities.background < 1) bg.setAttribute('fill-opacity', String(opacities.background));
    el.appendChild(bg);
  }

  for (const [x1, y1, x2, y2] of def.lines || []) {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(x1 * cell));
    line.setAttribute('y1', String(y1 * cell));
    line.setAttribute('x2', String(x2 * cell));
    line.setAttribute('y2', String(y2 * cell));
    line.setAttribute('stroke', foreground);
    line.setAttribute('stroke-width', String(cell));
    if (opacities.foreground < 1) line.setAttribute('stroke-opacity', String(opacities.foreground));
    el.appendChild(line);
  }
  for (const [x, y] of def.dots || []) {
    const dot = document.createElementNS(svgNS, 'rect');
    dot.setAttribute('x', String(x * cell));
    dot.setAttribute('y', String(y * cell));
    dot.setAttribute('width', String(cell));
    dot.setAttribute('height', String(cell));
    dot.setAttribute('fill', foreground);
    if (opacities.foreground < 1) dot.setAttribute('fill-opacity', String(opacities.foreground));
    el.appendChild(dot);
  }
  return el;
}

function getHatchPaint(shape, svgNS, defs, foreground, strokeScale) {
  const pattern = Math.round(shape.fillPattern);
  const background = shape.fillBackground || '#FFFFFF';
  const opacities = {
    foreground: clampOpacityFromTransparency(shape.fillForegroundTrans, 0),
    background: clampOpacityFromTransparency(shape.fillBackgroundTrans, 0)
  };
  const key = `hatch_${pattern}_${foreground}_${background}_${opacities.foreground}_${opacities.background}_${Math.round((strokeScale || 1) * 1000)}`;
  const id = key.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!defs._hatchIds) defs._hatchIds = new Set();
  if (!defs._hatchIds.has(id)) {
    defs.appendChild(createHatchPattern(svgNS, id, pattern, foreground, background, opacities, strokeScale));
    defs._hatchIds.add(id);
  }
  return `url(#${id})`;
}

function getFillPaint(shape, svgNS, defs, themeColors, layerInfo = null, strokeScale = 1) {
  if (layerInfo?.monochromeColor) return '#FFFFFF';
  const fillColor = getFallbackFill(shape, themeColors);
  if (isHatchPattern(shape.fillPattern) && fillColor) {
    return getHatchPaint(shape, svgNS, defs, fillColor, strokeScale);
  }
  if (shape.fillPattern >= 25 && shape.fillPattern <= 40 && shape.fillBackground && fillColor) {
    if (shape.fillBackground.toUpperCase() === fillColor.toUpperCase()) return fillColor;
    if (!defs._gradientIds) defs._gradientIds = new Set();
    const gradientId = `grad_${String(shape.id || 'shape').replace(/[^A-Za-z0-9_-]/g, '_')}_${Math.round(shape.fillPattern)}`;
    if (!defs._gradientIds.has(gradientId)) {
      defs.appendChild(createGradientDef(svgNS, gradientId, shape));
      defs._gradientIds.add(gradientId);
    }
    return `url(#${gradientId})`;
  }
  return fillColor;
}

function getFillOpacity(shape, fillPaint, layerInfo = null) {
  if (!fillPaint || fillPaint === 'none') return null;
  if (layerInfo?.monochromeColor) return 1;
  if (typeof fillPaint === 'string' && fillPaint.startsWith('url(#')) return null;
  const opacity = clampOpacityFromTransparency(shape.fillForegroundTrans, 0);
  return opacity < 1 ? opacity : null;
}

function toConnectorPoint(shape, pageHeight, x, y) {
  const pinX = shape.pinX ?? 0;
  const pinY = shape.pinY ?? 0;
  const locPinX = shape.locPinX ?? (shape.width / 2);
  const locPinY = shape.locPinY ?? (shape.height / 2);
  const dx = x - locPinX;
  const dy = y - locPinY;
  const angle = shape.angle || 0;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const px = pinX + dx * cosA - dy * sinA;
  const py = pinY + dx * sinA + dy * cosA;
  return {
    x: inToPx(px),
    y: inToPx(pageHeight - py)
  };
}

// True when a path's last point differs from its first, i.e. it is a stroke
// with two distinct free ends rather than a closed outline. Only such paths
// take arrowheads.
function isOpenSubpath(pathData) {
  if (!pathData || /[Zz]\s*$/.test(pathData.trim())) return false;
  const nums = pathData.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 4) return false;
  const first = [parseFloat(nums[0]), parseFloat(nums[1])];
  const last = [parseFloat(nums[nums.length - 2]), parseFloat(nums[nums.length - 1])];
  const eps = 1e-6;
  return Math.abs(first[0] - last[0]) > eps || Math.abs(first[1] - last[1]) > eps;
}

// A geometry section only counts if it actually contributes drawn points.
function countVisibleGeometrySections(shape) {
  return (shape.geometry || []).filter(geo => !geo.noShow && (geo.rows || []).length > 0).length;
}

function buildConnectorPath(shape, pageHeight) {
  const points = [];
  let hasMoveTo = false;
  for (const geo of shape.geometry || []) {
    if (geo.noShow) continue;
    for (const row of geo.rows || []) {
      if (row.x === null || row.y === null) continue;
      let localX = row.x;
      let localY = row.y;
      if ((row.type === 'RelMoveTo' || row.type === 'RelLineTo' || row.type === 'RelEllipticalArcTo' || row.type === 'RelQuadBezTo' || row.type === 'RelCubBezTo')
        && shape.width !== null && shape.height !== null) {
        localX = row.x * shape.width;
        localY = row.y * shape.height;
      }
      if (row.type === 'MoveTo' || row.type === 'RelMoveTo') hasMoveTo = true;
      if (!['MoveTo', 'RelMoveTo', 'LineTo', 'RelLineTo', 'ArcTo', 'EllipticalArcTo', 'RelEllipticalArcTo', 'SplineStart', 'SplineKnot', 'NURBSTo', 'PolylineTo', 'RelQuadBezTo', 'RelCubBezTo'].includes(row.type)) {
        continue;
      }
      points.push(toConnectorPoint(shape, pageHeight, localX, localY));
    }
  }

  const begin = (shape.beginX !== null && shape.beginY !== null)
    ? { x: inToPx(shape.beginX), y: inToPx(pageHeight - shape.beginY) }
    : null;
  const end = (shape.endX !== null && shape.endY !== null)
    ? { x: inToPx(shape.endX), y: inToPx(pageHeight - shape.endY) }
    : null;

  if (points.length > 0 && !hasMoveTo && begin) {
    points.unshift(begin);
  }
  if (points.length === 1 && end) {
    const only = points[0];
    if (Math.abs(only.x - end.x) > 0.1 || Math.abs(only.y - end.y) > 0.1) {
      points.push(end);
    }
  }
  if (points.length >= 2) {
    const deduped = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = deduped[deduped.length - 1];
      const next = points[i];
      if (Math.abs(prev.x - next.x) > 0.1 || Math.abs(prev.y - next.y) > 0.1) deduped.push(next);
    }
    if (deduped.length >= 2) {
      return `M ${deduped[0].x} ${deduped[0].y} ` + deduped.slice(1).map(pt => `L ${pt.x} ${pt.y}`).join(' ');
    }
  }
  if (begin && end && (Math.abs(begin.x - end.x) > 0.1 || Math.abs(begin.y - end.y) > 0.1)) {
    return `M ${begin.x} ${begin.y} L ${end.x} ${end.y}`;
  }
  return null;
}

// A 1-D connector is drawn directly in page coordinates and its group is
// returned *without* a transform (see renderShape), unlike every other shape.
// Anything working out where a shape lands on the page — hit testing, overlays —
// has to special-case it the same way, so the rule lives here rather than being
// guessed at a second time.
export function rendersAsFlatConnector(shape) {
  return Boolean(shape?.is1D)
    && (shape.subShapes?.length || 0) === 0
    && countVisibleGeometrySections(shape) <= 1
    && buildConnectorPath(shape, 0) !== null;
}

// Extent of that drawn path in the user units renderPage emits, taken from the
// path data itself so it cannot drift from what is on screen. `pageHeight` is
// whatever height the shape is rendered against — the page for a top-level
// shape, the parent's height for one inside a group.
export function connectorRenderBounds(shape, pageHeight) {
  const pathData = buildConnectorPath(shape, pageHeight);
  if (!pathData) return null;
  const nums = (pathData.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  if (nums.length < 2) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

// Advance widths as a fraction of the em, for Calibri - the font Visio lays a
// drawing out with unless the shape names another one. Line breaking has to
// agree with the metrics the *file* was written against rather than with
// whatever font the machine viewing the SVG substitutes, so this is a table and
// not a canvas measurement: it gives the same answer on screen, in a headless
// export and in jsdom.
const CALIBRI_EM = {
  ' ': 0.226, '!': 0.259, '"': 0.391, '#': 0.498, '$': 0.498, '%': 0.734, '&': 0.638,
  "'": 0.215, '(': 0.311, ')': 0.311, '*': 0.412, '+': 0.498, ',': 0.252, '-': 0.312,
  '.': 0.252, '/': 0.397, ':': 0.267, ';': 0.267, '<': 0.498, '=': 0.498, '>': 0.498,
  '?': 0.412, '@': 0.834, '[': 0.311, '\\': 0.397, ']': 0.311, '^': 0.498, '_': 0.498,
  '`': 0.301, '{': 0.311, '|': 0.397, '}': 0.311, '~': 0.498,
  0: 0.507, 1: 0.507, 2: 0.507, 3: 0.507, 4: 0.507, 5: 0.507,
  6: 0.507, 7: 0.507, 8: 0.507, 9: 0.507,
  A: 0.580, B: 0.545, C: 0.530, D: 0.605, E: 0.485, F: 0.459, G: 0.626, H: 0.626,
  I: 0.259, J: 0.290, K: 0.523, L: 0.429, M: 0.926, N: 0.666, O: 0.661, P: 0.530,
  Q: 0.661, R: 0.548, S: 0.459, T: 0.499, U: 0.640, V: 0.581, W: 0.894, X: 0.521,
  Y: 0.500, Z: 0.483,
  a: 0.479, b: 0.514, c: 0.426, d: 0.514, e: 0.498, f: 0.309, g: 0.471, h: 0.514,
  i: 0.230, j: 0.230, k: 0.457, l: 0.230, m: 0.790, n: 0.514, o: 0.511, p: 0.514,
  q: 0.514, r: 0.342, s: 0.402, t: 0.332, u: 0.514, v: 0.459, w: 0.717, x: 0.440,
  y: 0.459, z: 0.403
};
const DEFAULT_EM = 0.5;

// Every other family is approximated by scaling that table, the factor being
// how much wider its average lowercase letter is. Close enough to put the line
// breaks in the same places, which is all wrapping asks of a measurement.
const FONT_EM_FACTORS = [
  [/courier|consolas|mono/i, 1.20],
  [/verdana|tahoma|segoe/i, 1.16],
  [/arial|helvetica|liberation sans/i, 1.12],
  [/times|georgia|garamond|serif/i, 1.03]
];

function fontEmFactor(fontFamily, bold) {
  let factor = bold ? 1.03 : 1;
  const name = String(fontFamily || '');
  for (const [pattern, scale] of FONT_EM_FACTORS) {
    if (pattern.test(name)) {
      factor *= scale;
      break;
    }
  }
  return factor;
}

// Width of `text` in the same units as `fontSize`. Combining marks (the accent
// half of a decomposed "ö") advance nothing.
function measureTextWidth(text, fontSize, factor) {
  let em = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code >= 0x0300 && code <= 0x036f) continue;
    em += CALIBRI_EM[ch] ?? DEFAULT_EM;
  }
  return em * fontSize * factor;
}

// Where a line may be broken: after a run of spaces, and after a hyphen inside
// a word. The second is what turns Visio's "Podest-höhe:" into "Podest-" and
// "höhe:" rather than one line that runs out of its box. Each chunk carries its
// own trailing spaces, so a chunk never *starts* with one.
function breakChunks(text) {
  const chunks = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const here = text[i];
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next)) continue;
    if (/\s/.test(here) || here === '-') {
      chunks.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) chunks.push(text.slice(start));
  return chunks;
}

// A chunk with no break opportunity in it that still does not fit. Visio breaks
// it mid-word, which is why a 4mm-wide box holding "Schalter BSK" comes out one
// letter per line. Always at least one character, or this would not terminate.
function hardBreak(chunk, maxWidthPx, measure) {
  const parts = [];
  let current = '';
  for (const ch of chunk) {
    if (current && measure(current + ch) > maxWidthPx) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [chunk];
}

function wrapParagraph(text, maxWidthPx, measure) {
  const lines = [];
  let current = '';
  const flush = () => {
    const line = current.replace(/\s+$/, '');
    if (line) lines.push(line);
    current = '';
  };

  for (const chunk of breakChunks(text)) {
    const chunkWidth = measure(chunk.replace(/\s+$/, ''));
    if (chunkWidth > maxWidthPx) {
      flush();
      const parts = hardBreak(chunk, maxWidthPx, measure);
      current = parts.pop();
      for (const part of parts) lines.push(part);
      continue;
    }
    if (!current || measure((current + chunk).replace(/\s+$/, '')) <= maxWidthPx) {
      current += chunk;
    } else {
      flush();
      current = chunk;
    }
  }
  flush();
  return lines;
}

/**
 * The lines `text` breaks into inside a text block `maxWidthPx` wide.
 *
 * `maxWidthPx` is the *usable* width - the block less its left and right
 * margins - and `fontSize` is in the same units, which for a scaled drawing
 * means both have already been multiplied by the drawing scale.
 *
 * A width of 0 means "not known": the text is left on one line rather than
 * broken at a guess.
 */
function wrapTextLines(text, maxWidthPx, fontSize, fontFamily, bold) {
  const paragraphs = String(text).split('\n').map(line => line.trim()).filter(Boolean);
  if (!paragraphs.length) return [];
  if (!maxWidthPx || maxWidthPx <= 0 || !fontSize) return paragraphs;

  const factor = fontEmFactor(fontFamily, bold);
  const measure = (s) => measureTextWidth(s, fontSize, factor);

  const lines = [];
  for (const paragraph of paragraphs) {
    if (measure(paragraph) <= maxWidthPx) lines.push(paragraph);
    else lines.push(...wrapParagraph(paragraph, maxWidthPx, measure));
  }
  return lines;
}

function formatFontFamily(fontFamily) {
  if (!fontFamily || fontFamily === 'Themed') return 'Calibri, Arial, sans-serif';
  const clean = xmlSafe(fontFamily);
  if (/,/.test(clean)) return clean;
  if (clean === 'Calibri') return 'Calibri, Arial, sans-serif';
  return `${clean}, Calibri, Arial, sans-serif`;
}

function appendTextNode(target, shape, svgNS, pageHeight, fontScale, isConnector = false) {
  if (!shape.text || shape.hideText) return;
  const text = document.createElementNS(svgNS, 'text');
  const fontSize = inToPx(shape.fontSize || DEFAULT_FONT_SIZE_IN) * fontScale;
  const margin = inToPx(DEFAULT_TEXT_MARGIN_IN) * fontScale;
  const horzAlign = shape.horzAlign ?? 1;
  const vertAlign = shape.vertAlign ?? 1;
  const fill = shape.fontColor || '#000000';
  text.setAttribute('text-anchor', textAnchorFor(horzAlign));
  text.setAttribute('dominant-baseline', baselineFor(vertAlign));
  text.setAttribute('font-size', String(fontSize));
  text.setAttribute('fill', fill);
  text.setAttribute('font-family', formatFontFamily(shape.fontFamily));
  if (shape.bold) text.setAttribute('font-weight', 'bold');
  if (shape.italic) text.setAttribute('font-style', 'italic');

  // Visio wraps inside the text block less its left and right margins, and the
  // margins are paper-sized like the font is - so both are scaled the same way.
  const blockWidthPx = inToPx(Math.abs(shape.txtWidth || shape.width || 0));
  const maxWidthPx = blockWidthPx > 0 ? Math.max(blockWidthPx - 2 * margin, 0) : 0;
  const lines = wrapTextLines(xmlSafe(shape.text), maxWidthPx, fontSize, shape.fontFamily, shape.bold);

  // Anchor point of the text block. Visio centres the block on TxtPin with size
  // TxtWidth/TxtHeight; left/right and top/bottom alignment move the anchor to
  // the corresponding edge, inset by the text-block margin.
  const blockW = Math.abs(shape.txtWidth ?? shape.width ?? 0);
  const blockH = Math.abs(shape.txtHeight ?? shape.height ?? 0);
  // TxtPin is a point inside the block located by TxtLocPin, so the block's
  // centre is TxtPin - TxtLocPin + half the block. When TxtLocPin is the
  // block's centre (the usual case) this reduces to TxtPin.
  const blockCx = (shape.txtPinX ?? ((shape.width || 0) / 2))
    - (shape.txtLocPinX ?? (blockW / 2)) + blockW / 2;
  const blockCy = (shape.txtPinY ?? ((shape.height || 0) / 2))
    - (shape.txtLocPinY ?? (blockH / 2)) + blockH / 2;
  const shapeH = shape.height || 0;
  const anchorX = inToPx(
    horzAlign === 0 ? blockCx - blockW / 2
      : horzAlign === 2 ? blockCx + blockW / 2
        : blockCx
  ) + (horzAlign === 0 ? margin : horzAlign === 2 ? -margin : 0);
  // SVG y grows downward, Visio y grows upward from the shape's bottom edge.
  const anchorY = inToPx(
    vertAlign === 0 ? shapeH - (blockCy + blockH / 2)
      : vertAlign === 2 ? shapeH - (blockCy - blockH / 2)
        : shapeH - blockCy
  ) + (vertAlign === 0 ? margin : vertAlign === 2 ? -margin : 0);

  if (isConnector) {
    const pt = toConnectorPoint(shape, pageHeight, shape.txtPinX ?? shape.locPinX ?? 0, shape.txtPinY ?? shape.locPinY ?? 0);
    text.setAttribute('x', String(pt.x));
    text.setAttribute('y', String(pt.y));
  } else {
    text.setAttribute('x', String(anchorX));
    text.setAttribute('y', String(anchorY));
  }

  const richRuns = (shape.textRuns || []).filter(run => run.text);
  if (richRuns.length > 1 && lines.length <= 1) {
    text.textContent = '';
    for (const run of richRuns) {
      const tspan = document.createElementNS(svgNS, 'tspan');
      const runFontSize = run.fontSize ? inToPx(run.fontSize) * fontScale : fontSize;
      tspan.setAttribute('font-family', formatFontFamily(run.fontFamily || shape.fontFamily));
      tspan.setAttribute('font-size', String(runFontSize));
      tspan.setAttribute('fill', run.fontColor || fill);
      tspan.setAttribute('font-weight', run.bold ? 'bold' : 'normal');
      tspan.setAttribute('font-style', run.italic ? 'italic' : 'normal');
      if (run.underline) tspan.setAttribute('text-decoration', 'underline');
      tspan.textContent = xmlSafe(run.text);
      text.appendChild(tspan);
    }
  } else if (lines.length <= 1) {
    text.textContent = lines[0] || '';
  } else {
    const lineHeight = fontSize * 1.2;
    const centerY = isConnector
      ? (toConnectorPoint(shape, pageHeight, shape.txtPinX ?? shape.locPinX ?? 0, shape.txtPinY ?? shape.locPinY ?? 0).y)
      : anchorY;
    // Only a middle-aligned block grows in both directions; top/bottom keep
    // their anchored edge fixed and stack away from it.
    const startY = vertAlign === 0 ? centerY
      : vertAlign === 2 ? centerY - ((lines.length - 1) * lineHeight)
        : centerY - ((lines.length - 1) * lineHeight / 2);
    const x = isConnector
      ? toConnectorPoint(shape, pageHeight, shape.txtPinX ?? shape.locPinX ?? 0, shape.txtPinY ?? shape.locPinY ?? 0).x
      : anchorX;
    text.textContent = '';
    for (let i = 0; i < lines.length; i++) {
      const tspan = document.createElementNS(svgNS, 'tspan');
      tspan.setAttribute('x', String(x));
      tspan.setAttribute('y', String(startY + i * lineHeight));
      tspan.textContent = lines[i];
      text.appendChild(tspan);
    }
  }
  target.appendChild(text);
}

function appendImageNode(target, shape, svgNS) {
  if (!shape.image?.href) return;
  const image = document.createElementNS(svgNS, 'image');
  image.setAttribute('x', String(inToPx(shape.image.x ?? 0)));
  image.setAttribute('y', String(inToPx(shape.image.y ?? 0)));
  image.setAttribute('width', String(inToPx(shape.image.width || shape.width || 0)));
  image.setAttribute('height', String(inToPx(shape.image.height || shape.height || 0)));
  image.setAttribute('href', shape.image.href);
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', shape.image.href);
  image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  target.appendChild(image);
}

// A shape's Shape Data and user cells, in the shape Visio's own SVG export
// uses. They are pure metadata: nothing paints them and nothing in this app
// reads them back out of the DOM — they exist so the exported file carries
// what the .vsdx carried.
//
// That is why they are optional. On a real drawing they are the *majority* of
// the SVG: 66,734 of the 99,519 elements in a 8,470-shape file we test with,
// and every one of them is a node the browser has to build, keep, style and
// walk on every hit test. The screen render leaves them out and
// attachVisioMetadata puts them back on the way to a file.
function visioPropertyBlocks(shape) {
  const blocks = [];

  if (shape.customProps && shape.customProps.length > 0) {
    const custProps = createVisioElement('custProps');
    for (const prop of shape.customProps) {
      const cp = createVisioElement('cp');
      setVisioAttr(cp, 'nameU', prop.nameU);
      setVisioAttr(cp, 'lbl', prop.label);
      setVisioAttr(cp, 'prompt', prop.prompt);
      setVisioAttr(cp, 'type', prop.type);
      setVisioAttr(cp, 'format', prop.format);
      setVisioAttr(cp, 'invis', prop.invisible === '1' ? 'true' : prop.invisible === '0' ? 'false' : prop.invisible);
      setVisioAttr(cp, 'langID', prop.langID);
      setVisioAttr(cp, 'val', prop.value);
      custProps.appendChild(cp);
    }
    blocks.push(custProps);
  }

  if (shape.userDefs && shape.userDefs.length > 0) {
    const userDefs = createVisioElement('userDefs');
    for (const def of shape.userDefs) {
      const ud = createVisioElement('ud');
      setVisioAttr(ud, 'nameU', def.nameU);
      setVisioAttr(ud, 'prompt', def.prompt);
      setVisioAttr(ud, 'val', def.value);
      userDefs.appendChild(ud);
    }
    blocks.push(userDefs);
  }

  return blocks;
}

function appendShapeMetadata(target, shape, svgNS, withProperties = true) {
  // The title is not in the same class: it is what the browser shows as the
  // shape's tooltip, so it stays on screen.
  const titleText = shape.title || shape.name || shape.nameU;
  if (titleText) {
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = xmlSafe(titleText);
    target.appendChild(title);
  }
  if (!withProperties) return;
  for (const block of visioPropertyBlocks(shape)) target.appendChild(block);
}

/**
 * Put the Visio property blocks back onto an SVG rendered without them, so a
 * drawing exported from the screen carries the same Shape Data as one rendered
 * straight from the model. Matching is by `data-shape-id`, which the renderer
 * writes for every shape that has an id. Returns the SVG.
 */
export function attachVisioMetadata(svg, page) {
  if (!svg || !page) return svg;

  const byId = new Map();
  const walk = (shapes) => {
    for (const shape of shapes || []) {
      if (shape.id !== undefined && shape.id !== null) byId.set(String(shape.id), shape);
      walk(shape.subShapes);
    }
  };
  walk(page.shapes);

  svg.setAttributeNS(XMLNS_NS, 'xmlns:v', VISIO_NS);
  for (const group of svg.querySelectorAll('g[data-shape-id]')) {
    const shape = byId.get(group.getAttribute('data-shape-id'));
    if (!shape) continue;
    const blocks = visioPropertyBlocks(shape);
    if (!blocks.length) continue;
    // Where renderShape would have put them: after the <title>, before the
    // geometry, which is the order Visio's own export uses.
    const first = group.firstElementChild;
    const anchor = first && first.localName === 'title' ? first.nextSibling : group.firstChild;
    for (const block of blocks) group.insertBefore(block, anchor);
  }
  return svg;
}

/**
 * Where a shape sits in its parent, as the `transform` its group carries.
 *
 * Everything else renderShape puts inside that group — the paths, the text, the
 * children of a group — is in the shape's own coordinates and knows nothing
 * about where the shape is. So this string is the *whole* difference between a
 * shape drawn here and the same shape drawn somewhere else, and an app that has
 * just moved, turned or flipped one can write it and be done rather than build
 * the group again (see commitPlacementLocally in src/main.js).
 *
 * `pageHeight` is the height of whatever the shape's pin is measured in: the
 * page for a top-level shape, the parent group's height for a child.
 *
 * The one thing that is *not* only this string is a change of Width or Height:
 * those scale the geometry, re-wrap the text and rescale a group's contents.
 */
export function shapeTransform(shape, pageHeight) {
  // Visio: shape positioned by PinX,PinY (in page coords), LocPinX,LocPinY is the pin within the shape
  const px = inToPx(shape.pinX);
  const py = inToPx(pageHeight - shape.pinY); // flip Y for page
  const lpx = inToPx(shape.locPinX);
  const lpy = inToPx(shape.height - shape.locPinY); // flip Y for shape-local
  const angleDeg = -shape.angle * (180 / Math.PI); // Visio radians, CCW → SVG CW

  let transform = `translate(${px - lpx}, ${py - lpy})`;
  if (Math.abs(angleDeg) > 0.01) {
    transform += ` rotate(${angleDeg}, ${lpx}, ${lpy})`;
  }
  if (shape.flipX || shape.flipY) {
    const sx = shape.flipX ? -1 : 1;
    const sy = shape.flipY ? -1 : 1;
    transform += ` translate(${shape.flipX ? inToPx(shape.width) : 0}, ${shape.flipY ? inToPx(shape.height) : 0}) scale(${sx}, ${sy})`;
  }
  return transform;
}

function renderShape(shape, svgNS, pageHeight, defs, arrowCounter, strokeScale, fontScale, themeColors = {}, pageContext = null) {
  if (fontScale === undefined) fontScale = strokeScale;
  // Thinnest line this render may draw, in the emitted coordinate space. The
  // caller can raise it (see renderPage's minStrokeWidth) so hairlines stay
  // visible at the zoom the page is being viewed at.
  const minStroke = pageContext?.minStroke ?? hairlineStroke(strokeScale);
  const g = document.createElementNS(svgNS, 'g');
  if (shape.id) {
    const safeId = String(shape.id).replace(/[^A-Za-z0-9_-]/g, '_');
    const idPrefix = shape.type === 'Group' ? 'group' : 'shape';
    g.setAttribute('id', `${idPrefix}${safeId}`);
    g.setAttribute('data-shape-id', String(shape.id));
  }
  setVisioAttr(g, 'mID', shape.id);
  setVisioAttr(g, 'groupContext', shape.type === 'Group' ? 'group' : 'shape');

  // Tag with layer membership for visibility toggling
  if (shape.layerMembers && shape.layerMembers.length > 0) {
    g.setAttribute('data-layers', xmlSafe(shape.layerMembers.join(',')));
    setVisioAttr(g, 'layerMember', shape.layerMembers.join(','));
  }
  const layerInfo = getShapeLayerInfo(shape, pageContext);
  if (layerInfo.hidden) g.setAttribute('display', 'none');
  // A shape with no id gets no data-shape-id, and attachVisioMetadata matches on
  // that — so leaving its properties out would lose them for good. It keeps them.
  appendShapeMetadata(g, shape, svgNS, pageContext?.shapeProperties !== false || !shape.id);

  // Dedicated 1D connector rendering uses page-coordinate geometry instead of
  // shape-local transforms. This avoids collapsing routed connectors and keeps
  // BeginX/EndX fallbacks consistent with Visio.
  //
  // It flattens every geometry section into one polyline, so it only suits
  // shapes that really are a single stroke. Plenty of 1D shapes are not:
  // a dimension line carries Begin/End *and* several independent geometry
  // sections (extension lines, arrow legs, hidden construction geometry).
  // Flattening those drew phantom lines between the sections and lost both the
  // per-section flags and the arrowheads, so they take the normal path below.
  if (shape.is1D && shape.subShapes.length === 0 && countVisibleGeometrySections(shape) <= 1) {
    const pathData = buildConnectorPath(shape, pageHeight);
    if (pathData) {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'none');
      const strokeColor = shape.linePattern === 0 ? 'none' : getShapeStrokeColor(shape, themeColors, pageContext);
      const effectiveWeight = Math.max(inToPx(shape.lineWeight || 0) * strokeScale, minStroke);
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', String(effectiveWeight));
      const dashArray = getDashArray(shape.linePattern || 1, effectiveWeight);
      if (dashArray) {
        path.setAttribute('stroke-dasharray', dashArray);
        if (dashNeedsRoundCap(dashArray)) path.setAttribute('stroke-linecap', 'round');
      }
      path.setAttribute('stroke-linejoin', 'round');
      if (shape.beginArrow && shape.beginArrow > 0) {
        const markerId = `${pageContext?.idPrefix || ''}arrow-begin-${arrowCounter.value++}`;
        defs.appendChild(createArrowMarker(svgNS, markerId, strokeColor, true));
        path.setAttribute('marker-start', `url(#${markerId})`);
      }
      if (shape.endArrow && shape.endArrow > 0) {
        const markerId = `${pageContext?.idPrefix || ''}arrow-end-${arrowCounter.value++}`;
        defs.appendChild(createArrowMarker(svgNS, markerId, strokeColor, false));
        path.setAttribute('marker-end', `url(#${markerId})`);
      }
      g.appendChild(path);
    }
    appendTextNode(g, shape, svgNS, pageHeight, fontScale, true);
    return g;
  }

  g.setAttribute('transform', shapeTransform(shape, pageHeight));

  // Render geometry
  if (shape.geometry.length > 0) {
    const appendPath = (pathData, geo, options = {}) => {
      if (!pathData) return;
      const paintFill = options.paintFill !== false;
      const paintStroke = options.paintStroke !== false;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathData);
      // Which rows drew this path, for callers that need to work backwards from
      // the drawn outline to the cells behind it. The fill and stroke passes
      // differ only in whether an internal MoveTo is drawn as a LineTo, so one
      // set of spans describes both.
      if (pageContext?.pathSpans && options.spans) pageContext.pathSpans.set(path, options.spans);

      // Fill
      const fillColor = getFillPaint(shape, svgNS, defs, themeColors, layerInfo, strokeScale);
      if (!paintFill || geo.noFill || !fillColor || shape.fillPattern === 0) {
        path.setAttribute('fill', 'none');
      } else {
        path.setAttribute('fill', fillColor);
        const fillOpacity = getFillOpacity(shape, fillColor, layerInfo);
        if (fillOpacity !== null) path.setAttribute('fill-opacity', String(fillOpacity));
        if (hasMultipleSubpaths(pathData)) {
          path.setAttribute('fill-rule', 'evenodd');
          path.setAttribute('clip-rule', 'evenodd');
        }
      }

      // Stroke. lineWeight is always stored in inches, but the coordinate
      // space we emit is in the drawing's native unit (mm/inches/...) scaled
      // up by 96. `strokeScale` converts inch-valued line weights into that
      // coordinate space so strokes stay visually proportional to the drawing.
      if (!paintStroke || geo.noLine || shape.linePattern === 0) {
        path.setAttribute('stroke', 'none');
      } else {
        path.setAttribute('stroke', getShapeStrokeColor(shape, themeColors, pageContext));
        const effectiveWeight = Math.max(inToPx(shape.lineWeight) * strokeScale, minStroke);
        path.setAttribute('stroke-width', String(effectiveWeight));
        const dashArray = getDashArray(shape.linePattern, effectiveWeight);
        if (dashArray) {
          path.setAttribute('stroke-dasharray', dashArray);
          if (dashNeedsRoundCap(dashArray)) path.setAttribute('stroke-linecap', 'round');
        }
      }

      path.setAttribute('stroke-linejoin', 'round');
      // Visio's NoShow geometry: construction lines, a dimension's arrowheads
      // when the dimension is switched off. Visio's own SVG export leaves them
      // out of the file altogether; we keep them, because the shape they belong
      // to is still in the drawing and a reader looking at one should find its
      // geometry rather than an empty group.
      //
      // Kept means kept *unpainted*, and that has to hold in whatever opens the
      // file. `display` is the only way to say so that every renderer agrees on:
      // hiding these through the stylesheet alone left them showing in Inkscape,
      // which does not apply CSS `visibility`, and would have shown them
      // anywhere else too the moment a tool tidied the <style> element away. The
      // class stays for anyone who wants to select them.
      if (geo.noShow) {
        addClass(path, 'vsdx-hidden');
        path.setAttribute('display', 'none');
      }

      // Arrow markers. Visio only puts them on an open subpath - a section that
      // returns to its starting point (a dimension line's extension "bracket")
      // gets none, which is what its own SVG export does too.
      const openPath = isOpenSubpath(pathData);
      if (paintStroke && openPath && shape.beginArrow && shape.beginArrow > 0) {
        const markerId = `${pageContext?.idPrefix || ''}arrow-begin-${arrowCounter.value++}`;
        const marker = createArrowMarker(svgNS, markerId, getShapeStrokeColor(shape, themeColors, pageContext), true);
        defs.appendChild(marker);
        path.setAttribute('marker-start', `url(#${markerId})`);
      }
      if (paintStroke && openPath && shape.endArrow && shape.endArrow > 0) {
        const markerId = `${pageContext?.idPrefix || ''}arrow-end-${arrowCounter.value++}`;
        const marker = createArrowMarker(svgNS, markerId, getShapeStrokeColor(shape, themeColors, pageContext), false);
        defs.appendChild(marker);
        path.setAttribute('marker-end', `url(#${markerId})`);
      }

      g.appendChild(path);
    };

    let compoundRun = null;
    const strokeQueue = [];
    const flushCompoundRun = () => {
      if (!compoundRun) return;
      appendPath(compoundRun.paths.join(' '), {
        noFill: false,
        noLine: compoundRun.noLine,
        noShow: compoundRun.noShow
      }, { spans: compoundRun.spans });
      compoundRun = null;
    };
    const flushStrokeQueue = () => {
      for (const item of strokeQueue) {
        appendPath(item.pathData, item.geo, { paintFill: false, spans: item.spans });
      }
      strokeQueue.length = 0;
    };

    const hasVisibleGeometry = shape.geometry.some(geo => !geo.noShow);
    const geometryToRender = hasVisibleGeometry
      ? shape.geometry.filter(geo => !geo.noShow)
      : shape.geometry;

    for (const geo of geometryToRender) {
      const spans = pageContext?.pathSpans ? [] : null;
      const strokePathData = geometryToPath(geo.rows, shape.width, shape.height, {
        connectInternalMoves: false,
        spans
      });
      // The section a span came from is not recoverable from the row alone once
      // several sections are joined into one path.
      if (spans) for (const span of spans) span.section = geo;

      const noEffectiveLine = geo.noLine || shape.linePattern === 0;
      const hasPaintedFill = !geo.noFill && shape.fillPattern !== 0 && getFillPaint(shape, svgNS, defs, themeColors, layerInfo, strokeScale);
      const fillPathData = hasPaintedFill
        ? geometryToPath(geo.rows, shape.width, shape.height, { connectInternalMoves: true })
        : strokePathData;
      if (!strokePathData && !fillPathData) continue;

      const canCompound =
        !shape.beginArrow &&
        !shape.endArrow &&
        noEffectiveLine &&
        !geo.noFill &&
        shape.fillPattern !== 0 &&
        hasPaintedFill;

      if (canCompound) {
        if (!compoundRun || compoundRun.noLine !== geo.noLine || compoundRun.noShow !== geo.noShow) {
          flushCompoundRun();
          compoundRun = { noLine: geo.noLine, noShow: geo.noShow, paths: [], spans: spans ? [] : null };
        }
        compoundRun.paths.push(strokePathData);
        if (compoundRun.spans) compoundRun.spans.push(...spans);
      } else {
        flushCompoundRun();
        if (hasPaintedFill && !noEffectiveLine && !shape.beginArrow && !shape.endArrow) {
          appendPath(fillPathData, geo, { paintStroke: false, spans });
          if (strokePathData) strokeQueue.push({ pathData: strokePathData, geo, spans });
        } else if (!noEffectiveLine) {
          if (strokePathData) strokeQueue.push({ pathData: strokePathData, geo, spans });
        } else {
          appendPath(hasPaintedFill ? fillPathData : strokePathData, geo, { spans });
        }
      }
    }
    flushCompoundRun();
    flushStrokeQueue();
  } else if (!shape.hasGeometry && shape.subShapes.length === 0 && shape.width > 0 && shape.height > 0) {
    // No geometry and no sub-shapes - draw a rectangle as fallback
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(inToPx(shape.width)));
    rect.setAttribute('height', String(inToPx(shape.height)));
    const rectFill = getFillPaint(shape, svgNS, defs, themeColors, layerInfo, strokeScale);
    if (rectFill && shape.fillPattern !== 0) {
      rect.setAttribute('fill', rectFill);
      const fillOpacity = getFillOpacity(shape, rectFill, layerInfo);
      if (fillOpacity !== null) rect.setAttribute('fill-opacity', String(fillOpacity));
    } else {
      rect.setAttribute('fill', 'none');
    }
    rect.setAttribute('stroke', shape.linePattern === 0 ? 'none' : getShapeStrokeColor(shape, themeColors, pageContext));
    rect.setAttribute('stroke-width', String(Math.max(inToPx(shape.lineWeight) * strokeScale, minStroke)));
    if (shape.rounding > 0) {
      rect.setAttribute('rx', String(inToPx(shape.rounding)));
      rect.setAttribute('ry', String(inToPx(shape.rounding)));
    }
    g.appendChild(rect);
  }

  // Render sub-shapes (groups)
  for (const sub of shape.subShapes) {
    g.appendChild(renderShape(sub, svgNS, shape.height, defs, arrowCounter, strokeScale, fontScale, themeColors, pageContext));
  }

  appendImageNode(g, shape, svgNS);
  appendTextNode(g, shape, svgNS, pageHeight, fontScale, false);

  return g;
}

function createArrowMarker(svgNS, id, color, isStart) {
  const marker = document.createElementNS(svgNS, 'marker');
  marker.setAttribute('id', id);
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto');
  if (isStart) {
    marker.setAttribute('refX', '0');
    marker.setAttribute('refY', '3.5');
    const polygon = document.createElementNS(svgNS, 'polygon');
    polygon.setAttribute('points', '10 0, 10 7, 0 3.5');
    polygon.setAttribute('fill', color);
    marker.appendChild(polygon);
  } else {
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    const polygon = document.createElementNS(svgNS, 'polygon');
    polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
    polygon.setAttribute('fill', color);
    marker.appendChild(polygon);
  }
  return marker;
}

// Everything a shape needs to know about the page it is being drawn on. Pulled
// out of renderPage so that drawing one shape again on its own (redrawShape)
// draws it exactly as the page render would have.
function pageRenderContext(page, options = {}) {
  // Convert stroke weights (always stored in inches) into the drawing's
  // coordinate space. When drawingUnitInInches < 1 (e.g. MM), inches need to
  // scale up; default is 1 for inch-native files so existing tests are
  // unaffected.
  const strokeScale = page.drawingScale || (page.drawingUnitInInches ? (1 / page.drawingUnitInInches) : 1);
  const requestedMin = Number.isFinite(options.minStrokeWidth) ? options.minStrokeWidth : 0;
  return {
    strokeScale,
    fontScale: strokeScale,
    themeColors: page.themeColors || {},
    pageContext: {
      layersByIndex: new Map((page.layers || []).map((layer) => [String(layer.index), layer])),
      minStroke: Math.max(hairlineStroke(strokeScale), requestedMin),
      // A caller that passes a Map here gets, for every <path> drawn, the
      // geometry rows that drew it — see geometryToPath's `spans`.
      pathSpans: options.pathSpans instanceof Map ? options.pathSpans : null,
      // Pass `metadata: false` for a render nobody is going to export: it leaves
      // out the v:custProps/v:userDefs blocks, which are most of the document on
      // a real drawing. attachVisioMetadata puts them back.
      shapeProperties: options.metadata !== false,
      // Arrow markers are numbered from zero, and a redraw adds more of them to
      // an SVG that already has some. A prefix keeps the two sets apart.
      idPrefix: options.idPrefix || ''
    }
  };
}

// How many shapes have been redrawn since the page was loaded. Only used to
// keep one redraw's marker ids clear of the next one's.
let redrawSerial = 0;

/**
 * Draw one shape of an already-rendered page again, in place of the group that
 * is on the canvas for it — the same `<g>` renderPage would have built, put
 * where renderPage put it. Returns the new group, or null if there was nothing
 * on the canvas to replace.
 *
 * Moving a shape used to mean rewriting the package, parsing it again and
 * drawing every shape on the page from the result. On a 20 MB drawing that is
 * the better part of a minute to change six numbers on one shape, and nothing
 * else on the page changed at all.
 *
 * `options.parentHeight` is the height, in inches, of the group the shape hangs
 * off — the page's own height for a top-level shape. It is what a child's
 * flipped Y is measured against, and it is the one thing a shape cannot work
 * out for itself. The rest of the options are renderPage's.
 */
export function redrawShape(svg, page, shape, options = {}) {
  if (!svg || !page || !shape || shape.id === undefined || shape.id === null) return null;
  const svgNS = 'http://www.w3.org/2000/svg';
  const existing = svg.querySelector(`g[data-shape-id="${String(shape.id).replace(/["\\]/g, '\\$&')}"]`);
  const defs = svg.querySelector('defs');
  if (!existing || !defs) return null;

  // renderShape mints a fresh <marker> for every arrowhead it draws, so the
  // ones the outgoing group was pointing at belong to it alone and go with it.
  // Gradients and hatches are keyed by what they look like and shared, so they
  // stay — the redraw asks for the same ones back.
  for (const el of existing.querySelectorAll('[marker-start], [marker-end]')) {
    for (const attr of ['marker-start', 'marker-end']) {
      const id = /^url\(#([^)]+)\)$/.exec(el.getAttribute(attr) || '')?.[1];
      if (id) defs.querySelector(`marker[id="${id.replace(/["\\]/g, '\\$&')}"]`)?.remove();
    }
  }

  const { strokeScale, fontScale, themeColors, pageContext } =
    pageRenderContext(page, { ...options, idPrefix: `redraw${++redrawSerial}-` });
  const parentHeight = Number.isFinite(options.parentHeight) ? options.parentHeight : page.height;
  const group = renderShape(shape, svgNS, parentHeight, defs, { value: 0 },
    strokeScale, fontScale, themeColors, pageContext);
  existing.replaceWith(group);
  return group;
}

// options.minStrokeWidth raises the thinnest line the render may draw, in the
// page's own coordinate units. Left out, lines keep their true Visio weights
// (LineWeight 0 becoming Visio's 0.25pt hairline), which is what an export or a
// print wants. A viewer that scales the SVG down can pass the size of one
// device pixel instead, so hairlines stay on screen at that zoom - it has to
// re-render to change it, since the value is baked into the SVG.
export function renderPage(page, container, options = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttributeNS(XMLNS_NS, 'xmlns:v', VISIO_NS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  const w = inToPx(page.width);
  const h = inToPx(page.height);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('fill-rule', 'evenodd');
  svg.setAttribute('clip-rule', 'evenodd');
  svg.style.maxWidth = w + 'px';
  svg.style.background = 'white';

  const style = document.createElementNS(svgNS, 'style');
  style.setAttribute('type', 'text/css');
  style.textContent = '.vsdx-hidden{visibility:hidden}';
  svg.appendChild(style);

  const defs = document.createElementNS(svgNS, 'defs');
  svg.appendChild(defs);

  const arrowCounter = { value: 0 };

  const { strokeScale, fontScale, themeColors, pageContext } = pageRenderContext(page, options);

  for (const shape of page.shapes) {
    svg.appendChild(renderShape(shape, svgNS, page.height, defs, arrowCounter, strokeScale, fontScale, themeColors, pageContext));
  }

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
