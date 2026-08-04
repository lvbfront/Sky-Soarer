# Bird Flight

A relaxing 3D bird flight simulator you steer with your bare hand via webcam gesture tracking — no keyboard or mouse required.

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
- UI chrome: React + Tailwind (shadcn scaffold), used only for the start overlay/HUD — the flight scene itself is plain Three.js mounted into a container div

## Where things live

- `artifacts/3d-game/src/game/GameEngine.ts` — Three.js scene, weather-driven sky/lighting/starfield, shadow-casting sun that tracks the bird, camera follow, flight physics (steering-roll vs visual-roll separated so barrel rolls don't spin the heading), continuous flap-speed mapping, cloud/ring/splash/ring-burst wiring; takes a `GameEngineOptions` (bird, map, weather, ring challenge, callbacks) at construction
- `artifacts/3d-game/src/game/terrain.ts` — tile-based endless "Mountain Valley" terrain streaming from simplex noise; tiles `receiveShadow`
- `artifacts/3d-game/src/game/ocean.ts` — tile-based endless "Tropical Ocean & Islands" map: procedurally scattered island domes (deterministic lattice hash) plus a live per-vertex water undulation (`animateWater`, open-water vertices only, shoreline excluded) and a soft foam color band at the shoreline; shares the `update`/`heightAtWorld`/`isOverWater` contract with `terrain.ts` so `GameEngine` can swap maps freely
- `artifacts/3d-game/src/game/bird.ts` — low-poly bird meshes (Pigeon/Falcon/Flamingo variants) + wing-flap animation (rate driven externally by `GameEngine`), selected via `BirdType`; meshes `castShadow`
- `artifacts/3d-game/src/game/rings.ts` — Ring Challenge mode: first ring always spawns immediately dead-ahead on the bird's starting trajectory, later rings follow a sine-based curved chain (not random jumps); returns the collected ring's world position (or null) so callers can trigger effects there
- `artifacts/3d-game/src/game/ringBurst.ts` — one-shot star-burst particle effect (custom fading shader) triggered on ring collection
- `artifacts/3d-game/src/game/clouds.ts` — volumetric-looking cloud clusters streamed within the actual flight corridor so the bird can fly through them (separate from the decorative far-off sky clusters built in `GameEngine.buildSky`)
- `artifacts/3d-game/src/game/highscore.ts` — `getBestScore`/`saveBestScoreIfHigher`, backed by `localStorage`
- `artifacts/3d-game/src/game/splash.ts` — pooled point-sprite particle system for the ocean-map skimming/splash trail
- `artifacts/3d-game/src/game/handControls.ts` — MediaPipe Hands wrapper: palm tracking (steering), fist/boost detection
- `artifacts/3d-game/src/game/audio.ts` — synthesized wind ambience (`WindAudio`) + one-shot ring-collect chime (`SoundEffects`)
- `artifacts/3d-game/src/App.tsx` — start overlay (bird/map/weather/ring-toggle selection + gesture guide + Best Score), webcam wiring, HUD (score, boost/roll badges, status text, CSS boost motion-blur vignette), Stop Game button

## Architecture decisions

- The Three.js scene is deliberately kept outside React (no React Three Fiber). `GameEngine` owns the renderer/render loop directly and is mounted/disposed via a plain container ref; React only renders the surrounding UI chrome. This keeps the real-time loop's frame timing independent of React re-renders.
- The barrel roll triggers automatically on the boost rising edge (fist just closed), detected in `GameEngine.applyControls` by comparing `boosting` to its previous-frame value — there is no separate gesture for it. During the ~0.8s roll, heading/yaw updates are frozen entirely and the visual roll sweep is kept in a separate variable from the steering-roll used for turning, so the flip itself never causes an unintended turn.
- `TerrainManager` and `OceanManager` are two independent classes with the same duck-typed `update(position)` / `heightAtWorld(x, z)` contract (`OceanManager` additionally exposes `isOverWater` and `animateWater(dt)`), so `GameEngine` swaps between them per the selected map without a shared base class.
- Day/Night & Weather (Sunny Morning / Sunset Gold / Starry Night) is a single preset table (`WEATHER_LOOKS`) driving sky gradient, fog color, sun/hemisphere/ambient light color+intensity, and whether a starfield is built — it's independent of the map choice.
- The sun (`THREE.DirectionalLight`) casts shadows and is repositioned every frame to stay near the bird so its shadow-camera frustum doesn't need to cover the whole endless world.
- The boost motion-blur effect is a CSS-only radial vignette overlay in `App.tsx`, not a WebGL post-processing pass — the renderer doesn't run an `EffectComposer` pipeline, so this was the lowest-risk way to add a speed-blur cue.
- Landmark drawing for the webcam preview is hand-rolled on a 2D canvas (using the `HAND_CONNECTIONS` constant already exported by `@mediapipe/hands`) instead of adding `@mediapipe/drawing_utils`, to keep the dependency list minimal.
- WebGL cannot be verified via the headless screenshot tool in this environment (no GPU context available there) — visual verification of the 3D scene (shadows, water animation, clouds, barrel-roll heading lock, star bursts) relies on code review and real-browser testing, not automated screenshots.

## Product

- Landing overlay explains the controls, lets the player pick a bird (Pigeon/Falcon/Flamingo), a map (Mountain Valley/Tropical Ocean & Islands), a weather preset (Sunny Morning/Sunset Gold/Starry Night), and toggle Ring Challenge mode (which also shows the localStorage-backed Best Score), then requests camera access via a "Got It, Start Flying!" button (required due to browser autoplay/permission policy — audio and camera both need a user gesture to start).
- Once flying: tilt palm left/right/up/down to roll/pitch and steer; make a fist to boost speed (widens camera FOV, triggers a CSS motion-blur vignette) and trigger an automatic 0.8s barrel roll the instant the fist closes — heading is locked during the roll so it never turns the bird off course. Wing-flap rate scales continuously with flight speed (fast on boost, slow glide on a steep unboosted dive).
- Ring Challenge (optional): the first ring always spawns immediately dead-ahead so it's visible the instant flight starts; later rings chain along a gentle curved path. Flying through one plays a synth chime, a star-burst particle effect, adds to the on-screen Score counter, gives a brief speed pulse, and updates the persisted Best Score if beaten.
- Flyable volumetric cloud clusters drift through the flight corridor on both maps; the sun casts soft shadows from the bird and terrain/ocean onto each other, repositioned every frame to track the bird.
- Ocean map: the water surface has a live per-vertex undulation (open water only) and a soft foam color band at shorelines; flying low over open water also spawns a white skimming/splash particle trail. Islands are solid ground (no splash/undulation) scattered across the endless water.
- A small mirrored webcam preview (bottom-right) shows the tracked hand skeleton so players can see what the camera sees; a status line underneath it reads out the current gesture (e.g. "Steering Left", "Fist (Boost) Active"). A "Stop Game" button (top-right, during flight) safely tears down the camera/tracker/engine and returns to the start menu.

## Known cosmetic issue (not yet fixed)

- `splash.ts`'s per-particle `opacity` buffer attribute has no visual effect because it uses plain `THREE.PointsMaterial`, which ignores arbitrary per-vertex attributes — particles don't visibly fade, they just freeze until their pooled slot is reused. `ringBurst.ts` proves the fix pattern (a small custom `ShaderMaterial` reading a per-vertex opacity attribute) if this is worth porting over later.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- MediaPipe assets load from the jsdelivr CDN at runtime (`locateFile`) — the app needs network access to `cdn.jsdelivr.net` on first load to fetch the hand-tracking model.
- Camera and ambient audio both start on the same user click (the "Enable Camera & Fly" button) to satisfy browser autoplay/permission policies — don't try to start audio or camera earlier.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
