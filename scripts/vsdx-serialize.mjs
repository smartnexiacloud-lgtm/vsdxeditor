// Prototype: deterministic, git-friendly (de)serialization of .vsdx (OPC/XML-in-ZIP).
//
//   node scripts/vsdx-serialize.mjs unpack   <file.vsdx> <outDir>
//   node scripts/vsdx-serialize.mjs pack     <dir> <out.vsdx>
//   node scripts/vsdx-serialize.mjs verify   <file.vsdx>   # prove byte-stable round-trip
//   node scripts/vsdx-serialize.mjs textconv <file.vsdx>   # git diff textconv: dump to stdout
//
// Goal of step 1: prove that unpack -> pack -> unpack is idempotent (stable text)
// and that re-packing the same tree yields byte-identical archives. That stability
// is the precondition for git diff/merge to be meaningful on Visio files.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

// OPC parts we treat as XML text (canonicalized). Everything else is kept raw.
const XML_EXT = new Set(['.xml', '.rels']);
const EPOCH = new Date('1980-01-01T00:00:00Z'); // matches Visio's zeroed zip timestamps

const isXmlPath = (p) => XML_EXT.has(path.extname(p).toLowerCase());

// ---- XML canonicalization -------------------------------------------------
// Rules:
//  * fixed XML declaration
//  * attributes sorted by name, double-quoted, escaped
//  * elements whose children are ALL elements (whitespace between ignored) are
//    pretty-printed one-per-line -> good line diffs
//  * elements that contain any real text / CDATA are emitted INLINE, byte-exact,
//    so xml:space='preserve' content is never mangled
//  * empty elements self-close
// The transform is idempotent: canonicalize(canonicalize(x)) === canonicalize(x).

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) =>
  escText(s).replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');

const isWhitespaceText = (node) => node.nodeType === 3 && /^\s*$/.test(node.data);
const ELEMENT_NODE = 1, TEXT_NODE = 3, CDATA_NODE = 4;

function attrsString(el) {
  const attrs = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    attrs.push([a.name, a.value]);
  }
  attrs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return attrs.map(([n, v]) => ` ${n}="${escAttr(v)}"`).join('');
}

function classifyChildren(el) {
  let hasElement = false, hasRealText = false, count = 0;
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes.item(i);
    count++;
    if (n.nodeType === ELEMENT_NODE) hasElement = true;
    else if (n.nodeType === CDATA_NODE) hasRealText = true;
    else if (n.nodeType === TEXT_NODE && !isWhitespaceText(n)) hasRealText = true;
  }
  return { hasElement, hasRealText, count };
}

// Byte-exact inline serialization (used inside text-bearing elements).
function serializeInline(node) {
  if (node.nodeType === TEXT_NODE) return escText(node.data);
  if (node.nodeType === CDATA_NODE) return `<![CDATA[${node.data}]]>`;
  if (node.nodeType !== ELEMENT_NODE) return '';
  const el = node;
  const open = `<${el.tagName}${attrsString(el)}`;
  if (el.childNodes.length === 0) return `${open}/>`;
  let inner = '';
  for (let i = 0; i < el.childNodes.length; i++) inner += serializeInline(el.childNodes.item(i));
  return `${open}>${inner}</${el.tagName}>`;
}

function serializeBlock(el, depth, out) {
  const pad = '  '.repeat(depth);
  const open = `${el.tagName}${attrsString(el)}`;
  const { hasElement, hasRealText, count } = classifyChildren(el);

  if (count === 0) {
    out.push(`${pad}<${open}/>\n`);
    return;
  }
  if (hasRealText || !hasElement) {
    // text / mixed content -> keep inline & byte-exact
    let inner = '';
    for (let i = 0; i < el.childNodes.length; i++) inner += serializeInline(el.childNodes.item(i));
    out.push(`${pad}<${open}>${inner}</${el.tagName}>\n`);
    return;
  }
  // element-only container -> pretty print, dropping insignificant whitespace
  out.push(`${pad}<${open}>\n`);
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes.item(i);
    if (n.nodeType === ELEMENT_NODE) serializeBlock(n, depth + 1, out);
  }
  out.push(`${pad}</${el.tagName}>\n`);
}

function canonicalizeXml(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  const out = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
  serializeBlock(doc.documentElement, 0, out);
  return out.join('');
}

// ---- tree walking ---------------------------------------------------------
function walkFiles(dir, base = dir) {
  const results = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) results.push(...walkFiles(full, base));
    else results.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return results;
}

