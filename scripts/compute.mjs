import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".sites-runtime");
mkdirSync(state, { recursive: true });
const pidFile = path.join(state, "compute.pid");
let pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
let running = false;
if (pid)
  try {
    process.kill(pid, 0);
    running = true;
  } catch {}
const action = process.argv[2] || "status";
if (action === "status") {
  console.log(
    running ? `FORMA compute running (PID ${pid})` : "FORMA compute stopped",
  );
  process.exit(0);
}
if (action === "stop") {
  if (running) process.kill(pid, "SIGTERM");
  if (existsSync(pidFile)) unlinkSync(pidFile);
  console.log("FORMA compute stopped");
  process.exit(0);
}
if (action !== "start") {
  console.error("Usage: node scripts/compute.mjs start|stop|status");
  process.exit(1);
}
if (running) {
  console.log("FORMA compute already running");
  process.exit(0);
}
if (!existsSync(path.join(root, ".env.node"))) {
  console.error("Configure .env.node first; see .env.example");
  process.exit(1);
}
const log = openSync(path.join(state, "compute.log"), "a", 0o600);
const child = spawn(
  path.join(root, ".venv/bin/python"),
  [path.join(root, "worker-node/runner.py")],
  { cwd: root, detached: true, stdio: ["ignore", log, log] },
);
child.on("error", (error) => {
  console.error("Could not start compute node:", error.message);
  process.exitCode = 1;
});
child.once("spawn", () => {
  writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
  closeSync(log);
  child.unref();
  console.log(
    `FORMA compute started (PID ${child.pid}). Logs: .sites-runtime/compute.log`,
  );
});
