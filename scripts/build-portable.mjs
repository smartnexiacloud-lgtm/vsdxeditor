#!/usr/bin/env node
// Build portable, offline, self-contained copies of the app and zip them per
// platform. Each zip contains a single `vsdxeditor.html` (the whole app inlined
// into one file — no network, no install), a launcher that opens it in the
// default browser, and a README.
//
//   npm run package:portable   ->  dist-portable/vsdxeditor-portable-{win,linux}-<version>.zip
//
// The single-file HTML is produced by inlining dist/main.js into dist/app.html,
// so run `npm run build && npm run postbuild` first (the npm script chains it).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-portable');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const appHtmlPath = join(dist, 'app.html');
const mainJsPath = join(dist, 'main.js');
if (!existsSync(appHtmlPath) || !existsSync(mainJsPath)) {
  console.error('build-portable: dist/app.html or dist/main.js missing — run `npm run build && npm run postbuild` first.');
  process.exit(1);
}

// Inline the bundled JS into the HTML to make a single self-contained file.
const appHtml = readFileSync(appHtmlPath, 'utf8');
const mainJs = readFileSync(mainJsPath, 'utf8');
// Neutralise any literal `</script` so it can't terminate the inline <script>.
const safeJs = mainJs.replace(/<\/script/gi, '<\\/script');
const scriptTag = /<script\s+src=["']main\.js["']>\s*<\/script>/i;
if (!scriptTag.test(appHtml)) {
  console.error('build-portable: could not find <script src="main.js"> in app.html.');
  process.exit(1);
}
// Use a function replacement: its return value is inserted verbatim, so `$&`,
// `$'` etc. that occur naturally in the minified bundle are NOT treated as
// special replacement patterns (which would corrupt the code).
const singleFile = appHtml.replace(scriptTag, () => `<script>\n${safeJs}\n</script>`);

const README = `VSDX Viewer ${version} — portable / offline build
==================================================

This is the full VSDX Viewer app inlined into a single self-contained file:

    vsdxeditor.html

Open it in any modern web browser (Chrome, Edge, Firefox). Everything runs
locally — no internet connection is used and no files ever leave your machine.

How to open it
--------------
  * Windows: double-click "Open VSDX Editor.bat"  (or just open vsdxeditor.html)
  * Linux:   run "./open-vsdx-editor.sh"           (or just open vsdxeditor.html)

Then drag a supported Visio drawing, template, or stencil onto the window, or click Open.

Live version, docs and source:
  https://smartnexiacloud-lgtm.github.io/vsdxeditor/
  https://github.com/smartnexiacloud-lgtm/vsdxeditor

Licensed under GPL-3.0-or-later.
`;

const BAT = `@echo off
rem Open the portable VSDX Viewer in your default browser.
start "" "%~dp0vsdxeditor.html"
`;

const SH = `#!/bin/sh
# Open the portable VSDX Viewer in your default browser.
DIR="$(cd "$(dirname "$0")" && pwd)"
xdg-open "$DIR/vsdxeditor.html" >/dev/null 2>&1 || \
  echo "Open this file in your browser: $DIR/vsdxeditor.html"
`;

async function makeZip({ platform, launcherName, launcherBody, launcherExec }) {
  const zip = new JSZip();
  zip.file('vsdxeditor.html', singleFile);
  zip.file('README.txt', README);
  zip.file(launcherName, launcherBody, launcherExec ? { unixPermissions: 0o755 } : undefined);
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX', // preserve unix permission bits for the .sh launcher
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  const name = `vsdxeditor-portable-${platform}-${version}.zip`;
  writeFileSync(join(outDir, name), buf);
  const kb = (buf.length / 1024).toFixed(0);
  console.log(`build-portable: wrote dist-portable/${name} (${kb} KB)`);
}

mkdirSync(outDir, { recursive: true });
await makeZip({ platform: 'win', launcherName: 'Open VSDX Editor.bat', launcherBody: BAT });
await makeZip({ platform: 'linux', launcherName: 'open-vsdx-editor.sh', launcherBody: SH, launcherExec: true });

console.log(`build-portable: done (v${version}).`);
