# CLAUDE.md — Sky Soarer ("Bird Flight")

Guidance for Claude Code (and humans) working in this repository. The repo is named **Sky Soarer**, and the game calls itself **Bird Flight** in its UI, `<title>`, and `replit.md`. It was built on Replit with Replit Agent. `replit.md` is the original agent's running notes; this file supersedes it but leaves it untouched. `.agents/memory/*.md` holds lessons that agent recorded while fixing bugs, and those are still worth reading before you touch controls or tricks.

---

## 1. Project overview

Bird Flight is a relaxing, endless 3D flight game. You steer a low-poly bird **with your bare hand in front of a webcam**. MediaPipe Hands tracks the hand, and there is **no keyboard, mouse, or touch fallback**.

How a session plays:

1. **Menu (Screen 1).** Choose:
   - a bird: Pigeon, Falcon, Greater Flamingo, or Duck/Seabird
   - a map: Mountain Valley, or Tropical Ocean & Islands
   - a weather preset: Sunny Morning, Sunset Gold, or Starry Night
   - whether Ring Challenge is on (the switch shows your best score)

   Then click **Continue to Calibration**, which asks for camera access.
2. **Calibration (Screen 2).**
   - Pick a control mode: **Full Hand**, which tracks the palm center, or **Index Finger**, which tracks the fingertip.
   - Capture 5 points: the neutral center, then the top-left, top-right, bottom-left and bottom-right corners of your comfortable range.
   - Once a corner is captured you can drag it on the preview to fine-tune it.
   - Set steering sensitivity from 0.5x to 2.0x.
   - **Start Flying** stays disabled until all 5 points are captured.
3. **Flight.**
   - Move the tracked point inside the calibrated box to pitch and roll. Roll banks the bird, and banking turns it.
   - **Close a fist** to boost. Boosting also fires an automatic 0.8 s barrel roll.
   - **Flick your hand up fast** for a 0.9 s backflip.
   - Both tricks are cosmetic only. They never change heading or momentum.
   - On the ocean map you can dive under open water into a reef world with fish, a shark, caustics and bubbles. Surfacing sprays a water burst.
   - In Ring Challenge, fly through glowing rings to score. A floating arrow points to the nearest ring, and the best score is saved in `localStorage`.
   - The HUD shows score, Boost/Barrel Roll/Backflip/Diving badges, a mirrored webcam preview with the hand skeleton, a status line, and **Stop Game**.

There is no win or lose state, no timer, and no collision damage. Terrain acts only as an altitude floor.

---

## 2. Tech stack (versions from the lockfile as installed)

| Area | Library | Version |
|---|---|---|
| Monorepo | pnpm workspaces | pnpm 10.x (lockfile v9), `minimumReleaseAge: 1440` |
| Language | TypeScript | ~5.9.3 |
| Runtime | Node | Replit uses `nodejs-24`. Node 22.22 also works. |
| Bundler / dev server | Vite | ^7.3.2 (7.3.6 resolved) |
| UI | React / React DOM | 19.1.0 (pinned; the catalog comment says expo needs it) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui "new-york" scaffold | ^4.1.14 |
| Icons | lucide-react | ^0.545.0 |
| 3D | three (vanilla, **no** React Three Fiber) | ^0.185.1 (`@types/three` ^0.185.3) |
| Hand tracking | `@mediapipe/hands` + `@mediapipe/camera_utils` (legacy "Solutions" API) | 0.4.1675469240 / 0.3.1675466862 |
| Noise | simplex-noise (v4 `createNoise2D`) | ^4.0.3 |
| Audio | Web Audio API, fully synthesized (no audio files) | — |
| Replit dev plugins | `@replit/vite-plugin-runtime-error-modal`, `-cartographer`, `-dev-banner` | catalog |

Every dependency of `@workspace/3d-game` is listed under `devDependencies`. That is harmless, because Vite bundles them all. Shared versions come from the `catalog:` block in `pnpm-workspace.yaml`.

---

## 3. Running locally

### Commands (run from the repo root)

```bash
pnpm install --frozen-lockfile          # ~10 s; the root preinstall script refuses npm/yarn

# Dev server for the game. PORT and BASE_PATH are REQUIRED; vite.config.ts throws without them.
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/3d-game run dev
#   -> http://localhost:5000/  (binds 0.0.0.0, strictPort, allowedHosts: true)

# Production build of the game only -> artifacts/3d-game/dist/public
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/3d-game run build

# Serve the production build
PORT=5001 BASE_PATH=/ pnpm --filter @workspace/3d-game run serve

# Typecheck everything: tsc --build for lib/*, then each artifact's and scripts' own tsc --noEmit
pnpm run typecheck
pnpm --filter @workspace/3d-game run typecheck   # game only
```

Results of a verification run (Node 22.22.2, pnpm 10.33.0, Linux x64):

