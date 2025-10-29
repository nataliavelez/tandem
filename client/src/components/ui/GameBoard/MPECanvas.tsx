{/*
MPE visualizations.

Created by: Elizabeth Mieczkowski, Updated: 10/2025
*/}

import { useEffect, useRef } from "react";
import type { PublicState } from "shared/types"; 

type Props = {
  state: PublicState | null;
  width?: number;
  height?: number;
};

export function MpeCanvas({ state, width = 600, height = 600 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const toPx = (x: number, axis: "x" | "y") =>
    axis === "x" ? ((x + 1) / 2) * width : height - ((x + 1) / 2) * height;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); 
  }, [width, height]);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;

    // Clear & background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    // Only draw scene when running
    if (!state || state.phase !== "running") return;

    // Draw landmarks
    ctx.fillStyle = "#9CA3AF";
    for (const l of state.landmarks) {
      ctx.beginPath();
      ctx.arc(toPx(l.pos[0], "x"), toPx(l.pos[1], "y"), 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw agents
    const palette = ["#2dd4bf", "#60a5fa", "#f472b6", "#f59e0b", "#34d399", "#a78bfa"];
    const entries = Object.entries(state.agents);
    entries.forEach(([id, a], i) => {
      const x = toPx(a.pos[0], "x");
      const y = toPx(a.pos[1], "y");

      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = palette[i % palette.length];
      ctx.fill();

      if (a.vel) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + a.vel[0] * 20, y - a.vel[1] * 20);
        ctx.strokeStyle = "#11182755";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // label & reward
      ctx.fillStyle = "#111827";
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(id, x + 12, y - 12);
      if (typeof a.reward === "number") {
        ctx.fillStyle = "#374151";
        ctx.fillText(a.reward.toFixed(2), x + 12, y + 4);
      }
    });
  }, [state, width, height]);

  return (
    <canvas
      ref={ref}
      style={{ border: "1px solid #eee", borderRadius: 8, background: "#fff" }}
    />
  );
}

