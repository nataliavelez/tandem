import { createContext } from "react";

export interface RoomContextType {
  roomId: string | null;
  setRoomId: (id: string) => void;
}

export const RoomContext = createContext<{
  roomId: string | null;
  setRoomId: (id: string) => void;
}>({
  roomId: null,
  setRoomId: () => {},
});
