'''
Overcooked (onion soup, 1-10 agents) through the sidecar API: the classic
file layouts, and the scaling sweep's kitchen and settings (pots, cook time,
recipe size, order size) on the lab's JaxMARL fork.
Needs a running sidecar (SIDECAR_URL, default :8001) and jaxmarl installed
here too (the round-trip checks rebuild states locally).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
'''

import os, time
import numpy as np
import pytest
import requests
import jax
import overcooked_task as oc

BASE = os.environ.get("SIDECAR_URL", "http://127.0.0.1:8001")
RIGHT, DOWN, LEFT, UP, STAY, INTERACT = range(6)
CREATED = []  # env ids to close when the tests finish (the sidecar may be a live one)

@pytest.fixture(autouse=True, scope="module")
def close_envs():
    yield
    for env_id in CREATED:
        requests.post(f"{BASE}/env/close", json={"env_id": env_id})

def post(path, **body):
    return requests.post(f"{BASE}{path}", json=body)

def create(N=10, seed=123, horizon=400, layout="open_room", **game):
    r = post("/env/create", task="overcooked", seed=seed, num_agents=N, episode_horizon=horizon, layout=layout, **game)
    r.raise_for_status()
    CREATED.append(r.json()["env_id"])
    return r.json()["env_id"]

def agents(N):
    return [f"agent_{i}" for i in range(N)]

_local_envs = {}
def local_env(N, horizon, layout="open_room", **game):
    """The same env, built in this process, to rebuild states and observations."""
    key = (N, horizon, layout, tuple(sorted(game.items())))
    if key not in _local_envs:
        lay, placed = oc.load_layout(layout, N)
        _local_envs[key] = oc.make_env(lay, horizon, num_agents=N, agents_placed=placed, **game)
    return _local_envs[key]

def check_round_trip(N, horizon, resp, layout="open_room", **game):
    """The public state must rebuild the exact env state: same observations as the sidecar's."""
    env = local_env(N, horizon, layout, **game)
    obs = env.get_obs(oc.state_from_public(env, resp["state"]))
    for a in env.agents:
        assert np.array_equal(np.asarray(jax.device_get(obs[a])).reshape(-1), np.asarray(resp["obs"][a])), a

def test_spec():
    spec = post("/env/spec", env_id=create(N=10)).json()
    assert spec["game"] == "overcooked"
    assert spec["action_space"] == {"type": "discrete", "n": 6,
        "labels": ["right", "down", "left", "up", "stay", "interact"], "noop": 4}
    lay = spec["layout"]
    assert lay["name"] == "open_room" and (lay["width"], lay["height"]) == (11, 8)
    assert len(lay["rows"]) == 8 and all(len(r) == 11 for r in lay["rows"])
    assert not any(c in "".join(lay["rows"]) for c in "abcdefghijA")  # spawns are floor
    assert len(lay["spawns"]) == 10 and spec["num_agents"] == 10
    assert spec["recipes"] == [[0, 0, 0]] and spec["start_cooking_interaction"] is False
    assert spec["max_steps"] == 400 and spec["seed"] == 123
    assert "dt" not in spec

def test_reset_places_agents_on_spawns_in_order():
    env = create(N=10)
    spec = post("/env/spec", env_id=env).json()
    r = post("/env/reset", env_id=env).json()
    st = r["state"]
    assert "obs" not in r
    assert st["step"] == 0 and st["items"] == [] and st["episodeId"] == "e_0001"
    assert [st["agents"][a]["pos"] for a in agents(10)] == spec["layout"]["spawns"]
    assert spec["layout"]["spawns"][:2] == [[2, 2], [8, 5]]  # 'a' then 'b'
    assert all(st["agents"][a]["inv"] == 0 for a in agents(10))
    r = post("/env/reset", env_id=env, include_obs=True).json()
    assert len(r["obs"]["agent_0"]) == int(np.prod(spec["observation_shape"]))

def test_every_group_size_1_to_10():
    for N in range(1, 11):
        env = create(N=N)
        r = post("/env/reset", env_id=env).json()
        assert sorted(r["state"]["agents"]) == sorted(agents(N))
        s = post("/env/step", env_id=env, actions={a: RIGHT for a in agents(N)})
        assert s.status_code == 200, (N, s.text)
        assert s.json()["state"]["step"] == 1

def test_bad_layout_or_group_rejected():
    for body in [dict(num_agents=11),                    # open_room seats 10
                 dict(num_agents=3, layout="no_such_layout"),
                 dict(num_agents=3, layout="../app")]:
        r = post("/env/create", task="overcooked", **body)
        assert r.status_code == 400, body
    assert post("/env/create", task="overcooked", num_agents=0).status_code == 422