// ---- commands -------------------------------------------------------------
async function readZipParts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = [];
  for (const relPath of Object.keys(zip.files)) {
    const entry = zip.files[relPath];
    if (entry.dir) continue;
    parts.push(relPath);
  }
  parts.sort();
  const result = [];
  for (const p of parts) {
    if (isXmlPath(p)) {
      const raw = await zip.files[p].async('string');
      result.push({ path: p, xml: true, content: canonicalizeXml(raw) });
    } else {
      result.push({ path: p, xml: false, content: await zip.files[p].async('nodebuffer') });
    }
  }
  return result;
}

async function unpack(file, outDir) {
  const parts = await readZipParts(fs.readFileSync(file));
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const part of parts) {
    const dest = path.join(outDir, part.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, part.content);
  }
  console.log(`unpacked ${parts.length} parts -> ${outDir}`);
}

async function packTree(dir) {
  const zip = new JSZip();
  const files = walkFiles(dir).sort(); // deterministic order
  for (const rel of files) {
    const data = fs.readFileSync(path.join(dir, rel));
    zip.file(rel, data, { date: EPOCH });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    // strip the "made by unix + perms" bits that can vary; keep it stable
    platform: 'DOS',
  });
}

async function pack(dir, outFile) {
  const buf = await packTree(dir);
  fs.writeFileSync(outFile, buf);
  console.log(`packed ${outFile} (${buf.length} bytes)`);
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function verify(file) {
  const orig = fs.readFileSync(file);
  const p1 = await readZipParts(orig);         // unpack #1 (canonical tree A)
  const buf1 = await packPartsToZip(p1);        // pack A
  const p2 = await readZipParts(buf1);          // unpack #2 (tree B)
  const buf2 = await packPartsToZip(p2);        // pack B

  // 1) canonical text must be identical across a full round trip
  const textA = p1.filter((x) => x.xml).map((x) => x.path + '\n' + x.content).join('\n');
  const textB = p2.filter((x) => x.xml).map((x) => x.path + '\n' + x.content).join('\n');
  const textStable = textA === textB;

  // 2) repacking the same logical content must yield identical bytes
  const bytesStable = Buffer.compare(buf1, buf2) === 0;

  const origParts = await countParts(orig);
  console.log(`file:            ${path.basename(file)}`);
  console.log(`parts:           ${origParts} (${p1.filter((x) => x.xml).length} xml)`);
  console.log(`original size:   ${orig.length}   sha:${sha(orig)}`);
  console.log(`canonical pack:  ${buf1.length}   sha:${sha(buf1)}`);
  console.log(`repack:          ${buf2.length}   sha:${sha(buf2)}`);
  console.log(`XML text stable across round-trip:  ${textStable ? 'YES ✓' : 'NO ✗'}`);
  console.log(`archive bytes stable across resave: ${bytesStable ? 'YES ✓' : 'NO ✗'}`);
  if (!textStable) {
    for (let i = 0; i < p1.length; i++) {
      if (p1[i].xml && p1[i].content !== p2[i].content)
        console.log(`  DIFF in ${p1[i].path}`);
    }
  }
  return textStable && bytesStable;
}

async function packPartsToZip(parts) {
  const zip = new JSZip();
  for (const part of [...parts].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const data = part.xml ? Buffer.from(part.content, 'utf8') : part.content;
    zip.file(part.path, data, { date: EPOCH });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
  });
}

// Dump a whole .vsdx as one readable text stream (for `git diff` textconv).
// Each part gets a header line; XML is canonicalized, binaries are summarized.
async function textconv(file) {
  const parts = await readZipParts(fs.readFileSync(file));
  const out = [];
  for (const part of parts) {
    out.push(`\n==== ${part.path} ====`);
    if (part.xml) out.push(part.content.replace(/\n$/, ''));
    else out.push(`[binary ${part.content.length} bytes, sha:${sha(part.content)}]`);
  }
  process.stdout.write(out.join('\n') + '\n');
}

async function countParts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return Object.values(zip.files).filter((f) => !f.dir).length;
}

// ---- main -----------------------------------------------------------------
// Don't crash when a reader (head, git's pager) closes the pipe early.
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const [cmd, a, b] = process.argv.slice(2);
const run = {
  unpack: () => unpack(a, b),
  pack: () => pack(a, b),
  verify: () => verify(a).then((ok) => process.exit(ok ? 0 : 1)),
  textconv: () => textconv(a),
}[cmd];

if (!run) {
  console.error('usage: vsdx-serialize.mjs <unpack|pack|verify> ...');
  process.exit(2);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