- `pnpm install --frozen-lockfile` succeeds in about 8.5 s.
- `pnpm run typecheck` passes with no errors in any package.
- `pnpm --filter @workspace/3d-game run build` succeeds when `PORT`/`BASE_PATH` are set. It prints one warning: *"Some chunks are larger than 500 kB"*. The JS bundle is a single 844 kB file (234 kB gzip), and the CSS is 103 kB.
- `pnpm run build` from the root **fails**: `mockup-sandbox`'s `vite.config.ts` throws `PORT environment variable is required`. The game's build throws the same error if the variables aren't set. The build only works on Replit because each artifact's `.replit-artifact/artifact.toml` injects `PORT`/`BASE_PATH`.
- The dev server was ready in about 270 ms on `PORT`. The Replit artifact config uses **port 24982** for the game, 8080 for the API server, and 8081 for the mockup sandbox. Nothing actually uses port 5000, and `replit.md`'s "port 5000" note for the API server is wrong: `artifact.toml` says 8080.
- Headless Chromium with a fake camera reached the calibration screen in both dev and prod builds, so MediaPipe's `Hands` constructs correctly in the prod bundle. `GameEngine` rendered both maps through SwiftShader WebGL. The console printed two three.js deprecation warnings (see §9).

### Environment variables

| Var | Needed by | Notes |
|---|---|---|
| `PORT` | game, mockup-sandbox, api-server | Required. The Vite configs throw without it, even for `vite build`. |
| `BASE_PATH` | game, mockup-sandbox | Required. Becomes Vite `base`. Use `/` locally. |
| `REPL_ID` | game (optional) | If set and `NODE_ENV !== 'production'`, the cartographer and dev-banner Replit plugins load. |
| `DATABASE_URL` | `lib/db` only | The game doesn't use it. `scripts/post-merge.sh` runs `pnpm --filter db push`, which needs it. |

The game needs **no secrets and no backend**.

### Browser, webcam and network requirements

