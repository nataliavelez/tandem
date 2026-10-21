{/*
Off-server backup of the data logs to S3-compatible storage (DigitalOcean
Spaces, AWS S3, Backblaze B2, Wasabi, MinIO, ...).

When files are uploaded:
  - a log as soon as it is closed (room disposed, server stopping)
  - every BACKUP_INTERVAL_MS (default 5 min): every .jsonl in DATA_DIR that
    changed since its last upload. This covers logs still being written (a
    crash loses at most one interval) and files from earlier runs that never
    finished uploading.
  - on shutdown: a final pass (flush)

Whole files are uploaded each time (logs are a few MB at most), to
<bucket>/<BACKUP_PREFIX>/<file name>; file names start with the server run's
start time, so nothing collides. Turn on versioning in the bucket to keep
earlier copies. Each upload carries its MD5, so the store rejects a corrupted
upload. What was uploaded (size + modified time per file) is kept in
DATA_DIR/.backup-manifest.json, so a restart doesn't upload everything again.
Failures are logged and retried on the next pass; they never affect a session.

Settings (see studies/example.env):
  BACKUP_S3_BUCKET     bucket name; unset = backup off (startup warns)
  BACKUP_S3_ENDPOINT   e.g. https://nyc3.digitaloceanspaces.com; unset = AWS
  BACKUP_S3_REGION     default us-east-1
  BACKUP_PREFIX        folder in the bucket; default STUDY_NAME, else "tandem"
  BACKUP_INTERVAL_MS   default 300000 (5 min)
  BACKUP_S3_PATH_STYLE true for stores that need path-style URLs (MinIO, moto)
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  the store's access key pair

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DATA_DIR, onLogClosed } from "./game/dataLog";

const BUCKET = process.env.BACKUP_S3_BUCKET?.trim() || null;
const INTERVAL_MS = Number(process.env.BACKUP_INTERVAL_MS ?? 300_000);
const PREFIX = (process.env.BACKUP_PREFIX?.trim() || process.env.STUDY_NAME?.trim() || "tandem")
  .replace(/^\/+|\/+$/g, "");
const MANIFEST = path.join(DATA_DIR, ".backup-manifest.json");

type Stamp = { size: number; mtimeMs: number };

class Backup {
  private client: S3Client | null = null;
  /** file name → what was last uploaded */
  private uploaded: Record<string, Stamp> = {};
  /** Per-file chain, so uploads of the same file never overlap */
  private chains = new Map<string, Promise<boolean>>();
  private timer: NodeJS.Timeout | null = null;
  private failuresInARow = 0;
  private lastSuccessAt: number | null = null;
  private lastFailure: { at: number; file: string; error: string } | null = null;

  get enabled() { return this.client !== null; }

  /** For the admin view. */
  status() {
    return {
      enabled: this.enabled,
      target: this.enabled ? `${BUCKET}/${PREFIX}/` : null,
      intervalMs: INTERVAL_MS,
      lastSuccessAt: this.lastSuccessAt,
      lastFailure: this.lastFailure,
      failuresInARow: this.failuresInARow,
      filesUploaded: Object.keys(this.uploaded).length,
    };
  }

  start() {
    if (!BUCKET) {
      console.warn("[backup] BACKUP_S3_BUCKET not set: data is saved only on this machine (" + DATA_DIR + ").");
      return;
    }
    this.client = new S3Client({
      region: process.env.BACKUP_S3_REGION?.trim() || "us-east-1",
      endpoint: process.env.BACKUP_S3_ENDPOINT?.trim() || undefined,
      forcePathStyle: ["1", "true", "yes"].includes((process.env.BACKUP_S3_PATH_STYLE ?? "").toLowerCase()),
      // Newer SDK checksums aren't supported by every S3-compatible store; we send Content-MD5 instead
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    this.uploaded = loadManifest();
    onLogClosed((file) => void this.upload(file).then((ok) => ok && console.log(`[backup] uploaded ${path.basename(file)}`)));
    this.timer = setInterval(() => void this.syncAll(), INTERVAL_MS);
    this.timer.unref();
    console.log(`[backup] to ${BUCKET}/${PREFIX}/ every ${Math.round(INTERVAL_MS / 1000)}s and when each log closes`);
    void this.syncAll(); // anything left over from earlier runs
  }

  /** Upload every log in DATA_DIR that changed since its last upload. */
  async syncAll(): Promise<void> {
    if (!this.client) return;
    let names: string[];
    try {
      names = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return;
    }
    const results = await Promise.all(names.map((n) => this.upload(path.join(DATA_DIR, n))));
    const n = results.filter(Boolean).length;
    if (n) console.log(`[backup] uploaded ${n} changed file(s)`);
  }

  /** Server stopping: stop the timer and upload whatever changed, within timeoutMs. */
  async flush(timeoutMs: number): Promise<void> {
    if (!this.client) return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const done = await Promise.race([
      this.syncAll().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs).unref()),
    ]);
    if (!done) console.error(`[backup] final upload did not finish within ${timeoutMs}ms; the next start will retry`);
  }

  /** Upload one file if it changed. Resolves true if it was uploaded now. */
  upload(file: string): Promise<boolean> {
    if (!this.client) return Promise.resolve(false);
    const prev = this.chains.get(file) ?? Promise.resolve(false);
    const next = prev.then(() => this.uploadIfChanged(file));
    this.chains.set(file, next);
    void next.finally(() => { if (this.chains.get(file) === next) this.chains.delete(file); });
    return next;
  }

  private async uploadIfChanged(file: string): Promise<boolean> {
    const name = path.basename(file);
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { return false; }
    const last = this.uploaded[name];
    if (last && last.size === st.size && last.mtimeMs === st.mtimeMs) return false;

    // Snapshot; a line appended after this read changes size/mtime, so the next pass re-uploads
    const body = fs.readFileSync(file);
    try {
      await this.client!.send(new PutObjectCommand({
        Bucket: BUCKET!,
        Key: `${PREFIX}/${name}`,
        Body: body,
        ContentType: "application/x-ndjson",
        ContentMD5: crypto.createHash("md5").update(body).digest("base64"),
      }));
    } catch (e: any) {
      this.failuresInARow++;
      this.lastFailure = { at: Date.now(), file: name, error: `${e?.name ?? ""} ${e?.message ?? e}`.trim() };
      console.error(`[backup] upload of ${name} failed (${this.failuresInARow} in a row); will retry:`, e?.name ?? "", e?.message ?? e);
      return false;
    }
    this.failuresInARow = 0;
    this.lastSuccessAt = Date.now();
    this.uploaded[name] = { size: body.length, mtimeMs: st.mtimeMs };
    saveManifest(this.uploaded);
    return true;
  }
}

function loadManifest(): Record<string, Stamp> {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return {};
  }
}

function saveManifest(m: Record<string, Stamp>) {
  try {
    // Write-then-rename, so a crash mid-write can't leave a broken manifest
    fs.writeFileSync(MANIFEST + ".tmp", JSON.stringify(m));
    fs.renameSync(MANIFEST + ".tmp", MANIFEST);
  } catch (e) {
    console.error("[backup] could not save manifest:", e);
  }
}

export const backup = new Backup();
