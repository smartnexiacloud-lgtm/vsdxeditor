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
on screen was rendered for. **Export…** exports what is on screen, so switch
to **True size** first if you want an export with untouched line weights.

## Layers

Click **Layers** to open the layers sidebar. Each layer has a visibility toggle;
turning one off hides its shapes in the rendered page.

The pane resizes both ways. Drag its right-hand edge to make it wider — long
layer names need the room — and drag the line between the tool sections and the
list of layers to decide how the height is split between them. Until you drag it
the split is automatic: the tools take what they need and the list takes the
rest. Once you drag it, it stays put even as you fold sections open and shut.
Double-click the handle to hand the split back to the layout.

A layer's row is its name, its checkbox and its tags — nothing else. Everything
else a row can do is on **its menu**, which a right-click on the row opens, as
does the **⋯** at its end:

- **List shapes** — every shape on that layer, in the panel above the list.
  Hovering a row draws a square around that shape on the canvas.
- **Rename…** and **Move to group…** — see
  [grouping](#grouping-layers-by-a-delimiter).
- **Edit tags…** — see [layer tags](#layer-tags).
- **Delete…** — see [adding and removing layers](#adding-and-removing-layers).

On a [group](#grouping-layers-by-a-delimiter) row every entry speaks for the
whole subtree: *List shapes* lists every shape on every layer under it (each
shape once, however many of those layers it is on), and *Delete* asks once for
the lot.

### The pane itself

Layer names are as long as their author made them, and the tools for working
with them are each occasional, so:

- **Drag the pane's right edge** to make it wider; double-click that edge to fit
  it to the longest row.
- The tools are **folded away by default** — *Filter layers*, *Find shapes*,
  *Grouping*, *Named views*, *Tags* — each opening on its heading. A heading
  says what it is doing while folded, so a filter left on (`"pump"`) is never a
  drawing that mysteriously lost its layers.
- **+** in the pane's header adds a layer.

### Showing and hiding

- A layer's **checkbox**, or a click anywhere on its row, toggles it.
- Under *Filter layers*: a **Search layers** box with a filter mode (*Contains*,
  *Equals*, *Starts with*, *Ends with*, *Doesn't contain*), then **Show
  matches** / **Hide matches** for what the filter caught, and **Show all** /
  **Hide all** for the whole page.
- **Ctrl+Z** takes back the last change to what is shown — *Hide all* is one
  click and undoing it by hand is one click per layer. **Ctrl+Shift+Z** (or
  **Ctrl+Y**) puts it back. The history is per page and covers single toggles,
  the bulk buttons, a group's checkbox, and applying a
  [named view](#named-views-layer-presets); it is about visibility only, not
  about edits to the drawing.

### Grouping layers by a delimiter

Visio has no layer hierarchy — a page carries one flat list. What drawings do
instead is put the hierarchy in the *name*: `Electrical/HV`, `Electrical/LV`,
`Plumbing/Cold`. Open **Grouping** in the Layers sidebar and tick **Group by
delimiter** to read that convention back out and nest the rows accordingly.

- The box below it is the **delimiter**, and it is yours to choose — `/`, `.`,
  `::`, anything. It is matched literally, not as a pattern. Emptying it returns
  the list to flat, as does unticking the box.
- **▾ / ▸** collapses or expands a group; **Collapse all** / **Expand all** does
  the lot.
- A group's **checkbox** shows or hides every layer under it, and reads as
  half-ticked when only part of the group is showing. Its count (`2/3`) says how
  many.
- A layer with no delimiter in its name stays where it is, at the top level. A
  layer that is *also* a parent — `Electrical` alongside `Electrical/HV` — keeps
  its own row and gains a twisty for its children.

No group is ever written to the document: the tree is derived from the layer
names every time, and every layer keeps its own row and index. What *is* saved
is the setting itself — whether grouping is on, your delimiter, and which groups
you left collapsed — because a drawing whose layers are named `Electrical/HV` is
grouped by `/` for everybody, not just for you. It rides the same channel as
[named views](#named-views-layer-presets) and [layer tags](#layer-tags), so it
survives a round-trip through the real Visio, and whoever opens the file next
sees the tree you saw. A drawing that was never grouped opens flat, as before.

#### Moving and renaming — the name *is* the path

Nothing in a `.vsdx` records where a layer sits, because nothing in Visio has a
place to sit: the tree is derived from the names and nothing else. **So moving a
layer is renaming it.** Give a layer another group's prefix and that is where it
appears.

Every row — group or layer — offers **Rename…** on its menu (right-click the
row, or use its **⋯**), which edits **the full path the row stands for**,
prefilled so you can retype just the part you want to change:

| On a row for… | Typing… | Does |
| --- | --- | --- |
| the layer `Electrical/HV` | `Electrical/EHV` | renames it |
| the layer `Electrical/HV` | `Plumbing/HV` | **moves** it into `Plumbing` |
| the layer `Electrical/HV` | `HV` | moves it out to the top level |
| the group `Electrical` | `Power` | re-prefixes `Electrical/*` → `Power/*` |
| the group `Electrical` | `Site/Power` | moves the whole subtree under `Site` |

Only the part of each name the row accounts for is replaced, so everything
nested below keeps its own suffix and travels along: moving the group
`Electrical` moves `Electrical/HV` and `Electrical/LV` with it, and layers
outside it are untouched. A row that is both a layer and a parent — `Electrical`
next to `Electrical/HV` — renames itself and its children together.

Moving a group onto another group's name **merges** the two. That is only a
clash if it would leave two layers on the page with the same *full* name, which
is refused for the same reason a duplicate new layer is.

With grouping switched off the same entry just renames — there is no path on
show — but typing a delimiter into the name still files the layer into a group;
you simply won't see it as one until you tick **Group by delimiter**.

Renames are ordinary layer renames, so — like the Layer Matrix's *Replace all* —
they live in memory until you **Save VSDX**, and a [named view](#named-views-layer-presets)
that referred to a layer by its old name no longer matches it.

#### The row menu

**Right-click any row** — layer or group — or click its **⋯**:

| Menu entry | On a layer row | On a group row |
| --- | --- | --- |
| **List shapes** | every shape on the layer | every shape on every layer under the group, each listed once |
| **Rename…** | edits the row's full path | re-prefixes every layer under the group |
| **Move to group…** | asks only *which group*, keeping the layer's own name; blank puts it at the top level | moves the whole subtree, name intact |
| **Edit tags…** | the row's [tags](#layer-tags) | **adds** the tags you type to every layer under the group, keeping the tags each already has |
| **Delete…** | deletes the layer, keeping its shapes | deletes every layer under the group, asking once |

**Move to group…** is the same edit as a rename with the last segment held
fixed — useful when the name is long and only its home is wrong. It works with
grouping switched off too, where it simply prefixes the name.

### Adding and removing layers

- **+** in the sidebar's header adds a layer to the page you are on. Names have
  to be unique on the page — tags and named views identify layers by name, so
  two layers sharing one would be indistinguishable to both.
- **Delete…** on a row's menu deletes that layer, after telling you how many
  shapes are on it. On a group row it deletes every layer under the group,
  asking once for the lot.
- **+ New layer…** in a shape's right-click menu creates a layer *and* files
  that shape onto it — handy right after drawing something with the
  [pen](#drawing-new-shapes-pen), which lands unlayered.

Deleting a layer is not deleting its drawing. Its shapes stay exactly where they
are; a shape that was also on another layer simply loses this one, and a shape
left on no layer at all appears under the editor-only **Unlayered** row, from
where **Send Object To Layer** can file it somewhere else.

Both need an editable Visio XML package — a read-only binary `.vsd` or a
stencil has nowhere to write a layer to — and, like every other edit, they only
change the in-memory document until you **Save VSDX**.

A layer exists in the file as a numbered row, and every shape records its layers
by *number*, so the numbers are never reused or shuffled: a new layer takes one
past the highest already present, and deleting a layer leaves its number unused
rather than renumbering the others (which would move every shape on them). Layer
creation is a per-page action, so it lives in the sidebar rather than the
cross-page [Layer Matrix](#layer-visibility-matrix).

### Layer tags

Layers can carry free-form **tags** — "electrical", "draft", "as-built" — so a
drawing can be sliced by concern rather than by layer name.

- **Tag a layer**: pick **Edit tags…** from its row menu in the Layers sidebar
  (right-click the row, or use its **⋯**) and type a comma-separated list, or
  type into the **Tags** column of the
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
memory until you **Save Visio** (or **Export…**).

### Sheet tabs

- Click a sheet name to open it or its **×** to delete it.
- Right-click a sheet to rename it, delete it, delete sheets to either side, or
  delete every other sheet.
- Drag sheets left or right to reorder them.

At least one foreground sheet is always retained. Deletions and sorting are
written into the document when you **Save Visio** or **Export…**.

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
  keeps working after layers are reordered.) **Ctrl+Z** takes the change back on
  the page you are on if it was not what you wanted.
- **Update** overwrites the selected view with the current layer settings;
  **Delete** removes it.

Views are stored **inside the `.vsdx`** (in Visio's Solution XML store), so they
travel with the file: anyone you share it with sees the same named views. Like
every other edit, they're in memory until you **Save Visio** (or **Export…**),
which bakes them into the downloaded file. They also survive being opened and
re-saved in the real Microsoft Visio desktop app — see
[visio-roundtrip.md](visio-roundtrip.md).

## Inspecting shapes

- **Shape Tree** sidebar: select a shape to see its parent group hierarchy and
  the style it inherits. Each row carries a **✎** that renames that shape in
  place; double-clicking the name does the same once the row is the selected
  one. **Enter** commits, **Esc** leaves the name alone, and a blank answer
  clears it.
- **Right-click a shape** to open its context menu:
  - **Rename…** — set the shape's Visio name (its `Name`/`NameU`, the same field
    Visio's own *Shape Name* dialog edits). It is what the Shape Tree, the
    *Select component* list and the diff report call the shape, so naming the
    ones you care about — `Feeder cable` rather than `Shape.7` — is worth doing
    before a drawing gets big. The prompt starts from the name it has now;
    leaving it blank clears the name and the shape falls back to its text or its
    `Type.ID`. The same rename is on every row of the Shape Tree.
  - **Edit XML** — open the shape's raw XML in an editor; **Apply XML** to
    commit your change or **Cancel** to discard.
  - **Select component** — everything that passes through the point you
    clicked, topmost first, so you can reach a shape sitting underneath another
    one or pick the group instead of the part inside it. You should never have
    to send a shape to the back to get at what is behind it. The list is the
    union of two answers: every shape whose bounding box covers the point, and
    every shape the browser itself reports at that point — which includes ones
    that are completely covered up, and which is hit-tested against the real
    drawn outline rather than a box. Hovering a row draws a
    selection square around that shape on the canvas; clicking selects it and
    points the rest of the menu at it. Nesting is shown with `›` markers, and
    shapes currently hidden are marked `hidden` — they stay listed, because a
    shape you cannot see is often the one you are looking for. If the page has a
    background page, its shapes are drawn underneath this page's, so they are
    listed too and marked `background`. You can highlight and select one; the
    rest of the menu then says it belongs to the background page, because its
    layers are that page's and assigning it one of this page's would be wrong.
  - **Arrange** — see below.
  - **Send Object To Layer** — move the shape onto a different layer (filter the
    layer list with the search box), or **+ New layer…** to create one and file
    the shape onto it at the same time.

### Selecting several shapes, and arranging them

**Ctrl-click** (⌘-click on a Mac) or **shift-click** a shape to add it to the
selection, and again to drop it; a plain click selects just that one. Selected
shapes are outlined on the canvas — solid for the one the Shape Tree and the
*Send Object To Layer* list are pointed at, dashed for the rest. The same
ctrl-click works on the rows in *Select component*, the shape search results and
a layer's object list — and picking a shape from any of them points the Layers
sidebar at the layer that shape is on. Right-clicking a shape that is already selected keeps the
whole selection; right-clicking anything else selects that shape instead.

The **Arrange** section of the right-click menu then acts on everything
selected:

| Action | What it does |
| --- | --- |
| **Group** | Wraps two or more shapes in a new group, placed where the front-most of them was. Every member's position is rewritten into the group's own coordinate space, so nothing moves. |
| **Ungroup** | Dissolves a group and puts its shapes back on the page, keeping the place the group held in the z-order. |
| **Bring to front** | Draws the selected shapes on top of their siblings. |
| **Send to back** | Draws them behind their siblings. |

Z-order in Visio *is* the order the shapes are written in, so front and back
move a shape among its own siblings — a shape inside a group is brought to the
front of that group, not of the page.

Two things are deliberately refused rather than done badly:

- **Grouping a connector.** A connector is drawn in its parent's coordinates
  rather than its own, so moving one into a group would move it on the page.
- **Ungrouping a group that came from a master.** Its parts read their size and
  geometry from that master *through* the group; pulling them out would leave
  empty shapes behind. Groups you made yourself have no master and ungroup
  fine. (The button is greyed out with the reason in its tooltip.)

Grouping and ungrouping rewrite the drawing itself, so like every other edit
they take effect immediately in the editor and land in the file when you
**Save VSDX**.

### Searching for a shape

The **Find shapes** box — open that section in the **Layers** sidebar — searches
the current page: type part of a shape's name or its text and the results appear
right below, including shapes nested inside groups. **Hovering a result draws a
selection square around that shape on the canvas**, which is the point of the
list: it answers *where is it?* without changing anything. Clicking a result
selects the shape, opens the Shape Tree on it, and **highlights the layer it is
on** in the list below — clearing a filter and expanding any groups that were
hiding that row, since a row that is not drawn cannot be pointed at. **Enter**
takes the top match.

- Matching is case-insensitive and matches anywhere in the name or the text.
- `#7` searches by shape ID instead, on a prefix, so the list narrows as you
  type.
- Shapes on hidden layers are still listed, marked `hidden` — a shape you cannot
  see is often the one you are hunting for.
- **Esc** or clearing the box closes the results. Searching is per page; the box
  clears when you switch pages.
- Long lists stop at the first 300 matches (the title says so) — type more of
  the name rather than scrolling.

### Listing every shape on a layer

**List shapes** on a row's menu in the **Layers** sidebar (right-click the row,
or use its **⋯**) opens the list of every shape on that layer, including shapes
nested inside groups. On a [group](#grouping-layers-by-a-delimiter) row it lists
every shape on every layer under the group, each shape once however many of them
it is on.

Hovering a row draws the same selection square on the canvas; clicking selects
the shape and points the sidebar at its layer. Asking again closes the list, and
opening it never changes the layer's visibility. The list and the search results
share one panel, so opening a layer's objects clears the search box and vice
versa.

## Drawing new shapes (Pen)

Click **✎ Pen** to draw a path onto the current page. The button is only
available for editable Visio XML packages — drawing writes back into the file,
which the read-only binary `.vsd` formats cannot do.

- **Click** places a corner point.
- **Click and drag** places a point and pulls a bezier handle out of it. The
  handle is mirrored on both sides, so the curve runs smoothly through the
  point — the same behaviour as Illustrator's pen.
- **Enter**, **double-click**, or **Finish** commits the path.
- **Clicking the first anchor** (highlighted once the path has three points)
  closes the path and commits it.
- **Backspace** or **Undo point** removes the last point; **Esc** or **Cancel**
  discards the whole path. Pressing **Esc** with nothing drawn leaves the tool.

The bar above the canvas sets what the path is drawn with, and the live preview
uses those settings so you can see the result before committing:

| Control | Visio cell |
| --- | --- |
| Stroke on/off | `LinePattern` 0 and the geometry's `NoLine` |
| Stroke colour | `LineColor` |
| Width (pt) | `LineWeight` (converted to inches) |
| Line pattern | `LinePattern` — solid, dashed, dotted, dash-dot, long dash |
| Fill on/off | `FillPattern` 0 and the geometry's `NoFill` |
| Fill colour | `FillForegnd` |
| Fill opacity | `FillForegndTrans` |

Curves are stored as Visio's `RelCubBezTo` rows, which map one for one onto
SVG's cubic `C` command (cells `A,B` and `C,D` are the two control points), and
straight runs stay plain `MoveTo`/`LineTo`. Nothing is fitted or approximated.

Because Visio has no *absolute* cubic — every curve is a fraction of the shape's
`Width`/`Height` — the path becomes a shape only when you commit it, which is
when its bounding box is finally known. The new shape lands on the page
unlayered; right-click it and use **Send Object To Layer**, or **+ New layer…**
if it should go somewhere that does not exist yet.

Drawing edits the in-memory document; use **Save Visio** to persist them.

## Pruning

- **Remove Non-visible** — drop shapes on hidden layers from the document.
- **Remove Non-selected** — keep only the currently selected shapes.

These edit the in-memory document; use **Save VSDX** to persist the result.
Pruning rebuilds the whole package and re-reads it, so it takes everything else
you have changed but not yet saved with it — closed [sheet tabs](#sheet-tabs)
included, which stay closed.

## Comparing two files

1. Load a base file.
2. Click **Compare…** and pick a second `.vsdx`.
3. The diff view highlights changes:
   - shapes that were **added**, **removed**, **moved**, or **modified**,
   - **layer** changes (added/removed/visibility),
   - shown both as an overlay and side-by-side.

## Exporting

**Export…** opens a small dialog: pick a format, pick a size, done.

### Format

- **SVG** — the current page as an `.svg`. The source `.vsdx` (with your layer
  edits applied) is embedded as base64 `<metadata>`, so an exported `.svg` can
  be dropped back into the app — or handed to someone else — and opened again
  as the full drawing, losslessly. Untick **Embed the source Visio document**
  for a plain, much smaller SVG that will not re-open here.
- **PDF** — see [PDF export](#pdf-export) below.
- **Save Visio** (on the toolbar, not in this dialog) — download an XML drawing
  or template with all your edits (layer changes, shape XML edits, pruning)
  applied.

### Size

The drawing is rendered in its own units — 96 to the paper inch — so a large
engineering drawing is tens of thousands of units across. SVG is resolution
independent and does not care, but the programs you hand the file to very much
do: browsers get sluggish or refuse to rasterise past ~32767px, Inkscape's PDF
export garbles it, and **a PDF page cannot exceed 200in (14400pt) per side at
all** — that is a hard limit in the format, not a viewer bug.

So the dialog lets you say how big the file should *claim* to be:

| Size | What it does |
| --- | --- |
| **Original size** | The drawing's true dimensions. Exact, and what you want if the target can cope. |
| **Viewer-safe** | Longest side 19200px (200in) — the largest a PDF page can legally be. |
| **Screen** | Longest side 4096px, comfortable for any browser. |
| **Custom longest side** | Any size you like, in px. This one may also enlarge. |

The presets are ceilings, never magnifiers: a drawing already inside the limit
exports untouched.

**Rescaling costs you nothing.** Only the root `width`/`height` change; the
`viewBox` and every coordinate in the file are left exactly as they were. The
result is the same vector drawing at full precision, just labelled with a size
that ordinary software can handle. The dialog opens on **Viewer-safe** for a
drawing too big for a PDF page, and on **Original size** for everything else.

### PDF export

PDF needs two libraries this app does not bundle — writing a PDF by hand would
mean font subsetting, and half a megabyte of dependency for a feature most
sessions never touch would be a poor trade for something you can run off a USB
stick. So they are fetched only when you ask for a PDF, and only after you tick
**Allow this download**:

- [jsPDF](https://github.com/parallax/jsPDF) 4.2.1
- [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) 2.7.0

Both come from `cdn.jsdelivr.net`, and **the bytes are checked against a
SHA-256 digest pinned in the source before a single line of them runs**. A CDN
that is compromised, MITM'd, typosquatted, or that quietly republishes a
version fails the check, nothing executes, and you get told which library
failed along with both digests. The libraries are held in memory only, so they
are re-fetched (and re-verified) next session.

The dialog shows the exact URLs and digests before you agree. If you would
rather not download anything, export an SVG and convert it yourself — and if
you are converting through Inkscape, set the size here first, because that is
the step that usually produces the garbage.

Offline or air-gapped? PDF export will simply fail to download; everything else
in the app is self-contained as always.
