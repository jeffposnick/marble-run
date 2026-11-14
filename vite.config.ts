import { ViteWorkboxPWAPlugin } from "@vite-pwa/workbox-build/build/vite/plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** The web app manifest: makes the app installable, with its name, colours and icons. */
const MANIFEST = {
  id: "./",
  name: "Marble Run",
  short_name: "Marble Run",
  description:
    "Build a marble run from snap-together pieces and watch marbles roll through it in real time.",
  lang: "en",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#e9eef5",
  theme_color: "#e9eef5",
  categories: ["games", "entertainment"],
  icons: [
    { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  screenshots: [
    {
      src: "screenshots/wide.png",
      sizes: "1280x800",
      type: "image/png",
      form_factor: "wide",
      label: "Building a marble run",
    },
    {
      src: "screenshots/narrow.png",
      sizes: "780x1688",
      type: "image/png",
      form_factor: "narrow",
      label: "Marbles rolling down the track",
    },
  ],
};

/** Writes `manifest.webmanifest` into the build and links it from index.html. */
function webManifest(manifest: object): Plugin {
  return {
    name: "marble-run:web-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: JSON.stringify(manifest),
      });
    },
    transformIndexHtml: () => [
      {
        tag: "link",
        attrs: { rel: "manifest", href: "./manifest.webmanifest" },
        injectTo: "head",
      },
    ],
  };
}

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path, e.g. GitHub Pages' /<repo>/.
  base: "./",
  build: {
    target: "es2023",
    // three and rapier (with its inlined WASM) are large but rarely change, so they get their own
    // long-lived chunks.
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three/ },
            { name: "rapier", test: /node_modules[\\/]@dimforge/ },
          ],
        },
      },
    },
  },
  plugins: [
    webManifest(MANIFEST),
    // Our own service worker (src/sw.ts, written against @vite-pwa/workbox-swkit). Once the app is
    // built, @vite-pwa/workbox-build bundles it into dist/sw.js and injects the precache list.
    // Registration and the "Update" prompt are in src/app/pwa.ts.
    ViteWorkboxPWAPlugin({
      strategy: "build-sw",
      buildSW: {
        swSrc: "src/sw.ts",
        swDest: "sw.js",
        // A single self-contained classic script: no module workers, no separate Workbox runtime.
        swType: "classic",
        inlineWorkboxRuntime: true,
        // Everything the app needs is precached, so it works fully offline. The screenshots are
        // only for the install dialog, so they're left out.
        globPatterns: ["**/*.{js,css,html,webmanifest}", "favicon.svg", "*.png"],
        globIgnores: ["screenshots/**"],
        // The physics engine's chunk carries its WASM inline and is about 4.3 MB.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
