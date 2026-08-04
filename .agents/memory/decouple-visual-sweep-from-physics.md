---
name: Decouple one-shot visual animation sweeps from the physics values they're layered on
description: Why a barrel-roll / flip animation caused unintended steering, and the fix pattern.
---

When a one-shot visual animation (e.g. a full 360-degree barrel-roll sweep) is layered on
top of a continuously-controlled value (e.g. roll angle from steering input) by writing
into the *same* variable, anything downstream that reads that variable for a different
purpose (e.g. turn-rate/heading calculation reading "current roll" to bank-turn the
heading) gets corrupted by the animation sweep too — the visual flip itself starts driving
gameplay logic it was never meant to touch.

**Why:** a bird-flight game's barrel roll set `rollAngle` to include both the player's
actual hand-tilt steering input AND the animated 360-degree flip sweep, then fed that
single `rollAngle` into `headingYaw -= rollAngle * dt * ...` for turning — so every barrel
roll also spun the bird's heading uncontrollably, even though the player's hands hadn't
moved.

**How to apply:** keep a "steering" value (raw control input only) and a "visual" value
(control input + any animated overlay) as two separate variables. Feed only the steering
value into physics/gameplay calculations (turning, movement direction); feed only the
visual value into the mesh/camera transform used purely for rendering. If a one-shot
animation should also suspend some behavior (e.g. no turning at all mid-flip), gate that
behavior explicitly on the animation's active flag rather than relying on the corrupted
combined value canceling out.
