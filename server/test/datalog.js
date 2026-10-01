/*
Headless test for the data logs: study info, seeds, each episode's starting
state, isHuman, and browser-side CLIENT_LOG entries (ack, dedupe, validation).

Usage (sidecar must be running on :8001), in server/:
  1. STUDY_CONFIG=test/test.env npm run dev
  2. npm run test:datalog
Expects test/test.env: 3 players/room, HORIZON=30, SEED=123,
STUDY_NAME=headless-tests, CONDITION=test.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const URL = process.env.BOTS_URL ?? "ws://127.0.0.1:8090";
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../data");
const RUN = Date.now().toString(36);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!cond() && Date.now() < end) await sleep(50);
  return cond();
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

function bot(pid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const b = { pid, ws, status: null, roomId: null, acks: [], errors: [], starts: 0, ends: 0 };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "SESSION_STATUS") b.status = m;
      if (m.type === "ASSIGN_ROOM") b.roomId = m.roomId;
      if (m.type === "LOG_ACK") b.acks.push(m.id);
      if (m.type === "ERROR") b.errors.push(m.message);
      if (m.type === "TRIAL_START") b.starts++;
      if (m.type === "TRIAL_END") b.ends++;
    });
    b.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    b.log = (id, event, data) => b.send({ type: "CLIENT_LOG", id, event, clientTime: Date.now(), data });
    ws.on("open", () => { b.send({ type: "HELLO", participantId: pid }); resolve(b); });
  });
}

/** Lines of the newest log file whose name ends with `suffix`. */
function readLog(suffix) {
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(suffix))
    .map((f) => path.join(DATA_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return [];
  return fs.readFileSync(files[0], "utf8").trim().split("\n").map((l) => JSON.parse(l));
}

(async () => {
  const ids = [0, 1, 2].map((i) => `d_${RUN}_${i}`);
  const bots = await Promise.all(ids.map(bot));
  await waitFor(() => bots.every((b) => b.status));
  const [b0] = bots;

  // ---- CLIENT_LOG before having a seat (e.g. consent) ----
  b0.log("c1", "consent", { agreed: true });
  b0.log("c1", "consent", { agreed: true }); // resend after a "lost" ack
  b0.log("bad id!", "consent", {});
  b0.log("c2", "bad event name", {});
  b0.log("c3", "survey", { text: "x".repeat(40_000) });
  await waitFor(() => b0.acks.length >= 2 && b0.errors.length >= 3, 3000);
  check(b0.acks.filter((a) => a === "c1").length === 2, "CLIENT_LOG acked (and acked again on resend)");
  check(b0.errors.length === 3 && !b0.acks.includes("c3"), "bad id, bad event name and oversized data rejected");

  // ---- Seated: two trials ----
  for (const b of bots) b.send({ type: "JOIN_LOBBY" });
  await waitFor(() => bots.every((b) => b.roomId));
  const roomId = b0.roomId;
  check(bots.every((b) => b.roomId === roomId), `all 3 bots in ${roomId}`);
  b0.log("s1", "screen_enter", { screenId: "gridworld-1" });

  for (const trial of [1, 2]) {
    for (const b of bots) b.send({ type: "TRIAL_READY" });
    await waitFor(() => bots.every((b) => b.ends >= trial), 20000);
  }
  check(bots.every((b) => b.ends === 2), "two trials completed");
  await waitFor(() => b0.acks.includes("s1"), 2000);

  // ---- Room log ----
  const room = readLog(`_${roomId}.jsonl`);
  const created = room.find((e) => e.event === "room_created");
  check(created?.study?.studyName === "headless-tests" && created?.study?.condition === "test",
    "room_created records study name and condition");
  check(typeof created?.study?.code?.commit === "string" && created.study.code.commit.length === 40,
    `room_created records the git commit (${created?.study?.code?.commit?.slice(0, 8)}, dirty=${created?.study?.code?.dirty})`);
  check(created?.options?.seed === 123, "room seed is SEED (same for every room by default)");

  const starts = room.filter((e) => e.event === "trial_start");
  check(starts.length === 2, "two trial_start lines");
  check(starts.every((s) => s.spec.seed === 123), `spec.seed is the real seed (got ${starts.map((s) => s.spec.seed)})`);
  check(!!starts[0]?.spec?.versions?.jax && !!starts[0]?.spec?.versions?.jaxmarl, "spec records jax/jaxmarl versions");
  check(starts.every((s) => s.initialState?.step === 0), "each trial_start has the step-0 initialState");
  check(starts[0]?.initialState?.episodeId === "e_0001" && starts[1]?.initialState?.episodeId === "e_0002",
    "initialState matches each episode (e_0001, e_0002)");
  check(starts.every((s) => Object.keys(s.initialState?.agents ?? {}).length === 3 && s.initialState.landmarks.length === 3),
    "initialState has all agents and landmarks");
  check(JSON.stringify(starts[0]?.initialState?.agents) !== JSON.stringify(starts[1]?.initialState?.agents),
    "the two episodes start from different states");

  const ticks = room.filter((e) => e.event === "tick");
  const firstTicks = ticks.filter((t) => t.step === 1);
  check(firstTicks.length === 2 && firstTicks.every((t, i) => t.episodeId === starts[i].initialState.episodeId),
    "first tick of each episode follows its initialState");
  check(ticks.length > 0 && ticks.every((t) => Object.values(t.agents).every((a) => a.isHuman === true)),
    "isHuman true for every seated agent");

  // ---- Participants log ----
  const people = readLog("_participants.jsonl");
  const mine = people.filter((e) => ids.includes(e.participantId));
  const events = mine.filter((e) => e.event === "client_event");
  check(people.some((e) => e.event === "server_started" && e.study?.studyName === "headless-tests"),
    "participants log starts with server_started + study info");
  check(ids.every((id) => mine.some((e) => e.event === "participant_hello" && e.participantId === id)),
    "participant_hello logged for each bot");
  const consent = events.filter((e) => e.name === "consent");
  check(consent.length === 1 && consent[0].data.agreed === true && consent[0].room === null,
    "consent logged once (resend deduped), with no room yet");
  const seated = events.find((e) => e.name === "screen_enter");
  check(seated?.room === roomId && seated?.agentId === "agent_0" && seated?.data?.screenId === "gridworld-1",
    "event sent while seated records room and agent");
  check(!events.some((e) => ["c2", "c3", "bad id!"].includes(e.logId)), "rejected entries not written");

  for (const b of bots) b.ws.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
