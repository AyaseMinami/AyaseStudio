import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const production = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
// Vite's React refresh preamble is inline; all resource directives match release.
const csp = `${production.app.security.csp}; script-src 'self' 'unsafe-inline'`;
export default defineConfig({
  cacheDir: ".avatar-csp.local/vite-cache",
  plugins: [react(), tailwindcss(), { name: "native-avatar-report", configureServer(server) {
    server.middlewares.use("/avatar-csp-report", (request, response) => {
      console.log(`AVATAR_CSP_NATIVE ${request.url}`);
      response.statusCode = 204; response.end();
    });
  } }],
  resolve: { alias: [{ find: /(?:\.\.\/)+avatar\/library$/, replacement: fileURLToPath(new URL("../providers100/avatarLibrary.ts", import.meta.url)) }] },
  server: { host: "127.0.0.1", port: 1536, strictPort: true, hmr: false, watch: null, headers: { "Content-Security-Policy": csp } },
});
