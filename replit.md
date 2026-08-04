# Bird Flight

A relaxing 3D bird flight simulator you steer with your bare hand via webcam gesture tracking — no keyboard or mouse required. On the ocean map you can dive beneath the waves into a swimmable underwater world.

## Run & Operate

- `pnpm --filter @workspace/3d-game run dev` — run the flight sim (Vite dev server)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000, unused by this app)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- No database or env vars required — this app is entirely client-side.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- 3D engine: vanilla Three.js (no React Three Fiber) — a real-time render loop is easier to reason about outside React's render cycle
- Hand tracking: `@mediapipe/hands` + `@mediapipe/camera_utils`, loaded from the jsdelivr CDN at runtime
- Procedural terrain: `simplex-noise` (v4 `createNoise2D` API)
- Ambient audio: Web Audio API (synthesized wind noise, no audio files)
- UI chrome: React + Tailwind (shadcn scaffold), used only for the onboarding screens/HUD — the flight scene itself is plain Three.js mounted into a container div

## Where things live

- `artifacts/3d-game/src/game/GameEngine.ts` — Three.js scene, weather-driven sky/lighting/starfield, shadow-casting sun that tracks the bird, camera follow, flight physics (steering vs visual pitch/roll separated so barrel rolls and backflips never change heading/momentum), continuous flap-speed mapping, underwater diving state machine (fog/lighting swap, altitude rules, floaty swim physics), cloud/ring/splash/ring-burst/underwater/water-burst wiring; takes a `GameEngineOptions` (bird, map, weather, ring challenge, callbacks including `onBarrelRoll`/`onBackflip`/`onWaterTransition`) at construction
- `artifacts/3d-game/src/game/terrain.ts` — tile-based endless "Mountain Valley" terrain streaming from simplex noise; tiles `receiveShadow`
- `artifacts/3d-game/src/game/ocean.ts` — tile-based endless "Tropical Ocean & Islands" map: procedurally scattered island domes (deterministic lattice hash) plus a live per-vertex water undulation (`animateWater`, open-water vertices only, shoreline excluded) and a soft foam color band at the shoreline; shares the `update`/`heightAtWorld`/`isOverWater` contract with `terrain.ts` so `GameEngine` can swap maps freely
- `artifacts/3d-game/src/game/underwater.ts` — `UnderwaterEnvironment`: everything that appears once the bird dives below the ocean surface (coral reef clusters + swaying flora streamed in the flight corridor, a schooling group of fish, one patrolling shark, pulsing caustic light-ray planes, a rising bubble-particle stream). Lazily built on first `setActive(true)` so non-ocean sessions pay nothing for it.
- `artifacts/3d-game/src/game/waterBurst.ts` — one-shot droplet-burst particle effect (same fading-shader pattern as `ringBurst.ts`, retuned blue/white with stronger gravity) triggered when the bird surfaces from underwater
- `artifacts/3d-game/src/game/bird.ts` — low-poly bird meshes (Pigeon/Falcon/Flamingo/Duck variants) + wing-flap animation (rate driven externally by `GameEngine`; a `swimming` flag softens it into a gentle paddle stroke while submerged, applied to whichever bird is currently underwater), selected via `BirdType`; meshes `castShadow`
- `artifacts/3d-game/src/game/rings.ts` — Ring Challenge mode: first ring always spawns immediately dead-ahead on the bird's starting trajectory, later rings follow a sine-based curved chain (not random jumps); returns the collected ring's world position (or null) so callers can trigger effects there
- `artifacts/3d-game/src/game/ringBurst.ts` — one-shot star-burst particle effect (custom fading shader) triggered on ring collection
- `artifacts/3d-game/src/game/clouds.ts` — volumetric-looking cloud clusters streamed within the actual flight corridor so the bird can fly through them (separate from the decorative far-off sky clusters built in `GameEngine.buildSky`)
- `artifacts/3d-game/src/game/highscore.ts` — `getBestScore`/`saveBestScoreIfHigher`, backed by `localStorage`
- `artifacts/3d-game/src/game/splash.ts` — pooled point-sprite particle system for the ocean-map skimming/splash trail
- `artifacts/3d-game/src/game/handControls.ts` — MediaPipe Hands wrapper: palm tracking against a calibrated (not fixed) neutral origin, sensitivity scaling, fist/boost detection, and a velocity-based upward-flick backflip gesture (with a "hand left frame shortly after a fast flick" fallback)
- `artifacts/3d-game/src/game/audio.ts` — synthesized wind ambience (`WindAudio`) + one-shot ring-collect chime (`SoundEffects`)
- `artifacts/3d-game/src/App.tsx` — two-screen onboarding flow (World & Character Selection, then Control Calibration & Settings) + in-flight HUD (score, boost/roll/backflip/diving badges, status text, CSS boost motion-blur and water-transition vignettes), Stop Game button