def test_bad_actions_rejected():
    env = create(N=3)
    post("/env/reset", env_id=env)
    assert post("/env/step", env_id=env, actions={"agent_0": 6, "agent_1": 0, "agent_2": 0}).status_code == 400
    assert post("/env/step", env_id=env, actions={"agent_0": 0}).status_code == 400

def test_spec_hash_identifies_game_not_seed():
    h = lambda **kw: post("/env/spec", env_id=create(**kw)).json()["spec_hash"]
    assert h(N=4, seed=1) == h(N=4, seed=2)
    assert h(N=4) != h(N=5)
    assert h(N=4).startswith("overcooked:")

def test_same_config_reuses_compiled_env():
    create(N=7, horizon=123)
    t = time.time()
    create(N=7, horizon=123)
    assert time.time() - t < 0.3

def test_full_soup_cooked_and_delivered():
    # One cook (spawn 'a' at (2,2)) makes and serves a 3-onion soup. Every step
    # also checks that the public state rebuilds the exact env state.
    N, H = 1, 400
    env = create(N=N, horizon=H)
    post("/env/reset", env_id=env)
    total = 0.0
    def act(*seq):
        nonlocal total
        for a in seq:
            r = post("/env/step", env_id=env, actions={"agent_0": a}, include_obs=True)
            assert r.status_code == 200, r.text
            r = r.json()
            check_round_trip(N, H, r)
            total += r["rewards"]["agent_0"]
        return r["state"]
    me = lambda st: st["agents"]["agent_0"]
    pot = lambda st: next((i for i in st["items"] if i["pos"] == [3, 0]), None)

    st = act(LEFT, UP, LEFT, INTERACT)            # onion pile at (0,1)
    assert me(st)["pos"] == [1, 1] and me(st)["inv"] == 4   # holding an onion
    st = act(RIGHT, RIGHT, UP, INTERACT)          # pot at (3,0)
    assert me(st)["inv"] == 0 and pot(st)["item"] == 4 and pot(st)["timer"] == 0
    for _ in range(2):
        st = act(LEFT, LEFT, LEFT, INTERACT, RIGHT, RIGHT, UP, INTERACT)
    assert pot(st)["item"] == 12 and 0 < pot(st)["timer"] <= 20   # 3 onions, cooking
    st = act(DOWN, DOWN, LEFT, LEFT, LEFT, INTERACT)  # plate pile at (0,3)
    assert me(st)["pos"] == [1, 3] and me(st)["inv"] == 1
    while pot(st)["timer"] > 0:
        st = act(STAY)
    assert pot(st)["item"] == 14                  # cooked soup in the pot
    st = act(RIGHT, RIGHT, UP, UP, UP, INTERACT)  # plate the soup
    assert me(st)["inv"] == 15 and pot(st) is None
    st = act(DOWN, DOWN, DOWN, LEFT, LEFT, LEFT, INTERACT)  # delivery at (0,4)
    assert me(st)["inv"] == 0 and st["newCorrectDelivery"] is True
    assert total == 20.0

