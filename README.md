# VSDX Viewer

A browser-based **viewer, editor, and visual differ** for Microsoft Visio
`.vsdx` (and legacy `.vsd`) drawings — plus a deterministic **git diff/merge
toolchain** that makes `.vsdx` files behave like text in version control.

Everything runs client-side: files never leave your machine.

**▶ Live app: <https://smartnexiacloud-lgtm.github.io/vsdxeditor/>**

---

## Features

- **Open & render** `.vsdx` and `.vsd` files, drawing each page to SVG.
- **Multi-page** documents with page tabs.
- **Zoom** (in / out / fit-to-window) and pan.
- **Layers** — toggle layer visibility from a sidebar, or open the full
  **Layer Visibility Matrix** to bulk-edit which layers each page shows,
  search/filter layers, and rename layers with *Replace all*.
- **Shape Tree** — inspect a shape's group hierarchy and inherited style.
- **Per-shape XML editing** — right-click a shape to *Edit XML*, or send a
  shape to a different layer.
- **Prune** the drawing: *Remove Non-visible* or *Remove Non-selected* shapes.
- **Export SVG** of the current page, or **Save VSDX** with your edits applied.
- **Compare two files** — overlay + side-by-side visual diff that highlights
  moved, added, removed, and modified shapes, and reports layer changes.
- **Git integration** — readable `git diff` and true 3-way `git merge` for
  `.vsdx` files (see below).

---

## Quick start (using the app)

1. Open <https://smartnexiacloud-lgtm.github.io/vsdxeditor/> (or run it locally, below).
2. Click **Open** — or drag a `.vsd`/`.vsdx` file onto the drop zone.
3. Use the page tabs, zoom, and **Layers** controls to explore the drawing.
4. Right-click a shape to edit its XML or move it between layers.
5. Click **Compare…** and pick a second `.vsdx` to diff the two visually.
6. **Export SVG** or **Save VSDX** to download your result.

A step-by-step tour of every panel is in **[docs/usage.md](docs/usage.md)**.

---

## Run it locally

Requires Node.js (18+ recommended).

```bash
npm install
npm run dev     # esbuild dev server on http://localhost:8080
npm run build   # bundle the app into dist/ (index.html + main.js)
```

`npm run build` produces a fully static `dist/` you can host anywhere.

---

## Using `.vsdx` with git

`.vsdx` files are ZIP archives, so out of the box git treats them as opaque
binaries — every change is *"Binary files differ"* and merges always conflict.
This repo ships tooling that fixes both: `git diff` shows canonical XML, and
`git merge` performs a real 3-way merge on the drawing's part tree.

```bash
npm run vsdx:install-difftool   # one-time, per clone
```

The `.gitattributes` in this repo already maps `*.vsdx` to the `vsdx` diff and
merge drivers; the command above registers the driver commands locally (git
won't run commands shipped inside `.gitattributes`, for security reasons).

See **[docs/vsdx-with-git.md](docs/vsdx-with-git.md)** for the full guide
(setup, readable diffs, merging, conflict resolution) and the standalone CLI.

### `.vsdx` CLI

```bash
npm run vsdx:unpack -- file.vsdx out-dir/   # explode to canonical XML tree
npm run vsdx:pack   -- out-dir/ file.vsdx   # repack a tree into a .vsdx
npm run vsdx:verify -- file.vsdx            # round-trip check
```

---

## Tests

```bash
npm test                  # runs the vsdx-diff + diff-view suites
npm run test:vsdx-diff    # canonical serialize + diff engine
npm run test:diff-view    # side-by-side diff rendering
```

---

## Project layout

| Path | What it is |
| --- | --- |
| `src/index.html` | App shell + all UI markup and styles |
| `src/main.js` | App entry: file loading, panels, editing, orchestration |
| `src/vsdx-parser.js` | `.vsdx` (OPC/ZIP) parser |
| `src/vsd-parser.js` | Legacy `.vsd` (OLE compound) parser |
| `src/svg-renderer.js` | Page → SVG rendering |
| `src/shape-inheritance.js` | Shape style inheritance resolution |
| `src/vsdx-diff.js` / `src/diff-view.js` | Diff engine + diff UI |
| `scripts/vsdx-serialize.mjs` | Canonical serialize / pack / textconv / merge driver |

---

## License

[GPL-3.0-or-later](LICENSE).
