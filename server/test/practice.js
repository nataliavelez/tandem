/*
Solo practice before the lobby, and starting short at the lobby timeout.
Starts its own servers one after another (port 8099, temporary DATA_DIR,
GAME=overcooked), so it needs only the sidecar.

  A. practice (cramped_room, 1 soup to pass): lobby refused before passing;
     PRACTICE_JOIN seats them alone; a failed attempt; refresh mid-attempt
     resumes it; a scripted attempt serves a soup → passed, seat freed; lobby
     allowed; practice logs; admin stages
  B. practice time limit: never starting → practice_timeout (not paid by
     default); an attempt running past the limit ends right after it
  C. MIN_START_SIZE: two trained players waiting for a group of 3 start as a
     group of 2 at the lobby timeout; a lone player times out (no_group);
     validation of the setting
  D. PRACTICE=false: practice screen skipped (PRACTICE_STATUS skipped)

Usage, in server/ (sidecar running; SIDECAR_URL overrides :8001):
  npm run test:practice

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "practice-test-token";
const R = 0, D = 1, L = 2, U = 3, I = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await cond()) return true; await sleep(50); }
  return !!(await cond());
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

function startServer(dataDir, extra) {
  const env = {
    ...process.env,
    STUDY_CONFIG: "test/test.env", PORT: String(PORT), DATA_DIR: dataDir,
    GAME: "overcooked", LAYOUT: "open_room", MIN_GROUP_SIZE: "", ROUNDS: "1", HORIZON: "20", TICK_MS: "100",
    ADMIN_TOKEN: TOKEN, PRACTICE: "true", PRACTICE_LAYOUT: "cramped_room",
    ...extra,
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

function client(pid, { autoReady = false } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = { pid, ws, msgs: [], states: [], readySent: false };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      c.msgs.push(m);
      if (m.type === "STATE_UPDATE" && m.state.phase === "running") c.states.push(m.state);
      // Like the client's waiting room (shown only for the group): confirm ready once the lobby is full
      if (autoReady && m.type === "STATE_UPDATE" && m.state.phase === "lobby" && m.state.roomId?.startsWith("room_") &&
          m.state.playerCount >= m.state.maxParticipants && !c.readySent) {
        c.readySent = true;
        c.send({ type: "TRIAL_READY" });
      }
    });
    c.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    c.last = (type) => c.msgs.filter((m) => m.type === type).at(-1);
    c.all = (type) => c.msgs.filter((m) => m.type === type);
    c.ended = () => c.all("SESSION_STATUS").find((s) => s.status === "ended");
    c.me = () => c.states.at(-1)?.agents[c.last("ASSIGN_AGENT")?.agentId];
    ws.on("open", () => { c.send({ type: "HELLO", participantId: pid }); resolve(c); });
  });
}

/** Press once and wait until it has been applied (two state updates). */
async function press(c, action) {
  const n = c.states.length;
  c.send({ type: "PLAYER_ACTION", action });
  await waitFor(() => c.states.length >= n + 2, 3000);
}
const state = async () => (await fetch(`${BASE}/admin/state`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const stage = async (pid) => (await state()).participants.find((p) => p.participantId === pid)?.stage;
const roomLines = (dir, re) => fs.readdirSync(dir).filter((n) => re.test(n))
  .flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map(JSON.parse));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `tandem-practice-${name}-`));

