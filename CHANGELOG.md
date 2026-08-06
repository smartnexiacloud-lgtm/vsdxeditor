# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Edit an exported SVG somewhere else and bring the edits back.** Exported
  SVGs carry the whole drawing as embedded metadata, so re-opening one always
  round-tripped perfectly — including round-tripping away everything you had
  done to it in between. Opening an edited SVG now compares the picture against
  the drawing inside it and offers to apply what it finds:
  - **shapes you deleted** — every shape's group carries its Visio id, so an id
    the picture no longer has is a shape that was deleted (deleting a group in
    Inkscape takes its children's ids with it, which reads correctly as deleting
    the group);
  - **shapes you drew** — any `path`, `rect`, `circle`, `ellipse`, `line`,
    `polyline` or `polygon` sitting outside every shape group becomes a real
    Visio shape, geometry, fill, stroke, dash and all. Curves come through as
    `RelCubBezTo` rows rather than being flattened, because that row *is* SVG's
    cubic `C`; quadratics, `S`/`T` shorthands and elliptical arcs are converted
    exactly (arcs to within 0.02% of their radius), and a path drawn into an
    Inkscape layer lands on the Visio layer of the same name;
  - **shapes you changed** — a shape you moved, turned or whose points you
    dragged. The page is re-rendered from the embedded document and compared
    with the file you bring back, and the difference is written as *cells*, not
    as a replacement outline: a changed transform becomes Pin/Angle/Flip, every
    coordinate moving together becomes a move rather than a rewrite of every
    row, and one dragged point becomes that row's X/Y (or a bezier's A/B/C/D)
    and nothing else. A row inherited from a master gains an override holding
    only the cell that changed, so everything else it inherits it goes on
    inheriting, and a coordinate Visio wrote as `Width*0.6` stays a proportion —
    it is rewritten as `Width*0.72`, not replaced by the number it happened to
    equal. Points *added to* or *removed from* an outline, a scale or a skew,
    and a coordinate driven by a formula that is not a plain proportion are all
    reported with a reason instead of being approximated.

  Nothing is applied without being asked first, and the dialog says what it
  found. An SVG whose shape ids have been stripped (by an "optimised SVG"
  export, say) is refused outright rather than read as *everything was
  deleted*.
- **Collapse all, Expand all and Collapse unselected on the Shape Tree**, and
  **Collapse unselected** on the layer tree. Tidying a drawing where everything
  is inside a group used to be one click per group. *Collapse unselected* folds
  everything except the way down to the shape (or layer) you are working in.
  Fixed alongside it: the Shape Tree reopened the branch holding the selected
  shape on *every* redraw, so folding the branch you were in came undone the
  moment anything else changed. It now reveals a shape when you select it and
  leaves your folding alone after that.
- **Exported SVGs have real layers.** The export used to tag each shape with a
  `data-layers` attribute, which no SVG editor reads: opening the file gave one
  flat pile of paths and an empty layer panel. Shapes are now grouped into
  `inkscape:groupmode="layer"` containers named for the Visio layers they are
  on, and a layer switched off in the app comes out as a hidden *group* rather
  than a pile of individually hidden shapes — so the eye in Inkscape's layer
  panel is a real toggle. A Visio layer is a property of a shape while SVG's
  paint order *is* document order, so collecting a layer's shapes together can
  restack the drawing; that is only done where it provably cannot show (every
  pair of shapes that swapped has disjoint bounding boxes). Where it would, the
  layer is emitted as several groups in the original order — an uglier layer
  panel, but the picture Visio draws.
- **The parser says where each geometry row came from.** It used to answer only
  *what does this shape draw*: the master's rows and the shape's own rows were
  flattened into one effective list of numbers, which is everything the renderer
  needs and nothing an editor can use. Each row now also carries the Geometry
  section's `IX`, its own `IX`, whether it lives on the shape, on the master or
  is a shape row overriding a master row, which cells the shape's own row
  actually holds, and the **formula** behind each cell. That last one matters
  because reading only the computed value cannot tell a coordinate someone typed
  from the current answer to `Width*0.5` — and overwriting the second kind with
  a number silently de-parametrises the shape, which is the whole point of a
  Visio master. This is groundwork for editing a path's points; nothing about
  what is drawn has changed, and the visual diff explicitly ignores it, so the
  same outline reached two different ways is still not a difference.
