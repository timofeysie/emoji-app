import { describe, it, expect } from "vitest";
import { createInitialGameState, setPlayerFacing, stepGame, type PlayerConfig } from "@/features/landGrab/simulation";
import type { CellState } from "@/features/landGrab/grid";
import type { Direction } from "@/features/landGrab/types";

const HUMAN: PlayerConfig = { id: "p1", label: "You", color: 0x38bdf8, isBot: false };

// Home spots are randomized in production; pin the "random" pick to its lowest
// value so these tests get the same deterministic home every run.
const ZERO_RNG = () => 0;

describe("createInitialGameState", () => {
  it("places a 3x3 base per player and counts it", () => {
    const state = createInitialGameState(7, 7, [HUMAN], undefined, ZERO_RNG);
    expect(state.players.p1.ownedCount).toBe(9);
    expect(state.players.p1.home).toEqual({ row: 2, col: 2 });
    expect(state.players.p1.alive).toBe(true);
  });

  it("seeds the high-water mark and per-player counters", () => {
    const state = createInitialGameState(7, 7, [HUMAN]);
    expect(state.players.p1.peakOwnedCount).toBe(9); // == the opening base
    expect(state.players.p1.captures).toBe(0);
    expect(state.players.p1.timesCaptured).toBe(0);
  });
});

describe("stepGame — a full capture loop", () => {
  it("walking a loop back into home territory converts the trail plus the enclosed pocket", () => {
    let state = createInitialGameState(7, 7, [HUMAN], undefined, ZERO_RNG);
    expect(state.players.p1.ownedCount).toBe(9);

    // From home (2,2): exit the base, trace a loop that pinches off a 2-cell
    // pocket at (1,4)/(2,4), then re-enter home territory at (3,3) to close it.
    const path: Direction[] = ["up", "up", "right", "right", "right", "down", "down", "down", "left", "left"];
    for (const direction of path) {
      setPlayerFacing(state, "p1", direction);
      state = stepGame(state);
    }

    const player = state.players.p1;
    expect(player.trail).toEqual([]); // loop closed, trail consumed
    expect(player.head).toEqual({ row: 3, col: 3 });
    expect(player.ownedCount).toBe(19); // 9 base + 8 trail cells + 2 enclosed cells
    expect(player.peakOwnedCount).toBe(19); // grew monotonically, so peak tracks the current count
    expect(state.grid[1][4]).toEqual({ kind: "territory", playerId: "p1" });
    expect(state.grid[2][4]).toEqual({ kind: "territory", playerId: "p1" });
  });

  it("running through your own trail passes straight through — the loop only closes on your territory", () => {
    let state = createInitialGameState(7, 7, [HUMAN], undefined, ZERO_RNG);
    // Home base is rows 1-3 / cols 1-3. Trace a trail out of it and back over
    // the earlier trail cell at (2,4).
    const path: Direction[] = ["right", "right", "right", "up", "up", "left", "down", "down"];
    for (const direction of path) {
      setPlayerFacing(state, "p1", direction);
      state = stepGame(state);
    }

    let player = state.players.p1;
    expect(player.alive).toBe(true);
    expect(player.respawnAt).toBeNull();
    expect(player.head).toEqual({ row: 2, col: 4 }); // sailed onto its own wake
    expect(player.trail.length).toBeGreaterThan(0); // ...but the loop did NOT close
    expect(player.ownedCount).toBe(9); // still just the base — nothing captured

    // One more step west lands back on home territory (2,3) and closes it.
    setPlayerFacing(state, "p1", "left");
    state = stepGame(state);
    player = state.players.p1;
    expect(player.trail).toEqual([]); // loop closed, trail consumed
    expect(player.head).toEqual({ row: 2, col: 3 });
    expect(player.ownedCount).toBe(15); // 9 base + 6 trail cells turned territory
    expect(state.grid[0][5]).toEqual({ kind: "territory", playerId: "p1" });
  });

  it("walking into the board edge holds the player still instead of eliminating them", () => {
    let state = createInitialGameState(5, 5, [HUMAN], undefined, ZERO_RNG);
    // Home lands at (2,2) on a 5x5 board; two steps up reaches the top row (0,2).
    for (let i = 0; i < 5; i++) {
      setPlayerFacing(state, "p1", "up");
      state = stepGame(state);
    }
    expect(state.players.p1.alive).toBe(true);
    expect(state.players.p1.respawnAt).toBeNull();
    expect(state.players.p1.head).toEqual({ row: 0, col: 2 });

    // Steering away from the wall lets them move again.
    setPlayerFacing(state, "p1", "right");
    state = stepGame(state);
    expect(state.players.p1.head).toEqual({ row: 0, col: 3 });
  });
});