(async () => {
  // ================= A. Practice with a soup to pass =================
  let dir = tmp("a");
  let srv = startServer(dir, { REQUIRED_PLAYERS: "2", PRACTICE_HORIZON: "120", PRACTICE_MIN_SOUPS: "1", PRACTICE_TIME_LIMIT_MS: "120000" });
  await srv.ready;
  check(srv.out.includes("solo practice: cramped_room, 120 steps per attempt, pass = 1 soup(s)"), "startup reports the practice settings");

  let p = await client("pr_p1");
  p.send({ type: "JOIN_LOBBY" });
  await waitFor(() => p.last("ERROR"));
  check(/practice/.test(p.last("ERROR")?.message ?? "") && !p.last("ASSIGN_ROOM"), "lobby refused before practice");

  p.send({ type: "PRACTICE_JOIN" });
  await waitFor(() => p.last("PRACTICE_STATUS"));
  let st = p.last("PRACTICE_STATUS");
  check(p.last("ASSIGN_ROOM")?.roomId === "practice_1" && p.last("ASSIGN_AGENT")?.agentId === "agent_0", "PRACTICE_JOIN → own practice room, agent_0");
  check(st.attempts === 0 && st.passed === false && st.required === 1 && Math.abs(st.deadline - (Date.now() + 120000)) < 2000, "PRACTICE_STATUS: 0 attempts, 1 soup required, deadline");
  let s = await state();
  check(await stage("pr_p1") === "practice" && s.practiceRooms.length === 1 && s.rooms.length === 0 && s.settings.roomsOpened === 0,
    "admin: stage practice; practice room listed apart; not counted as a group room");

  // Attempt 1: idle; refresh mid-attempt resumes it
  p.send({ type: "TRIAL_READY" });
  await waitFor(() => p.last("TRIAL_START"));
  const spec = p.last("TRIAL_START").spec;
  check(spec.num_agents === 1 && spec.layout.name === "cramped_room", "attempt runs in cramped_room with one cook");
  await sleep(500);
  p.ws.close();
  await sleep(300);
  p = await client("pr_p1");
  await waitFor(() => p.last("SESSION_STATUS") && p.last("PRACTICE_STATUS"));
  const res = p.last("SESSION_STATUS");
  check(res.status === "resumed" && res.kind === "practice" && res.running === true && p.last("TRIAL_START"), "refresh mid-attempt → resumed (practice, running) + TRIAL_START");
  check(await waitFor(() => p.last("TRIAL_END"), 20000), "attempt 1 ends");
  await waitFor(() => p.last("PRACTICE_STATUS")?.attempts === 1);
  st = p.last("PRACTICE_STATUS");
  check(st.attempts === 1 && st.lastSoups === 0 && st.passed === false, "attempt 1: 0 soups → not passed");

  // Attempt 2: cook and serve a soup (spawn a = (1,1); onions (0,1); pot (2,0); plates (1,3); serve (3,3))
  p.send({ type: "TRIAL_READY" });
  await waitFor(() => p.all("TRIAL_START").length >= 2 && p.states.length > 0);
  const pot = () => p.states.at(-1)?.items.find((i) => i.pos[0] === 2 && i.pos[1] === 0);
  for (let k = 0; k < 3; k++) for (const a of k === 0 ? [L, I, R, U, I] : [L, I, R, U, I]) await press(p, a);
  check(pot()?.item === 12, "3 onions in the pot");
  for (const a of [D, L, D, I]) await press(p, a);
  check(p.me()?.inv === 1, "holding a plate");
  await waitFor(() => pot()?.timer === 0, 5000);
  for (const a of [U, R, U, I]) await press(p, a);
  check(p.me()?.inv === 15, "soup on the plate");
  for (const a of [D, R, D, I]) await press(p, a);
  check(p.states.at(-1)?.score === 20, "served (score 20)");
  check(await waitFor(() => p.last("PRACTICE_STATUS")?.attempts === 2, 20000), "attempt 2 ends");
  st = p.last("PRACTICE_STATUS");
  check(st.passed === true && st.lastSoups === 1, "attempt 2: 1 soup → passed");
  await sleep(300);
  s = await state();
  check(await stage("pr_p1") === "practice passed" && s.practiceRooms.length === 0, "passed: seat freed (practice room closed), stage practice passed");

  // Practice again after passing: just the status; then the lobby
  const n = p.all("ASSIGN_ROOM").length;
  p.send({ type: "PRACTICE_JOIN" });
  await waitFor(() => p.all("PRACTICE_STATUS").length >= 4);
  check(p.last("PRACTICE_STATUS").passed && p.all("ASSIGN_ROOM").length === n, "PRACTICE_JOIN after passing → status only, no new room");
  p.send({ type: "JOIN_LOBBY" });
  await waitFor(() => p.all("ASSIGN_ROOM").length > n);
  check(p.last("ASSIGN_ROOM").roomId === "room_1", "lobby allowed after passing (room_1)");
  p.ws.close();
  await sleep(200);
  const p2 = await client("pr_p1");
  await waitFor(() => p2.last("SESSION_STATUS"));
  check(p2.last("SESSION_STATUS").kind === "group", "reconnect in the lobby → resumed (group)");

  const pr = roomLines(dir, /_practice_1\.jsonl$/);
  const results = pr.filter((e) => e.event === "practice_result");
  check(pr.find((e) => e.event === "room_created")?.options.kind === "practice" && results.length === 2 &&
    results[0].soups === 0 && results[1].soups === 1 && results[1].passed, "practice log: kind practice, 2 results (0 then 1 soup)");
  check(pr.some((e) => e.event === "trial_end" && e.soups === 1) && pr.some((e) => e.event === "player_practice_passed"), "practice log: trial_end soups, player_practice_passed");
  p2.ws.close();
  await srv.stop();

  // ================= B. Practice time limit =================
  dir = tmp("b");
  srv = startServer(dir, { REQUIRED_PLAYERS: "2", PRACTICE_HORIZON: "60", PRACTICE_TIME_LIMIT_MS: "3000" });
  await srv.ready;
  const idle = await client("pr_idle");
  idle.send({ type: "PRACTICE_JOIN" });
  check(await waitFor(() => idle.ended(), 6000), "never started: practice time runs out");
  const e1 = idle.ended();
  check(e1?.outcome === "practice_timeout" && e1.paid === false && /3 seconds/.test(e1.reason), `practice_timeout, not paid by default (${e1?.reason})`);
  const idle2 = await client("pr_idle");
  await waitFor(() => idle2.last("SESSION_STATUS"));
  check(idle2.ended()?.outcome === "practice_timeout", "returning: still ended");
  idle2.send({ type: "JOIN_LOBBY" });
  await waitFor(() => idle2.last("ERROR"));
  check(!!idle2.last("ERROR") && !idle2.last("ASSIGN_ROOM"), "…and can't join the lobby");

  const slow = await client("pr_slow");
  slow.send({ type: "PRACTICE_JOIN" });
  await waitFor(() => slow.last("PRACTICE_STATUS"));
  slow.send({ type: "TRIAL_READY" });
  await sleep(4000);
  check(!slow.ended(), "mid-attempt past the limit: the attempt is allowed to finish");
  await waitFor(() => slow.ended(), 6000);
  const endAt = slow.msgs.indexOf(slow.ended()), trialEndAt = slow.msgs.indexOf(slow.last("TRIAL_END"));
  check(slow.ended()?.outcome === "practice_timeout" && trialEndAt >= 0 && trialEndAt < endAt, "ended right after that attempt (not passed)");
  for (const c of [idle2, slow]) c.ws.close();
  await srv.stop();

  // ================= C. Starting short at the lobby timeout =================
  dir = tmp("c");
  srv = startServer(dir, { REQUIRED_PLAYERS: "3", MIN_START_SIZE: "2", LOBBY_TIMEOUT_MS: "3000", PRACTICE_HORIZON: "10", PRACTICE_MIN_SOUPS: "0" });
  await srv.ready;
  check(srv.out.includes("groups of at least 2 start short"), "startup reports MIN_START_SIZE");
  const pass = async (c) => {
    c.send({ type: "PRACTICE_JOIN" });
    await waitFor(() => c.last("PRACTICE_STATUS"));
    c.send({ type: "TRIAL_READY" });
    await waitFor(() => c.last("PRACTICE_STATUS")?.passed, 10000);
  };
  const [a, b] = await Promise.all([client("pr_a", { autoReady: true }), client("pr_b", { autoReady: true })]);
  await Promise.all([pass(a), pass(b)]);
  check(a.last("PRACTICE_STATUS").passed && b.last("PRACTICE_STATUS").passed, "PRACTICE_MIN_SOUPS=0: any attempt passes");
  const before = { a: a.all("TRIAL_START").length, b: b.all("TRIAL_START").length };
  const groupStarted = () => a.all("TRIAL_START").length > before.a && b.all("TRIAL_START").length > before.b;
  a.send({ type: "JOIN_LOBBY" }); b.send({ type: "JOIN_LOBBY" });
  await waitFor(() => a.last("ASSIGN_ROOM")?.roomId.startsWith("room_") && b.last("ASSIGN_ROOM")?.roomId.startsWith("room_"));
  const joined = Date.now();
  await sleep(1500);
  check(!groupStarted(), "2 of 3 waiting: no start before the timeout");
  check(await waitFor(groupStarted, 8000), "at the timeout the group starts short");
  check(Date.now() - joined >= 2900 && a.last("TRIAL_START").spec.num_agents === 2, `…as a group of 2 after ${Date.now() - joined} ms (env re-created)`);
  check(!a.ended() && !b.ended(), "nobody ended as no_group");
  const solo = await client("pr_solo");
  await pass(solo);
  solo.send({ type: "JOIN_LOBBY" });
  check(await waitFor(() => solo.ended(), 8000) && solo.ended().outcome === "no_group", "alone (below MIN_START_SIZE) → no_group at the timeout");
  const rl = roomLines(dir, /_room_1\.jsonl$/);
  const rz = rl.find((e) => e.event === "room_resized");
  check(rz && rz.reason === "lobby_timeout" && rz.from === 3 && rz.to === 2, "room log: room_resized from 3 to 2, reason lobby_timeout");
  const post = (body) => fetch(`${BASE}/admin/settings`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let r = await post({ minStartSize: 4 });
  check(r.status === 400 && /can't be larger than the group size/.test((await r.json()).error), "minStartSize above group size → 400");
  r = await post({ minStartSize: null });
  check(r.status === 200 && (await r.json()).settings.minStartSize === null, "minStartSize null (never start short) accepted");
  for (const c of [a, b, solo]) c.ws.close();
  await srv.stop();

  // ================= D. Practice off: screen skipped =================
  dir = tmp("d");
  srv = startServer(dir, { REQUIRED_PLAYERS: "2", PRACTICE: "false" });
  await srv.ready;
  const q = await client("pr_q");
  q.send({ type: "PRACTICE_JOIN" });
  await waitFor(() => q.last("PRACTICE_STATUS"));
  check(q.last("PRACTICE_STATUS")?.skipped === true && !q.last("ASSIGN_ROOM"), "PRACTICE=false → PRACTICE_STATUS skipped, no room");
  q.send({ type: "JOIN_LOBBY" });
  check(await waitFor(() => q.last("ASSIGN_ROOM")), "lobby allowed without practice");
  q.ws.close();
  await srv.stop();

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
