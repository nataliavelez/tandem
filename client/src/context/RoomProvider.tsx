import { useState } from "react";
import { RoomContext } from "./roomContext";

import type { ReactNode } from "react";

export const RoomProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [roomId, setRoomId] = useState<string | null>(null);

  return (
    <RoomContext.Provider value={{ roomId, setRoomId }}>
      {children}
    </RoomContext.Provider>
  );
};
