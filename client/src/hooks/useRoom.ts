import { useContext } from "react";
import { RoomContext } from "../context/roomContext";

export const useRoom = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom must be used within a RoomProvider");
  }

  console.log("useRoom() called, context:", context);
  return context;
};