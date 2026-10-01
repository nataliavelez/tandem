/*
Headless test for participant identity, reconnection, seat holding, and the
per-room data log.

Usage (sidecar must be running on :8001), in server/:
  1. STUDY_CONFIG=test/test.env npm run dev
  2. npm run test:reconnect        (or npm run test:all)
Set BOTS_URL / DATA_DIR if the server uses a different address / data folder.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const URL = process.env.BOTS_URL ?? "ws://127.0.0.1:8090";
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../data");
const LOBBY_GRACE_MS = 2000;
const TRIAL_GRACE_MS = 3000;
const RUN = Date.now().toString(36);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!cond() && Date.now() < end) await sleep(50);
  return cond();
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

/** Connect and say HELLO as `pid`. */
function bot(pid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const b = { pid, ws, msgs: [], status: null, roomId: null, agentId: null, starts: [], ends: [], states: [], closed: false };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      b.msgs.push(m);
      if (m.type === "SESSION_STATUS") b.status = m;
      if (m.type === "ASSIGN_ROOM") b.roomId = m.roomId;
      if (m.type === "ASSIGN_AGENT") b.agentId = m.agentId;
      if (m.type === "TRIAL_START") b.starts.push(m);
      if (m.type === "TRIAL_END") b.ends.push(m);
      if (m.type === "STATE_UPDATE" && m.state.phase === "running") b.states.push(m);
    });
    ws.on("close", () => { b.closed = true; });
    b.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    ws.on("open", () => { b.send({ type: "HELLO", participantId: pid, meta: { STUDY_ID: "test" } }); resolve(b); });
  });
}

async function holdAction(b, action, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { b.send({ type: "PLAYER_ACTION", action }); await sleep(50); }
}

