---
name: React ref access before conditional render commits
description: A ref for an element that only renders under some state condition is null until after that state update commits and React re-renders — reading it earlier in the same handler silently no-ops.
---

If a DOM element (e.g. `<canvas>`) is only rendered when some state is true (`{state === 'flying' && <canvas ref={r} />}`), any code that reads `r.current` *before* calling `setState(...)` to flip that condition will always see `null` — React hasn't committed/rendered the element yet, since state setters don't synchronously update the DOM within the same handler.

**Why:** This produces a silent failure, not a crash: a guard like `if (ctx) draw()` just never runs, so a feature (e.g. a live video/canvas preview) appears completely broken with no error in the console — easy to misdiagnose as a drawing-logic bug when the real issue is ref timing.

**How to apply:** Set the state that mounts the element first, then do the ref-dependent setup in a `useEffect` keyed on that same state (`useEffect(() => { if (state !== 'flying') return; const ctx = ref.current?.getContext(...); ... }, [state])`). This guarantees the element exists in the DOM before the effect runs.
