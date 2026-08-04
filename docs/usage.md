# Usage guide

A tour of the VSDX Viewer UI. The app runs entirely in your browser — nothing
is uploaded. Open the [live app](https://smartnexiacloud-lgtm.github.io/vsdxeditor/) or run
it locally with `npm run dev`.

## Opening a file

- Click **Open** in the toolbar and choose a supported Visio file, **or** drag it
  onto the drop zone.

Supported formats are `.vsdx`, `.vsdm`, `.vstx`, `.vstm`, `.vssx`, `.vssm`,
`.vsd`, `.vst`, and `.vss`. XML stencils are displayed as read-only master
sheets; XML drawings and templates can be edited and saved in their original
format.

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

### Thin lines (hairlines)

Visio stores a `LineWeight` of 0 as a *hairline*: the thinnest line the output
device can draw. On a scaled drawing — a 1:100 floor plan, say — that is a
fraction of a millimetre on paper, so it can disappear entirely when the page is
scaled down to fit a window. The **Hairlines** control in the toolbar decides
what happens to those lines:

| Setting | What you get |
| --- | --- |
| **Fit zoom** (default) | No line is drawn thinner than one screen pixel at the zoom the page was rendered for, so hairline detail (raised-floor grids, hatching, construction lines) stays visible |
| **True size** | Every line keeps its real Visio weight, with hairlines drawn at Visio's own 0.25 pt |

The minimum is baked into the SVG when the page is drawn, so changing the zoom
does not change it — following the zoom live would mean re-rendering the whole
drawing on every wheel tick. Instead, **⟳ Update** re-renders the page for the
current zoom, and lights up once you have zoomed away from the zoom the drawing
on screen was rendered for. **Export SVG** exports what is on screen, so switch
to **True size** first if you want an export with untouched line weights.

## Layers

Click **Layers** to open the layers sidebar. Each layer has a visibility toggle;
turning one off hides its shapes in the rendered page.

Bulk controls:

- **Select all** / **Deselect all** — toggle every layer.
- **Search layers** box with a filter mode (*Contains*, *Equals*, *Starts
  with*, *Ends with*).
- **Select filter** / **Deselect filter** — apply to just the filtered layers.

### Layer tags

Layers can carry free-form **tags** — "electrical", "draft", "as-built" — so a
drawing can be sliced by concern rather than by layer name.

- **Tag a layer**: click the 🏷 button on its row in the Layers sidebar and type
  a comma-separated list, or type into the **Tags** column of the
  [Layer Matrix](#layer-visibility-matrix). Tags are trimmed and
  de-duplicated case-insensitively, and each page keeps its own tagging.
- **Colours**: every tag gets a colour — derived from its name until you pick
  one. Click a tag's swatch in the **Tags** legend (sidebar or matrix) to
  recolour it; the colour is document-wide, so a tag looks the same everywhere.
- **Filter by tag**: the layer search box matches tag names as well as layer
  names, and `tag:electrical` restricts the match to tags only. Combine it with
  **Select filter** / **Deselect filter** to show or hide everything carrying a
  tag in one click. Clicking a tag in the legend fills the box for you.
- The editor-only **Unlayered** row can't be tagged — it isn't a real Visio
  layer, so there'd be nowhere to store it.

Visio's layer object model has no tag field, so tags and their colours are
stored in the drawing's Solution XML store — the same channel as named views,
proven to survive a Microsoft Visio open+save (see
[visio-roundtrip.md](visio-roundtrip.md)). Layers are matched by name, so tags
stay attached even if Visio renumbers layers. Like every other edit they live in
memory until you **Save VSDX** (or **Export SVG**).

### Sheet tabs

- Click a sheet name to open it or its **×** to delete it.
- Right-click a sheet to rename it, delete it, delete sheets to either side, or
  delete every other sheet.
- Drag sheets left or right to reorder them.

At least one foreground sheet is always retained. Deletions and sorting are
written into the document when you **Save VSDX** or **Export SVG**.

### Layer Visibility Matrix

Click **Layer Matrix** for a grid of every layer across every page. From here
you can:

- Toggle any layer/page cell.
- **Search matrix** (`Ctrl+F`) to jump to a layer.
- Rename layers: type into **Replace layer names with** and click **Replace
  all** to rename matching layers in bulk.
- Edit the **Tags** column (comma-separated) for any layer on any page; the
  search box matches tags too.
- Create, apply, update, and delete **Named views** without leaving the matrix.

### Named views (layer presets)

The **Named views** controls in the Layers sidebar and Layer Matrix let you save
the current layer configuration under a name, so a shared drawing can flip between the layer sets
different teams care about — e.g. a "Network" view and an "Electrical" view of
the same diagram.

- **Save view…** — captures a **per-page snapshot** of each layer's visibility,
  print, active, lock, snap, and glue settings under a name you choose. Saving
  again with an existing name overwrites it.
- **Select a view** from the dropdown to apply it — every page's layers are set
  to that view's recorded settings. (Layers are matched by name, so a view
  keeps working after layers are reordered.)
- **Update** overwrites the selected view with the current layer settings;
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
- **Save Visio** — download an XML drawing or template with all your edits (layer changes, shape
  XML edits, pruning) applied.
