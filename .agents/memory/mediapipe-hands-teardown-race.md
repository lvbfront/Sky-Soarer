---
name: MediaPipe Hands stop/restart race condition
description: Fixes "Cannot pass deleted object as a pointer of type SolutionWasm*" when a MediaPipe Hands (or similar @mediapipe/* solution) instance is stopped and a new one started shortly after.
---

`@mediapipe/hands` (and likely other `@mediapipe/*` solutions built on the same wasm
`SolutionWasm` base) can throw `BindingError: Cannot pass deleted object as a pointer of type
SolutionWasm*` as an unhandled promise rejection when a stop/restart cycle happens quickly —
e.g. a user clicks a "Stop"/"Exit" button and then restarts the same feature within roughly a
second.

**Why:** `camera_utils`'s `Camera.stop()` does not synchronously cancel an already-scheduled
`requestAnimationFrame` callback, so one more `onFrame` (and therefore one more `hands.send()`)
can fire after `stop()` was called. If that stray `send()` overlaps with `hands.close()`
tearing down the underlying wasm module, the wasm binding throws because it tries to use an
object that's already been deleted internally.

**How to apply:** track an explicit `stopped` boolean flag on your wrapper class. In the
`onFrame` callback, return early (skip `send()`) if `stopped` is true. In `stop()`, set
`stopped = true` before calling `camera.stop()` and `hands.close()`, and swallow/catch any
rejection from both the lingering in-flight `send()` and from `close()` itself — the error is
benign teardown noise, not a real failure, as long as `stopped` was already set when it fires.
