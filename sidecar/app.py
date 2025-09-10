'''
The main FastAPI app for the JaxMARL sidecar server. 
Defines the API endpoints for creating environments, resetting, stepping, 
and querying state/specifications.

Created by: Elizabeth Mieczkowski, Updated: 09/2025
'''

from fastapi import FastAPI, HTTPException
from typing import Dict
import jax
import jax.numpy as jnp

from schemas import *
from env_registry import ENVS, build_env, env_spec, to_public_state, EnvHandle

app = FastAPI(title="Tandem JaxMARL Sidecar", version="0.1")

def ensure_env(env_id: str) -> EnvHandle:
    if env_id not in ENVS:
        raise HTTPException(status_code=404, detail="env_id not found")
    return ENVS[env_id]

@app.post("/env/create", response_model=CreateResp)
def create(req: CreateReq):
    import uuid
    env_id = f"env_{uuid.uuid4().hex[:6]}"
    handle = build_env(
        task=req.task,
        seed=req.seed,
        num_agents=req.num_agents,
        num_landmarks=req.num_landmarks,
        local_ratio=req.local_ratio,
        episode_horizon=req.episode_horizon,
    )
    ENVS[env_id] = handle
    return CreateResp(env_id=env_id)

@app.post("/env/spec", response_model=SpecResp)
def spec(req: IdReq):
    h = ensure_env(req.env_id)
    return SpecResp(**env_spec(h.env, int(jax.random.key_data(h.key)[0])))

@app.post("/env/reset")
def reset(req: ResetReq):
    h = ensure_env(req.env_id)
    h.key, key_reset = jax.random.split(h.key)
    obs, state = h.env.reset(key_reset)
    h.state = state
    return {
        "state": {"step": int(state.step), "episodeId": "e_0001"},
        "obs": {a: [float(x) for x in obs[a]] for a in h.env.agents},
        "spec": env_spec(h.env, int(jax.random.key_data(h.key)[0]))
    }

@app.post("/env/step")
def step(req: StepReq):
    h = ensure_env(req.env_id)
    if h.state is None:
        raise HTTPException(status_code=400, detail="env not reset")
    # Validate discrete actions
    n = int(h.env.action_spaces[h.env.agents[0]].n)
    for a, idx in req.actions.items():
        if not (0 <= idx < n):
            raise HTTPException(status_code=400, detail=f"action out of range for {a}: {idx}")
    # JAX step
    h.key, key_step = jax.random.split(h.key)
    obs, new_state, rewards, dones, info = h.env.step_env(key_step, h.state, req.actions)
    h.state = new_state
    # Format outputs
    return {
        "state": to_public_state(h.env, new_state),
        "obs": {a: [float(x) for x in obs[a]] for a in h.env.agents},
        "rewards": {a: float(rewards[a]) for a in h.env.agents},
        "dones": {**{a: bool(dones[a]) for a in h.env.agents}, "__all__": bool(jnp.all(jnp.array(list(dones.values()))))},
        "info": info,
    }

@app.post("/env/state")
def get_state(req: IdReq):
    h = ensure_env(req.env_id)
    if h.state is None:
        raise HTTPException(status_code=400, detail="env not reset")
    return {"state": to_public_state(h.env, h.state)}
