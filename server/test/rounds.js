/*
Rounds in the scaling-sweep design (Overcooked, lab JaxMARL fork): the sweep's
kitchen, a different pots / cook-time condition each round (ROUND_CONDITIONS,
order rotated across groups), rounds that end when the team has served the
order (ORDER_SIZE), and the speed bonus. Starts its own servers (port 8095,
temporary DATA_DIR), so it needs only the sidecar.

  A. Solo practice in the sweep kitchen (PRACTICE_CONDITION p1_c20): the attempt
     ends as soon as the soup needed to pass is served (order_complete)
  B. Group 1 (one cook): rounds p1_c5, p2_c20, p5_c60 in that order, each with
     its own kitchen (pots, cook time); rounds 1-2 served → end at step 35,
     round 3 idle → runs to HORIZON; round results logged; speed bonus,
     orders 2 of 3 on COMPLETION and in study_completed
  C. Group 2 starts at the second condition (rotation)
  D. Settings errors stop the server: ROUNDS that doesn't match, a bad condition

Usage, in server/ (sidecar running, on the lab fork; SIDECAR_URL overrides :8001):
  npm run test:rounds

Created by: Elizabeth Mieczkowski, Updated: 11/2026
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8095;
const HORIZON = 250;
const R = 0, D = 1, L = 2, U = 3, I = 5;
// One cook from the sweep kitchen's first spawn (5,3): onion (0,2) → pot (1,0) →
// plate (0,4) → wait at the pot → serve at (0,3) (cook time ≤ 20). The clock runs
// between presses (no-ops), so the step it is served on varies from run to run.
const ONE_SOUP = [U, L, L, L, L, L, I, U, U, I, D, D, D, L, I, U, U, U, U, ...Array(12).fill(I), D, D, L, I];
// Pot cells in the order the sweep's "nearest" placement adds them
const NEAREST_POTS = [[1, 0], [10, 0], [0, 1], [11, 1], [2, 0]];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await cond()) return true; await sleep(30); }
  return !!(await cond());
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `tandem-rounds-${name}-`));

const SETTINGS = {
  STUDY_CONFIG: "test/test.env", PORT: String(PORT),
  GAME: "overcooked", LAYOUT: "scaling_kitchen", REQUIRED_PLAYERS: "1", MIN_GROUP_SIZE: "1",
  ROUNDS: "", HORIZON: String(HORIZON), TICK_MS: "25",
  ROUND_CONDITIONS: "p1_c5,p2_c20,p5_c60", CONDITION_ORDER: "rotate",
  ORDER_SIZE: "1", RECIPE_SIZE: "1", POT_PLACEMENT: "nearest", NO_COLLISION: "false",
  PRACTICE: "false", BONUS_PER_SOUP: "", BONUS_SPEED_PER_ROUND: "0.50", BONUS_MAX: "2",
  COMPLETION_URL: "https://example.test/complete?cc=DONE",
};

function startServer(dataDir, extra = {}) {
  const env = { ...process.env, ...SETTINGS, DATA_DIR: dataDir, ...extra };
  const proc = spawn("node", ["-r", "ts-node/register/transpile-only", "src/index.ts"], { cwd: path.resolve(__dirname, ".."), env });
  const srv = { proc, out: "", exited: false, code: null };
  proc.stdout.on("data", (d) => { srv.out += d; });
  proc.stderr.on("data", (d) => { srv.out += d; });
  proc.on("exit", (code) => { srv.exited = true; srv.code = code; });
  srv.ready = waitFor(() => srv.out.includes("sidecar warmed up") || srv.exited, 60000);
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
    ws.on("open", () => { c.send({ type: "HELLO", participantId: pid }); resolve(c); });
  });
}

/** Press once and wait until it has been applied (two state updates). */
async function press(c, action) {
  const n = c.states.length;
  c.send({ type: "PLAYER_ACTION", action });
  await waitFor(() => c.states.length >= n + 2, 3000);
}

const pots = (spec) => spec.layout.rows.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === "P" ? [[x, y]] : [])));
const samePots = (spec, n) => JSON.stringify(pots(spec).sort()) === JSON.stringify(NEAREST_POTS.slice(0, n).sort());
const readLog = (dir, suffix) => fs.readdirSync(dir).filter((f) => f.endsWith(suffix))
  .flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map(JSON.parse));

