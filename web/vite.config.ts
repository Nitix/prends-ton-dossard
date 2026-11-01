import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // File-based routes. It generates src/routeTree.gen.ts, so it comes first.
    // The tests of a route sit next to it: they are not routes.
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routeFileIgnorePattern: "\\.test\\.tsx?$",
    }),
    // React Compiler: the native one, written in Rust (oxc-transform-react), run
    // by @vitejs/plugin-react itself, without Babel. It is experimental.
    react({ compiler: true }),
    tailwindcss(),
  ],
  server: {
    // The port is part of APP_URL, which is the WebAuthn origin: if 5173 is
    // taken, failing is better than serving from an origin passkeys refuse.
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8090" },
  },
  build: {
    // The Go program embeds this directory (server/webdist).
    outDir: "../server/webdist/dist",
    emptyOutDir: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        // Leaflet is only reached through the lazy map: without this, a cache made
        // before it was installed finds it during a run, optimizes it, and reloads
        // a test ("Vite unexpectedly reloaded a test").
        optimizeDeps: { include: ["leaflet"] },
        test: {
          name: "browser",
          include: ["src/**/*.test.tsx"],
          // The first makes any real WebAuthn call fail: it would open a dialog
          // of the OS. The second does the same for a map tile request: no test
          // goes on the network.
          setupFiles: ["./src/test/blockWebAuthn.ts", "./src/test/blockTiles.ts"],
          browser: {
            enabled: true,
            headless: true,
            // A click or a fill on a missing element fails after 2 s, not at
            // the 15 s test timeout. Below 2 s, passing tests failed at times.
            provider: playwright({ actionTimeout: 2000 }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
