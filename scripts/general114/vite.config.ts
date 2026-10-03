import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
export default defineConfig({
  cacheDir: ".general114.local/vite-cache",
  plugins: [react(), tailwindcss(), {
    name: "general114-isolated-report",
    configureServer(server) {
      server.middlewares.use("/general114-report", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
        let body = "";
        request.on("data", chunk => { body += chunk; if (body.length > 4096) request.destroy(); });
        request.on("end", () => { void (async () => {
          try {
            const value = JSON.parse(body);
            if (typeof value.stage !== "string") throw Error("invalid stage");
            await mkdir(resolve(".general114.local"), { recursive: true });
            await appendFile(resolve(".general114.local/native-report.jsonl"), JSON.stringify(value) + "\n");
            response.end("saved");
          } catch { response.statusCode = 400; response.end("invalid"); }
        })(); });
      });
    },
  }],
  server: { host: "127.0.0.1", port: 1524, strictPort: true, hmr: false, watch: null },
});
