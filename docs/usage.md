# Usage guide

A tour of the VSDX Viewer UI. The app runs entirely in your browser — nothing
is uploaded. Open the [live app](https://smartnexiacloud-lgtm.github.io/vsdxeditor/) or run
it locally with `npm run dev`.

## Opening a file

- Click **Open** in the toolbar and choose a `.vsd` or `.vsdx` file, **or**
- drag the file onto the **"Drop a .vsd or .vsdx file here"** zone.

The file name appears in the toolbar and the first page renders as SVG.
Multi-page documents show one tab per page beneath the toolbar — click a tab to
switch pages.

## Navigating the drawing

| Control | Action |
| --- | --- |
| **+** / **−** | Zoom in / out |
| **Fit** | Scale the page to fit the window |
| Drag on empty canvas | Pan |
| `zoom-info` readout | Shows the current zoom percentage |

## Layers

Click **Layers** to open the layers sidebar. Each layer has a visibility toggle;
turning one off hides its shapes in the rendered page.

Bulk controls:

- **Select all** / **Deselect all** — toggle every layer.
- **Search layers** box with a filter mode (*Contains*, *Equals*, *Starts
  with*, *Ends with*).
- **Select filter** / **Deselect filter** — apply to just the filtered layers.

### Layer Visibility Matrix

Click **Layer Matrix** for a grid of every layer across every page. From here
you can:

- Toggle any layer/page cell.
- **Search matrix** (`Ctrl+F`) to jump to a layer.
- Rename layers: type into **Replace layer names with** and click **Replace
  all** to rename matching layers in bulk.

## Inspecting shapes

- **Shape Tree** sidebar: select a shape to see its parent group hierarchy and
  the style it inherits.
- **Right-click a shape** to open its context menu:
  - **Edit XML** — open the shape's raw XML in an editor; **Apply XML** to
    commit your change or **Cancel** to discard.
  - **Send Object To Layer** — move the shape onto a different layer (filter the
    layer list with the search box).

## Pruning

- **Remove Non-visible** — drop shapes on hidden layers from the document.
- **Remove Non-selected** — keep only the currently selected shapes.

These edit the in-memory document; use **Save VSDX** to persist the result.

## Comparing two files

1. Load a base file.
2. Click **Compare…** and pick a second `.vsdx`.
3. The diff view highlights changes:
   - shapes that were **added**, **removed**, **moved**, or **modified**,
   - **layer** changes (added/removed/visibility),
   - shown both as an overlay and side-by-side.

## Exporting

- **Export SVG** — download the current page as an `.svg`.
- **Save VSDX** — download a `.vsdx` with all your edits (layer changes, shape
  XML edits, pruning) applied.
