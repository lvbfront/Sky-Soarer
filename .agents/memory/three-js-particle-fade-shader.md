---
name: THREE.PointsMaterial ignores custom per-vertex attributes
description: Why pooled point-sprite particles (splash, sparks, etc.) can silently fail to fade out over their lifetime.
---

`THREE.PointsMaterial` only reads its own built-in uniforms/attributes (size, color, map,
opacity as a single material-wide value) — it silently ignores any extra custom
`BufferAttribute` you add to the geometry, such as a per-particle `opacity` array. Code
that writes `geometry.setAttribute('opacity', ...)` and updates it every frame, expecting
each particle to fade individually, compiles fine and runs with no error, but the visual
fade never happens — particles just hold their last appearance until their pooled slot is
reused for a new spawn.

**Why:** discovered while building a ring-collection "star burst" effect that needed
genuine per-particle fade — a pre-existing splash/skim particle system in the same project
had this exact bug (a `opacity` attribute set and updated every frame, with zero visible
effect) because it used `THREE.PointsMaterial`.

**How to apply:** if particles need to fade, resize, or otherwise vary per-instance beyond
what `PointsMaterial` exposes, use a `THREE.ShaderMaterial` on the `THREE.Points` instead,
with your own attribute (e.g. `aOpacity`) read explicitly in the vertex shader and passed
to the fragment shader via a varying. This is the only way custom per-vertex data actually
affects rendering with `THREE.Points`.
