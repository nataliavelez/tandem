import { useEffect, useRef, useState } from "react";
import type { ClientEvent, ServerEvent, PublicState, TrialSpec, AgentID } from "shared/types";
import { useSocket } from "../../hooks/useSocket";

type Props = {
  round: number;
  durationMs: number;
  assignedAgentId: AgentID;
  onNext: () => void;
};

function MpeCanvas({
  state,
  width = 600,
  height = 600,
}: {
  state: PublicState | null;
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const toPx = (x: number, axis: "x" | "y") =>
    axis === "x" ? ((x + 1) / 2) * width : height - ((x + 1) / 2) * height;

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;

    // clear bg
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // guard: only draw when the sim is running
    if (!state || state.phase !== "running") {
      // draw border so users see the canvas is alive
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
      return;
    }

    // border
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    // landmarks
    ctx.fillStyle = "#9CA3AF";
    state.landmarks.forEach((l) => {
      ctx.beginPath();
      ctx.arc(toPx(l.pos[0], "x"), toPx(l.pos[1], "y"), 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // agents
    const palette = ["#2dd4bf", "#60a5fa", "#f472b6", "#f59e0b", "#34d399", "#a78bfa"];
    const agentEntries = Object.entries(state.agents);
    agentEntries.forEach(([id, a], i) => {
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
      width={width}
      height={height}
      style={{ border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}
    />
  );
}

export function MpeTrial({ round, durationMs, assignedAgentId, onNext }: Props) {
  const { socket, addMessageListener, removeMessageListener } = useSocket();

  const [state, setState] = useState<PublicState | null>(null);
  const [spec, setSpec] = useState<TrialSpec | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!socket) return;
    const msg: ClientEvent = {
      type: "TRIAL_READY",
      trialId: `mpe-trial-${round}`,
      duration: Math.ceil(durationMs / 1000),
    };
    socket.send(JSON.stringify(msg));
  }, [socket, round, durationMs]);

  // Listen for server events
  useEffect(() => {
    const handle = (message: ServerEvent) => {
      if (message.type === "TRIAL_START") {
        setSpec(message.spec);
        const duration = message.duration ?? durationMs;
        const expectedEnd = message.startTimestamp + duration;

        const updateTime = () => {
          const now = Date.now();
          const remaining = Math.max(0, expectedEnd - now);
          setTimeLeft(Math.ceil(remaining / 1000));
        };
        if (timerRef.current) clearInterval(timerRef.current);
        updateTime();
        timerRef.current = window.setInterval(updateTime, 1000);
      }

      if (message.type === "STATE_UPDATE") {
        setState(message.state);
      }

      if (message.type === "TRIAL_END") {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setTimeLeft(null);
        onNext();
      }
    };

    addMessageListener(handle);
    return () => {
      removeMessageListener(handle);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [addMessageListener, removeMessageListener, onNext, durationMs]);

  // Keyboard controls unchanged...
  useEffect(() => {
    if (!socket || !spec) return;

    const labels = spec.action_space.labels ?? ["noop", "left", "right", "down", "up"];
    const idx = (name: string, fallback: number) => {
      const n = labels.indexOf(name);
      return n >= 0 ? n : fallback;
    };

    const keyToAction: Record<string, number> = {
      " ": idx("noop", 0),
      "0": 0,
      arrowleft: idx("left", 1),
      a: idx("left", 1),
      arrowright: idx("right", 2),
      d: idx("right", 2),
      arrowdown: idx("down", 3),
      s: idx("down", 3),
      arrowup: idx("up", 4),
      w: idx("up", 4),
    };

    const send = (action: number) => {
      const msg: ClientEvent = {
        type: "PLAYER_ACTION",
        agentId: assignedAgentId,
        action,
      };
      socket.send(JSON.stringify(msg));
    };

    const held = new Set<string>();

    const onDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      const a = keyToAction[k];
      if (a !== undefined) {
        e.preventDefault();
        held.add(k);
        send(a);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (held.has(k)) {
        held.delete(k);
        if (held.size === 0) send(0);
        else {
          const arr = Array.from(held);
          const last = arr.slice(-1)[0]!;
          const a = keyToAction[last];
          if (a !== undefined) send(a);
        }
      }
    };
    const onBlur = () => send(0);

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [socket, spec, assignedAgentId]);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h2 style={{ marginBottom: 8 }}>MPE — simple_spread (Round {round})</h2>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <MpeCanvas state={state} width={600} height={600} />
          {state && state.phase !== "running" && (
            <div style={{ marginTop: 8, color: "#6b7280" }}>
              Waiting for trial to start…
            </div>
          )}
        </div>

        <div style={{ minWidth: 260 }}>
          {timeLeft !== null && (
            <div
              style={{
                fontSize: "1.25rem",
                marginBottom: 12,
                color: timeLeft <= 5 ? "#ef4444" : "#111827",
                fontWeight: 700,
              }}
            >
              Time remaining: {timeLeft}s
            </div>
          )}

          <div
            style={{
              padding: 12,
              border: "1px dashed #d1d5db",
              borderRadius: 8,
              background: "#f9fafb",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Controls</div>
            <div style={{ color: "#374151", lineHeight: 1.6 }}>
              <div>Hold keys to act; release returns to <code>noop</code>.</div>
              <ul style={{ paddingLeft: 18, margin: "8px 0" }}>
                <li>Space/0 → noop</li>
                <li>← / A → left</li>
                <li>→ / D → right</li>
                <li>↓ / S → down</li>
                <li>↑ / W → up</li>
              </ul>
              {spec?.action_space?.labels && (
                <div>
                  Action labels:&nbsp;
                  <code>{spec.action_space.labels.join(" · ")}</code>
                </div>
              )}
            </div>
          </div>

          {spec && (
            <div style={{ marginTop: 12, color: "#6b7280", fontSize: 14 }}>
              Obs dim:&nbsp;<code>{spec.observation_shape[0]}</code>&nbsp;·&nbsp;Actions:&nbsp;
              <code>{spec.action_space.n}</code>&nbsp;·&nbsp;dt:&nbsp;<code>{spec.dt}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
