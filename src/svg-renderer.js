const DPI = 96; // Visio inches to pixels
const VISIO_NS = 'http://schemas.microsoft.com/visio/2003/SVGExtensions/';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

function inToPx(inches) {
  return inches * DPI;
}

export { geometryToPath };

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
function geometryToPath(rows, width, height, options = {}) {
  let d = '';
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;

  // If first row is not a MoveTo, add implicit MoveTo(0,0)
  if (rows.length > 0 && rows[0].type !== 'MoveTo' && rows[0].type !== 'RelMoveTo') {
    d += `M 0 ${inToPx(height)} `;
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
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
  }
  return d.trim();
}

// Build stroke-dasharray from Visio LinePattern
function getDashArray(linePattern, lineWeight) {
  const w = Math.max(lineWeight, 1);
  switch (Math.round(linePattern)) {
    case 0: return null; // no line
    case 1: return ''; // solid
    case 2: return `${w * 6} ${w * 3}`; // dash
    case 3: return `${w} ${w * 3}`; // dot
    case 4: return `${w * 6} ${w * 3} ${w} ${w * 3}`; // dash-dot
    case 5: return `${w * 6} ${w * 3} ${w} ${w * 3} ${w} ${w * 3}`; // dash-dot-dot
    default: return '';
  }
}

function getFallbackFill(shape, themeColors) {
  return shape.fillForeground || ((!shape.fillForeground && shape.fillBackground && shape.fontColor && isLightColor(shape.fontColor))
    ? shape.fillBackground
    : ((!shape.fillForeground && themeColors.lt1 && shape.fontColor && !isLightColor(shape.fontColor)) ? themeColors.lt1 : shape.fillBackground));
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
      { offset: 0, color: shape.fillBackground || '#FFFFFF', opacity: 1 },
      { offset: 100, color: shape.fillForeground || shape.fillBackground || '#CCCCCC', opacity: 1 }
    ];
  appendGradientStops(gradient, svgNS, stops);
  return gradient;
}

