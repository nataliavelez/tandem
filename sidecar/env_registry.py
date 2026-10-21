'''
Keep track of active environments and wrap JaxMARL. 

Tasks: "simple_spread" (MPE) and "overcooked" (classic onion soup on the
OvercookedV2 engine, 1-10 agents; see overcooked_task.py). Each env handle
knows its task, so spec / public state / action checks dispatch on it.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
'''

import hashlib
import subprocess
import threading
from importlib import metadata
from pathlib import Path
import numpy as np
import jax
import jax.numpy as jnp
from typing import Dict, Any
from jaxmarl.environments.mpe.simple_spread import SimpleSpreadMPE
from jaxmarl.environments.mpe.default_params import DISCRETE_ACT
import jaxmarl
import overcooked_task

def spec_hash(spec: Dict[str, Any]) -> str:
    s = "|".join(f"{k}={spec[k]}" for k in sorted(spec.keys()))
    return hashlib.sha1(s.encode()).hexdigest()[:12]

class EnvHandle:
    def __init__(self, task, env, reset_fn, step_fn, key, seed, episode_horizon, extra=None):
        self.task = task
        self.env = env
        # Task-specific build info (overcooked: layout name and rows)
        self.extra = extra or {}
        self.key = key
        self.seed = seed
        self.state = None
        self.episode_horizon = episode_horizon
        self.episode_id = 0  # incremented on every reset
        self.reset_fn = reset_fn
        self.step_fn = step_fn

    @property
    def episode_label(self) -> str:
        return f"e_{self.episode_id:04d}"

ENVS: Dict[str, EnvHandle] = {}

# Env + jitted reset/step, shared by every env with the same config. JAX caches
# compilations per function object, so jitting each new env's bound methods
# recompiled for every room (0.5-2 s), stalling the steps of rooms already
# running. Envs keep no episode state (it is passed in), so sharing is safe.
_COMPILED: Dict[tuple, tuple] = {}
_COMPILE_LOCK = threading.Lock()

def _compiled(cfg: tuple, make_env):
    """Env + jitted reset/step for a config key, built (and compiled) once."""
    with _COMPILE_LOCK:  # two rooms with a new config compile it once
        if cfg not in _COMPILED:
            env = make_env()
            compiled = (env, jax.jit(env.reset), jax.jit(env.step_env))
            warm_up(*compiled)
            _COMPILED[cfg] = compiled
        return _COMPILED[cfg]

def build_env(req) -> EnvHandle:
    """req: a CreateReq. Raises overcooked_task.LayoutError for an unusable layout/group size."""
    if req.task == "simple_spread":
        cfg = ("simple_spread", req.num_agents, req.num_landmarks, req.local_ratio, req.episode_horizon)
        make = lambda: SimpleSpreadMPE(
            num_agents=req.num_agents,
            num_landmarks=req.num_landmarks,
            local_ratio=req.local_ratio,
            action_type=DISCRETE_ACT,
            max_steps=req.episode_horizon,
        )
        extra = {}
    elif req.task == "overcooked":
        layout, rows = overcooked_task.load_layout(req.layout, req.num_agents)
        # The layout's contents are part of the key, so editing a layout file recompiles
        cfg = ("overcooked", req.layout, tuple(rows), req.num_agents, req.episode_horizon)
        make = lambda: overcooked_task.make_env(layout, req.episode_horizon)
        extra = {"layout": req.layout, "rows": rows}
    else:
        raise ValueError(f"unknown task {req.task!r}")

    env, reset_fn, step_fn = _compiled(cfg, make)
    return EnvHandle(task=req.task, env=env, reset_fn=reset_fn, step_fn=step_fn,
                     key=jax.random.PRNGKey(req.seed), seed=req.seed,
                     episode_horizon=req.episode_horizon, extra=extra)

def num_actions(h: EnvHandle) -> int:
    # OvercookedV2 has no action_spaces dict, only action_space()
    return int(h.env.action_space(h.env.agents[0]).n)

def obs_lists(h: EnvHandle, obs) -> Dict[str, list]:
    """Observations flattened per agent (overcooked obs are H x W x C; shape is in the spec)."""
    host = jax.device_get(obs)
    return {a: [float(x) for x in np.asarray(host[a]).reshape(-1)] for a in h.env.agents}

