#!/usr/bin/env node
// Build the static GitHub Pages site into dist/:
//   - index.html      landing / front page (hero + features + links)
//   - usage.html      the how-to guide      (from docs/usage.md)
//   - changelog.html  the changelog         (from CHANGELOG.md)
//   - download.html   desktop downloads     (from docs/download.md)
//   - vsdx-with-git.html / visio-roundtrip.html (from docs/*.md)
// The app itself is copied to dist/app.html by the `postbuild` npm script.
//
// GitHub Pages (served via Actions) does not run Jekyll, so we render the
// markdown ourselves here and wrap every page in a shared, self-contained
// shell (nav bar + styling) so the docs are reachable from the live site.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });

const GITHUB = 'https://github.com/smartnexiacloud-lgtm/vsdxeditor';

// Nav shown on every page. `key` marks the active item.
const NAV = [
  { key: 'home', href: 'index.html', label: 'Home' },
  { key: 'app', href: 'app.html', label: 'Open app' },
  { key: 'usage', href: 'usage.html', label: 'How-to' },
  { key: 'changelog', href: 'changelog.html', label: 'Changelog' },
  { key: 'download', href: 'download.html', label: 'Download' },
  { key: 'git', href: 'vsdx-with-git.html', label: 'Git' },
  { key: 'github', href: GITHUB, label: 'GitHub ↗', external: true },
];

const SHARED_STYLE = `
  :root { color-scheme: light dark; --accent: #0a58ca; --accent-2: #6741d9; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #1a1a1a; background: #fff;
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color: var(--accent); }
  header.nav {
    position: sticky; top: 0; z-index: 10;
    display: flex; flex-wrap: wrap; align-items: center; gap: .25rem 1rem;
    padding: .7rem 1.25rem; background: rgba(255,255,255,.9);
    backdrop-filter: blur(8px); border-bottom: 1px solid #e3e3e3;
  }
  header.nav .brand { font-weight: 700; margin-right: auto; text-decoration: none; color: inherit; }
  header.nav a { text-decoration: none; font-size: .95rem; padding: .2rem 0; }
  header.nav a.active { color: inherit; font-weight: 600; border-bottom: 2px solid var(--accent); }
  main { max-width: 860px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1, h2, h3 { line-height: 1.25; }
  h2 { margin-top: 2.2rem; border-bottom: 1px solid #e3e3e3; padding-bottom: .3rem; }
  code {
    font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f2f2f2; padding: .12em .35em; border-radius: 4px;
  }
  pre code { display: block; padding: .9rem 1rem; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: .5rem .7rem; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; }
  blockquote { margin: 1rem 0; padding: .2rem 1rem; border-left: 4px solid #d9d9e3; color: #555; }
  footer.foot { max-width: 860px; margin: 0 auto; padding: 2rem 1.25rem 3rem; color: #888; font-size: .9rem; border-top: 1px solid #eee; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6e6; background: #1b1b1d; }
    a { color: #6ea8fe; --accent: #6ea8fe; }
    header.nav { background: rgba(27,27,29,.9); border-color: #333; }
    code { background: #2a2a2e; }
    h2, th, td { border-color: #3a3a3e; }
    th { background: #26262a; }
    blockquote { border-color: #3a3a44; color: #aaa; }
    footer.foot { border-color: #2a2a2e; }
  }
`;

function nav(active) {
  const links = NAV.map((n) => {
    const cls = n.key === active ? ' class="active"' : '';
    const ext = n.external ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${n.href}"${cls}${ext}>${n.label}</a>`;
  }).join('\n    ');
  return `<header class="nav">
    <a class="brand" href="index.html">VSDX Viewer</a>
    ${links}
  </header>`;
}

// Rewrite in-repo markdown links (foo.md, docs/foo.md, CHANGELOG.md) so they
// point at the rendered .html pages that live flat in dist/.
function rewriteLinks(html) {
  return html.replace(/href="(?:\.\/)?(?:docs\/)?([\w.-]+)\.md(#[\w-]+)?"/g, (_, name, hash) => {
    const base = name.toUpperCase() === 'CHANGELOG' ? 'changelog' : name;
    return `href="${base}.html${hash || ''}"`;
  });
}

