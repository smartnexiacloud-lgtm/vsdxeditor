// Shared helpers for master-shape inheritance and minimal field-resolution.
// This module is intentionally format-agnostic: both the .vsd (binary) and the
// .vsdx (XML) parsers populate a normalized shape object, then call
// `inheritFromMaster` and `resolveFields` to fill in text / style that is only
// defined on the shape's master and to expand field placeholders (Prop.X,
// User.X, TEXT(...)) into the actual runtime text.
//
// The helpers only depend on plain JS objects — no XML / binary concepts — so
// the parser-specific code can stay focused on extracting raw values.

// Character-style fields that we try to inherit from a master shape when the
// child shape does not specify them explicitly.
const CHAR_FIELDS = ['fontSize', 'fontColor', 'bold', 'italic'];

// Is `v` an "empty" value for inheritance purposes?
function isEmpty(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '');
}

// Merge `masterShape` into `shape` in-place: any field on `shape` that is
// null / undefined / empty is populated from the master. The caller is
// responsible for pre-merging sub-shape data; we only do shallow merging of
// the normalized text / style properties.
//
// Fields merged: text, fontSize, fontColor, bold, italic, and any value in
// `propMap` / `userMap` (for later field resolution) that the shape is missing.
export function inheritFromMaster(shape, masterShape) {
  if (!shape || !masterShape) return shape;

  // Text: only inherit when the shape has no text of its own.
  if (isEmpty(shape.text) && !isEmpty(masterShape.text)) {
    shape.text = masterShape.text;
    // When we inherit the raw text we also want the master's field list to
    // drive resolution, because the U+FFFC placeholders refer to the master's
    // FIELD_LIST in the .vsd format, or to <fld IX=...> indices that are
    // defined on the master in .vsdx.
    if (masterShape._fields && !shape._fields) {
      shape._fields = masterShape._fields;
    }
  }

  // Character style. Bold/italic use a boolean "false is also a default", so
  // we only overwrite when the shape field is strictly null/undefined.
  for (const f of CHAR_FIELDS) {
    if (shape[f] === null || shape[f] === undefined) {
      if (masterShape[f] !== null && masterShape[f] !== undefined) {
        shape[f] = masterShape[f];
      }
    }
  }

  // Property/user maps: merge any keys the shape is missing, so that a shape
  // that inherited its text from the master (and therefore references the
  // master's custom-property names) can still resolve them through its own
  // page-scoped map. We DO NOT overwrite an existing key — the shape's value
  // wins.
  if (masterShape.propMap) {
    shape.propMap = shape.propMap || {};
    for (const k in masterShape.propMap) {
      if (!(k in shape.propMap)) shape.propMap[k] = masterShape.propMap[k];
    }
  }
  if (masterShape.userMap) {
    shape.userMap = shape.userMap || {};
    for (const k in masterShape.userMap) {
      if (!(k in shape.userMap)) shape.userMap[k] = masterShape.userMap[k];
    }
  }

  return shape;
}

// Resolve one symbolic field reference (e.g. "Prop.NetworkName", "User.Ver",
// "PageName", "PageNumber") against the supplied context maps.
//
// `ctx` is { propMap, userMap, pageName, pageNumber, fields } where:
//   - propMap: { name -> value } — custom-property cells (Section N="Property")
//   - userMap: { name -> value } — user cells (Section N="User")
//   - pageName / pageNumber: supplied by the parser when the page is being
//     built; may be undefined.
//   - fields: array of { type, value, name, format } parsed from <fld> or the
//     .vsd FIELD_LIST, indexed by IX so that `<fld IX='N'/>` finds its entry.
//
// Returns the resolved string or null when the reference cannot be resolved.
function resolveReference(ref, ctx) {
  if (!ref) return null;
  const r = String(ref).trim();

  // Prop.X / Prop.Row_1 / Prop."My Prop"
  let m = /^Prop(?:erty)?\.(.+)$/i.exec(r);
  if (m) {
    let name = m[1].replace(/^"(.*)"$/, '$1');
    if (ctx.propMap && name in ctx.propMap) return ctx.propMap[name];
    // Strip leading "Row_" numeric suffix matching
    if (ctx.propMap) {
      // Case-insensitive fallback
      const lower = name.toLowerCase();
      for (const k in ctx.propMap) {
        if (k.toLowerCase() === lower) return ctx.propMap[k];
      }
    }
    return null;
  }

  // User.X
  m = /^User\.(.+)$/i.exec(r);
  if (m) {
    let name = m[1].replace(/^"(.*)"$/, '$1');
    if (ctx.userMap && name in ctx.userMap) return ctx.userMap[name];
    if (ctx.userMap) {
      const lower = name.toLowerCase();
      for (const k in ctx.userMap) {
        if (k.toLowerCase() === lower) return ctx.userMap[k];
      }
    }
    return null;
  }

  // Page-level references
  if (/^PageName$/i.test(r) || /^ThePage!?PageName$/i.test(r)) return ctx.pageName ?? null;
  if (/^PageNumber$/i.test(r) || /^ThePage!?PageNumber$/i.test(r)) {
    return ctx.pageNumber != null ? String(ctx.pageNumber) : null;
  }

  // TEXT("literal") — just unquote
  m = /^TEXT\(\s*"(.*)"\s*\)$/i.exec(r);
  if (m) return m[1];
  m = /^TEXT\(\s*'(.*)'\s*\)$/i.exec(r);
  if (m) return m[1];

  return null;
}

