/*
Finishing the study: ROUNDS, finished participants and the completion link.
Starts its own server (port 8097, temporary DATA_DIR; GAME=overcooked, 3 per
room, ROUNDS=2, short rounds), so it needs only the sidecar.

Checks: no completion URL before finishing (or for someone who never played);
after the last round no further round starts; finished participants get
COMPLETION_URL, logged once; a finisher leaving does not drop them or abort the
rest of the group; a player whose seat was held when the last round ended
counts as finished; returning finishers get SESSION_STATUS finished (and can't
rejoin a lobby); shutdown leaves finished participants alone; admin stages.

Usage, in server/ (sidecar running; SIDECAR_URL overrides :8001):
  npm run test:completion

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 8097;
const URL = `ws://127.0.0.1:${PORT}`;
const DONE_URL = "https://example.test/complete?cc=TEST_DONE";
const TOKEN = "completion-test-token";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-completion-"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await cond()) return true; await sleep(50); }
  return !!(await cond());
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

function startServer() {
  const env = {
    ...process.env,
    STUDY_CONFIG: "test/test.env", PORT: String(PORT), DATA_DIR,
    GAME: "overcooked", REQUIRED_PLAYERS: "3", MIN_GROUP_SIZE: "3", ROUNDS: "2",
    HORIZON: "20", TICK_MS: "100", TRIAL_GRACE_MS: "3000",
    COMPLETION_URL: DONE_URL, ADMIN_TOKEN: TOKEN,
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
    const ws = new WebSocket(URL);
    const c = { pid, ws, msgs: [], starts: 0, ends: 0 };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      c.msgs.push(m);
      if (m.type === "TRIAL_START") c.starts++;
      if (m.type === "TRIAL_END") c.ends++;
    });
    c.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    c.last = (type) => c.msgs.filter((m) => m.type === type).at(-1);
    c.statuses = () => c.msgs.filter((m) => m.type === "SESSION_STATUS");
    ws.on("open", () => { c.send({ type: "HELLO", participantId: pid }); resolve(c); });
  });
}

/** Send STUDY_COMPLETE and wait for the COMPLETION reply. */
async function complete(c) {
  const n = c.msgs.filter((m) => m.type === "COMPLETION").length;
  c.send({ type: "STUDY_COMPLETE" });
  await waitFor(() => c.msgs.filter((m) => m.type === "COMPLETION").length > n, 3000);
  return c.last("COMPLETION");
}

