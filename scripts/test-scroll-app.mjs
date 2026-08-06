// Getting around a drawing that is bigger than the window.
//
// Panning here is a CSS transform rather than a scroll — that is what keeps the
// vectors crisp when you zoom, see commitLayoutZoom — and the price of that is
// that the browser has no scrollable box in the viewport. So it drew no
// scrollbars, honoured no wheel and answered no arrow key: dragging was the
// only way to move, and dragging could throw the drawing off the side of the
// window with no way to find it again.
//
// So what is checked here is the ways of moving, and the one invariant that
// makes a scrollbar meaningful at all: the drawing cannot leave the window.
//
// Run `npm run build` first.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'fs';
import JSZip from 'jszip';

if (!existsSync('dist/main.js')) {
  console.error('dist/main.js not found — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync('dist/app.html', 'utf8');
const bundle = readFileSync('dist/main.js', 'utf8');

// jsdom has no layout, so the viewport is given a believable size and nothing
// else has one. Everything below is measured against these two numbers.
const VIEW = { width: 1200, height: 800 };

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  beforeParse(window) {
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};
    delete window.MutationObserver;
    window.setImmediate = (fn, ...a) => setTimeout(fn, 0, ...a);
    // The pan is written on the next animation frame; without one nothing moves.
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
    window.Element.prototype.getBoundingClientRect = function () {
      if (this.id === 'viewport') {
        return { x: 0, y: 0, top: 0, left: 0, right: VIEW.width, bottom: VIEW.height, ...VIEW };
      }
      // The scrollbars sit inside the viewport, inset by their own thickness.
      if (this.classList?.contains('viewport-scrollbar-x')) {
        return { x: 0, y: VIEW.height - 12, top: VIEW.height - 12, left: 0,
          right: VIEW.width - 12, bottom: VIEW.height, width: VIEW.width - 12, height: 12 };
      }
      if (this.classList?.contains('viewport-scrollbar-y')) {
        return { x: VIEW.width - 12, y: 0, top: 0, left: VIEW.width - 12,
          right: VIEW.width, bottom: VIEW.height - 12, width: 12, height: VIEW.height - 12 };
      }
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    };
  },
});
const { window } = dom;
window.HTMLAnchorElement.prototype.click = function () {};

const scriptEl = window.document.createElement('script');
scriptEl.textContent = bundle;
window.document.body.appendChild(scriptEl);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS ✓' : 'FAIL ✗'} ${name}${cond ? '' : '  ' + detail}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const $ = (id) => window.document.getElementById(id);
const waitFor = async (done) => {
  const deadline = Date.now() + (Number(process.env.TEST_WAIT_TIMEOUT_MS) || 120000);
  while (Date.now() < deadline) {
    if (done()) return true;
    await sleep(25);
  }
  return false;
};
const currentSvg = () => window.document.querySelector('#svg-container svg');

// Where the drawing sits, in window pixels. The transform is the whole truth
// about that, so it is read rather than inferred.
const pan = () => {
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec($('svg-container').style.transform || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};
const drawnSize = () => {
  const svg = currentSvg();
  const laid = { w: parseFloat(svg.style.width) || 0, h: parseFloat(svg.style.height) || 0 };
  const m = /scale\(\s*([\d.]+)/.exec($('svg-container').style.transform || '');
  const scale = m ? Number(m[1]) : 1;
  return { width: laid.w * scale, height: laid.h * scale };
};
// A pan is coalesced onto the next frame, so give it one.
const settle = async () => { await sleep(30); };

const wheel = (opts) => {
  const e = new window.Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(e, { deltaX: 0, deltaY: 0, deltaMode: 0, clientX: 600, clientY: 400,
    shiftKey: false, ctrlKey: false, metaKey: false, ...opts });
  $('viewport').dispatchEvent(e);
  return e;
};
const key = (k, opts = {}) => {
  const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  $('viewport').dispatchEvent(e);
  return e;
};
const mouse = (type, target, x, y, init = {}) => {
  target.dispatchEvent(new window.MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }));
};

