import { DELTA } from "./geometry";
import type { GameState, PlayerState } from "./simulation";
import type { Direction, Vec2 } from "./types";

/**
 * Head-on stand-off geometry, shared by `stepGame` (which enforces it) and the
 * bot strategies (which steer around it).
 *
 * When two boats' moves collide this tick — they'd swap cells driving straight at
 * each other, or both push into the same cell — `stepGame` freezes both: neither
 * moves, neither captures. So a move into a stand-off is a wasted tick for a bot,
 * never an opportunity; strategies score it like a wall.
 *
 * This module imports only *types* from `simulation.ts`, so a strategy can use it
 * without pulling `simulation.ts` in at runtime (which would cycle back through
 * the strategy registry).
 */

/** The cell `head` steps to when moving `facing`. */
export function intendedNext(head: Vec2, facing: Direction): Vec2 {
  return { row: head.row + DELTA[facing].row, col: head.col + DELTA[facing].col };
}

/** Do two boats at `aHead`/`bHead` moving to `aNext`/`bNext` collide head-on — a swap or a shared target cell? */
export function isStandoff(aHead: Vec2, aNext: Vec2, bHead: Vec2, bNext: Vec2): boolean {
  const sameCell = aNext.row === bNext.row && aNext.col === bNext.col;
  const swap =
    aNext.row === bHead.row &&
    aNext.col === bHead.col &&
    bNext.row === aHead.row &&
    bNext.col === aHead.col;
  return sameCell || swap;
}

/**
 * Would `player` stepping to `next` this tick be frozen by the head-on stand-off
 * rule — i.e. collide with some other living, started boat given everyone's
 * currently-intended facing (`queuedFacing ?? facing`)? Such a move is blocked by
 * `stepGame` before any capture resolves, so a bot should treat it like the board
 * edge: a wasted tick, ranked below every real move.
 */
export function wouldStandOff(state: GameState, player: PlayerState, next: Vec2): boolean {
  for (const id of state.playerOrder) {
    if (id === player.id) continue;
    const other = state.players[id];
    if (!other || !other.alive || !other.hasStarted) continue;
    const otherNext = intendedNext(other.head, other.queuedFacing ?? other.facing);
    if (isStandoff(player.head, next, other.head, otherNext)) return true;
  }
  return false;
}
