'''
Defines the API inputs/outputs, validates incoming JSON, and creates 
consistent structure for responses.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
'''

from pydantic import BaseModel, Field
from typing import Dict, List, Literal, Optional

class CreateReq(BaseModel):
    task: Literal["simple_spread", "overcooked"] = "simple_spread"
    seed: int = 0
    num_agents: int = Field(3, ge=1)
    episode_horizon: int = Field(3000, ge=1)
    # simple_spread only
    num_landmarks: int = 3
    local_ratio: float = 0.5
    action_type: Literal["DISCRETE_ACT"] = "DISCRETE_ACT"
    # overcooked only: name of sidecar/layouts/<layout>.txt
    layout: str = "open_room"

class IdReq(BaseModel):
    env_id: str

class ResetReq(IdReq):
    # Observations are only needed for debugging/analysis (the server doesn't
    # use them), and overcooked's are large, so they are sent only on request
    include_obs: bool = False

class StepReq(IdReq):
    actions: Dict[str, int]  # agentId -> discrete index
    include_obs: bool = False

class CreateResp(BaseModel):
    ok: bool = True
    env_id: str

class ActionSpace(BaseModel):
    type: Literal["discrete"] = "discrete"
    n: int
    labels: List[str] = ["noop","left","right","down","up"]
    noop: int = 0  # index of the do-nothing action (overcooked: 4 = stay)

class OvercookedLayout(BaseModel):
    name: str
    width: int
    height: int
    rows: List[str]            # static grid: W counter, P pot, O onion pile, B plate pile, X delivery, ' ' floor
    spawns: List[List[int]]    # (x, y) of agent_0..agent_{N-1} at reset

class SpecResp(BaseModel):
    game: Literal["mpe", "overcooked"]
    observation_shape: List[int]
    action_space: ActionSpace
    seed: int
    max_steps: int
    spec_hash: str
    versions: Dict[str, Optional[str]] = {}
    # mpe only
    dt: Optional[float] = None
    # overcooked only
    engine: Optional[str] = None
    num_agents: Optional[int] = None
    layout: Optional[OvercookedLayout] = None
    recipes: Optional[List[List[int]]] = None
    directions: Optional[List[str]] = None
    pot_cook_time: Optional[int] = None
    delivery_reward: Optional[float] = None
    start_cooking_interaction: Optional[bool] = None

class StateResp(BaseModel):
    state: Dict
    obs: Dict[str, List[float]]
    rewards: Optional[Dict[str, float]] = None
    dones: Optional[Dict[str, bool]] = None
    info: Optional[Dict] = None