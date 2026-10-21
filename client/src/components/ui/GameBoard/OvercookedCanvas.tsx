{/*
Overcooked kitchen: static layout from the spec, then pots/items and cooks
from the latest running state. Your own cook is ringed and labeled YOU;
cooks whose player dropped out are greyed out (they stay where they are).

Also exports OvercookedLegend: the same shapes, labeled, for the side panel.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect, useRef } from "react";
import type { AgentID, OvercookedRunningState, OvercookedTrialSpec } from "shared/types";
import { drawAgent, drawItem, drawPotContents, drawTile, agentColor, agentIndex } from "./overcookedDraw";

/** Pixel size of one tile so the kitchen fits in maxWidth x maxHeight (leaves room for the legend on a 720px-tall screen). */
function tileSize(spec: OvercookedTrialSpec, maxWidth = 720, maxHeight = 480) {
  const s = Math.floor(Math.min(maxWidth / spec.layout.width, maxHeight / spec.layout.height));
  return Math.max(24, Math.min(72, s));
}

/** A canvas sized in CSS pixels, drawn at the screen's pixel density. */
function useHiDpiCanvas(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(width * dpr)) canvas.width = Math.floor(width * dpr);
    if (canvas.height !== Math.floor(height * dpr)) canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx);
  });
  return ref;
}

type Props = {
  spec: OvercookedTrialSpec;
  state: OvercookedRunningState | null;
  myAgentId: AgentID | null;
};

export function OvercookedCanvas({ spec, state, myAgentId }: Props) {
  const s = tileSize(spec);
  const { width, height, rows } = spec.layout;

  const ref = useHiDpiCanvas(width * s, height * s, (ctx) => {
    rows.forEach((row, y) => [...row].forEach((ch, x) => drawTile(ctx, ch, x, y, s)));
    if (!state) return;

    for (const { pos: [x, y], item, timer } of state.items) {
      if (rows[y]?.[x] === "P") drawPotContents(ctx, item, timer, spec.pot_cook_time, x, y, s);
      else drawItem(ctx, item, x * s + s / 2, y * s + s / 2, s * 0.3);
    }

    // Your cook last, so its marker is never covered
    const entries = Object.entries(state.agents).sort(([a], [b]) => Number(a === myAgentId) - Number(b === myAgentId));
    for (const [id, a] of entries) {
      drawAgent(ctx, {
        x: a.pos[0], y: a.pos[1], s,
        color: agentColor(id),
        label: String(agentIndex(id) + 1),
        dir: spec.directions[a.dir] ?? "up",
        inv: a.inv,
        isYou: id === myAgentId,
        active: a.isHuman,
      });
    }
  });

  return <canvas ref={ref} style={{ borderRadius: 6, display: "block" }} />;
}

/** One small labeled tile for the legend. */
function LegendTile({ label, draw }: { label: string; draw: (ctx: CanvasRenderingContext2D, s: number) => void }) {
  const s = 34;
  const ref = useHiDpiCanvas(s, s, (ctx) => draw(ctx, s));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <canvas ref={ref} style={{ borderRadius: 4, flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  );
}

export function OvercookedLegend({ potCookTime }: { potCookTime: number }) {
  const ONION = 4, PLATE = 1, SOUP = 15, POT_FULL = 12, POT_READY = 14;
  const onFloor = (code: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    drawTile(ctx, " ", 0, 0, s);
    drawItem(ctx, code, s / 2, s / 2, s * 0.3);
  };
  const pot = (code: number, timer: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    drawTile(ctx, "P", 0, 0, s);
    drawPotContents(ctx, code, timer, potCookTime, 0, 0, s);
  };
  const tile = (ch: string) => (ctx: CanvasRenderingContext2D, s: number) => drawTile(ctx, ch, 0, 0, s);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, auto)", gap: "6px 14px", fontSize: 13, justifyContent: "start" }}>
      <LegendTile label="Onions" draw={tile("O")} />
      <LegendTile label="Onion" draw={onFloor(ONION)} />
      <LegendTile label="Plates" draw={tile("B")} />
      <LegendTile label="Plate" draw={onFloor(PLATE)} />
      <LegendTile label="Pot, 2 onions" draw={pot(8, 0)} />
      <LegendTile label="Pot, cooking" draw={pot(POT_FULL, Math.ceil(potCookTime / 2))} />
      <LegendTile label="Soup ready" draw={pot(POT_READY, 0)} />
      <LegendTile label="Soup on plate" draw={onFloor(SOUP)} />
      <LegendTile label="Serve here" draw={tile("X")} />
      <LegendTile label="Counter" draw={tile("W")} />
    </div>
  );
}
