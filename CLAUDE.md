# CLAUDE.md — Sky Soarer ("Bird Flight")

Guidance for Claude Code (and humans) working in this repository. The repo is named **Sky Soarer**, and the game calls itself **Bird Flight** in its UI, `<title>` and `replit.md`. It was built on Replit with Replit Agent. It has since been cleaned into a standalone game repo that builds on any OS, deploys to Vercel as a static site, and still runs on Replit.

- `replit.md` is the original agent's running notes. It is kept unchanged as history, but **it is stale**: it describes template packages that have been deleted (api-server, db, mockup-sandbox), a port-5000 API server, and audio starting on "Continue". Where the two disagree, this file wins.
- `.agents/memory/*.md` holds lessons that agent recorded while fixing bugs. Read them before you touch the controls or tricks.

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
   - Steering always tracks the **palm center**. An Index Finger mode existed earlier and was removed.
   - Capture 5 points: the neutral center, then the top-left, top-right, bottom-left and bottom-right corners of your comfortable range.
   - Once a corner is captured you can drag it on the preview to fine-tune it.
   - Set steering sensitivity from 0.5x to 2.0x.
   - **Start Flying** stays disabled until all 5 points are captured.
3. **Flight.**
   - Move your palm inside the calibrated box to pitch and roll. Roll banks the bird, and banking turns it.
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
| Monorepo | pnpm workspace with a single package, `artifacts/3d-game` | pnpm **10.33.0**, pinned in `packageManager` (lockfile v9). `minimumReleaseAge: 1440` needs pnpm 10.16+. |
| Language | TypeScript | ~5.9.3 |
| Runtime | Node | `engines: >=20.19` (Vite 7's minimum). Replit uses `nodejs-24`, and Node 22.22 is verified. |
| Bundler / dev server | Vite | ^7.3.2 (7.3.6 resolved) |
| UI | React / React DOM | 19.1.0 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) with `tw-animate-css` and `@tailwindcss/typography` imported in `index.css` | ^4.1.14 (4.3.3 resolved) |
| Icons | lucide-react | ^0.545.0 |
| 3D | three (vanilla, **no** React Three Fiber) | ^0.185.1 (`@types/three` ^0.185.3) |
| Hand tracking | `@mediapipe/hands` (legacy "Solutions" API), assets self-hosted | **0.4.1675469240**, pinned exactly; this `package.json` entry is the only place the version lives |
| Noise | simplex-noise (v4 `createNoise2D`) | ^4.0.3 |
| Audio | Web Audio API, fully synthesized (no audio files) | — |
| Replit-only dev plugins | `@replit/vite-plugin-runtime-error-modal`, `-cartographer`, `-dev-banner` | loaded only when `REPL_ID` is set |

- Runtime libraries are listed in `dependencies`, and build tooling in `devDependencies`, in `artifacts/3d-game/package.json`.
- Shared versions come from the `catalog:` block in `pnpm-workspace.yaml`.
- The only root devDependencies are `typescript` and `prettier`.

---

## 3. Running locally

### Commands (run from the repo root; no env vars needed)

```bash
pnpm install --frozen-lockfile   # ~2 s warm; the root preinstall script refuses npm/yarn
pnpm dev                         # Vite dev server  -> http://localhost:5173/
pnpm run typecheck               # tsc --noEmit for the game
pnpm run build                   # typecheck, then vite build -> artifacts/3d-game/dist/public
pnpm preview                     # serve the production build -> http://localhost:4173/
```

These are aliases for `pnpm --filter @workspace/3d-game run dev|build|serve|typecheck`. Both servers bind `0.0.0.0`. The dev server uses `strictPort`.

