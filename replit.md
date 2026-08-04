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

- `artifacts/3d-game/src/game/GameEngine.ts` — Three.js scene, lighting, sky, camera follow, flight physics, barrel-roll animation, ring/score and splash wiring; takes a `GameEngineOptions` (bird, map, ring challenge, callbacks) at construction
- `artifacts/3d-game/src/game/terrain.ts` — tile-based endless "Mountain Valley" terrain streaming from simplex noise
- `artifacts/3d-game/src/game/ocean.ts` — tile-based endless "Tropical Ocean & Islands" map: flat rippling water + procedurally scattered island domes (deterministic lattice hash, not simplex), shares the same `update`/`heightAtWorld` contract as `terrain.ts` so `GameEngine` can swap maps freely
- `artifacts/3d-game/src/game/bird.ts` — low-poly bird meshes (Pigeon/Falcon/Flamingo variants) + wing-flap animation, selected via `BirdType`
- `artifacts/3d-game/src/game/rings.ts` — Ring Challenge mode: spawns glowing torus rings ahead of the flight path, axial+radial collision check, recycling pool
- `artifacts/3d-game/src/game/splash.ts` — pooled point-sprite particle system for the ocean-map skimming/splash trail
- `artifacts/3d-game/src/game/handControls.ts` — MediaPipe Hands wrapper: palm tracking (steering), fist/boost detection
- `artifacts/3d-game/src/game/audio.ts` — synthesized wind ambience (`WindAudio`) + one-shot ring-collect chime (`SoundEffects`)
- `artifacts/3d-game/src/App.tsx` — start overlay (bird/map/ring-toggle selection + gesture guide), webcam wiring, HUD (score, boost/roll badges, status text), Stop Game button

## Architecture decisions

- The Three.js scene is deliberately kept outside React (no React Three Fiber). `GameEngine` owns the renderer/render loop directly and is mounted/disposed via a plain container ref; React only renders the surrounding UI chrome. This keeps the real-time loop's frame timing independent of React re-renders.
- The barrel roll triggers automatically on the boost rising edge (fist just closed), detected in `GameEngine.applyControls` by comparing `boosting` to its previous-frame value — there is no separate gesture for it.
- `TerrainManager` and `OceanManager` are two independent classes with the same duck-typed `update(position)` / `heightAtWorld(x, z)` contract (`OceanManager` additionally exposes `isOverWater`), so `GameEngine` swaps between them per the selected map without a shared base class.
- Landmark drawing for the webcam preview is hand-rolled on a 2D canvas (using the `HAND_CONNECTIONS` constant already exported by `@mediapipe/hands`) instead of adding `@mediapipe/drawing_utils`, to keep the dependency list minimal.
- WebGL cannot be verified via the headless screenshot tool in this environment (no GPU context available there) — visual verification of the 3D scene relies on real-browser testing, not automated screenshots.

## Product

- Landing overlay explains the controls, lets the player pick a bird (Pigeon/Falcon/Flamingo), a map (Mountain Valley/Tropical Ocean & Islands), and toggle Ring Challenge mode, then requests camera access via a "Got It, Start Flying!" button (required due to browser autoplay/permission policy — audio and camera both need a user gesture to start).
- Once flying: tilt palm left/right/up/down to roll/pitch and steer; make a fist to boost speed (widens camera FOV) and trigger an automatic 0.8s barrel roll the instant the fist closes.
- Ring Challenge (optional): glowing rings spawn ahead of the flight path; flying through one plays a synth chime, adds to the on-screen Score counter, and gives a brief speed pulse.
- Ocean map: flying low over open water spawns a white skimming/splash particle trail; islands are solid ground (no splash) scattered across the endless water.
- A small mirrored webcam preview (bottom-right) shows the tracked hand skeleton so players can see what the camera sees; a status line underneath it reads out the current gesture (e.g. "Steering Left", "Fist (Boost) Active"). A "Stop Game" button (top-right, during flight) safely tears down the camera/tracker/engine and returns to the start menu.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- MediaPipe assets load from the jsdelivr CDN at runtime (`locateFile`) — the app needs network access to `cdn.jsdelivr.net` on first load to fetch the hand-tracking model.
- Camera and ambient audio both start on the same user click (the "Enable Camera & Fly" button) to satisfy browser autoplay/permission policies — don't try to start audio or camera earlier.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
