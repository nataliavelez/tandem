/*
Lobby timeout, room cap and live settings from the admin view. Starts its own
servers (port 8098, temporary DATA_DIR; GAME=overcooked, 3 per room), so it
needs only the sidecar.

Checks: lobby timeout ends the wait as no_group (paid, own completion URL) and
stays ended on return; LOBBY_DEADLINE sent on join and re-sent when the timeout
changes (applies to people already waiting); 0 = no limit; settings endpoint
auth / validation; group size change resizes lobby rooms (repacking agent ids,
re-creating the env; never below the people seated) but not started groups;
minimum group size; MAX_ROOMS turns newcomers away (no_group) until raised;
settings_changed logged; the sidecar refuses a size the layout can't seat.

Usage, in server/ (sidecar running; SIDECAR_URL overrides :8001):
  npm run test:lobby

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8098;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "lobby-test-token";
const NG_URL = "https://example.test/complete?cc=TEST_NO_GROUP";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-lobby-"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await cond()) return true; await sleep(50); }
  return !!(await cond());
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

function startServer(extra = {}) {
  const env = {
    ...process.env,
    STUDY_CONFIG: "test/test.env", PORT: String(PORT), DATA_DIR,
    GAME: "overcooked", LAYOUT: "open_room", REQUIRED_PLAYERS: "3", MIN_GROUP_SIZE: "", ROUNDS: "1",
    HORIZON: "20", TICK_MS: "100", LOBBY_TIMEOUT_MS: "2000",
    NO_GROUP_COMPLETION_URL: NG_URL, ADMIN_TOKEN: TOKEN,
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

function client(pid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = { pid, ws, msgs: [], states: [] };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      c.msgs.push(m);
      if (m.type === "STATE_UPDATE" && m.state.phase === "running") c.states.push(m.state);
    });
    c.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    c.last = (type) => c.msgs.filter((m) => m.type === type).at(-1);
    c.all = (type) => c.msgs.filter((m) => m.type === type);
    c.ended = () => c.all("SESSION_STATUS").find((s) => s.status === "ended");
    c.lobby = () => c.msgs.filter((m) => m.type === "STATE_UPDATE" && m.state.phase === "lobby").at(-1)?.state;
    ws.on("open", () => { c.send({ type: "HELLO", participantId: pid }); resolve(c); });
  });
}

const post = (body, { token = TOKEN, type = "application/json" } = {}) =>
  fetch(`${BASE}/admin/settings`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
const state = async () => (await fetch(`${BASE}/admin/state`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const readLog = (suffix) => fs.readdirSync(DATA_DIR).filter((n) => n.endsWith(suffix))
  .flatMap((f) => fs.readFileSync(path.join(DATA_DIR, f), "utf8").trim().split("\n").map(JSON.parse));

(async () => {
  const srv = startServer();
  await srv.ready;
  check(srv.out.includes("lobby timeout 2s") && srv.out.includes("unlimited rooms"), "startup reports lobby timeout and room cap");

  // ---- A. Lobby timeout ----
  const a = await client("lob_a");
  a.send({ type: "JOIN_LOBBY" });
  await waitFor(() => a.last("LOBBY_DEADLINE"));
  const d = a.last("LOBBY_DEADLINE");
  check(d && d.paid === true && Math.abs(d.deadline - (Date.now() + 2000)) < 600, "LOBBY_DEADLINE on join: ~2 s, paid");
  check(await waitFor(() => a.ended(), 5000), "lobby timeout ends the wait");
  const endA = a.ended();
  check(endA?.outcome === "no_group" && endA.paid === true && endA.completionUrl === NG_URL && /within/.test(endA.reason),
    `ended as no_group, paid, own completion URL (${endA?.reason})`);
  const a2 = await client("lob_a");
  await waitFor(() => a2.all("SESSION_STATUS").length);
  check(a2.ended()?.outcome === "no_group", "returning after the timeout: still ended (no_group)");
  check((await state()).participants.find((p) => p.participantId === "lob_a")?.stage === "ended: no_group", "admin stage: ended: no_group");

  // ---- B. Changing the timeout applies to people already waiting ----
  const b = await client("lob_b");
  b.send({ type: "JOIN_LOBBY" });
  const joinedB = Date.now();
  await waitFor(() => b.last("LOBBY_DEADLINE"));
  let r = await post({ lobbyTimeoutMs: 5000 });
  check(r.status === 200 && (await r.json()).settings.lobbyTimeoutMs === 5000, "POST lobbyTimeoutMs → 200");
  await waitFor(() => b.all("LOBBY_DEADLINE").length >= 2, 2000);
  const d2 = b.last("LOBBY_DEADLINE");
  check(d2 && Math.abs(d2.deadline - (joinedB + 5000)) < 600, "waiting participant gets the new deadline (from when they joined)");
  await sleep(3000 - (Date.now() - joinedB));
  check(!b.ended(), "still waiting past the old 2 s limit");
  check(await waitFor(() => b.ended(), 4000), "ended at the new 5 s limit");
  r = await post({ lobbyTimeoutMs: 0 });
  check(r.status === 200, "lobbyTimeoutMs 0 (no limit) accepted");

  // ---- C. Endpoint auth and validation ----
  check((await post({ groupSize: 2 }, { token: "wrong" })).status === 401, "wrong token → 401");
  check((await post({ groupSize: 2 }, { type: "text/plain" })).status === 415, "not JSON → 415");
  check((await post("{bad json")).status === 400, "bad JSON → 400");
  check((await fetch(`${BASE}/admin/settings`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status === 405, "GET /admin/settings → 405");
  for (const [body, label] of [
    [{ groupSize: 0 }, "group size 0"], [{ groupSize: 11 }, "group size 11"], [{ groupSize: 2.5 }, "group size 2.5"],
    [{ minGroupSize: 4 }, "minimum above group size"], [{ lobbyTimeoutMs: -1 }, "negative timeout"],
    [{ maxRooms: -1 }, "negative rooms"], [{ colour: "red" }, "unknown setting"],
  ]) {
    const res = await post(body);
    const err = res.status === 400 ? (await res.json()).error : null;
    check(res.status === 400 && err, `rejected: ${label} (${err})`);
  }
  check((await state()).settings.current.groupSize === 3, "rejected changes left the settings alone");

  // ---- D. Group size: lobby rooms resized, agent ids repacked, env re-created ----
  r = await post({ groupSize: 4 });
  check(r.status === 200, "group size → 4");
  const [p5, p6, p7] = await Promise.all(["lob_p5", "lob_p6", "lob_p7"].map(client));
  for (const c of [p5, p6, p7]) { c.send({ type: "JOIN_LOBBY" }); await sleep(100); }
  await waitFor(() => [p5, p6, p7].every((c) => c.last("ASSIGN_AGENT")));
  check(p5.lobby()?.maxParticipants === 4 && p7.last("ASSIGN_AGENT").agentId === "agent_2", "new room has 4 seats; p7 is agent_2");
  p6.ws.close(); // agent_1 leaves (lobby grace 2 s)
  await waitFor(() => p5.lobby()?.playerCount === 2, 5000);
  r = await post({ groupSize: 2 });
  const resized = (await r.json()).resizedRooms;
  const roomD = p5.last("ASSIGN_ROOM").roomId;
  check(r.status === 200 && resized[roomD] === 2, `lobby room resized to 2 (${JSON.stringify(resized)})`);
  await waitFor(() => p7.last("ASSIGN_AGENT").agentId === "agent_1", 2000);
  check(p7.last("ASSIGN_AGENT").agentId === "agent_1" && p5.all("ASSIGN_AGENT").length === 1, "p7 repacked agent_2 → agent_1 (told via ASSIGN_AGENT); p5 unchanged");
  check(p5.lobby()?.maxParticipants === 2, "lobby state shows the new size");
  p5.send({ type: "TRIAL_READY" }); p7.send({ type: "TRIAL_READY" });
  check(await waitFor(() => p7.last("TRIAL_START"), 15000), "resized room starts");
  check(p7.last("TRIAL_START").spec.num_agents === 2, "env re-created for 2 agents");
  await waitFor(() => p7.states.length > 2);
  const before = p7.states.at(-1).agents.agent_1.pos;
  p7.send({ type: "PLAYER_ACTION", action: 3 }); // up
  await waitFor(() => p7.states.at(-1).agents.agent_1.pos[1] !== before[1], 3000);
  check(p7.states.at(-1).agents.agent_1.pos[1] === before[1] - 1, "repacked player controls agent_1");

  // Never below the people already seated; started groups keep their size
  r = await post({ groupSize: 4 });
  const trio = await Promise.all(["lob_t1", "lob_t2", "lob_t3"].map(client));
  for (const c of trio) { c.send({ type: "JOIN_LOBBY" }); await sleep(100); }
  await waitFor(() => trio.every((c) => c.lobby()?.playerCount === 3));
  r = await post({ groupSize: 2 });
  const roomT = trio[0].last("ASSIGN_ROOM").roomId;
  const res2 = (await r.json()).resizedRooms;
  check(res2[roomT] === 3 && !(roomD in res2), `room with 3 seated keeps 3 (not below them); started room untouched (${JSON.stringify(res2)})`);
  for (const c of trio) c.send({ type: "TRIAL_READY" });
  check(await waitFor(() => trio[0].last("TRIAL_START"), 15000) && trio[0].last("TRIAL_START").spec.num_agents === 3, "…and starts as a group of 3");

  // ---- E. Minimum group size ----
  r = await post({ groupSize: 3, minGroupSize: 2 });
  const m1 = await client("lob_m1");
  m1.send({ type: "JOIN_LOBBY" });
  await waitFor(() => m1.last("ASSIGN_ROOM"));
  let s = await state();
  const roomM = s.rooms.find((x) => x.id === m1.last("ASSIGN_ROOM").roomId);
  check(roomM?.capacity === 3 && roomM.minGroupSize === 2, "new room: 3 seats, minimum 2");
  check(s.rooms.find((x) => x.id === roomT)?.minGroupSize === 3, "started room keeps its minimum");
  r = await post({ minGroupSize: null });
  s = await state();
  check(s.rooms.find((x) => x.id === roomM.id)?.minGroupSize === 3, "minimum back to group size (null) for the lobby room");

  // ---- F. Room cap ----
  s = await state();
  r = await post({ maxRooms: s.settings.roomsOpened });
  check(r.status === 200, `maxRooms → ${s.settings.roomsOpened} (rooms opened so far)`);
  const [m2, m3] = await Promise.all(["lob_m2", "lob_m3"].map(client));
  m2.send({ type: "JOIN_LOBBY" }); m3.send({ type: "JOIN_LOBBY" });
  await waitFor(() => m2.last("ASSIGN_ROOM") && m3.last("ASSIGN_ROOM"));
  check(m2.last("ASSIGN_ROOM").roomId === roomM.id && m3.last("ASSIGN_ROOM").roomId === roomM.id, "at the cap, newcomers still fill the open room");
  const late = await client("lob_late");
  late.send({ type: "JOIN_LOBBY" });
  await waitFor(() => late.ended(), 3000);
  check(late.ended()?.outcome === "no_group" && /full/.test(late.ended().reason) && late.ended().paid === true && !late.last("ASSIGN_ROOM"),
    `no open room and cap reached → no_group "${late.ended()?.reason}"`);
  r = await post({ maxRooms: null });
  const later = await client("lob_later");
  later.send({ type: "JOIN_LOBBY" });
  check(await waitFor(() => later.last("ASSIGN_ROOM"), 3000), "cap removed → newcomer gets a room");

  // ---- G. Logs ----
  const people = readLog("_participants.jsonl");
  const changes = people.filter((e) => e.event === "settings_changed");
  check(changes.length >= 8 && changes.every((e) => e.by === "admin" && e.changes && e.settings), `settings_changed logged (${changes.length})`);
  check(people.some((e) => e.event === "turned_away" && e.participantId === "lob_late"), "turned_away logged");
  const roomLines = fs.readdirSync(DATA_DIR).filter((n) => /_room_\d+\.jsonl$/.test(n))
    .flatMap((f) => fs.readFileSync(path.join(DATA_DIR, f), "utf8").trim().split("\n").map(JSON.parse));
  check(roomLines.some((e) => e.event === "player_timed_out" && e.participantId === "lob_a"), "room log: player_timed_out");
  const rs = roomLines.find((e) => e.event === "room_resized" && e.room === roomD);
  check(rs && rs.from === 4 && rs.to === 2 && rs.moved.lob_p7?.to === "agent_1", "room log: room_resized with the moved seat");
  check((await state()).settings.file.groupSize === 3, "file settings unchanged");

  for (const c of [a2, p5, p7, m1, m2, m3, later, ...trio]) c.ws.close();
  await srv.stop();

  // ---- H. The sidecar refuses a size the layout can't seat; default timeout ----
  const small = startServer({ LAYOUT: "cramped_room", REQUIRED_PLAYERS: "2", LOBBY_TIMEOUT_MS: "" });
  await small.ready;
  check(small.out.includes("lobby timeout 600s"), "LOBBY_TIMEOUT_MS unset → 10 minutes");
  r = await post({ groupSize: 3 });
  const err = r.status === 400 ? (await r.json()).error : "";
  check(r.status === 400 && /can't be set up for 3 players/.test(err) && /seats 1-2/.test(err), `layout too small → refused (${err.slice(0, 90)}…)`);
  check((await state()).settings.current.groupSize === 2, "group size unchanged after the refusal");
  await small.stop();

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
