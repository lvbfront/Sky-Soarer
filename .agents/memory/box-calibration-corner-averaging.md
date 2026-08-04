---
name: Box-based gesture calibration via corner-pair averaging
description: How to turn a 4-corner + center calibration capture into a usable steering box, and why per-axis asymmetric extents matter.
---

For webcam/gesture steering calibrated by having the user capture 4 box corners (not just min/max
per axis independently), compute each side of the box as the **average of the two corners that
share it** (e.g. left edge = avg of top-left.x and bottom-left.x), and only finalize a side once
both of its corners are captured.

**Why:** Users don't hold their hand/finger in a perfect rectangle — the two "left" corners will
usually have slightly different X values. Averaging the shared side is more forgiving than
requiring exact axis-aligned corners, and doesn't leave the box in a broken state if capture
order is interrupted (each side updates independently as its corners complete, so partial
progress is always usable with sane defaults filling the gaps).

**How to apply:** Keep per-axis extents asymmetric (positive-side extent and negative-side extent
computed separately from center), not a single symmetric max-offset — real hand ranges aren't
symmetric around a natural resting position. Map the live value to -1..1 by comparing which side
of center it falls on and normalizing against that side's own extent, then apply a normalized
deadzone afterward (not a raw-pixel deadzone) so the deadzone scales correctly regardless of how
big the calibrated box turned out to be.
