// SVG path data, read as pen nodes.
//
// The pen's node model is a list of anchors each carrying an incoming and an
// outgoing handle — which is exactly a cubic path and nothing else. Everything
// else SVG can write has to be converted on the way in, and a conversion that
// is subtly wrong draws a shape that looks nearly right, so these checks measure
// the curves rather than counting them: a quarter circle has to actually land
// on the circle, a quadratic on the quadratic.
import { mkdtempSync, rmSync, cpSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const tmp = mkdtempSync(join(tmpdir(), 'vsdx-esm-svgpath-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });
cpSync('src', tmp, { recursive: true });
writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
symlinkSync(join(process.cwd(), 'node_modules'), join(tmp, 'node_modules'), 'dir');

const { pathToSubpaths, arcToCubics } = await import(pathToFileURL(join(tmp, 'svg-path.js')));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const at = (nodes, i) => `${nodes[i].x},${nodes[i].y}`;

// Where a cubic segment actually is, so a curve can be measured rather than
// described. The handles that are unset sit on their anchor, which is how a
// straight segment stays a valid cubic.
function pointOn(from, to, t) {
  const c1 = from.cOut || { x: from.x, y: from.y };
  const c2 = to.cIn || { x: to.x, y: to.y };
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y
  };
}

console.log('\nthe plain commands');
{
  const [sub] = pathToSubpaths('M 10 20 L 30 40');
  check('a moveto and a lineto give two anchors', sub.nodes.length === 2, String(sub.nodes.length));
  check('at the coordinates written', at(sub.nodes, 0) === '10,20' && at(sub.nodes, 1) === '30,40',
    JSON.stringify(sub.nodes.map(n => [n.x, n.y])));
  check('and it is open', sub.closed === false);
}
{
  const [sub] = pathToSubpaths('m 10 20 l 20 20 l 0 -40');
  check('relative commands accumulate',
    at(sub.nodes, 1) === '30,40' && at(sub.nodes, 2) === '30,0',
    JSON.stringify(sub.nodes.map(n => [n.x, n.y])));
}
{
  const [sub] = pathToSubpaths('M 0 0 10 10 20 0');
  check('a repeated moveto is a lineto, as the spec says', sub.nodes.length === 3, String(sub.nodes.length));
  check('…continuing from where it was', at(sub.nodes, 2) === '20,0', at(sub.nodes, 2));
}
{
  const [sub] = pathToSubpaths('M 5 5 H 25 V 15 h -10 v -5');
  check('H and V move one axis at a time',
    sub.nodes.map(n => `${n.x},${n.y}`).join(' ') === '5,5 25,5 25,15 15,15 15,10',
    sub.nodes.map(n => `${n.x},${n.y}`).join(' '));
}
{
  const subs = pathToSubpaths('M 0 0 L 1 0 M 5 5 L 6 5 L 6 6 Z');
  check('a second moveto starts a second subpath', subs.length === 2, String(subs.length));
  check('and only the one that says Z is closed',
    subs[0].closed === false && subs[1].closed === true);
}
{
  // The common way an editor writes a closed triangle: back to the start, then
  // Z. The pen closes by joining last to first, so the repeat has to go.
  const [sub] = pathToSubpaths('M 0 0 L 10 0 L 10 10 L 0 0 Z');
  check('a closing point that repeats the first is dropped', sub.nodes.length === 3,
    JSON.stringify(sub.nodes.map(n => [n.x, n.y])));
  check('…and the subpath is still closed', sub.closed === true);
}
{
  check('a path with a single point draws nothing', pathToSubpaths('M 5 5').length === 0);
  check('empty path data is nothing at all', pathToSubpaths('').length === 0);
  let threw = false;
  try { pathToSubpaths('1 2 3 4'); } catch { threw = true; }
  check('path data with no command at all is an error, not a guess', threw);
}

console.log('\ncurves');
{
  const [sub] = pathToSubpaths('M 0 0 C 0 10 10 20 20 20');
  check('a cubic keeps both handles',
    JSON.stringify(sub.nodes[0].cOut) === '{"x":0,"y":10}'
    && JSON.stringify(sub.nodes[1].cIn) === '{"x":10,"y":20}',
    JSON.stringify(sub.nodes));
}
{
  // S mirrors the previous second control point about the joint.
  const [sub] = pathToSubpaths('M 0 0 C 0 10 10 20 20 20 S 40 30 40 20');
  check('S reflects the previous handle',
    JSON.stringify(sub.nodes[1].cOut) === '{"x":30,"y":20}', JSON.stringify(sub.nodes[1].cOut));
  check('…and takes its own second handle from the data',
    JSON.stringify(sub.nodes[2].cIn) === '{"x":40,"y":30}', JSON.stringify(sub.nodes[2].cIn));
}
{
  // A quadratic has an exact cubic form; check the curve, not the formula.
  const [sub] = pathToSubpaths('M 0 0 Q 10 20 20 0');
  const quad = (t) => ({
    x: (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * 10 + t * t * 20,
    y: (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * 20 + t * t * 0
  });
  let worst = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const got = pointOn(sub.nodes[0], sub.nodes[1], t);
    const want = quad(t);
    worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y));
  }
  check('a quadratic converts to the identical cubic', worst < 1e-9, `off by ${worst}`);
}
{
  const [sub] = pathToSubpaths('M 0 0 Q 10 20 20 0 T 40 0');
  check('T reflects the previous quadratic control point', sub.nodes.length === 3, String(sub.nodes.length));
  // The reflected control is (30,-20); the cubic handles are two thirds of the
  // way there from each end.
  check('…which puts the curve below the axis',
    near(pointOn(sub.nodes[1], sub.nodes[2], 0.5).y, -10, 1e-9),
    String(pointOn(sub.nodes[1], sub.nodes[2], 0.5).y));
}

console.log('\narcs');
{
  // A quarter of the unit-100 circle centred on the origin, drawn from (100,0)
  // to (0,100). Every point on it has to be 100 from the centre.
  const [sub] = pathToSubpaths('M 100 0 A 100 100 0 0 1 0 100');
  check('an arc becomes at least one cubic', sub.nodes.length >= 2, String(sub.nodes.length));
  let worst = 0;
  for (let i = 0; i + 1 < sub.nodes.length; i++) {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = pointOn(sub.nodes[i], sub.nodes[i + 1], t);
      worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - 100));
    }
  }
  check('and every point of it lands on the circle', worst < 0.03, `off by ${worst.toFixed(4)}`);
  check('it ends where the path says it ends',
    near(sub.nodes[sub.nodes.length - 1].x, 0, 1e-6) && near(sub.nodes[sub.nodes.length - 1].y, 100, 1e-6),
    at(sub.nodes, sub.nodes.length - 1));
}
{
  // Both of these run from (100,0) to (0,100) on a circle of radius 100, and
  // there are two such circles; the large-arc flag picks the long way round the
  // one centred at (100,100), which swings out to x = 200. The short way stays
  // inside the box the endpoints make.
  const long = pathToSubpaths('M 100 0 A 100 100 0 1 1 0 100')[0];
  const short = pathToSubpaths('M 100 0 A 100 100 0 0 1 0 100')[0];
  const reach = (sub) => {
    let maxX = -Infinity;
    for (let i = 0; i + 1 < sub.nodes.length; i++) {
      for (let t = 0; t <= 1.0001; t += 0.05) maxX = Math.max(maxX, pointOn(sub.nodes[i], sub.nodes[i + 1], t).x);
    }
    return maxX;
  };
  check('the large-arc flag goes the long way round', reach(long) > 199 && reach(short) < 100.001,
    `${reach(long).toFixed(2)} vs ${reach(short).toFixed(2)}`);
  check('…and takes more than one cubic to do it',
    long.nodes.length > short.nodes.length, `${long.nodes.length} vs ${short.nodes.length}`);
}
{
  // Flags may run into the number after them with no separator at all, which is
  // why the scanner reads them one character at a time.
  const packed = pathToSubpaths('M 100 0 a 100 100 0 01-100 100');
  const spaced = pathToSubpaths('M 100 0 a 100 100 0 0 1 -100 100');
  check('arc flags written without separators parse the same',
    JSON.stringify(packed) === JSON.stringify(spaced),
    JSON.stringify(packed.map(s => s.nodes.length)));
}
{
  const straight = arcToCubics(0, 0, 0, 0, 0, false, true, 10, 10);
  check('an arc with no radius degrades to a straight segment',
    straight.length === 1 && straight[0].to.x === 10 && straight[0].to.y === 10, JSON.stringify(straight));
  // Radii too small to span the endpoints are scaled up rather than refused.
  const stretched = arcToCubics(0, 0, 1, 1, 0, false, true, 100, 0);
  const mid = stretched.map(piece => piece.to).pop();
  check('radii too small for the span are scaled up, not rejected',
    near(mid.x, 100, 1e-6) && near(mid.y, 0, 1e-6), JSON.stringify(mid));
}

console.log('\nnumbers');
{
  const [sub] = pathToSubpaths('M-1.5-2.5L1e2 5.5e-1');
  check('signs and exponents separate numbers on their own',
    at(sub.nodes, 0) === '-1.5,-2.5' && at(sub.nodes, 1) === '100,0.55',
    JSON.stringify(sub.nodes.map(n => [n.x, n.y])));
}
{
  const [sub] = pathToSubpaths('M .5 .5 L .25 .75');
  check('a leading decimal point is a number', at(sub.nodes, 0) === '0.5,0.5', at(sub.nodes, 0));
}
{
  let threw = false;
  try { pathToSubpaths('M 0 0 L 10 nonsense'); } catch { threw = true; }
  check('unreadable path data is an error rather than half a shape', threw);
}

console.log(`\nsvg path: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