function getFillPaint(shape, svgNS, defs, themeColors) {
  const fillColor = getFallbackFill(shape, themeColors);
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

function wrapTextLines(text, maxWidthPx, fontSize) {
  const explicitLines = String(text).split('\n').map(line => line.trim()).filter(Boolean);
  if (explicitLines.length > 1) return explicitLines;
  const source = explicitLines.length === 1 ? explicitLines[0] : String(text).trim();
  if (!source) return [];
  if (!maxWidthPx || maxWidthPx <= 0 || !fontSize) return [source];

  const words = source.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [source];

  const avgCharWidth = fontSize * 0.36;
  const maxChars = Math.max(8, Math.floor(maxWidthPx / avgCharWidth));
  if (source.length <= maxChars) return [source];

  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  if (current) lines.push(current);

  if (lines.length > 2 && words.length >= 4) {
    let bestSplit = 1;
    let bestScore = Infinity;
    for (let i = 1; i < words.length; i++) {
      const left = words.slice(0, i).join(' ');
      const right = words.slice(i).join(' ');
      const score = Math.abs(left.length - right.length);
      if (score < bestScore) {
        bestScore = score;
        bestSplit = i;
      }
    }
    return [
      words.slice(0, bestSplit).join(' '),
      words.slice(bestSplit).join(' ')
    ];
  }

  return lines;
}

function formatFontFamily(fontFamily) {
  if (!fontFamily || fontFamily === 'Themed') return 'Calibri, Arial, sans-serif';
  const clean = xmlSafe(fontFamily);
  if (/,/.test(clean)) return clean;
  return `${clean}, Calibri, Arial, sans-serif`;
}

function appendTextNode(target, shape, svgNS, pageHeight, fontScale, isConnector = false) {
  if (!shape.text) return;
  const text = document.createElementNS(svgNS, 'text');
  const fontSize = shape.fontSize ? inToPx(shape.fontSize) * fontScale : 12;
  const fill = shape.fontColor || '#000000';
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('font-size', String(fontSize));
  text.setAttribute('fill', fill);
  text.setAttribute('font-family', formatFontFamily(shape.fontFamily));
  if (shape.bold) text.setAttribute('font-weight', 'bold');
  if (shape.italic) text.setAttribute('font-style', 'italic');

  const maxWidthPx = inToPx(Math.abs(shape.txtWidth || shape.width || 0));
  const lines = wrapTextLines(xmlSafe(shape.text), maxWidthPx, fontSize);

  if (isConnector) {
    const pt = toConnectorPoint(shape, pageHeight, shape.txtPinX ?? shape.locPinX ?? 0, shape.txtPinY ?? shape.locPinY ?? 0);
    text.setAttribute('x', String(pt.x));
    text.setAttribute('y', String(pt.y));
  } else {
    text.setAttribute('x', String(inToPx(shape.txtPinX ?? (shape.width / 2))));
    text.setAttribute('y', String(inToPx((shape.height || 0) - (shape.txtPinY ?? (shape.height / 2)))));
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
      : inToPx((shape.height || 0) - (shape.txtPinY ?? (shape.height / 2)));
    const startY = centerY - ((lines.length - 1) * lineHeight / 2);
    const x = isConnector
      ? toConnectorPoint(shape, pageHeight, shape.txtPinX ?? shape.locPinX ?? 0, shape.txtPinY ?? shape.locPinY ?? 0).x
      : inToPx(shape.txtPinX ?? (shape.width / 2));
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

function appendShapeMetadata(target, shape, svgNS) {
  const titleText = shape.title || shape.name || shape.nameU;
  if (titleText) {
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = xmlSafe(titleText);
    target.appendChild(title);
  }

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
    target.appendChild(custProps);
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
    target.appendChild(userDefs);
  }
}

function renderShape(shape, svgNS, pageHeight, defs, arrowCounter, strokeScale, fontScale, themeColors = {}) {
  if (fontScale === undefined) fontScale = strokeScale;
  const g = document.createElementNS(svgNS, 'g');
  if (shape.id) {
    const safeId = String(shape.id).replace(/[^A-Za-z0-9_-]/g, '_');
    g.setAttribute('id', `shape${safeId}`);
    g.setAttribute('data-shape-id', String(shape.id));
  }
  setVisioAttr(g, 'mID', shape.id);
  setVisioAttr(g, 'groupContext', shape.type === 'Group' ? 'group' : 'shape');

  // Tag with layer membership for visibility toggling
  if (shape.layerMembers && shape.layerMembers.length > 0) {
    g.setAttribute('data-layers', xmlSafe(shape.layerMembers.join(',')));
    setVisioAttr(g, 'layerMember', shape.layerMembers.join(','));
  }
  appendShapeMetadata(g, shape, svgNS);

  // Dedicated 1D connector rendering uses page-coordinate geometry instead of
  // shape-local transforms. This avoids collapsing routed connectors and keeps
  // BeginX/EndX fallbacks consistent with Visio.
  if (shape.is1D && shape.subShapes.length === 0) {
    const pathData = buildConnectorPath(shape, pageHeight);
    if (pathData) {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'none');
      const strokeColor = shape.linePattern === 0 ? 'none' : (shape.lineColor || themeColors.dk1 || '#000000');
      const effectiveWeight = Math.max(inToPx(shape.lineWeight || 0.01) * strokeScale, 1.5);
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', String(effectiveWeight));
      const dashArray = getDashArray(shape.linePattern || 1, effectiveWeight);
      if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
      path.setAttribute('stroke-linejoin', 'round');
      if (shape.beginArrow && shape.beginArrow > 0) {
        const markerId = `arrow-begin-${arrowCounter.value++}`;
        defs.appendChild(createArrowMarker(svgNS, markerId, strokeColor, true));
        path.setAttribute('marker-start', `url(#${markerId})`);
      }
      if (shape.endArrow && shape.endArrow > 0) {
        const markerId = `arrow-end-${arrowCounter.value++}`;
        defs.appendChild(createArrowMarker(svgNS, markerId, strokeColor, false));
        path.setAttribute('marker-end', `url(#${markerId})`);
      }
      g.appendChild(path);
    }
    appendTextNode(g, shape, svgNS, pageHeight, fontScale, true);
    return g;
  }

  // Calculate transform
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
  g.setAttribute('transform', transform);

  // Render geometry
  if (shape.geometry.length > 0) {
    const appendPath = (pathData, geo, options = {}) => {
      if (!pathData) return;
      const paintFill = options.paintFill !== false;
      const paintStroke = options.paintStroke !== false;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathData);

      // Fill
      const fillColor = getFillPaint(shape, svgNS, defs, themeColors);
      if (!paintFill || geo.noFill || !fillColor || shape.fillPattern === 0) {
        path.setAttribute('fill', 'none');
      } else {
        path.setAttribute('fill', fillColor);
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
        path.setAttribute('stroke', shape.lineColor || themeColors.dk1 || '#000000');
        const effectiveWeight = inToPx(shape.lineWeight) * strokeScale;
        path.setAttribute('stroke-width', String(Math.max(effectiveWeight, 0.5)));
        const dashArray = getDashArray(shape.linePattern, effectiveWeight);
        if (dashArray) {
          path.setAttribute('stroke-dasharray', dashArray);
        }
      }

      path.setAttribute('stroke-linejoin', 'round');
      if (geo.noShow) addClass(path, 'vsdx-hidden');

      // Arrow markers
      if (paintStroke && shape.beginArrow && shape.beginArrow > 0) {
        const markerId = `arrow-begin-${arrowCounter.value++}`;
        const marker = createArrowMarker(svgNS, markerId, shape.lineColor || themeColors.dk1 || '#000000', true);
        defs.appendChild(marker);
        path.setAttribute('marker-start', `url(#${markerId})`);
      }
      if (paintStroke && shape.endArrow && shape.endArrow > 0) {
        const markerId = `arrow-end-${arrowCounter.value++}`;
        const marker = createArrowMarker(svgNS, markerId, shape.lineColor || themeColors.dk1 || '#000000', false);
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
      });
      compoundRun = null;
    };
    const flushStrokeQueue = () => {
      for (const item of strokeQueue) {
        appendPath(item.pathData, item.geo, { paintFill: false });
      }
      strokeQueue.length = 0;
    };

    const hasVisibleGeometry = shape.geometry.some(geo => !geo.noShow);
    const geometryToRender = hasVisibleGeometry
      ? shape.geometry.filter(geo => !geo.noShow)
      : shape.geometry;

    for (const geo of geometryToRender) {
      const pathData = geometryToPath(geo.rows, shape.width, shape.height, {
        connectInternalMoves: false
      });
      if (!pathData) continue;

      const noEffectiveLine = geo.noLine || shape.linePattern === 0;
      const hasPaintedFill = !geo.noFill && shape.fillPattern !== 0 && getFillPaint(shape, svgNS, defs, themeColors);
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
          compoundRun = { noLine: geo.noLine, noShow: geo.noShow, paths: [] };
        }
        compoundRun.paths.push(pathData);
      } else {
        flushCompoundRun();
        if (hasPaintedFill && !noEffectiveLine && !shape.beginArrow && !shape.endArrow) {
          appendPath(pathData, geo, { paintStroke: false });
          strokeQueue.push({ pathData, geo });
        } else if (!noEffectiveLine) {
          strokeQueue.push({ pathData, geo });
        } else {
          appendPath(pathData, geo);
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
    const rectFill = getFillPaint(shape, svgNS, defs, themeColors);
    if (rectFill && shape.fillPattern !== 0) {
      rect.setAttribute('fill', rectFill);
    } else {
      rect.setAttribute('fill', 'none');
    }
    rect.setAttribute('stroke', shape.linePattern === 0 ? 'none' : (shape.lineColor || themeColors.dk1 || '#000000'));
    rect.setAttribute('stroke-width', String(Math.max(inToPx(shape.lineWeight) * strokeScale, 0.5)));
    if (shape.rounding > 0) {
      rect.setAttribute('rx', String(inToPx(shape.rounding)));
      rect.setAttribute('ry', String(inToPx(shape.rounding)));
    }
    g.appendChild(rect);
  }

  // Render sub-shapes (groups)
  for (const sub of shape.subShapes) {
    g.appendChild(renderShape(sub, svgNS, shape.height, defs, arrowCounter, strokeScale, fontScale, themeColors));
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

export function renderPage(page, container) {
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

  // Convert stroke weights (always stored in inches) into the drawing's
  // coordinate space. When drawingUnitInInches < 1 (e.g. MM), inches need to
  // scale up; default is 1 for inch-native files so existing tests are
  // unaffected.
  const strokeScale = page.drawingScale || (page.drawingUnitInInches ? (1 / page.drawingUnitInInches) : 1);
  const fontScale = strokeScale;
  const themeColors = page.themeColors || {};

  for (const shape of page.shapes) {
    svg.appendChild(renderShape(shape, svgNS, page.height, defs, arrowCounter, strokeScale, fontScale, themeColors));
  }

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
