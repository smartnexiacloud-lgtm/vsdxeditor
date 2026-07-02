# Version-controlling `.vsdx` files with git

A `.vsdx` is an OPC package — a ZIP full of XML. Out of the box git treats it as
an opaque binary: `git diff` prints *"Binary files differ"* and a merge of two
edited copies fails as an unmergeable binary conflict.

This repo ships tooling (`scripts/vsdx-serialize.mjs`) that makes `.vsdx`
tractable for git:

- **`git diff` / `git show` / `git log -p`** render the canonical XML instead of
  "Binary files differ" (a git **textconv**).
- **`git merge`** performs a real 3-way merge on the drawing's XML (a git
  **merge driver**), so non-overlapping edits combine automatically and only
  genuine conflicts stop you.

Both work because the tooling **canonicalizes** the package deterministically —
sorted attributes, a fixed timestamp, sorted ZIP entries, fixed compression — so
re-saving the same drawing yields the same bytes. Without that, ZIP timestamps
and attribute ordering churn would drown any real change in noise.

## One-time setup (per clone)

For security, git does not let a repository's `.gitattributes` specify the
command a diff/merge driver runs — you register it locally, once:

```bash
npm install                 # deps: jszip, @xmldom/xmldom
npm run vsdx:install-difftool
```

That command writes to your local `.git/config`:

```ini
[diff "vsdx"]
    textconv = node scripts/vsdx-serialize.mjs textconv
    binary = true
[merge "vsdx"]
    name = deterministic vsdx 3-way merge
    driver = node scripts/vsdx-serialize.mjs merge %O %A %B %P
```

The repo's `.gitattributes` already routes `.vsdx` to these drivers:

```
*.vsdx diff=vsdx merge=vsdx
```

## Readable diffs

Once set up, the ordinary git commands just work on `.vsdx` files:

```bash
git diff                          # canonical-XML diff of unstaged changes
git diff master...HEAD -- *.vsdx  # what a branch changed in its drawings
git show HEAD:drawing.vsdx        # the committed file as canonical XML
git log -p -- drawing.vsdx        # history as XML diffs
```

The textconv is **read-only** — it changes how git *shows* the file, not how it
*stores* it. The blob in the repository is still the original `.vsdx`.

## Merging

With the merge driver registered, merges and rebases 3-way-merge `.vsdx` files
automatically:

```bash
git merge other-branch
```

- **No overlap** (each side edited different shapes/cells) → merged cleanly, the
  result is a valid, byte-stable `.vsdx`.
- **Overlap** (both sides changed the same lines) → git marks the file
  conflicted (`UU` in `git status`) and the driver prints how to resolve it.

Because a repacked `.vsdx` with conflict markers embedded in its XML can't be
reopened in Visio, on conflict the driver also **unpacks the merged tree** to a
sibling directory for hand-editing:

```
vsdx merge: CONFLICT in drawing.vsdx (1 part(s)):
    text          visio/pages/page1.xml
  Resolve the markers in:  drawing.vsdx.merge/
  then repack + stage:     node scripts/vsdx-serialize.mjs pack drawing.vsdx.merge drawing.vsdx && git add drawing.vsdx
```

To resolve:

1. Edit the marked file(s) under `drawing.vsdx.merge/` — remove the
   `<<<<<<< / ======= / >>>>>>>` markers, keeping the content you want.
2. Repack and stage:
   ```bash
   node scripts/vsdx-serialize.mjs pack drawing.vsdx.merge drawing.vsdx
   git add drawing.vsdx
   rm -rf drawing.vsdx.merge
   git commit          # or: git merge --continue
   ```

## CLI commands

`scripts/vsdx-serialize.mjs` also works standalone:

| Command | Purpose |
|---|---|
| `unpack <file.vsdx> <dir>` | Explode a package into its canonical OPC tree (for tree-level review or manual merges). |
| `pack <dir> <out.vsdx>` | Re-zip a tree into a deterministic `.vsdx`. |
| `verify <file.vsdx>` | Prove the round-trip is idempotent and re-packs to identical bytes. |
| `textconv <file.vsdx>` | Dump the whole package as one readable text stream (used by `git diff`). |
| `merge %O %A %B %P` | 3-way merge driver (used by `git merge`). |

npm shortcuts: `npm run vsdx:unpack`, `vsdx:pack`, `vsdx:verify`.

## Caveats

- **Diffs/merges are only as clean as ID stability allows.** The canonicalizer
  removes serialization churn (ordering, timestamps, whitespace), but if Visio
  itself renumbers shape or layer IDs on save, those changes will still show up.
- **Textconv is read-only.** For content you want to merge or review at the file
  level, `unpack` to a tree, work there, and `pack` back.
- Extraction refuses ZIP entries whose paths escape the output directory
  (Zip Slip–safe).
