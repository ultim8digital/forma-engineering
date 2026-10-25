import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
test("account-free local studio: origin boundary, private settings, queue and persistence", async t => {
  const folder = await mkdtemp(path.join(tmpdir(), "forma-local-test-"));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child, logs = "";
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const done = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGTERM"); await done;
  }
  async function start() {
    child = spawn(process.execPath, ["dist/server/index.js"], { cwd: root, env: { ...process.env, FORMA_PORT: String(port), FORMA_DATA_DIR: folder, FORMA_NO_WORKER: "1" } });
    child.stdout.on("data", d => { logs += d; }); child.stderr.on("data", d => { logs += d; });
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(base + "/api/state")).ok) return; } catch {}
      await delay(100);
    }
    throw new Error("Server did not start: " + logs);
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }); });
  await start();
  const request = (url, body, method = "POST", headers = {}) => fetch(base + url, { method, headers: { Origin: base, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + "/")).status, 200);
  assert.deepEqual((await (await fetch(base + "/api/state")).json()).projects, []);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base + "/api/state", { headers: { Host: `evil.example:${port}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await fetch(base + "/api/state", { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await request("/api/projects", { title: "Blocked" }, "POST", { Origin: "https://evil.example" })).status, 403);
  assert.equal((await fetch(base + "/api/projects", { method: "POST", body: '{}' })).status, 403);
  assert.equal((await request("/api/worker/claim", {})).status, 401);
  assert.equal((await fetch(base + "/api/state", { headers: { Authorization: "Bearer invalid", "oai-authenticated-user-id": "forged" } })).status, 401);
  const config = await (await fetch(base + "/api/providers")).json();
  assert.ok(Object.values(config).every(p => !p.enabled));
  for (const id of ["api", "local"]) delete config[id].has_api_key;
  config.api = { enabled: true, base_url: "https://example.com/v1", model: "explicit-model", api_key: "private-test-key" };
  let r = await request("/api/providers", config, "PUT"); assert.equal(r.status, 200);
  let data = await r.json(); assert.equal(data.api.api_key, ""); assert.equal(data.api.has_api_key, true);
  assert.ok(!(await (await fetch(base + "/api/providers")).text()).includes("private-test-key"));
  assert.equal((await stat(path.join(folder, "providers.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(folder, ".worker-token"))).mode & 0o777, 0o600);
  assert.ok(!logs.includes("private-test-key"));
  assert.equal((await fetch(base + "/forma-data/providers.json")).status, 404);
  config.api.api_key = "";
  await request("/api/providers", config, "PUT");
  assert.equal(JSON.parse(await readFile(path.join(folder, "providers.json"), "utf8")).api.api_key, "private-test-key");
  config.api.base_url = "https://other.example/v1";
  await request("/api/providers", config, "PUT");
  assert.equal(JSON.parse(await readFile(path.join(folder, "providers.json"), "utf8")).api.api_key, "");
  config.api.base_url = "http://remote.example/v1";
  assert.equal((await request("/api/providers", config, "PUT")).status, 400);
  const token = (await readFile(path.join(folder, ".worker-token"), "utf8")).trim();
  assert.equal((await fetch(base + "/api/providers", { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  r = await request("/api/projects", { title: "Persisted part" }); assert.equal(r.status, 201);
  const project = await r.json();
  // This node is an explicit API transport fixture, not a CAD computation.
  const auth = { Authorization: `Bearer ${token}` };
  assert.equal((await request("/api/worker/heartbeat", { id: "test-node", name: "Transport fixture", capabilities: { providers: [], cad: "fixture", engineering_version: 2 } }, "POST", auth)).status, 200);
  const spec = JSON.parse(await readFile(path.join(root, "public/example-spec.json"), "utf8"));
  const job = { provider: "manual", model: "", spec };
  r = await request(`/api/projects/${project.id}/jobs`, job); assert.equal(r.status, 202);
  assert.equal((await request(`/api/projects/${project.id}/jobs`, job)).status, 409);
  const claims = await Promise.all([request("/api/worker/claim", {}, "POST", auth), request("/api/worker/claim", {}, "POST", auth)]);
  const claimed = await Promise.all(claims.map(r => r.json()));
  assert.equal(claimed.filter(c => c.job).length, 1);
  const current = claimed.find(c => c.job).job;
  assert.equal((await request(`/api/worker/jobs/${current.id}/stage`, { stage: "Invalid lease" }, "POST", { ...auth, "X-Job-Lease": "bad" })).status, 409);
  await stop(); await start();
  const state = await (await fetch(base + "/api/state")).json();
  assert.equal(state.projects.length, 1); assert.equal(state.projects[0].id, project.id);
  const result = await (await fetch(base + `/api/projects/${project.id}`)).json();
  assert.equal(result.jobs[0].id, current.id);
});
