import { describe, it, expect } from "vitest";
import {
  BOT_STRATEGIES,
  createBotMemory,
  strategyFor,
} from "@/features/landGrab/botStrategy";
import {
  createSurveyorMemory,
  estimateEnclosedArea,
  isFrontierAdjacent,
  nearestNeutralDistance,
  nearestOwnedDistance,
  nearestRivalHeadDistance,
  surveyor,
} from "@/features/landGrab/surveyorStrategy";
import { SURVEYOR_PROFILE_FIELDS } from "@/features/landGrab/botProfile";
import { createEmptyGrid, type CellState } from "@/features/landGrab/grid";
import {
  createInitialGameState,
  stepGame,
  type PlayerConfig,
} from "@/features/landGrab/simulation";

function gridWith(rows: number, cols: number, cells: Record<string, CellState>): CellState[][] {
  const grid = createEmptyGrid(rows, cols);
  for (const [rc, cell] of Object.entries(cells)) {
    const [r, c] = rc.split(",").map(Number);
    grid[r][c] = cell;
  }
  return grid;
}

describe("nearestOwnedDistance", () => {
  const grid = gridWith(6, 6, {
    "2,2": { kind: "territory", playerId: "p1" },
    "0,5": { kind: "territory", playerId: "p2" },
  });

  it("is 0 on an owned cell", () => {
    expect(nearestOwnedDistance(grid, "p1", { row: 2, col: 2 })).toBe(0);
  });

  it("counts 4-connected steps out to the nearest owned cell", () => {
    expect(nearestOwnedDistance(grid, "p1", { row: 2, col: 3 })).toBe(1);
    expect(nearestOwnedDistance(grid, "p1", { row: 4, col: 2 })).toBe(2);
    expect(nearestOwnedDistance(grid, "p1", { row: 0, col: 0 })).toBe(4);
  });

  it("ignores other players' territory", () => {
    expect(nearestOwnedDistance(grid, "p1", { row: 0, col: 5 })).toBe(5); // routes to p1's cell, not p2's
  });

  it("returns Infinity past the radius cap or off the board", () => {
    expect(nearestOwnedDistance(grid, "p1", { row: 0, col: 0 }, 3)).toBe(Infinity);
    expect(nearestOwnedDistance(grid, "p1", { row: -1, col: 0 })).toBe(Infinity);
    expect(nearestOwnedDistance(grid, "nobody", { row: 0, col: 0 })).toBe(Infinity);
  });
});

describe("nearestNeutralDistance", () => {
  // A 5x5 blob of p1 territory in the middle of a 9x9 board, everything else neutral.
  const grid = createEmptyGrid(9, 9);
  for (let r = 2; r <= 6; r++) {
    for (let c = 2; c <= 6; c++) grid[r][c] = { kind: "territory", playerId: "p1" };
  }

  it("is 0 on a neutral cell", () => {
    expect(nearestNeutralDistance(grid, { row: 0, col: 0 })).toBe(0);
  });

  it("counts steps out of a blob to the nearest open water", () => {
    expect(nearestNeutralDistance(grid, { row: 2, col: 4 })).toBe(1); // blob edge
    expect(nearestNeutralDistance(grid, { row: 4, col: 4 })).toBe(3); // blob centre
  });

  it("returns Infinity past the radius cap or off the board", () => {
    expect(nearestNeutralDistance(grid, { row: 4, col: 4 }, 2)).toBe(Infinity);
    expect(nearestNeutralDistance(grid, { row: -1, col: 0 })).toBe(Infinity);
  });
});

describe("isFrontierAdjacent", () => {
  const grid = gridWith(6, 6, {
    "2,2": { kind: "territory", playerId: "p1" },
    "4,4": { kind: "territory", playerId: "p2" },
    "0,0": { kind: "trail", playerId: "p1" },
  });

  it("is true for neutral water touching our own territory", () => {
    expect(isFrontierAdjacent(grid, "p1", { row: 2, col: 3 })).toBe(true);
    expect(isFrontierAdjacent(grid, "p1", { row: 1, col: 2 })).toBe(true);
  });

  it("is false in open water", () => {
    expect(isFrontierAdjacent(grid, "p1", { row: 0, col: 3 })).toBe(false);
  });

  it("is false when only a rival's territory is adjacent", () => {
    expect(isFrontierAdjacent(grid, "p1", { row: 4, col: 3 })).toBe(false);
  });

  it("is false for a non-neutral cell", () => {
    expect(isFrontierAdjacent(grid, "p1", { row: 2, col: 2 })).toBe(false); // our territory
    expect(isFrontierAdjacent(grid, "p1", { row: 0, col: 0 })).toBe(false); // our trail
  });
});

