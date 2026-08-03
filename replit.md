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

- `artifacts/3d-game/src/game/GameEngine.ts` — Three.js scene, lighting, sky, camera follow, flight physics, barrel-roll animation
- `artifacts/3d-game/src/game/terrain.ts` — tile-based endless terrain streaming from simplex noise
- `artifacts/3d-game/src/game/bird.ts` — low-poly bird mesh + wing-flap animation
- `artifacts/3d-game/src/game/handControls.ts` — MediaPipe Hands wrapper: palm tracking, fist/boost detection, wrist-flick barrel-roll detection
- `artifacts/3d-game/src/game/audio.ts` — synthesized wind ambience
- `artifacts/3d-game/src/App.tsx` — start overlay, webcam wiring, HUD, hand-landmark preview canvas

## Architecture decisions

- The Three.js scene is deliberately kept outside React (no React Three Fiber). `GameEngine` owns the renderer/render loop directly and is mounted/disposed via a plain container ref; React only renders the surrounding UI chrome. This keeps the real-time loop's frame timing independent of React re-renders.
- Gesture recognition happens in two passes: raw palm position is exponentially smoothed for steering (removes hand-tracking jitter), while the barrel-roll "flick" is detected from the *raw, unsmoothed* angular velocity of the knuckle line — smoothing would blur out the fast flick that's supposed to trigger it.
- Landmark drawing for the webcam preview is hand-rolled on a 2D canvas (using the `HAND_CONNECTIONS` constant already exported by `@mediapipe/hands`) instead of adding `@mediapipe/drawing_utils`, to keep the dependency list minimal.
- WebGL cannot be verified via the headless screenshot tool in this environment (no GPU context available there) — visual verification of the 3D scene relies on real-browser testing, not automated screenshots.

## Product

- Landing overlay explains the controls and requests camera access via an "Enable Camera & Fly" button (required due to browser autoplay/permission policy — audio and camera both need a user gesture to start).
- Once flying: tilt palm left/right/up/down to roll/pitch and steer over endless low-poly rolling hills; make a fist to boost speed (widens camera FOV for a sense of speed); flick your wrist quickly to trigger an 0.8s barrel roll.
- A small mirrored webcam preview (bottom-right) shows the tracked hand skeleton so players can see what the camera sees; a status strip (bottom-left) shows Boost/Barrel Roll state.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- MediaPipe assets load from the jsdelivr CDN at runtime (`locateFile`) — the app needs network access to `cdn.jsdelivr.net` on first load to fetch the hand-tracking model.
- Camera and ambient audio both start on the same user click (the "Enable Camera & Fly" button) to satisfy browser autoplay/permission policies — don't try to start audio or camera earlier.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
