/*
Read-only admin view (src/admin.ts). Starts its own servers (port 8096,
temporary DATA_DIR, GAME=overcooked, 2 per room), so it needs only the sidecar.

Checks: off without ADMIN_TOKEN; token required (missing/wrong → 401); page
served; game WebSocket still works on the same port; participants' stages
(before lobby → lobby → playing → ended), last screen, connected; rooms with
seats, step progress, score and step timing; held-seat countdown after a
disconnect; recent events without ticks; sidecar health; no completion URLs.

Usage, in server/ (sidecar running; SIDECAR_URL overrides :8001):
  npm run test:admin

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8096;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "test-admin-token";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-admin-"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await cond()) return true; await sleep(100); }
  return !!(await cond());
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

function startServer(extraEnv = {}) {
  const env = {
    ...process.env,
    STUDY_CONFIG: "test/test.env", PORT: String(PORT), DATA_DIR,
    GAME: "overcooked", REQUIRED_PLAYERS: "2", MIN_GROUP_SIZE: "1", HORIZON: "100", TICK_MS: "100",
    ADMIN_TOKEN: TOKEN,
    ...extraEnv,
  };
  const proc = spawn("node", ["-r", "ts-node/register/transpile-only", "src/index.ts"], { cwd: path.resolve(__dirname, ".."), env });
  const srv = { proc, out: "", exited: false };
  proc.stdout.on("data", (d) => { srv.out += d; });
  proc.stderr.on("data", (d) => { srv.out += d; });
  proc.on("exit", () => { srv.exited = true; });
  srv.ready = waitFor(() => srv.out.includes("sidecar warmed up"), 30000);
  srv.stop = async () => { proc.kill("SIGTERM"); return waitFor(() => srv.exited, 15000); };
  return srv;
}

const get = (p, token) => fetch(BASE + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const state = async () => (await get("/admin/state", TOKEN)).json();
const person = (s, pid) => s.participants.find((p) => p.participantId === pid);

function client(pid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = { ws, statuses: [], states: 0 };
    ws.on("message", (d) => { const m = JSON.parse(d); if (m.type === "SESSION_STATUS") c.statuses.push(m); if (m.type === "STATE_UPDATE" && m.state.phase === "running") c.states++; });
    c.send = (m) => ws.send(JSON.stringify(m));
    ws.on("open", () => { c.send({ type: "HELLO", participantId: pid, meta: { STUDY_ID: "s1" } }); resolve(c); });
  });
}

(async () => {
  // 1. Off unless ADMIN_TOKEN is set
  const off = startServer({ ADMIN_TOKEN: "" });
  await off.ready;
  check((await get("/admin/state", TOKEN)).status === 404 && (await get("/admin")).status === 404, "admin view off (404) without ADMIN_TOKEN");
  check(off.out.includes("admin view off"), "startup says the admin view is off");
  await off.stop();

  const srv = startServer();
  await srv.ready;
  check(srv.out.includes("[admin] admin view at"), "startup prints the admin URL");

  // 2. Auth and routes
  check((await get("/admin/state")).status === 401, "no token → 401");
  check((await get("/admin/state", "wrong")).status === 401, "wrong token → 401");
  const page = await get("/admin");
  check(page.status === 200 && (await page.text()).includes("Tandem admin"), "GET /admin serves the page (no token needed; it holds no data)");
  check((await get("/nothing")).status === 404, "other paths → 404");
  check((await fetch(BASE + "/admin/state", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } })).status === 405, "POST /admin/state → 405");

  let s = await state();
  check(s.study.game === "overcooked" && s.study.playersPerRoom === 2 && s.study.horizon === 100 && s.study.tickMs === 100, "study settings reported");
  check(s.sidecar.ok === true && typeof s.sidecar.envs === "number", `sidecar health reported (ok, ${s.sidecar.envs} envs)`);
  check(s.backup.enabled === false, "backup reported off");

  // 3. Before lobby: last screen from CLIENT_LOG screen_enter
  const a = await client("adm_alice");
  a.send({ type: "CLIENT_LOG", id: "l1", event: "screen_enter", clientTime: Date.now(), data: { index: 1, screenId: "overcooked-instructions", screenType: "instructions" } });
  await sleep(300);
  s = await state();
  const pa = person(s, "adm_alice");
  check(pa?.stage === "before lobby" && pa.connected && pa.screen?.id === "overcooked-instructions", "participant before lobby, connected, on the instructions");

  // 4. Lobby → playing (WebSocket game on the same port)
  const b = await client("adm_bob");
  a.send({ type: "JOIN_LOBBY" }); b.send({ type: "JOIN_LOBBY" });
  await sleep(300);
  s = await state();
  check(s.rooms.length === 1 && s.rooms[0].status === "lobby" && s.rooms[0].seats.length === 2, "room in lobby with 2 seats");
  check(person(s, "adm_bob").stage === "lobby" && person(s, "adm_bob").room === s.rooms[0].id, "participant stage lobby, with room");
  a.send({ type: "TRIAL_READY" }); b.send({ type: "TRIAL_READY" });
  check(await waitFor(() => a.states > 10), "game runs on the same port");
  s = await state();
  const r = s.rooms[0];
  check(r.status === "playing" && r.step > 0 && r.step <= 100 && r.score === 0 && r.trial === 1, `room playing: step ${r.step}/100, score 0`);
  check(r.stepLatencyMs && r.stepLatencyMs.mean >= 0 && typeof r.overruns === "number", "step timing reported");
  check(s.counts.byStage.playing === 2 && s.counts.connected === 2, "counts: 2 playing, 2 connected");

  // 5. Disconnect: seat held with a countdown; then dropped → ended (not paid)
  b.ws.close();
  await sleep(500);
  s = await state();
  const seat = s.rooms[0].seats.find((x) => x.participantId === "adm_bob");
  check(seat && !seat.connected && seat.seatHeldForMs > 0 && seat.seatHeldForMs <= 3000, `disconnected seat held (${seat?.seatHeldForMs} ms left)`);
  check(person(s, "adm_bob").connected === false, "participant shown as not connected");
  await sleep(3200);
  s = await state();
  const pb = person(s, "adm_bob");
  check(pb.stage === "ended: dropped" && pb.ended.paid === false, "after the grace period: ended: dropped, not paid");

  // 6. Recent events: lifecycle, no ticks, no completion URLs
  const names = s.events.map((e) => e.event);
  check(["participant_hello", "player_joined", "trial_start", "player_disconnected", "player_dropped"].every((n) => names.includes(n)), "recent events include hello, join, trial start, disconnect, drop");
  check(!names.includes("tick"), "no ticks in recent events");
  check(s.events.some((e) => e.event === "client_event" && e.details.screen === "overcooked-instructions"), "client screen events shown with their screen");
  check(!JSON.stringify(s).includes("example.test/complete"), "no completion URLs in the admin state");

  // 7. Round ends: room shown between rounds
  check(await waitFor(async () => (await state()).rooms[0]?.status === "between rounds", 15000), "after the round: room between rounds");
  s = await state();
  check(person(s, "adm_alice").stage === "after a round", "participant stage: after a round");

  a.ws.close();
  await srv.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
