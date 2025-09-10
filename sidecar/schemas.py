'''
Defines the API inputs/outputs, validates incoming JSON, and creates 
consistent structure for responses.

Created by: Elizabeth Mieczkowski, Updated: 09/2025
'''

from pydantic import BaseModel, Field
from typing import Dict, List, Literal, Optional

class CreateReq(BaseModel):
    task: Literal["simple_spread"] = "simple_spread"
    seed: int = 0
    num_agents: int = 3
    num_landmarks: int = 3
    local_ratio: float = 0.5
    action_type: Literal["DISCRETE_ACT"] = "DISCRETE_ACT"
    episode_horizon: int = 300

class IdReq(BaseModel):
    env_id: str

class ResetReq(IdReq):
    pass

class StepReq(IdReq):
    actions: Dict[str, int]  # agentId -> discrete index

class CreateResp(BaseModel):
    ok: bool = True
    env_id: str

class ActionSpace(BaseModel):
    type: Literal["discrete"] = "discrete"
    n: int
    labels: List[str] = ["noop","left","right","down","up"]

class SpecResp(BaseModel):
    observation_shape: List[int]
    action_space: ActionSpace
    dt: float
    seed: int
    spec_hash: str

class StateResp(BaseModel):
    state: Dict
    obs: Dict[str, List[float]]
    rewards: Optional[Dict[str, float]] = None
    dones: Optional[Dict[str, bool]] = None
    info: Optional[Dict] = None