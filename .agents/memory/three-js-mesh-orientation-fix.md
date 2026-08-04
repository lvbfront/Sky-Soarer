---
name: Fixing a 3D character's facing direction under yaw+pitch rotation
description: Why a mesh facing the wrong way in a THREE.js group driven by combined yaw/pitch rotations must be fixed at the rotation-order level, not by flipping the mesh itself.
---

When a character/vehicle group has its rotation set every frame as `group.rotation.order = 'YXZ'; group.rotation.y = yaw; group.rotation.x = pitch;` (or similar composed rotations), and the model visually faces backward (its "front" axis points opposite to the direction of travel), do NOT fix it by adding a 180° flip to the mesh geometry or to a child sub-group nested inside the yaw/pitch group.

**Why:** Axis rotations don't commute. A flip applied *before* the pitch rotation in the composition (i.e., baked into the mesh or an inner child group) changes which local axis pitch rotates around, silently inverting pitch even though yaw/heading looks fixed. This is easy to miss because the bug only becomes obvious in flight/tilt, not in a static screenshot.

**How to apply:** The correct fix is almost always to remove/adjust the yaw offset at the point where it's actually applied to the outer group (e.g., change `group.rotation.y = heading + Math.PI` to `group.rotation.y = heading`), so the mesh's local forward axis is redefined to already match the way `forward`/heading vectors are computed elsewhere in the code. Verify by symbolically composing the rotation matrix (or reasoning through the specific rotation order used) rather than guessing — a fix that looks right in a screenshot can still be wrong under pitch.
