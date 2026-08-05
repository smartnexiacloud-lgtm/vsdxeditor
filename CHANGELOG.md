# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Pen tool — draw new paths onto a drawing.** Click to place a corner, drag to
  pull a bezier handle out of the point you just placed (mirrored on both sides,
  like Illustrator's smooth point). `Enter` or a double-click finishes the path,
  clicking the first anchor closes it, `Backspace` drops the last point, `Esc`
  discards it. Fill and stroke — colour, weight in points, line pattern, fill
  colour and opacity — are set from a bar above the canvas and previewed live
  while you draw.

  The path is written as real Visio geometry, not an approximation: Visio's
  `RelCubBezTo` row *is* SVG's cubic `C` command, with cells `A,B` and `C,D`
  holding the two control points, so an exported curve is the curve you drew.
  Straight runs stay plain `MoveTo`/`LineTo` rows. Because Visio has no
  *absolute* cubic — every curve is a fraction of the shape's `Width`/`Height` —
  a path is committed as a whole once its bounding box is known, and a path with
  no extent on one axis (a perfectly horizontal drag) gets that axis floored and
  is centred in the box rather than collapsing to a point.
- **Finding a shape: "Select component" and per-layer object lists.**
  Right-clicking now lists every shape whose box covers that point, topmost
  first and groups included, so a shape buried under another one is reachable —
  and each layer in the sidebar has a **⊙** button listing every shape on it,
  nested shapes included. Hovering a row in either list draws a selection square
  around that shape on the canvas; clicking selects it. Hidden shapes stay
  listed and are marked as hidden, since a shape you cannot see is usually the
  one you are hunting for.

  The boxes come from a new `shape-picker` module that reproduces the renderer's
  own transform chain, so a shape nested three groups deep is hit-tested exactly
  where it is drawn. 1-D connectors are special-cased the way the renderer does
  it — they are drawn straight in page coordinates and their group carries no
  transform at all — with the rule exported from `svg-renderer` rather than
  guessed at twice. A test composes the transform off the rendered SVG and
  checks the picker against it, shape by shape, across four real drawings
  (487 groups, 408 of them nested).
- **`addVsdxShapeToPage`** in the parser: adds a top-level shape to a page,
  assigning the next free shape ID. The counterpart to
  `replaceVsdxShapeXmlSnippet`, which deliberately refuses any ID that does not
  already exist.

### Fixed
- **Hand-editing a shape's XML no longer resets the layers.** Applying a shape
  edit rebuilds the package and re-parses it, and the sidebar is rebuilt from
  the result — but layer visibility toggles, renames, tags and per-shape layer
  moves live only in memory until something writes them out, so the edit was
  applied to the file *as opened* and the re-parse reverted them. Those pending
  edits are now folded into the package first (the same step the prune paths
  already did for themselves), and the editor-only "Unlayered" row — which has
  nowhere to live in the file — is carried across the re-parse by hand.
- **Hairlines no longer vanish on scaled drawings.** Visio's `LineWeight 0`
  (hairline) was floored at a constant 0.5 units, which is meaningless in a
  scaled drawing's coordinate space — on a 1:100 plan that is 1/19200 of an
  inch, so whole layers drawn with hairlines (raised-floor grids, construction
  lines) rendered as nothing. The floor is now Visio's own 0.25 pt, scaled with
  the drawing.
- **Hatch fills are drawn as hatches.** `FillPattern` 2–24 were painted as an
  opaque solid in the fill's foreground colour, turning stippled squares into
  black blocks and flooding shaded areas. They are now emitted as vector SVG
  `<pattern>` definitions (Visio's 6 pt tile, 8×8 cells), honouring the fill's
  background colour and both transparencies. Patterns 2–7, 11 and 24 match a
  Visio 16 export cell for cell.
- **Dashed lines are dashed.** `getDashArray` only knew `LinePattern` 1–5 and
  drew everything else solid; all 23 built-in patterns are now defined, with
  dash runs measured in line weights as Visio does, and a round cap so
  dash-dot patterns show their dots.

### Added
- **Hairlines toolbar control** — choose between *Fit zoom* (no line thinner
  than a screen pixel at the rendered zoom, the default) and *True size* (real
  Visio weights), plus an **⟳ Update** button that re-renders the page for the
  current zoom. The minimum is baked into the SVG, so it is applied on demand
  rather than on every wheel tick; the button highlights when the view has been
  zoomed away from the render.
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
