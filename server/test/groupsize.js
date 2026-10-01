/*
Headless test for minimum group size and early-end payment settings.

Usage (sidecar must be running on :8001), in server/:
  1. STUDY_CONFIG=test/test.env npm run dev
  2. npm run test:groupsize
Expects test/test.env: 3 players/room, MIN_GROUP_SIZE=2, TRIAL_GRACE_MS=3000,
PAY_ABORTED=true with ABORTED_COMPLETION_URL set, PAY_DROPPED=false.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const URL = process.env.BOTS_URL ?? "ws://127.0.0.1:8090";
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../data");
const TRIAL_GRACE_MS = 3000;
const ABORTED_URL = "https://example.test/complete?cc=TEST_ABORTED";
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
    const b = { pid, ws, msgs: [], status: null, policy: null, roomId: null, ends: 0 };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      b.msgs.push(m);
      if (m.type === "SESSION_STATUS") b.status = m;
      if (m.type === "ABORT_POLICY") b.policy = m;
      if (m.type === "ASSIGN_ROOM") b.roomId = m.roomId;
      if (m.type === "TRIAL_END") b.ends++;
    });
    b.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    ws.on("open", () => { b.send({ type: "HELLO", participantId: pid }); resolve(b); });
  });
}

(async () => {
  // Never-seated participants get no abort policy (so they'd never be paid)
  const unseated = await bot(`g_${RUN}_unseated`);
  await waitFor(() => unseated.status);
  await sleep(300);
  check(!unseated.policy, "participant without a seat gets no ABORT_POLICY");
  unseated.ws.close();

  const ids = [0, 1, 2].map((i) => `g_${RUN}_${i}`);
  let bots = await Promise.all(ids.map(bot));
  await waitFor(() => bots.every((b) => b.status));
  for (const b of bots) b.send({ type: "JOIN_LOBBY" });
  await waitFor(() => bots.every((b) => b.policy));
  check(bots.every((b) => b.policy?.paid === true && b.policy.completionUrl === ABORTED_URL),
    "seated participants get ABORT_POLICY (paid, completion URL from study config)");
  const roomId = bots[0].roomId;

  for (const b of bots) b.send({ type: "TRIAL_READY" });
  await waitFor(() => bots[0].ends === 1);
  check(bots[0].ends === 1, "trial 1 played");

  // First drop-out: 2 of 3 remain, MIN_GROUP_SIZE=2 → group continues
  bots[0].ws.close();
  await sleep(TRIAL_GRACE_MS + 800);
  check(!bots[1].status || bots[1].status.status !== "ended", "one drop-out (2 remain ≥ min 2) → group continues");

  // Second drop-out: 1 remains < 2 → study aborted for the last player, paid
  bots[1].ws.close();
  await waitFor(() => bots[2].status?.status === "ended", TRIAL_GRACE_MS + 3000);
  const s = bots[2].status;
  check(s?.status === "ended" && s.outcome === "aborted" && s.paid === true && s.completionUrl === ABORTED_URL,
    `group below minimum → remaining player ended/aborted, paid, sent to completion URL ("${s?.reason}")`);

  // Returning drop-outs: dropped, not paid
  const back0 = await bot(ids[0]);
  const back1 = await bot(ids[1]);
  await waitFor(() => back0.status && back1.status);
  for (const [b, label] of [[back0, "first"], [back1, "second"]]) {
    const st = b.status;
    check(st?.status === "ended" && st.outcome === "dropped" && st.paid === false && st.completionUrl === null,
      `${label} drop-out returns → ended/dropped, not paid`);
  }
  // The aborted player returning: still aborted and paid
  bots[2].ws.close();
  await sleep(300);
  const back2 = await bot(ids[2]);
  await waitFor(() => back2.status);
  check(back2.status?.status === "ended" && back2.status.outcome === "aborted" && back2.status.paid === true,
    "aborted player returns → still ended/aborted, paid");
  for (const b of [back0, back1, back2]) b.ws.close();

  // Data log records the abort
  await sleep(300);
  const file = fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(`_${roomId}.jsonl`))
    .map((f) => path.join(DATA_DIR, f))
    .sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
  const lines = file ? fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const dropped = lines.filter((l) => l.event === "player_dropped").length;
  const aborted = lines.find((l) => l.event === "room_aborted");
  check(dropped === 2 && aborted && /Too many participants/.test(aborted.reason),
    `log: 2 player_dropped + room_aborted ("${aborted?.reason}")`);

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures ? 1 : 0);
})();
