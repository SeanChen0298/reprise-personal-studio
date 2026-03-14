import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  base: "./",
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    host: "0.0.0.0",
    hmr: false,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
