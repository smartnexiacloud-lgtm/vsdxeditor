# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Layer tags** — assign free-form, comma-separated tags to layers from the
  Layers sidebar (🏷 on a layer row) or the new **Tags** column in the Layer
  Matrix. Tags are per page, trimmed, and de-duplicated case-insensitively.
- **Tag colours** — each tag gets a document-wide colour (derived from its name
  until you pick one) shown on the sidebar chips; recolour it from the swatch in
  the **Tags** legend of the sidebar or the Layer Matrix.
- **Filter by tag** — the layer search box now matches tags as well as layer
  names, and `tag:<name>` restricts matching to tags, so **Select filter** /
  **Deselect filter** can show or hide everything carrying a tag at once.
  Clicking a tag in the legend fills the box.
- Tags and their colours are stored inside the drawing in Visio's Solution XML
  store, the channel that survives a Microsoft Visio open+save (see
  `docs/visio-roundtrip.md`), keyed by layer name so they outlive layer
  renumbering. Every save path (save, prune, SVG export) carries them along.

## [0.0.4] - 2026-08-03

### Fixed
- Referenced unnamed layer rows are shown as muted italic `Layer <index>`
  entries instead of being discarded with unused Visio placeholders, so bulk
  layer hiding also affects their shapes.
- Added an editor-only `Unlayered` layer for controlling shapes without Visio
  layer membership. Its settings can be captured in named views without adding
  a synthetic layer to the Visio document.
- Layers hidden in the original Visio file can now be revealed immediately in
  the live viewer; clearing the runtime CSS state also removes the SVG
  `display="none"` presentation attribute created during initial rendering.

## [0.0.3] — 2026-08-01

### Added
- **Additional Visio formats** — open drawings (`.vsdx`, `.vsdm`, `.vsd`),
  templates (`.vstx`, `.vstm`, `.vst`), and stencils (`.vssx`, `.vssm`,
  `.vss`). XML stencil masters and binary stencil masters where available are
  exposed as read-only sheets. XML drawings and templates remain editable,
  retain macro/package contents, and keep their original extension when saved
  or embedded in an SVG export.
- **Layer Matrix page filter** — the matrix can now be narrowed to a single
  page (or shown across all pages); *Replace all* respects the filter.
- The **Named views** section of the layers sidebar now explains where views
  are stored (inside the .vsdx on **Save VSDX**).
- **Named views in the Layer Matrix** — create, apply, update, and delete view
  presets without returning to the Layers sidebar.
- **Sheet tab controls** — delete sheets with the tab's **×**, drag tabs to
  reorder sheets, and right-click for rename, close-left, close-right,
  close-others, and close-this actions.

### Changed
- **Search discovery metadata** — the GitHub Pages site now publishes canonical
  URLs, page-specific descriptions, social metadata, SoftwareApplication
  structured data, and an XML sitemap.
- **Named views now preserve complete layer state**, including visibility,
  print, active, lock, snap, and glue settings. Existing visibility-only views
  remain compatible.
- Sheet renames, ordering, and deletions are persisted into saved/exported
  VSDX documents, including relationship and named-view cleanup.
- **Website / front page** on GitHub Pages: a landing page (`index.html`) with a
  features overview and links, plus rendered **How-to**, **Changelog**, and
  **Download** pages sharing a common nav. The app itself moved to `app.html`.
- **Portable offline downloads** for Windows and Linux: `npm run package:portable`
  inlines the whole app into a single self-contained `vsdxeditor.html` and zips
  it per platform with a launcher (`scripts/build-portable.mjs`).
- **Release workflow** — pushing a `v*` tag builds the portable zips and
  publishes them to a GitHub Release automatically
  (`.github/workflows/release.yml`).

### Changed
- The live app URL is now `…/app.html`; the site root is the new landing page.
- `git vsdxdiff` / the difftool server now serves the app from `app.html`.

## [0.0.2] — 2026-07-03

### Added
- **`git vsdxdiff`** — a git difftool that opens the browser **visual** diff
  (overlay + side-by-side) for two revisions of a `.vsdx`, serving the app and
  both versions from a throwaway localhost server (`scripts/git-difftool-serve.mjs`).
- App auto-loads a comparison from URL query params
  (`?base=…&head=…` / `?file=…`), used by the difftool.
- `vsdx:install-difftool` now also registers the difftool and the `git vsdxdiff`
  alias (moved into `scripts/install-git-integration.mjs`).

## [0.0.1] — 2026-07-03

First tagged release.

### Added
- Browser-based viewer for Visio `.vsdx` and legacy `.vsd` files, rendering
  each page to SVG with multi-page tabs, zoom (in/out/fit), and pan.
- **Layers**: visibility sidebar with search/filter, and a full **Layer
  Visibility Matrix** for bulk toggling and layer renaming (*Replace all*).
- **Shape Tree** panel showing a shape's group hierarchy and inherited style.
- **Per-shape XML editing** and **Send Object To Layer** via a shape
  context menu.
- Document pruning: **Remove Non-visible** and **Remove Non-selected** shapes.
- **Export SVG** of a page and **Save VSDX** with edits applied.
- **Visual compare** of two `.vsdx` files (overlay + side-by-side diff)
  highlighting added/removed/moved/modified shapes and layer changes.
- **git toolchain** for `.vsdx`: deterministic canonical serialization, a
  `git diff` textconv driver (readable XML instead of "Binary files differ"),
  and a real 3-way `git merge` driver, with a Zip Slip guard.
- `.vsdx` CLI: `vsdx:unpack`, `vsdx:pack`, `vsdx:verify`.
- Test suites for the diff engine and diff view (`npm test`).
- Automatic GitHub Pages deployment.

[0.0.3]: https://github.com/smartnexiacloud-lgtm/vsdxeditor/releases/tag/v0.0.3
[0.0.2]: https://github.com/smartnexiacloud-lgtm/vsdxeditor/releases/tag/v0.0.2
[0.0.1]: https://github.com/smartnexiacloud-lgtm/vsdxeditor/releases/tag/v0.0.1
