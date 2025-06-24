import { useState } from "react";
import { RoomContext } from "./roomContext";

import type { ReactNode } from "react";

export const RoomProvider = ({ children }: { children: ReactNode }) => {
  const [roomId, setRoomId] = useState("default");

  return (
    <RoomContext.Provider value={{ roomId, setRoomId }}>
      {children}
    </RoomContext.Provider>
  );
};