// ── A drawing far bigger than the window ─────────────────────────────────────
// test3_house is a sheet of paper; the point of this file is a drawing that
// does not fit, so the fixture's page is widened. Building it here rather than
// leaning on an untracked file keeps the check runnable in a fresh clone.
const zip = await JSZip.loadAsync(readFileSync('test-files/test3_house.vsdx'));
const pages = await zip.file('visio/pages/pages.xml').async('string');
const grown = pages
  .replace(/<Cell N='PageWidth' V='[^']*'/, "<Cell N='PageWidth' V='400'")
  .replace(/<Cell N='PageHeight' V='[^']*'/, "<Cell N='PageHeight' V='300'");
if (grown === pages) {
  console.error('could not resize the fixture page — the PageWidth cell moved');
  process.exit(1);
}
zip.file('visio/pages/pages.xml', grown);
const big = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));

console.log('── scrolling a drawing bigger than the window ──');
const ev = new window.Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(ev, 'dataTransfer', {
  value: { files: [new window.File([big], 'wide.vsdx')] }
});
$('drop-zone').dispatchEvent(ev);
await waitFor(() => currentSvg());
check('the drawing opened', !!currentSvg(), $('error-box')?.textContent || '');

// ── 1. There are scrollbars, and they say how much is off screen ─────────────
console.log('\n1. Scrollbars');
{
  // Opening fits the page, so all of it is on screen and there is nothing to
  // scroll to — which is exactly when a scrollbar should not be there.
  check('a drawing that fits shows no scrollbars',
    $('viewport-scroll-x').hidden && $('viewport-scroll-y').hidden,
    `x=${$('viewport-scroll-x').hidden} y=${$('viewport-scroll-y').hidden}`);

  // Zoom in until it does not fit.
  for (let i = 0; i < 12; i++) $('btn-zoom-in').click();
  await settle();
  const size = drawnSize();
  check('zooming in makes the drawing bigger than the window',
    size.width > VIEW.width && size.height > VIEW.height,
    `${size.width.toFixed(0)}x${size.height.toFixed(0)} in ${VIEW.width}x${VIEW.height}`);
  check('…and now there is a horizontal scrollbar', !$('viewport-scroll-x').hidden);
  check('…and a vertical one', !$('viewport-scroll-y').hidden);

  const thumb = parseFloat($('viewport-scroll-x-thumb').style.width);
  const track = VIEW.width - 12;
  const expected = Math.max(24, track * (track / size.width));
  check('the thumb is as long as the share of the drawing on screen',
    Math.abs(thumb - expected) < 1.5, `${thumb.toFixed(1)} vs ${expected.toFixed(1)}`);
  check('…and it is shorter than its track', thumb < track, `${thumb} vs ${track}`);
}

// ── 2. The wheel scrolls ─────────────────────────────────────────────────────
console.log('\n2. The wheel');
{
  const was = pan();
  const e = wheel({ deltaY: 120 });
  await settle();
  check('a wheel notch moves the drawing up', pan().y < was.y - 100,
    `${was.y.toFixed(0)} → ${pan().y.toFixed(0)}`);
  check('…and not sideways', Math.abs(pan().x - was.x) < 0.001, `${was.x} → ${pan().x}`);
  check('…and the page itself does not scroll', e.defaultPrevented);
}
{
  const was = pan();
  wheel({ deltaY: -120 });
  await settle();
  check('scrolling back down puts it back', Math.abs(pan().y - (was.y + 120)) < 0.001,
    `${was.y.toFixed(0)} → ${pan().y.toFixed(0)}`);
}
{
  const was = pan();
  wheel({ deltaY: 120, shiftKey: true });
  await settle();
  check('Shift+wheel scrolls sideways instead', pan().x < was.x - 100,
    `${was.x.toFixed(0)} → ${pan().x.toFixed(0)}`);
  check('…leaving the vertical alone', Math.abs(pan().y - was.y) < 0.001);
}
{
  const zoomWas = $('zoom-info').textContent;
  wheel({ deltaY: -240, ctrlKey: true });
  await settle();
  check('Ctrl+wheel still zooms', $('zoom-info').textContent !== zoomWas,
    `${zoomWas} → ${$('zoom-info').textContent}`);
}