- **A Select tool, and shapes you can actually push around.** There was a pen
  but nothing to pick things up with: a press on a shape panned the canvas, and
  the only way to move anything was to edit its XML. **Select** now sits beside
  **Pen** in the toolbar, and the selected shape carries eight resize handles
  and a rotation grip:
  - **drag the shape** to move it (grab an unselected shape and it selects and
    moves in one gesture; a whole multiple selection drags together),
  - **drag a handle** to resize — corner handles change both axes, edge handles
    one, **Shift** keeps the proportions,
  - **drag the grip** to turn it, **Shift** snapping to 15°.

  Handles sit on the shape's *own* box, so a shape turned 30° gets handles
  turned 30° with it and resizing runs along its own axes. What follows the
  pointer is an outline, not the drawing: the shape is edited once, when the
  mouse comes up, so a drag is one durable edit that survives *Save Visio*
  rather than a hundred. Dragging a group takes its contents with it, and
  resizing one scales them with it. It all works on a shape nested three groups
  deep, because the cells are worked out through the same matrix chain the
  renderer walks. A connector is drawn between its endpoints rather than placed
  by its pin, so it says so instead of pretending to move.
- **The Shape Tree walks under the arrow keys.** A page is thirty rows called
  `Shape.7`, `Shape.8`, `Shape.9`, which is not a list anyone wants to hunt
  through with a mouse. **↑/↓** step through the rows you can see, **→** opens a
  group and then walks into it, **←** closes it and then climbs back out,
  **Home/End** and **PgUp/PgDn** go further at once, **Space** shows or hides
  the row's shape and **F2** renames it. The cursor is deliberately not the
  selection — moving it only draws the same box hovering a row does, so you can
  walk a drawing watching the canvas without disturbing what you had selected —
  and **Enter** is what commits it. The tree is a single tab stop rather than
  six buttons per row.
- **Delete shapes.** There was no way to, short of hiding them or pruning a
  whole layer. Select one or several and **Delete** appears with the other
  arrange actions in the right-click menu; the **Delete** and **Backspace**
  keys do the same, except while the pen tool has them or you are typing in a
  box. Deleting a group deletes what is inside it, and any connector glued to
  something that goes is unglued rather than left pointing at a shape that no
  longer exists. It is a real edit to the drawing, so it survives *Save VSDX*.
- **The Shape Tree lists the page.** It used to open on the selected shape's
  *parent group*, so selecting a shape that was not in a group gave a tree of
  exactly one row: every row you could click was the row already selected,
  which is indistinguishable from clicking rows doing nothing. It now shows
  every shape on the page, nested, with the selected one marked and its
  branches opened. Hovering a row draws a box round that shape on the canvas,
  its tooltip carries the shape's own text (often the only thing that tells
  `Shape.8` from `Shape.9`), and right-clicking a row opens the same menu the
  canvas does — rename, edit XML, send to a layer, arrange, delete.
- **The Layers pane splits where you want it to, not where the stylesheet
  said.** Its width was already yours to drag; the division between the tool
  sections at the top and the list of layers below was not, so opening Filter,
  Find and Grouping at once left the list a sliver. There is now a handle
  between the two. Until you touch it the split is automatic, exactly as
  before — the tools take what they need and the list takes the rest. Drag it
  and the split is pinned, so folding a section open or shut no longer moves
  it; it cannot be dragged so far that the list has no room, nor past what the
  tools actually fill, and a window that shrinks re-clamps it rather than
  leaving no list at all. Double-click the handle to go back to automatic.