function page({ title, active, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${SHARED_STYLE}</style>
</head>
<body>
${nav(active)}
<main>
${body}
</main>
<footer class="foot">
  VSDX Viewer — browser-based Visio <code>.vsdx</code>/<code>.vsd</code> viewer, editor &amp; differ.
  <a href="${GITHUB}" target="_blank" rel="noopener">Source on GitHub</a> ·
  <a href="${GITHUB}/blob/master/LICENSE" target="_blank" rel="noopener">GPL-3.0-or-later</a>
</footer>
</body>
</html>
`;
}

function renderMarkdownPage({ src, out, title, active }) {
  const md = readFileSync(join(root, src), 'utf8');
  const body = rewriteLinks(marked.parse(md, { gfm: true }));
  writeFileSync(join(outDir, out), page({ title, active, body }));
  return out;
}

// ---- Landing / front page --------------------------------------------------

const FEATURES = [
  ['🗂️', 'Open & render', 'View <code>.vsdx</code> and legacy <code>.vsd</code> files, each page drawn to crisp SVG with multi-page tabs, zoom and pan.'],
  ['🧬', 'Layers & views', 'Toggle layers, bulk-edit them in the Layer Visibility Matrix, and save named layer presets that travel inside the file.'],
  ['✏️', 'Edit', 'Inspect the shape tree and inherited style, edit a shape’s raw XML, move shapes between layers, and prune the drawing.'],
  ['🔍', 'Visual diff', 'Overlay + side-by-side comparison of two files, highlighting added, removed, moved and modified shapes and layer changes.'],
  ['💾', 'Export', 'Save a <code>.vsdx</code> with your edits, or export an SVG that embeds the source drawing for lossless round-trips back into the app.'],
  ['🔀', 'Git toolchain', 'Readable <code>git diff</code>, real 3-way <code>git merge</code>, and <code>git vsdxdiff</code> for a graphical diff of two revisions.'],
];

const HERO_STYLE = `
  .hero { text-align: center; padding: 3rem 0 1rem; }
  .hero h1 { font-size: clamp(2rem, 5vw, 3rem); margin: 0 0 .5rem; }
  .hero p.tag { font-size: 1.2rem; color: #555; max-width: 40ch; margin: 0 auto 1.5rem; }
  .cta { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: center; margin: 1.5rem 0; }
  .cta a { text-decoration: none; padding: .7rem 1.4rem; border-radius: 8px; font-weight: 600; }
  .cta a.primary { background: var(--accent); color: #fff; }
  .cta a.ghost { border: 1px solid #cbccd1; color: inherit; }
  .privacy { font-size: .9rem; color: #888; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin: 2rem 0; }
  .card { border: 1px solid #e6e6ea; border-radius: 12px; padding: 1.1rem 1.2rem; }
  .card .ico { font-size: 1.6rem; }
  .card h3 { margin: .4rem 0 .3rem; font-size: 1.05rem; }
  .card p { margin: 0; font-size: .95rem; color: #555; }
  @media (prefers-color-scheme: dark) {
    .hero p.tag, .card p { color: #aaa; }
    .cta a.ghost { border-color: #3a3a44; }
    .card { border-color: #2f2f36; }
  }
`;

function landing() {
  const cards = FEATURES.map(
    ([ico, h, p]) => `<div class="card"><div class="ico">${ico}</div><h3>${h}</h3><p>${p}</p></div>`
  ).join('\n      ');

  const body = `<section class="hero">
  <h1>VSDX&nbsp;Viewer</h1>
  <p class="tag">A browser-based viewer, editor &amp; visual differ for Microsoft Visio drawings — with a git diff/merge toolchain.</p>
  <div class="cta">
    <a class="primary" href="app.html">▶ Open the app</a>
    <a class="ghost" href="download.html">⬇ Download (offline)</a>
    <a class="ghost" href="usage.html">📖 How-to</a>
  </div>
  <p class="privacy">Everything runs client-side — your files never leave your machine.</p>
</section>

<div class="grid">
      ${cards}
</div>

<h2>Get started</h2>
<ol>
  <li><a href="app.html">Open the app</a> and drag a <code>.vsd</code>/<code>.vsdx</code> file onto it (or click <strong>Open</strong>).</li>
  <li>Explore with the page tabs, zoom, and <strong>Layers</strong> controls; right-click a shape to edit it.</li>
  <li>Click <strong>Compare…</strong> to visually diff two files, then <strong>Export SVG</strong> or <strong>Save VSDX</strong>.</li>
</ol>
<p>Prefer to work offline? <a href="download.html">Download a portable build</a> for Windows or Linux — a single self-contained HTML file.
Want to version-control <code>.vsdx</code> files in git? See the <a href="vsdx-with-git.html">git guide</a>.</p>`;

  const html = page({ title: 'VSDX Viewer — Visio .vsdx/.vsd viewer, editor & differ', active: 'home', body })
    // inject the landing-only styles just before </style> of the shared block
    .replace('</style>', `${HERO_STYLE}</style>`);
  writeFileSync(join(outDir, 'index.html'), html);
  return 'index.html';
}

// ---- Build ----------------------------------------------------------------

const written = [];
written.push(landing());
written.push(renderMarkdownPage({ src: 'docs/usage.md', out: 'usage.html', title: 'VSDX Viewer — How-to', active: 'usage' }));
written.push(renderMarkdownPage({ src: 'CHANGELOG.md', out: 'changelog.html', title: 'VSDX Viewer — Changelog', active: 'changelog' }));
written.push(renderMarkdownPage({ src: 'docs/download.md', out: 'download.html', title: 'VSDX Viewer — Download', active: 'download' }));
written.push(renderMarkdownPage({ src: 'docs/vsdx-with-git.md', out: 'vsdx-with-git.html', title: 'VSDX Viewer — Using .vsdx with git', active: 'git' }));
written.push(renderMarkdownPage({ src: 'docs/visio-roundtrip.md', out: 'visio-roundtrip.html', title: 'VSDX Viewer — Visio round-trip', active: null }));

console.log(`build-docs: wrote ${written.map((w) => `dist/${w}`).join(', ')}`);
