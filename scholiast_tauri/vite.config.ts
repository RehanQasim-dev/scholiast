import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  css: {
    postcss: {},
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
  resolve: {
    alias: {
      "@excalidraw/excalidraw": resolve(__dirname, "src/test/excalidraw-stub.tsx"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
