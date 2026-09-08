import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";


export default defineConfig({
  plugins: [react()],
  server: {
    // Polling is required for bind-mounted volumes on Docker Desktop (Windows/macOS)
    // so Vite detects host file changes and hot-reloads CSS/TSX.
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});