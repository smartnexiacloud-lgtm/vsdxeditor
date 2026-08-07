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

An `.svg` this app exported can be opened too: it carries the source drawing as
embedded metadata, and if you have edited the picture in another editor since,
you are asked whether to bring those edits back — see
[Editing the SVG somewhere else](#editing-the-svg-somewhere-else-and-bringing-it-back).

The file name appears in the toolbar and the first page renders as SVG.
Multi-page documents show one tab per page beneath the toolbar — click a tab to
switch pages.

## Navigating the drawing

| Control | Action |
| --- | --- |
| Wheel | Scroll up and down |
| **Shift** + wheel | Scroll left and right |
| **Ctrl** / **⌘** + wheel, or a trackpad pinch | Zoom about the pointer |
| **+** / **−** | Zoom in / out about the middle of the window |
| **Fit** | Scale the page to fit the window — including *up*, for a drawing smaller than the window |
| Drag on empty canvas | Pan (dragging a *selected* shape moves it instead — see [Select](#moving-resizing-and-turning-shapes-select)) |
| **✋ Pan** in the toolbar, then drag anywhere | Pan, shapes included — nothing on the page is picked or moved while it is out. Click **Select** to go back to editing. |
| Scrollbars | Drag a thumb, or click its track to jump |
| **←** **↑** **→** **↓** | Pan a step; hold **Shift** for a bigger one |
| **Page Up** / **Page Down** | Pan a screenful |
| **Home** / **End** | Jump to the top-left / bottom-right corner of the drawing |
| `zoom-info` readout | Shows the current zoom percentage |

The arrow keys act on the canvas once it has the focus, which pressing on it
gives it.

Zoom is applied to the SVG's own size rather than as a transform on top of it,
so the drawing is re-drawn at every zoom instead of magnified as pixels — no
soft edges while you wheel, and none left behind afterwards. The flip side is
that the drawing is *placed* by a transform too, so the browser has no
scrollable box here and would draw no scrollbars of its own: the ones at the
right and bottom edges are drawn from the same pan the drag uses. They appear
only when part of the drawing is off screen, and the drawing itself can no
longer be flung out of the window — a drag stops when its edge reaches the
window's.

**A page opens showing all of itself.** A Visio drawing is not necessarily a
sheet of paper: a site plan or a floor layout is measured at full size, and one
that is 3962 × 2618 *inches* is 380,372 renderer pixels across — it fits a
1200-pixel window at 0.32%. So opening a page fits it to the window, **Fit**
returns you there at any time, and zoom goes down to 0.02% for the drawings that
need it. Below 10% the readout switches to decimals, because `0%` tells you
nothing about whether **−** did anything.

### Thin lines (hairlines)

Visio stores a `LineWeight` of 0 as a *hairline*: the thinnest line the output
device can draw. On a scaled drawing — a 1:100 floor plan, say — that is a
fraction of a millimetre on paper, so it can disappear entirely when the page is
scaled down to fit a window. The **Hairlines** control in the toolbar decides
what happens to those lines:

| Setting | What you get |
| --- | --- |
| **True size** (default) | Every line keeps its real Visio weight, with hairlines drawn at Visio's own 0.25 pt — what Visio, an export and a print all show |
| **Fit zoom** | No line is drawn thinner than one screen pixel at the zoom the page was rendered for, so hairline detail (raised-floor grids, hatching, construction lines) stays visible on a plan shrunk to fit the window |

The minimum is baked into the SVG when the page is drawn, so changing the zoom
does not change it — following the zoom live would mean re-rendering the whole
drawing on every wheel tick. Instead, **⟳ Update** re-renders the page for the
current zoom, and lights up once you have zoomed away from the zoom the drawing
on screen was rendered for. **Export…** exports what is on screen, so switch
back to **True size** first if you have been using **Fit zoom** and want an
export with untouched line weights.

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
  the lot, and **Collapse unselected** folds everything except the way down to
  the layer you last picked.
- A group's **checkbox** shows or hides every layer under it, and reads as
  half-ticked when only part of the group is showing. Its count (`2/3`) says how
  many.
- A layer with no delimiter in its name stays where it is, at the top level. A
  layer that is *also* a parent — `Electrical` alongside `Electrical/HV` — keeps
  its own row and gains a twisty for its children.
- Picking a shape — on the canvas, or from *Select component*, the shape search
  or a layer's object list — unfolds its way down to the layer that shape is on
  and marks the row. Only the groups on the way there open; the rest of the tree
  stays as you folded it. A shape that is on no layer marks the *Unlayered* row,
  because that is the answer for it.

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

- **Shape Tree** sidebar: select a shape and the tree opens on the whole page —
  every shape, nested inside its group, with the selected one marked and the
  branches leading to it opened. Hovering a row draws a selection square around
  that shape on the canvas, and the row's tooltip shows the text the shape
  holds, which is often the only thing that tells `Shape.8` from `Shape.9`.
  Clicking a row selects that shape; **right-clicking a row opens the same menu
  the canvas does**, so rename, *Edit XML*, *Send Object To Layer*, the arrange
  actions and *Delete* are all on a row. Each row also carries a **✎** that
  renames the shape in place (double-clicking the name does the same once the
  row is the selected one; **Enter** commits, **Esc** leaves it alone, a blank
  answer clears it) and a **×** that deletes it from the drawing.
- **The tree follows the marked layer.** The two panes describe the same
  drawing, so they agree about it. While the Layers sidebar is open, the tree
  lists what is on the layer marked there — the shapes that carry it, everything
  inside them, and the groups on the way down — and walking the layer rows walks
  the tree with you; the subtitle names the layer and counts what it is showing.
  Picking a shape in the tree does the reverse and marks the layer that shape is
  on, the same as picking it anywhere else. Shut the Layers sidebar and there is
  no marked layer to follow, so the tree is the whole page again; **Follow
  layer** in the tree's header does the same with both panes open.
- **Folding the tree.** A drawing where everything is inside a group is a tree
  nobody can read at a glance, so three buttons act on the lot: **Collapse all**,
  **Expand all**, and **Collapse unselected** — which folds everything except
  the way down to the shape you are working in. Selecting a shape opens the
  branches leading to it, and then leaves your folding alone; folding a branch
  you are inside stays folded.
- **Walking the tree from the keyboard.** Tab into the tree (or click a row) and
  the arrows take over. The cursor is *not* the selection: moving it only points
  at a shape — it draws the same box hovering a row does — so you can walk a
  drawing watching the canvas without disturbing what you already had selected,
  and **Enter** is what commits it.

  | Key | What it does |
  | --- | --- |
  | **↑ / ↓** | step through the rows you can see |
  | **PgUp / PgDn** | ten rows at a time |
  | **Home / End** | first / last row |
  | **→** | open the group under the cursor; again to step into it |
  | **←** | close the group under the cursor; again to climb out to its parent |
  | **Enter** | select the shape the cursor is on |
  | **Space** | show/hide it — the row's checkbox |
  | **F2** | rename it in place |

  The whole tree is one tab stop: the buttons on a row are reached by pointer,
  not by tabbing thirty times to get past them.
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
  - **Arrange**, including **Delete** — see below.
  - **Send Object To Layer** — move the shape onto a different layer (filter the
    layer list with the search box), or **+ New layer…** to create one and file
    the shape onto it at the same time.

### Moving, resizing and turning shapes (Select)

**Select** is what the canvas does whenever neither of the other two tools —
**Pen** and **Pan** — is out. Click a shape to pick it, and it grows eight
square handles and a round grip above it:

| Drag | What happens |
| --- | --- |
| **the shape itself** | Moves it. Grabbing a shape that was not selected selects it and moves it in the one gesture, and a whole multiple selection moves together. |
| **a corner handle** | Resizes both axes at once. Hold **Shift** to keep the shape's proportions. |
| **an edge handle** | Resizes just that axis — the stretch. |
| **the round grip** | Turns the shape about its pin. Hold **Shift** to snap to 15°, so 90° is easy to hit. |

The handles sit on the shape's *own* box, not on the upright box that contains
it, so a shape turned 30° gets handles turned 30° with it and dragging one
resizes along the shape's own axes. The corner opposite the one you are dragging
stays exactly where it was.

The drawing follows the box: a resize scales the shape's outline, everything
inside a group, and the outlines of those too. Visio stores half of an outline
as fractions of the shape's width and height and half of it as inches worked out
from a formula — `Width*0.5` — that Visio re-evaluates every time the width
changes. This app scales the second kind rather than evaluating it, which is the
same answer for a plain proportion and a close one otherwise; the formula itself
is left alone, so Visio still works the exact value out and a shape drawn to be
resizable stays resizable.

What follows the pointer is a dashed **outline**, not the drawing. The shape is
edited once, when you let go — so a drag is one durable change to the file
rather than a hundred, and it survives **Save Visio** like every other edit.
Pressing anywhere that is not a selected shape still pans the canvas — and on a
drawing whose shapes leave no empty canvas to press, **Pan** in the toolbar
makes every press a pan until you click **Select** again.

Letting go moves the shapes that moved and nothing else. A move, a turn or a
flip does not change what a shape looks like — only where it is — so it is
written as exactly that: the shape stays on the canvas and is placed somewhere
else, however much is inside it, and a group of a thousand children costs the
same as a single rectangle. Only a resize draws a shape again, because that
scales its geometry, re-wraps its text and rescales a group's contents — all the
way down, so a group inside a group grows too rather than keeping its old
picture inside a bigger box. Either
way the rest of the page is left alone — as are your selection, the
folded rows of the Shape Tree and where you had scrolled to. The .vsdx itself is
rewritten the next time anything needs it, which on a large drawing is the slow
part and is not something to make you wait for at the moment you let go of the
mouse: **Save Visio**, **Export…**, **Compare…**, the shape XML editor and any
edit that does change the structure of the document (group, ungroup, z-order,
delete) all fold your moves in first. Nothing leaves the app without them.

Dragging a group takes everything inside it, and resizing one scales its
contents with it, the way Visio does. All of it works on a shape nested several
groups deep: the cells are worked out through the same matrix chain the renderer
walks, so a shape's position inside its parent is rewritten correctly however
deep it sits.

Two things it will not do:

- **Move a connector.** A connector is drawn between its endpoints rather than
  placed by its pin, so moving the pin would move nothing. It says so rather
  than appearing to do nothing.
- **Skew a shape.** Visio's shape transform is a pin, a size, an angle and two
  flip flags — there is no skew in it. Slanting a shape means rewriting its
  geometry, which is a different operation from moving the shape about.

Editing the individual anchor points of a path (the SVG node-editing idea) is
not built yet either; the pen writes geometry but nothing edits it afterwards
except **Edit XML**.

### Selecting several shapes, and arranging them

**Ctrl-click** (⌘-click on a Mac) or **shift-click** a shape to add it to the
selection, and again to drop it; a plain click selects just that one. Selected
shapes get a marked box on the canvas — solid for the one the Shape Tree and the
*Send Object To Layer* list are pointed at, dashed for the rest. The box is
drawn on top of the whole drawing, so selecting a shape that is buried under
another one still shows, and it is measured from where the shape was actually
drawn rather than from its geometry — a shape with a very thick stroke is
contained by its own selection box rather than spilling out of it. The same
ctrl-click works on the rows in *Select component*, the shape search results and
a layer's object list — and picking a shape from any of them points the Layers
sidebar at the layer that shape is on. Right-clicking a shape that is already selected keeps the
whole selection; right-clicking anything else selects that shape instead.

**Esc** lets the whole selection go, handles and all. Clicking bare canvas does
the same, but a drawing whose shapes cover the page may not have any bare canvas
to click, and with the ✋ hand out a click does not clear it either. Esc typed
into a box belongs to the box, and while the ✎ pen is out it belongs to the pen.

The **Arrange** section of the right-click menu then acts on everything
selected:

| Action | What it does |
| --- | --- |
| **Group** | Wraps two or more shapes in a new group, placed where the front-most of them was. Every member's position is rewritten into the group's own coordinate space, so nothing moves. |
| **Ungroup** | Dissolves a group and puts its shapes back on the page, keeping the place the group held in the z-order. |
| **Bring to front** | Draws the selected shapes on top of their siblings. |
| **Send to back** | Draws them behind their siblings. |
| **Delete** | Removes the selected shapes from the drawing. Deleting a group deletes everything inside it, and any connector glued to a shape that goes is unglued rather than left pointing at nothing. **Delete** and **Backspace** do the same from the keyboard, except while the pen tool is active or you are typing in a box. |

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
  for a plain, much smaller SVG that will not re-open here. Shapes come out
  grouped into real SVG layers — see
  [Layers in the exported SVG](#layers-in-the-exported-svg). Each shape also
  carries its Shape Data and user cells as the `v:custProps` / `v:userDefs`
  elements Visio's own SVG export writes; those are added on the way out rather
  than drawn on the canvas, because on a large drawing they are three quarters
  of the document and nothing paints them.
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
exports untouched. **Longest side** is only asked for by *Custom*, and only
appears then — the same goes for the rest of the dialog: the SVG embed checkbox
is there for SVG and gone for PDF (a PDF cannot carry the source document), and
the PDF library consent is there for PDF and gone for SVG (which downloads
nothing).

**Rescaling costs you nothing.** Only the root `width`/`height` change; the
`viewBox` and every coordinate in the file are left exactly as they were. The
result is the same vector drawing at full precision, just labelled with a size
that ordinary software can handle. The dialog opens on **Viewer-safe** for a
drawing too big for a PDF page, and on **Original size** for everything else.

### Layers in the exported SVG

A Visio layer is a property of a shape — the page is a flat list of shapes, each
naming the layers it is on. SVG has no layer concept at all, but every editor
that pretends to have one reads the same convention, so the export writes it:
each Visio layer becomes a `<g inkscape:groupmode="layer">` labelled with the
layer's name, and Inkscape (or Boxy, or Affinity) opens the file with a working
layer panel instead of one flat pile of paths. Layers you have switched off in
the app come out as a **hidden group**, not as a pile of individually hidden
shapes, so the eye icon in the layer panel actually toggles them back on.

One caveat, and it is Visio's rather than the app's. SVG's paint order **is**
document order, while Visio's z-order is independent of its layers — a drawing
can perfectly well stack wall, door, wall, door. Collecting every wall into one
group therefore moves shapes past each other, and where they overlap that
changes the picture. So the export only merges a layer's shapes into one group
when it can show the reordering is invisible: every pair of shapes that swapped
has to have disjoint bounding boxes. Where it cannot, that layer is emitted as
several groups following the original order — you get `Walls`, `Walls (2)`,
`Walls (3)` in the panel instead of one `Walls`, and the drawing looks exactly
as Visio draws it. Tidier XML is not worth a silently restacked drawing.

### Editing the SVG somewhere else and bringing it back

An exported SVG carries the whole drawing inside it, so re-opening one gives you
the drawing back — which for a long time meant that anything you had done to the
*picture* in between was silently discarded. It is not any more.

Open an exported `.svg` in Inkscape, delete things, draw things, save, and drop
the file back on the app. It compares the picture against the drawing embedded
in it, tells you what it found, and asks before applying anything:

| What you did | What comes back |
| --- | --- |
| **Deleted a shape** | Every shape's group carries its Visio id, so an id the picture no longer has is a shape that was deleted. Deleting a group takes its children's ids with it, which reads correctly as deleting the group. |
| **Deleted a whole layer** | The shapes on it are gone, so they are deleted. The layer itself stays — remove it from the Layers sidebar. |
| **Drew a new path or shape** | `path`, `rect`, `circle`, `ellipse`, `line`, `polyline` and `polygon` become real Visio shapes: geometry, fill, stroke colour, width, dashes and opacity. Curves stay curves — Visio's `RelCubBezTo` row *is* SVG's cubic `C` — and quadratics, the `S`/`T` shorthands and elliptical arcs are converted exactly. |
| **Drew into an Inkscape layer** | The new shape lands on the Visio layer of the same name, if the drawing has one. |
| **Moved or turned a shape** | Its Pin/Angle/Flip cells, which is exactly what a move or a turn is in Visio. This works whether your editor moved the shape by giving it a transform or by rewriting all of its coordinates — every coordinate shifting by the same amount is read as a move, not as a redrawn outline. |
| **Dragged a point of a shape** | That one row's `X`/`Y` (or a bezier's `A`/`B`/`C`/`D`) and nothing else. |

Cancel and the drawing opens exactly as it was exported, edits ignored.

**Changes to an existing shape are written as cells, never as a replacement
outline.** This matters more than it sounds. A shape's rendered path is a lossy
view of its Visio geometry: rows inherited from a master, coordinates driven by
formulas, an outline expressed as fractions of the shape's own Width. Importing
the drawn path wholesale would flatten a parametric shape into a dumb one that
happens to look the same today and stops resizing properly tomorrow. So:

- a row your shape **inherits from a master** gains an override holding *only*
  the cell that changed — everything else it inherits, it goes on inheriting;
- a coordinate Visio wrote as **`Width*0.6`** stays a proportion. Drag it and it
  becomes `Width*0.72`, not the number that happened to equal today;
- anything else formula-driven is **refused with a reason**, because replacing a
  formula with its current answer looks like nothing changed and quietly breaks
  the shape.

And three kinds of edit are reported rather than guessed at, because there is no
honest cell to write them to:

- **points added to or removed from an outline** — there is no geometry row to
  attribute them to;
- **scaling or skewing a shape** — Visio's shape transform is a pin, an angle
  and two flip flags; it has no scale and no skew. Resize it
  [here](#moving-resizing-and-turning-shapes-select) instead;
- **an outline drawn from arcs, splines or NURBS**, where a single number on the
  page does not come from a single cell.

Two more things it declines to convert rather than get wrong:

- **`<text>`, `<image>` and `<use>`** are reported as skipped rather than
  imported. Text belongs on a Visio shape, not in geometry.
- **An SVG whose shape ids have been stripped** — by Inkscape's *Optimised SVG*
  output, say, or by an SVG minifier — is refused outright. With no ids there is
  no way to tell a deletion from a file that simply never had them, and the
  wrong answer deletes the drawing. You get told why, and the embedded drawing
  opens untouched.

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
