# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.1]: https://github.com/smartnexiacloud-lgtm/vsdxeditor/releases/tag/v0.0.1
