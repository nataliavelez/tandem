/*
Test for the off-server data backup (backup.ts). Starts its own servers
(port 8092, temporary DATA_DIR) and checks what lands in S3-compatible storage.

Usage, in server/ (sidecar running on :8001):
  # any S3-compatible endpoint; e.g. a local emulator:
  #   pip install "moto[server]" && moto_server -p 5055
  BACKUP_TEST_ENDPOINT=http://127.0.0.1:5055 npm run test:backup
Uses bucket BACKUP_TEST_BUCKET (default tandem-backup-test; created if
missing) and a unique folder per run. Not part of test:all (needs a store).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { S3Client, CreateBucketCommand, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const ENDPOINT = process.env.BACKUP_TEST_ENDPOINT ?? "http://127.0.0.1:5055";
const BUCKET = process.env.BACKUP_TEST_BUCKET ?? "tandem-backup-test";
const PORT = 8092;
const RUN = Date.now().toString(36);
const PREFIX = `test-${RUN}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-backup-"));
const INTERVAL_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(200);
  }
  return !!(await cond());
}
let failures = 0;
const check = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) failures++; };

const creds = { AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test", AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test" };
const s3 = new S3Client({
  region: "us-east-1", endpoint: ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: creds.AWS_ACCESS_KEY_ID, secretAccessKey: creds.AWS_SECRET_ACCESS_KEY },
});

async function remote(name) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}/${name}` }));
    return await r.Body.transformToString();
  } catch { return null; }
}
async function remoteNames() {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/` }));
  return (r.Contents ?? []).map((o) => o.Key.slice(PREFIX.length + 1));
}
const local = (name) => fs.readFileSync(path.join(DATA_DIR, name), "utf8");
const localNames = (suffix) => fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(suffix)).sort();

function startServer(extraEnv = {}) {
  const env = {
    ...process.env, ...creds,
    STUDY_CONFIG: "test/test.env", PORT: String(PORT), DATA_DIR,
    BACKUP_S3_BUCKET: BUCKET, BACKUP_S3_ENDPOINT: ENDPOINT, BACKUP_S3_PATH_STYLE: "true",
    BACKUP_PREFIX: PREFIX, BACKUP_INTERVAL_MS: String(INTERVAL_MS),
    ...extraEnv,
  };
  const proc = spawn("node", ["-r", "ts-node/register/transpile-only", "src/index.ts"],
    { cwd: path.resolve(__dirname, ".."), env });
  const srv = { proc, out: "", exited: false };
  proc.stdout.on("data", (d) => { srv.out += d; });
  proc.stderr.on("data", (d) => { srv.out += d; });
  proc.on("exit", () => { srv.exited = true; });
  srv.ready = waitFor(() => srv.out.includes("WS orchestrator listening"), 20000);
  srv.stop = async () => { proc.kill("SIGTERM"); return waitFor(() => srv.exited, 15000); };
  return srv;
}

function bot(pid) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const b = { ws, ends: 0, roomId: null };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "ASSIGN_ROOM") b.roomId = m.roomId;
      if (m.type === "TRIAL_END") b.ends++;
    });
    b.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
    ws.on("open", () => { b.send({ type: "HELLO", participantId: pid }); resolve(b); });
  });
}

(async () => {
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET })).catch(() => {});

  // A log left behind by an earlier run that never got uploaded
  const leftover = "2000-01-01T00-00-00-000Z_room_1.jsonl";
  fs.writeFileSync(path.join(DATA_DIR, leftover), '{"t":0,"event":"room_created"}\n');

  // ---- Run 1 ----
  const srv = startServer();
  check(await srv.ready, "server started with backup on");
  check(await waitFor(async () => (await remote(leftover)) === local(leftover), 5000),
    "leftover log from an earlier run uploaded at startup");
  const people = localNames("_participants.jsonl")[0];
  check(await waitFor(async () => (await remote(people))?.includes("server_started"), 5000),
    "participants log uploaded at startup");

  // Play one trial, then everyone leaves → room closes → its log uploads at once
  const ids = [0, 1, 2].map((i) => `bk_${RUN}_${i}`);
  const bots = await Promise.all(ids.map(bot));
  for (const b of bots) b.send({ type: "JOIN_LOBBY" });
  await waitFor(() => bots.every((b) => b.roomId));
  for (const b of bots) b.send({ type: "TRIAL_READY" });
  check(await waitFor(() => bots.every((b) => b.ends === 1), 20000), "trial played");
  const roomFile = localNames(`_${bots[0].roomId}.jsonl`).find((f) => f !== leftover);

  // Periodic pass picks up the still-open participants log
  check(await waitFor(async () => (await remote(people))?.includes(ids[2]), INTERVAL_MS * 3),
    "open participants log re-uploaded by the periodic pass (has the new hellos)");

  for (const b of bots) b.ws.close();
  const disposedAt = await waitFor(() => local(roomFile).includes("room_disposed"), 15000);
  const t0 = Date.now();
  check(disposedAt && await waitFor(async () => (await remote(roomFile)) === local(roomFile), 3000),
    `closed room log uploaded complete right after the room closed (${Date.now() - t0} ms)`);
  check(/\[backup\] uploaded .*_room_/.test(srv.out), "server logged the upload");

  check(await srv.stop(), "server stopped on SIGTERM");
  check((await remote(people)) === local(people) && local(people).includes("server_stopped"),
    "final upload on shutdown: remote participants log identical, ends with server_stopped");
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, ".backup-manifest.json"), "utf8"));
  check([leftover, people, roomFile].every((f) => manifest[f]), "manifest records the uploaded files");

  // ---- Run 2: restart with the same data folder ----
  const srv2 = startServer();
  await srv2.ready;
  await waitFor(() => srv2.out.includes("[backup] uploaded"), 5000);
  await sleep(500);
  const uploadedLines = srv2.out.split("\n").filter((l) => l.includes("[backup] uploaded"));
  check(uploadedLines.length === 1 && uploadedLines[0].includes("uploaded 1 changed file(s)"),
    `restart uploads only the new run's participants log (${uploadedLines.join(" | ")})`);
  await srv2.stop();
  const names = await remoteNames();
  check(names.filter((n) => n.endsWith("_participants.jsonl")).length === 2 && names.includes(roomFile) && names.includes(leftover),
    `bucket has both runs' files (${names.length} objects)`);

  // ---- Run 3: store unreachable → the study keeps running ----
  const srv3 = startServer({ BACKUP_S3_ENDPOINT: "http://127.0.0.1:1", PORT: String(PORT) });
  check(await srv3.ready, "server starts even when the store is unreachable");
  check(await waitFor(() => srv3.out.includes("failed (") && srv3.out.includes("will retry"), 10000),
    "upload failure logged with a retry");
  const b = await bot(`bk_${RUN}_x`);
  b.send({ type: "JOIN_LOBBY" });
  check(await waitFor(() => b.roomId, 5000), "players are still seated while backup is failing");
  b.ws.close();
  await srv3.stop();
  check(srv3.out.includes("final upload did not finish") || srv3.out.includes("failed ("),
    "shutdown with an unreachable store still exits");

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
