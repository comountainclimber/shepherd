import { createReadStream, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, serverUrl, type AppOptions } from "./shepherdApi";
import { launchOptions, openBrowser, startupWarnings } from "./startup";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function staticPage(root: string, req: IncomingMessage, res: ServerResponse) {
  const missing = () => { res.writeHead(404); res.end("Not found."); };
  if (req.method !== "GET" && req.method !== "HEAD") return missing();
  let file: string;
  try {
    const url = new URL(req.url ?? "/", "http://shepherd.local");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return missing();
    const relative = decodeURIComponent(url.pathname);
    const base = realpathSync(root);
    file = path.resolve(base, `.${relative}`);
    if (!file.startsWith(base + path.sep) && file !== base) return missing();
    if (file === base || (!path.extname(file) && !statExists(file))) file = path.join(base, "index.html");
    if (!statSync(file).isFile() || !realpathSync(file).startsWith(base + path.sep)) return missing();
  } catch {
    return missing();
  }
  res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

function statExists(file: string) {
  try { return statSync(file).isFile(); } catch { return false; }
}

export async function startServer(options: Omit<AppOptions, "origin"> & { port: number; distDir?: string; strictPort?: boolean }) {
  const dist = options.distDir ?? fileURLToPath(new URL("../dist/", import.meta.url));
  if (!statExists(path.join(dist, "index.html"))) throw new Error("The built page is missing. Run npm run build first.");
  const http = createServer((req, res) => app.handle(req, res, () => staticPage(dist, req, res)));
  const app = createApp({ ...options, origin: () => serverUrl(http.address()) });
  http.once("close", app.stop);
  let port = options.port;
  try {
    for (;;) {
      try {
        await new Promise<void>((resolve, reject) => {
          const failed = (error: Error) => { http.removeListener("listening", ready); reject(error); };
          const ready = () => { http.removeListener("error", failed); resolve(); };
          http.once("error", failed);
          http.once("listening", ready);
          http.listen(port, "127.0.0.1");
        });
        break;
      } catch (error) {
        if (options.strictPort || (error as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 65535) throw error;
        port += 1;
      }
    }
    app.announce();
  } catch (error) {
    app.stop();
    if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    throw error;
  }
  return {
    ...app,
    http,
    url: serverUrl(http.address())!,
    address: app.security.address(),
    async close() {
      app.stop();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: shepherd [--port 5194] [--no-open] [--data-dir FOLDER] [--projects-dir FOLDER]\n\nThe board lives in ~/.shepherd and new projects in ~/.shepherd/projects.\nSHEPHERD_DATA_DIR and SHEPHERD_PROJECTS_DIR also set these folders.");
    return;
  }
  const options = launchOptions(args);
  for (const warning of await startupWarnings()) console.warn(warning);
  const app = await startServer(options);
  console.log(`\nShepherd: ${app.address}\nBoard: ${options.dataDir}\nNew projects: ${options.projectsDir}\nAgents: ${path.join(options.dataDir, "session.json")}\n\nKeep this terminal running. Press Ctrl+C to stop.\n`);
  const stop = () => { void app.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (options.open) openBrowser(app.address);
}
