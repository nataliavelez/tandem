import { RoomProvider } from "./context/RoomProvider";
import { SocketProvider } from "./context/SocketProvider";
import { TrialEngine } from "./components/engine/TrialEngine";
import { expTimeline } from "./scripts/expTimeline";

function App() {
  return (
    <RoomProvider>
      <SocketProvider>
        <TrialEngine timeline={expTimeline} />
      </SocketProvider>
    </RoomProvider>
  );
}

export default App;
