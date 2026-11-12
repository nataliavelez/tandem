'''
Overcooked for Tandem: JaxMARL's OvercookedV2 engine (any number of agents)
set to onion soup -- one ingredient, the pot starts cooking as soon as it is
full, full observability. Runs on the lab's JaxMARL fork (deploy/versions.env),
which adds the scaling-sweep options: number of pots and their placement, pot
cooking time, recipe size (onions per soup), order size (the episode ends once
that many soups are served) and collisions.

- Layouts: text files in sidecar/layouts/<name>.txt (format in
  layouts/open_room.txt; spawns marked a-j, filled in letter order, so one
  layout serves groups of 1..N), or else a layout built into JaxMARL (e.g.
  scaling_kitchen, the sweep's kitchen), whose agents are placed by
  Layout.with_num_agents exactly as in the sweep.
- The static grid sent to the client is read from the env (after pots are
  added), so it always matches the game.
- Public state (what the server broadcasts and logs each tick) holds
  everything needed to rebuild the env state exactly (state_from_public), so
  observations can be recomputed offline instead of being sent every step.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
'''

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import jax
import jax.numpy as jnp

from jaxmarl.environments.overcooked_v2.overcooked import OvercookedV2, State
from jaxmarl.environments.overcooked_v2.layouts import Layout, overcooked_v2_layouts
from jaxmarl.environments.overcooked_v2.common import StaticObject, Agent, Position, OvercookedActionsEnum as Actions, Direction
from jaxmarl.environments.overcooked_v2.settings import DELIVERY_REWARD

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


def is_file_layout(name: str) -> bool:
    return bool(LAYOUT_NAME_RE.match(name)) and (LAYOUT_DIR / f"{name}.txt").is_file()


def load_layout(name: str, num_agents: int) -> Tuple[Layout, bool]:
    """
    The V2 Layout for a group of num_agents, and whether its agents are already
    placed (file layouts: the first num_agents spawns). For a JaxMARL layout the
    env places them (num_agents=..., Layout.with_num_agents), as the sweep does.
    """
    if is_file_layout(name) or name not in overcooked_v2_layouts:
        rows, spawns = read_layout(name)  # also raises for unknown names
        if not 1 <= num_agents <= len(spawns):
            raise LayoutError(f"layout {name!r} seats 1-{len(spawns)} agents, not {num_agents}")
        # from_string needs at least one 'A'; positions are then replaced with ours (in fill order)
        grid = [list(r) for r in rows]
        x0, y0 = spawns[0]
        grid[y0][x0] = "A"
        layout = Layout.from_string("\n".join("".join(r) for r in grid), possible_recipes=CLASSIC_RECIPES)
        layout.agent_positions = list(spawns[:num_agents])
        return layout, True
    return overcooked_v2_layouts[name], False


def make_env(layout: Layout, max_steps: int, *, num_agents: int, agents_placed: bool,
             num_pots: Optional[int] = None, pot_placement: str = "nearest",
             pot_cook_time: Optional[int] = None, recipe_size: int = 3,
             order_size: Optional[int] = None, no_collision: bool = False) -> OvercookedV2:
    """Raises LayoutError if the layout can't take these settings (e.g. too many pots or agents)."""
    kwargs: Dict[str, Any] = dict(
        layout=layout,
        max_steps=max_steps,
        agent_view_size=None,              # full observability
        start_cooking_interaction=False,   # the pot cooks once it is full
        random_reset=False,
        random_agent_positions=False,      # fixed start positions, as in the order sweep
        num_agents=None if agents_placed else num_agents,
        num_pots=num_pots,
        pot_placement=pot_placement,
        recipe_size=recipe_size,
        order_size=order_size,
        no_collision=no_collision,
    )
    if pot_cook_time is not None:
        kwargs["pot_cook_time"] = pot_cook_time
    try:
        env = OvercookedV2(**kwargs)
    except ValueError as e:
        raise LayoutError(str(e)) from e
    if env.num_agents != num_agents:
        raise LayoutError(f"this layout can't seat {num_agents} agents")
    return env


def static_rows(env: OvercookedV2) -> List[str]:
    """The env's static grid as layout rows (W P O B X and floor), pots included."""
    so = np.asarray(env.layout.static_objects)
    rows = []
    for y in range(so.shape[0]):
        row = []
        for x in range(so.shape[1]):
            ch = STATIC_TO_CHAR.get(int(so[y, x]))
            if ch is None:
                raise LayoutError(f"unsupported object {int(so[y, x])} at ({x},{y}) (only onion soup is supported)")
            row.append(ch)
        rows.append("".join(row))
    return rows


def spec_fields(env: OvercookedV2, layout_name: str, rows: List[str], pot_placement: Optional[str] = None) -> Dict[str, Any]:
    """Overcooked-specific spec: what the client needs to draw and control the game."""
    recipes = np.asarray(env.layout.possible_recipes).tolist()
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
        recipes=recipes,
        directions=DIRECTION_LABELS,
        pot_cook_time=int(env.pot_cook_time),
        delivery_reward=DELIVERY_REWARD,
        start_cooking_interaction=False,
        # Sweep settings (num_pots counts the pots in the grid)
        recipe_size=int(env.recipe_size),
        order_size=None if env.order_size is None else int(env.order_size),
        num_pots=sum(r.count("P") for r in rows),
        pot_placement=pot_placement,
        no_collision=bool(env.no_collision),
    )


def to_public_state(env: OvercookedV2, state: State, episode_label: str) -> Dict[str, Any]:
    """
    Per-tick state. Lossless (see state_from_public). Items use the V2 bitfield:
    bit 0 plate, bit 1 cooked, bits 2-3 onion count (so 4 = onion, 12 = 3 onions,
    14 = cooked 3-onion soup in a pot, 15 = plated 3-onion soup; 1-onion soup:
    6 cooked, 7 plated). timer = pot cooking time left. delivered = correct
    soups served this episode (the order is complete at order_size).
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
        "delivered": int(s.num_delivered),
        "step": int(s.step),
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
    delivered = int(public.get("delivered", 0))
    order_done = env.order_size is not None and delivered >= env.order_size
    return State(
        agents=Agent(
            pos=Position(x=jnp.array([a["pos"][0] for a in agents], dtype=jnp.int32),
                         y=jnp.array([a["pos"][1] for a in agents], dtype=jnp.int32)),
            dir=jnp.array([a["dir"] for a in agents], dtype=jnp.int32),
            inventory=jnp.array([a["inv"] for a in agents], dtype=jnp.int32),
        ),
        grid=jnp.asarray(grid),
        step=jnp.int32(t),
        done=jnp.bool_(t >= env.max_steps or order_done),
        recipe=jnp.int32(public["recipe"]),
        new_correct_delivery=jnp.bool_(public["newCorrectDelivery"]),
        num_delivered=jnp.int32(delivered),
        ingredient_permutations=None,
    )
