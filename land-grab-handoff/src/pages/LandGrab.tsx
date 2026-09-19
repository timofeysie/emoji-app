import { ChevronRight, Gamepad2, GitBranch, Scissors, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { LandGrabDemo } from "@/features/landGrab";
import { NoteDocument } from "@/features/notes";
import planDoc from "../../docs/land-grab/land-grab.md?raw";

const LandGrab = () => {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-primary font-medium mb-3">
          <Gamepad2 className="w-4 h-4" />
          Phase 0 prototype
        </div>
        <h2 className="text-4xl font-bold tracking-tight mb-4 text-foreground">Land Grab</h2>
        <LandGrabDemo />
        <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
          A territory game where the capture and elimination rules{" "}
          <strong className="text-foreground">are</strong> the DFS/BFS solution from{" "}
          <Link to="/dfs" className="text-primary hover:underline">
            Number of Islands
          </Link>
          , not just a visualization of it. Local play only for now: you vs. three bots.
        </p>
      </div>

      <section className="mb-2">
        <details className="group rounded-lg border border-border bg-muted/20 overflow-hidden" open>
          <summary className="flex items-center gap-2 list-none cursor-pointer px-4 py-3 text-muted-foreground hover:bg-muted/40 transition-colors [&::-webkit-details-marker]:hidden">
            <ChevronRight className="w-4 h-4 shrink-0 text-primary transition-transform group-open:rotate-90" aria-hidden />
            <Gamepad2 className="w-5 h-5 shrink-0 text-primary" aria-hidden />
            <span className="font-semibold text-foreground">Play</span>
          </summary>
          <div className="px-4 pb-4 pt-0 border-t border-border">
            <div className="pt-4 space-y-4">
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>
                  <strong className="text-foreground">Arrow keys or WASD</strong> steer your cyan boat.
                </li>
                <li>Sail off your own territory and you leave a trail behind you.</li>
                <li>Sail back into your own territory to close the loop — the trail and everything it encircled becomes yours (even a chunk of a bot's land, if your loop swallows it whole). Crossing your own trail does nothing on its own; you have to make it all the way home.</li>
                <li>Cut a <em>bot's</em> trail and you capture the lot: its wake, your wake, and <strong className="text-foreground">every cell it owned</strong> all turn cyan in one connected stretch, and the bot must respawn. A bot that cuts your trail takes yours the same way.</li>
                <li>
                  <strong className="text-foreground">Pause</strong> (Space) and open{" "}
                  <strong className="text-foreground">Profiles</strong> to inspect and live-tweak each bot's decision
                  variables — or hand your own boat to the bot AI with <strong className="text-foreground">Autopilot</strong>.
                </li>
                <li>
                  The match ends when one boat owns the whole board (the rest stuck on “respawning…”). A dialog shows the
                  winner and stats, and the result is saved to this browser (<code>landgrab:game-records</code>).
                </li>
              </ul>
            </div>
          </div>
        </details>
      </section>

      <section className="mb-2">
        <details className="group rounded-lg border border-border bg-muted/20 overflow-hidden">
          <summary className="flex items-center gap-2 list-none cursor-pointer px-4 py-3 text-muted-foreground hover:bg-muted/40 transition-colors [&::-webkit-details-marker]:hidden">
            <ChevronRight className="w-4 h-4 shrink-0 text-primary transition-transform group-open:rotate-90" aria-hidden />
            <GitBranch className="w-5 h-5 shrink-0 text-primary" aria-hidden />
            <span className="font-semibold text-foreground">How the algorithm powers the game</span>
          </summary>
          <div className="px-4 pb-4 pt-0 border-t border-border">
            <div className="grid gap-4 sm:grid-cols-2 pt-4">
              <div className="bg-card border border-border rounded-lg p-5">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold mb-3">
                  1
                </span>
                <h4 className="font-semibold mb-1 text-foreground">Capture = flood fill from the border</h4>
                <p className="text-sm text-muted-foreground">
                  Same base-case-then-recurse shape as <code className="text-code-keyword">depthFirstSearch(row, col)</code>{" "}
                  in the Number of Islands doc, but seeded from the grid's edge instead of a land cell. Whatever the flood{" "}
                  <em>can't</em> reach — and isn't your own trail/territory — was enclosed by your loop, and becomes yours.
                </p>
              </div>
              <div className="bg-card border border-border rounded-lg p-5">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold mb-3">
                  <Scissors className="w-4 h-4" aria-hidden />
                </span>
                <h4 className="font-semibold mb-1 text-foreground">Cuts = numIslands, restricted to one player</h4>
                <p className="text-sm text-muted-foreground">
                  When a capture swallows the middle of an opponent's land, their remaining cells can split into more than
                  one connected component. That's <code className="text-code-keyword">numIslands</code>'s scan-and-sink
                  loop again, run only over their cells: keep the component touching their home, strip the rest.
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              See <Link to="/dfs" className="text-primary hover:underline">the DFS page</Link> for the reference
              algorithm this is built on, and the "Full design doc" section below for the multiplayer architecture
              this prototype is phase 0 of.
            </p>
          </div>
        </details>
      </section>

      <section className="mb-2">
        <details className="group rounded-lg border border-border bg-muted/20 overflow-hidden">
          <summary className="flex items-center gap-2 list-none cursor-pointer px-4 py-3 text-muted-foreground hover:bg-muted/40 transition-colors [&::-webkit-details-marker]:hidden">
            <ChevronRight className="w-4 h-4 shrink-0 text-primary transition-transform group-open:rotate-90" aria-hidden />
            <BookOpen className="w-5 h-5 shrink-0 text-primary" aria-hidden />
            <span className="font-semibold text-foreground">Full design doc</span>
          </summary>
          <div className="px-4 pb-4 pt-0 border-t border-border">
            <div className="pt-4">
              <NoteDocument content={planDoc} />
            </div>
          </div>
        </details>
      </section>
    </div>
  );
};

export default LandGrab;
