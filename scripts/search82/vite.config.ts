import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({ cacheDir: ".search82.local/vite-cache", plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["@tauri-apps/plugin-http"] },
  resolve: { alias: { "@tauri-apps/plugin-http": fileURLToPath(new URL("./nativeHttp.ts", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 1519, strictPort: true, hmr: false, watch: null } });