(async () => {
  // --- Validation
  const bad = await bot("bad id!");
  await waitFor(() => bad.msgs.some((m) => m.type === "ERROR"), 2000);
  check(bad.msgs.some((m) => m.type === "ERROR" && /participantId/.test(m.message)), "invalid participantId rejected");
  bad.ws.close();

  // --- Fresh participant gets status "new"
  const ids = [0, 1, 2].map((i) => `p_${RUN}_${i}`);
  let [a, b, c] = await Promise.all(ids.map(bot));
  await waitFor(() => a.status && b.status && c.status);
  check([a, b, c].every((x) => x.status.status === "new"), "fresh participants get SESSION_STATUS new");
  check(a.msgs.some((m) => m.type === "ASSIGN_ID" && m.id === ids[0]), "ASSIGN_ID echoes the participant id");

  for (const x of [a, b, c]) x.send({ type: "JOIN_LOBBY" });
  await waitFor(() => a.agentId && b.agentId && c.agentId);
  const roomId = a.roomId;
  check(b.roomId === roomId && c.roomId === roomId, `all three seated in ${roomId}`);

  // --- Lobby: disconnect and return within grace → same seat
  const cAgent = c.agentId;
  c.ws.close();
  await sleep(500);
  c = await bot(ids[2]);
  await waitFor(() => c.status);
  check(c.status.status === "resumed" && c.status.roomId === roomId && c.status.agentId === cAgent && c.status.running === false,
    `lobby reconnect within grace → resumed same seat (${c.status.status} ${c.status.agentId})`);

  // --- Start trial; mid-trial disconnect + reconnect
  for (const x of [a, b, c]) x.send({ type: "TRIAL_READY" });
  await waitFor(() => a.starts.length === 1);
  check(a.starts.length === 1, "trial 1 started");
  const originalStart = a.starts[0].startTimestamp;
  const bAgent = b.agentId;
  b.ws.close();
  await sleep(600);
  check(a.states.at(-1).state.agents[bAgent] !== undefined, "disconnected player's agent still in the game");
  b = await bot(ids[1]);
  await waitFor(() => b.status && b.starts.length === 1, 3000);
  check(b.status.status === "resumed" && b.status.running === true && b.status.trialsCompleted === 0,
    `mid-trial reconnect → resumed, running, 0 completed`);
  check(b.starts[0]?.startTimestamp === originalStart, "reconnected player gets the ORIGINAL TRIAL_START (timer stays in sync)");
  await holdAction(b, 2, 600);
  const vel = a.states.at(-1).state.agents[bAgent].vel;
  check(vel[0] > 0.5, `reconnected player controls the same agent again (${bAgent} vx=${vel[0].toFixed(2)})`);

  // --- Second tab takes over
  const b2 = await bot(ids[1]);
  await waitFor(() => b2.status && b.closed, 3000);
  const endedMsg = b.msgs.find((m) => m.type === "SESSION_STATUS" && m.status === "ended");
  check(!!endedMsg && endedMsg.outcome === "replaced" && b.closed, `old tab told session ended (replaced) and closed ("${endedMsg?.reason}")`);
  check(b2.status?.status === "resumed" && b2.status.agentId === bAgent, "new tab resumed the same seat");
  b = b2;

  await waitFor(() => a.ends.length === 1);
  check(a.ends.length === 1 && b.ends.length === 1, "trial 1 ended for everyone, including the reconnected player");

  // --- Between rounds: reconnect reports trialsCompleted
  b.ws.close();
  await sleep(300);
  b = await bot(ids[1]);
  await waitFor(() => b.status);
  check(b.status.status === "resumed" && b.status.running === false && b.status.trialsCompleted === 1,
    "between-rounds reconnect → resumed, not running, 1 completed");

  // --- Locked group: stay away longer than TRIAL_GRACE_MS → ended
  const cAgent2 = c.agentId;
  c.ws.close();
  await sleep(TRIAL_GRACE_MS + 800);
  c = await bot(ids[2]);
  await waitFor(() => c.status);
  check(c.status.status === "ended" && c.status.outcome === "dropped", `return after trial grace → ended/dropped ("${c.status.reason}")`);
  c.send({ type: "JOIN_LOBBY" });
  await waitFor(() => c.msgs.some((m) => m.type === "ERROR"), 2000);
  check(c.msgs.some((m) => m.type === "ERROR" && /Session ended/.test(m.message)) && !c.roomId,
    "ended participant cannot join a new group");
  const lobby = a.msgs.filter((m) => m.type === "STATE_UPDATE" && m.state.phase === "lobby").at(-1);
  check(lobby && lobby.state.playerCount === 2 && !Object.keys(lobby.state.players).includes(ids[2]),
    `dropped player's seat (${cAgent2}) freed`);
  c.ws.close();

  // --- Lobby grace expiry → status new (seat freed, may rejoin)
  const lone = await bot(`p_${RUN}_lone`);
  await waitFor(() => lone.status);
  lone.send({ type: "JOIN_LOBBY" });
  await waitFor(() => lone.roomId);
  const loneRoom = lone.roomId;
  lone.ws.close();
  await sleep(LOBBY_GRACE_MS + 800);
  const lone2 = await bot(`p_${RUN}_lone`);
  await waitFor(() => lone2.status);
  check(lone2.status.status === "new", "return after lobby grace → new (may join again)");
  lone2.ws.close();

  // --- Everyone leaves; wait for grace so rooms are disposed and logs closed
  for (const x of [a, b]) x.ws.close();
  await sleep(TRIAL_GRACE_MS + 1000);

  // --- Data log
  const file = fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(`_${roomId}.jsonl`))
    .map((f) => path.join(DATA_DIR, f))
    .sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
  check(!!file, `data log exists for ${roomId}`);
  if (file) {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const ev = (name) => lines.filter((l) => l.event === name);
    console.log(`      ${path.basename(file)}: ${lines.length} lines`);
    check(ev("room_created").length === 1, "log: room_created");
    check(ev("player_joined").length === 3 && ev("player_joined").every((l) => l.meta?.STUDY_ID === "test"),
      "log: 3 player_joined with recruitment meta");
    check(ev("trial_start").length === 1 && ev("trial_end").length === 1, "log: trial_start + trial_end");
    const ticks = ev("tick");
    check(ticks.length === 30 && ticks.every((t, i) => t.step === i + 1), `log: 30 sequential ticks (${ticks.length})`);
    check(ticks.every((t) => t.actions && t.connected && t.agents && t.rewards && typeof t.stepLatencyMs === "number"),
      "log: ticks have actions, connected, agents, rewards, latency");
    check(ticks.some((t) => t.connected[bAgent] === false) && ticks.some((t) => t.connected[bAgent] === true),
      "log: ticks record the disconnected stretch");
    check(ticks.some((t) => t.actions[bAgent] === 2), "log: reconnected player's actions recorded");
    check(ev("player_disconnected").length >= 3 && ev("player_reconnected").length >= 2 && ev("player_replaced").length === 1,
      "log: disconnected / reconnected / replaced events");
    check(ev("player_dropped").some((l) => l.participantId === ids[2]), "log: player_dropped for the expired participant");
    check(ev("room_disposed").length === 1, "log: room_disposed");
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures ? 1 : 0);
})();