const readLog = (suffix) => {
  const f = fs.readdirSync(DATA_DIR).find((n) => n.endsWith(suffix));
  return fs.readFileSync(path.join(DATA_DIR, f), "utf8").trim().split("\n").map(JSON.parse);
};
const adminState = async () => (await fetch(`http://127.0.0.1:${PORT}/admin/state`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();

(async () => {
  const srv = startServer();
  await srv.ready;
  check(srv.out.includes("2 round(s)"), "startup reports the number of rounds");

  const [c0, c1, c2] = await Promise.all(["fin_p0", "fin_p1", "fin_p2"].map(client));
  const outsider = await client("fin_outsider");
  await sleep(200);

  // 1. No URL for someone who never played, or before finishing
  check((await complete(outsider)).completionUrl === null, "never played → no completion URL");
  for (const c of [c0, c1, c2]) c.send({ type: "JOIN_LOBBY" });
  await sleep(300);
  check((await complete(c0)).completionUrl === null, "seated but not finished → no completion URL");

  // 2. Round 1
  for (const c of [c0, c1, c2]) c.send({ type: "TRIAL_READY" });
  check(await waitFor(() => [c0, c1, c2].every((c) => c.ends === 1), 15000), "round 1 played");

  // 3. Round 2; c2 disconnects mid-round (seat still held when the round ends)
  for (const c of [c0, c1, c2]) c.send({ type: "TRIAL_READY" });
  await waitFor(() => c2.starts === 2, 10000);
  await sleep(300);
  c2.ws.close();
  check(await waitFor(() => c0.ends === 2 && c1.ends === 2, 15000), "round 2 played");

  // 4. No third round
  c0.send({ type: "TRIAL_READY" }); c1.send({ type: "TRIAL_READY" });
  await sleep(1500);
  check(c0.starts === 2, "no round after the last one (ROUNDS=2)");

  // 5. Completion URL for finishers, logged once
  check((await complete(c0)).completionUrl === DONE_URL, "finished → COMPLETION_URL");
  check((await complete(c0)).completionUrl === DONE_URL, "asking again → same URL");

  // 6. A finisher leaves: not dropped, and the rest of the group is not aborted
  c0.ws.close();
  await sleep(3800); // longer than TRIAL_GRACE_MS
  check(!c1.statuses().some((s) => s.status === "ended"), "others not aborted after a finisher left (MIN_GROUP_SIZE=3)");
  check((await complete(c1)).completionUrl === DONE_URL, "remaining finisher still gets the URL");

  // 7. Returning finishers: SESSION_STATUS finished (not ended/dropped), URL, can't rejoin
  const c0b = await client("fin_p0");
  await waitFor(() => c0b.statuses().length > 0, 3000);
  const st0 = c0b.statuses()[0];
  check(st0?.status === "finished" && st0.roundsCompleted === 2, `returning finisher → finished, 2 rounds (${JSON.stringify(st0)})`);
  check((await complete(c0b)).completionUrl === DONE_URL, "returning finisher gets the URL");
  c0b.send({ type: "JOIN_LOBBY" });
  await waitFor(() => c0b.last("ERROR"), 2000);
  check(/already finished/.test(c0b.last("ERROR")?.message ?? "") && !c0b.last("ASSIGN_ROOM"), "finisher can't join a new lobby");

  const c2b = await client("fin_p2");
  await waitFor(() => c2b.statuses().length > 0, 3000);
  check(c2b.statuses()[0]?.status === "finished", "player whose seat was held at the end counts as finished");
  check((await complete(c2b)).completionUrl === DONE_URL, "…and gets the URL");

  // 8. Admin stages
  const a = await adminState();
  const stage = (pid) => a.participants.find((p) => p.participantId === pid)?.stage;
  check(stage("fin_p0") === "completed" && stage("fin_p2") === "completed" && stage("fin_outsider") === "before lobby",
    `admin stages: completed / before lobby (${stage("fin_p0")}, ${stage("fin_p2")}, ${stage("fin_outsider")})`);
  check(!JSON.stringify(a).includes(DONE_URL), "admin state has no completion URL");

  // 9. Shutdown: finished participants get no early ending; never-seated ones do (unpaid)
  await srv.stop();
  await sleep(200);
  check(!c1.statuses().some((s) => s.status === "ended") && !c0b.statuses().some((s) => s.status === "ended"),
    "shutdown: no early ending sent to finished participants");
  const outEnd = outsider.statuses().find((s) => s.status === "ended");
  check(outEnd && outEnd.paid === false, "shutdown: never-seated participant ended, not paid");

  // 10. Logs
  const room = readLog("_room_1.jsonl");
  const events = room.map((e) => e.event);
  check(events.includes("room_finished") && room.find((e) => e.event === "room_finished").rounds === 2, "room log: room_finished after 2 rounds");
  check(events.filter((e) => e === "trial_start").length === 2, "room log: exactly 2 trials");
  check(!events.includes("room_aborted") && !events.includes("player_dropped"), "room log: no abort, no drop");
  check(Object.keys(room.find((e) => e.event === "room_finished").players).sort().join() === "fin_p0,fin_p1,fin_p2",
    "room log: room_finished lists all three (incl. the one whose seat was held)");
  // player_finished is written when a finisher's seat is freed; fin_p1 was still connected at shutdown
  check(room.filter((e) => e.event === "player_finished").map((e) => e.participantId).sort().join() === "fin_p0,fin_p2",
    "room log: player_finished for the two who left");
  const people = readLog("_participants.jsonl");
  const completed = people.filter((e) => e.event === "study_completed");
  check(completed.length === 3 && completed.filter((e) => e.participantId === "fin_p0").length === 1,
    "participants log: study_completed once per finisher (3)");
  check(people.filter((e) => e.event === "completion_refused").length === 2, "participants log: 2 refused requests (outsider, before finishing)");

  for (const c of [c1, c0b, c2b, outsider]) c.ws.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
