import { describe, it, expect } from "vitest";
import {
  BOT_STRATEGIES,
  createBotMemory,
  strategyFor,
} from "@/features/landGrab/botStrategy";
import {
  alignmentAxis,
  createInvaderMemory,
  invader,
  nearestLivingRival,
  nearestRivalTrailDistance,
  type InvaderMemory,
} from "@/features/landGrab/invaderStrategy";
import { DEFAULT_BOT_PROFILE, INVADER_PROFILE_FIELDS } from "@/features/landGrab/botProfile";
import { createEmptyGrid, type CellState } from "@/features/landGrab/grid";
import {
  createInitialGameState,
  setPlayerFacing,
  stepGame,
  type PlayerConfig,
  type PlayerState,
} from "@/features/landGrab/simulation";

/** Invader config with the jitter zeroed so crafted-scenario scoring is deterministic. */
function invaderConfig(id: string, color: number): PlayerConfig {
  return { id, label: id, color, isBot: true, botType: "invader", profile: { ...DEFAULT_BOT_PROFILE, jitter: 0 } };
}

function manhattan(a: { row: number; col: number }, b: { row: number; col: number }): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

describe("invader strategy registry", () => {
  it("is registered with a decide fn and a label", () => {
    expect(BOT_STRATEGIES.invader.type).toBe("invader");
    expect(BOT_STRATEGIES.invader.label).toBe("Invader");
    expect(BOT_STRATEGIES.invader.decide).toBeTypeOf("function");
    expect(strategyFor("invader")).toBe(BOT_STRATEGIES.invader);
    expect(strategyFor("invader")).toBe(invader);
  });

  it("exposes its own knob subset — the four raider fields, none of the surveyor's", () => {
    const keys = INVADER_PROFILE_FIELDS.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["engageDistance", "dodgeDistance", "cutSearchRadius", "commitLimit"]));
    expect(keys).not.toContain("homesickTrailLength");
    expect(keys).not.toContain("maxTrailExposure");
    expect(BOT_STRATEGIES.invader.fields).toBe(INVADER_PROFILE_FIELDS);
  });

  it("createBotMemory returns a fresh hunt-phase bag", () => {
    const mem = createBotMemory("invader");
    expect(mem).toEqual({
      type: "invader",
      phase: "hunt",
      targetId: null,
      axis: null,
      dodgeStepsLeft: 0,
      recent: [],
      commitTicks: 0,
    });
    expect(createBotMemory("invader")).not.toBe(createBotMemory("invader"));
  });
});

describe("alignmentAxis", () => {
  it("names the shared row or column", () => {
    expect(alignmentAxis({ row: 4, col: 1 }, { row: 4, col: 9 })).toBe("row");
    expect(alignmentAxis({ row: 1, col: 5 }, { row: 8, col: 5 })).toBe("col");
  });
  it("is null off a shared line and on the same cell", () => {
    expect(alignmentAxis({ row: 2, col: 3 }, { row: 5, col: 7 })).toBeNull();
    expect(alignmentAxis({ row: 4, col: 4 }, { row: 4, col: 4 })).toBeNull();
  });
});

describe("nearestLivingRival", () => {
  it("picks the closest living opponent head and ignores the dead", () => {
    const state = createInitialGameState(15, 15, [
      { id: "me", label: "Me", color: 1, isBot: true, botType: "invader" },
      { id: "near", label: "Near", color: 2, isBot: true },
      { id: "far", label: "Far", color: 3, isBot: true },
    ]);
    state.players.me.head = { row: 7, col: 7 };
    state.players.near.head = { row: 7, col: 10 };
    state.players.far.head = { row: 1, col: 1 };
    expect(nearestLivingRival(state, state.players.me)?.id).toBe("near");

    state.players.near.alive = false;
    expect(nearestLivingRival(state, state.players.me)?.id).toBe("far");
  });

  it("is null when nobody else is afloat", () => {
    const state = createInitialGameState(9, 9, [invaderConfig("solo", 1)]);
    expect(nearestLivingRival(state, state.players.solo)).toBeNull();
  });
});

describe("nearestRivalTrailDistance", () => {
  const grid: CellState[][] = createEmptyGrid(9, 9);
  grid[4][6] = { kind: "trail", playerId: "foe" };
  grid[0][0] = { kind: "trail", playerId: "me" }; // our own wake — must be ignored

  it("is 0 standing on a rival wake, and counts steps to it", () => {
    expect(nearestRivalTrailDistance(grid, "me", { row: 4, col: 6 })).toBe(0);
    expect(nearestRivalTrailDistance(grid, "me", { row: 4, col: 4 })).toBe(2);
  });

  it("ignores our own wake and gives up past the radius / off board", () => {
    expect(nearestRivalTrailDistance(grid, "me", { row: 1, col: 0 })).toBeGreaterThan(1); // routes to foe's, not ours
    expect(nearestRivalTrailDistance(grid, "me", { row: 8, col: 8 }, 3)).toBe(Infinity);
    expect(nearestRivalTrailDistance(grid, "me", { row: -1, col: 0 })).toBe(Infinity);
  });
});