describe("estimateEnclosedArea", () => {
  it("is 1 for an empty wake", () => {
    expect(estimateEnclosedArea([], { row: 3, col: 3 })).toBe(1);
  });

  it("is the bounding-box area spanned by the wake plus the head", () => {
    const trail = [
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 2, col: 3 },
    ];
    // rows 1..3, cols 1..3 → 3 x 3
    expect(estimateEnclosedArea(trail, { row: 3, col: 3 })).toBe(9);
  });
});

describe("nearestRivalHeadDistance", () => {
  it("is the Manhattan distance to the closest living rival head", () => {
    const state = createInitialGameState(12, 12, [
      { id: "a", label: "A", color: 1, isBot: true, botType: "surveyor" },
      { id: "b", label: "B", color: 2, isBot: true },
      { id: "c", label: "C", color: 3, isBot: true },
    ]);
    state.players.a.head = { row: 0, col: 0 };
    state.players.b.head = { row: 0, col: 3 };
    state.players.c.head = { row: 5, col: 5 };
    expect(nearestRivalHeadDistance(state, state.players.a)).toBe(3);
  });

  it("skips dead rivals and returns Infinity when alone", () => {
    const state = createInitialGameState(12, 12, [
      { id: "a", label: "A", color: 1, isBot: true, botType: "surveyor" },
      { id: "b", label: "B", color: 2, isBot: true },
    ]);
    state.players.a.head = { row: 0, col: 0 };
    state.players.b.head = { row: 0, col: 2 };
    expect(nearestRivalHeadDistance(state, state.players.a)).toBe(2);
    state.players.b.alive = false;
    expect(nearestRivalHeadDistance(state, state.players.a)).toBe(Infinity);
  });
});

describe("surveyor registry wiring", () => {
  it("is registered under its type with a human-readable label", () => {
    expect(BOT_STRATEGIES.surveyor).toBe(surveyor);
    expect(surveyor.type).toBe("surveyor");
    expect(surveyor.label).toBe("Surveyor");
    expect(strategyFor("surveyor")).toBe(surveyor);
  });

  it("renders its own field subset — the four knobs, minus the rambler's homesick length", () => {
    expect(surveyor.fields).toBe(SURVEYOR_PROFILE_FIELDS);
    const keys = surveyor.fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(["maxTrailExposure", "targetTrailLength", "frontierHugBonus", "rivalAvoidRadius"]),
    );
    expect(keys).not.toContain("homesickTrailLength");
  });

  it("createBotMemory returns a fresh, tagged surveyor bag", () => {
    expect(createBotMemory("surveyor")).toEqual({ type: "surveyor", phase: "extend", recent: [], stuckTicks: 0, loopCount: 0, aim: null });
    expect(createSurveyorMemory()).not.toBe(createSurveyorMemory());
  });
});