// ── 3. The keyboard ──────────────────────────────────────────────────────────
console.log('\n3. Arrow keys');
{
  const was = pan();
  const e = key('ArrowRight');
  await settle();
  check('right arrow moves the view right', pan().x < was.x - 1,
    `${was.x.toFixed(0)} → ${pan().x.toFixed(0)}`);
  check('…and the key is consumed', e.defaultPrevented);
}
{
  const was = pan();
  key('ArrowDown', { shiftKey: true });
  await settle();
  check('Shift makes the step a bigger one', pan().y < was.y - 200,
    `${was.y.toFixed(0)} → ${pan().y.toFixed(0)}`);
}
{
  key('Home');
  await settle();
  const size = drawnSize();
  check('Home goes back to the top-left corner of the drawing',
    Math.abs(pan().x) < 0.001 && Math.abs(pan().y) < 0.001, `${pan().x},${pan().y}`);
  key('End');
  await settle();
  check('End goes to the bottom-right',
    Math.abs(pan().x - (VIEW.width - size.width)) < 0.001
    && Math.abs(pan().y - (VIEW.height - size.height)) < 0.001,
    `${pan().x.toFixed(0)},${pan().y.toFixed(0)}`);
}
{
  key('PageUp');
  await settle();
  check('PageUp moves by most of a screenful', pan().y > VIEW.height - drawnSize().height + 700,
    String(pan().y.toFixed(0)));
}

// ── 4. The drawing cannot be lost off the side ───────────────────────────────
// This is the symptom that made the missing scrollbars worse than an
// inconvenience: a drag kept going as far as the hand did, and once the drawing
// was outside the window nothing said which way it had gone.
console.log('\n4. Dragging cannot lose the drawing');
{
  const size = drawnSize();
  mouse('mousedown', $('viewport'), 600, 400);
  mouse('mousemove', window, 600 + 100000, 400 + 100000);
  mouse('mouseup', window, 600 + 100000, 400 + 100000);
  await settle();
  const at = pan();
  check('flinging the drawing right stops at its own edge',
    Math.abs(at.x) < 0.001, `${at.x.toFixed(0)} (0 is the edge)`);
  check('…and downwards likewise', Math.abs(at.y) < 0.001, at.y.toFixed(0));
  check('so some of it is still on screen',
    at.x < VIEW.width && at.x + size.width > 0, `${at.x} + ${size.width}`);

  mouse('mousedown', $('viewport'), 600, 400);
  mouse('mousemove', window, 600 - 100000, 400 - 100000);
  mouse('mouseup', window, 600 - 100000, 400 - 100000);
  await settle();
  const other = pan();
  check('and flinging it the other way stops at the far edge',
    Math.abs(other.x - (VIEW.width - size.width)) < 0.001,
    `${other.x.toFixed(0)} vs ${(VIEW.width - size.width).toFixed(0)}`);
  check('…with the drawing still overlapping the window',
    other.x + size.width > 0 && other.y + size.height > 0);
}
{
  // A drag that runs into the edge and comes back has to land where the hand
  // is, not where the clamp left it. Anchoring the drag to the press rather
  // than accumulating deltas is what buys that: the drawing must not creep.
  key('Home');
  await settle();
  const size = drawnSize();
  mouse('mousedown', $('viewport'), 600, 400);
  mouse('mousemove', window, 600 - 100000, 400);
  await settle();
  check('the drag pins against the far edge on the way out',
    Math.abs(pan().x - (VIEW.width - size.width)) < 0.001, pan().x.toFixed(0));
  mouse('mousemove', window, 600 - 40, 400);
  mouse('mouseup', window, 600 - 40, 400);
  await settle();
  check('…and coming back to 40px from the press lands 40px from the start',
    Math.abs(pan().x - -40) < 0.001, `${pan().x.toFixed(2)} (want -40)`);
}

