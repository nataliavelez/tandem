import { SocketProvider } from "./context/SocketProvider";
import { TrialEngine } from "./components/engine/TrialEngine";
import { expTimeline } from "./scripts/expTimeline";

function App() {
  return (
    <SocketProvider>
      <TrialEngine timeline={expTimeline} />
    </SocketProvider>
  );
}

export default App;
