import { describe, it, expect } from "vitest";
import {
  createReplayLog,
  recordFrame,
  frameGridAt,
  frameChainsAt,
  frameHeadHistoryAt,
  MAX_REPLAY_TICKS,
  type ReplayLog,
} from "@/features/landGrab/replayLog";
import {
  createInitialGameState,
  setPlayerFacing,
  stepGame,
  type GameState,
  type PlayerConfig,
} from "@/features/landGrab/simulation";
import type { CellState } from "@/features/landGrab/grid";
import type { Direction } from "@/features/landGrab/types";

const HUMAN: PlayerConfig = { id: "p1", label: "You", color: 0x38bdf8, isBot: false };

/** A deterministic single-player run: no bots, so no `Math.random` jitter. */
function runPath(path: Direction[]): { states: GameState[]; log: ReplayLog } {
  let state = createInitialGameState(7, 7, [HUMAN]);
  const log = createReplayLog(state);
  const states: GameState[] = [state];
  for (const direction of path) {
    setPlayerFacing(state, "p1", direction);
    state = stepGame(state);
    recordFrame(log, state);
    states.push(state);
  }
  return { states, log };
}

describe("createReplayLog", () => {
  it("records frame 0 with the full opening grid and player meta", () => {
    const state = createInitialGameState(7, 7, [HUMAN]);
    const log = createReplayLog(state);

    expect(log.rowCount).toBe(7);
    expect(log.colCount).toBe(7);
    expect(log.playerOrder).toEqual(["p1"]);
    expect(log.playerMeta.p1).toEqual({ label: "You", color: 0x38bdf8, isBot: false });
    expect(log.frames).toHaveLength(1);
    expect(log.frames[0].tick).toBe(0);
    expect(log.frames[0].cellChanges).toHaveLength(49); // every cell on frame 0
    expect(log.frames[0].winnerId).toBeNull();
    expect(frameGridAt(log, 0)).toEqual(state.grid);
  });
});

describe("recordFrame", () => {
  it("appends one frame per tick, each a delta rather than the whole board", () => {
    // Leave home territory so trail cells actually get laid.
    const path: Direction[] = ["up", "up", "up", "right", "right", "right"];
    const { log } = runPath(path);

    expect(log.frames).toHaveLength(path.length + 1);
    // Only frame 0 lists every cell; later frames stay small (a move outside
    // owned land flips one cell to trail — a move within it flips none).
    for (const frame of log.frames.slice(1)) {
      expect(frame.cellChanges.length).toBeLessThan(49);
    }
    // ...and the run as a whole does record changes.
    const totalChanges = log.frames.slice(1).reduce((n, f) => n + f.cellChanges.length, 0);
    expect(totalChanges).toBeGreaterThan(0);
  });

  it("reconstructs the exact live grid at every recorded frame", () => {
    // Trace a loop that pinches off a pocket and closes back onto home territory.
    const path: Direction[] = [
      "up", "up", "right", "right", "right",
      "down", "down", "down", "left", "left",
    ];
    const { states, log } = runPath(path);

    for (let i = 0; i < log.frames.length; i++) {
      expect(frameGridAt(log, i)).toEqual(states[i].grid);
    }
  });

  it("captures per-player head, facing, trail and ownedCount", () => {
    const { states, log } = runPath(["up", "up", "right"]);
    const last = log.frames[log.frames.length - 1];
    const player = states[states.length - 1].players.p1;

    expect(last.players.p1.head).toEqual(player.head);
    expect(last.players.p1.facing).toBe(player.facing);
    expect(last.players.p1.trail).toEqual(player.trail);
    expect(last.players.p1.ownedCount).toBe(player.ownedCount);
    expect(last.players.p1.alive).toBe(true);
  });

  it("ignores a repeated call for a tick already recorded", () => {
    const state = createInitialGameState(7, 7, [HUMAN]);
    const log = createReplayLog(state);

    setPlayerFacing(state, "p1", "up");
    const next = stepGame(state);
    recordFrame(log, next);
    recordFrame(log, next); // same tick again — frozen-state re-delivery

    expect(log.frames).toHaveLength(2);
  });

  it("past MAX_REPLAY_TICKS, drops the oldest frame per new one instead of stopping", () => {
    const base = createInitialGameState(3, 3, [HUMAN]);
    const log = createReplayLog(base);

    const lastTick = MAX_REPLAY_TICKS + 50;
    for (let tick = 1; tick <= lastTick; tick++) {
      recordFrame(log, { ...base, tick, grid: base.grid, captureEvents: [] });
    }

    // Recording never stopped — it reaches the true final tick...
    expect(log.frames[log.frames.length - 1].tick).toBe(lastTick);
    // ...by holding a fixed-size window of the most recent ticks instead.
    expect(log.truncated).toBe(true);
    expect(log.frames).toHaveLength(MAX_REPLAY_TICKS);
    expect(log.frames[0].tick).toBe(lastTick - MAX_REPLAY_TICKS + 1);
    // Frame 0 still carries a full grid snapshot, however far it's shifted —
    // frameGridAt has nothing older to fall back on.
    expect(log.frames[0].cellChanges).toHaveLength(9); // 3x3 board
    expect(frameGridAt(log, log.frames.length - 1)).toEqual(base.grid);
  });
});