- **Export at a size other programs can cope with.** A drawing is rendered in
  its own units, 96 to the paper inch, so a large one is tens of thousands of
  units across. SVG is resolution independent and does not care; the software
  you hand the file to does — browsers give up rasterising past ~32767px,
  Inkscape's PDF export garbles it, and **a PDF page cannot exceed 200in
  (14400pt) per side at all**, which is a limit in the format rather than a
  viewer bug. **Export…** now opens a dialog offering *Original size*,
  *Viewer-safe* (longest side 19200px — the largest a PDF page can legally be),
  *Screen* (4096px), or a custom longest side. Rescaling costs nothing: only the
  root `width`/`height` change, the `viewBox` and every coordinate are left
  exactly as they were, so it is the same vector drawing at full precision
  merely labelled with a size ordinary software can handle. The presets are
  ceilings and never magnifiers, so a drawing already inside the limit exports
  untouched, and the dialog opens on *Original size* unless the drawing is too
  big for a PDF page. Exports also carry a real intrinsic size now — the
  on-screen SVG says `width="100%"`, which in a file means "100% of nothing" and
  leaves every program to invent its own answer.
- **PDF export**, via jsPDF and svg2pdf.js fetched on demand and **pinned by
  SHA-256**. Writing a PDF from scratch would mean font subsetting, and half a
  megabyte of dependency for a feature most sessions never touch is the wrong
  trade for an app you can run off a USB stick — so nothing is downloaded until
  you choose PDF and tick *Allow this download*, and the bytes are checked
  against a digest in the source before a single line of them runs. A CDN that
  is compromised, MITM'd, typosquatted or that quietly republishes a version
  fails the check, nothing executes, and the dialog names the library and shows
  both digests. The libraries are held in memory only, so they are re-fetched
  and re-verified next session. The dialog lists the exact URLs and digests
  before you agree, and `npm run test:pdf-live` checks the pinned digests
  against what the CDN actually serves. The page comes out in the drawing's
  own orientation — jsPDF reorders `format` to agree with `orientation`, so a
  wide drawing asked for a portrait page would be rendered off the edge of it.
- **Export a plain SVG.** *Embed the source Visio document* is a checkbox now;
  untick it for a much smaller SVG that will not re-open in this app.
- **Undo what you just hid.** **Ctrl+Z** takes back the last change to which
  layers are shown, **Ctrl+Shift+Z** (or **Ctrl+Y**) puts it back. *Hide all* is
  one click and undoing it by hand was one click per layer, which is the wrong
  trade. Visibility is a small, self-contained piece of state — the set of
  hidden layers — so the history is a stack of those sets rather than a general
  command history: it covers single toggles, the bulk buttons, a group's
  checkbox and applying a named view, and nothing else. It is per page, because
  restoring one page's visibility onto another would be nonsense, and inside a
  text box the browser's own undo is left alone.
- **A resizable Layers pane, with its tools folded away.** Layer names are as
  long as their author made them and a fixed 240px pane truncated half of an
  `Electrical/HV/Feeders` tree, so the pane's right edge now drags (double-click
  it to fit the longest row). Filtering layers, finding shapes, choosing a
  delimiter, named views and tags are each occasional, so each is a section that
  starts folded and opens on its heading — the list of layers is what the pane
  is for. A folded heading still says what it is doing (`"pump"`, `on · /`), so
  a filter left on is never a drawing that mysteriously lost its layers.
- **One menu per layer row.** A row is its name, its checkbox and its tags;
  everything else it can do is on its menu, which a right-click opens as does
  the **⋯** at its end: **List shapes**, **Rename…**, **Move to group…**,
  **Edit tags…**, **Delete…**. The strip of ⊙ ✎ 🏷 🗑 icons that used to sit on
  every row is gone, and the name has that width back. On a group row every
  entry speaks for the whole subtree, *List shapes* included — that lists every
  shape on every layer under the group, each shape once however many of those
  layers it is on, which is the only way to ask "what is in Electrical?" when
  Electrical is a naming convention rather than a layer.
