/*
Overcooked end-to-end through the server: 10 cooks in one room (open_room).
Starts its own servers (port 8093, temporary DATA_DIR, GAME=overcooked), so it
needs only the sidecar.

Checks: the server refuses a layout that can't seat the group; seating and
room splitting; strictly one step per key press (and the press queue cap);
anti-spoofing; idle and disconnected cooks stay put (stay = 4, not action 0 =
right); a dropped player's cook stays on the grid; one cook makes and delivers
a soup (score 20); the data log has what's needed to rebuild every state.

Usage, in server/ (sidecar running; SIDECAR_URL overrides :8001):
  npm run test:overcooked

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8093;
const URL = `ws://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-overcooked-"));
const RIGHT = 0, DOWN = 1, LEFT = 2, UP = 3, STAY = 4, INTERACT = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!cond() && Date.now() < end) await sleep(50);
  return cond();
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

function startServer(extraEnv = {}) {
  const env = {
    ...process.env,
    STUDY_CONFIG: "test/test.env", PORT: String(PORT), DATA_DIR,
    GAME: "overcooked", LAYOUT: "open_room", REQUIRED_PLAYERS: "10", MIN_GROUP_SIZE: "9",
    HORIZON: "300", TICK_MS: "100",
    ...extraEnv,
  };
  const proc = spawn("node", ["-r", "ts-node/register/transpile-only", "src/index.ts"],
    { cwd: path.resolve(__dirname, ".."), env });
  const srv = { proc, out: "", exited: false, code: null };
  proc.stdout.on("data", (d) => { srv.out += d; });
  proc.stderr.on("data", (d) => { srv.out += d; });
  proc.on("exit", (code) => { srv.exited = true; srv.code = code; });
  srv.stop = async () => { proc.kill("SIGTERM"); return waitFor(() => srv.exited, 15000); };
  return srv;
}

function bot(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const b = { name, ws, roomId: null, agentId: null, states: [], starts: [], ends: [] };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "ASSIGN_ROOM") b.roomId = m.roomId;
      if (m.type === "ASSIGN_AGENT") b.agentId = m.agentId;
      if (m.type === "TRIAL_START") b.starts.push(m);
      if (m.type === "TRIAL_END") b.ends.push(m);
      if (m.type === "STATE_UPDATE" && m.state.phase === "running") b.states.push(m.state);
    });
    b.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    b.last = () => b.states.at(-1);
    b.me = () => b.last()?.agents[b.agentId];
    ws.on("open", () => resolve(b));
  });
}

/** Press a key once and wait until the press has been applied (two ticks later). */
async function press(b, action) {
  const n = b.states.length;
  b.send({ type: "PLAYER_ACTION", action });
  await waitFor(() => b.states.length >= n + 2, 3000);
  return b.last();
}