describe("surveyor through the simulation", () => {
  it("stamps the botType and a surveyor memory bag onto the player", () => {
    const state = createInitialGameState(14, 14, [
      { id: "you", label: "You", color: 1, isBot: false },
      { id: "bot", label: "Bot", color: 2, isBot: true, botType: "surveyor" },
    ]);
    expect(state.players.bot.botType).toBe("surveyor");
    expect(state.players.bot.botMemory).toEqual({ type: "surveyor", phase: "extend", recent: [], stuckTicks: 0, loopCount: 0, aim: null });
  });

  it("drives the bot each tick, keeps it alive, and grows its territory", () => {
    const configs: PlayerConfig[] = [
      { id: "surv", label: "Surveyor", color: 1, isBot: true, botType: "surveyor" },
      { id: "roam", label: "Rambler", color: 2, isBot: true, botType: "rambler" },
    ];
    let state = createInitialGameState(18, 18, configs, { respawnDelayTicks: 4 });
    const startOwned = state.players.surv.ownedCount;
    const seenHeads = new Set<string>();
    let peakOwned = startOwned;
    // `botMemory` is rebuilt fresh (loopCount back to 0) on every respawn, so a
    // Surveyor that banks a loop and is later sunk by the Rambler would read back
    // `loopCount === 0` at the end even though it plainly looped — track the max
    // seen across the run instead of trusting the final snapshot.
    let maxLoopCount = 0;

    for (let i = 0; i < 300 && !state.winnerId; i++) {
      state = stepGame(state);
      seenHeads.add(`${state.players.surv.head.row},${state.players.surv.head.col}`);
      peakOwned = Math.max(peakOwned, state.players.surv.ownedCount);
      maxLoopCount = Math.max(maxLoopCount, (state.players.surv.botMemory as { loopCount: number }).loopCount);
    }

    expect(seenHeads.size).toBeGreaterThan(8); // moved around on its own
    expect(peakOwned).toBeGreaterThan(startOwned); // closed at least one loop along the way
    const mem = state.players.surv.botMemory as { phase: string; loopCount: number };
    expect(["extend", "return"]).toContain(mem.phase);
    expect(maxLoopCount).toBeGreaterThanOrEqual(1); // banked at least one loop
    for (const p of Object.values(state.players)) {
      expect(Number.isFinite(p.ownedCount)).toBe(true);
    }
  });

  it("sweeps different sectors instead of re-tracing one spike", () => {
    let state = createInitialGameState(15, 15, [
      { id: "surv", label: "Surveyor", color: 1, isBot: true, botType: "surveyor" },
    ]);
    const startOwned = state.players.surv.ownedCount;
    let peakOwned = startOwned;
    for (let i = 0; i < 800 && !state.winnerId; i++) {
      state = stepGame(state);
      peakOwned = Math.max(peakOwned, state.players.surv.ownedCount);
    }
    const mem = state.players.surv.botMemory as { loopCount: number };
    expect(mem.loopCount).toBeGreaterThanOrEqual(4); // many loops
    // The old fixed-spike bug grew ~1-2 cells per loop; a real sweep grows fast.
    expect(peakOwned).toBeGreaterThan(startOwned + 40);
  });

  it("grows two surveyors toward each other so a bot-only match resolves", () => {
    const configs: PlayerConfig[] = [
      { id: "s1", label: "S1", color: 1, isBot: true, botType: "surveyor" },
      { id: "s2", label: "S2", color: 2, isBot: true, botType: "surveyor" },
    ];
    let state = createInitialGameState(13, 13, configs, { respawnDelayTicks: 6 });
    let closest = Infinity;
    let i = 0;
    for (; i < 2500 && !state.winnerId; i++) {
      state = stepGame(state);
      const a = state.players.s1;
      const b = state.players.s2;
      if (a.alive && b.alive) {
        closest = Math.min(closest, Math.abs(a.head.row - b.head.row) + Math.abs(a.head.col - b.head.col));
      }
    }
    // Old behaviour: each bot farmed its own corner spike forever and the two
    // never met. Now they push toward the centre → contact → the match ends.
    expect(state.winnerId).not.toBeNull();
    expect(closest).toBeLessThan(6);
  });

  it("never settles into a two-cell toggle (the reported bug)", () => {
    // Two surveyors + a rambler on a normal board, run long enough for the blobs
    // to grow and crowd each surveyor. A toggling bot would revisit the same 1-2
    // cells; assert every 8-tick window of head positions spans at least 3 cells.
    const configs: PlayerConfig[] = [
      { id: "s1", label: "S1", color: 1, isBot: true, botType: "surveyor" },
      { id: "s2", label: "S2", color: 2, isBot: true, botType: "surveyor" },
      { id: "r1", label: "R1", color: 3, isBot: true, botType: "rambler" },
    ];
    let state = createInitialGameState(16, 20, configs, { respawnDelayTicks: 6 });
    const heads: Record<string, string[]> = { s1: [], s2: [] };

    for (let i = 0; i < 600 && !state.winnerId; i++) {
      state = stepGame(state);
      for (const id of ["s1", "s2"]) {
        const player = state.players[id];
        if (player.alive) heads[id].push(`${player.head.row},${player.head.col}`); // ignore respawn waits
      }
    }

    for (const id of ["s1", "s2"]) {
      const seq = heads[id];
      expect(seq.length).toBeGreaterThan(80); // it stayed alive and moving for most of the run
      let worst = Infinity;
      for (let i = 0; i + 8 <= seq.length; i++) {
        worst = Math.min(worst, new Set(seq.slice(i, i + 8)).size);
      }
      expect(worst).toBeGreaterThanOrEqual(3); // no 8-move stretch pinned to two cells
    }
  });

  it("keeps a lone surveyor roaming a wide, roughly monotone spread of cells", () => {
    let state = createInitialGameState(14, 14, [
      { id: "surv", label: "Surveyor", color: 1, isBot: true, botType: "surveyor" },
    ]);
    const seenHeads = new Set<string>();
    for (let i = 0; i < 200 && !state.winnerId; i++) {
      state = stepGame(state);
      seenHeads.add(`${state.players.surv.head.row},${state.players.surv.head.col}`);
    }
    expect(seenHeads.size).toBeGreaterThan(20);
  });
});
