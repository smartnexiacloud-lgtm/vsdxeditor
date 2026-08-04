# Embedding data that survives a Microsoft Visio round-trip

**Question:** if you write custom data into a `.vsdx`, does it survive being
opened and re-saved in the real Microsoft Visio desktop app?

**Short answer:** only if the data maps to something in Visio's object model.
Visio re-serializes the whole package from memory on save, so it keeps native
data (Shape Data, document properties) and its own **Solution XML** store, and
**discards everything else** — including standard OOXML `customXml` parts,
unreferenced parts, and incidental XML like comments.

This matters for this project: it's *why* "Export SVG" embeds the source drawing
for our **own** round-trip (see [usage.md](usage.md#exporting)) rather than
relying on Visio to preserve a stashed blob. If you ever want data to survive a
detour through Visio itself, use the Solution XML channel documented below.

## The experiment

A `.vsdx` is an [OPC](https://en.wikipedia.org/wiki/Open_Packaging_Conventions)
ZIP package (like `.docx`/`.xlsx`): `[Content_Types].xml`, a `_rels/`
relationship graph, and parts under `visio/`. We planted six uniquely-tokenised
markers in six different locations, opened the file in Microsoft **Visio 16.0**
(the 2016/2019/2021/365 desktop app), saved it, and checked which tokens
remained in the bytes.

## Results

| Marker location | Kind | Survived? |
| --- | --- | --- |
| Shape **Property** row (`visio/pages/pageN.xml`) | Native Shape Data | ✅ **yes** |
| `docProps/custom.xml` `<property>` | Document custom property | ✅ **yes** |
| `visio/solutions/solution1.xml` via a `solutionxml` relationship | Visio Solution XML store | ✅ **yes, byte-intact** |
| `customXml/item1.xml` (+ `customXmlProps` rel) | Standard OOXML custom XML part | ❌ **dropped** |
| `vsdxtest/sidefile.txt` (valid part, no relationship) | Unreferenced OPC part | ❌ **dropped** |
| XML comment inside `visio/document.xml` | Incidental markup | ❌ **dropped** |

### The rule

**Visio keeps only what maps to a slot in its object model.** On save it rebuilds
the package from its in-memory document, so:

- **Native data survives** — Shape Data (`Prop.*` / `User.*` cells) and document
  custom properties are first-class, so they round-trip perfectly *and* stay
  user-visible/editable.
- **The Solution XML store survives.** A part referenced by a relationship of
  type
  `http://schemas.microsoft.com/visio/2010/relationships/solutionxml`
  is Visio's sanctioned add-in persistence channel. In the test the part came
  back **completely intact** — arbitrary content, a made-up
  (`urn:vsdxtest:solution`) namespace, even the relationship id we chose were all
  preserved. This is the reliable slot for an arbitrary blob (base64-encode it
  into the part).
- **Everything else is discarded.** An unreferenced part is dropped by the
  reachability rule; an XML comment is lost to reserialization; and — the
  important gotcha — a **standard OOXML `customXml` part is dropped too**. Even
  though Word and Excel faithfully preserve `customXml`, Visio has no slot for it
  and throws away both the part and its relationship. Do **not** assume "it's
  valid OOXML, so Visio keeps it."

## How this app uses it

This finding is not academic — it backs two features.

**Layer tags** ([usage.md](usage.md#layer-tags)) attach free-form labels, and a
colour per label, to layers. Visio's layer object model has no tag slot — an
extra `Cell` in a `Layer` row is dropped the moment Visio re-serializes the page
— so the labels go into `visio/solutions/vsdxeditor-layer-tags.xml`, wired with
the `solutionxml` relationship. Layers are keyed by name rather than index, so
tags stay attached across Visio renumbering. See `readVsdxLayerTags` and
`writeLayerTagsToZip` in `src/vsdx-parser.js`; `scripts/test-layer-tags.mjs`
asserts both the wiring and survival of a package rebuild that keeps only
relationship-reachable parts.

**Named views**
([usage.md](usage.md#named-views-layer-presets)). Each named view is a per-page
snapshot of layer visibility, and it's persisted into the drawing as a
`visio/solutions/vsdxeditor-views.xml` part wired with the `solutionxml`
relationship. That's precisely the channel proven above to survive a Visio
re-save, so a team's named views travel with the file and keep working even
after someone edits the drawing in the real Visio desktop app. The payload is
base64-encoded JSON inside a `<SolutionXML>` element. See
`readVsdxViewTemplates` / `saveVsdxLayerPermissions` in `src/vsdx-parser.js`.

## Practical guidance

- **Want an arbitrary blob to survive Visio edits?** Put it in a
  `visio/solutions/<name>.xml` part wired with a `…/relationships/solutionxml`
  relationship from `visio/document.xml.rels`. Base64-encode binary payloads.
- **Want structured, user-facing data?** Use native Shape Data or document
  custom properties.
- **Don't** rely on extra ZIP entries, `customXml` parts, or XML comments — Visio
  strips them on the first save.
- **No byte-identical round-trip.** Visio normalises the entire package, so you
  can only guarantee *your specific data* survives, never the original packaging.

## Reproducing

The check is just: plant tokens → open+save in Visio → grep the saved bytes.

```bash
# every surviving token still greps out of the re-saved package:
for m in shapedata docprop customxml solution sidefile xmlcomment; do
  n=$(unzip -p resaved.vsdx | grep -a -c "TOKEN-$m")
  [ "$n" -gt 0 ] && echo "SURVIVED $m" || echo "DROPPED  $m"
done
```

Tested with Microsoft Visio 16.0 (`docProps/app.xml` → `AppVersion 16.0000`).
Behaviour can differ across Visio versions — re-verify on your target if it
matters.
