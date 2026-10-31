import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
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
    react(),
    // React Compiler, as documented by @vitejs/plugin-react.
    babel({ presets: [reactCompilerPreset()] }),
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
        test: {
          name: "browser",
          include: ["src/**/*.test.tsx"],
          // Makes any real WebAuthn call fail: it would open a dialog of the OS.
          setupFiles: ["./src/test/blockWebAuthn.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
