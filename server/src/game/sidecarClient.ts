const BASE = process.env.SIDECAR_URL ?? "http://127.0.0.1:8001";
const j = (r: Response) => (r.ok ? r.json() : r.text().then(t => { throw new Error(`${r.status} ${t}`); }));

export async function envCreate(params: {
  task: "simple_spread"; seed: number; num_agents: number; num_landmarks: number;
  local_ratio?: number; episode_horizon?: number; action_type?: "DISCRETE_ACT";
}) { return j(await fetch(`${BASE}/env/create`, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(params) })); }

export async function envSpec(env_id: string) {
  return j(await fetch(`${BASE}/env/spec`, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ env_id }) }));
}

export async function envReset(env_id: string) {
  return j(await fetch(`${BASE}/env/reset`, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ env_id }) }));
}

export async function envStep(env_id: string, actions: Record<string, number>) {
  return j(await fetch(`${BASE}/env/step`, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ env_id, actions }) }));
}