- **Finding a shape now says which layer it is on.** Picking a shape from the
  search results, from a layer's object list or from *Select component*
  highlights the row for its layer in the Layers sidebar — clearing a filter and
  expanding any collapsed groups that were hiding that row, because a row that
  is not drawn cannot be pointed at. "Where is it?" has two answers and the
  second one is the one that says whether you can even see it.
- **Rename a shape from the Shape Tree row.** Every row has a **✎**; the
  double-click that was supposed to do this never landed, because the click that
  selected the row redrew the tree and the second click hit a different element.
  Selecting a shape that is already selected no longer redraws anything, so the
  double-click works too.

- **Group layers into a tree by a delimiter.** Visio's layer model is flat, but
  drawings fake a hierarchy in the *name* — `Electrical/HV`, `Electrical/LV`.
  **Group by delimiter** in the Layers sidebar reads that convention back out
  and nests the rows accordingly, with a collapsible row per prefix, a
  collapse/expand-all button, and a per-group checkbox that shows or hides
  everything under it (tri-state when only part of the group is showing). The
  delimiter is yours to pick — `/`, `.`, `::`, anything — and is matched
  literally rather than as a pattern; emptying the box just returns the list to
  flat, as does unticking the box.

  **Moving a layer is renaming it**, because the name *is* the path — nothing in
  the file records where a layer sits. Every row, group or layer, offers a
  **Rename…** that edits the full path it stands for: retype `Electrical/HV` as
  `Plumbing/HV` and the layer moves, as `HV` and it moves out to the top level.
  On a group row the same edit re-prefixes every layer beneath it, so renaming
  `Electrical` to `Site/Power` moves the whole subtree; only the part of each
  name the row accounts for is replaced, so anything nested below keeps its
  suffix and travels along. Merging one group into another is allowed; a rename
  that would leave two layers on a page sharing a full name is refused, for the
  same reason creating a duplicate is. A row that is both a layer and a parent —
  `Electrical` next to `Electrical/HV` — renames itself and its children
  together. With grouping off it is a plain rename, which is also the first way
  to rename a single layer from the sidebar rather than through the Layer
  Matrix's *Replace all*.

  No group is written to the file — the tree is derived from the layer names
  every time, and every layer keeps its own row and index. The *settings* do
  travel with the drawing: whether grouping is on, the delimiter, and which
  groups were left collapsed are stored in a
  `visio/solutions/vsdxeditor-layer-tree.xml` Solution XML part, the same
  channel the named views and layer tags ride, so they survive a Microsoft Visio
  open+save and whoever opens the file next sees the tree its author saw. A
  drawing that was never grouped still opens flat.
- **Select several shapes, and arrange them.** Ctrl-click (or shift-click) adds
  a shape to the selection and drops it again — on the canvas, in *Select
  component*, in the shape search results and in a layer's object list. The
  selected shapes are outlined, solid for the one the rest of the panels are
  pointed at and dashed for the others. The right-click menu grows an **Arrange**
  section acting on the whole selection: **Group**, **Ungroup**, **Bring to
  front** and **Send to back**.

  Z-order in Visio *is* the order the `<Shape>` elements are written in, so
  front and back are a move among a shape's own siblings — a shape inside a
  group comes to the front of that group. Group and ungroup are a move too, but
  a shape's `PinX`/`PinY` are written in its *parent's* coordinates, so
  re-parenting one has to rewrite them by exactly the right amount or the
  drawing comes apart. Each shape's new Pin, Angle and flip flags are read back
  out of the matrix the renderer itself composes, which is exact rather than
  approximate: that matrix is only ever a translation, a rotation and a
  reflection, never a scale or a shear. Rotated and flipped shapes, and groups
  nested inside groups, come out where they went in.

  Two cases are refused rather than done badly. A **connector** is drawn in its
  parent's coordinates instead of its own, so grouping one would move it. And a
  **group that came from a master** cannot be dissolved: its parts read their
  size and geometry from that master through the group, and pulling them out
  would leave empty shapes behind — Visio's own ungroup breaks the master link
  and copies everything down, which is a much larger operation than moving
  elements about. Groups you made yourself have no master and ungroup fine.
