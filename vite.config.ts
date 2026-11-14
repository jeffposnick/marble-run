import { defineConfig } from "vitest/config";

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
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
