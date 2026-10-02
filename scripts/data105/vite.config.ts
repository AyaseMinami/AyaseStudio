import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const reports = new Set(["seed-staging", "seed-applying", "recover-staging", "recover-applying", "browser", "manual"]);
const fixtures = new Set(["modern", "v1", "v3", "future-readable"]);
export default defineConfig({
  cacheDir: ".data105.local/vite-cache",
  plugins: [react(), tailwindcss(), {
    name: "data105-local-reports",
    configureServer(server) {
      function receiver(kind: "report" | "fixture") {
        return (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end(); return; }
        const chunks: Buffer[] = [];
        let size = 0, oversized = false;
        request.on("data", chunk => {
          size += chunk.length;
          if (size > 2_000_000) {
            oversized = true; chunks.length = 0;
            if (!response.writableEnded) { response.statusCode = 413; response.end("report too large"); }
          } else if (!oversized) chunks.push(chunk);
        });
        request.on("end", () => { if (oversized) return; void (async () => {
          try {
            const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const name = kind === "report" ? report?.report : report?.fixture;
            if (!(kind === "report" ? reports : fixtures).has(name)) throw new Error("unsupported name");
            if (kind === "fixture" && (typeof report.serialized !== "string" || report.serialized.length > 1_900_000)) throw new Error("invalid fixture");
            const folder = resolve(".data105.local");
            await mkdir(folder, { recursive: true });
            await writeFile(resolve(folder, kind === "report" ? `${name}-report.json` : `fixture-${name}.ayasebackup`),
              kind === "report" ? JSON.stringify(report, null, 2) : report.serialized);
            response.end("saved");
          } catch { response.statusCode = 400; response.end("invalid report"); }
        })(); });
        };
      }
      server.middlewares.use("/data105-report", receiver("report"));
      server.middlewares.use("/data105-fixture", receiver("fixture"));
    },
  }],
  server: { host: "127.0.0.1", port: 1505, strictPort: true, hmr: false, watch: null },
});
