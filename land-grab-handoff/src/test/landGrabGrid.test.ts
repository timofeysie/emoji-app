import { describe, it, expect } from "vitest";
import {
  createEmptyGrid,
  resolveCapture,
  countOwnedCells,
  placeBase,
  isAreaFree,
  findOpenSpawn,
  type CellState,
} from "@/features/landGrab/grid";

/** Builds a 5x5 grid with a ring of `p1` territory around one enclosed cell. */
function buildRingGrid(holeCell: CellState): CellState[][] {
  const grid = createEmptyGrid(5, 5);
  const ring: Array<[number, number]> = [
    [1, 1], [1, 2], [1, 3],
    [2, 1],         [2, 3],
    [3, 1], [3, 2], [3, 3],
  ];
  for (const [row, col] of ring) grid[row][col] = { kind: "territory", playerId: "p1" };
  grid[2][2] = holeCell;
  return grid;
}

describe("resolveCapture (border flood fill)", () => {
  it("converts a fully enclosed neutral cell into the closing player's territory", () => {
    const grid = buildRingGrid({ kind: "neutral" });
    const next = resolveCapture(grid, "p1");
    expect(next[2][2]).toEqual({ kind: "territory", playerId: "p1" });
  });

  it("swallows an opponent's untouched land if it was fully inside the loop", () => {
    const grid = buildRingGrid({ kind: "territory", playerId: "p2" });
    const next = resolveCapture(grid, "p1");
    expect(next[2][2]).toEqual({ kind: "territory", playerId: "p1" });
  });

  it("leaves cells reachable from the border untouched", () => {
    const grid = buildRingGrid({ kind: "neutral" });
    const next = resolveCapture(grid, "p1");
    expect(next[0][0]).toEqual({ kind: "neutral" });
    expect(next[4][4]).toEqual({ kind: "neutral" });
    expect(next[0][2]).toEqual({ kind: "neutral" });
  });

  it("preserves the boundary itself as territory", () => {
    const grid = buildRingGrid({ kind: "neutral" });
    const next = resolveCapture(grid, "p1");
    expect(next[1][1]).toEqual({ kind: "territory", playerId: "p1" });
    expect(next[3][3]).toEqual({ kind: "territory", playerId: "p1" });
  });
});

describe("countOwnedCells / placeBase", () => {
  it("counts a freshly placed base correctly", () => {
    const grid = placeBase(createEmptyGrid(7, 7), { row: 3, col: 3 }, "p1", 1);
    expect(countOwnedCells(grid, "p1")).toBe(9);
  });

  it("clamps a base placed near the edge instead of throwing", () => {
    const grid = placeBase(createEmptyGrid(7, 7), { row: 0, col: 0 }, "p1", 1);
    expect(countOwnedCells(grid, "p1")).toBe(4); // only the in-bounds quadrant of the 3x3
  });
});

describe("isAreaFree / findOpenSpawn", () => {
  it("reports an empty grid as free everywhere", () => {
    const grid = createEmptyGrid(5, 5);
    expect(isAreaFree(grid, { row: 2, col: 2 }, 1)).toBe(true);
  });

  it("reports occupied or out-of-bounds areas as not free", () => {
    const grid = placeBase(createEmptyGrid(5, 5), { row: 2, col: 2 }, "p1", 1);
    expect(isAreaFree(grid, { row: 2, col: 2 }, 1)).toBe(false);
    expect(isAreaFree(grid, { row: 0, col: 0 }, 1)).toBe(false); // spills off the top-left edge
  });

  it("finds the nearest open square when the preferred spot is taken", () => {
    const grid = placeBase(createEmptyGrid(9, 9), { row: 4, col: 4 }, "p1", 1);
    const spawn = findOpenSpawn(grid, { row: 4, col: 4 }, 1);
    expect(isAreaFree(grid, spawn, 1)).toBe(true);
  });
});