describe("invader through the simulation", () => {
  it("stamps the botType and an invader memory bag onto the player", () => {
    const state = createInitialGameState(9, 9, [
      { id: "you", label: "You", color: 1, isBot: false },
      { id: "raider", label: "Raider", color: 2, isBot: true, botType: "invader" },
    ]);
    expect(state.players.raider.botType).toBe("invader");
    expect((state.players.raider.botMemory as InvaderMemory).type).toBe("invader");
  });

  it("closes the distance to a stationary rival while hunting", () => {
    const state0 = createInitialGameState(15, 15, [
      invaderConfig("inv", 1),
      { id: "dummy", label: "Dummy", color: 2, isBot: false }, // non-bot, never starts → sits still
    ]);
    let state = state0;
    const before = manhattan(state.players.inv.head, state.players.dummy.head);
    for (let i = 0; i < 8; i++) state = stepGame(state);
    const after = manhattan(state.players.inv.head, state.players.dummy.head);
    expect(state.players.inv.head).not.toEqual(state0.players.inv.head); // it moved
    expect(after).toBeLessThan(before); // …and toward the target
  });

  it("jukes off the approach axis instead of freezing in the head-on stand-off", () => {
    let state = createInitialGameState(9, 9, [
      invaderConfig("inv", 1),
      { id: "foe", label: "Foe", color: 2, isBot: false },
    ]);
    state = {
      ...state,
      players: {
        ...state.players,
        // Already lined up on row 4, two cells apart, driving at each other.
        inv: { ...state.players.inv, head: { row: 4, col: 3 }, facing: "right", queuedFacing: null, trail: [], hasStarted: true, botMemory: createInvaderMemory() },
        foe: { ...state.players.foe, head: { row: 4, col: 5 }, facing: "left", queuedFacing: null, trail: [], hasStarted: true },
      },
    };

    state = stepGame(state);

    const inv = state.players.inv;
    expect(inv.head.row).not.toBe(4); // stepped perpendicular — the juke
    expect(inv.head.col).toBe(3);
    expect((inv.botMemory as InvaderMemory).phase).toBe("dodge");
    expect((inv.botMemory as InvaderMemory).axis).toBe("row");
    expect(inv.alive).toBe(true);
    expect(state.players.foe.alive).toBe(true); // nobody captured in the face-off
  });

  it("takes the cut when a rival wake is under the next step", () => {
    let state = createInitialGameState(9, 9, [
      invaderConfig("inv", 1),
      { id: "foe", label: "Foe", color: 2, isBot: false },
    ]);
    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "neutral" })));
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) grid[r][c] = { kind: "territory", playerId: "inv" };
    for (const [r, c] of [[8, 7], [8, 8], [7, 7], [7, 8]]) grid[r][c] = { kind: "territory", playerId: "foe" };
    const foeTrail = [{ row: 4, col: 5 }, { row: 4, col: 6 }, { row: 4, col: 7 }];
    for (const { row, col } of foeTrail) grid[row][col] = { kind: "trail", playerId: "foe" };

    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        inv: { ...state.players.inv, home: { row: 0, col: 0 }, head: { row: 4, col: 4 }, facing: "right", queuedFacing: null, trail: [], hasStarted: true, botMemory: createInvaderMemory() },
        foe: { ...state.players.foe, home: { row: 8, col: 8 }, head: { row: 4, col: 7 }, facing: "right", queuedFacing: null, trail: [...foeTrail], hasStarted: true },
      },
    };

    state = stepGame(state); // inv: (4,4) -> (4,5), onto foe's wake

    expect(state.players.foe.alive).toBe(false);
    expect(state.players.foe.timesCaptured).toBe(1);
    expect(state.players.inv.captures).toBe(1);
    expect(state.players.inv.head).toEqual({ row: 4, col: 5 });
  });

  it("never deadlocks — a long invader-vs-surveyor match keeps advancing and stays finite", () => {
    let state = createInitialGameState(14, 14, [
      { id: "inv", label: "Inv", color: 1, isBot: true, botType: "invader" },
      { id: "surv", label: "Surv", color: 2, isBot: true, botType: "surveyor" },
    ]);
    for (let i = 0; i < 300 && !state.winnerId; i++) state = stepGame(state);

    for (const player of Object.values(state.players) as PlayerState[]) {
      expect(Number.isFinite(player.ownedCount)).toBe(true);
      expect(player.ownedCount).toBeGreaterThanOrEqual(0);
    }
    const mem = state.players.inv.botMemory as InvaderMemory;
    expect(["hunt", "dodge", "cut", "regroup"]).toContain(mem.phase);
    expect(state.tick > 0 || state.winnerId).toBeTruthy();
  });

  it("rebuilds the invader memory bag fresh on respawn", () => {
    let state = createInitialGameState(9, 9, [
      { id: "p1", label: "You", color: 1, isBot: false },
      invaderConfig("inv", 2),
    ], { respawnDelayTicks: 1 });
    const grid = state.grid.map((row) => row.slice());
    grid[0][1] = { kind: "trail", playerId: "inv" };
    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, head: { row: 0, col: 0 }, home: { row: 0, col: 0 }, trail: [], hasStarted: true },
        inv: { ...state.players.inv, head: { row: 5, col: 5 }, home: { row: 5, col: 5 }, trail: [{ row: 0, col: 1 }] },
      },
    };

    setPlayerFacing(state, "p1", "right");
    state = stepGame(state); // p1 cuts inv's trail — inv is sunk
    expect(state.players.inv.alive).toBe(false);
    const memoryWhileDead = state.players.inv.botMemory;

    for (let i = 0; i < 30 && !state.players.inv.alive; i++) state = stepGame(state);
    expect(state.players.inv.alive).toBe(true);
    const mem = state.players.inv.botMemory as InvaderMemory;
    expect(mem).not.toBe(memoryWhileDead); // a fresh bag, not the old ref
    expect(mem.type).toBe("invader");
    expect(mem.phase).toBe("hunt"); // re-armed to hunt, juke state cleared
    expect(mem.dodgeStepsLeft).toBe(0);
    expect(mem.axis).toBeNull();
  });
});
