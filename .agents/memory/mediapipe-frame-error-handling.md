---
name: MediaPipe per-frame error handling
description: A MediaPipe Hands/solution `send()` call occasionally throws from inside its internal WASM/WebGL pipeline (e.g. a transient GL context hiccup) even when nothing is being torn down.
---

Never let a single frame's `hands.send()` failure become an uncaught exception that propagates out of the `requestAnimationFrame`-driven `onFrame` callback — that crashes the whole page (Vite/React error overlay in dev, a dead app in prod).

**Why:** it's tempting to re-throw "real" errors (distinguishing them from the known "deleted object" teardown race) so bugs surface loudly, but a solo bad frame from MediaPipe's own internals is not actionable by the caller and is very likely to self-heal on the next frame. A live test (Playwright with a synthetic/fake camera, which lacks GPU/WebGL support) reproduced exactly this: `hands.send()` threw `Cannot read properties of undefined (reading 'loadGraph')`, and the code's own re-throw-when-not-stopped branch turned that into an app-crashing overlay.

**How to apply:** in the `onFrame` handler, wrap `hands.send()` in try/catch and on failure just `console.warn` and return (skip the frame) — do not re-throw even when not mid-teardown. Only the actual `stop()`-driven guard (checking a `stopped` flag before calling `send()`) is needed to dodge the known "deleted object" race; it does not justify re-throwing other errors.
