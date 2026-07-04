// Embed the source .vsdx/.vsd bytes inside an exported SVG so the SVG can be
// opened again and round-trip back to the original drawing (same idea as
// draw.io's "editable SVG"). The document is stored base64-encoded in a
// <metadata> element right after the opening <svg> tag:
//
//   <metadata id="vsdxeditor-source"><vsdxeditor:document
//     xmlns:vsdxeditor="urn:vsdxeditor:embedded-document:1"
//     name="drawing.vsdx" encoding="base64">UEsDB...</vsdxeditor:document></metadata>
//
// Everything is string-based (no DOM) so it works both in the browser and in
// Node test scripts.

export const EMBED_ID = 'vsdxeditor-source';
export const EMBED_NS = 'urn:vsdxeditor:embedded-document:1';

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeAttr(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const METADATA_RE = new RegExp(
  `<metadata[^>]*\\bid=["']${EMBED_ID}["'][^>]*>([\\s\\S]*?)</metadata>`
);
const DOCUMENT_RE =
  /<vsdxeditor:document\b([^>]*)>([A-Za-z0-9+/=\s]*)<\/vsdxeditor:document>/;

/**
 * Return a copy of `svgString` with `buffer` (ArrayBuffer or Uint8Array)
 * embedded as base64 metadata. Any previously embedded document is replaced.
 */
export function embedVsdxInSvg(svgString, buffer, name) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const metadata =
    `<metadata id="${EMBED_ID}">` +
    `<vsdxeditor:document xmlns:vsdxeditor="${EMBED_NS}" ` +
    `name="${escapeAttr(name || 'diagram.vsdx')}" encoding="base64">` +
    bytesToBase64(bytes) +
    `</vsdxeditor:document></metadata>`;

  const stripped = svgString.replace(METADATA_RE, '');
  const svgOpen = stripped.search(/<svg[\s>]/);
  if (svgOpen === -1) throw new Error('Not an SVG document: no <svg> element found');
  const tagEnd = stripped.indexOf('>', svgOpen);
  if (tagEnd === -1 || stripped[tagEnd - 1] === '/') {
    throw new Error('Cannot embed into a self-closing <svg> element');
  }
  return stripped.slice(0, tagEnd + 1) + metadata + stripped.slice(tagEnd + 1);
}

/**
 * Extract an embedded document from SVG text. Returns
 * `{ buffer: Uint8Array, name: string }` or `null` when the SVG carries no
 * embedded document.
 */
export function extractVsdxFromSvg(svgText) {
  const meta = METADATA_RE.exec(svgText);
  if (!meta) return null;
  const doc = DOCUMENT_RE.exec(meta[1]);
  if (!doc) return null;
  const nameMatch = /\bname="([^"]*)"/.exec(doc[1]);
  return {
    buffer: base64ToBytes(doc[2].replace(/\s+/g, '')),
    name: nameMatch ? unescapeAttr(nameMatch[1]) : 'diagram.vsdx',
  };
}
