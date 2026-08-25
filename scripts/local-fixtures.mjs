// Drawings that live beside the repo rather than in it.
//
// Some checks want a real, complicated drawing: hundreds of shapes, layers that
// overlap, geometry the small fixtures in test-files/ simply do not have. A
// drawing like that is usually somebody's actual work and has no business in a
// public repo, so the convention is a `local-fixtures/` directory that git
// ignores. Whatever is in it gets run through the checks that can use it; on a
// checkout that has none — CI, a fresh clone — those checks run on test-files/
// alone and say what they skipped rather than failing on a file nobody there
// could have.
//
// Nothing here, and nothing that calls it, names one of those drawings. The
// directory listing *is* the configuration, which is the point: a private
// file's name never reaches a tracked file, so it cannot be published by
// reading the test suite either.

import { readdirSync } from 'fs';
import { join } from 'path';

export const LOCAL_FIXTURE_DIR = 'local-fixtures';

// Every Visio format the app opens, drawings and stencils and templates alike.
const DRAWING = /\.(vsdx|vsdm|vsd|vssx|vssm|vss|vstx|vstm|vst)$/i;

/**
 * The local drawings available in this checkout, sorted, or none.
 *
 * Sorted because a check that runs in whatever order the filesystem hands back
 * is a check that reports differently on two machines holding the same files.
 */
export function localFixtures() {
  try {
    return readdirSync(LOCAL_FIXTURE_DIR)
      .filter(name => DRAWING.test(name))
      .sort()
      .map(name => join(LOCAL_FIXTURE_DIR, name));
  } catch {
    // No directory at all is the normal case, not an error: it is what every
    // clone of this repo looks like.
    return [];
  }
}

/** What to print when a check had no local drawing to run on. */
export function noLocalFixtures(what) {
  return `  skipped ${what} — no drawings in ${LOCAL_FIXTURE_DIR}/ (this checkout has none)`;
}