def warm_up(env, reset_fn, step_fn):
    # Compile reset/step now (on a throwaway key) so the first live ticks aren't slow.
    # Step twice: the state step returns has slightly different dtypes than the one
    # reset returns, so jit compiles a second version on the 2nd step.
    k = jax.random.PRNGKey(0)
    _, state = reset_fn(k)
    noop = {a: jnp.int32(0) for a in env.agents}  # any action compiles the same function
    for _ in range(2):
        _, state, *_ = jax.block_until_ready(step_fn(k, state, noop))

def _git_commit(path: Path):
    try:
        out = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None
    except Exception:
        return None

def _version(pkg: str):
    try:
        return metadata.version(pkg)
    except metadata.PackageNotFoundError:
        return None

# Recorded in every spec (and so in the data log), to tie data to the code that made it
VERSIONS = {
    "jax": jax.__version__,
    "jaxmarl": _version("jaxmarl"),
    "jaxmarl_commit": _git_commit(Path(jaxmarl.__file__).resolve().parent),
}

def env_spec(h: EnvHandle) -> Dict[str, Any]:
    if h.task == "overcooked":
        return overcooked_spec(h)
    env = h.env
    # For SimpleSpread: obs_dim = 4 + (N-1)*4 + (L*2)
    obs_shape = list(env.observation_spaces[env.agents[0]].shape)
    n_actions = int(env.action_spaces[env.agents[0]].n)
    labels = ["noop","left","right","down","up"] if n_actions == 5 else [f"action_{i}" for i in range(n_actions)]
    spec = dict(
        observation_shape=obs_shape,
        action_space_n=n_actions,
        dt=float(getattr(env, "dt", 0.1)),
        accel=float(getattr(env, "accel", jnp.array([5.0]))[0]),
        damping=float(getattr(env, "damping", 0.25)),
        num_agents=int(env.num_agents),
        num_landmarks=int(env.num_landmarks),
        max_steps=int(env.max_steps),
    )
    return dict(
        game="mpe",
        observation_shape=obs_shape,
        action_space={"type": "discrete", "n": n_actions, "labels": labels, "noop": 0},
        dt=spec["dt"],
        seed=h.seed,
        max_steps=spec["max_steps"],
        # Identifies the env config (not the seed), so the same game has the same hash
        spec_hash=f"mpe-ss:{spec_hash(spec)}",
        versions=VERSIONS,
    )

def overcooked_spec(h: EnvHandle) -> Dict[str, Any]:
    fields = overcooked_task.spec_fields(h.env, h.extra["layout"], h.extra["rows"])
    # Identifies the game config (not the seed): same layout/group/horizon = same hash
    hashed = {k: fields[k] for k in ("engine", "max_steps", "num_agents", "recipes", "start_cooking_interaction")}
    hashed["layout_rows"] = "/".join(fields["layout"]["rows"])
    hashed["spawns"] = fields["layout"]["spawns"]
    return dict(**fields, seed=h.seed, spec_hash=f"overcooked:{spec_hash(hashed)}", versions=VERSIONS)

def to_public_state(h: EnvHandle, state) -> Dict[str, Any]:
    if h.task == "overcooked":
        return overcooked_task.to_public_state(h.env, state, h.episode_label)
    return mpe_public_state(h.env, state, h.episode_label)

def mpe_public_state(env: SimpleSpreadMPE, state, episode_label: str) -> Dict[str, Any]:
    # positions in [-1,1], velocities shown for agents only
    agents = {}
    for i, a in enumerate(env.agents):
        agents[a] = {
            "pos": [float(state.p_pos[i,0]), float(state.p_pos[i,1])],
            "vel": [float(state.p_vel[i,0]), float(state.p_vel[i,1])],
            "isHuman": True,  # server will overwrite this field
        }
    landmarks = []
    for j in range(env.num_landmarks):
        idx = env.num_agents + j
        landmarks.append({"pos":[float(state.p_pos[idx,0]), float(state.p_pos[idx,1])], "radius": 0.05})
    return {
        "agents": agents,
        "landmarks": landmarks,
        "step": int(state.step),
        "episodeId": episode_label,
    }
