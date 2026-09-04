import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the chain SDK out of the critical path for first paint.
        manualChunks: {
          react: ["react", "react-dom"],
          motion: ["gsap"],
          genlayer: ["genlayer-js"],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