(async () => {
  // 1. A layout that can't seat the group: the server refuses to start
  const bad = startServer({ REQUIRED_PLAYERS: "11" });
  await waitFor(() => bad.exited, 30000);
  check(bad.exited && bad.code === 1 && bad.out.includes("rejected this study's game settings"),
    "server exits when the layout has fewer spawns than REQUIRED_PLAYERS");

  const srv = startServer();
  await waitFor(() => srv.out.includes("sidecar warmed up"), 30000);
  check(srv.out.includes("(overcooked, 10 players/room)"), "server runs overcooked, 10 players/room");

  // 2. Seating: 10 cooks fill room_1; the 11th opens another room
  const bots = [];
  for (let i = 0; i < 11; i++) { const b = await bot(`p${i}`); b.send({ type: "JOIN_LOBBY" }); bots.push(b); }
  await waitFor(() => bots.every((b) => b.agentId));
  const group = bots.slice(0, 10), late = bots[10];
  const agents = group.map((b) => b.agentId);
  check(new Set(group.map((b) => b.roomId)).size === 1 && new Set(agents).size === 10, "10 cooks share one room, distinct agents");
  check(late.roomId !== group[0].roomId, "11th player goes to a new room");
  const by = Object.fromEntries(group.map((b) => [b.agentId, b]));

  // 3. Trial start
  for (const b of group) b.send({ type: "TRIAL_READY" });
  check(await waitFor(() => group.every((b) => b.states.length > 0), 20000), "trial started for all 10");
  const start = group[0].starts[0];
  const spec = start.spec;
  check(spec.game === "overcooked" && spec.num_agents === 10 && spec.layout.name === "open_room", "TRIAL_START spec: overcooked, 10 agents, open_room");
  check(spec.action_space.noop === STAY && start.tickMs === 100, "spec noop = stay (4); TRIAL_START carries tickMs");
  const first = group[0].states[0];
  check(first.game === "overcooked" && Array.isArray(first.items) && first.score === 0, "running state: game, items, score");
  const spawn = (a) => spec.layout.spawns[Number(a.split("_")[1])];
  check(agents.every((a) => JSON.stringify(first.agents[a].pos) === JSON.stringify(spawn(a))), "cooks start on their spawns");

  // 4. Anti-spoofing: agent_1 claims agent_2 and presses up -> only agent_1 moves
  by.agent_1.send({ type: "PLAYER_ACTION", agentId: "agent_2", action: UP });
  await sleep(400);
  const s4 = by.agent_1.last();
  check(JSON.stringify(s4.agents.agent_1.pos) === "[8,4]", `spoofer's own cook moved up instead (${s4.agents.agent_1.pos})`);
  check(JSON.stringify(s4.agents.agent_2.pos) === JSON.stringify(spawn("agent_2")), "spoofed agent_2 did not move");

  // 5. Press queue cap: 5 quick presses -> at most 2 applied
  for (let i = 0; i < 5; i++) by.agent_3.send({ type: "PLAYER_ACTION", action: RIGHT });
  await sleep(800);
  check(JSON.stringify(by.agent_3.me().pos) === "[4,5]", `5 quick presses moved 2 cells (queue cap) (${by.agent_3.me().pos})`);

  // 6. Disconnect: agent_4 leaves; its cook stays put (seat held, then dropped)
  by.agent_4.ws.close();
  await sleep(1000);
  check(JSON.stringify(group[0].last().agents.agent_4.pos) === JSON.stringify(spawn("agent_4")), "disconnected cook stays put");

  // 7. One cook makes and delivers a soup: agent_0 starts at (2,2)
  const a0 = by.agent_0;
  const steps = async (...seq) => { for (const a of seq) await press(a0, a); return a0.last(); };
  const pot = (st) => st.items.find((i) => i.pos[0] === 3 && i.pos[1] === 0);
  let st = await steps(LEFT);
  check(JSON.stringify(a0.me().pos) === "[1,2]", "one press moves exactly one cell");
  await sleep(500);
  check(JSON.stringify(a0.me().pos) === "[1,2]", "no movement without further presses");
  st = await steps(UP, LEFT, INTERACT);
  check(a0.me().inv === 4, "picked up an onion");
  st = await steps(RIGHT, RIGHT, UP, INTERACT, LEFT, LEFT, LEFT, INTERACT, RIGHT, RIGHT, UP, INTERACT,
                   LEFT, LEFT, LEFT, INTERACT, RIGHT, RIGHT, UP, INTERACT);
  check(pot(st)?.item === 12 && pot(st).timer > 0, "3 onions in the pot, cooking");
  st = await steps(DOWN, DOWN, LEFT, LEFT, LEFT, INTERACT);
  check(a0.me().inv === 1, "picked up a plate");
  await waitFor(() => pot(a0.last())?.timer === 0, 5000);
  st = await steps(RIGHT, RIGHT, UP, UP, UP, INTERACT);
  check(a0.me().inv === 15, "plated the soup");
  st = await steps(DOWN, DOWN, DOWN, LEFT, LEFT, LEFT, INTERACT);
  check(a0.me().inv === 0 && a0.last().score === 20, `delivered: team score 20 (${a0.last().score})`);
  check(group.filter((b) => b.ws.readyState === 1).every((b) => b.last().score === 20), "every cook sees the score");

  // 8. Dropped player (grace 3 s, group min 9): group continues, cook stays on the grid
  const s8 = a0.last();
  check(!s8.agents.agent_4.isHuman && JSON.stringify(s8.agents.agent_4.pos) === JSON.stringify(spawn("agent_4")),
    "dropped player's cook stays on its cell, no longer human");
  const idle = ["agent_5", "agent_6", "agent_7", "agent_8", "agent_9"];
  check(idle.every((a) => JSON.stringify(s8.agents[a].pos) === JSON.stringify(spawn(a))), "idle cooks never moved");

  // 9. Trial end + data log
  check(await waitFor(() => a0.ends.length > 0, 30000), "trial ended at the horizon");
  await srv.stop();
  const file = fs.readdirSync(DATA_DIR).find((f) => f.endsWith(`_${a0.roomId}.jsonl`));
  const log = fs.readFileSync(path.join(DATA_DIR, file), "utf8").trim().split("\n").map(JSON.parse);
  const created = log.find((e) => e.event === "room_created");
  check(created.study.game === "overcooked" && created.study.layout === "open_room" && created.options.game === "overcooked",
    "room_created records game and layout");
  const ts = log.find((e) => e.event === "trial_start");
  check(ts.initialState.items.length === 0 && Object.keys(ts.initialState.agents).length === 10, "trial_start.initialState has 10 cooks, empty kitchen");
  const ticks = log.filter((e) => e.event === "tick");
  check(ticks.length === 300 && ticks.every((t, i) => t.step === i + 1), "300 sequential ticks logged");
  check(ticks.every((t) => t.items && typeof t.recipe === "number" && "newCorrectDelivery" in t && t.shapedRewards), "ticks have items, recipe, delivery flag, shaped rewards");
  const a0Actions = ticks.map((t) => t.actions.agent_0).filter((a) => a !== STAY);
  check(a0Actions.length === 1 + 3 + 20 + 6 + 6 + 7, `agent_0's non-stay actions = its presses (${a0Actions.length})`);
  check(ticks.every((t) => idle.every((a) => t.actions[a] === STAY)), "idle cooks logged as stay (4) every tick");
  check(ticks.filter((t) => t.newCorrectDelivery).length === 1 && ticks.at(-1).score === 20, "one delivery logged; final score 20");
  check(log.some((e) => e.event === "player_dropped" && e.agentId === "agent_4"), "player_dropped logged");

  for (const b of bots) b.ws.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