Results of a verification run (Linux x64, Node 22.22.2, pnpm 10.33.0, no `PORT`/`BASE_PATH`/`REPL_ID` set):

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm run typecheck` passes.
- `pnpm run build` succeeds from the root. It emits a 1.7 kB `index.html`, 31 kB of CSS, one 837 kB JS chunk (232 kB gzip), and about 24 MB of MediaPipe files under `mediapipe/hands/`. Vite prints its "chunk larger than 500 kB" warning.
- The Vercel commands (`npx --yes pnpm@10.33.0 install --frozen-lockfile` and `… run build`) also succeed in a shell with **no global pnpm**. The nested `pnpm` calls in the root scripts resolve to the npx-provided pnpm.
- The dev server starts on 5173 with defaults. It also starts with Replit's env (`PORT=24982 BASE_PATH=/ REPL_ID=…`), and then the Replit plugins load.
- Headless Chromium with a fake camera, and **every non-localhost request blocked**, reached the calibration screen on the production preview. Deep links such as `/some/route` return `index.html`. The startup error paths were also exercised in headless runs; see the P0 PR's test notes.
- The lockfile now includes native binaries for every OS and CPU (esbuild, rollup, lightningcss, the tailwind oxide engine). Actual installs on macOS or Windows haven't been tested yet.

### Environment variables (all optional)

| Var | Default | Notes |
|---|---|---|
| `PORT` | 5173 for dev, 4173 for preview | Replit sets 24982 through `artifact.toml`. An invalid value throws. |
| `BASE_PATH` | `/` | Becomes Vite `base`. Set it only when serving from a sub-path. |
| `REPL_ID` | unset | Set automatically inside a Repl. When set, it loads `runtime-error-modal`, plus `cartographer` and `dev-banner` in non-production builds. |

The game needs **no secrets, no backend and no database**.

### Browser, webcam and network requirements

- A **secure context** (`https://` or `http://localhost`), because `getUserMedia` refuses plain-HTTP LAN IPs. Vercel deployments are HTTPS.
- A webcam. The app requests 480×360 with `facingMode: 'user'`.
- **WebGL.** WebGL2 is preferred, since three r185 targets it.
- **No third-party network access is needed at runtime.**
  - The MediaPipe wasm, packed graph `.data` and `.tflite` files are **self-hosted**. `vite-plugin-mediapipe-assets.ts` serves them from `node_modules/@mediapipe/hands` in dev and emits them into `dist/public/mediapipe/hands/` at build time. `locateFile` in `handControls.ts` points at `${BASE_URL}mediapipe/hands/`.
  - This adds about 24 MB to the deploy. A session downloads about 13 MB: `hands_solution_simd_wasm_bin.wasm` (6 MB), `hands_solution_packed_assets.data` (4.3 MB) and `hand_landmark_lite.tflite` (2 MB). The non-SIMD wasm and the `full` model are shipped as fallbacks and are only fetched if needed.
  - Google Fonts (Inter) is the only external request, and the UI falls back to system fonts without it.
  - If the files can't load, or the load (including the first frame through the graph) takes more than **30 s**, the startup screen shows a specific error with **Try Again**.