describe("stepGame — human start gate", () => {
  it("does not move a human player until they press a direction", () => {
    let state = createInitialGameState(7, 7, [HUMAN]);
    const home = state.players.p1.home;
    for (let i = 0; i < 10; i++) {
      state = stepGame(state);
    }
    expect(state.players.p1.head).toEqual(home);
    expect(state.players.p1.alive).toBe(true);
  });

  it("starts moving as soon as a direction is set", () => {
    let state = createInitialGameState(7, 7, [HUMAN], undefined, ZERO_RNG);
    setPlayerFacing(state, "p1", "right");
    state = stepGame(state);
    expect(state.players.p1.head).toEqual({ row: 2, col: 3 });
  });
});

describe("stepGame — respawn needs a clear 3x3", () => {
  it("holds a dead player out until an empty 3x3 pocket opens up", () => {
    // Three idle (non-bot, un-started) players so nobody moves and no winner is
    // declared: p1 blankets most of the board, p3 keeps a live foothold, p2 is
    // dead with its respawn already due.
    const roster: PlayerConfig[] = [
      { id: "p1", label: "One", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Two", color: 0xf87171, isBot: false },
      { id: "p3", label: "Three", color: 0x4ade80, isBot: false },
    ];
    let state = createInitialGameState(7, 7, roster);

    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "territory", playerId: "p1" })));
    grid[6][6] = { kind: "territory", playerId: "p3" }; // p3's foothold — p1 isn't the conqueror
    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p2: { ...state.players.p2, alive: false, trail: [], respawnAt: state.tick },
      },
    };

    state = stepGame(state);
    expect(state.winnerId).toBeNull(); // two players still alive, board just has no room
    expect(state.players.p2.alive).toBe(false);
    expect(state.players.p2.respawnAt).not.toBeNull();

    // Open a 3x3 pocket in the corner; the next tick can now place the base.
    const opened = state.grid.map((row) => row.slice());
    for (let row = 0; row <= 2; row++) {
      for (let col = 0; col <= 2; col++) opened[row][col] = { kind: "neutral" };
    }
    state = { ...state, grid: opened };

    state = stepGame(state);
    expect(state.players.p2.alive).toBe(true);
    expect(state.players.p2.respawnAt).toBeNull();
  });
});

