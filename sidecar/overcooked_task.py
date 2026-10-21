'''
Overcooked for Tandem: JaxMARL's OvercookedV2 engine (any number of agents)
set to classic Overcooked-AI onion soup -- one recipe (3 onions), the pot
starts cooking as soon as it is full, full observability.

- Layouts are text files in sidecar/layouts/<name>.txt (format in
  layouts/open_room.txt). Spawns are marked a-j and filled in letter order, so
  one layout serves groups of 1..N.
- Public state (what the server broadcasts and logs each tick) holds
  everything needed to rebuild the env state exactly (state_from_public), so
  observations can be recomputed offline instead of being sent every step.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
'''

import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import jax
import jax.numpy as jnp

from jaxmarl.environments.overcooked_v2.overcooked import OvercookedV2, State
from jaxmarl.environments.overcooked_v2.layouts import Layout
from jaxmarl.environments.overcooked_v2.common import StaticObject, Agent, Position, Actions, Direction
from jaxmarl.environments.overcooked_v2.settings import POT_COOK_TIME, DELIVERY_REWARD

LAYOUT_DIR = Path(__file__).resolve().parent / "layouts"
LAYOUT_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SPAWN_MARKERS = "abcdefghij"
MAX_AGENTS = len(SPAWN_MARKERS)

# Classic onion soup only (for now): one ingredient, one recipe of 3 onions
CLASSIC_RECIPES = [[0, 0, 0]]
# Characters a classic layout may use (besides spawn markers)
LAYOUT_CHARS = set("WPOBX ")

ACTION_LABELS = [a.name for a in Actions]          # right, down, left, up, stay, interact
NOOP = int(Actions.stay)
DIRECTION_LABELS = [d.name.lower() for d in Direction]  # up, down, right, left

STATIC_TO_CHAR = {
    int(StaticObject.EMPTY): " ",
    int(StaticObject.WALL): "W",
    int(StaticObject.GOAL): "X",
    int(StaticObject.POT): "P",
    int(StaticObject.PLATE_PILE): "B",
    int(StaticObject.INGREDIENT_PILE_BASE): "O",  # onion pile (ingredient 0)
}


class LayoutError(ValueError):
    """Bad layout name/file, or the layout can't seat the requested group."""


def read_layout(name: str) -> Tuple[List[str], List[Tuple[int, int]]]:
    """Rows of the layout (spawn markers replaced by floor) and spawn (x, y) in fill order."""
    if not LAYOUT_NAME_RE.match(name):
        raise LayoutError(f"invalid layout name: {name!r}")
    path = LAYOUT_DIR / f"{name}.txt"
    if not path.is_file():
        available = sorted(p.stem for p in LAYOUT_DIR.glob("*.txt"))
        raise LayoutError(f"unknown layout {name!r}; available: {available}")

    rows = [ln.rstrip("\n") for ln in path.read_text().splitlines()
            if ln.strip() and not ln.startswith("#")]
    if not rows:
        raise LayoutError(f"layout {name!r} is empty")
    if len({len(r) for r in rows}) != 1:
        raise LayoutError(f"layout {name!r}: all rows must have the same length")

    spawns: Dict[str, Tuple[int, int]] = {}
    clean = []
    for y, row in enumerate(rows):
        out = []
        for x, ch in enumerate(row):
            if ch in SPAWN_MARKERS:
                if ch in spawns:
                    raise LayoutError(f"layout {name!r}: spawn {ch!r} appears twice")
                spawns[ch] = (x, y)
                ch = " "
            elif ch not in LAYOUT_CHARS:
                raise LayoutError(f"layout {name!r}: unsupported character {ch!r} at ({x},{y})")
            out.append(ch)
        clean.append("".join(out))

    order = sorted(spawns)
    if "".join(order) != SPAWN_MARKERS[:len(order)]:
        raise LayoutError(f"layout {name!r}: spawns must be consecutive letters from 'a' (found {''.join(order)})")
    _validate(name, clean, [spawns[c] for c in order])
    return clean, [spawns[c] for c in order]


def _validate(name: str, rows: List[str], spawns: List[Tuple[int, int]]):
    h, w = len(rows), len(rows[0])
    border = [rows[0], rows[-1]] + [r[0] + r[-1] for r in rows]
    if any(" " in b for b in border):
        raise LayoutError(f"layout {name!r}: the outer border must not contain floor")
    if not spawns:
        raise LayoutError(f"layout {name!r}: no spawn points (a-j)")
    # Every spawn must be able to reach each kind of station
    for sx, sy in spawns:
        seen, todo = {(sx, sy)}, [(sx, sy)]
        while todo:
            x, y = todo.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if 0 <= n[0] < w and 0 <= n[1] < h and n not in seen and rows[n[1]][n[0]] == " ":
                    seen.add(n)
                    todo.append(n)
        adjacent = {rows[y + dy][x + dx] for x, y in seen for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))}
        missing = [c for c in "POBX" if c not in adjacent]
        if missing:
            raise LayoutError(f"layout {name!r}: spawn at ({sx},{sy}) can't reach station(s) {missing}")