def test_ten_cooks_random_play():
    # Random actions: never two cooks in a cell or on a non-floor cell, the
    # same seed and actions give the same game, and states round-trip
    N, H = 10, 400
    spec = post("/env/spec", env_id=create(N=N, horizon=H)).json()
    rows = spec["layout"]["rows"]
    e1, e2 = create(N=N, horizon=H, seed=5), create(N=N, horizon=H, seed=5)
    post("/env/reset", env_id=e1); post("/env/reset", env_id=e2)
    rng = np.random.default_rng(0)
    latencies = []
    for step in range(150):
        acts = {a: int(rng.integers(6)) for a in agents(N)}
        t = time.perf_counter()
        r1 = post("/env/step", env_id=e1, actions=acts, include_obs=step % 10 == 0).json()
        latencies.append(time.perf_counter() - t)
        r2 = post("/env/step", env_id=e2, actions=acts).json()
        assert r1["state"]["agents"] == r2["state"]["agents"] and r1["state"]["items"] == r2["state"]["items"]
        pos = [tuple(r1["state"]["agents"][a]["pos"]) for a in agents(N)]
        assert len(set(pos)) == N
        assert all(rows[y][x] == " " for x, y in pos)
        if "obs" in r1:
            check_round_trip(N, H, r1)
    assert sorted(latencies)[len(latencies) // 2] < 0.02, "median 10-agent step over 20 ms"


# ---- The scaling sweep's kitchen and settings (lab fork) ----

SWEEP = dict(layout="scaling_kitchen", recipe_size=1, pot_placement="nearest")
# Pot cells in the order the sweep's "nearest" placement adds them
NEAREST_POTS = [(1, 0), (10, 0), (0, 1), (11, 1), (2, 0), (9, 0), (1, 6), (10, 6), (0, 5), (11, 5)]

def pots_in(rows):
    return sorted((x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == "P")

def test_sweep_kitchen_layout_pots_and_spawns():
    for P in (1, 2, 5, 10):
        spec = post("/env/spec", env_id=create(N=3, horizon=1500, num_pots=P, pot_cook_time=20, order_size=10, **SWEEP)).json()
        rows = spec["layout"]["rows"]
        assert (spec["layout"]["width"], spec["layout"]["height"]) == (12, 7)
        assert pots_in(rows) == sorted(NEAREST_POTS[:P]), (P, rows)
        assert spec["num_pots"] == P and spec["pot_placement"] == "nearest"
        # Piles, delivery and plates as in the sweep README (onion pile drawn as 'O')
        assert [r[0] for r in rows[2:5]] == ["O", "X", "B"] and [r[-1] for r in rows[2:5]] == ["O", "X", "B"]
    # Agents placed by Layout.with_num_agents, as in the sweep
    assert spec["layout"]["spawns"] == [[5, 3], [10, 1], [1, 1]]
    assert spec["recipes"] == [[0]] and spec["recipe_size"] == 1 and spec["order_size"] == 10
    assert spec["pot_cook_time"] == 20 and spec["no_collision"] is False and spec["max_steps"] == 1500

def test_sweep_settings_change_the_hash():
    h = lambda **kw: post("/env/spec", env_id=create(N=3, horizon=1500, order_size=10, **SWEEP, **kw)).json()["spec_hash"]
    assert h(num_pots=1, pot_cook_time=5) != h(num_pots=1, pot_cook_time=60)
    assert h(num_pots=1, pot_cook_time=5) != h(num_pots=5, pot_cook_time=5)
    assert h(num_pots=1, pot_cook_time=5) == h(num_pots=1, pot_cook_time=5)

def test_too_many_pots_or_unknown_settings_rejected():
    assert post("/env/create", task="overcooked", num_agents=3, num_pots=30, **SWEEP).status_code == 400
    assert post("/env/create", task="overcooked", num_agents=3, recipe_size=4, layout="scaling_kitchen").status_code == 422
    assert post("/env/create", task="overcooked", num_agents=3, order_size=0, layout="scaling_kitchen").status_code == 422

# One cook in the sweep kitchen (1 pot at (1,0)): onion from (0,2), pot, plate
# from (0,4), wait for the soup, plate it, serve at (0,3). Serves on step 35.
ONE_SOUP = [UP, LEFT, LEFT, LEFT, LEFT, LEFT, INTERACT, UP, UP, INTERACT,
            DOWN, DOWN, DOWN, LEFT, INTERACT, UP, UP, UP, UP] + [INTERACT] * 12 + [DOWN, DOWN, LEFT, INTERACT]

def play(env, seq, game):
    out = []
    for a in seq:
        r = post("/env/step", env_id=env, actions={"agent_0": a}, include_obs=True)
        assert r.status_code == 200, r.text
        r = r.json()
        check_round_trip(1, 200, r, "scaling_kitchen", **game)
        out.append(r)
    return out

def test_order_complete_ends_the_episode():
    game = dict(num_pots=1, pot_cook_time=20, order_size=1, recipe_size=1, pot_placement="nearest")
    env = create(N=1, horizon=200, layout="scaling_kitchen", **game)
    post("/env/reset", env_id=env)
    steps = play(env, ONE_SOUP, game)
    pot = [i for i in steps[9]["state"]["items"] if i["pos"] == [1, 0]][0]
    # 1 onion: cooks at once; the timer counts down on the step the onion goes in
    assert pot["item"] == 4 and pot["timer"] == 20 - 1
    assert steps[18]["state"]["agents"]["agent_0"]["inv"] == 1  # holding a plate
    last = steps[-1]
    assert last["state"]["delivered"] == 1 and last["state"]["step"] == 35
    assert last["rewards"]["agent_0"] == 20.0 and last["dones"]["__all__"] is True
    assert last["info"]["order_completed"] == [True]
    assert not any(r["dones"]["__all__"] for r in steps[:-1])

def test_order_not_complete_until_order_size():
    game = dict(num_pots=1, pot_cook_time=20, order_size=2, recipe_size=1, pot_placement="nearest")
    env = create(N=1, horizon=200, layout="scaling_kitchen", **game)
    post("/env/reset", env_id=env)
    last = play(env, ONE_SOUP, game)[-1]
    assert last["state"]["delivered"] == 1 and last["dones"]["__all__"] is False
    assert last["info"]["order_completed"] == [False]

def test_cook_time_sets_the_pot_timer():
    for cook in (5, 60):
        game = dict(num_pots=1, pot_cook_time=cook, order_size=10, recipe_size=1, pot_placement="nearest")
        env = create(N=1, horizon=200, layout="scaling_kitchen", **game)
        post("/env/reset", env_id=env)
        st = play(env, ONE_SOUP[:10], game)[-1]["state"]
        assert [i for i in st["items"] if i["pos"] == [1, 0]][0]["timer"] == cook - 1
