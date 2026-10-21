{/*
Overcooked drawing primitives (simple shapes, no images), shared by the game
canvas and the legend so both always look the same.

Tiles are drawn at (x * size, y * size). Item codes are the server's
(see decodeItem in shared/types).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { decodeItem } from "shared/types";

export const OC_COLORS = {
  floor: "#efe9dc",
  floorLine: "#e0d6c2",
  counter: "#c49a6c",
  counterEdge: "#8a6239",
  crate: "#8a6239",
  pot: "#3f3f46",
  potRim: "#18181b",
  onion: "#e9b400",
  onionEdge: "#9a7700",
  plate: "#ffffff",
  plateEdge: "#9ca3af",
  soup: "#d9622b",
  cooking: "#f97316",
  ready: "#16a34a",
  delivery: "#2f9e44",
  ink: "#111111",
};

/** One color per cook (agent_0 .. agent_9); cooks also carry their number. */
export const AGENT_COLORS = [
  "#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e",
  "#17becf", "#e377c2", "#8c564b", "#bcbd22", "#393b79",
];

export const agentIndex = (agentId: string) => Number(agentId.split("_")[1]) || 0;
export const agentColor = (agentId: string) => AGENT_COLORS[agentIndex(agentId) % AGENT_COLORS.length];

const DIR_VEC: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], right: [1, 0], left: [-1, 0] };

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, stroke?: string, lw = 1) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function onion(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  circle(ctx, cx, cy, r, OC_COLORS.onion, OC_COLORS.onionEdge, Math.max(1, r * 0.18));
}

/** A static tile: ' ' floor, W counter, P pot, O onion pile, B plate pile, X delivery. */
export function drawTile(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, s: number) {
  const px = x * s, py = y * s, cx = px + s / 2, cy = py + s / 2;
  if (ch === " ") {
    ctx.fillStyle = OC_COLORS.floor;
    ctx.fillRect(px, py, s, s);
    ctx.strokeStyle = OC_COLORS.floorLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    return;
  }
  // Every non-floor cell is a counter, with its station on top
  ctx.fillStyle = OC_COLORS.counter;
  ctx.fillRect(px, py, s, s);
  ctx.strokeStyle = OC_COLORS.counterEdge;
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);

  if (ch === "P") {
    circle(ctx, cx, cy, s * 0.36, OC_COLORS.pot, OC_COLORS.potRim, s * 0.05);
  } else if (ch === "O") {
    ctx.fillStyle = OC_COLORS.crate;
    ctx.fillRect(px + s * 0.12, py + s * 0.12, s * 0.76, s * 0.76);
    const r = s * 0.14;
    onion(ctx, cx - s * 0.16, cy + s * 0.12, r);
    onion(ctx, cx + s * 0.16, cy + s * 0.12, r);
    onion(ctx, cx, cy - s * 0.14, r);
  } else if (ch === "B") {
    for (const dy of [0.1, 0, -0.1]) circle(ctx, cx, cy + dy * s, s * 0.28, OC_COLORS.plate, OC_COLORS.plateEdge, Math.max(1, s * 0.03));
  } else if (ch === "X") {
    ctx.fillStyle = OC_COLORS.delivery;
    ctx.fillRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(s * 0.2)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SERVE", cx, cy);
  }
}

/** A loose item (on a counter or held): onion, plate, or plated soup. r = plate radius. */
export function drawItem(ctx: CanvasRenderingContext2D, code: number, cx: number, cy: number, r: number) {
  if (!code) return;
  const { plate, cooked, ingredients } = decodeItem(code);
  const onions = ingredients[0] ?? 0;
  if (plate) {
    circle(ctx, cx, cy, r, OC_COLORS.plate, OC_COLORS.plateEdge, Math.max(1, r * 0.12));
    if (cooked) circle(ctx, cx, cy, r * 0.62, OC_COLORS.soup);
    return;
  }
  // Raw onion(s)
  const n = Math.max(1, onions);
  for (let i = 0; i < n; i++) onion(ctx, cx + (i - (n - 1) / 2) * r * 0.9, cy, r * 0.6);
}

/** A pot's contents on top of its tile: onions waiting, cooking progress, or a ready soup. */
export function drawPotContents(ctx: CanvasRenderingContext2D, code: number, timer: number, cookTime: number, x: number, y: number, s: number) {
  const cx = x * s + s / 2, cy = y * s + s / 2;
  const { cooked, ingredients } = decodeItem(code);
  const onions = ingredients[0] ?? 0;
  if (cooked) {
    circle(ctx, cx, cy, s * 0.26, OC_COLORS.soup);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = OC_COLORS.ready;
    ctx.lineWidth = s * 0.08;
    ctx.stroke();
  } else if (timer > 0) {
    circle(ctx, cx, cy, s * 0.26, "#f3b183");
    const done = 1 - timer / Math.max(1, cookTime);
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.42, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2);
    ctx.strokeStyle = OC_COLORS.cooking;
    ctx.lineWidth = s * 0.08;
    ctx.stroke();
  } else {
    for (let i = 0; i < onions; i++) onion(ctx, cx + (i - (onions - 1) / 2) * s * 0.2, cy, s * 0.09);
  }
}

/** A cook: colored disc with its number, a pointer for the way it faces, and what it holds. */
export function drawAgent(
  ctx: CanvasRenderingContext2D,
  opts: { x: number; y: number; s: number; color: string; label: string; dir: string; inv: number; isYou: boolean; active: boolean },
) {
  const { x, y, s, color, label, dir, inv, isYou, active } = opts;
  const cx = x * s + s / 2, cy = y * s + s / 2, r = s * 0.32;
  const [vx, vy] = DIR_VEC[dir] ?? [0, -1];
  ctx.save();
  if (!active) ctx.globalAlpha = 0.35; // seat empty (player dropped out): cook stays, greyed out

  // Facing pointer
  ctx.beginPath();
  ctx.moveTo(cx + vx * (r + s * 0.15), cy + vy * (r + s * 0.15));
  ctx.lineTo(cx + vx * r * 0.7 - vy * s * 0.14, cy + vy * r * 0.7 + vx * s * 0.14);
  ctx.lineTo(cx + vx * r * 0.7 + vy * s * 0.14, cy + vy * r * 0.7 - vx * s * 0.14);
  ctx.closePath();
  ctx.fillStyle = OC_COLORS.ink;
  ctx.fill();

  if (isYou) circle(ctx, cx, cy, r + s * 0.07, "#ffffff", OC_COLORS.ink, s * 0.06);
  circle(ctx, cx, cy, r, color, OC_COLORS.ink, Math.max(1, s * 0.025));
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(s * 0.3)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);

  // Held item as a badge at the cook's upper right
  if (inv) drawItem(ctx, inv, cx + s * 0.26, cy - s * 0.26, s * 0.15);

  if (isYou) {
    ctx.font = `bold ${Math.round(s * 0.24)}px system-ui, sans-serif`;
    ctx.lineWidth = s * 0.07;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText("YOU", cx, cy - r - s * 0.16);
    ctx.fillStyle = OC_COLORS.ink;
    ctx.fillText("YOU", cx, cy - r - s * 0.16);
  }
  ctx.restore();
}
