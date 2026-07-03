#!/usr/bin/env node
// One-time, per-clone setup of the git integration for .vsdx files. Registers:
//   - a diff textconv driver  → readable canonical XML instead of "Binary files differ"
//   - a 3-way merge driver     → real merges instead of always-conflict
//   - a visual difftool + `git vsdxdiff` alias → opens the browser overlay/side-by-side diff
// git can't ship these commands in .gitattributes (security), so we set them locally here.
import { execFileSync } from 'node:child_process';

// Resolve the repo root at diff/merge time so the config is clone-location agnostic.
const repoScript = '"$(git rev-parse --show-toplevel)/scripts';

const config = [
  // Readable `git diff` on .vsdx (textconv) — see .gitattributes: *.vsdx diff=vsdx
  ['diff.vsdx.textconv', 'node scripts/vsdx-serialize.mjs textconv'],
  ['diff.vsdx.binary', 'true'],
  // Real 3-way `git merge` on the canonical part tree — *.vsdx merge=vsdx
  ['merge.vsdx.name', 'deterministic vsdx 3-way merge'],
  ['merge.vsdx.driver', 'node scripts/vsdx-serialize.mjs merge %O %A %B %P'],
  // Graphical `git difftool` → browser visual diff, plus a convenience alias.
  ['difftool.vsdxvisual.cmd', `node ${repoScript}/git-difftool-serve.mjs" "$LOCAL" "$REMOTE" "$MERGED"`],
  ['alias.vsdxdiff', 'difftool --no-prompt -t vsdxvisual'],
];

for (const [key, value] of config) {
  execFileSync('git', ['config', key, value], { stdio: 'inherit' });
}

console.log(`git vsdx integration configured:
  • git diff  — readable XML for .vsdx (textconv)
  • git merge — deterministic 3-way merge for .vsdx
  • git vsdxdiff <file.vsdx>   — open the visual diff in your browser
    (also: git vsdxdiff <rev> -- <file.vsdx>, git vsdxdiff <revA> <revB> -- <file.vsdx>)`);
