// PDF export, via jsPDF + svg2pdf.js fetched on demand and pinned by hash.
//
// Writing a PDF from scratch would mean font subsetting, so this borrows two
// well-tested libraries instead — but they are ~500KB that the overwhelming
// majority of sessions never touch, and this app otherwise ships as a single
// self-contained bundle you can run off a USB stick. So they are fetched
// lazily, only after the user explicitly asks for a PDF, and only after the
// bytes hash to a digest pinned in this file. A CDN that is compromised,
// typosquatted, MITM'd, or that quietly republishes a version fails the check
// and nothing executes.
//
// The digests below were taken from the npm-published artifacts and confirmed
// byte-identical across two independent CDNs (jsdelivr and unpkg).

export const PINNED_LIBS = [
  {
    name: 'jsPDF',
    version: '4.2.1',
    global: 'jspdf',
    file: 'jspdf.umd.min.js',
    url: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
    sha256: 'e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54',
  },
  {
    name: 'svg2pdf.js',
    version: '2.7.0',
    global: 'svg2pdf',
    file: 'svg2pdf.umd.min.js',
    // Must load after jsPDF: its UMD wrapper reads globalThis.jspdf and
    // registers the doc.svg() method onto jsPDF.API.
    url: 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.7.0/dist/svg2pdf.umd.min.js',
    sha256: '7c91b939405364524ccda0eafac0b42b456594504acfa7de0eac83d1b6347723',
  },
];

// A pinned script is a known size; anything wildly larger is a hostile or
// broken endpoint and there is no reason to buffer it before hashing.
const MAX_LIB_BYTES = 4 * 1024 * 1024;

export class IntegrityError extends Error {
  constructor(lib, actual) {
    super(`${lib.name} ${lib.version} failed its SHA-256 check — refusing to run it.\n` +
      `  expected ${lib.sha256}\n  actual   ${actual}`);
    this.name = 'IntegrityError';
    this.lib = lib;
    this.actual = actual;
  }
}

export function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(bytes, subtle) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // digest() wants a plain ArrayBuffer view; slice() also detaches us from any
  // pooled buffer the fetch may have handed back.
  return toHex(await subtle.digest('SHA-256', view.slice().buffer));
}

/**
 * Fetch one pinned library and return its source only if the bytes hash to the
 * digest recorded above. Throws IntegrityError otherwise.
 */
export async function fetchPinned(lib, { fetchImpl, subtle } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const crypt = subtle || globalThis.crypto?.subtle;
  if (typeof doFetch !== 'function') throw new Error('fetch is unavailable in this environment');
  if (!crypt) {
    throw new Error('SHA-256 is unavailable — Web Crypto needs a secure context (https:// or localhost)');
  }
  // Browsers can enforce this themselves via the fetch `integrity` option, but
  // a native failure surfaces as an opaque TypeError; hashing here lets us say
  // which library failed and what we actually got.
  const res = await doFetch(lib.url, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download ${lib.name} (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_LIB_BYTES) {
    throw new Error(`${lib.name} download was implausibly large (${bytes.length} bytes)`);
  }
  const actual = await sha256Hex(bytes, crypt);
  if (actual.toLowerCase() !== lib.sha256.toLowerCase()) throw new IntegrityError(lib, actual);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Run already-verified source in the page's global scope.
 *
 * Both bundles are UMD, so they look for `module`/`define` and otherwise
 * register themselves on globalThis — which is what we want. A blob: <script>
 * tag would work too, but it needs `script-src blob:` where this needs
 * `unsafe-eval`; neither is safer than the other once the bytes are pinned,
 * and this one is synchronous and observable, so a failure to define the
 * expected global is caught immediately rather than swallowed by onerror.
 */
export function runVerifiedScript(source, url, scope = globalThis) {
  const factory = new scope.Function(`${source}\n//# sourceURL=${url}`);
  factory.call(scope);
}

let loadPromise = null;

/** Drop the in-memory cache — used by tests, and after a failed load. */
export function resetPdfLibraries() {
  loadPromise = null;
}

/**
 * Download, verify and install jsPDF + svg2pdf.js, at most once per session.
 * Nothing here runs until a caller asks for it.
 */
export function loadPdfLibraries(options = {}) {
  const scope = options.scope || globalThis;
  if (scope[PINNED_LIBS[0].global] && scope[PINNED_LIBS[1].global]) return Promise.resolve(scope);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    for (const lib of PINNED_LIBS) {
      if (scope[lib.global]) continue;
      options.onProgress?.(`Fetching ${lib.name} ${lib.version}…`);
      const source = await fetchPinned(lib, options);
      options.onProgress?.(`Verified ${lib.name} ${lib.version}`);
      (options.run || runVerifiedScript)(source, lib.url, scope);
      if (!scope[lib.global]) {
        throw new Error(`${lib.name} loaded but did not register window.${lib.global}`);
      }
    }
    return scope;
  })();

  // A failed load must not poison every later attempt — a dropped connection
  // deserves a retry.
  loadPromise.catch(() => { loadPromise = null; });
  return loadPromise;
}

/**
 * Convert a live SVG element to a PDF blob at the given page size, in points.
 *
 * The element must be attached to the document: svg2pdf resolves styles and
 * measures text through getComputedStyle/getBBox, which only work in-tree.
 */
export async function svgToPdfBlob(svg, { widthPt, heightPt, scope = globalThis } = {}) {
  const jspdf = scope.jspdf;
  if (!jspdf?.jsPDF) throw new Error('jsPDF is not loaded');
  if (!(widthPt > 0 && heightPt > 0)) throw new Error('PDF page size must be positive');
  // jsPDF does not take `format` at face value: it forces width ≤ height for
  // 'portrait' and width ≥ height for 'landscape', swapping the pair if it
  // disagrees. Ask for the orientation the drawing already has, or a wide page
  // comes back tall and the drawing is rendered off the edge of it.
  const orientation = widthPt >= heightPt ? 'landscape' : 'portrait';
  const doc = new jspdf.jsPDF({ orientation, unit: 'pt', format: [widthPt, heightPt], compress: true });
  if (typeof doc.svg !== 'function') throw new Error('svg2pdf.js did not register jsPDF#svg');
  await doc.svg(svg, { x: 0, y: 0, width: widthPt, height: heightPt });
  return doc.output('blob');
}