- A desktop Chromium, Edge or Firefox with a decent GPU is the target. Mobile isn't designed for: there's no touch fallback, and the layout assumes a large screen.
- In headless screenshot tools, WebGL often fails with no GPU. Launch Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` to render, and expect very low FPS.

### Deploying

- **Vercel:** `vercel.json` at the repo root holds everything:
  - the framework preset is set to "Other" (`"framework": null`)
  - install and build use a pinned pnpm through `npx`
  - `outputDirectory` is `artifacts/3d-game/dist/public`
  - there's an SPA rewrite to `/index.html`; Vercel serves real files first, so assets are unaffected

  Leave the project's Root Directory as the repo root.
- **Replit:** `.replit` plus `artifacts/3d-game/.replit-artifact/artifact.toml` handle dev on port 24982 and a static production deploy from the same `dist/public`.
- **Any other static host:** run `pnpm run build`, publish `artifacts/3d-game/dist/public`, and add a catch-all rewrite to `/index.html`. The rewrite is optional, because there's no client router.

---

## 4. Repository map

```
.
├── artifacts/
│   └── 3d-game/               # ★ THE GAME (@workspace/3d-game) — the only workspace package
│       ├── .replit-artifact/artifact.toml   # Replit service config (port 24982, static deploy, SPA rewrite)
│       ├── index.html         # <title>Bird Flight</title>, meta/OG description, Google Fonts Inter, favicon
│       ├── vite.config.ts     # PORT/BASE_PATH defaults; Replit plugins only when REPL_ID is set; @ -> src
│       ├── vite-plugin-mediapipe-assets.ts # serves/emits the MediaPipe runtime files under mediapipe/hands/
│       ├── public/            # favicon.svg, robots.txt (copied as-is into dist/public)
│       └── src/
│           ├── main.tsx       # createRoot(<App/>)
│           ├── App.tsx        # ★ all React UI: menu, calibration wizard, HUD, state machine (~1030 lines)
│           ├── index.css      # Tailwind v4 + theme tokens (warm pastel palette)
│           └── game/          # ★ framework-free Three.js game code
│               ├── GameEngine.ts   # renderer, scene, loop, flight physics, camera, lighting/weather, underwater state machine
│               ├── handControls.ts # MediaPipe wrapper: load + frame loop, calibration box, fist/flick gestures, TrackingStartError
│               ├── bird.ts         # 4 procedural low-poly birds + wing flap
│               ├── terrain.ts      # Mountain Valley: streamed simplex-noise tiles
│               ├── ocean.ts        # Ocean: streamed tiles, hashed islands, animated water verts, foam band
│               ├── underwater.ts   # reef/fish/shark/caustics/bubbles (lazy-built)
│               ├── clouds.ts       # flyable cloud clusters in the flight corridor
│               ├── rings.ts        # Ring Challenge spawning + hit test
│               ├── ringGuide.ts    # arrow pointing to nearest ring
│               ├── ringBurst.ts    # star-burst particles (custom ShaderMaterial)
│               ├── waterBurst.ts   # surfacing droplet particles (copy of ringBurst, retuned)
│               ├── splash.ts       # skimming spray particles (PointsMaterial – fade is broken)
│               ├── audio.ts        # WindAudio (filtered noise) + SoundEffects (ring chime)
│               └── highscore.ts    # localStorage best score ("bird-flight-best-score")
├── attached_assets/           # the two feature-request prompts the user pasted into Replit Agent (history only)
├── .agents/memory/            # Replit Agent's lessons-learned notes (read these!)
├── .replit, .replitignore     # Replit workspace config
├── vercel.json                # Vercel static deploy config
├── package.json               # root scripts (dev/build/preview/typecheck), packageManager pnpm@10.33.0
├── pnpm-workspace.yaml        # workspace glob, version catalog, minimumReleaseAge, security overrides
├── pnpm-lock.yaml
├── tsconfig.base.json         # shared strict-ish TS options (strictFunctionTypes: false, noUnusedLocals: false)
└── replit.md                  # original agent notes (kept as is; partly stale)
```

The game still sits in the `artifacts/3d-game` pnpm-workspace layout. Replit's `PNPM_WORKSPACE` agent stack and its artifact system expect that layout, so moving it would break Replit.

---

## 5. Architecture and data flow

```
 getUserMedia (App) ──► <video hidden> ──► HandTracker rAF loop ──► Hands.send()  (self-hosted wasm + model)
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
- **Top-level state** is a string union in `App.tsx`: `FlightState = 'menu' | 'requesting' | 'calibrating' | 'flying' | 'error'`. When the state is `'error'`, `startupError: { kind, detail }` picks the message. Everything else is local `useState` plus refs. There is no store, context or router.
- **Startup sequence** (`handleContinueToCalibration`):
  1. Check `isSecureContext` and that `getUserMedia` exists.
  2. Call `getUserMedia` (the **only** camera stream; `@mediapipe/camera_utils` was removed because it opened a second stream).
  3. Call `video.play()`.
  4. Construct `new HandTracker(video, onUpdate)` and register it in `trackerRef`.
  5. `await tracker.start()` loads the files, runs a warm-up frame, and starts the loop.
  6. Switch to `'calibrating'`.

  Any failure goes through `classifyStartupError()`:

  | Cause | Error kind |
  |---|---|
  | `NotAllowedError` / `SecurityError` | `permission-denied` |
  | `NotFoundError` / `OverconstrainedError` | `no-camera` |
  | `NotReadableError` / `AbortError` | `camera-in-use` |
  | `NotSupportedError` | `unsupported` |
  | `TrackingStartError` | `tracking-load-failed` / `tracking-timeout` |
  | anything else | `unknown` |

  Each kind has its own text in `STARTUP_ERROR_MESSAGES`.
