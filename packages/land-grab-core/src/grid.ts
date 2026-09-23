import type { Vec2 } from "./types";

export type CellState =
  | { kind: "neutral" }
  | { kind: "territory"; playerId: string }
  | {
      kind: "trail";
      playerId: string;
      /**
       * Set when this trail was laid across a still-standing rival's land rather
       * than open ground — the rival hasn't actually lost the cell yet. It's
       * still theirs (see `countOwnedCells`) unless the layer's run finishes by
       * closing a loop or landing a capture; if the layer is cut down first, the
       * cell reverts here instead of following the rest of their wake. See
       * `docs/land-grab/*` for the capture-loop rules this backs.
       */
      capturedFrom?: string;
    };

export function createEmptyGrid(rowCount: number, colCount: number): CellState[][] {
  return Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, (): CellState => ({ kind: "neutral" }))
  );
}

function isPlayerBoundary(cell: CellState, playerId: string): boolean {
  return (cell.kind === "trail" || cell.kind === "territory") && cell.playerId === playerId;
}

/**
 * Capture fill for a closed loop.
 *
 * Same base-case-then-recurse shape as `depthFirstSearch(row, col)` in
 * docs/problems/Number-of-Islands.md, but seeded from the grid border instead
 * of a land cell, and "visited" means "reachable open water" instead of "sunk
 * land". Anything the flood can't reach — and that isn't the closing
 * player's own trail/territory — was enclosed by the loop, so it becomes that
 * player's territory. This can swallow an opponent's untouched land if it was
 * fully inside the loop, matching how a capture in this genre can "cut off" a
 * chunk of enemy territory without ever stepping on it.
 */
export function resolveCapture(grid: CellState[][], playerId: string): CellState[][] {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const reachable: boolean[][] = Array.from({ length: rowCount }, () => new Array(colCount).fill(false));

  // Iterative (explicit stack) so a large board's open water doesn't blow the JS call stack —
  // this can visit tens of thousands of cells on the "large map" board size.
  function floodFromBorder(startRow: number, startCol: number): void {
    const stack: Array<[number, number]> = [[startRow, startCol]];
    while (stack.length > 0) {
      const [row, col] = stack.pop()!;
      // Skip: off the grid, already visited, or the closing player's own boundary
      if (row < 0 || row >= rowCount || col < 0 || col >= colCount) continue;
      if (reachable[row][col] || isPlayerBoundary(grid[row][col], playerId)) continue;
      reachable[row][col] = true;
      stack.push([row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]);
    }
  }

  for (let col = 0; col < colCount; col++) {
    floodFromBorder(0, col);
    floodFromBorder(rowCount - 1, col);
  }
  for (let row = 0; row < rowCount; row++) {
    floodFromBorder(row, 0);
    floodFromBorder(row, colCount - 1);
  }

  return grid.map((rowCells, row) =>
    rowCells.map((cell, col): CellState => {
      if (isPlayerBoundary(cell, playerId)) return { kind: "territory", playerId };
      if (!reachable[row][col]) return { kind: "territory", playerId };
      return cell;
    })
  );
}

export function countOwnedCells(grid: CellState[][], playerId: string): number {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.kind === "territory" && cell.playerId === playerId) count++;
      // A rival's trail merely crossing this cell hasn't taken it yet — it's
      // still ours until their run closes a loop or lands a capture.
      else if (cell.kind === "trail" && cell.capturedFrom === playerId) count++;
    }
  }
  return count;
}

export function placeBase(grid: CellState[][], center: Vec2, playerId: string, radius = 1): CellState[][] {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const next = grid.map((row) => row.slice());
  for (let row = center.row - radius; row <= center.row + radius; row++) {
    if (row < 0 || row >= rowCount) continue;
    for (let col = center.col - radius; col <= center.col + radius; col++) {
      if (col < 0 || col >= colCount) continue;
      next[row][col] = { kind: "territory", playerId };
    }
  }
  return next;
}

