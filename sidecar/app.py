'''
The main FastAPI app for the JaxMARL sidecar server. 
Defines the API endpoints for creating environments, resetting, stepping, 
and querying state/specifications.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
'''

from fastapi import FastAPI, HTTPException
from typing import Dict
import jax
import jax.numpy as jnp

from schemas import *
from env_registry import ENVS, _COMPILED, build_env, env_spec, to_public_state, num_actions, obs_lists, EnvHandle
from overcooked_task import LayoutError

app = FastAPI(title="Tandem JaxMARL Sidecar", version="0.1")

@app.get("/health")
def health():
    # For the server's admin view: live envs (one per room) and compiled game configs
    return {"ok": True, "envs": len(ENVS), "compiled_configs": len(_COMPILED)}

def ensure_env(env_id: str) -> EnvHandle:
    if env_id not in ENVS:
        raise HTTPException(status_code=404, detail="env_id not found")
    return ENVS[env_id]

@app.post("/env/create", response_model=CreateResp)
def create(req: CreateReq):
    import uuid
    env_id = f"env_{uuid.uuid4().hex[:6]}"
    try:
        handle = build_env(req)
    except LayoutError as e:
        raise HTTPException(status_code=400, detail=str(e))
    ENVS[env_id] = handle
    return CreateResp(env_id=env_id)

@app.post("/env/spec", response_model=SpecResp, response_model_exclude_none=True)
def spec(req: IdReq):
    h = ensure_env(req.env_id)
    return SpecResp(**env_spec(h))

@app.post("/env/reset")
def reset(req: ResetReq):
    h = ensure_env(req.env_id)
    h.key, key_reset = jax.random.split(h.key)
    obs, state = h.reset_fn(key_reset)
    h.state = state
    h.episode_id += 1
    out = {"state": to_public_state(h, state), "spec": env_spec(h)}
    if req.include_obs:
        out["obs"] = obs_lists(h, obs)
    return out

@app.post("/env/step")
def step(req: StepReq):
    h = ensure_env(req.env_id)
    if h.state is None:
        raise HTTPException(status_code=400, detail="env not reset")
    # Every agent needs an action (step_env indexes by agent name)
    missing = [a for a in h.env.agents if a not in req.actions]
    unknown = [a for a in req.actions if a not in h.env.agents]
    if missing or unknown:
        raise HTTPException(status_code=400, detail=f"missing actions for {missing}; unknown agents {unknown}")
    # Validate discrete actions
    n = num_actions(h)
    for a, idx in req.actions.items():
        if not (0 <= idx < n):
            raise HTTPException(status_code=400, detail=f"action out of range for {a}: {idx}")
    # JAX step (fixed int32 dtype so the jitted fn doesn't retrace)
    actions = {a: jnp.int32(req.actions[a]) for a in h.env.agents}
    h.key, key_step = jax.random.split(h.key)
    obs, new_state, rewards, dones, info = h.step_fn(key_step, h.state, actions)
    h.state = new_state
    # Format outputs
    out = {
        "state": to_public_state(h, new_state),
        "rewards": {a: float(rewards[a]) for a in h.env.agents},
        "dones": {**{a: bool(dones[a]) for a in h.env.agents}, "__all__": bool(dones["__all__"])},
        "info": jax.tree_util.tree_map(lambda x: jnp.asarray(x).tolist(), info),
    }
    if req.include_obs:
        out["obs"] = obs_lists(h, obs)
    return out

@app.post("/env/state")
def get_state(req: IdReq):
    h = ensure_env(req.env_id)
    if h.state is None:
        raise HTTPException(status_code=400, detail="env not reset")
    return {"state": to_public_state(h, h.state)}

@app.post("/env/close")
def close(req: IdReq):
    # Free an env when its room is disposed (otherwise ENVS grows forever)
    ENVS.pop(req.env_id, None)
    return {"ok": True}