// Replace U+FFFC placeholders in a raw text string with the resolved values of
// the corresponding fields. Each placeholder is consumed in-order; any field
// we cannot resolve falls back to its `value` (if the parser pre-resolved it),
// then to its `format` (printf-ish display string), then to an empty string
// so we do not render the replacement-character glyph.
function spliceObjectReplacements(text, ctx) {
  if (!text) return text;
  const fields = (ctx && ctx.fields) || [];
  let idx = 0;
  const out = [];
  for (const ch of text) {
    if (ch === '\uFFFC') {
      const f = fields[idx++];
      let replacement = null;
      if (f) {
        if (f.value !== undefined && f.value !== null && f.value !== '') {
          replacement = String(f.value);
        } else if (f.ref) {
          replacement = resolveReference(f.ref, ctx);
        }
        if ((replacement === null || replacement === '') && f.format) {
          replacement = f.format;
        }
      }
      if (replacement) out.push(replacement);
      // else: drop the placeholder silently.
    } else {
      out.push(ch);
    }
  }
  return out.join('');
}

// Replace <fld IX='N'/> XML-style placeholders in a raw text string. Visio's
// .vsdx text may contain inline <fld> elements that the parser flattens to
// the literal tag text; we also accept the tag-stripped form where the parser
// has already substituted the <fld> with a sentinel "\uFFFC" character.
function spliceFldTags(text, ctx) {
  if (!text) return text;
  // Pattern matches both <fld IX='3'/> and <fld IX="3"/>.
  return text.replace(/<fld\s+[^>]*IX\s*=\s*['"](\d+)['"][^>]*\/?>(?:\s*<\/fld>)?/gi,
    (match, ix) => {
      const f = (ctx.fields || [])[parseInt(ix, 10)];
      if (!f) return '';
      if (f.value !== undefined && f.value !== null && f.value !== '') return String(f.value);
      if (f.ref) {
        const resolved = resolveReference(f.ref, ctx);
        if (resolved !== null && resolved !== undefined) return String(resolved);
      }
      if (f.format) return f.format;
      return '';
    });
}

// Main entry: take a raw text string and a context, return the rendered string
// with both U+FFFC placeholders and <fld> tags replaced.
export function resolveFields(shape, ctx) {
  const raw = shape && shape.text;
  if (!raw) return raw ?? '';
  // Gather default ctx from the shape itself when the caller did not supply
  // an overriding value (propMap/userMap often live on the shape).
  const merged = {
    propMap: (ctx && ctx.propMap) || shape.propMap || null,
    userMap: (ctx && ctx.userMap) || shape.userMap || null,
    pageName: ctx ? ctx.pageName : undefined,
    pageNumber: ctx ? ctx.pageNumber : undefined,
    fields: (ctx && ctx.fields) || shape._fields || [],
  };
  let out = raw;
  if (out.indexOf('\uFFFC') !== -1) {
    out = spliceObjectReplacements(out, merged);
  }
  if (out.indexOf('<fld') !== -1) {
    out = spliceFldTags(out, merged);
  }
  return out;
}

// Back-door helper exposed for tests.
export const _internal = { resolveReference, spliceObjectReplacements, spliceFldTags };