describe("frameGridAt", () => {
  it("clamps an out-of-range index into the recorded frames", () => {
    const { states, log } = runPath(["up", "up"]);
    expect(frameGridAt(log, -5)).toEqual(states[0].grid);
    expect(frameGridAt(log, 999)).toEqual(states[states.length - 1].grid);
  });
});

describe("captured-avatar chain — display-only replay data", () => {
  /** p1 cuts p2's trail on the recorded step, exactly like the simulation test. */
  function captureLog() {
    const configs: PlayerConfig[] = [
      { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
    ];
    let state = createInitialGameState(9, 9, configs);
    const grid = state.grid.map((row) => row.map((): CellState => ({ kind: "neutral" })));
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) grid[r][c] = { kind: "territory", playerId: "p1" };
    const p1Trail = [{ row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }];
    for (const { row, col } of p1Trail) grid[row][col] = { kind: "trail", playerId: "p1" };
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

    const log = createReplayLog(state);
    setPlayerFacing(state, "p1", "right");
    state = stepGame(state); // p1: (1,4) -> (1,5), cutting p2's wake
    recordFrame(log, state);
    return { state, log };
  }

  it("records the tick's capture event on the frame", () => {
    const { log } = captureLog();
    expect(log.frames[1].captureEvents).toEqual([{ capturerId: "p1", victimId: "p2" }]);
    expect(log.frames[0].captureEvents).toEqual([]);
  });

  it("frameChainsAt reconstructs the chain from the recorded events", () => {
    const { log } = captureLog();
    expect(frameChainsAt(log, 0)).toEqual({});
    expect(frameChainsAt(log, 1)).toEqual({ p1: ["p2"], p2: [] });
  });

  it("frameHeadHistoryAt tracks p1's path so the chain has somewhere to sit", () => {
    const { log } = captureLog();
    const history = frameHeadHistoryAt(log, 1);
    expect(history.p1[history.p1.length - 1]).toEqual({ row: 1, col: 5 }); // p1's post-capture head
  });

  it("survives eviction — a chain formed before the retained window still shows up via leadingChains", () => {
    const { state, log } = captureLog(); // log.frames = [frame 0, frame 1 (the capture)]

    // Push enough further ticks to push both the capture frame and its
    // predecessor out of the live window, forcing frame 0 to re-base past them.
    const lastTick = state.tick + MAX_REPLAY_TICKS + 5;
    for (let tick = state.tick + 1; tick <= lastTick; tick++) {
      recordFrame(log, { ...state, tick, captureEvents: [] });
    }
    expect(log.truncated).toBe(true);
    expect(log.frames[0].tick).toBeGreaterThan(1); // the original capture frame is long gone

    // The chain itself must still be there — it was folded into `leadingChains`
    // on the way out rather than silently dropped with its frame.
    expect(frameChainsAt(log, log.frames.length - 1)).toEqual({ p1: ["p2"], p2: [] });
  });
});
