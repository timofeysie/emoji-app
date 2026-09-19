import { describe, it, expect } from "vitest";
import { createEmptyGrid, type CellState } from "@/features/landGrab/grid";
import { resolveTerritorySplit } from "@/features/landGrab/splitResolution";

function territory(playerId: string): CellState {
  return { kind: "territory", playerId };
}

describe("resolveTerritorySplit (numIslands-style cut resolution)", () => {
  it("strips a component disconnected from the anchor, keeping the anchor's component intact", () => {
    const grid = createEmptyGrid(7, 7);
    // Home blob, connected component containing (0,0)
    grid[0][0] = territory("p1");
    grid[0][1] = territory("p1");
    // A separate, disconnected blob elsewhere on the board
    grid[5][5] = territory("p1");
    grid[5][6] = territory("p1");

    const next = resolveTerritorySplit(grid, "p1", [{ row: 0, col: 0 }]);

    expect(next[0][0]).toEqual(territory("p1"));
    expect(next[0][1]).toEqual(territory("p1"));
    expect(next[5][5]).toEqual({ kind: "neutral" });
    expect(next[5][6]).toEqual({ kind: "neutral" });
  });

  it("is a no-op when all owned cells are already one connected component", () => {
    const grid = createEmptyGrid(5, 5);
    grid[2][2] = territory("p1");
    grid[2][3] = territory("p1");
    grid[3][3] = territory("p1");

    const next = resolveTerritorySplit(grid, "p1", [{ row: 2, col: 2 }]);

    expect(next).toBe(grid); // same reference: nothing to drop, so no copy is made
  });

  it("keeps the component holding the player's piece over the one holding their stale home", () => {
    const grid = createEmptyGrid(7, 7);
    // Stale home blob near (0,0) — smaller.
    grid[0][0] = territory("p1");
    grid[0][1] = territory("p1");
    // Where the player actually is now — a bigger blob they've built up.
    grid[5][4] = territory("p1");
    grid[5][5] = territory("p1");
    grid[6][5] = territory("p1");

    // head at (5,5), home at (0,0): head wins.
    const next = resolveTerritorySplit(grid, "p1", [{ row: 5, col: 5 }, { row: 0, col: 0 }]);

    expect(next[5][4]).toEqual(territory("p1"));
    expect(next[5][5]).toEqual(territory("p1"));
    expect(next[6][5]).toEqual(territory("p1"));
    expect(next[0][0]).toEqual({ kind: "neutral" });
    expect(next[0][1]).toEqual({ kind: "neutral" });
  });

  it("falls back to the largest fragment when the player owns none of their anchors", () => {
    const grid = createEmptyGrid(7, 7);
    // Player's base and piece are both off their own land (captured / trailing
    // through open ground). Two orphaned fragments remain, one bigger.
    grid[1][1] = territory("p1");
    grid[5][4] = territory("p1");
    grid[5][5] = territory("p1");
    grid[6][5] = territory("p1");

    const next = resolveTerritorySplit(grid, "p1", [{ row: 3, col: 3 }, { row: 0, col: 0 }]);

    expect(next[5][4]).toEqual(territory("p1"));
    expect(next[5][5]).toEqual(territory("p1"));
    expect(next[6][5]).toEqual(territory("p1"));
    expect(next[1][1]).toEqual({ kind: "neutral" });
  });

  it("is a no-op when the only remaining land is a single fragment, anchor owned or not", () => {
    const grid = createEmptyGrid(5, 5);
    // p1's home cell was fully swallowed by someone else's capture; only a stray fragment remains
    grid[4][4] = territory("p1");

    const next = resolveTerritorySplit(grid, "p1", [{ row: 0, col: 0 }, { row: 0, col: 0 }]);

    expect(next).toBe(grid);
    expect(next[4][4]).toEqual(territory("p1"));
  });

  it("does not touch other players' cells while stripping p1's disconnected fragment", () => {
    const grid = createEmptyGrid(5, 5);
    grid[0][0] = territory("p1");
    grid[4][4] = territory("p1"); // disconnected fragment, should be stripped
    grid[4][3] = territory("p2"); // untouched, belongs to someone else entirely

    const next = resolveTerritorySplit(grid, "p1", [{ row: 0, col: 0 }]);

    expect(next[4][4]).toEqual({ kind: "neutral" });
    expect(next[4][3]).toEqual(territory("p2"));
  });
});
