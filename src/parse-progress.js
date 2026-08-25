// Saying how far along a parse is, to whoever asked.
//
// Opening a large drawing is seconds of unzipping, parsing and drawing, all of
// it on the one thread that would otherwise be painting. Nothing about that is
// visible from outside, so the window simply stops answering and a load that is
// working looks like a hang.
//
// The parsers therefore take an optional `onProgress` and call it as they go.
// The one thing that makes this worth anything is that they *await* it: a
// callback that only set the width of a bar would never be seen, because the
// thread that would paint the bar is the thread inside the parse. Awaiting lets
// the caller hand back a promise it resolves after a frame, which is the only
// moment the browser gets to draw. A caller with nothing to draw just returns
// nothing and pays a microtask.
//
// Reporting is never allowed to cost a drawing: a callback that throws is
// ignored, and no callback at all costs a single closure per parse.

const NOOP = async () => {};

/**
 * Wraps `onProgress` into `report(stage, done, total, overall)`.
 *
 * `stage` names the phase ('unzip', 'masters', 'pages', …); `done` and `total`
 * count within it, and `done` is what is *finished*, so a stage opens at 0 and
 * the stage after it is what says the last item is in.
 *
 * `overall` is how far through the *whole* read this is, 0 to 1. It comes from
 * the parser rather than from whoever is drawing it, because only the parser
 * knows there are 133 masters and one page — a bar that weighted its phases by
 * guesswork would crawl through the part that takes the time and then leap
 * through the part that does not.
 */
export function progressReporter(onProgress) {
  if (typeof onProgress !== 'function') return NOOP;
  return async function report(stage, done = 1, total = 1, overall = 0) {
    try {
      await onProgress({ stage, done, total, overall });
    } catch {
      // A progress bar that fails is a progress bar that fails. The drawing
      // being read has nothing to do with it and is not going to be lost over it.
    }
  };
}
