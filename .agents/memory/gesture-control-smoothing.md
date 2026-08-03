---
name: Gesture control smoothing tradeoffs
description: How to split smoothing between continuous steering signals and fast discrete gesture triggers in webcam hand-tracking.
---

When building webcam gesture controls (e.g. MediaPipe Hands landmark tracking), continuous
steering values (palm X/Y → pitch/roll) need exponential smoothing (EMA) to remove per-frame
jitter — otherwise the controlled object twitches.

**Why:** but a fast discrete gesture (a quick wrist flick/twist meant to trigger a one-shot
action like a barrel roll) is itself a *high angular velocity* event. Running it through the
same smoothing filter used for steering blurs out the very motion you're trying to detect,
so the trigger never fires reliably.

**How to apply:** keep two parallel signal paths from the same landmark stream — a smoothed
one for continuous control, and a raw/unsmoothed one (e.g. frame-to-frame angular velocity of
a hand-heading vector) for detecting fast trigger gestures, with a cooldown to prevent
re-triggering. Similarly, discrete state gestures (e.g. fist/open-hand) benefit from a small
hold-frame counter (hysteresis) rather than smoothing, to avoid flicker at the threshold.
