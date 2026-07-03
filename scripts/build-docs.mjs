#!/usr/bin/env node
// Render docs/usage.md to a styled, self-contained dist/usage.html so the
// usage guide is reachable from the live GitHub Pages app (GitHub Pages served
// via Actions does not run Jekyll, so we render the markdown ourselves here).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'docs', 'usage.md');
const outDir = join(root, 'dist');
const out = join(outDir, 'usage.html');

const md = readFileSync(src, 'utf8');
const body = marked.parse(md, { gfm: true });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VSDX Viewer — Usage guide</title>
<style>
  :root { color-scheme: light dark; }
  body {
    max-width: 820px; margin: 0 auto; padding: 2rem 1.25rem 4rem;
    font: 16px/1.65 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #1a1a1a; background: #fff;
  }
  a { color: #0a58ca; }
  h1, h2, h3 { line-height: 1.25; }
  h1 { margin-top: 0; }
  h2 { margin-top: 2.2rem; border-bottom: 1px solid #e3e3e3; padding-bottom: .3rem; }
  code {
    font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f2f2f2; padding: .12em .35em; border-radius: 4px;
  }
  pre code { display: block; padding: .9rem 1rem; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: .5rem .7rem; text-align: left; }
  th { background: #f7f7f7; }
  .back { display: inline-block; margin-bottom: 1.5rem; font-size: .95rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6e6; background: #1b1b1d; }
    a { color: #6ea8fe; }
    code { background: #2a2a2e; }
    h2 { border-color: #333; }
    th { background: #26262a; }
    th, td { border-color: #3a3a3e; }
  }
</style>
</head>
<body>
<a class="back" href="index.html">&larr; Back to the app</a>
${body}
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(out, html);
console.log(`build-docs: wrote ${out} (${html.length} bytes)`);
