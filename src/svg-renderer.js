const DPI = 96; // Visio inches to pixels

function inToPx(inches) {
  return inches * DPI;
}

// Convert geometry rows to SVG path data
// Coordinates are in shape-local space (0,0 to width,height) with Y-up
function geometryToPath(rows, width, height) {
  let d = '';
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;

  // If first row is not a MoveTo, add implicit MoveTo(0,0)
  if (rows.length > 0 && rows[0].type !== 'MoveTo' && rows[0].type !== 'RelMoveTo') {
    d += `M 0 ${inToPx(height)} `;
  }

  for (const row of rows) {
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
        d += `M ${mx} ${my} `;
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
        // Control point (A,B), aspect ratio C, angle D
        if (row.a !== null && row.b !== null) {
          const cpX = inToPx(row.a);
          const cpY = inToPx(height - row.b);
          // Approximate with quadratic bezier through control point
          d += `Q ${cpX} ${cpY} ${x} ${y} `;
        } else {
          d += `L ${x} ${y} `;
        }
        curX = x; curY = y;
        break;
      }

      case 'NURBSTo': {
        // Approximate NURBS with line to endpoint
        d += `L ${x} ${y} `;
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

      case 'SplineStart':
      case 'SplineKnot': {
        // Approximate spline with line
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
        if (row.a !== null && row.b !== null) {
          const cpX = inToPx(row.a * width);
          const cpY = inToPx((1 - row.b) * height);
          d += `Q ${cpX} ${cpY} ${ex} ${ey} `;
        } else {
          d += `L ${ex} ${ey} `;
        }
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

function renderShape(shape, svgNS, pageHeight, defs, arrowCounter) {
  const g = document.createElementNS(svgNS, 'g');

  // Tag with layer membership for visibility toggling
  if (shape.layerMembers && shape.layerMembers.length > 0) {
    g.setAttribute('data-layers', shape.layerMembers.join(','));
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
    for (const geo of shape.geometry) {
      const pathData = geometryToPath(geo.rows, shape.width, shape.height);
      if (!pathData) continue;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathData);

      // Fill
      if (geo.noFill || !shape.fillForeground || shape.fillPattern === 0) {
        path.setAttribute('fill', 'none');
      } else {
        path.setAttribute('fill', shape.fillForeground);
      }

      // Stroke
      if (geo.noLine || shape.linePattern === 0) {
        path.setAttribute('stroke', 'none');
      } else {
        path.setAttribute('stroke', shape.lineColor);
        path.setAttribute('stroke-width', String(Math.max(inToPx(shape.lineWeight), 0.5)));
        const dashArray = getDashArray(shape.linePattern, inToPx(shape.lineWeight));
        if (dashArray) {
          path.setAttribute('stroke-dasharray', dashArray);
        }
      }

      path.setAttribute('stroke-linejoin', 'round');

      // Arrow markers
      if (shape.beginArrow && shape.beginArrow > 0) {
        const markerId = `arrow-begin-${arrowCounter.value++}`;
        const marker = createArrowMarker(svgNS, markerId, shape.lineColor, true);
        defs.appendChild(marker);
        path.setAttribute('marker-start', `url(#${markerId})`);
      }
      if (shape.endArrow && shape.endArrow > 0) {
        const markerId = `arrow-end-${arrowCounter.value++}`;
        const marker = createArrowMarker(svgNS, markerId, shape.lineColor, false);
        defs.appendChild(marker);
        path.setAttribute('marker-end', `url(#${markerId})`);
      }

      g.appendChild(path);
    }
  } else if (shape.subShapes.length === 0 && shape.width > 0 && shape.height > 0) {
    // No geometry and no sub-shapes - draw a rectangle as fallback
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(inToPx(shape.width)));
    rect.setAttribute('height', String(inToPx(shape.height)));
    if (shape.fillForeground && shape.fillPattern !== 0) {
      rect.setAttribute('fill', shape.fillForeground);
    } else {
      rect.setAttribute('fill', 'none');
    }
    rect.setAttribute('stroke', shape.linePattern === 0 ? 'none' : shape.lineColor);
    rect.setAttribute('stroke-width', String(Math.max(inToPx(shape.lineWeight), 0.5)));
    if (shape.rounding > 0) {
      rect.setAttribute('rx', String(inToPx(shape.rounding)));
      rect.setAttribute('ry', String(inToPx(shape.rounding)));
    }
    g.appendChild(rect);
  }

  // Render sub-shapes (groups)
  for (const sub of shape.subShapes) {
    g.appendChild(renderShape(sub, svgNS, shape.height, defs, arrowCounter));
  }

  // Render text
  if (shape.text) {
    const text = document.createElementNS(svgNS, 'text');
    const fontSize = shape.fontSize ? inToPx(shape.fontSize) : 12;
    text.setAttribute('x', String(inToPx(shape.width) / 2));
    text.setAttribute('y', String(inToPx(shape.height) / 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-size', String(fontSize));
    text.setAttribute('fill', shape.fontColor || '#000000');
    text.setAttribute('font-family', 'Calibri, Arial, sans-serif');
    if (shape.bold) text.setAttribute('font-weight', 'bold');
    if (shape.italic) text.setAttribute('font-style', 'italic');

    // Handle multi-line text
    const lines = shape.text.split('\n').filter(l => l.trim());
    if (lines.length <= 1) {
      text.textContent = shape.text;
    } else {
      const lineHeight = fontSize * 1.2;
      const startY = inToPx(shape.height) / 2 - (lines.length - 1) * lineHeight / 2;
      for (let i = 0; i < lines.length; i++) {
        const tspan = document.createElementNS(svgNS, 'tspan');
        tspan.setAttribute('x', String(inToPx(shape.width) / 2));
        tspan.setAttribute('y', String(startY + i * lineHeight));
        tspan.textContent = lines[i];
        text.appendChild(tspan);
      }
    }
    g.appendChild(text);
  }

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
  const w = inToPx(page.width);
  const h = inToPx(page.height);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.maxWidth = w + 'px';
  svg.style.background = 'white';

  const defs = document.createElementNS(svgNS, 'defs');
  svg.appendChild(defs);

  const arrowCounter = { value: 0 };

  for (const shape of page.shapes) {
    svg.appendChild(renderShape(shape, svgNS, page.height, defs, arrowCounter));
  }

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}
