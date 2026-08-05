# VSDX Viewer

A browser-based **viewer, editor, and visual differ** for Microsoft Visio
drawings, templates, and stencils — plus a deterministic **git diff/merge
toolchain** that makes `.vsdx` files behave like text in version control.

Everything runs client-side: files never leave your machine.

**🌐 Website & docs: <https://smartnexiacloud-lgtm.github.io/vsdxeditor/>**
**▶ Open the app: <https://smartnexiacloud-lgtm.github.io/vsdxeditor/app.html>**
**⬇ Offline downloads (Windows / Linux): [Releases](https://github.com/smartnexiacloud-lgtm/vsdxeditor/releases/latest)**

The site has a [How-to guide](https://smartnexiacloud-lgtm.github.io/vsdxeditor/usage.html),
a [Changelog](https://smartnexiacloud-lgtm.github.io/vsdxeditor/changelog.html), and a
[Download page](https://smartnexiacloud-lgtm.github.io/vsdxeditor/download.html) for the
portable offline builds.

---

## Features

- **Open & render** `.vsdx`, `.vsdm`, `.vstx`, `.vstm`, `.vssx`, `.vssm`,
  `.vsd`, `.vst`, and `.vss` files, drawing each page or stencil master to SVG.
- **Multi-page** documents with page tabs.
- **Zoom** (in / out / fit-to-window) and pan, with a **Hairlines** control that
  either keeps Visio's hairlines at least a pixel wide at the current zoom or
  draws every line at its true Visio weight (**⟳ Update** re-renders for the
  zoom you are at).
- **Layers** — toggle layer visibility from a sidebar, or open the full
  **Layer Visibility Matrix** to bulk-edit which layers each page shows,
  filter by page, search/filter layers, and rename layers with *Replace all*.
- **Layer tags** — attach free-form, colour-coded tags to layers ("electrical",
  "draft") from the sidebar or the matrix, then filter with `tag:<name>` and
  bulk show/hide everything carrying a tag. Tags and their colours are embedded
  in the `.vsdx` and survive a Microsoft Visio round-trip.
- **Named views** — save the current layer visibility as a named preset (a
  per-page snapshot) so a collaborative drawing can flip between the layer sets
  different teams care about. Views are embedded in the `.vsdx` itself — they
  travel with the file and survive a Microsoft Visio round-trip
  (see [docs/visio-roundtrip.md](docs/visio-roundtrip.md)).
- **Shape Tree** — inspect a shape's group hierarchy and inherited style.
- **Find a shape** — right-click for **Select component**, which lists every
  shape under the cursor (topmost first, groups included) so you can reach one
  buried under another, or open a layer's **⊙** button for every shape on that
  layer. Hovering a row draws a selection square around that shape on the canvas.
- **Pen tool** — draw new paths onto the drawing: click for a corner, drag to
  pull a bezier handle, with fill and stroke (colour, weight, line pattern,
  opacity) set from a bar above the canvas and previewed as you draw. Curves are
  written as real Visio geometry — `RelCubBezTo` is SVG's cubic `C` command one
  for one — so what you draw is what Visio opens.
- **Per-shape XML editing** — right-click a shape to *Edit XML*, or send a
  shape to a different layer.
- **Prune** the drawing: *Remove Non-visible* or *Remove Non-selected* shapes.
- **Export SVG** of the current page, or **Save VSDX** with your edits applied.
  Exported SVGs embed the source `.vsdx` as base64 metadata, so dropping an
  exported `.svg` back into the app round-trips losslessly to the drawing.
- **Compare two files** — overlay + side-by-side visual diff that highlights
  moved, added, removed, and modified shapes, and reports layer changes.
- **Git integration** — readable `git diff` and true 3-way `git merge` for
  `.vsdx` files (see below).

---

## Quick start (using the app)

1. Open <https://smartnexiacloud-lgtm.github.io/vsdxeditor/app.html> (or run it locally, below).
2. Click **Open** — or drag a `.vsd`/`.vsdx` file onto the drop zone.
3. Use the page tabs, zoom, and **Layers** controls to explore the drawing.
4. Right-click a shape to edit its XML or move it between layers.
5. Click **Compare…** and pick a second `.vsdx` to diff the two visually.
6. **Export SVG** or **Save VSDX** to download your result.

A step-by-step tour of every panel is in **[docs/usage.md](docs/usage.md)**.

> **Note on Visio round-tripping:** exported SVGs re-open in *this* app because
> they carry the source drawing as embedded metadata. Getting custom data to
> survive a detour through the real Microsoft Visio app is a different problem —
> see **[docs/visio-roundtrip.md](docs/visio-roundtrip.md)** for what Visio
> preserves (Shape Data, document properties, its Solution XML store) versus
> silently drops (custom XML parts, unreferenced parts, comments).

---

## Run it locally

Requires Node.js (18+ recommended).

```bash
npm install
npm run dev     # esbuild dev server on http://localhost:8080 (set PORT to override)
npm run build   # bundle the app into dist/main.js
npm run postbuild   # copy the app to dist/app.html + render the site (landing, docs, changelog)
```

`npm run build && npm run postbuild` produces a fully static `dist/` you can
host anywhere: `index.html` (landing page), `app.html` (the app), and the
rendered `usage.html` / `changelog.html` / `download.html` pages. This is what
the GitHub Pages workflow deploys.

---

## Offline desktop downloads

Prefer to work without a browser tab open to the internet? Grab a **portable
build** from the [Releases page](https://github.com/smartnexiacloud-lgtm/vsdxeditor/releases/latest):
a single self-contained `vsdxeditor.html` (the whole app in one file), zipped
per platform with a launcher.

| Platform | File | Run it |
| --- | --- | --- |
| Windows | `vsdxeditor-portable-win-<version>.zip` | double-click `Open VSDX Editor.bat` |
| Linux | `vsdxeditor-portable-linux-<version>.zip` | run `./open-vsdx-editor.sh` |

Build them yourself with:

```bash
npm run package:portable   # writes the zips to dist-portable/
```

Pushing a `v*` tag (e.g. `v0.0.3`) triggers the release workflow, which builds
these zips and publishes them to a GitHub Release automatically.

---

## Using `.vsdx` with git

`.vsdx` files are ZIP archives, so out of the box git treats them as opaque
binaries — every change is *"Binary files differ"* and merges always conflict.
This repo ships tooling that fixes both: `git diff` shows canonical XML, and
`git merge` performs a real 3-way merge on the drawing's part tree. It also adds
`git vsdxdiff`, which opens a **graphical** diff of two revisions in your browser.

```bash
npm run vsdx:install-difftool   # one-time, per clone

git diff drawing.vsdx           # readable canonical-XML diff in the terminal
git vsdxdiff drawing.vsdx       # visual diff (overlay + side-by-side) in the browser
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
| `scripts/git-difftool-serve.mjs` | `git difftool` server that opens the browser visual diff |
| `scripts/install-git-integration.mjs` | Registers the git diff/merge/difftool config |
| `scripts/build-docs.mjs` | Renders the GitHub Pages site: landing `index.html` + `docs/*.md` and `CHANGELOG.md` → styled `dist/*.html` |
| `scripts/build-portable.mjs` | Inlines the app into one offline HTML and zips the Windows/Linux portable builds |

---

## License

[GPL-3.0-or-later](LICENSE).
