#!/usr/bin/env node
// `git difftool` integration: open two .vsdx revisions in the browser visual
// diff (overlay + side-by-side). Git extracts both sides to temp files and
// passes them as $LOCAL (base) and $REMOTE (compare); this script serves the
// built app plus those two files over a tiny localhost server and opens the
// browser at the Compare view, preloaded with both.
//
//   Usage (standalone):  node scripts/git-difftool-serve.mjs BASE.vsdx HEAD.vsdx [NAME]
//   Wired via:           npm run vsdx:install-difftool  (registers a git difftool)
//                        git vsdxdiff <file.vsdx>       (the alias it installs)
//
// Serves until you press Ctrl+C (git waits for that before cleaning up temps).
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, extname } from 'node:path';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const [, , localPath, remotePath, mergedName] = process.argv;
if (!localPath || !remotePath) {
  console.error('usage: git-difftool-serve.mjs <base.vsdx> <compare.vsdx> [name]');
  process.exit(2);
}

const displayName = mergedName ? basename(mergedName) : basename(remotePath);

// Ensure the app is built (dist/ is git-ignored and may be absent on a clone).
if (!existsSync(join(root, 'dist', 'main.js')) || !existsSync(join(root, 'dist', 'index.html'))) {
  console.error('vsdx difftool: building the app (dist/ missing)…');
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  execFileSync('npm', ['run', 'postbuild'], { cwd: root, stdio: 'inherit' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.vsdx': 'application/octet-stream',
};

// Explicit route table — no path traversal, only these paths are reachable.
const routes = {
  '/_base.vsdx': localPath,
  '/_head.vsdx': remotePath,
  '/index.html': join(root, 'dist', 'index.html'),
  '/main.js': join(root, 'dist', 'main.js'),
  '/usage.html': join(root, 'dist', 'usage.html'),
};

const server = createServer(async (req, res) => {
  let path = req.url.split('?')[0];
  if (path === '/') path = '/index.html';
  const file = routes[path];
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    await access(file);
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Non-fatal: the URL is printed below for manual opening.
  }
}

server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => {
  const { port } = server.address();
  const q = new URLSearchParams({
    diff: '1',
    base: '_base.vsdx',
    head: '_head.vsdx',
    baseName: `${displayName} (base)`,
    headName: `${displayName} (compare)`,
  });
  const url = `http://127.0.0.1:${port}/?${q}`;
  console.error(`\nvsdx visual diff: ${url}`);
  console.error('Opening in your browser… press Ctrl+C here when you are done.\n');
  openBrowser(url);
});

function shutdown() {
  server.close(() => process.exit(0));
  // Fallback if sockets keep the server open.
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
