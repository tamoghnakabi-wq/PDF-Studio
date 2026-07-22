import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  optimizeDeps: {
    esbuildOptions: { target: "es2022" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