def load_layout(name: str, num_agents: int) -> Tuple[Layout, List[str]]:
    """The V2 Layout for a group of num_agents (first num_agents spawns) and its static rows."""
    rows, spawns = read_layout(name)
    if not 1 <= num_agents <= len(spawns):
        raise LayoutError(f"layout {name!r} seats 1-{len(spawns)} agents, not {num_agents}")
    # from_string needs at least one 'A'; positions are then replaced with ours (in fill order)
    grid = [list(r) for r in rows]
    x0, y0 = spawns[0]
    grid[y0][x0] = "A"
    layout = Layout.from_string("\n".join("".join(r) for r in grid), possible_recipes=CLASSIC_RECIPES)
    layout.agent_positions = list(spawns[:num_agents])
    return layout, rows


def make_env(layout: Layout, max_steps: int) -> OvercookedV2:
    return OvercookedV2(
        layout=layout,
        max_steps=max_steps,
        agent_view_size=None,              # full observability
        start_cooking_interaction=False,   # classic: pot cooks once it has 3 onions
        random_reset=False,
        random_agent_positions=False,
    )


def spec_fields(env: OvercookedV2, layout_name: str, rows: List[str]) -> Dict[str, Any]:
    """Overcooked-specific spec: what the client needs to draw and control the game."""
    return dict(
        game="overcooked",
        engine="overcooked_v2",
        observation_shape=list(env.obs_shape),
        action_space={"type": "discrete", "n": len(ACTION_LABELS), "labels": ACTION_LABELS, "noop": NOOP},
        max_steps=int(env.max_steps),
        num_agents=int(env.num_agents),
        layout={
            "name": layout_name,
            "width": int(env.width),
            "height": int(env.height),
            "rows": rows,
            "spawns": [list(p) for p in env.layout.agent_positions],
        },
        recipes=CLASSIC_RECIPES,
        directions=DIRECTION_LABELS,
        pot_cook_time=POT_COOK_TIME,
        delivery_reward=DELIVERY_REWARD,
        start_cooking_interaction=False,
    )


def to_public_state(env: OvercookedV2, state: State, episode_label: str) -> Dict[str, Any]:
    """
    Per-tick state. Lossless (see state_from_public). Items use the V2 bitfield:
    bit 0 plate, bit 1 cooked, bits 2-3 onion count (so 4 = onion, 12 = 3 onions,
    14 = cooked soup in a pot, 15 = plated soup). timer = pot cooking time left.
    """
    s = jax.device_get(state)
    xs, ys = np.asarray(s.agents.pos.x), np.asarray(s.agents.pos.y)
    dirs, inv = np.asarray(s.agents.dir), np.asarray(s.agents.inventory)
    agents = {
        a: {"pos": [int(xs[i]), int(ys[i])], "dir": int(dirs[i]), "inv": int(inv[i]), "isHuman": True}
        for i, a in enumerate(env.agents)
    }
    grid = np.asarray(s.grid)
    items = [
        {"pos": [int(x), int(y)], "item": int(grid[y, x, 1]), "timer": int(grid[y, x, 2])}
        for y, x in zip(*np.nonzero((grid[:, :, 1] != 0) | (grid[:, :, 2] != 0)))
    ]
    return {
        "agents": agents,
        "items": items,
        "recipe": int(s.recipe),
        "newCorrectDelivery": bool(s.new_correct_delivery),
        "step": int(s.time),
        "episodeId": episode_label,
    }


def state_from_public(env: OvercookedV2, public: Dict[str, Any]) -> State:
    """Rebuild the exact env state from a public (logged) state, e.g. to compute observations offline."""
    agents = [public["agents"][a] for a in env.agents]
    grid = np.zeros((env.height, env.width, 3), dtype=np.int32)
    grid[:, :, 0] = env.layout.static_objects
    for it in public["items"]:
        x, y = it["pos"]
        grid[y, x, 1] = it["item"]
        grid[y, x, 2] = it["timer"]
    t = int(public["step"])
    return State(
        agents=Agent(
            pos=Position(x=jnp.array([a["pos"][0] for a in agents], dtype=jnp.int32),
                         y=jnp.array([a["pos"][1] for a in agents], dtype=jnp.int32)),
            dir=jnp.array([a["dir"] for a in agents], dtype=jnp.int32),
            inventory=jnp.array([a["inv"] for a in agents], dtype=jnp.int32),
        ),
        grid=jnp.asarray(grid),
        time=jnp.int32(t),
        terminal=jnp.bool_(t >= env.max_steps),
        recipe=jnp.int32(public["recipe"]),
        new_correct_delivery=jnp.bool_(public["newCorrectDelivery"]),
        ingredient_permutations=None,
    )