- **Session ids guard async startup.** Each attempt takes `++sessionIdRef.current`, and `stopEverything()` also increments it. After every `await`, a superseded attempt (for example, the player pressed Back while the permission prompt was open) releases its own stream and tracker and returns without touching UI state.
- **One `HandTracker` per session.** It is created on the user click and reused through calibration and flight. Calibration state (center, box, sensitivity) lives **inside the tracker**. The engine only ever sees normalized `pitch`/`roll` in `-1..1`.
- **Engine options are fixed at construction.** Bird, map, weather and ring mode can't change mid-flight. Changing them means stopping and restarting.
- **Teardown.** `stopEverything()` bumps the session id, stops the tracker, disposes the engine, cancels the preview rAF, and stops the MediaStream tracks. Back and Stop Game both call it. `handleStartFlying` is guarded by `startingFlightRef`/`engineRef`, so a double click builds only one engine. It also bails out if Back disposed the engine while `engine.start()` was awaiting.

---

## 6. How each system works

### 6.1 Rendering (`GameEngine.ts`)
- `WebGLRenderer({antialias, powerPreference:'high-performance'})`, with pixel ratio capped at 2, sRGB output, and shadow maps on.
- `PerspectiveCamera` with FOV 58, rising to 72 on boost (50 and 60 underwater), near 0.1, far 1200.
- **Sky.** An inverted sphere of radius 900 with vertex-color gradient from the `WEATHER_LOOKS` preset, plus 24 decorative cloud clusters. On Starry Night there's also a 900-point starfield that follows the bird on XZ. The sky sphere, the decorative cloud group (`skyClouds`) and the starfield all **follow the bird on XZ** every frame, so the world never flies out of the backdrop.
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
  - **Islands are solid underwater.** While submerged, a move that would enter an island's footprint (`!isOverWater`) slides along the edge: it keeps only the X or only the Z part of the move, or blocks the horizontal move entirely. Before this, the solid-ground floor snapped the bird up through the surface.
  - Over open water the only floor is `SEABED_FLOOR_Y = -15`.
  - The ceiling is y = 140.
  - The bird starts at (0, 26, 0) heading +Z.
- **Camera.** A chase camera 6.5 behind and 2.2 above the bird, looking 8 units ahead, with a per-frame lerp of 0.05 (0.03 underwater).
- **Hand loss.** On `handDetected: false`, `applyControls` first handles the backflip fallback. It then sets `targetPitch`/`targetRoll` to 0 and `boosting` to false, so the bird eases back to level cruise instead of latching the last input.
- **Timing.** `dt` is clamped to 0.05 s, so below 20 FPS the simulation runs in slow motion.
- **Wing flaps.** Flap rate is mapped from speed onto 7–17, times 0.55 when gliding in a dive (pitch below -0.15 and not boosting), and uses a gentle paddle stroke underwater.

### 6.3 Hand tracking (`handControls.ts`)
- **MediaPipe options:**
  - `maxNumHands: 1`
  - `modelComplexity: 0`, the lite model
  - `selfieMode: false`, so mirroring is done manually
  - detection confidence 0.6, tracking confidence 0.5

- **Loading and frame loop.**
  - `locateFile` resolves to `${import.meta.env.BASE_URL}mediapipe/hands/<file>`. That path must match `PUBLIC_DIR` in `vite-plugin-mediapipe-assets.ts`.
  - `start()` runs `hands.initialize()` plus one warm-up `send()` (which fetches the model) under a 30 s `withTimeout`. A failure throws `TrackingStartError('load-failed' | 'timeout')`.
  - The tracker then runs its **own rAF loop** on the video the app already started. It sends a frame only when `video.currentTime` has advanced, and `stop()` cancels the rAF.
  - The tracker never opens or stops the camera: `App` owns the `MediaStream`.
