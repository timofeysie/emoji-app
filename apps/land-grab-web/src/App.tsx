import { LandGrabDemo } from "./game/LandGrabDemo";
import { getGameServerUrl } from "./config";

export function App() {
  const gameServerUrl = getGameServerUrl();
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Emoji App Arcade</p>
          <h1>LandGrab</h1>
        </div>
        <span className="server-status">
          {gameServerUrl ? "Online server configured" : "Offline practice"}
        </span>
      </header>
      <p className="instructions">
        Use arrow keys, WASD, or swipe across the board. Close loops to claim
        territory and cut rival trails to capture them.
      </p>
      <LandGrabDemo />
    </main>
  );
}
