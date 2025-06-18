import { useEffect, useState, useRef } from "react";
import type { ClientEvent, ServerEvent, GameState } from "../../shared/types";
import { GameBoard } from "./components/GameBoard";

function App() {
  const [state, setState] = useState<GameState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("Connected to server.");
    };

    socket.onmessage = (event) => {
      const message: ServerEvent = JSON.parse(event.data);
      if (message.type === "STATE_UPDATE") {
        setState(message.state);
      }
    };

    socket.onclose = () => {
      console.log("Disconnected from server.");
    };

    return () => {
      socket.close();
    };
  }, []);

  const move = (direction: "up" | "down" | "left" | "right") => {
    const message: ClientEvent = { type: "MOVE", direction };
    socketRef.current?.send(JSON.stringify(message));
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>React WebSocket Client</h1>

      <div>
        <button onClick={() => move("up")}>↑</button>
        <div>
          <button onClick={() => move("left")}>←</button>
          <button onClick={() => move("down")}>↓</button>
          <button onClick={() => move("right")}>→</button>
        </div>
      </div>

      {state && <GameBoard state={state} localPlayerId={"p1"} />}

    </div>
  );
}

export default App;