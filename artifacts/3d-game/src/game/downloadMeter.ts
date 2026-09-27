// Real download progress for files that a third-party loader fetches on its own (MediaPipe loads
// its wasm and model with fetch(), and its packed graph data with an XMLHttpRequest, and exposes no
// progress callback). While a meter is active, fetch() and XMLHttpRequest.prototype.open are
// wrapped so requests under the meter's URL prefix are observed:
//   - fetch: the response is cloned and the clone's body is read to count bytes. The caller gets
//     the original, untouched Response (so WebAssembly.instantiateStreaming still works on it).
//   - XHR: progress/load listeners are added with addEventListener, which never replaces the
//     loader's own `onprogress` handler.
// Every other request passes straight through. The wrappers are removed when the last meter stops.

/** Maps a requested file name onto a progress slot, or null to ignore it. */
export type DownloadSlotFor = (fileName: string) => string | null;

interface SlotState {
  loaded: number;
  total: number;
  done: boolean;
}

interface Meter {
  /** Absolute pathname prefix, e.g. "/mediapipe/hands/". */
  pathPrefix: string;
  slotFor: DownloadSlotFor;
  report: (slot: string, loaded: number, total: number, done: boolean) => void;
}

// A slot that hasn't finished never reads as fully loaded, even if its byte count reaches the
// expected size (the expected size is decoded bytes; a compressed transfer can overshoot or lag it).
const MAX_UNFINISHED_FRACTION = 0.99;

const meters = new Set<Meter>();
let originalFetch: typeof window.fetch | null = null;
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** The meters watching `url`, each paired with the slot it maps the file onto. */
function matchingMeters(url: string): { meter: Meter; slot: string }[] {
  let pathname: string;
  try {
    pathname = new URL(url, window.location.href).pathname;
  } catch {
    return [];
  }
  const matches: { meter: Meter; slot: string }[] = [];
  for (const meter of meters) {
    if (!pathname.startsWith(meter.pathPrefix)) continue;
    const slot = meter.slotFor(decodeURIComponent(pathname.slice(meter.pathPrefix.length)));
    if (slot) matches.push({ meter, slot });
  }
  return matches;
}

function meteredFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const pending = originalFetch!.call(window, input, init);
  const watchers = matchingMeters(requestUrl(input));
  if (watchers.length > 0) {
    // Registered before the caller's own `.then`, so the clone is taken before the body is used.
    pending.then(
      (response) => {
        if (!response.ok || !response.body) return;
        const reader = response.clone().body!.getReader();
        let loaded = 0;
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (value) loaded += value.byteLength;
            for (const { meter, slot } of watchers) meter.report(slot, loaded, 0, done);
            return done ? undefined : pump();
          });
        pump().catch(() => {
          // The caller's own read reports a real failure; the meter just stops counting.
        });
      },
      () => undefined,
    );
  }
  return pending;
}

function meteredXhrOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  const watchers = matchingMeters(typeof url === 'string' ? url : url.href);
  if (watchers.length > 0) {
    this.addEventListener('progress', (event) => {
      const total = event.lengthComputable ? event.total : 0;
      for (const { meter, slot } of watchers) meter.report(slot, event.loaded, total, false);
    });
    this.addEventListener('load', () => {
      if (this.status < 200 || this.status >= 300) return;
      for (const { meter, slot } of watchers) meter.report(slot, 1, 1, true);
    });
  }
  // `open` has overloads (async flag, credentials), so forward whatever the caller passed.
  return (originalXhrOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
}

function install() {
  if (originalFetch) return;
  originalFetch = window.fetch;
  originalXhrOpen = XMLHttpRequest.prototype.open;
  window.fetch = meteredFetch as typeof window.fetch;
  XMLHttpRequest.prototype.open = meteredXhrOpen as typeof XMLHttpRequest.prototype.open;
}

function uninstall() {
  if (!originalFetch || !originalXhrOpen) return;
  // Only unwrap if nothing else has wrapped these since.
  if (window.fetch === (meteredFetch as typeof window.fetch)) window.fetch = originalFetch;
  if (XMLHttpRequest.prototype.open === (meteredXhrOpen as typeof XMLHttpRequest.prototype.open)) {
    XMLHttpRequest.prototype.open = originalXhrOpen;
  }
  originalFetch = null;
  originalXhrOpen = null;
}

/**
 * Starts measuring downloads under `assetDir` (a URL or path, e.g. `${BASE_URL}mediapipe/hands/`).
 * `expectedBytes` lists every slot the load needs with its weight (its size in bytes), and
 * `onProgress` receives the overall 0..1 fraction whenever a watched request advances. Returns a
 * function that stops the meter.
 */
export function meterDownloads(
  assetDir: string,
  expectedBytes: Readonly<Record<string, number>>,
  slotFor: DownloadSlotFor,
  onProgress: (fraction: number) => void,
): () => void {
  const slots = new Map<string, SlotState>();
  const totalWeight = Object.values(expectedBytes).reduce((sum, bytes) => sum + bytes, 0);

  const meter: Meter = {
    pathPrefix: new URL(assetDir, window.location.href).pathname,
    slotFor,
    report(slot, loaded, total, done) {
      const weight = expectedBytes[slot];
      if (!weight) return;
      slots.set(slot, { loaded, total: total > 0 ? total : weight, done });
      let weighted = 0;
      for (const [name, state] of slots) {
        const fraction = state.done ? 1 : Math.min(state.loaded / state.total, MAX_UNFINISHED_FRACTION);
        weighted += fraction * (expectedBytes[name] ?? 0);
      }
      onProgress(totalWeight > 0 ? Math.min(1, weighted / totalWeight) : 0);
    },
  };

  meters.add(meter);
  install();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    meters.delete(meter);
    if (meters.size === 0) uninstall();
  };
}
