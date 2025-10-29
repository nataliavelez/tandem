import { useEffect, useRef, useState } from "react";
import type { ActionSpace } from "../../../shared/types";

export function useActionBinding(actionSpace: ActionSpace) {
  const noop = 0;
  const [current, setCurrent] = useState<number>(noop);
  const held = useRef(new Set<string>());
  const labels = actionSpace.labels ?? ["noop","left","right","down","up"];

  const keymap = useRef<Record<string, number>>({
    " ": 0, "0": 0,
    "arrowleft": labels.indexOf("left") >= 0 ? labels.indexOf("left") : 1,
    "a": labels.indexOf("left") >= 0 ? labels.indexOf("left") : 1,
    "arrowright": labels.indexOf("right") >= 0 ? labels.indexOf("right") : 2,
    "d": labels.indexOf("right") >= 0 ? labels.indexOf("right") : 2,
    "arrowdown": labels.indexOf("down") >= 0 ? labels.indexOf("down") : 3,
    "s": labels.indexOf("down") >= 0 ? labels.indexOf("down") : 3,
    "arrowup": labels.indexOf("up") >= 0 ? labels.indexOf("up") : 4,
    "w": labels.indexOf("up") >= 0 ? labels.indexOf("up") : 4,
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      const idx = keymap.current[k];
      if (idx !== undefined) { held.current.add(k); setCurrent(idx); }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      held.current.delete(k);
      setCurrent(
        held.current.size
          ? (keymap.current[[...held.current][held.current.size - 1]] ?? noop)
          : noop
      );
      // setCurrent(held.current.size ? (keymap.current[[...held.current].at(-1)!] ?? noop) : noop);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setCurrent(noop));
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  return current;
}
