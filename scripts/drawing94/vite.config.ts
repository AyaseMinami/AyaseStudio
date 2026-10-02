import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({ plugins: [react(), tailwindcss(), {
  name: "drawing94-local-evidence",
  configureServer(server) {
    server.middlewares.use("/drawing94-report", (request, response) => {
      if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
      const chunks: Buffer[] = []; let size = 0;
      request.on("data", chunk => { size += chunk.length; if (size > 2_000_000) request.destroy(); else chunks.push(chunk); });
      request.on("end", () => { void (async () => {
        try {
          const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!["browser", "native"].includes(report.environment)) throw Error("Invalid evidence environment");
          const folder = resolve(".drawing94.local"); await mkdir(folder, { recursive: true });
          await writeFile(resolve(folder, `${report.environment}-report.json`), JSON.stringify(report, null, 2));
          response.end("saved");
        } catch { response.statusCode = 400; response.end("invalid report"); }
      })(); });
    });
  },
// Freeze the entry during measurements: documentation/artifact writes must not
// invalidate the module owning the synthetic controller and autorun loop.
}], server: { host: "127.0.0.1", port: 1495, strictPort: true, hmr: false, watch: null } });
