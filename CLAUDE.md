# Marble Run

## Workflow

- When you finish any piece of work, commit it and push it to `main`. Don't leave finished work on
  a feature branch or ask first. Every push to `main` deploys to GitHub Pages
  (`.github/workflows/deploy.yml`).
- Before committing, run `npm run check` (format check, lint, type-check and tests) and make sure it
  passes. Run `npx oxfmt` to fix formatting.

## Project notes

- See README.md for the architecture: three.js rendering, Rapier physics, Web Audio sound
  (`src/audio/sound.ts`), and the PWA setup.
- It's a PWA built from the `@vite-pwa/workbox-*` packages (no `vite-plugin-pwa`): the service
  worker is `src/sw.ts`, the manifest is `MANIFEST` in `vite.config.ts`, and registration is in
  `src/app/pwa.ts`. New runtime asset types must be added to `globPatterns` to be precached. After
  changing PWA behaviour, run `tools/pwa-check.cjs` (see README.md).
- After changing the top bar, check that it stays on one row from 320px up.