- **Frame pipeline** in `handleResults`:
  1. Compute the palm center, the mean of landmarks 0, 5, 9, 13 and 17.
  2. The palm center is the only tracked point. Finger mode was removed.
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
  - Hand loss resets `fistActive`, so boost can't come back latched when the hand reappears.
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
- **Despawn.** A missed ring is recycled once it is 40 units *past* along its own normal (`axialDist > 40`; `delta` points from the ring to the bird), **or** once it is more than 120 units from the bird in any direction. The distance check covers turns and U-turns.
  - Before this fix the sign was inverted (`< -40`), so every ring spawned 42+ units ahead was recycled in the frame it spawned. Ring Challenge never showed a ring.
  - Clouds use the same two-part rule: past 60 axially, or more than 240 away. Reef items do too: past 42 axially, or more than 80 away horizontally.
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
- **Pool and stream around the bird.** Objects spawn ahead of the bird along `forward` and are reused through `visible = false` and a pool array. They're recycled once they're some distance *behind* along their spawn-time forward, **or** beyond a max distance from the bird. Always include the distance cap, or a U-turn can fill the pool with unreachable objects and stop spawning. Terrain and ocean tiles are keyed by `"x,z"` strings.
- **Tune with constants at the top of each file**, in `UPPER_SNAKE_CASE` with a comment explaining the *why*. Change these rather than inlining magic numbers.
- **Generate assets procedurally.** Meshes are built from three primitives with `flatShading: true`, textures from `<canvas>`, and sound from Web Audio. There are no binary assets, and it's worth keeping it that way.
- **Comments are dense and explain intent**, often pointing to `.agents/memory/*`. Match that density in `src/game/`.
- **Style:**
  - 2-space indent, single quotes, semicolons, trailing commas, about 120 columns.
  - Prettier is installed but there's no config file, so defaults apply apart from the quote style already used in the code.
  - There's no ESLint and **no tests**.
- **Imports.** Use the `@/` alias for `src`. Use `import * as THREE from 'three'`. Put `type` imports inline, as in `import { Bird, type BirdType }`.
- **React style.** One big `App` function component. Every handler is wrapped in `useCallback`. Refs mirror state that the long-lived tracker closure needs to read, such as `barrelRollingRef`. Styling is Tailwind utility classes with inline styles for gradients. There's no component library: the shadcn scaffold was removed. Theme tokens such as `bg-card` and `text-primary` still come from `index.css`.
- **Verification habit:** always run `pnpm run build` from the root, which also typechecks, and check visual changes in a real browser with a webcam.
- **Dependencies:** anything imported at runtime goes in the game's `dependencies`, and build tooling in `devDependencies`. Prefer `catalog:` versions for shared tooling. New packages must be at least 1 day old (`minimumReleaseAge`). Don't reintroduce platform-specific `overrides`.

---

## 8. Replit-specific pieces (kept, and still working)

| Item | What it does | Elsewhere |
|---|---|---|
| `.replit` | `modules = ["nodejs-24"]`, autoscale deployment with a `pnpm store prune` post-build, agent stack `PNPM_WORKSPACE`. The `postMerge` hook was removed along with `scripts/post-merge.sh`, which ran `pnpm --filter db push` for the deleted db package. | Ignored. |
| `artifacts/3d-game/.replit-artifact/artifact.toml` | Declares the game service on **port 24982**, sets `PORT=24982` and `BASE_PATH=/`, runs `pnpm --filter @workspace/3d-game run dev` in development, and deploys the build **statically** from `artifacts/3d-game/dist/public` with a `/* → /index.html` rewrite. | Ignored. Vercel uses `vercel.json`. |
| `vite.config.ts` Replit plugins | `@replit/vite-plugin-runtime-error-modal`, plus `cartographer` and `dev-banner` in non-production builds, are imported dynamically **only when `REPL_ID` is set**. | Not loaded. They're still installed as devDependencies, so Replit keeps working. |
| `PORT` / `BASE_PATH` | Injected by `artifact.toml` on Replit. | Optional. Defaults are 5173 or 4173 and `/`. |
| `pnpm-workspace.yaml` `minimumReleaseAgeExclude: '@replit/*'` | Lets Replit's own packages bypass the 1-day release-age guard. | Harmless. |
| `.replitignore`, `.gitignore` `.local/` `.cache/` | Replit cache directories. | Harmless. |
| `replit.md`, `.agents/memory/`, `attached_assets/` | Replit Agent's notes, memories and pasted prompts. | Documentation and history only. |

