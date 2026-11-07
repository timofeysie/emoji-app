import type { CaptureEvent } from "./simulation";
import type { Vec2 } from "./types";

/**
 * Cosmetic-only bookkeeping for the trailing chain of previously-captured
 * avatars that follows a player around, à la Paper.io. None of this feeds
 * back into `simulation.ts` — it only consumes the `captureEvents` a tick
 * already reports — so it's shared by the live game (`LandGrabDemo`) and the
 * post-match replay (`LandGrabReplay`, via `replayLog.ts`) to draw the same
 * thing two ways.
 */

/**
 * Ids of players trailing behind each player, nearest capture first. Resets
 * to `[]` the instant this player is themself captured — a captured player's
 * own followers don't transfer to whoever caught them, they just scatter.
 */
export type ChainMap = Record<string, string[]>;

/**
 * Fill/stroke opacity for trailing chain markers. Deliberately faded — well
 * below the live head marker's full opacity — so a captured player's dot in
 * someone else's tail doesn't read as another full-strength player on the
 * board; only the actual head markers (real players/bots) are full color.
 */
export const CHAIN_TRAIL_ALPHA = 0.35;

/**
 * Fold one tick's capture events into a chain map: the victim joins the front
 * of their capturer's chain, and the victim's own chain empties out —
 * whatever they'd been trailing does *not* carry over to their capturer, it
 * just resets, the same as it would if they'd died any other way. Apply
 * events in the order they occurred. The same id can legitimately appear more
 * than once in a chain — nothing dedupes a player who keeps recapturing the
 * same rival.
 */
export function applyCaptureEvents(chains: ChainMap, events: readonly CaptureEvent[]): ChainMap {
  if (events.length === 0) return chains;
  const next = { ...chains };
  for (const { capturerId, victimId } of events) {
    next[capturerId] = [victimId, ...(next[capturerId] ?? [])];
    next[victimId] = [];
  }
  return next;
}

/** A dead player carries no chain of their own — belt-and-braces beyond `applyCaptureEvents`. */
export function clearDeadChains(chains: ChainMap, aliveIds: ReadonlySet<string>): ChainMap {
  let changed = false;
  const next = { ...chains };
  for (const id of Object.keys(next)) {
    if (!aliveIds.has(id) && next[id].length > 0) {
      next[id] = [];
      changed = true;
    }
  }
  return changed ? next : chains;
}

/**
 * Append a head position to a movement history, skipping a repeat when the
 * player held still this tick. Pass `maxLen` (the chain length + 1) to trim
 * the history to exactly enough consecutive cells to seat every trailing
 * avatar with no gaps; omit it to keep the whole history (used when replaying
 * a match from frame 0, where the final chain length isn't known yet).
 */
export function appendHeadHistory(history: readonly Vec2[], head: Vec2, maxLen?: number): Vec2[] {
  const last = history[history.length - 1];
  const next = last && last.row === head.row && last.col === head.col ? (history as Vec2[]) : [...history, { row: head.row, col: head.col }];
  return maxLen !== undefined && next.length > maxLen ? next.slice(next.length - maxLen) : next;
}

/**
 * Where each chain link sits, closest to the head first — one per consecutive
 * cell of `history`, working backward from the head (`history`'s last entry).
 * Bunches up at the oldest recorded cell if the history isn't deep enough yet
 * (e.g. right after a capture, or a respawn).
 */
export function chainPositions(history: readonly Vec2[], chainLength: number): Vec2[] {
  const positions: Vec2[] = [];
  for (let i = 0; i < chainLength; i++) {
    const pos = history[Math.max(0, history.length - 2 - i)];
    if (pos) positions.push(pos);
  }
  return positions;
}