- A **secure context** (`https://` or `http://localhost`), because `getUserMedia` refuses plain-HTTP LAN IPs.
- A webcam. The app requests 480×360 with `facingMode: 'user'`.
- **WebGL.** WebGL2 is preferred, since three r185 targets it.
- **Network access to `cdn.jsdelivr.net`.** The MediaPipe wasm, model and `.data` files are loaded at runtime from `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/…`, set by `locateFile` in `handControls.ts`. If the CDN is blocked, **the UI shows no error**. The calibration screen just says "Show your hand to the camera", and the console logs `HandTracker: a frame failed to process` on every frame. This was reproduced in the sandbox.
- A desktop Chromium, Edge or Firefox with a decent GPU is the target. Mobile isn't designed for: there's no touch fallback, and the layout assumes a large screen.
- In headless screenshot tools, WebGL often fails with no GPU. Launch Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` to render, and expect very low FPS.

---

## 4. Repository map

```
.
├── artifacts/                 # Replit "artifacts" = deployable apps
│   ├── 3d-game/               # ★ THE GAME (@workspace/3d-game)
│   │   ├── .replit-artifact/artifact.toml   # Replit service config (port 24982, static deploy, SPA rewrite)
│   │   ├── index.html         # <title>Bird Flight</title>, Google Fonts Inter, favicon
│   │   ├── vite.config.ts     # requires PORT/BASE_PATH; aliases @ -> src, @assets -> /attached_assets
│   │   ├── components.json    # shadcn config
│   │   └── src/
│   │       ├── main.tsx       # createRoot(<App/>)
│   │       ├── App.tsx        # ★ all React UI: menu, calibration wizard, HUD, state machine (~1030 lines)
│   │       ├── index.css      # Tailwind v4 + shadcn theme tokens (warm pastel palette)
│   │       ├── game/          # ★ framework-free Three.js game code
│   │       │   ├── GameEngine.ts   # renderer, scene, loop, flight physics, camera, lighting/weather, underwater state machine
│   │       │   ├── handControls.ts # MediaPipe wrapper: tracking, calibration box, fist/flick gesture detection
│   │       │   ├── bird.ts         # 4 procedural low-poly birds + wing flap
│   │       │   ├── terrain.ts      # Mountain Valley: streamed simplex-noise tiles
│   │       │   ├── ocean.ts        # Ocean: streamed tiles, hashed islands, animated water verts, foam band
│   │       │   ├── underwater.ts   # reef/fish/shark/caustics/bubbles (lazy-built)
│   │       │   ├── clouds.ts       # flyable cloud clusters in the flight corridor
│   │       │   ├── rings.ts        # Ring Challenge spawning + hit test
│   │       │   ├── ringGuide.ts    # arrow pointing to nearest ring
│   │       │   ├── ringBurst.ts    # star-burst particles (custom ShaderMaterial)
│   │       │   ├── waterBurst.ts   # surfacing droplet particles (copy of ringBurst, retuned)
│   │       │   ├── splash.ts       # skimming spray particles (PointsMaterial – fade is broken)
│   │       │   ├── audio.ts        # WindAudio (filtered noise) + SoundEffects (ring chime)
│   │       │   └── highscore.ts    # localStorage best score ("bird-flight-best-score")
│   │       ├── components/ui/ # 55 shadcn components — UNUSED by the game (scaffold leftovers)
│   │       ├── hooks/         # use-toast, use-mobile — unused
│   │       ├── lib/utils.ts   # cn() helper
│   │       └── pages/not-found.tsx # unused (no router is mounted)
│   ├── api-server/            # Express 5 + pino template, only GET /api/healthz. NOT used by the game.
│   └── mockup-sandbox/        # Replit "Canvas" component-preview tool (port 8081). NOT part of the game.
├── lib/                       # template libs, unused by the game
│   ├── api-spec/              # openapi.yaml + orval config (health check only)
│   ├── api-zod/               # generated zod schemas
│   ├── api-client-react/      # generated react-query client (listed as a game dep but never imported)
│   └── db/                    # drizzle + pg, empty schema, throws if DATABASE_URL is missing when imported
├── scripts/                   # hello.ts + post-merge.sh (Replit post-merge hook)
├── attached_assets/           # the two feature-request prompts the user pasted into Replit Agent
├── .agents/memory/            # Replit Agent's lessons-learned notes (read these!)
├── .replit, .replitignore     # Replit workspace config
├── pnpm-workspace.yaml        # workspace globs, version catalog, supply-chain guard, platform overrides
├── tsconfig.base.json         # shared strict-ish TS options (strictFunctionTypes: false, noUnusedLocals: false)
└── replit.md                  # original agent notes (keep as is)
```

In short, everything that matters for gameplay is in `artifacts/3d-game/src/App.tsx` and `artifacts/3d-game/src/game/*`. Everything else is Replit pnpm-workspace template scaffolding.

---

## 5. Architecture and data flow

```
 webcam ──► <video hidden> ──► camera_utils.Camera (rAF) ──► Hands.send()  (MediaPipe wasm, model from CDN)
                                                                 │ onResults
                                                                 ▼
                                   HandTracker.handleResults()  → HandControlState
                                   {handDetected, pitch, roll, boost, backflip, landmarks}
                                                                 │ onUpdate (one stable closure created in App)
            ┌────────────────────────────────────────────────────┼────────────────────────────┐
            ▼                                                    ▼                            ▼
 engineRef.current?.applyControls(state)          latestLandmarksRef = landmarks    setHandDetected / setBoosting /
 (no-op until "Start Flying")                    (read by the preview canvas rAF)   setStatusText  → React re-render
            │
            ▼
 GameEngine (own rAF loop): update(dt) → renderer.render(scene, camera)
            │ callbacks
            └─► onScoreChange / onBarrelRoll / onBackflip / onWaterTransition → React state → HUD badges & CSS overlays
```

- **React owns only the UI chrome.** `GameEngine` is a plain class that is mounted into a `div` ref, and it owns the `WebGLRenderer` and its own `requestAnimationFrame` loop. This is deliberate, so React re-renders never affect frame timing.
- **Top-level state** is a string union in `App.tsx`: `FlightState = 'menu' | 'requesting' | 'calibrating' | 'flying' | 'denied' | 'unsupported'`. Everything else is local `useState` plus refs. There is no store, context or router.
- **One `HandTracker` per session.** It is created in `handleContinueToCalibration`, which runs on the user click, and reused through calibration and flight. Calibration state (center, box, sensitivity) lives **inside the tracker**. The engine only ever sees normalized `pitch`/`roll` in `-1..1`.
- **Engine options are fixed at construction.** Bird, map, weather and ring mode can't change mid-flight. Changing them means stopping and restarting.
- **Teardown.** `stopEverything()` stops the tracker, disposes the engine, cancels the preview rAF, and stops the MediaStream tracks. Back and Stop Game both call it.

---

## 6. How each system works

### 6.1 Rendering (`GameEngine.ts`)
- `WebGLRenderer({antialias, powerPreference:'high-performance'})`, with pixel ratio capped at 2, sRGB output, and shadow maps on.
- `PerspectiveCamera` with FOV 58, rising to 72 on boost (50 and 60 underwater), near 0.1, far 1200.
- **Sky.** An inverted sphere of radius 900 with vertex-color gradient from the `WEATHER_LOOKS` preset, plus 24 decorative cloud clusters. On Starry Night there's also a 900-point starfield that follows the bird on XZ. The sky sphere and decorative clouds **don't** follow the bird (see §9).
- **Fog.** `FogExp2`, density 0.0068 above water and 0.022 underwater.
- **Lights.** Hemisphere + ambient + a shadow-casting sun (1024² map, 180×180 frustum) that is **re-centered on the bird every frame**, plus an unshadowed fill light.
- **Weather.** `WEATHER_LOOKS` is one table holding sky colors, fog colors, and light colors and intensities. `enterUnderwaterLook()` and `exitUnderwaterLook()` swap between it and the fixed cyan underwater palette.
- **Screen effects.** The boost motion blur, the surfacing flash and the underwater tint are **CSS overlays in `App.tsx`**, not post-processing. There is no `EffectComposer`.

### 6.2 Flight physics and camera (`GameEngine.update`)
- `currentPitch` and `currentRoll` chase the tracker's targets with a per-frame lerp of 0.06, then scale by max angles of 38° pitch and 48° roll.
- **Steering and visual angles are separate.** Heading, the forward vector and movement use only `steeringPitchAngle`/`steeringRollAngle`. The mesh rotation uses `visual*Angle`, which adds the 360° trick sweep. **Never merge these.** See `.agents/memory/decouple-visual-sweep-from-physics.md`.
- **Turning.** `headingYaw -= steeringRoll * dt * 0.6`, and the heading is locked while a barrel roll is in progress.
- **Speed.**
  - Base speed is 9 and boost is 20. Underwater they're 5 and 10.
  - Speed lerps toward its target at 0.04 per frame, or 0.02 underwater.
  - Collecting a ring adds a +7 pulse that decays at 9/s.
- **Altitude.**
  - Over solid ground (mountains or islands) the floor is `height + 3.5`.
  - Over open water the only floor is `SEABED_FLOOR_Y = -15`.
  - The ceiling is y = 140.
  - The bird starts at (0, 26, 0) heading +Z.
- **Camera.** A chase camera 6.5 behind and 2.2 above the bird, looking 8 units ahead, with a per-frame lerp of 0.05 (0.03 underwater).
- **Timing.** `dt` is clamped to 0.05 s, so below 20 FPS the simulation runs in slow motion.
- **Wing flaps.** Flap rate is mapped from speed onto 7–17, times 0.55 when gliding in a dive (pitch below -0.15 and not boosting), and uses a gentle paddle stroke underwater.

### 6.3 Hand tracking (`handControls.ts`)
- **MediaPipe options:**
  - `maxNumHands: 1`
  - `modelComplexity: 0`, the lite model
  - `selfieMode: false`, so mirroring is done manually
  - detection confidence 0.6, tracking confidence 0.5

  `camera_utils.Camera` drives `hands.send()` from rAF at 480×360.
- **Frame pipeline** in `handleResults`:
  1. Compute the palm center, the mean of landmarks 0, 5, 9, 13 and 17.
  2. Take the tracked point: the palm center in `hand` mode, or landmark 8 (index tip) in `finger` mode.
  3. Mirror X as `1 - x`, so the steering matches the mirrored "selfie" preview.
  4. Smooth with an EMA, α = 0.35 per frame.
  5. Map onto -1..1 **within the calibrated box** with `axisValue()`. Each side of the center uses its own asymmetric extent.
  6. Apply a normalized deadzone of 0.06, rescaled so there's no jump at its edge.
  7. Multiply by sensitivity (0.5–2.0) and clamp to ±1.
- **Box calibration.**
  - `captureNeutralCenter()` and `captureCorner()` snapshot the smoothed point.
  - `recomputeBox()` averages the two corners that share a side, so the left edge is the mean of `topLeft.x` and `bottomLeft.x`.
  - `setCorner()` sets a corner directly and backs the drag-to-fine-tune feature.
  - Default box: x 0.24–0.76, y 0.28–0.72.
- **Boost (fist).**
  - `fistRatio` is the mean fingertip-to-palm distance divided by the wrist-to-middle-MCP distance.
  - The fist closes below 0.62 and opens above 0.8, with 3 frames of hysteresis in each direction.
  - The same gesture works in both control modes.
- **Backflip (upward flick).**
  - Keeps a 220 ms rolling history of the **raw**, unsmoothed Y.
  - It fires when the point moves up more than 0.1 at more than 1.1 frame-heights/s, with a 1200 ms cooldown.
  - **Fallback:** if the hand vanishes within 300 ms of a fast flick, the tracker emits `backflip: true` with `handDetected: false`. `GameEngine.applyControls` checks `backflip` **before** its `if (!handDetected) return` guard, so don't reorder these. See `.agents/memory/gesture-fallback-before-detection-guard.md`.
- **Robustness.**
  - A `stopped` flag guards `send()` after `stop()`, which avoids MediaPipe's "deleted object" wasm race.
  - Per-frame `send()` errors are logged and swallowed, never re-thrown.
- **Fallback inputs:** **none.** There is no keyboard, mouse, gamepad or touch steering. Pointer events are used only for dragging calibration corners.

### 6.4 Calibration UI and webcam preview (`App.tsx`)
- `drawHandPreview()` draws the raw video frame and the raw landmarks, then CSS `scale-x-[-1]` mirrors the canvas.
- Stored calibration points are in mirrored space, so they are **un-mirrored when drawn** (`1 - p.x`).
- Pointer drag positions map 1:1 to stored points with **no** flip. The two mirrors cancel. See `.agents/memory/canvas-mirror-coordinate-overlay.md` and `mirrored-canvas-pointer-drag.md`.
- One preview rAF draws on whichever canvas is mounted: the 360×270 calibration canvas or the 176×132 HUD canvas. It runs in a `useEffect` keyed on `flightState`, because refs are null until the conditional render commits.
- Changing control mode resets calibration to step 1.

### 6.5 Tricks
- **Barrel roll:**
  - Triggered on the rising edge of `boost` (the fist closing).
  - Adds 360° of visual roll over 0.8 s with `easeInOutCubic`.
  - The heading is frozen during the roll.
- **Backflip:**
  - Triggered by `state.backflip`.
  - Adds 360° of visual pitch over 0.9 s.
- The two tricks are mutually exclusive, and each is checked only when neither is active.
- The HUD badges are cleared by `setTimeout`s of 850 ms and 950 ms.

### 6.6 Environments
- **Mountain Valley** (`terrain.ts`):
  - 120-unit tiles with 20×20 segments, in a 7×7 grid around the bird (`VIEW_RADIUS 3`).
  - Height is two octaves of simplex noise × 16, with vertex colors banded by height.
  - Tiles are pooled and rebuilt only when the bird crosses a tile boundary.
  - The noise seed is random per session.
- **Tropical Ocean** (`ocean.ts`):
  - The same tiling, with 24 segments.
  - Water sits at y = 0, with a static noise ripple of ±0.18.
  - Islands are smoothstep domes on a 55-unit lattice, chosen by a deterministic `sin` hash with a 40% chance per cell.
  - Vertex colors band from deep water through shallow water, foam, sand and foliage.
  - `animateWater()` animates open-water vertices (base height ≤ 0.24) only in the 3×3 tiles nearest the bird, and recomputes normals every 4th frame.
  - `isOverWater()` decides whether the altitude floor or diving applies.
- **The shared map contract** is duck-typed rather than an interface or base class: `update(pos)` and `heightAtWorld(x, z)`. `OceanManager` adds `isOverWater` and `animateWater`.
- **Underwater** (`underwater.ts`):
  - **Lazy build.** Everything is built on the first `setActive(true)`.
  - **Reef.** Items are coral, flora, anemones and shells, pooled up to 32. They spawn ahead of the bird, and on every dive a full ring of them is seeded around it.
  - **Fish and shark.** Three fish schools of 6 lerp toward offsets from the bird. The shark follows a sine patrol around the bird.
  - **Light.** 7 additive vertical caustic planes and 12 caustic floor rings.
  - **Bubbles.** A 200-particle bubble stream.
  - **Entry and exit.** The switch happens when the bird's depth below `heightAtWorld` crosses ±0.4 (hysteresis).

### 6.7 Ring Challenge (`rings.ts`, `ringGuide.ts`, `ringBurst.ts`, `highscore.ts`)
- **Spawning.**
  - The first ring spawns immediately, 42 units dead ahead.
  - After that, one spawns every 2.1 s, 55–80 units ahead along the *current* forward vector.
  - Rings are offset laterally and vertically on a sine curve (phase +0.85 per ring).
  - Rings are clamped to at least 8 above the ground, with at most 6 active.
- **Hit test.** In the ring's own frame: axial distance under 2.2 and radial distance under 3.4.
- **Despawn.** A missed ring is recycled once it is 40 units behind the bird along its own normal.
- **On collect:**
  - score +1
  - a speed pulse
  - the chime
  - a star burst
  - `onScoreChange`, which calls `saveBestScoreIfHigher` on **every** ring
- `RingGuideArrow` floats above and ahead of the bird and uses `lookAt()` to point at the nearest active ring.

### 6.8 Audio (`audio.ts`)
- `WindAudio` plays 2 s of looping white noise through a lowpass filter and a gain node. Filter cutoff and gain follow a speed ratio that its own rAF feeds in with `setTargetAtTime`. It is muted underwater.
- `SoundEffects.playChime()` plays two sine tones, C6 then G6, with a quick attack and exponential decay.
- Two separate `AudioContext`s are created. The wind one starts in `engine.start()`, which runs from the **Start Flying** click and so satisfies the autoplay policy. `replit.md` says audio starts on "Continue", but that's outdated.

### 6.9 Particles
- **`ringBurst.ts` and `waterBurst.ts`:**
  - Near-identical classes.
  - Pooled `THREE.Points` with a custom `ShaderMaterial` that reads per-particle `aOpacity` and `aSize`, and a canvas-generated sprite texture.
  - Ignored by fog and not scaled by pixel ratio.
- **`splash.ts`:**
  - Skimming spray within 1.6 units of the water.
  - Uses `PointsMaterial`, which **ignores** its custom `opacity` attribute, so the particles never fade. This is a known, documented bug.

---

## 7. Coding conventions and patterns

- **Keep game code framework-free.** Anything in `src/game/` is plain TypeScript and three.js with no React imports. React talks to it through constructor options, a few `get*/is*` getters, `applyControls()`, and callbacks.
- **Use one manager class per system**, with the same lifecycle: `constructor(scene)`, then `update(dt, birdPosition, forward, …)` every frame, then `dispose()`. `GameEngine.update` calls them in order. New systems should follow this shape.
- **Pool and stream around the bird.** Objects spawn ahead of the bird along `forward`, are recycled once they're some distance *behind* along their spawn-time forward, and are reused through `visible = false` and a pool array. Terrain and ocean tiles are keyed by `"x,z"` strings.
- **Tune with constants at the top of each file**, in `UPPER_SNAKE_CASE` with a comment explaining the *why*. Change these rather than inlining magic numbers.
- **Generate assets procedurally.** Meshes are built from three primitives with `flatShading: true`, textures from `<canvas>`, and sound from Web Audio. There are no binary assets, and it's worth keeping it that way.
- **Comments are dense and explain intent**, often pointing to `.agents/memory/*`. Match that density in `src/game/`.
- **Style:**
  - 2-space indent, single quotes, semicolons, trailing commas, about 120 columns.
  - Prettier is installed but there's no config file, so defaults apply apart from the quote style already used in the code.
  - There's no ESLint and **no tests**.
- **Imports.** Use the `@/` alias for `src`. Use `import * as THREE from 'three'`. Put `type` imports inline, as in `import { Bird, type BirdType }`.
- **React style.** One big `App` function component. Every handler is wrapped in `useCallback`. Refs mirror state that the long-lived tracker closure needs to read, such as `barrelRollingRef`. Styling is Tailwind utility classes with inline styles for gradients, and there's no shadcn component usage.
- **Verification habit:** always run `pnpm --filter @workspace/3d-game run typecheck`, and check visual changes in a real browser with a webcam.

---

## 8. Replit-specific pieces and what to change to run elsewhere

| Item | What it does | Off-Replit action |
|---|---|---|
| `.replit` | `modules = ["nodejs-24"]`, autoscale deployment, `postMerge` hook, agent stack `PNPM_WORKSPACE` | Ignore it. Use Node 22+ and pnpm 10. |
| `artifacts/*/.replit-artifact/artifact.toml` | Declares each app's service, port (game **24982**, API 8080, mockup 8081), and env (`PORT`, `BASE_PATH`). The game deploys as a **static** site from `artifacts/3d-game/dist/public` with a `/* → /index.html` rewrite. | Set `PORT`/`BASE_PATH` yourself, or give them defaults in `vite.config.ts`. Any static host works (Netlify, Vercel, GitHub Pages, S3). Add the SPA rewrite, though it's only cosmetic because there's no router. |
| `vite.config.ts` | **Throws** if `PORT` or `BASE_PATH` is missing. Loads `@replit/vite-plugin-runtime-error-modal` always, and cartographer/dev-banner only when `REPL_ID` is set. | Default `PORT` to 5173 and `BASE_PATH` to `/`. Optionally drop the runtime-error-modal plugin. |
| `pnpm-workspace.yaml` `overrides` | **Strips the native binaries for every platform except linux-x64-gnu**: esbuild, rollup, lightningcss, the tailwind oxide engine, and ngrok. | **On macOS, Windows or Linux arm64, `pnpm install` produces a toolchain that can't run** (rollup, esbuild and tailwind can't find a native binary). Delete those override lines and regenerate the lockfile to develop anywhere other than linux-x64. Keep the `esbuild: 0.27.3` and `@esbuild-kit/esm-loader` security overrides. |
| `minimumReleaseAge: 1440` | Supply-chain guard: packages must be at least 1 day old, with an exception for `@replit/*`. | Keep it. It needs pnpm 10.16 or later. |
| `scripts/post-merge.sh` | Runs `pnpm install --frozen-lockfile && pnpm --filter db push` after Agent merges. | Not needed. `db push` fails without `DATABASE_URL`. |
| `.replitignore`, `.gitignore` `.local/` `.cache/` | Replit cache dirs. | Harmless. |
| Root dep `@replit/connectors-sdk` | Never imported anywhere. | Can be removed. |
| `index.html` meta | "Bird Flight — built on Replit. Update this description…" | Placeholder copy. Rewrite it. |
| `artifacts/mockup-sandbox`, `artifacts/api-server`, `lib/*` | Replit template scaffolding (the Canvas preview, and an Express + Drizzle + OpenAPI stack). | Not used by the game. It's safe to exclude or delete, but it breaks root `pnpm run build` without `PORT`. |

There is no Replit DB, Replit Auth or Replit secrets usage anywhere. The game is 100% client-side.

---

## 9. Known issues, bugs, fragile areas and tech debt

These come from code reading plus a headless run. None has been fixed.

### Gameplay and control bugs
1. **Steering and boost latch when the hand is lost.** `applyControls` returns early on `handDetected: false` before it updates `targetPitch`, `targetRoll` or `boosting`. If the hand leaves the frame mid-turn or mid-boost, the bird **keeps turning or boosting forever** until the hand comes back. `HandTracker` also never clears `fistActive` on hand loss, so boost can resume latched.
2. **The Ring Challenge can stall permanently.** A missed ring despawns only once it's 40 units behind *along its own normal*. If the player turns away (90° or a U-turn), missed rings never despawn. Once 6 are active, **no new rings spawn**. Clouds in `clouds.ts` and reef items in `underwater.ts` use the same axial-only despawn, so after a U-turn clouds can stop appearing.
3. **The world edge (sky dome).** The sky sphere (r = 900) and the 24 decorative clouds sit fixed at the world origin, and the camera's far plane is 1200. Once the bird has flown more than about 900 units (roughly 100 s at cruise speed), the gradient sky is left behind. You see the flat `scene.background` color instead, and the horizon clouds vanish.
4. **Island-edge teleport when diving.** When the bird swims underwater into an island's radius, `isOverWater` flips to false and the solid-ground floor (`height + 3.5`) **snaps the bird up through the surface instantly**.
5. **Frame-rate-dependent feel.** Every lerp (orientation 0.06, speed 0.04, camera 0.05, FOV 0.06, the tracker EMA 0.35, fish-school lerp 0.02) is per frame, not scaled by `dt`. The game behaves differently at 30, 60 and 144 Hz. Separately, `dt` is clamped to 0.05, so below 20 FPS everything runs in slow motion.
6. **Gestures that interfere with steering:**
   - Closing a fist moves the palm-center and fingertip landmarks, so boosting nudges steering. This is worst in Finger mode, where the tracked fingertip folds into the palm.
   - An upward flick is also a large pitch-up input.
   - A center captured outside the corner box makes `axisValue()` return 0 on that side, silently disabling steering in that direction.
   - Sensitivity is applied after the box mapping. At 0.5x the bird can never reach full pitch or roll, and at 2x it saturates at the middle of the box.
7. **Reef items float mid-water.** Reef items spawn at a random depth between -13 and -4, not on the seabed, and there is no visible seabed mesh, only caustic rings at y = -14. Coral heights use `geometry.boundingSphere`, which is always null because it's never computed, so the offset is always 0.8. Pooled reef items keep their original `kind`.
8. The skimming splash particles don't fade (the `PointsMaterial` issue in §6.9).

### Robustness and UX
9. **CDN failure is silent.** If `cdn.jsdelivr.net` is unreachable (offline, corporate proxy, China), calibration waits forever with no error and a console warning on every frame. The MediaPipe version is hard-coded in two places: `package.json` and the `locateFile` URL.
10. **Every startup error reads as "Camera access was blocked".** This includes a missing video element and MediaPipe init errors.
11. **Race on Back during "requesting".** If `getUserMedia` resolves after the user has gone back to the menu, a tracker and stream are still created and never stopped.
12. **Double-clicking Start Flying** can build two `GameEngine`s. There's no guard, and the first is orphaned with its rAF still running.
13. **No keyboard, mouse or touch fallback**, and no pause. You can't play or debug without a webcam, and mobile is effectively unsupported.
14. `surfaceSplash` isn't reset by `handleBackToMenu`.

### Performance
15. **The React app re-renders at the tracker rate.** `onUpdate` calls `setHandDetected`, `setBoosting` and `setStatusText` on every MediaPipe frame (about 30/s). Each call re-renders the whole ~1000-line `App` during flight.
16. **Per-frame allocations.** `GameEngine.update`, rings, clouds, underwater, splash and the ring guide create `new THREE.Vector3()` and `.clone()` in hot loops, which causes GC churn. `ocean.animateWater` also does a `key.split(',')` for every tile on every frame.
17. **Leaky disposal.** `GameEngine.dispose()` removes objects but doesn't dispose most geometries and materials: terrain, ocean tiles, sky, bird, clouds, rings and the underwater scene. It also never calls `renderer.forceContextLoss()`. Repeated play sessions leak GPU memory, and browsers cap live WebGL contexts at about 16.
18. **Unbounded cache.** `OceanManager.islandCache` grows forever during long flights.
19. **Main-thread stutter.** Tile generation is synchronous: crossing a tile boundary builds 7 tiles of noise on the main thread. MediaPipe also runs on the main thread, alongside a WebGL render with PCF shadows.
20. **Bundle size.** It's a single 844 kB JS chunk, mostly three.js and MediaPipe. The unused shadcn, Radix and react-query code is tree-shaken out, but it still costs install time. The 103 kB of CSS comes from the full shadcn theme and Tailwind.

### three.js deprecations (seen in the console on r185)
21. `THREE.Clock` is deprecated in favor of `THREE.Timer`.
22. `PCFSoftShadowMap` is deprecated and **silently falls back to `PCFShadowMap`**, so the "soft shadows" aren't soft.

### Tech debt
23. **Template leftovers:** about 55 unused shadcn components, the hooks, `pages/not-found.tsx`, the wouter/react-query/`@workspace/api-client-react` deps, the api-server, the mockup-sandbox, `lib/*`, and `@replit/connectors-sdk`.
24. **A god component and a god class.** `App.tsx` mixes UI, tracker lifecycle, canvas drawing and the calibration state machine. `GameEngine.update` is a roughly 170-line function.
25. **Duplication.** `ringBurst.ts` and `waterBurst.ts` are near-copies. `TerrainManager` and `OceanManager` duplicate the tiling logic with no shared interface type.
26. **No tests, no lint and no CI.** The pure math in `axisValue`, `applyDeadzone`, `recomputeBox`, the flick detector and the ring hit test is easy to unit-test and currently isn't.
27. **Inconsistent naming.** The repo is "Sky-Soarer", the UI is "Bird Flight", and the localStorage key is `bird-flight-best-score`.
28. **Stale `replit.md`** in places: API port 5000 vs 8080, and audio starting on "Continue".

---

## 10. Prioritized improvement ideas

**P0: correctness and playability**
1. On `handDetected: false`, ease `targetPitch` and `targetRoll` to 0 and clear `boosting`, while keeping the backflip check first. Also reset `fistActive` on hand loss.
2. Despawn rings, clouds and reef items by distance from the bird, or by an angle-aware test, rather than only by axial distance along the spawn-time forward.
3. Make the sky dome and decorative clouds follow the bird on XZ, the way the starfield already does.
4. Surface MediaPipe load failures in the UI with a timeout and a clear message. Consider self-hosting the MediaPipe assets under `public/` so there's no runtime CDN dependency.
5. Add a **keyboard and mouse fallback** (WASD or arrows, Space for boost, a key for backflip) behind the same `HandControlState` interface. This helps accessibility, users without a webcam, and debugging.

**P1: controls feel**

6. Make all lerps frame-rate independent with `1 - Math.exp(-k * dt)`, and use `THREE.Timer`.
7. While the fist is closing, freeze or hold the steering sample so boosting doesn't nudge steering. In Finger mode, consider a pinch or a thumb gesture for boost.
8. Validate calibration: the center must lie inside the box, and the box must have a minimum size. Offer a "use default box" quick start, and persist calibration in `localStorage` so returning players can skip it.
9. Make flick detection relative to the calibration box size, and suppress the pitch spike it causes.
10. Migrate from the legacy `@mediapipe/hands` to `@mediapipe/tasks-vision` `HandLandmarker`, which is maintained, supports a GPU delegate, and can run in a worker.

**P2: performance**

11. Throttle React updates from the tracker, sending only changed values, or move HUD status into a ref plus a small subscribed component.
12. Remove per-frame `Vector3` allocations by using scratch vectors.
13. Dispose geometries, materials and textures properly, and call `forceContextLoss()` on engine teardown.
14. Generate tiles incrementally (one per frame) or in a worker. Bound `islandCache`.
15. Code-split: lazy-load MediaPipe and three. Drop the unused shadcn, Radix and react-query packages to shrink the bundle.

**P3: visuals and gameplay**

16. Fix the splash fade by reusing the burst `ShaderMaterial`, and deduplicate the burst classes into one configurable `ParticleBurst`.
17. Add a real seabed mesh, anchor reef items to it, and add a double-sided or underside water surface with a Snell's-window look from below.
18. Use real soft shadows (VSM, or PCF with a larger radius), and optionally postprocessing (bloom for rings and emissive reef, real motion blur).
19. Gameplay: timed ring runs, a combo multiplier, trick scoring, collectibles underwater, day and night that changes over time, and live weather switching.
20. Allow switching bird, map or weather without re-calibrating: keep the tracker and rebuild only the engine.

**P4: code quality**

21. Delete the template scaffolding, or move it out of the workspace, so `pnpm run build` works standalone.
22. Remove the linux-x64-only `overrides` so contributors on macOS, Windows or arm can install. Give `PORT` and `BASE_PATH` sensible defaults.
23. Add a `MapEnvironment` interface for Terrain and Ocean, split `App.tsx` into screens and hooks (`useHandTracker`, `useGameEngine`), and break `GameEngine.update` into named steps.
24. Add Vitest unit tests for the tracker math and ring hit tests, plus ESLint and Prettier configs, and a CI workflow that runs typecheck, build and tests.

---

## 11. Gotchas for future changes

- Don't start the camera or audio before a user gesture. Camera and tracking start on **Continue to Calibration**, and wind audio starts on **Start Flying**.
- Don't fold the trick sweep into the steering angles (see memory note).
- Don't move the `state.backflip` check below the `handDetected` guard in `applyControls`.
- Don't re-throw from the `hands.send()` catch.
- Don't "fix" the mirrored overlay or drag math without reading the two canvas-mirror memory notes. The un-mirror at draw time and the *absence* of a flip in pointer handling are both intentional.
- To flip a bird's facing direction, change the yaw offset on the outer group, never the mesh (see `three-js-mesh-orientation-fix.md`).
- When adding a map, implement `update(position)` and `heightAtWorld(x, z)`. Add `isOverWater` if it has water, and wire it in the `GameEngine` constructor.
- The WebGL scene can't be verified in most headless screenshot sandboxes. Use a real browser, or SwiftShader flags as described in §3.
