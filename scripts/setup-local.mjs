import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit", cwd: root });
  if (r.error || r.status) { console.error("Setup failed. Check Python 3.12 and the system CAD libraries described in README.md."); process.exit(r.status || 1); }
}
if (!existsSync(python)) {
  if (spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0) run("uv", ["venv", "--python", "3.12", ".venv"]);
  else run(process.env.FORMA_SETUP_PYTHON || "python3.12", ["-m", "venv", ".venv"]);
}
const uv = spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
if (uv) run("uv", ["pip", "install", "--python", python, "-r", "worker-node/requirements.txt"]);
else run(python, ["-m", "pip", "install", "-r", "worker-node/requirements.txt"]);
run(python, ["-c", "import cadquery,gmsh,numpy,scipy,reportlab; print('CAD runtime ready')"]);
console.log("Ready. Run npm run build, then npm start. Model connections are optional and configured in the studio.");