describe("stepGame — cutting a trail captures both wakes and bridges the land", () => {
  it("folds your wake, their wake, and their territory into one connected blob", () => {
    const configs: PlayerConfig[] = [
      { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
    ];
    let state = createInitialGameState(9, 9, configs);

    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "neutral" })));
    // p1: a 2x2 base top-left, with a wake running east along row 1 to (1,4).
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) grid[r][c] = { kind: "territory", playerId: "p1" };
    const p1Trail = [{ row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }];
    for (const { row, col } of p1Trail) grid[row][col] = { kind: "trail", playerId: "p1" };
    // p2: a 2x2 base bottom-right, wake running north up column 5 to (1,5) —
    // right next to p1's head.
    for (const [r, c] of [[6, 6], [6, 7], [7, 6], [7, 7]]) grid[r][c] = { kind: "territory", playerId: "p2" };
    const p2Trail = [
      { row: 6, col: 5 }, { row: 5, col: 5 }, { row: 4, col: 5 },
      { row: 3, col: 5 }, { row: 2, col: 5 }, { row: 1, col: 5 },
    ];
    for (const { row, col } of p2Trail) grid[row][col] = { kind: "trail", playerId: "p2" };

    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, home: { row: 0, col: 0 }, head: { row: 1, col: 4 }, facing: "right", trail: [...p1Trail], hasStarted: true },
        p2: { ...state.players.p2, home: { row: 6, col: 6 }, head: { row: 1, col: 5 }, facing: "up", trail: [...p2Trail] },
      },
    };

    setPlayerFacing(state, "p1", "right");
    state = stepGame(state); // p1: (1,4) -> (1,5), cutting p2's wake

    const p1 = state.players.p1;
    const p2 = state.players.p2;

    expect(p2.alive).toBe(false);
    expect(p2.respawnAt).not.toBeNull();
    expect(p2.ownedCount).toBe(0);
    expect(p1.captures).toBe(1); // p1 cut the trail…
    expect(p2.timesCaptured).toBe(1); // …and p2 wears the loss
    expect(p1.timesCaptured).toBe(0);
    expect(p1.trail).toEqual([]);
    expect(p1.head).toEqual({ row: 1, col: 5 });
    expect(state.captureEvents).toEqual([{ capturerId: "p1", victimId: "p2" }]);

    // The whole bridge is p1 territory: base, p1 wake, the cut cell, p2 wake, p2 land.
    for (const { row, col } of [
      { row: 0, col: 0 }, { row: 1, col: 1 },
      { row: 1, col: 2 }, { row: 1, col: 4 }, { row: 1, col: 5 },
      { row: 3, col: 5 }, { row: 6, col: 5 },
      { row: 6, col: 6 }, { row: 7, col: 7 },
    ]) {
      expect(state.grid[row][col]).toEqual({ kind: "territory", playerId: "p1" });
    }
    // Open water beside the bridge is untouched — no runaway capture fill.
    expect(state.grid[3][0]).toEqual({ kind: "neutral" });
    expect(p1.ownedCount).toBe(17); // 4 base + 3 wake + 6 rival wake + 4 rival land
  });

  it("bridges across a rival's trail that had been plowed through your own land", () => {
    const configs: PlayerConfig[] = [
      { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
    ];
    let state = createInitialGameState(7, 7, configs);

    // p1 owns row 3 except col 3; p2 has plowed a trail down column 3, splitting
    // the strip. Cutting that trail now welds the two halves together.
    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "neutral" })));
    for (let col = 0; col <= 6; col++) {
      if (col !== 3) grid[3][col] = { kind: "territory", playerId: "p1" };
    }
    const rivalTrail = [{ row: 2, col: 3 }, { row: 3, col: 3 }, { row: 4, col: 3 }];
    for (const { row, col } of rivalTrail) grid[row][col] = { kind: "trail", playerId: "p2" };

    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, home: { row: 3, col: 0 }, head: { row: 3, col: 2 }, trail: [], hasStarted: true },
        p2: { ...state.players.p2, home: { row: 6, col: 6 }, head: { row: 2, col: 3 }, trail: rivalTrail },
      },
    };

    setPlayerFacing(state, "p1", "right");
    state = stepGame(state); // p1: (3,2) -> (3,3), cutting p2's trail

    expect(state.players.p2.alive).toBe(false);
    for (let col = 0; col <= 6; col++) {
      expect(state.grid[3][col]).toEqual({ kind: "territory", playerId: "p1" });
    }
    expect(state.grid[2][3]).toEqual({ kind: "territory", playerId: "p1" });
    expect(state.grid[4][3]).toEqual({ kind: "territory", playerId: "p1" });
    expect(state.players.p1.ownedCount).toBe(9); // 6 strip + 1 gap + 2 trail stubs
  });
});

describe("stepGame — a fully enclosed player is sunk", () => {
  it("eliminates a player whose whole territory gets swallowed by a capture loop", () => {
    const configs: PlayerConfig[] = [
      { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
    ];
    let state = createInitialGameState(11, 11, configs, { respawnDelayTicks: 2 });

    // p1 owns a "C" around p2's single cell at (3,3), open at the north. p2 is
    // still alive, trailing away down the left edge — the situation the bug
    // report describes.
    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "neutral" })));
    for (const [r, c] of [[1, 2], [2, 2], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]]) {
      grid[r][c] = { kind: "territory", playerId: "p1" };
    }
    grid[3][3] = { kind: "territory", playerId: "p2" };
    for (const [r, c] of [[5, 0], [6, 0]]) grid[r][c] = { kind: "trail", playerId: "p2" };

    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, home: { row: 4, col: 4 }, head: { row: 1, col: 2 }, facing: "right", trail: [], hasStarted: true },
        p2: { ...state.players.p2, home: { row: 3, col: 3 }, head: { row: 6, col: 0 }, facing: "down", trail: [{ row: 5, col: 0 }, { row: 6, col: 0 }], hasStarted: true },
      },
    };

    // p1 plugs the northern gap: (1,2) -> (1,3) -> (2,3) -> back onto (2,2).
    for (const direction of ["right", "down", "left"] as Direction[]) {
      setPlayerFacing(state, "p1", direction);
      state = stepGame(state);
    }

    const p2 = state.players.p2;
    expect(p2.ownedCount).toBe(0); // (3,3) got flooded into p1's territory
    expect(state.grid[3][3]).toEqual({ kind: "territory", playerId: "p1" });
    expect(p2.alive).toBe(false); // …so p2 is sunk, not left wandering
    expect(p2.respawnAt).toBe(5); // nextTick (3) + respawnDelayTicks (2)
    expect(p2.trail).toEqual([]);
    // Encircled, not trail-cut — still reported as an elimination event.
    expect(state.captureEvents).toEqual([{ capturerId: "p1", victimId: "p2" }]);
    // p2's orphaned wake is wiped off the board.
    expect(state.grid[5][0]).toEqual({ kind: "neutral" });
    expect(state.grid[6][0]).toEqual({ kind: "neutral" });
    expect(state.grid.flat().some((c) => c.kind === "trail" && c.playerId === "p2")).toBe(false);

    expect(state.players.p1.alive).toBe(true);
    expect(state.players.p1.ownedCount).toBe(11); // 8 "C" + 2 plug + 1 enclosed
    expect(state.winnerId).toBeNull(); // board still has room for p2 to respawn
  });

  it("leaves a partially-enclosed player alone — losing some land is not death", () => {
    const configs: PlayerConfig[] = [
      { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
    ];
    let state = createInitialGameState(11, 11, configs, { respawnDelayTicks: 2 });

    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "neutral" })));
    for (const [r, c] of [[1, 2], [2, 2], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]]) {
      grid[r][c] = { kind: "territory", playerId: "p1" };
    }
    grid[3][3] = { kind: "territory", playerId: "p2" };
    grid[6][6] = { kind: "territory", playerId: "p2" }; // a second, untouched p2 cell

    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, home: { row: 4, col: 4 }, head: { row: 1, col: 2 }, facing: "right", trail: [], hasStarted: true },
        p2: { ...state.players.p2, home: { row: 6, col: 6 }, head: { row: 0, col: 6 }, facing: "down", trail: [], hasStarted: true },
      },
    };

    for (const direction of ["right", "down", "left"] as Direction[]) {
      setPlayerFacing(state, "p1", direction);
      state = stepGame(state);
    }

    expect(state.players.p2.alive).toBe(true); // still holds (6,6)
    expect(state.players.p2.ownedCount).toBe(1);
    expect(state.players.p2.respawnAt).toBeNull();
  });
});

