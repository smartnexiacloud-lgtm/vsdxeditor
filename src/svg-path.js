// SVG path data -> the pen tool's node model.
//
// src/pen-geometry.js already knows how to turn a list of anchors-with-handles
// into Visio geometry, because that is what the pen draws. An SVG path is the
// same thing written differently, so importing one is a translation rather than
// a fit — with three wrinkles:
//
//   * SVG has shorthands the model does not: H/V, the smooth S/T whose first
//     control point is a reflection of the previous one, and Q, a quadratic.
//     Each of those has an exact cubic equivalent, so they are expanded here.
//   * A (elliptical arc) has no exact cubic form. It is approximated by
//     splitting the arc at 90 degrees or less and using the standard
//     four-thirds-tangent cubic for each piece, which is accurate to about
//     0.02% of the radius — far below anything a drawing cares about.
//   * arc flags may be written without separators ("a1 1 0 011 1"), so the
//     scanner has to know it is reading a flag rather than a number. That is
//     why this is a hand-rolled scanner and not a regex.
//
// Coordinates come out in the path's own user units; placing them on a page is
// the caller's job (src/svg-import.js).

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', ',']);
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function scanCommands(d) {
  const s = String(d ?? '');
  let i = 0;

  const skip = () => { while (i < s.length && WHITESPACE.has(s[i])) i++; };
  const digit = (c) => c >= '0' && c <= '9';

  const readNumber = () => {
    skip();
    const start = i;
    if (s[i] === '+' || s[i] === '-') i++;
    while (i < s.length && digit(s[i])) i++;
    if (s[i] === '.') { i++; while (i < s.length && digit(s[i])) i++; }
    if (s[i] === 'e' || s[i] === 'E') {
      i++;
      if (s[i] === '+' || s[i] === '-') i++;
      while (i < s.length && digit(s[i])) i++;
    }
    const text = s.slice(start, i);
    const value = Number(text);
    if (!text || !Number.isFinite(value)) throw new Error(`Unreadable number in path data at offset ${start}`);
    return value;
  };

  // largeArc and sweep are single characters, and are allowed to run straight
  // into the number after them.
  const readFlag = () => {
    skip();
    const c = s[i];
    if (c !== '0' && c !== '1') throw new Error(`Unreadable arc flag in path data at offset ${i}`);
    i++;
    return c === '1';
  };

  const commands = [];
  let previous = null;
  skip();
  while (i < s.length) {
    let letter = s[i];
    if (/[MmZzLlHhVvCcSsQqTtAa]/.test(letter)) {
      i++;
    } else if (previous) {
      // An implicit repeat: "L 1 2 3 4" is two lineto commands, and a repeated
      // moveto is a lineto, which is what SVG says.
      letter = previous === 'M' ? 'L' : previous === 'm' ? 'l' : previous;
    } else {
      throw new Error(`Path data does not start with a command: "${s.slice(0, 12)}"`);
    }

    const upper = letter.toUpperCase();
    const arity = ARITY[upper];
    if (arity === undefined) throw new Error(`Unsupported path command "${letter}"`);

    const args = [];
    if (upper === 'A') {
      args.push(readNumber(), readNumber(), readNumber(), readFlag(), readFlag(), readNumber(), readNumber());
    } else {
      for (let n = 0; n < arity; n++) args.push(readNumber());
    }
    commands.push({ command: upper, relative: letter !== upper, args });
    previous = letter;
    skip();
  }
  return commands;
}

// One arc segment spanning at most a quarter turn, as a cubic. This is the
// classic approximation: the control points sit a quarter-tangent's length
// along the tangents, scaled by (4/3)·tan(Δθ/4).
function arcSegmentToCubic(cx, cy, rx, ry, cosPhi, sinPhi, theta, delta) {
  const t = (4 / 3) * Math.tan(delta / 4);
  const cos1 = Math.cos(theta);
  const sin1 = Math.sin(theta);
  const cos2 = Math.cos(theta + delta);
  const sin2 = Math.sin(theta + delta);

  const point = (c, s) => ({
    x: cx + rx * c * cosPhi - ry * s * sinPhi,
    y: cy + rx * c * sinPhi + ry * s * cosPhi
  });
  const tangent = (c, s) => ({
    x: -rx * s * cosPhi - ry * c * sinPhi,
    y: -rx * s * sinPhi + ry * c * cosPhi
  });

  const p1 = point(cos1, sin1);
  const p2 = point(cos2, sin2);
  const d1 = tangent(cos1, sin1);
  const d2 = tangent(cos2, sin2);
  return {
    c1: { x: p1.x + t * d1.x, y: p1.y + t * d1.y },
    c2: { x: p2.x - t * d2.x, y: p2.y - t * d2.y },
    to: p2
  };
}

