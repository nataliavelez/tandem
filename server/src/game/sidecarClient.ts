const BASE = process.env.SIDECAR_URL ?? "http://127.0.0.1:8001";

/**
 * Every call has a timeout, so a hung sidecar becomes an error (a step that
 * never returned would otherwise freeze its room's tick loop for good).
 * Create can compile a new game config (seconds on a slow machine); a step
 * normally takes a few ms, so 2 s only catches a sidecar that is stuck.
 */
const CREATE_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = Number(process.env.SIDECAR_STEP_TIMEOUT_MS ?? 2_000);
const CALL_TIMEOUT_MS = 10_000;

/** The sidecar answered with an error. status 4xx = it rejected the request (e.g. a bad layout). */
export class SidecarError extends Error {
  constructor(readonly status: number, text: string) { super(`${status} ${text}`); }
}
const j = (r: Response) => (r.ok ? r.json() : r.text().then(t => { throw new SidecarError(r.status, t); }));

async function post(path: string, body: unknown, timeoutMs = CALL_TIMEOUT_MS) {
  return j(await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }));
}

export async function envCreate(params:
  | { task: "simple_spread"; seed: number; num_agents: number; num_landmarks: number;
      local_ratio?: number; episode_horizon?: number; action_type?: "DISCRETE_ACT" }
  | { task: "overcooked"; seed: number; num_agents: number; episode_horizon?: number; layout: string }
) { return post("/env/create", params, CREATE_TIMEOUT_MS); }

export async function envSpec(env_id: string) {
  return post("/env/spec", { env_id });
}

export async function envReset(env_id: string) {
  return post("/env/reset", { env_id });
}

export async function envStep(env_id: string, actions: Record<string, number>) {
  return post("/env/step", { env_id, actions }, STEP_TIMEOUT_MS);
}

/** Sidecar status for the admin view: { ok, envs, compiled_configs }. */
export async function sidecarHealth(timeoutMs = 1500) {
  return j(await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(timeoutMs) }));
}

export async function envClose(env_id: string) {
  return post("/env/close", { env_id });
}
