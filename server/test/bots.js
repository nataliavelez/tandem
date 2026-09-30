/*
Headless bot integration test for the multiplayer backend.

Connects 7 bots (+1 late joiner) and checks room assignment, room isolation,
room locking, anti-spoofing, tick cadence, multi-round resets, episode ids,
and disconnect handling.

Usage (sidecar must be running on :8001):
  1. PORT=8090 REQUIRED_PLAYERS=3 HORIZON=30 npm run dev     (in server/)
  2. npm run test:bots                                        (in server/)
Override the server address with BOTS_URL=ws://host:port.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/
const WebSocket = require("ws");
const URL = process.env.BOTS_URL ?? "ws://127.0.0.1:8090";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wait for a condition instead of a fixed sleep (env creation can take seconds on a cold sidecar)
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!cond() && Date.now() < end) await sleep(50);
  return cond();
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

function bot(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const b = { name, ws, msgs: [], roomId: null, agentId: null, states: [], ends: [], starts: [] };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      b.msgs.push(m);
      if (m.type === "ASSIGN_ROOM") b.roomId = m.roomId;
      if (m.type === "ASSIGN_AGENT") b.agentId = m.agentId;
      if (m.type === "TRIAL_START") b.starts.push(m);
      if (m.type === "TRIAL_END") b.ends.push(m);
      if (m.type === "STATE_UPDATE" && m.state.phase === "running") b.states.push({ ...m, recv: Date.now() });
    });
    b.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    ws.on("open", () => resolve(b));
  });
}

async function holdAction(b, action, agentId, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { b.send({ type: "PLAYER_ACTION", agentId, action }); await sleep(50); }
}

(async () => {
  // 1. Room assignment: 7 players, 3/room
  const bots = [];
  for (let i = 0; i < 7; i++) { const b = await bot(`p${i}`); b.send({ type: "JOIN_LOBBY" }); bots.push(b); }
  await sleep(500);
  const byRoom = {};
  for (const b of bots) (byRoom[b.roomId] ??= []).push(b);
  // Rename rooms by creation order so the test works on a long-running server
  const order = Object.keys(byRoom).sort((x, y) => Number(x.split("_")[1]) - Number(y.split("_")[1]));
  const alias = Object.fromEntries(order.map((r, i) => [r, `room_${i + 1}`]));
  for (const k of order) { const v = byRoom[k]; delete byRoom[k]; byRoom[alias[k]] = v; }
  console.log("rooms:", Object.fromEntries(Object.entries(byRoom).map(([r, bs]) => [r, bs.map((b) => b.agentId)])));
  check(Object.keys(byRoom).length === 3, "7 players split into 3 rooms");
  check(byRoom.room_1?.length === 3 && byRoom.room_2?.length === 3 && byRoom.room_3?.length === 1, "rooms filled 3/3/1");
  for (const [r, bs] of Object.entries(byRoom)) {
    const ids = bs.map((b) => b.agentId);
    check(new Set(ids).size === ids.length && ids.every(Boolean), `${r}: unique, non-null agent ids`);
  }
  const lobbyMsgs = bots[0].msgs.filter((m) => m.type === "STATE_UPDATE" && m.state.phase === "lobby");
  check(lobbyMsgs.every((m) => alias[m.state.roomId] === "room_1"), "room_1 player only sees room_1 lobby updates");

  // 2. Start room_1 only (all 3 ready); room_2 stays in lobby
  const [a0, a1, a2] = byRoom.room_1.sort((x, y) => x.agentId.localeCompare(y.agentId));
  for (const b of byRoom.room_1) b.send({ type: "TRIAL_READY" });
  await waitFor(() => a0.starts.length === 1);
  check(a0.starts.length === 1, "room_1 trial started when all 3 ready");
  check(byRoom.room_2.every((b) => b.starts.length === 0), "room_2 not started (not ready)");

  // 3. Late joiner does not enter the running room
  const late = await bot("late"); late.send({ type: "JOIN_LOBBY" }); await sleep(200);
  check(alias[late.roomId] === "room_3", `late joiner placed in open room (${late.roomId}), not running room_1`);

  // 4. Spoofing: a0 claims agent_1 and holds "right" (2); a1/a2 send noop
  const spoof = holdAction(a0, 2, a1.agentId, 1200);
  const n1 = holdAction(a1, 0, a1.agentId, 1200);
  const n2 = holdAction(a2, 0, a2.agentId, 1200);
  await Promise.all([spoof, n1, n2]);
  const last = a0.states.at(-1).state.agents;
  console.log("vel agent_0", last.agent_0.vel, "agent_1", last.agent_1.vel);
  check(Math.abs(last.agent_0.vel[0]) > 0.05, "spoofer's action applied to its OWN agent (agent_0 moving)");
  check(Math.abs(last.agent_1.vel[0]) < 1e-6 && Math.abs(last.agent_1.vel[1]) < 1e-6, "spoofed agent_1 did not move");
  check(byRoom.room_2.every((b) => b.states.length === 0), "room_2 received no room_1 game states");

  // 5. Wait for trial end (30 steps); then check cadence/order and episode ids
  await waitFor(() => a0.ends.length === 1);
  check(a0.ends.length === 1, `room_1 trial ended (${a0.ends[0]?.trialId})`);
  const steps = a0.states.map((s) => s.tick);
  check(steps.every((s, i) => i === 0 || s === steps[i - 1] + 1), `steps strictly sequential 1..${steps.at(-1)}`);
  const gaps = a0.states.slice(1).map((s, i) => s.recv - a0.states[i].recv);
  const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
  console.log(`tick gap mean ${mean.toFixed(1)}ms, max ${Math.max(...gaps)}ms`);
  check(mean > 85 && mean < 130, "tick cadence ~100ms");

  // 6. Second round starts fresh at step 1 with new episode id and runs full length
  const before = a0.states.length;
  for (const b of byRoom.room_1) b.send({ type: "TRIAL_READY" });
  await waitFor(() => a0.ends.length === 2);
  const r2 = a0.states.slice(before);
  check(a0.starts.length === 2, "second round started");
  check(r2[0]?.tick === 1 && r2.at(-1)?.tick === 30, `round 2 ran steps ${r2[0]?.tick}..${r2.at(-1)?.tick}`);
  check(a0.ends.length === 2 && a0.ends[1].trialId !== a0.ends[0].trialId, `distinct episode ids (${a0.ends.map((e) => e.trialId)})`);

  // 7. Disconnect mid-trial: start room_2, one player holds right then disconnects
  const [b0, b1, b2] = byRoom.room_2.sort((x, y) => x.agentId.localeCompare(y.agentId));
  for (const b of byRoom.room_2) b.send({ type: "TRIAL_READY" });
  await waitFor(() => b0.starts.length === 1);
  await holdAction(b0, 2, b0.agentId, 800);
  const vAtClose = Math.hypot(...b1.states.at(-1).state.agents[b0.agentId].vel);
  b0.ws.close();
  await sleep(1500);
  const v = b1.states.at(-1).state.agents[b0.agentId].vel;
  console.log("disconnected agent vel after 1.5s:", v);
  console.log(`speed at disconnect ${vAtClose.toFixed(3)} → ${Math.hypot(...v).toFixed(3)}`);
  check(vAtClose > 1 && Math.hypot(...v) < 0.05 * vAtClose, "disconnected player's agent decays to rest (noop), not stuck on last key");
  const startIdx = b1.msgs.findIndex((m) => m.type === "TRIAL_START");
  const endIdx = b1.msgs.findIndex((m) => m.type === "TRIAL_END");
  const midTrial = b1.msgs.slice(startIdx, endIdx === -1 ? undefined : endIdx);
  check(endIdx === -1, "room_2 trial still running when checked");
  check(!midTrial.some((m) => m.type === "STATE_UPDATE" && m.state.phase === "lobby"),
    "no lobby-state broadcast overwrote game state mid-trial (after disconnect)");

  // 8. Empty rooms disposed
  for (const b of [...bots, late]) b.ws.close();
  await sleep(500);
  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures ? 1 : 0);
})();
