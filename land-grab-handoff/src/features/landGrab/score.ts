/**
 * A single "total score" number combining territory held and rivals eliminated.
 * Pulled out of `gameRecord.ts` and `LandGrabDemo.tsx` so both the live HUD
 * (current match) and the stored record (final tally) compute it identically.
 */

/**
 * A captured rival is worth one *even share* of the board — `totalCells /
 * playerCount` — on top of whatever cells the capturing player currently
 * holds. That deliberately weights eliminations far above ordinary territory
 * gain (sinking one rival in a 4-player match is worth as much as owning a
 * clean quarter of the board) without letting a single capture eclipse the
 * board entirely, and it scales automatically with board size and player
 * count instead of needing a hand-tuned constant per map.
 */
export function captureValue(totalCells: number, playerCount: number): number {
  return playerCount > 0 ? totalCells / playerCount : 0;
}

/**
 * `ownedCount` cells plus one {@link captureValue} per rival currently
 * trailing this player, rounded to a whole number for display and storage.
 *
 * `capturedCount` is meant to be the player's *current* captured-avatar chain
 * length (`chainTrail.ts`'s `ChainMap`), not the lifetime `captures` counter
 * on `PlayerState` — the chain resets to `0` the instant this player is
 * themself captured, so the bonus rewards holding an active capture streak
 * rather than just having captured someone at some point. Combined with
 * `ownedCount` also being the player's *current* (not peak) cell count, a
 * sunk player's score falls back to nothing until they capture again.
 */
export function computeTotalScore(
  ownedCount: number,
  capturedCount: number,
  totalCells: number,
  playerCount: number,
): number {
  return Math.round(ownedCount + capturedCount * captureValue(totalCells, playerCount));
}
