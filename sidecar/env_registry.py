'''
Keep track of active environments and wrap JaxMARL. 

Created by: Elizabeth Mieczkowski, Updated: 09/2025
'''

import hashlib
import jax
import jax.numpy as jnp
from typing import Dict, Any
from jaxmarl.environments.mpe.simple_spread import SimpleSpreadMPE
from jaxmarl.environments.mpe.default_params import DISCRETE_ACT

def spec_hash(spec: Dict[str, Any]) -> str:
    s = "|".join(f"{k}={spec[k]}" for k in sorted(spec.keys()))
    return hashlib.sha1(s.encode()).hexdigest()[:12]

class EnvHandle:
    def __init__(self, env, key, episode_horizon):
        self.env = env
        self.key = key
        self.state = None
        self.episode_horizon = episode_horizon
        self.episode_id = 0

ENVS: Dict[str, EnvHandle] = {}

def build_env(task: str, seed: int, num_agents: int, num_landmarks: int,
              local_ratio: float, episode_horizon: int):
    
    assert task == "simple_spread" # only task supported for now

    env = SimpleSpreadMPE(
        num_agents=num_agents,
        num_landmarks=num_landmarks,
        local_ratio=local_ratio,
        action_type=DISCRETE_ACT,
        max_steps=episode_horizon,
    )
    key = jax.random.PRNGKey(seed)
    return EnvHandle(env=env, key=key, episode_horizon=episode_horizon)

def env_spec(env: SimpleSpreadMPE, seed: int) -> Dict[str, Any]:
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
        seed=seed,
        max_steps=int(env.max_steps),
    )
    return dict(
        observation_shape=obs_shape,
        action_space={"type": "discrete", "n": n_actions, "labels": labels},
        dt=spec["dt"],
        seed=seed,
        spec_hash=f"mpe-ss:{spec_hash(spec)}",
    )

def to_public_state(env: SimpleSpreadMPE, state) -> Dict[str, Any]:
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
        "episodeId": f"e_{int(state.step==0)}"
    }
