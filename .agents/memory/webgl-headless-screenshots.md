---
name: WebGL in headless screenshots
description: Why the appPreview Screenshot tool can't render WebGL/Three.js scenes, and how to verify them instead.
---

The headless browser used by the `Screenshot` tool (`appPreview`) has no GPU/ANGLE backend
available. Any `THREE.WebGLRenderer` (or other WebGL canvas) throws "Error creating WebGL
context" / "BindToCurrentSequence failed" there, no matter what renderer options are set
(antialias, powerPreference, etc. all made no difference).

**Why:** this is a limitation of the sandboxed screenshot browser instance, not the app code —
confirmed by testing multiple renderer configs, all failing identically with a GPU-process bind
error.

**How to apply:** don't spend time tweaking renderer/context options to "fix" a WebGL screenshot
failure — first suspect the sandbox. To sanity-check a Three.js/WebGL scene instead: rely on
`tsc --noEmit`, browser console logs (watch for *non*-WebGL errors), and code review; screenshot
only the surrounding non-WebGL UI (overlays, HUD). Full visual verification of the 3D scene
requires the user's real browser.