- **Find shapes by name, text, or ID.** A **Find shapes** box in the Layers
  sidebar searches the current page — name, `NameU`, shape text, or `#7` to
  search by ID on a prefix — and lists what it finds, groups and nested shapes
  included. Hovering a result draws a selection square around that shape on the
  canvas, which is the actual point: the list answers *where is it?* without
  changing anything. Clicking selects the shape and opens the Shape Tree on it,
  **Enter** takes the top match, **Esc** closes.

  The results share the panel a layer's own shape list already used, because
  both answer the same question with the same list, so opening one clears the
  other.
  Shapes on hidden layers stay listed and are marked `hidden` — a shape you
  cannot see is usually the one you are hunting for. Typing is debounced and the
  list stops at the first 300 matches, since re-walking a large page's shape
  tree on every keystroke costs more than it tells anyone.
- **Rename a shape from its right-click menu.** **Rename…** sets the shape's
  Visio name — its `Name`/`NameU`, the field Visio's own *Shape Name* dialog
  edits — so the Shape Tree, the *Select component* list and the diff report all
  call it `Feeder cable` instead of `Shape.7`. The prompt starts from the name
  it has now, and a blank answer clears it. Renaming was already possible by
  double-clicking a row in the Shape Tree; the canvas is where you are when you
  notice the name is wrong, so it is offered there too. Like every other edit,
  it lives in memory until you **Save VSDX**.
- **A right-click menu on layer rows.** The row buttons are deliberately faint
  until hovered, which is fine for the one action a row is mostly used for and
  poor for the rest — so right-clicking a row (layer or group) names them
  instead: **Rename…**, **Move to group…**, and **Edit tags…**. *Move to group…*
  is a rename with the layer's own name held fixed — it asks only which group to
  put it in, and a blank answer moves it out to the top level. On a group row
  every entry speaks for the whole subtree, and *Add tags to N layers…* adds the
  tags you type to each layer under the group without disturbing the tags they
  already carry.
- **Add and remove layers.** The Layers sidebar has an add-layer button, each
  layer row a **Delete…** on its menu, and a shape's right-click menu can
  create a layer and file the shape onto it in one step — the common case after
  drawing something with the pen. Deleting a layer never deletes its drawing:
  shapes on it stay, and any left on no layer at all show up under the
  editor-only **Unlayered** row, where *Send Object To Layer* can file them
  again. The confirm prompt says how many shapes are involved before you commit.

  A layer only exists as a `Row` in the page's `Layer` section, and a shape's
  membership is that row's *index*, so indexes are never reused or shuffled: a
  new layer takes one past the highest (including past the unnamed placeholder
  rows Visio leaves behind when *it* deletes a layer), and deleting one leaves
  its index unused rather than renumbering the survivors and silently moving
  every shape. Clearing a shape's membership writes Visio's explicit empty
  `LayerMember` rather than dropping the cell, because dropping it lets the
  shape inherit its master's layers and land straight back where it was.
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
  and each layer in the sidebar offers a **List shapes** that lists every shape
  on it, nested shapes included. Hovering a row in either list draws a selection square
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
- **A large drawing could not be zoomed out far enough to see.** Fixing the
  zoom blur had a consequence nobody wanted: the SVG used to be laid out at
  `width: 100%` with its natural size as a maximum, so the browser quietly shrank
  a big drawing to the window and "100%" meant "as big as fits". Sizing the SVG
  in layout made 100% mean 100% — and a Visio drawing is not necessarily a sheet
  of paper. A site plan in this repo is **3962 × 2618 inches**, which is 380,372
  renderer pixels across and fits a window at 0.32%; against a zoom floor of 10%
  it simply could not be pulled back far enough, and **−** stopped doing
  anything. So the floor is now 0.02%, opening a page genuinely fits it to the
  window (rather than fitting by accident), **Fit** actually fits — including
  magnifying a drawing smaller than the window, which it never did — and the
  readout no longer rounds every one of those zooms to `0%`.