What was removed to make the repo standalone:
- **Deleted packages:** `artifacts/api-server` (the Express health-check template), `artifacts/mockup-sandbox` (Replit's Canvas preview) and `lib/*` (api-spec, api-zod, api-client-react, db).
- **Deleted scripts:** `scripts/`, including `post-merge.sh` and its hook.
- **Deleted game files:** 55 unused shadcn components, `hooks/`, `pages/`, `lib/utils.ts` and `components.json`.
- **Dropped dependencies:** the unused `@replit/connectors-sdk`, wouter, react-query, Radix, zod, framer-motion and other scaffold deps.
- **Removed overrides:** the linux-x64-only native-binary overrides in `pnpm-workspace.yaml`. The lockfile now carries every platform's esbuild, rollup, lightningcss and tailwind binaries.
- **Kept overrides:** the `esbuild: 0.27.3` and `@esbuild-kit/esm-loader → tsx` security overrides, and `minimumReleaseAge: 1440`.

There is no Replit DB, Replit Auth or Replit secrets usage anywhere. The game is 100% client-side.

---

## 9. Known issues, bugs, fragile areas and tech debt

These come from code reading plus headless runs.

**Fixed so far, and removed from this list:**
- **Standalone cleanup (earlier PR):** env vars were required, installs only worked on linux-x64, template scaffolding, and a placeholder meta description.
- **P0 correctness pass:**
  - steering and boost latched on hand loss
  - rings, clouds and reef stalled after U-turns
  - the Ring Challenge's inverted despawn sign
  - the sky dome and horizon clouds were left behind
  - the island-edge teleport underwater
  - a silent MediaPipe CDN failure
  - the generic "Camera access was blocked" error
  - the Back-during-requesting race
  - a double-click could build two engines
  - `surfaceSplash` wasn't reset
  - the second camera stream opened by `camera_utils`
  - the Index Finger mode

### Gameplay and control bugs
1. **Frame-rate-dependent feel.** Every lerp (orientation 0.06, speed 0.04, camera 0.05, FOV 0.06, the tracker EMA 0.35, fish-school lerp 0.02) is per frame, not scaled by `dt`. The game behaves differently at 30, 60 and 144 Hz. Separately, `dt` is clamped to 0.05, so below 20 FPS everything runs in slow motion.
2. **Gestures that interfere with steering:**
   - Closing a fist shifts the palm-center landmarks slightly, so boosting nudges steering.
   - An upward flick is also a large pitch-up input.
   - A center captured outside the corner box makes `axisValue()` return 0 on that side, silently disabling steering in that direction.
   - Sensitivity is applied after the box mapping. At 0.5x the bird can never reach full pitch or roll, and at 2x it saturates at the middle of the box.
3. **Reef items float mid-water.** Reef items spawn at a random depth between -13 and -4, not on the seabed, and there is no visible seabed mesh, only caustic rings at y = -14. Coral heights use `geometry.boundingSphere`, which is always null because it's never computed, so the offset is always 0.8. Pooled reef items keep their original `kind`.
4. The skimming splash particles don't fade (the `PointsMaterial` issue in §6.9).
5. **Surface-level island pop.** A bird skimming *above* the water that flies into an island is still lifted to `height + 3.5` in one frame. Near the shore that's about 3.5 units. Only the underwater case was fixed.

### Robustness and UX
6. **No keyboard, mouse or touch fallback**, and no pause. You can't play or debug without a webcam, and mobile is effectively unsupported.
7. **Tall cards get clipped.** The menu, calibration and startup cards use `flex items-center justify-center overflow-y-auto`. When a card is taller than the window (the menu at a 720 px height), its top is cut off and **can't be scrolled to**, which can hide the calibration **Back** button. The usual fix is `my-auto` on the card, or `justify-start` combined with `min-h-full`.
8. **Cryptic load-error detail.** When a MediaPipe file 404s, the detail under the friendly message is minified MediaPipe internals such as `TypeError: jt is not a function`. The friendly message is correct, but the detail line doesn't help users.
9. **The SPA rewrite hides missing MediaPipe files.** The SPA rewrites on Vercel and Replit return `index.html` for any missing file. If the `mediapipe/hands/` files were ever missing from a deploy, MediaPipe would receive HTML and fail. The startup error screen now reports this.

### Performance
10. **The React app re-renders at the tracker rate.** `onUpdate` calls `setHandDetected`, `setBoosting` and `setStatusText` on every MediaPipe frame (about 30/s). Each call re-renders the whole ~1000-line `App` during flight.
11. **Per-frame allocations.** `GameEngine.update`, rings, clouds, underwater, splash and the ring guide create `new THREE.Vector3()` and `.clone()` in hot loops, which causes GC churn. `ocean.animateWater` also does a `key.split(',')` for every tile on every frame.
12. **Leaky disposal.** `GameEngine.dispose()` removes objects but doesn't dispose most geometries and materials: terrain, ocean tiles, sky, bird, clouds, rings and the underwater scene. It also never calls `renderer.forceContextLoss()`. Repeated play sessions leak GPU memory, and browsers cap live WebGL contexts at about 16.
13. **Unbounded cache.** `OceanManager.islandCache` grows forever during long flights.
14. **Main-thread stutter.** Tile generation is synchronous: crossing a tile boundary builds 7 tiles of noise on the main thread. MediaPipe also runs on the main thread, alongside a WebGL render with PCF shadows.
15. **Large downloads.** The JS is one 837 kB chunk (232 kB gzip) with no code splitting. On top of that, each session downloads about 13 MB of MediaPipe files.

### three.js deprecations (seen in the console on r185)
16. `THREE.Clock` is deprecated in favor of `THREE.Timer`.
17. `PCFSoftShadowMap` is deprecated and **silently falls back to `PCFShadowMap`**, so the "soft shadows" aren't soft.

### Tech debt
18. **A god component and a god class.** `App.tsx` mixes UI, tracker lifecycle, canvas drawing and the calibration state machine. `GameEngine.update` is a roughly 190-line function.
19. **Duplication.** `ringBurst.ts` and `waterBurst.ts` are near-copies. `TerrainManager` and `OceanManager` duplicate the tiling logic with no shared interface type.
20. **No tests, no lint and no CI.** The pure math in `axisValue`, `applyDeadzone`, `recomputeBox`, the flick detector, the ring hit test and despawn, and `classifyStartupError` is easy to unit-test and currently isn't. The ring despawn sign bug shipped unnoticed for exactly this reason.
21. **Inconsistent naming.** The repo and root package are "Sky Soarer" / `sky-soarer`, the UI is "Bird Flight", the game package is `@workspace/3d-game`, and the localStorage key is `bird-flight-best-score`.
22. **Stale `replit.md`.** It is kept as is by request (see the top of this file). It still describes Finger mode and the CDN.
23. **Untested installs.** The macOS, Windows and ARM installs are expected to work now that the platform overrides are gone, but they haven't been tested yet.
24. **The MediaPipe asset path lives in two places.** `PUBLIC_DIR` in `vite-plugin-mediapipe-assets.ts` and `MEDIAPIPE_ASSET_DIR` in `handControls.ts` must stay in sync.

---

## 10. Prioritized improvement ideas

**P0: playability**
1. Add a **keyboard and mouse fallback** (WASD or arrows, Space for boost, a key for backflip) behind the same `HandControlState` interface. This helps accessibility, users without a webcam, and debugging.
2. Fix the clipped tall cards (§9 #7), so Back and Start Flying are always reachable on small windows.

**P1: controls feel**

3. Make all lerps frame-rate independent with `1 - Math.exp(-k * dt)`, and use `THREE.Timer`.
4. While the fist is closing, freeze or hold the steering sample so boosting doesn't nudge steering.
5. Validate calibration: the center must lie inside the box, and the box must have a minimum size. Offer a "use default box" quick start, and persist calibration in `localStorage` so returning players can skip it.
6. Make flick detection relative to the calibration box size, and suppress the pitch spike it causes.
7. Migrate from the legacy `@mediapipe/hands` to `@mediapipe/tasks-vision` `HandLandmarker`, which is maintained, supports a GPU delegate, and can run in a worker.

**P2: performance**

8. Throttle React updates from the tracker, sending only changed values, or move HUD status into a ref plus a small subscribed component.
9. Remove per-frame `Vector3` allocations by using scratch vectors.
10. Dispose geometries, materials and textures properly, and call `forceContextLoss()` on engine teardown.
11. Generate tiles incrementally (one per frame) or in a worker. Bound `islandCache`.
12. Code-split: lazy-load MediaPipe and the engine after the menu. Consider dropping the unused `hand_landmark_full.tflite` from the build, since `modelComplexity` is 0.

**P3: visuals and gameplay**

13. Fix the splash fade by reusing the burst `ShaderMaterial`, and deduplicate the burst classes into one configurable `ParticleBurst`.
14. Add a real seabed mesh, anchor reef items to it, and add a double-sided or underside water surface with a Snell's-window look from below.
15. Use real soft shadows (VSM, or PCF with a larger radius), and optionally postprocessing (bloom for rings and emissive reef, real motion blur).
16. Gameplay: timed ring runs, a combo multiplier, trick scoring, collectibles underwater, day and night that changes over time, and live weather switching.
17. Allow switching bird, map or weather without re-calibrating: keep the tracker and rebuild only the engine.

**P4: code quality**

18. Add a `MapEnvironment` interface for Terrain and Ocean, split `App.tsx` into screens and hooks (`useHandTracker`, `useGameEngine`), and break `GameEngine.update` into named steps.
19. Add Vitest unit tests for the tracker math, ring hit and despawn tests, and `classifyStartupError`. Add ESLint and Prettier configs, and a GitHub Actions workflow that runs `pnpm install --frozen-lockfile && pnpm run build` on Linux, macOS and Windows.
20. Unify the naming (Sky Soarer vs Bird Flight), keeping the localStorage key backward-compatible.

---

## 11. Gotchas for future changes

- Don't start the camera or audio before a user gesture. Camera and tracking start on **Continue to Calibration**, and wind audio starts on **Start Flying**.
- Don't fold the trick sweep into the steering angles (see memory note).
- Don't move the `state.backflip` check below the `handDetected` guard in `applyControls`.
- Don't re-throw from the per-frame `hands.send()` catch. Startup failures are different: `start()` surfaces them as `TrackingStartError` so the UI can show them.
- Don't reintroduce `@mediapipe/camera_utils` or a CDN `locateFile`. The app owns the single `MediaStream`, and MediaPipe files are self-hosted. When bumping `@mediapipe/hands`, change only `package.json`, then check that the file list the plugin emits still matches what the new version requests.
- After every `await` in the startup flow, check the session id (`isCurrent()`) and release anything acquired if the attempt was superseded.
- Every pooled spawner needs a max-distance despawn as well as the "behind" check (see §7). Watch the sign of axial distances: `delta = bird - item`, so an item the bird has passed is **positive**.
- Don't "fix" the mirrored overlay or drag math without reading the two canvas-mirror memory notes. The un-mirror at draw time and the *absence* of a flip in pointer handling are both intentional.
- To flip a bird's facing direction, change the yaw offset on the outer group, never the mesh (see `three-js-mesh-orientation-fix.md`).
- When adding a map, implement `update(position)` and `heightAtWorld(x, z)`. Add `isOverWater` if it has water, and wire it in the `GameEngine` constructor.
- The WebGL scene can't be verified in most headless screenshot sandboxes. Use a real browser, or SwiftShader flags as described in §3.
