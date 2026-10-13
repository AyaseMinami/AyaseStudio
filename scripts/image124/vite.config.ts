import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  cacheDir: ".image124.local/vite-cache", plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 1524, strictPort: true },
  build: { outDir: ".image124.local/dist", rollupOptions: { input: "scripts/image124/index.html" } },
});
