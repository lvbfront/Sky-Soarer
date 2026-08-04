---
name: One-shot gesture fallback must run before the "no hand detected" guard
description: A gesture consumer that early-returns when hand tracking is lost will silently swallow a fallback trigger event that is only ever reported alongside handDetected:false.
---

Pattern: a gesture producer (e.g. hand tracker) detects a fast directional flick from raw
per-frame deltas, but sometimes the hand leaves the camera frame right as the flick happens
(occlusion, fast motion blur, going off-screen). To not lose the gesture, the producer adds a
fallback: "if the hand disappears shortly after a fast flick was in progress, fire the trigger
once anyway." That fallback event necessarily arrives on a frame where `handDetected: false`.

If the consumer's control-handling function has an early return like
`if (!state.handDetected) return;` placed *before* it checks one-shot trigger flags (e.g.
`state.backflip`, `state.barrelRollTriggered`), the fallback-triggered event is silently
dropped exactly in the case it exists to handle.

**Why:** early-return guards for "no data this frame" are usually correct for continuous
signals (steering, position) but wrong for edge-triggered one-shot flags that can legitimately
coexist with `handDetected: false` on the same frame.

**How to apply:** when wiring a hand/pose-tracking consumer, check and consume one-shot
trigger flags *before* any `if (!handDetected) return` guard, even though the rest of that
function (continuous steering math) still needs the guard. Order matters here — do not
reorder for style without re-checking this.
