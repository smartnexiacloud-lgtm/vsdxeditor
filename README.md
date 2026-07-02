# VSDX Viewer

A browser-based viewer and editor for Visio `.vsdx` (and `.vsd`) drawings:
parse a file, render its pages to SVG, edit layers and per-shape XML, and
visually **compare** two files (overlay + side-by-side diff).

## Develop

```bash
npm install
npm run dev     # esbuild dev server on http://localhost:8080
npm run build   # bundle to dist/
```

## Using `.vsdx` with git

This repo includes tooling that makes `.vsdx` files diff- and merge-friendly in
git: `git diff` shows canonical XML instead of *"Binary files differ"*, and
`git merge` performs a real 3-way merge on the drawing.

```bash
npm run vsdx:install-difftool   # one-time, per clone
```

See **[docs/vsdx-with-git.md](docs/vsdx-with-git.md)** for the full guide
(setup, readable diffs, merging, conflict resolution, and the CLI).
