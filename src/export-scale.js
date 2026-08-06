// Export sizing.
//
// The rendered SVG's user units are CSS pixels at 96 per inch (DPI in
// svg-renderer.js) and its root carries width/height="100%" — right for the
// on-screen viewer, useless in a file. A 345-inch engineering drawing lands on
// disk as a 33120-unit viewBox with no intrinsic size at all, which is what
// makes browsers, Inkscape and PDF viewers fall over: each one invents its own
// answer, and PDF in particular has a hard ceiling this blows straight past.
//
// Nothing in here touches geometry. "Rescaling" means giving the root an
// intrinsic width/height while leaving the viewBox at full precision, so the
// drawing stays exactly as sharp and as editable — only the size it *claims*
// to be changes. Saving at original size stays one dropdown entry away.

export const PX_PER_INCH = 96;  // svg-renderer.js DPI — the viewBox unit
export const PT_PER_INCH = 72;  // PDF user space unit

// PDF's implementation limit: a page may not exceed 14400 units (200 inches)
// per side. Acrobat clamps to it, and most other viewers simply draw garbage.
export const PDF_MAX_PT = 14400;
export const PDF_MAX_PX = (PDF_MAX_PT / PT_PER_INCH) * PX_PER_INCH; // 19200

// Chrome refuses to rasterise anything past 32767px in a single dimension, and
// gets sluggish long before that; this is a comfortable "just show me the
// drawing" size.
export const SCREEN_MAX_PX = 4096;

export const EXPORT_SIZE_MODES = [
  { id: 'original', label: 'Original size' },
  { id: 'viewer', label: 'Viewer-safe — longest side 19200px (200in)', maxPx: PDF_MAX_PX },
  { id: 'screen', label: 'Screen — longest side 4096px', maxPx: SCREEN_MAX_PX },
  { id: 'custom', label: 'Custom longest side…' },
];

export function pxToPt(px) {
  return (px * PT_PER_INCH) / PX_PER_INCH;
}

export function modeById(id) {
  return EXPORT_SIZE_MODES.find(m => m.id === id) || EXPORT_SIZE_MODES[0];
}

function round(n) {
  // Three decimals is far below anything a renderer can resolve, and keeps the
  // aspect ratio drift orders of magnitude under one device pixel.
  return Math.round(n * 1000) / 1000;
}

/**
 * Work out the intrinsic size to stamp on an exported drawing.
 *
 * @param {number} width   viewBox width, in renderer px
 * @param {number} height  viewBox height, in renderer px
 * @param {string} mode    one of EXPORT_SIZE_MODES' ids
 * @param {{customPx?: number}} options  longest side in px, for mode 'custom'
 * @returns {{scale, width, height, widthPt, heightPt, sourceWidth, sourceHeight,
 *            mode, downscaled, exceedsPdfLimit}}
 */
export function computeExportSize(width, height, mode = 'original', options = {}) {
  const w = Number(width);
  const h = Number(height);
  const valid = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const sourceWidth = valid ? w : 0;
  const sourceHeight = valid ? h : 0;

  let scale = 1;
  if (valid) {
    const longest = Math.max(sourceWidth, sourceHeight);
    const preset = modeById(mode);
    if (mode === 'custom') {
      const target = Number(options.customPx);
      // A custom size is an explicit instruction, so it may enlarge as well as
      // shrink; only nonsense is ignored.
      if (Number.isFinite(target) && target > 0) scale = target / longest;
    } else if (preset.maxPx) {
      // Presets are ceilings, never magnifiers — a small drawing exports at
      // its own size rather than being blown up to fill the budget.
      scale = Math.min(1, preset.maxPx / longest);
    }
  }

  // At original size, pass the viewBox's own numbers straight through: an
  // "unchanged" export should be bit-for-bit the drawing's real size, not the
  // drawing's real size nudged by a rounding step.
  const outWidth = scale === 1 ? sourceWidth : round(sourceWidth * scale);
  const outHeight = scale === 1 ? sourceHeight : round(sourceHeight * scale);
  return {
    mode,
    scale,
    width: outWidth,
    height: outHeight,
    widthPt: round(pxToPt(outWidth)),
    heightPt: round(pxToPt(outHeight)),
    sourceWidth,
    sourceHeight,
    downscaled: scale < 1,
    exceedsPdfLimit: Math.max(pxToPt(outWidth), pxToPt(outHeight)) > PDF_MAX_PT,
  };
}

/** True when the drawing at its original size is too big for a PDF page. */
export function needsRescaleForPdf(width, height) {
  return computeExportSize(width, height, 'original').exceedsPdfLimit;
}

/**
 * The mode to open the export dialog on: leave a sane drawing alone, but don't
 * hand someone a PDF the format cannot represent unless they ask for it.
 */
export function defaultSizeMode(width, height) {
  return needsRescaleForPdf(width, height) ? 'viewer' : 'original';
}

// Display only. The attributes themselves keep their full precision; a summary
// line reading "5008.696px" just makes the number harder to take in.
function fmtPx(n) {
  return Number.isFinite(n) ? String(Math.round(n)) : '?';
}
function fmtIn(n) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '?';
}

/** One-line human summary of what the export will produce. */
export function describeExportSize(size) {
  if (!size || !size.sourceWidth) return 'No drawing to export';
  const from = `${fmtPx(size.sourceWidth)} × ${fmtPx(size.sourceHeight)}px`;
  const inches = `${fmtIn(size.width / PX_PER_INCH)} × ${fmtIn(size.height / PX_PER_INCH)}in`;
  if (size.scale === 1) return `${from} (${inches}) — unchanged`;
  const to = `${fmtPx(size.width)} × ${fmtPx(size.height)}px`;
  return `${from} → ${to} (${inches}) at ${fmtIn(size.scale * 100)}%`;
}

/**
 * Stamp an intrinsic size onto an exported SVG root. The viewBox is left
 * untouched, so this loses no precision whatsoever.
 */
export function applyExportSize(svg, size) {
  if (!svg || !size || !size.width || !size.height) return svg;
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  // The viewer pins the root's max-width to the drawing's full width; left in
  // place it would fight the size we just set.
  svg.style.removeProperty('max-width');
  if (!svg.getAttribute('style')) svg.removeAttribute('style');
  return svg;
}

/** Read a rendered SVG's viewBox back as {width, height} in renderer px. */
export function svgViewBoxSize(svg) {
  const parts = (svg?.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    return { width: parts[2], height: parts[3] };
  }
  return { width: 0, height: 0 };
}
