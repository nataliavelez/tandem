/*
Server <-> sidecar robustness. Starts its own server (port 8094, temporary
DATA_DIR, GAME=overcooked) behind a proxy to the real sidecar (port 8199) that
can be told to hang on /env/step.

Checks: every group size a lobby timeout can resize to (MIN_START_SIZE ..
REQUIRED_PLAYERS) is compiled at startup, and so are new sizes allowed from
the admin view, so a short start never compiles mid-study; a sidecar that
stops answering steps times out (SIDECAR_STEP_TIMEOUT_MS), each failed step is
logged with its actions (step_error), and the room aborts instead of freezing.

Usage, in server/ (sidecar running; SIDECAR_URL overrides :8001):
  npm run test:sidecar

Created by: Elizabeth Mieczkowski, Updated: 11/2026
*/
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8094;
const PROXY_PORT = 8199;
const SIDECAR = process.env.SIDECAR_URL ?? "http://127.0.0.1:8001";
const TOKEN = "sidecar-test-token";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sidecar-"));
const STEP_TIMEOUT_MS = 300;
// The sidecar caches compiled configs across runs and the horizon is part of the
// config, so a fresh horizon each run makes "nothing new compiled" meaningful
const HORIZON = 2000 + (process.pid % 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await cond()) return true; await sleep(50); }
  return !!(await cond());
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

/** Proxy to the real sidecar; with hangSteps set, /env/step requests are never answered. */
const proxy = { hangSteps: false, creates: [] };
const proxyServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", async () => {
    if (req.url === "/env/step" && proxy.hangSteps) return; // never answer
    if (req.url === "/env/create") proxy.creates.push(JSON.parse(body).num_agents);
    try {
      const r = await fetch(SIDECAR + req.url, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? body : undefined });
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(await r.text());
    } catch (e) {
      res.writeHead(502); res.end(String(e));
    }
  });
});

const compiledConfigs = async () => (await (await fetch(`${SIDECAR}/health`)).json()).compiled_configs;

function startServer(extra = {}) {
  const env = {
    ...process.env,
    STUDY_CONFIG: "test/test.env", PORT: String(PORT), DATA_DIR,
    SIDECAR_URL: `http://127.0.0.1:${PROXY_PORT}`, SIDECAR_STEP_TIMEOUT_MS: String(STEP_TIMEOUT_MS),
    GAME: "overcooked", LAYOUT: "open_room", REQUIRED_PLAYERS: "4", MIN_START_SIZE: "2", MIN_GROUP_SIZE: "",
    ROUNDS: "1", HORIZON: String(HORIZON), TICK_MS: "100", LOBBY_TIMEOUT_MS: "1500", PRACTICE: "false", ADMIN_TOKEN: TOKEN,
    ...extra,
  };
  const proc = spawn("node", ["-r", "ts-node/register/transpile-only", "src/index.ts"], { cwd: path.resolve(__dirname, ".."), env });
  const srv = { proc, out: "", exited: false };
  proc.stdout.on("data", (d) => { srv.out += d; });
  proc.stderr.on("data", (d) => { srv.out += d; });
  proc.on("exit", () => { srv.exited = true; });
  srv.ready = waitFor(() => srv.out.includes("sidecar warmed up"), 60000);
  srv.stop = async () => { proc.kill("SIGTERM"); return waitFor(() => srv.exited, 15000); };
  return srv;
}

function client(pid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = { pid, ws, msgs: [] };
    ws.on("message", (d) => c.msgs.push(JSON.parse(d)));
    c.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    c.all = (type) => c.msgs.filter((m) => m.type === type);
    c.running = () => c.msgs.filter((m) => m.type === "STATE_UPDATE" && m.state.phase === "running");
    c.ended = () => c.all("SESSION_STATUS").find((s) => s.status === "ended");
    ws.on("open", () => { c.send({ type: "HELLO", participantId: pid }); resolve(c); });
  });
}

const postSettings = (body) =>
  fetch(`http://127.0.0.1:${PORT}/admin/settings`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const readLog = (suffix) => fs.readdirSync(DATA_DIR).filter((n) => n.endsWith(suffix))
  .flatMap((f) => fs.readFileSync(path.join(DATA_DIR, f), "utf8").trim().split("\n").map(JSON.parse));

(async () => {
  await new Promise((r) => proxyServer.listen(PROXY_PORT, "127.0.0.1", r));
  const srv = startServer();
  check(await srv.ready, "server up, sidecar warmed");

  // ---- A. Every size a lobby timeout can produce is compiled at startup ----
  check(srv.out.includes("warmed up (group sizes 2, 3, 4)"), "startup compiles group sizes 2-4 (MIN_START_SIZE..REQUIRED_PLAYERS)");
  check([2, 3, 4].every((n) => proxy.creates.includes(n)), `warm-up created envs for 2, 3 and 4 agents (${proxy.creates})`);

  // Admin allows starting with 1: size 1 is compiled when the setting changes, not mid-study
  let r = await postSettings({ minStartSize: 1 });
  check(r.status === 200, "minStartSize → 1 accepted");
  check(proxy.creates.includes(1), "size 1 compiled when the setting changed");
  r = await postSettings({ minStartSize: 2 });
  check(r.status === 200, "minStartSize back to 2");

  const before = await compiledConfigs();
  const creates = proxy.creates.length;
  const p1 = await client("sc_1"), p2 = await client("sc_2");
  for (const c of [p1, p2]) c.send({ type: "JOIN_LOBBY" });
  // Lobby timeout: the room is resized 4 → 2; players then confirm ready
  check(await waitFor(() => readLog("_room_1.jsonl").some((e) => e.event === "room_resized"), 6000), "lobby timeout resizes the room to 2");
  const roomCreates = proxy.creates.slice(creates).join();
  check(roomCreates === "4,2", `…the room only created its own envs: 4 agents, then 2 after the resize (${roomCreates})`);

  // ---- B. A sidecar that stops answering steps ----
  await sleep(300);
  for (const c of [p1, p2]) c.send({ type: "TRIAL_READY" });
  check(await waitFor(() => p1.running().length >= 5, 8000), "trial running");
  // Checked once the resized env is in use (its create may still be compiling right after the resize)
  const after = await compiledConfigs();
  check(after === before, `the resize compiled nothing new (compiled configs ${before} → ${after})`);
  proxy.hangSteps = true;
  const hungAt = Date.now();
  // 20 consecutive failed steps → abort (each waits STEP_TIMEOUT_MS + a tick)
  check(await waitFor(() => p1.ended() && p2.ended(), 20 * (STEP_TIMEOUT_MS + 100) + 8000), "room aborts instead of freezing");
  const took = Date.now() - hungAt;
  check(p1.ended()?.outcome === "aborted", `players ended as aborted after ${took} ms (${p1.ended()?.reason})`);
  const room = readLog("_room_1.jsonl");
  const errors = room.filter((e) => e.event === "step_error");
  check(errors.length === 20, `20 step_error lines logged (${errors.length})`);
  check(errors.length > 0 && errors.every((e) => e.actions && Object.keys(e.actions).join() === "agent_0,agent_1" && /timeout|aborted/i.test(e.error)),
    `step_error has the actions sent and a timeout error (${errors[0]?.error})`);
  check(room.some((e) => e.event === "room_aborted"), "room log: room_aborted");

  for (const c of [p1, p2]) c.ws.close();
  await srv.stop();
  proxyServer.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