/** True if every cell in the (2*radius+1)-square centered on `center` is neutral. */
export function isAreaFree(grid: CellState[][], center: Vec2, radius = 1): boolean {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  for (let row = center.row - radius; row <= center.row + radius; row++) {
    if (row < 0 || row >= rowCount) return false;
    for (let col = center.col - radius; col <= center.col + radius; col++) {
      if (col < 0 || col >= colCount) return false;
      if (grid[row][col].kind !== "neutral") return false;
    }
  }
  return true;
}

/** Random candidates tried per `findOpenSpawn` call before falling back to an exhaustive scan. */
const SPAWN_SAMPLE_COUNT = 20;
/** Clearance (in addition to the base radius) that counts as "deep enough" — stops sampling early once hit. */
const SPAWN_CLEARANCE_MARGIN = 3;

/**
 * How big a neutral square can be centered on `center` — the largest `r` (up
 * to `maxRadius`, since we only need "comfortably clear", not the true
 * deepest point on the board) for which `isAreaFree(grid, center, r)` holds.
 * `-1` if `center` itself isn't even neutral.
 */
function clearanceRadius(grid: CellState[][], center: Vec2, maxRadius: number): number {
  if (grid[center.row]?.[center.col]?.kind !== "neutral") return -1;
  let clearRadius = 0;
  while (clearRadius < maxRadius && isAreaFree(grid, center, clearRadius + 1)) clearRadius++;
  return clearRadius;
}

/**
 * Finds an open square to drop a fresh base, biased toward the middle of
 * open space rather than just the nearest technically-free square — so a
 * spawn doesn't land hugging another player's border and get cut down
 * immediately.
 *
 * Uses "best-candidate" sampling (a cost independent of board size, which
 * matters once the board is a large scrolling map): try `SPAWN_SAMPLE_COUNT`
 * random neutral cells, score each by how big a clear square surrounds it
 * (capped at `radius + SPAWN_CLEARANCE_MARGIN` — plenty of breathing room,
 * without paying to find the *most* open spot on the board), and keep the
 * best. Stops early the moment a candidate clears that cap. Only falls back
 * to the previous exhaustive outward ring-scan from `preferred` if every
 * sample came up short (a nearly-full board late in a match), so a spawn is
 * still guaranteed whenever one exists anywhere on the grid. See
 * `docs/land-grab/land-grab.md` for the full spawn-placement writeup.
 */
export function findOpenSpawn(grid: CellState[][], preferred: Vec2, radius = 1, rng: () => number = Math.random): Vec2 {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const targetClearance = radius + SPAWN_CLEARANCE_MARGIN;

  let best: Vec2 | null = null;
  let bestClearance = radius - 1; // anything scoring higher than this fits the base at all
  for (let i = 0; i < SPAWN_SAMPLE_COUNT; i++) {
    const candidate: Vec2 = { row: Math.floor(rng() * rowCount), col: Math.floor(rng() * colCount) };
    const clearance = clearanceRadius(grid, candidate, targetClearance);
    if (clearance > bestClearance) {
      best = candidate;
      bestClearance = clearance;
      if (clearance >= targetClearance) return best; // deep enough — good enough, stop looking
    }
  }
  if (best) return best;

  // Sampling never found a usable spot (board is packed) — fall back to an
  // exhaustive outward scan from `preferred`, guaranteed to find one if it exists.
  if (isAreaFree(grid, preferred, radius)) return preferred;
  const maxSearchRadius = Math.max(rowCount, colCount);
  for (let ring = 1; ring <= maxSearchRadius; ring++) {
    for (let dRow = -ring; dRow <= ring; dRow++) {
      for (let dCol = -ring; dCol <= ring; dCol++) {
        if (Math.max(Math.abs(dRow), Math.abs(dCol)) !== ring) continue;
        const candidate: Vec2 = { row: preferred.row + dRow, col: preferred.col + dCol };
        if (candidate.row < 0 || candidate.row >= rowCount || candidate.col < 0 || candidate.col >= colCount) continue;
        if (isAreaFree(grid, candidate, radius)) return candidate;
      }
    }
  }
  // Grid is completely full — fall back to the preferred spot; the caller will overwrite whatever is there.
  return preferred;
}
