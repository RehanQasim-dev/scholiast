import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
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
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          tanstack: ["@tanstack/react-query"],
          tauri: ["@tauri-apps/api", "@tauri-apps/plugin-store", "@tauri-apps/plugin-opener", "@tauri-apps/plugin-deep-link"],
          excalidraw: ["@excalidraw/excalidraw"],
        },
      },
    },
  },
  resolve: {
    alias:
      mode === "test" || Boolean(process.env.VITEST)
        ? [
            {
              find: /^@excalidraw\/excalidraw$/,
              replacement: resolve(__dirname, "src/test/excalidraw-stub.tsx"),
            },
            {
              find: "@excalidraw/excalidraw/index.css",
              replacement: resolve(__dirname, "src/test/empty.css"),
            },
          ]
        : [],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
}));
