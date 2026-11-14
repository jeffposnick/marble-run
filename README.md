# Marble Run

A live, playable 3D marble run for the browser. Snap track pieces together on a grid, drop
marbles, and watch them roll through your run with real physics, all while you keep building.

## Getting started

```sh
npm install
npm run dev       # start the Vite dev server
npm run build     # type-check and build to dist/
npm run preview   # serve the production build
```

## Playing

- Pick a piece from the toolbar, then click a square on the table to place it.
- A piece placed next to an open track end (green arrow) **snaps on automatically**, taking the
  right height and direction. Otherwise it goes at the build height shown in the toolbar.
- **Drop marble** releases a marble from every start piece. **Auto-drop** keeps them coming.
- **Sound** toggles the sound effects (or press `S`).
- Drag to orbit, right-drag to pan, scroll to zoom.
- Everything works from the keyboard too: focus the board, use the arrow keys to move the cursor,
  and press Enter to place. Press `?` for the full list of shortcuts.

Your run is saved in the browser automatically.

### Offline and installing

Marble Run is a Progressive Web App. After the first visit everything it needs is cached, so it
works with no network at all. Browsers that support installing web apps show an **Install app**
button in the top bar; on iPhone and iPad, use **Share → Add to Home Screen**. When a new version
is deployed, an **Update** button appears; the page only reloads when you choose it, so an update
never interrupts a build.

### Pieces

| Piece       | Drop     | Notes                                     |
| ----------- | -------- | ----------------------------------------- |
| Start       | 1 level  | Closed at the back; marbles spawn here    |
| Straight    | 1 level  | Gentle straight channel                   |
| Ramp        | 4 levels | Steep straight drop                       |
| Curve left  | 1 level  | Quarter turn                              |
| Curve right | 1 level  | Quarter turn                              |
| Finish cup  | —        | Bowl that catches marbles and counts them |

## How it works

| Layer     | Choice                                                                  |
| --------- | ----------------------------------------------------------------------- |
| Rendering | [three.js](https://threejs.org/) (WebGL 2)                              |
| Physics   | [Rapier](https://rapier.rs/) (Rust compiled to WASM), fixed 120 Hz step |
| Build     | Vite + TypeScript                                                       |
| Offline   | Workbox via `@vite-pwa/workbox-*` (no `vite-plugin-pwa`)                |
| Quality   | oxlint, oxfmt, Vitest                                                   |

- **Snapping model** (`src/model/board.ts`): every piece occupies one grid cell. Its entry and
  exit ports sit at whole "levels" (10 cm). A piece's exit is `drop` levels below its entry, so
  joining an exit to the next piece's entry fixes that piece's height and rotation.
- **Geometry** (`src/geometry/track.ts`): each piece sweeps a U-shaped channel profile along its
  centre line. Heights follow a cubic Hermite curve whose gradient at both ends is the same fixed
  slope, so pieces meet without a kink. The same triangles drive both rendering and physics.
- **Physics** (`src/physics/world.ts`): all track surfaces merge into one Rapier triangle mesh.
  Vertices are snapped to a fine grid so the seams between pieces are welded, and
  `FIX_INTERNAL_EDGES` removes the bumps a marble would otherwise feel at triangle edges. Marbles
  are glass-density spheres with continuous collision detection.
- **Sound** (`src/audio/sound.ts`): every effect is synthesised live with the Web Audio API, with
  no audio files. Each rolling marble drives filtered noise whose pitch and loudness follow its
  speed, plus a narrow resonance for the hollow plastic channel and a once-per-revolution
  wobble. Rapier collision events, measured by how much they change a marble's velocity, trigger
  glassy "tinks" between marbles and plastic knocks on the track. Sounds are panned and
  attenuated by their position relative to the camera.
- **PWA**: the service worker is `src/sw.ts`, written against `@vite-pwa/workbox-swkit` (subpath
  imports only) and bundled by `@vite-pwa/workbox-build`'s `ViteWorkboxPWAPlugin`, which injects
  the precache list. It precaches every built file, including the ~4.3 MB physics chunk with its
  inlined WASM (`maximumFileSizeToCacheInBytes` is raised for it). The manifest is `MANIFEST` in
  `vite.config.ts`. `src/app/pwa.ts` registers the worker with `@vite-pwa/workbox-window`, shows
  the "ready offline" and "update" toast, and handles the install button. New runtime asset types
  must be added to `globPatterns` to be precached. The dev server registers no service worker.
- **Rendering** (`src/render/`): marbles are interpolated between physics steps so motion is
  smooth at any display refresh rate. The canvas is sized to its exact device-pixel box with a
  `ResizeObserver`.

## Scripts

| Script           | What it does                                 |
| ---------------- | -------------------------------------------- |
| `npm run dev`    | Dev server with hot reload                   |
| `npm run build`  | Type-check, then production build            |
| `npm test`       | Unit tests plus a headless physics run       |
| `npm run lint`   | oxlint                                       |
| `npm run format` | Format with oxfmt (`format:check` to verify) |
| `npm run check`  | Format check, lint, type-check and tests     |

### PWA tools

| Command                            | What it does                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `node tools/pwa-check.cjs`         | End-to-end check of a production build (see below)                           |
| `node tools/icons/render.cjs`      | Renders `tools/icons/icon.svg` to the PNG app icons                          |
| `node tools/icons/screenshots.cjs` | Captures the install-dialog screenshots (needs `npm run dev -- --port 5174`) |

To run the PWA check, serve the build with a server that re-reads files on every request:

```sh
npm run build && python3 -m http.server 4175 --directory dist &
node tools/pwa-check.cjs --update
```

It confirms the app is installable, works offline (physics included), and that a rebuilt version
is offered as an update and loads when chosen.

The physics test drops a marble on the demo track in Node, with no browser, and checks that it
reaches the finish cup. Use it to catch geometry or tuning regressions.

## Deployment

Every push to `main` (including merged pull requests) runs
`.github/workflows/deploy.yml`. It checks and builds the project, then publishes `dist/` to
GitHub Pages. To make this work, set **Settings → Pages → Build and deployment → Source** to
**GitHub Actions** once.
