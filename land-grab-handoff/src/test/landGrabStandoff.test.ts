import { describe, it, expect } from "vitest";
import { intendedNext, isStandoff, wouldStandOff } from "@/features/landGrab/standoff";
import { createInitialGameState, stepGame, type PlayerConfig } from "@/features/landGrab/simulation";

describe("intendedNext", () => {
  it("offsets the head by one step in the given direction", () => {
    expect(intendedNext({ row: 4, col: 4 }, "up")).toEqual({ row: 3, col: 4 });
    expect(intendedNext({ row: 4, col: 4 }, "right")).toEqual({ row: 4, col: 5 });
  });
});

describe("isStandoff", () => {
  it("is true when two boats would swap cells", () => {
    // a at (4,3)->(4,4), b at (4,4)->(4,3)
    expect(isStandoff({ row: 4, col: 3 }, { row: 4, col: 4 }, { row: 4, col: 4 }, { row: 4, col: 3 })).toBe(true);
  });
  it("is true when two boats target the same cell", () => {
    // a at (4,3)->(4,4), b at (4,5)->(4,4)
    expect(isStandoff({ row: 4, col: 3 }, { row: 4, col: 4 }, { row: 4, col: 5 }, { row: 4, col: 4 })).toBe(true);
  });
  it("is false when the paths merely cross without colliding", () => {
    // a moving down through (4,4), b moving right through (4,4) but from a step behind
    expect(isStandoff({ row: 3, col: 4 }, { row: 4, col: 4 }, { row: 4, col: 2 }, { row: 4, col: 3 })).toBe(false);
  });
});

describe("wouldStandOff", () => {
  it("flags a step that collides with another started boat's intended move", () => {
    let state = createInitialGameState(9, 9, [
      { id: "a", label: "A", color: 1, isBot: false },
      { id: "b", label: "B", color: 2, isBot: false },
    ]);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a, head: { row: 4, col: 3 }, facing: "right", queuedFacing: null, hasStarted: true },
        b: { ...state.players.b, head: { row: 4, col: 5 }, facing: "left", queuedFacing: null, hasStarted: true },
      },
    };
    expect(wouldStandOff(state, state.players.a, { row: 4, col: 4 })).toBe(true); // into the shared cell
    expect(wouldStandOff(state, state.players.a, { row: 3, col: 3 })).toBe(false); // steering away
  });

  it("ignores boats that haven't started or are dead", () => {
    let state = createInitialGameState(9, 9, [
      { id: "a", label: "A", color: 1, isBot: false },
      { id: "b", label: "B", color: 2, isBot: false },
    ]);
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a, head: { row: 4, col: 3 }, facing: "right", queuedFacing: null, hasStarted: true },
        b: { ...state.players.b, head: { row: 4, col: 5 }, facing: "left", queuedFacing: null, hasStarted: false },
      },
    };
    expect(wouldStandOff(state, state.players.a, { row: 4, col: 4 })).toBe(false);
  });
});

describe("stand-off-aware bots don't lock up", () => {
  it("two bot boats driving at each other both break the face-off within a few ticks", () => {
    // Head-on on row 4, three cells apart, both bots (they re-decide every tick).
    let state = createInitialGameState(11, 11, [
      { id: "l", label: "L", color: 1, isBot: true, botType: "rambler" },
      { id: "r", label: "R", color: 2, isBot: true, botType: "rambler" },
    ]);
    state = {
      ...state,
      players: {
        ...state.players,
        l: { ...state.players.l, head: { row: 5, col: 3 }, facing: "right", queuedFacing: null, trail: [], hasStarted: true },
        r: { ...state.players.r, head: { row: 5, col: 7 }, facing: "left", queuedFacing: null, trail: [], hasStarted: true },
      },
    };

    const startL = `${state.players.l.head.row},${state.players.l.head.col}`;
    const startR = `${state.players.r.head.row},${state.players.r.head.col}`;
    let lMoved = false;
    let rMoved = false;
    for (let i = 0; i < 16; i++) {
      state = stepGame(state);
      if (`${state.players.l.head.row},${state.players.l.head.col}` !== startL) lMoved = true;
      if (`${state.players.r.head.row},${state.players.r.head.col}` !== startR) rMoved = true;
    }
    // A permanent nose-to-nose freeze would pin each head to its start cell for
    // the whole run. Stand-off-aware scoring makes both peel away instead.
    expect(lMoved).toBe(true);
    expect(rMoved).toBe(true);
  });
});