- **Zooming blurred the whole drawing until you moved.** Zoom was a `scale()`
  on the container, and scaling a composited layer does not redraw it — the
  compositor stretches the pixels it already has, which is why the picture went
  soft the moment the wheel moved and snapped back the moment you panned (a pan
  is what finally invalidated the layer). The scale now goes into the SVG's own
  layout size as soon as the gesture settles, so the browser draws the vectors
  at the size they are shown at. Vectors have no business being blurry at any
  zoom. Panning is still a transform, since a translate resamples nothing.
- **The export dialog showed options that did not apply.** It was hiding them —
  with the `hidden` attribute — but they were laid out with `display: flex`,
  and an author rule beats the browser's own rule for `hidden`. So every row the
  dialog thought it had folded away was on screen and fully usable: **Longest
  side** while you were exporting at original size or fit-to-screen, the SVG
  *embed the source document* checkbox while you were exporting a PDF (which
  cannot carry it), and the PDF library download consent while you were
  exporting an SVG (which downloads nothing).
- **Selecting a shape behind another one looked like it had not worked.** The
  selection was drawn as an outline on the shape's own group, and an outline is
  painted where the shape is painted — so picking a buried shape out of *Select
  component* or the Shape Tree drew a marker the shape in front covered up. You
  moved the pointer off the row, the hover box went with it, and nothing
  appeared to be selected. The marker is now its own overlay, drawn last, so it
  is on top of the drawing whatever it is selecting.
- **The selection box was drawn round the shape's geometry, not round the
  shape.** A shape's box is where its geometry lives, and the ink is not
  confined to it: put a 50pt stroke on a short path and most of the shape ends
  up outside the box that is supposed to contain it. The box now comes from
  where the browser actually drew the shape — stroke and all — and falls back
  to the geometric box only where there is nothing laid out to measure.
- **The Shape Tree's ✕ did not delete anything.** It removed the shape from the
  page held in memory, which looks identical on screen, and then *Save VSDX*
  patches the original package and skips shapes it no longer knows about — so
  the shape came back in the saved file. It goes through the package now, like
  every other edit. The row the tree opened on is deletable too; it was exempt
  only because the old in-memory version had nowhere to put a tree with no root.
- **"Select component" missed shapes that were behind the one you clicked.**
  The list was built from one question — which shapes' bounding boxes cover
  this point — asked in page inches. That leans on the app's own screen→page
  transform being right, and on a box standing in for the shape, which it is
  not once a piece is rotated or L-shaped. When it came up short there was
  nothing to do but send the shape on top to the back and pick what was
  underneath, which is a workaround for a list that failed to offer it. The
  browser already knows the answer for what it drew: `elementsFromPoint`
  returns the whole stack at a point, completely covered entries included,
  hit-tested against the real outline with none of our arithmetic in the way.
  Both questions are now asked and the answers merged, deduplicated and put
  back in paint order. Where the browser has no such API, the box test still
  answers on its own, exactly as before.
- **Shapes on a background page could be seen but not picked.** A page that
  names a background page is drawn as that page's shapes with its own on top —
  the renderer has always merged the two. Everything that answered "what is
  under the cursor", though, asked the foreground page alone, so a title block
  or frame living on the backdrop was a shape you could see, right-click
  straight through, and never reach: *Select component* offered the shapes in
  front of it and nothing behind. The hit test now runs against the page as
  drawn. Backdrop shapes are listed and marked `background`, hover highlights
  them and clicking selects them; the rest of the menu then says the shape
  belongs to the background page instead of offering it one of this page's
  layers, whose numbering means nothing to it.

- **Closed sheet tabs came back when you pruned the drawing.** *Remove
  Non-selected* and *Remove Non-visible* pruned the file bytes as they were last
  parsed, then re-read the result — so every page you had closed, every sheet
  you had renamed or reordered, and any tag colours or named views you had not
  saved came back with it. Both now prune the package with your pending edits
  already written into it, the same step the pen, arrange and XML-edit paths
  already took.
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