describe("stepGame — autopilot", () => {
  it("drives a non-bot player from tick 1 with no key press", () => {
    const configs: PlayerConfig[] = [{ id: "p1", label: "You", color: 0x38bdf8, isBot: false, autopilot: true }];
    let state = createInitialGameState(9, 9, configs);
    const start = state.players.p1.head;
    expect(state.players.p1.hasStarted).toBe(true);

    state = stepGame(state);
    expect(state.players.p1.head).not.toEqual(start); // moved on its own, no input
  });
});

describe("stepGame — custom rules", () => {
  it("threads respawnDelayTicks through create + step", () => {
    const state = createInitialGameState(7, 7, [HUMAN], { respawnDelayTicks: 3 });
    expect(state.rules.respawnDelayTicks).toBe(3);
    expect(stepGame(state).rules.respawnDelayTicks).toBe(3);
  });

  it("schedules a respawn using respawnDelayTicks, not the default", () => {
    const configs: PlayerConfig[] = [
      { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
    ];
    let state = createInitialGameState(11, 11, configs, { respawnDelayTicks: 2 });
    const grid = state.grid.map((row) => row.slice());
    grid[0][1] = { kind: "trail", playerId: "p2" };
    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, head: { row: 0, col: 0 }, home: { row: 0, col: 0 }, trail: [], hasStarted: true },
        p2: { ...state.players.p2, head: { row: 5, col: 5 }, home: { row: 5, col: 5 }, trail: [{ row: 0, col: 1 }] },
      },
    };

    setPlayerFacing(state, "p1", "right");
    const after = stepGame(state); // tick 0 -> 1; p1 steps onto p2's trail

    expect(after.players.p2.alive).toBe(false);
    expect(after.players.p2.respawnAt).toBe(3); // nextTick (1) + respawnDelayTicks (2)
  });
});

describe("stepGame — winner detection", () => {
  const configs: PlayerConfig[] = [
    { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
    { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
  ];

  it("starts with no winner", () => {
    expect(createInitialGameState(7, 7, configs).winnerId).toBeNull();
  });

  it("declares the winner once one player holds every cell", () => {
    let state = createInitialGameState(5, 5, configs);
    state = {
      ...state,
      grid: state.grid.map((row) => row.map((): CellState => ({ kind: "territory", playerId: "p1" }))),
      players: {
        ...state.players,
        p1: { ...state.players.p1, head: { row: 2, col: 2 }, hasStarted: true },
        p2: { ...state.players.p2, alive: false, trail: [], respawnAt: 0 },
      },
    };
    state = stepGame(state);
    expect(state.winnerId).toBe("p1");
    expect(state.players.p1.ownedCount).toBe(25);
  });

  it("declares the last boat afloat when no eliminated player can respawn", () => {
    let state = createInitialGameState(5, 5, configs);
    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "territory", playerId: "p1" })));
    grid[0][0] = { kind: "neutral" }; // one stray cell — not a 3x3, so no respawn fits
    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, head: { row: 2, col: 2 }, hasStarted: true },
        p2: { ...state.players.p2, alive: false, trail: [], respawnAt: 0 },
      },
    };
    state = stepGame(state);
    expect(state.players.p1.ownedCount).toBe(24); // not the whole board…
    expect(state.winnerId).toBe("p1"); // …but still decided
  });

  it("freezes the state once a winner is set", () => {
    const decided = { ...createInitialGameState(7, 7, configs), winnerId: "p1" };
    expect(stepGame(decided)).toBe(decided);
  });
});