## Architecture decisions

- The Three.js scene is deliberately kept outside React (no React Three Fiber). `GameEngine` owns the renderer/render loop directly and is mounted/disposed via a plain container ref; React only renders the surrounding UI chrome. This keeps the real-time loop's frame timing independent of React re-renders.
- The barrel roll (roll axis) and backflip (pitch axis) both trigger automatically from gesture edges — no manual "confirm" step — and each is implemented with the same fix: a `steering*Angle` (drives the actual forward vector / heading, never swept) kept separate from a `visual*Angle` (drives only the mesh/camera rotation, swept a full 360° over the trick's duration). This is why neither trick alters momentum or direction. The two tricks are mutually exclusive (checked in `applyControls`) so they never fight over the bird's rotation in the same frame.
- `TerrainManager` and `OceanManager` are two independent classes with the same duck-typed `update(position)` / `heightAtWorld(x, z)` contract (`OceanManager` additionally exposes `isOverWater` and `animateWater(dt)`), so `GameEngine` swaps between them per the selected map without a shared base class.
- Underwater diving (ocean map only): over open water there is no altitude floor except a hard seabed floor — the old "can't go below waterSurfaceY + 3.5" restriction only still applies over solid ground (mountain map, or an island on the ocean map). Underwater state is computed each frame from the bird's position vs. the live water surface height, with a small hysteresis band to avoid flicker right at the surface. Crossing the boundary swaps fog/background/hemisphere/ambient light to a fixed cyan look, toggles `UnderwaterEnvironment`, and (when surfacing) triggers `WaterBurstEffect`. Underwater flight uses separate (slower, floatier) speed/lerp constants and a steering-damping multiplier so turning feels like swimming, not flying.
- Day/Night & Weather (Sunny Morning / Sunset Gold / Starry Night) is a single preset table (`WEATHER_LOOKS`) driving sky gradient, fog color, sun/hemisphere/ambient light color+intensity, and whether a starfield is built — it's independent of the map choice and is restored exactly when exiting underwater.
- The sun (`THREE.DirectionalLight`) casts shadows and is repositioned every frame to stay near the bird so its shadow-camera frustum doesn't need to cover the whole endless world.
- Hand steering calibration: instead of a fixed screen-center neutral point, `HandTracker` exposes `captureNeutralCenter()`/`setOrigin()`/`setSensitivity()`; the dedicated calibration screen lets the player set both before flying. The onboarding flow constructs one `HandTracker` up front (during the camera-permission step) and reuses it across the calibration and flying screens via a stable `onUpdate` callback that no-ops on `GameEngine` calls until the engine actually exists.
- The webcam preview canvas draws the raw (un-mirrored) video frame and raw MediaPipe landmarks, then a CSS `scale-x-[-1]` mirrors the whole canvas for display. The calibration crosshair must be drawn in that same raw coordinate space — since the stored neutral origin is itself already in mirrored-space (`origin.x`), the draw call un-mirrors it back (`1 - origin.x`) before plotting, or it lands on the wrong side after the CSS flip.
- The boost motion-blur effect and the water-transition/underwater tint overlays are CSS-only overlays in `App.tsx`, not WebGL post-processing passes — the renderer doesn't run an `EffectComposer` pipeline, so this was the lowest-risk way to add these cues.
- Landmark drawing for the webcam preview is hand-rolled on a 2D canvas (using the `HAND_CONNECTIONS` constant already exported by `@mediapipe/hands`) instead of adding `@mediapipe/drawing_utils`, to keep the dependency list minimal.
- WebGL cannot be verified via the headless screenshot tool in this environment (no GPU context available there) — visual verification of the 3D scene (shadows, water animation, clouds, barrel-roll/backflip heading lock, underwater world, star/water bursts) relies on code review and real-browser testing, not automated screenshots.

## Product

- **Screen 1 (World & Character Selection):** pick a bird (Pigeon/Falcon/Flamingo/Duck), a map (Mountain Valley/Tropical Ocean & Islands), a weather preset (Sunny Morning/Sunset Gold/Starry Night), toggle Ring Challenge mode (shows the localStorage-backed Best Score), and read the gesture guide (including the backflip flick), then "Continue to Calibration" requests camera access.
- **Screen 2 (Control Calibration & Settings):** a live webcam preview with hand-skeleton overlay; "Set Neutral Hand Center" captures wherever the player is currently holding their hand as the new "fly straight" origin, shown as a crosshair on the preview; a Steering Sensitivity slider (0.5x–2.0x) scales hand displacement from that origin; "Start Flying" then builds the actual flight engine.
- Once flying: tilt palm left/right/up/down (relative to the calibrated neutral center, scaled by sensitivity) to roll/pitch and steer; make a fist to boost speed (widens camera FOV, triggers a CSS motion-blur vignette) and trigger an automatic 0.8s barrel roll the instant the fist closes; a fast upward hand flick triggers an automatic 0.9s backflip — both tricks are purely cosmetic and never change heading or momentum. Wing-flap rate scales continuously with flight speed (fast on boost, slow glide on a steep unboosted dive, or a gentle paddle stroke while swimming underwater).
- Ring Challenge (optional): the first ring always spawns immediately dead-ahead so it's visible the instant flight starts; later rings chain along a gentle curved path. Flying through one plays a synth chime, a star-burst particle effect, adds to the on-screen Score counter, gives a brief speed pulse, and updates the persisted Best Score if beaten.
- Flyable volumetric cloud clusters drift through the flight corridor on both maps; the sun casts soft shadows from the bird and terrain/ocean onto each other, repositioned every frame to track the bird.
- Ocean map: the water surface has a live per-vertex undulation (open water only) and a soft foam color band at shorelines; flying low over open water spawns a white skimming/splash particle trail. There is no altitude floor above open water anymore — diving below the surface transitions into an underwater world (cyan fog/lighting, caustic light rays, coral reefs and swaying flora, a schooling group of fish, a patrolling shark, rising bubbles, floatier swim physics) and re-emerging triggers a water-droplet burst back into normal sky flight. Islands remain solid ground (no diving, no splash/undulation).
- A small mirrored webcam preview (bottom-right) shows the tracked hand skeleton during flight, with a status line reading out the current gesture. A "Stop Game" button (top-right, during flight) or "Back" (during calibration) safely tears down the camera/tracker/engine and returns to the start menu.

## Known cosmetic issue (not yet fixed)

- `splash.ts`'s per-particle `opacity` buffer attribute has no visual effect because it uses plain `THREE.PointsMaterial`, which ignores arbitrary per-vertex attributes — particles don't visibly fade, they just freeze until their pooled slot is reused. `ringBurst.ts`/`waterBurst.ts` prove the fix pattern (a small custom `ShaderMaterial` reading a per-vertex opacity attribute) if this is worth porting over later.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- MediaPipe assets load from the jsdelivr CDN at runtime (`locateFile`) — the app needs network access to `cdn.jsdelivr.net` on first load to fetch the hand-tracking model.
- Camera and ambient audio both start on the same user click (during the onboarding flow's "Continue to Calibration" step) to satisfy browser autoplay/permission policies — don't try to start audio or camera earlier.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
