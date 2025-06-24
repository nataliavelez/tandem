import { createContext } from "react";

export interface RoomContextType {
  roomId: string;
  setRoomId: (id: string) => void;
}

export const RoomContext = createContext<RoomContextType>({
  roomId: "",
  setRoomId: () => { console.warn("setRoomId called without provider") }
});