describe("stepGame — head-on stand-off", () => {
  const configs: PlayerConfig[] = [
    { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
    { id: "p2", label: "Them", color: 0xf87171, isBot: false },
  ];

  /** Two non-bot boats sitting on their own land, heads adjacent along row 4. */
  function faceOff(p1Facing: Direction, p2Facing: Direction, p1Head: number, p2Head: number) {
    let state = createInitialGameState(9, 9, configs);
    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "neutral" })));
    for (let col = 1; col <= 3; col++) grid[4][col] = { kind: "territory", playerId: "p1" };
    for (let col = 5; col <= 7; col++) grid[4][col] = { kind: "territory", playerId: "p2" };
    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, home: { row: 4, col: 2 }, head: { row: 4, col: p1Head }, facing: p1Facing, queuedFacing: null, trail: [], hasStarted: true },
        p2: { ...state.players.p2, home: { row: 4, col: 6 }, head: { row: 4, col: p2Head }, facing: p2Facing, queuedFacing: null, trail: [], hasStarted: true },
      },
    };
    return state;
  }

  it("blocks both boats when they drive straight at each other — neither captures", () => {
    // p1 at (4,3) heading east, p2 at (4,4) heading west: they'd swap cells.
    let state = faceOff("right", "left", 3, 4);
    state = stepGame(state);

    expect(state.players.p1.head).toEqual({ row: 4, col: 3 }); // held position
    expect(state.players.p2.head).toEqual({ row: 4, col: 4 });
    expect(state.players.p1.alive).toBe(true);
    expect(state.players.p2.alive).toBe(true);
    expect(state.players.p1.captures).toBe(0);
    expect(state.players.p2.captures).toBe(0);
    expect(state.players.p1.timesCaptured).toBe(0);
    expect(state.players.p2.timesCaptured).toBe(0);
    expect(state.players.p1.trail).toEqual([]);
    expect(state.players.p2.trail).toEqual([]);
  });

  it("blocks both boats when they push into the same cell", () => {
    // p1 at (4,3) and p2 at (4,5) both aiming for the empty cell (4,4).
    let state = faceOff("right", "left", 3, 5);
    state = stepGame(state);

    expect(state.players.p1.head).toEqual({ row: 4, col: 3 });
    expect(state.players.p2.head).toEqual({ row: 4, col: 5 });
    expect(state.grid[4][4]).toEqual({ kind: "neutral" }); // nobody laid a trail there
    expect(state.players.p1.alive).toBe(true);
    expect(state.players.p2.alive).toBe(true);
  });

  it("clears the stand-off as soon as one boat steers away", () => {
    let state = faceOff("right", "left", 3, 4);
    state = stepGame(state); // blocked
    expect(state.players.p1.head).toEqual({ row: 4, col: 3 });

    setPlayerFacing(state, "p1", "up");
    state = stepGame(state);

    expect(state.players.p1.head).toEqual({ row: 3, col: 3 }); // free to move now
    expect(state.players.p2.head).toEqual({ row: 4, col: 3 }); // p2 rolls forward into the vacated cell
    expect(state.players.p1.alive).toBe(true);
    expect(state.players.p2.alive).toBe(true);
  });
});

describe("stepGame — bots", () => {
  it("runs many ticks with only bots on a small board without throwing", () => {
    const bots: PlayerConfig[] = [
      { id: "bot1", label: "Bot 1", color: 0xf87171, isBot: true },
      { id: "bot2", label: "Bot 2", color: 0xfacc15, isBot: true },
    ];
    let state = createInitialGameState(12, 12, bots);
    for (let i = 0; i < 150; i++) {
      state = stepGame(state);
    }
    for (const player of Object.values(state.players)) {
      expect(player.ownedCount).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(player.ownedCount)).toBe(true);
    }
  });
});