// ── 5. A drawing smaller than the window stays inside it ─────────────────────
console.log('\n5. A drawing that fits');
{
  $('btn-zoom-fit').click();
  await settle();
  for (let i = 0; i < 6; i++) $('btn-zoom-out').click();
  await settle();
  const size = drawnSize();
  check('it is now smaller than the window',
    size.width < VIEW.width && size.height < VIEW.height,
    `${size.width.toFixed(0)}x${size.height.toFixed(0)}`);
  check('the scrollbars are gone again',
    $('viewport-scroll-x').hidden && $('viewport-scroll-y').hidden);

  mouse('mousedown', $('viewport'), 600, 400);
  mouse('mousemove', window, 600 + 100000, 400 + 100000);
  mouse('mouseup', window, 600 + 100000, 400 + 100000);
  await settle();
  const at = pan();
  check('and dragging cannot push it out of the window',
    at.x >= -0.001 && at.x <= VIEW.width - size.width + 0.001
    && at.y >= -0.001 && at.y <= VIEW.height - size.height + 0.001,
    `${at.x.toFixed(0)},${at.y.toFixed(0)} in 0..${(VIEW.width - size.width).toFixed(0)}`);
}

// ── 6. Dragging the thumb ────────────────────────────────────────────────────
console.log('\n6. Dragging a scrollbar thumb');
{
  for (let i = 0; i < 12; i++) $('btn-zoom-in').click();
  await settle();
  key('Home');
  await settle();
  check('the drawing is at its top-left', Math.abs(pan().x) < 0.001, String(pan().x));

  const thumb = $('viewport-scroll-x-thumb');
  const size = drawnSize();
  const track = VIEW.width - 12;
  const room = track - parseFloat(thumb.style.width);
  mouse('mousedown', thumb, 10, VIEW.height - 6);
  mouse('mousemove', window, 10 + room, VIEW.height - 6);
  mouse('mouseup', window, 10 + room, VIEW.height - 6);
  await settle();
  check('dragging the thumb the length of its track goes to the far edge',
    Math.abs(pan().x - (VIEW.width - size.width)) < 1,
    `${pan().x.toFixed(0)} vs ${(VIEW.width - size.width).toFixed(0)}`);
  check('…and the thumb ends up at the end of the track',
    Math.abs(parseFloat(thumb.style.left) - room) < 1,
    `${thumb.style.left} vs ${room.toFixed(0)}px`);
}
{
  // Clicking the empty part of the track jumps there.
  key('Home');
  await settle();
  const barY = $('viewport-scroll-y');
  const size = drawnSize();
  mouse('mousedown', barY, VIEW.width - 6, (VIEW.height - 12) / 2, { target: barY });
  await settle();
  const middle = (VIEW.height - size.height) / 2;
  check('clicking the middle of the track jumps to the middle of the drawing',
    Math.abs(pan().y - middle) < Math.abs(size.height) * 0.06,
    `${pan().y.toFixed(0)} vs about ${middle.toFixed(0)}`);
}

// ── 7. Dragging is one write per frame, not one per event ────────────────────
// A mouse or a trackpad delivers moves faster than the screen refreshes, and
// writing a transform on a drawing of this size per event is what makes
// dragging feel like it is wading. So the pan is accumulated and written on the
// next frame: what is checked is that a burst of moves has not touched the DOM
// yet, and that when the frame comes it lands on the last of them.
console.log('\n7. Dragging is coalesced onto a frame');
{
  key('Home');
  await settle();
  const before = $('svg-container').style.transform;
  mouse('mousedown', $('viewport'), 600, 400);
  for (let i = 1; i <= 40; i++) mouse('mousemove', window, 600 - i, 400 - i);
  check('forty moves in a row have not been written to the DOM yet',
    $('svg-container').style.transform === before, $('svg-container').style.transform);
  check('…and the drawing is on its own compositor layer while the hand is down',
    $('svg-container').style.willChange === 'transform', $('svg-container').style.willChange);
  await settle();
  check('…then one frame lands the last of them',
    Math.abs(pan().x - -40) < 0.001 && Math.abs(pan().y - -40) < 0.001,
    `${pan().x},${pan().y}`);
  mouse('mouseup', window, 560, 360);
}

// ── 8. The canvas takes the keyboard when it is clicked ──────────────────────
console.log('\n8. Focus');
{
  $('zoom-info').focus?.();
  mouse('mousedown', $('viewport'), 600, 400);
  mouse('mouseup', window, 600, 400);
  check('pressing on the canvas focuses it, so the arrow keys reach it',
    window.document.activeElement === $('viewport'),
    window.document.activeElement?.id || window.document.activeElement?.tagName);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
