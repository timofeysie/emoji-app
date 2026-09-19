import type { Direction, Vec2 } from "./types";

/**
 * Grid geometry shared by the simulation and the bot strategies. Kept in its own
 * module so `botStrategy.ts` can use it without importing from `simulation.ts`
 * (which imports the strategy registry back — a cycle we'd rather not have).
 */

/** Row/col offset for one step in each direction. */
export const DELTA: Record<Direction, Vec2> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

/** The 180° reversal of each direction. */
export const OPPOSITE: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };

/** Candidate order for tie-breaking: an exact score tie resolves to the earliest here. */
export const ALL_DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
