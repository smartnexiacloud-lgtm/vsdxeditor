# Download

VSDX Viewer needs **nothing installed** — just open the [live app](app.html) in
any modern browser. Everything runs client-side; your files never leave your
machine.

For **offline** use, download a portable build below.

## Portable (offline) builds

Each portable build is the whole app inlined into **one self-contained
`vsdxeditor.html`** file — no installer, no network access, no dependencies. It
has the same features as the live app.

Grab the latest from the **[Releases page ↗](https://github.com/smartnexiacloud-lgtm/vsdxeditor/releases/latest)**:

| Platform | File | How to run |
| --- | --- | --- |
| **Windows** (win32 / x64) | `vsdxeditor-portable-win-<version>.zip` | Unzip, then double-click **`Open VSDX Editor.bat`** (or just open `vsdxeditor.html`). |
| **Linux** | `vsdxeditor-portable-linux-<version>.zip` | Unzip, then run **`./open-vsdx-editor.sh`** (or open `vsdxeditor.html`). |

Each zip contains:

- `vsdxeditor.html` — the entire app in a single file,
- a small launcher that opens it in your default browser,
- a `README.txt`.

> The portable build is the **web app**, bundled offline. The git integration
> below is a separate Node-based toolchain you install into a repository — it is
> not part of the portable HTML.

## Build it yourself

```bash
npm install
npm run package:portable   # writes the zips to dist-portable/
```

`npm run build` alone produces a static `dist/` (the site + the app at
`app.html`) you can host anywhere.

## Using `.vsdx` with git

`.vsdx` files are ZIP archives, so git treats them as opaque binaries by
default — every change is *"Binary files differ"* and merges always conflict.
This repo ships a toolchain that fixes both.

### The `.gitattributes` mapping

A repository opts in by mapping the extension to the `vsdx` diff and merge
drivers in its `.gitattributes`:

```gitattributes
# Readable canonical-XML diffs instead of "Binary files differ",
# and a real 3-way merge on the canonical part tree instead of a binary conflict.
*.vsdx diff=vsdx merge=vsdx
```

That file only *names* the drivers — for security, **git never runs commands
shipped inside `.gitattributes`**. You register the actual commands once, per
clone:

```bash
npm run vsdx:install-difftool   # registers the diff / merge / difftool commands locally
```

After that:

```bash
git diff drawing.vsdx           # readable canonical-XML diff in the terminal
git vsdxdiff drawing.vsdx       # visual diff (overlay + side-by-side) in the browser
git merge other-branch          # real 3-way merge of .vsdx files
```

See the full **[git guide](vsdx-with-git.html)** for setup, readable diffs,
merging, and conflict resolution.
