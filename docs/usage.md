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

### Named views (layer presets)

The **Named views** panel in the Layers sidebar lets you save the current layer
visibility under a name, so a shared drawing can flip between the layer sets
different teams care about — e.g. a "Network" view and an "Electrical" view of
the same diagram.

- **Save view…** — captures a **per-page snapshot** of which layers are shown
  and hidden right now, under a name you choose. Saving again with an existing
  name overwrites it.
- **Select a view** from the dropdown to apply it — every page's layers are set
  to that view's recorded visibility. (Layers are matched by name, so a view
  keeps working after layers are reordered.)
- **Update** overwrites the selected view with the current visibility;
  **Delete** removes it.

Views are stored **inside the `.vsdx`** (in Visio's Solution XML store), so they
travel with the file: anyone you share it with sees the same named views. Like
every other edit, they're in memory until you **Save VSDX** (or **Export SVG**),
which bakes them into the downloaded file. They also survive being opened and
re-saved in the real Microsoft Visio desktop app — see
[visio-roundtrip.md](visio-roundtrip.md).

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

- **Export SVG** — download the current page as an `.svg`. The source `.vsdx`
  (with your layer edits applied) is embedded in the SVG as base64
  `<metadata>`, so an exported `.svg` can be dropped back into the app — or
  handed to someone else — and opened again as the full drawing, losslessly.
- **Save VSDX** — download a `.vsdx` with all your edits (layer changes, shape
  XML edits, pruning) applied.