/** Play one round: serve a soup (or stay idle) and wait for its TRIAL_END. */
async function playRound(c, round, serve) {
  const from = c.states.length; // this round's states come after the earlier rounds'
  c.send({ type: "TRIAL_READY" });
  await waitFor(() => c.all("TRIAL_START").length >= round && c.states.length > from, 20000);
  const spec = c.last("TRIAL_START").spec;
  if (serve) for (const a of ONE_SOUP) await press(c, a);
  await waitFor(() => c.all("TRIAL_END").length >= round, 30000);
  // The step on which the soup was served (null if none was)
  const servedAt = c.states.slice(from).find((s) => s.delivered >= 1)?.step ?? null;
  return { spec, last: c.states.at(-1), servedAt };
}
const speed = (steps) => 0.5 * (1 - steps / HORIZON);

(async () => {
  // ================= A. Practice in the sweep kitchen =================
  let dir = tmp("a");
  let srv = startServer(dir, {
    PRACTICE: "true", PRACTICE_LAYOUT: "scaling_kitchen", PRACTICE_CONDITION: "p1_c20",
    PRACTICE_HORIZON: "200", PRACTICE_MIN_SOUPS: "1", PRACTICE_TIME_LIMIT_MS: "120000",
  });
  await srv.ready;
  check(srv.out.includes("rounds: p1_c5, p2_c20, p5_c60 (order rotated across groups)"), "startup reports the rounds");
  check(srv.out.includes("rules: round ends after 1 soups; 1 onion(s) per soup; pots placed nearest; collisions on"), "startup reports the rules");
  check(srv.out.includes("solo practice: scaling_kitchen p1_c20"), "startup reports the practice kitchen");
  let p = await client("rd_practice");
  p.send({ type: "PRACTICE_JOIN" });
  await waitFor(() => p.last("PRACTICE_STATUS"));
  const att = await playRound(p, 1, true);
  check(att.spec.layout.name === "scaling_kitchen" && samePots(att.spec, 1) && att.spec.pot_cook_time === 20 &&
    att.spec.order_size === 1 && att.spec.recipe_size === 1, "practice: sweep kitchen, 1 pot, cook 20, order of 1, 1-onion soup");
  check(await waitFor(() => p.last("PRACTICE_STATUS")?.passed === true, 5000), "practice: serving the soup passes");
  check(att.servedAt !== null && att.last.step === att.servedAt && att.last.delivered === 1 && att.servedAt < 200,
    `practice: the attempt ends on the step the soup is served (step ${att.last.step}, served ${att.servedAt})`);
  p.ws.close();
  await srv.stop();
  const practiceEnd = readLog(dir, "_practice_1.jsonl").find((e) => e.event === "trial_end");
  check(practiceEnd?.reason === "order_complete" && practiceEnd.completed === true && practiceEnd.steps === att.servedAt,
    `practice log: trial_end order_complete at the serving step (${JSON.stringify(practiceEnd && { reason: practiceEnd.reason, steps: practiceEnd.steps })})`);
  fs.rmSync(dir, { recursive: true, force: true });

  // ================= B. Group 1: three conditions =================
  dir = tmp("b");
  srv = startServer(dir);
  await srv.ready;
  const a = await client("rd_a");
  a.send({ type: "JOIN_LOBBY" });
  await waitFor(() => a.last("ASSIGN_ROOM"));
  check(a.last("ASSIGN_ROOM")?.roomId === "room_1", "first group → room_1");

  const r1 = await playRound(a, 1, true);
  check(samePots(r1.spec, 1) && r1.spec.pot_cook_time === 5 && r1.spec.num_pots === 1, "round 1: p1_c5 kitchen (1 pot at (1,0), cook 5)");
  check(r1.servedAt !== null && r1.last.step === r1.servedAt && r1.last.delivered === 1,
    `round 1: order served → ends on that step (step ${r1.last.step}, served ${r1.servedAt})`);
  const r2 = await playRound(a, 2, true);
  check(samePots(r2.spec, 2) && r2.spec.pot_cook_time === 20, "round 2: p2_c20 kitchen (pots (1,0), (10,0); cook 20)");
  check(r2.servedAt !== null && r2.last.step === r2.servedAt, `round 2: order served → ends on that step (step ${r2.last.step}, served ${r2.servedAt})`);
  const r3 = await playRound(a, 3, false);
  check(samePots(r3.spec, 5) && r3.spec.pot_cook_time === 60, "round 3: p5_c60 kitchen (5 nearest pots, cook 60)");
  check(r3.last.step === HORIZON && r3.last.delivered === 0, `round 3: nothing served → runs to HORIZON (step ${r3.last.step})`);
  check(r1.spec.spec_hash !== r2.spec.spec_hash && r2.spec.spec_hash !== r3.spec.spec_hash, "each condition has its own spec_hash");

  // Speed bonus: 0.50 x (1 - steps / 250) for each of the 2 completed rounds, nothing for round 3
  const expectedBonus = Math.round((speed(r1.servedAt) + speed(r2.servedAt)) * 100) / 100;
  a.send({ type: "STUDY_COMPLETE" });
  await waitFor(() => a.last("COMPLETION"));
  const done = a.last("COMPLETION");
  check(done.bonus === expectedBonus && done.orders?.completed === 2 && done.orders?.total === 3 && done.soups === 2,
    `COMPLETION: speed bonus ${expectedBonus}, orders 2 of 3, 2 soups (${JSON.stringify({ bonus: done.bonus, orders: done.orders, soups: done.soups })})`);

  // ================= C. Group 2 starts at the second condition =================
  const b = await client("rd_b");
  b.send({ type: "JOIN_LOBBY" });
  await waitFor(() => b.last("ASSIGN_ROOM"));
  b.send({ type: "TRIAL_READY" });
  await waitFor(() => b.last("TRIAL_START"), 20000);
  const b1 = b.last("TRIAL_START")?.spec;
  check(b.last("ASSIGN_ROOM")?.roomId === "room_2" && b1 && samePots(b1, 2) && b1.pot_cook_time === 20,
    "group 2: round 1 is p2_c20 (order rotated)");
  b.ws.close();
  a.ws.close();
  await srv.stop();

  // Logs
  const room1 = readLog(dir, "_room_1.jsonl");
  const created = room1.find((e) => e.event === "room_created");
  check(JSON.stringify(created?.options?.conditions?.map((c) => c.id)) === '["p1_c5","p2_c20","p5_c60"]' &&
    created?.options?.rules?.order_size === 1, "room_1 log: conditions in play order and rules in room_created");
  const starts = room1.filter((e) => e.event === "trial_start");
  check(JSON.stringify(starts.map((e) => e.condition?.id)) === '["p1_c5","p2_c20","p5_c60"]' &&
    starts.every((e) => e.initialState?.step === 0 && e.initialState?.delivered === 0), "room_1 log: trial_start has each round's condition and step-0 state");
  const ends = room1.filter((e) => e.event === "trial_end");
  check(JSON.stringify(ends.map((e) => [e.reason, e.completed, e.steps, e.delivered, e.orderSize, e.limit])) ===
    JSON.stringify([["order_complete", true, r1.servedAt, 1, 1, HORIZON], ["order_complete", true, r2.servedAt, 1, 1, HORIZON], ["horizon", false, HORIZON, 0, 1, HORIZON]]),
    `room_1 log: trial_end reason / completed / steps / delivered / orderSize (${JSON.stringify(ends.map((e) => [e.reason, e.completed, e.steps]))})`);
  const ticks = room1.filter((e) => e.event === "tick" && e.trial === 1);
  check(ticks.at(-1)?.delivered === 1 && ticks.every((t) => typeof t.delivered === "number"), "room_1 log: ticks carry delivered");
  const people = readLog(dir, "_participants.jsonl");
  const completed = people.find((e) => e.event === "study_completed" && e.participantId === "rd_a");
  check(completed?.bonus === expectedBonus && completed.orders?.completed === 2 && completed.trials?.length === 3 &&
    completed.trials.map((t) => t.condition).join() === "p1_c5,p2_c20,p5_c60", "participants log: study_completed has bonus, orders and each round's result");
  const started = people.find((e) => e.event === "server_started");
  check(started?.study?.roundConditions?.length === 3 && started.study.rules?.recipe_size === 1 && started.study.bonus?.speedPerRound === 0.5,
    "participants log: study info has the conditions, rules and bonus");
  const room2 = readLog(dir, "_room_2.jsonl");
  check(JSON.stringify(room2.find((e) => e.event === "room_created")?.options?.conditions?.map((c) => c.id)) === '["p2_c20","p5_c60","p1_c5"]',
    "room_2 log: rotated conditions");
  fs.rmSync(dir, { recursive: true, force: true });

  // ================= D. Settings errors =================
  dir = tmp("d");
  srv = startServer(dir, { ROUNDS: "2" });
  await waitFor(() => srv.exited, 20000);
  check(srv.code === 1 && /ROUNDS=2 but ROUND_CONDITIONS lists 3 rounds/.test(srv.out), "ROUNDS that doesn't match ROUND_CONDITIONS stops the server");
  srv = startServer(dir, { ROUND_CONDITIONS: "p1_c5,p0_c20" });
  await waitFor(() => srv.exited, 20000);
  check(srv.code === 1 && /"p0_c20" should look like p5_c60/.test(srv.out), "a bad condition stops the server");
  srv = startServer(dir, { RECIPE_SIZE: "4" });
  await waitFor(() => srv.exited, 20000);
  check(srv.code === 1 && /RECIPE_SIZE must be 1, 2 or 3/.test(srv.out), "a bad RECIPE_SIZE stops the server");
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