// Endpoint parameterisation -> centre parameterisation, straight out of the
// SVG specification's implementation notes (F.6.5), then split into quarters.
export function arcToCubics(x1, y1, rx, ry, rotationDeg, largeArc, sweep, x2, y2) {
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx === 0 || ry === 0) {
    return [{ c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, to: { x: x2, y: y2 } }];
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Radii too small to reach both endpoints are scaled up, as the spec requires.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    const value = len === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };

  const startX = (x1p - cxp) / rx;
  const startY = (y1p - cyp) / ry;
  const endX = (-x1p - cxp) / rx;
  const endY = (-y1p - cyp) / ry;
  const theta = angle(1, 0, startX, startY);
  let sweepAngle = angle(startX, startY, endX, endY);
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const step = sweepAngle / pieces;
  const out = [];
  for (let n = 0; n < pieces; n++) {
    out.push(arcSegmentToCubic(cx, cy, rx, ry, cosPhi, sinPhi, theta + n * step, step));
  }
  return out;
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * Parse path data into subpaths of pen nodes.
 *
 * Each subpath is `{ nodes: [{x, y, cIn, cOut}], closed }` — the shape of thing
 * buildPenShapeXml takes. A path with several `M` commands yields several
 * subpaths, because a Visio shape holds one outline.
 */
export function pathToSubpaths(d) {
  const commands = scanCommands(d);
  const subpaths = [];

  let current = null;
  let x = 0, y = 0;              // current point
  let startX = 0, startY = 0;    // subpath start, where Z returns to
  let lastCubic = null;          // second control point of the previous C/S
  let lastQuad = null;           // control point of the previous Q/T

  const push = (nx, ny) => {
    current.nodes.push({ x: nx, y: ny, cIn: null, cOut: null });
  };
  const openSubpath = (nx, ny) => {
    current = { nodes: [], closed: false };
    subpaths.push(current);
    push(nx, ny);
    startX = nx;
    startY = ny;
  };
  const cubic = (c1, c2, to) => {
    if (!current) openSubpath(x, y);
    const from = current.nodes[current.nodes.length - 1];
    from.cOut = { x: c1.x, y: c1.y };
    current.nodes.push({ x: to.x, y: to.y, cIn: { x: c2.x, y: c2.y }, cOut: null });
  };

  for (const { command, relative, args } of commands) {
    const rx = relative ? x : 0;
    const ry = relative ? y : 0;

    switch (command) {
      case 'M':
        openSubpath(args[0] + rx, args[1] + ry);
        x = current.nodes[0].x;
        y = current.nodes[0].y;
        lastCubic = lastQuad = null;
        break;

      case 'L':
        if (!current) openSubpath(x, y);
        x = args[0] + rx;
        y = args[1] + ry;
        push(x, y);
        lastCubic = lastQuad = null;
        break;

      case 'H':
        if (!current) openSubpath(x, y);
        x = args[0] + rx;
        push(x, y);
        lastCubic = lastQuad = null;
        break;

      case 'V':
        if (!current) openSubpath(x, y);
        y = args[0] + ry;
        push(x, y);
        lastCubic = lastQuad = null;
        break;

      case 'C': {
        const c1 = { x: args[0] + rx, y: args[1] + ry };
        const c2 = { x: args[2] + rx, y: args[3] + ry };
        const to = { x: args[4] + rx, y: args[5] + ry };
        cubic(c1, c2, to);
        x = to.x; y = to.y;
        lastCubic = c2;
        lastQuad = null;
        break;
      }

      case 'S': {
        // The first control point mirrors the previous one about the current
        // point; with no previous curve it sits on the current point.
        const c1 = lastCubic ? { x: 2 * x - lastCubic.x, y: 2 * y - lastCubic.y } : { x, y };
        const c2 = { x: args[0] + rx, y: args[1] + ry };
        const to = { x: args[2] + rx, y: args[3] + ry };
        cubic(c1, c2, to);
        x = to.x; y = to.y;
        lastCubic = c2;
        lastQuad = null;
        break;
      }

      case 'Q':
      case 'T': {
        const q = command === 'Q'
          ? { x: args[0] + rx, y: args[1] + ry }
          : (lastQuad ? { x: 2 * x - lastQuad.x, y: 2 * y - lastQuad.y } : { x, y });
        const to = command === 'Q'
          ? { x: args[2] + rx, y: args[3] + ry }
          : { x: args[0] + rx, y: args[1] + ry };
        // A quadratic is exactly the cubic whose controls are two thirds of the
        // way from each endpoint to the quadratic's control point.
        const c1 = { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) };
        const c2 = { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) };
        cubic(c1, c2, to);
        x = to.x; y = to.y;
        lastQuad = q;
        lastCubic = c2;
        break;
      }

      case 'A': {
        const to = { x: args[5] + rx, y: args[6] + ry };
        for (const piece of arcToCubics(x, y, args[0], args[1], args[2], args[3], args[4], to.x, to.y)) {
          cubic(piece.c1, piece.c2, piece.to);
          x = piece.to.x;
          y = piece.to.y;
        }
        lastCubic = lastQuad = null;
        break;
      }

      case 'Z':
        if (current) {
          current.closed = true;
          x = startX;
          y = startY;
          current = null;   // anything after Z starts a fresh subpath
        }
        lastCubic = lastQuad = null;
        break;

      default:
        throw new Error(`Unsupported path command "${command}"`);
    }
  }

  return subpaths
    .map(subpath => {
      // "…L x0 y0 Z" closes by repeating the first point. The pen model closes
      // by joining the last node to the first, so the repeat is a zero-length
      // segment — drop it, keeping the handle that arrives at it.
      const nodes = subpath.nodes;
      if (subpath.closed && nodes.length > 2) {
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (near(first.x, last.x) && near(first.y, last.y)) {
          first.cIn = last.cIn;
          nodes.pop();
        }
      }
      return subpath;
    })
    .filter(subpath => subpath.nodes.length >= 2);
}
