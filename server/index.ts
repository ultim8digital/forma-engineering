import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { LocalDatabase, LocalFiles } from "./storage";
import { ProviderSettings } from "./providers";
import { createApi } from "./api";

const root = path.resolve(fileURLToPath(new URL(/* @vite-ignore */ "../../", import.meta.url)));
const folder = path.resolve(process.env.FORMA_DATA_DIR || path.join(root, "forma-data"));
const port = Number(process.env.FORMA_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid FORMA_PORT");
mkdirSync(folder, { recursive: true, mode: 0o700 });
const tokenPath = path.join(folder, ".worker-token");
if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
chmodSync(tokenPath, 0o600);
const token = readFileSync(tokenPath, "utf8").trim();
if (token.length < 32) throw new Error("Invalid local worker token");
const db = new LocalDatabase(folder, root);
const settings = new ProviderSettings(folder);
const handleApi = createApi({ DB: db, BUCKET: new LocalFiles(path.join(folder, "artifacts")) });
const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const origins = new Set([...hosts].map(host => "http://" + host));
const safeEqual = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
let child: ChildProcess | undefined;
let closing = false;
const server = createServer();
const dev = process.argv.includes("--dev")
  ? await import("vite").then(v => v.createServer({ root, server: { middlewareMode: true, hmr: { server }, fs: { strict: true } }, appType: "spa" }))
  : undefined;
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".pdf": "application/pdf", ".zip": "application/zip",
  ".stl": "model/stl", ".step": "application/step", ".csv": "text/csv; charset=utf-8", ".woff2": "font/woff2",
};
server.on("request", async (req, res) => {
  const respond = (status: number, body: string) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: body })); };
  try {
    // Bind to loopback AND validate Host: protection against DNS rebinding.
    if (!hosts.has(req.headers.host || "")) return respond(403, "Локальный доступ: недопустимый Host.");
    if (req.headers.origin && !origins.has(req.headers.origin)) return respond(403, "Запрос с другого сайта отклонён.");
    const url = new URL(req.url || "/", "http://" + req.headers.host);
    if (url.pathname.startsWith("/api/")) {
      if (req.headers["sec-fetch-site"] === "cross-site") return respond(403, "Запрос с другого сайта отклонён.");
      const bearer = req.headers.authorization?.replace(/^Bearer /, "");
      let role: "user" | "worker" | "agent" = "user";
      if (bearer) {
        if (safeEqual(bearer, token)) role = "worker";
        else if (await db.prepare("SELECT hash FROM api_keys WHERE hash=?").bind(createHash("sha256").update(bearer).digest("hex")).first()) role = "agent";
        else return respond(401, "Недействительный токен.");
      }
      const writing = !["GET", "HEAD"].includes(req.method || "GET");
      if (writing && !bearer && !req.headers.origin) return respond(403, "Для записи нужен локальный Origin или API-токен.");
      if (url.pathname.startsWith("/api/worker/") && role !== "worker") return respond(401, "Нужен внутренний токен CAD-узла.");
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 15_000_000) return respond(413, "Запрос больше 15 МБ.");
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(writing && body.length ? { body } : {}) });
      let response: Response;
      if (url.pathname === "/api/providers") {
        if (role !== "user") return respond(403, "Настройки доступны только локальному интерфейсу.");
        if (req.method === "GET") response = Response.json(settings.publicConfig());
        else if (req.method === "PUT") {
          const value = settings.save(await request.json());
          await db.prepare("UPDATE nodes SET refresh_requested_at=?").bind(Date.now()).run();
          response = Response.json(value);
        } else return respond(405, "Метод не поддерживается.");
      } else response = await handleApi(request, role);
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (dev) return dev.middlewares(req, res, () => respond(404, "Не найдено"));
    if (!["GET", "HEAD"].includes(req.method || "GET")) return respond(405, "Метод не поддерживается.");
    const relative = decodeURIComponent(url.pathname);
    if (relative.split("/").some(p => p.startsWith(".") || p.includes("\\"))) return respond(404, "Не найдено");
    const staticRoot = path.join(root, "dist/client");
    let filename = path.join(staticRoot, relative === "/" ? "index.html" : relative);
    if (!existsSync(filename) || !statSync(filename).isFile()) {
      if (path.extname(relative)) return respond(404, "Не найдено");
      filename = path.join(staticRoot, "index.html");
    }
    const actual = await realpath(filename);
    if (!actual.startsWith(staticRoot + path.sep)) return respond(404, "Не найдено");
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filename)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    res.end(req.method === "HEAD" ? undefined : await readFile(actual));
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof z.ZodError) return respond(400, error.issues.map(i => i.message).join(" "));
    if (error instanceof SyntaxError) return respond(400, "Некорректный JSON");
    console.error("Local request failed:", error instanceof Error ? error.message : "unknown");
    respond(500, "Ошибка локального сервера.");
  }
});

async function shutdown() {
  if (closing) return;
  closing = true;
  if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  await dev?.close();
  server.close(() => { db.close(); process.exit(0); });
  server.closeAllConnections();
  setTimeout(() => process.exit(1), 5000).unref();
}
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { void shutdown(); });
server.on("error", error => { console.error(error.message); void shutdown(); });
server.listen(port, "127.0.0.1", () => {
  console.log(`neofab Local · http://localhost:${port}\nProjects and models: ${folder}\nNo account required. Ctrl+C stops the studio and compute node.`);
  if (process.env.FORMA_NO_WORKER === "1") return;
  const python = process.env.FORMA_PYTHON || path.join(root, ".venv/bin/python");
  if (!existsSync(python)) { console.error("CAD runtime missing. Run npm run setup, then restart."); return; }
  child = spawn(python, [path.join(root, "worker-node/runner.py"), "--url", `http://127.0.0.1:${port}`], {
    cwd: root, detached: true, stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, FORMA_URL: `http://127.0.0.1:${port}`, FORMA_WORKER_TOKEN: token, FORMA_CONFIG_PATH: settings.filename, FORMA_WORK_DIR: path.join(folder, "cad-work") },
  });
  child.on("error", () => console.error("CAD node could not start; check npm run setup."));
  child.on("exit", code => { if (!closing) console.error(`CAD node stopped (${code}); restart neofab to reconnect.`); });
});
