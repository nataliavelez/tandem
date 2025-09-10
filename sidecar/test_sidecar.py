'''
Created by: Elizabeth Mieczkowski, Updated: 09/2025
'''

import requests, math

BASE = "http://127.0.0.1:8001"

def create_env(seed=123, N=3, L=3, horizon=10):
    r = requests.post(f"{BASE}/env/create", json={
        "task":"simple_spread","seed":seed,"num_agents":N,"num_landmarks":L,"episode_horizon":horizon
    }); r.raise_for_status()
    return r.json()["env_id"]

def test_spec_and_reset():
    env = create_env()
    spec = requests.post(f"{BASE}/env/spec", json={"env_id":env}).json()
    assert spec["action_space"]["type"] == "discrete"
    assert spec["action_space"]["n"] == 5
    assert spec["observation_shape"][0] == 4 + (3-1)*4 + (3*2)  # 14
    r = requests.post(f"{BASE}/env/reset", json={"env_id":env}).json()
    assert r["state"]["step"] == 0
    assert set(r["obs"].keys()) == {f"agent_{i}" for i in range(3)}

def test_invalid_action_rejected():
    env = create_env()
    requests.post(f"{BASE}/env/reset", json={"env_id":env})
    bad = requests.post(f"{BASE}/env/step", json={"env_id":env,"actions":{"agent_0":99}})
    assert bad.status_code == 400

def test_deterministic_fixed_actions():
    env1 = create_env(seed=7); requests.post(f"{BASE}/env/reset", json={"env_id":env1})
    env2 = create_env(seed=7); requests.post(f"{BASE}/env/reset", json={"env_id":env2})
    seq = [{"agent_0":2,"agent_1":4,"agent_2":0}]*5
    pos1, pos2 = [], []
    for a in seq:
        s1 = requests.post(f"{BASE}/env/step", json={"env_id":env1,"actions":a}).json()
        s2 = requests.post(f"{BASE}/env/step", json={"env_id":env2,"actions":a}).json()
        pos1.append(tuple(s1["state"]["agents"]["agent_0"]["pos"]))
        pos2.append(tuple(s2["state"]["agents"]["agent_0"]["pos"]))
    assert pos1 == pos2

def test_horizon_done():
    env = create_env(horizon=3)
    requests.post(f"{BASE}/env/reset", json={"env_id": env})

    out = None
    for _ in range(4):  # horizon + 1
        out = requests.post(
            f"{BASE}/env/step",
            json={"env_id": env, "actions": {"agent_0": 1, "agent_1": 1, "agent_2": 1}},
        ).json()
    assert out["dones"]["__all__"] is True
