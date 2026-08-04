---
name: Canvas mirror + coordinate-space overlay bug
description: How to correctly draw an overlay (crosshair, marker) on a canvas that mirrors raw video via CSS scale-x(-1), when the stored point is itself in mirrored coordinate space.
---

When a preview canvas draws the **raw, un-mirrored** video frame + raw landmark coordinates,
and a CSS `scale-x(-1)` on the `<canvas>` element mirrors the whole thing for display (the
common "selfie view" trick), any additional overlay point that was captured/stored in
**mirrored** coordinate space (e.g. a calibrated origin computed as `1 - rawX`) must be
un-mirrored back (`1 - storedX`) before being plotted on that same canvas.

**Why:** The canvas's own coordinate system matches the raw (un-mirrored) source, and the
CSS flip is applied once, uniformly, after drawing. If you plot a mirrored-space X value
directly, it renders on the wrong side once the CSS flip is applied — the two mirror
operations don't cancel, they compound, unless you explicitly un-mirror before drawing.

**How to apply:** Whenever a preview canvas mixes (a) directly-drawn raw video/landmarks and
(b) a separately-stored point that went through its own mirroring logic, check which
coordinate space that stored point is actually in before assuming it can be plotted directly.
Add a comment at the draw site — this bug is easy to reintroduce silently since it only shows
up as "the crosshair is on the wrong side," not a crash or type error.
