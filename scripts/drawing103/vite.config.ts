import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({ cacheDir: ".drawing103.local/vite-cache", plugins: [react(), tailwindcss()], server: { host: "127.0.0.1", port: 1532, strictPort: true, hmr: false, watch: null } });
