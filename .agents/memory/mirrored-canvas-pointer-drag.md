---
name: Mirrored-canvas pointer-drag coordinate mapping
description: How to map a pointer/drag event on a CSS-mirrored canvas back to the same mirrored-space coordinates already used for stored points, without extra sign-flipping.
---

When a canvas draws content in raw (un-mirrored) space and is then flipped for display with a CSS transform (e.g. `scale-x-[-1]`), and the app already stores points in that same mirrored space (because they were captured from a mirrored preview and un-mirrored at draw time), a live pointer/drag event on that canvas needs **no extra mirroring math**.

**Why:** A pointer event's `clientX`/`clientY` already lands in the mirrored (as-displayed) coordinate space the user sees and interacts with. Converting it to a fractional position via `(clientX - rect.left) / rect.width` (same for Y) produces exactly the mirrored-space value already used for the stored point — the CSS mirror and the draw-time un-mirror cancel out algebraically. Trying to additionally flip the pointer's X (`1 - x`) double-mirrors and puts the dragged point on the wrong side.

**How to apply:** For drag-to-fine-tune or click-to-place interactions on a mirrored canvas, just normalize the raw pointer position against the canvas element's own bounding rect and use it directly as the stored coordinate — don't special-case the mirror at pointer-handling time, only at draw time.
