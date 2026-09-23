import type { LandGrabGameRecord } from "./gameRecord";

/**
 * Aggregate leaderboard stats for one player (a bot or a human), summed across
 * every stored match they appeared in. Players are grouped by their stable `id`
 * (`you`, `bot-red`, …); the most recent match supplies the `label` and `color`
 * so a renamed human still collapses to a single row.
 */
export interface PlayerRanking {
  id: string;
  label: string;
  /** `#rrggbb`, from the player's most recent match. */
  color: string;
  isBot: boolean;
  /** Matches this player took part in. */
  matches: number;
  /** Matches this player won. */
  wins: number;
  /** `wins / matches`, 0..1. */
  winRate: number;
  /** Mean `peakOwnedFraction` across their matches, 0..1. */
  avgPeakFraction: number;
  /** Best single-match `peakOwnedFraction`, 0..1. */
  bestPeakFraction: number;
  /** Total rival trails this player cut. */
  captures: number;
  /** Total times a rival sank this player. */
  timesCaptured: number;
  /** `captures - timesCaptured`. Positive = cut more than they were cut. */
  captureDiff: number;
  /** Composite score — see {@link RATING_WEIGHTS} and {@link matchRating}. */
  rating: number;
  /** 1-based position after sorting by rating (ties broken deterministically). */
  rank: number;
}

/**
 * How a single match contributes to a player's rating. Winning is worth one full
 * point; holding the whole board at your peak is worth another; cutting and being
 * cut nudge it a little either way. A player's `rating` is the mean of this over
 * their matches, so a long unbeaten run and a single lucky win aren't equal.
 */
export const RATING_WEIGHTS = {
  win: 1,
  peakFraction: 1,
  capture: 0.05,
  captured: 0.05,
} as const;

interface MatchLine {
  won: boolean;
  peakOwnedFraction: number;
  captures: number;
  timesCaptured: number;
}

/** One match's contribution to a player's rating. */
export function matchRating(line: MatchLine): number {
  return (
    (line.won ? RATING_WEIGHTS.win : 0) +
    line.peakOwnedFraction * RATING_WEIGHTS.peakFraction +
    line.captures * RATING_WEIGHTS.capture -
    line.timesCaptured * RATING_WEIGHTS.captured
  );
}

interface Accum {
  id: string;
  label: string;
  color: string;
  isBot: boolean;
  matches: number;
  wins: number;
  peakFractionSum: number;
  bestPeakFraction: number;
  captures: number;
  timesCaptured: number;
  ratingSum: number;
}

/**
 * Turn the stored match list into a ranked leaderboard, best first.
 *
 * Records are assumed newest-first (the order `loadGameRecords` returns), so the
 * first time a player id is seen wins the `label`/`color`. Sorting is by `rating`
 * descending, then win rate, then average peak share, then label — so the order
 * is stable and total even when ratings tie.
 */
export function rankPlayers(records: LandGrabGameRecord[]): PlayerRanking[] {
  const byId = new Map<string, Accum>();

  for (const record of records) {
    for (const player of record.players) {
      let acc = byId.get(player.id);
      if (!acc) {
        acc = {
          id: player.id,
          label: player.label,
          color: player.color,
          isBot: player.isBot,
          matches: 0,
          wins: 0,
          peakFractionSum: 0,
          bestPeakFraction: 0,
          captures: 0,
          timesCaptured: 0,
          ratingSum: 0,
        };
        byId.set(player.id, acc);
      }

      const won = player.id === record.winner.id;
      acc.matches += 1;
      if (won) acc.wins += 1;
      acc.peakFractionSum += player.peakOwnedFraction;
      acc.bestPeakFraction = Math.max(acc.bestPeakFraction, player.peakOwnedFraction);
      acc.captures += player.captures;
      acc.timesCaptured += player.timesCaptured;
      acc.ratingSum += matchRating({
        won,
        peakOwnedFraction: player.peakOwnedFraction,
        captures: player.captures,
        timesCaptured: player.timesCaptured,
      });
    }
  }

  const ranked: PlayerRanking[] = [...byId.values()]
    .map((acc) => {
      const winRate = acc.matches > 0 ? acc.wins / acc.matches : 0;
      const avgPeakFraction = acc.matches > 0 ? acc.peakFractionSum / acc.matches : 0;
      return {
        id: acc.id,
        label: acc.label,
        color: acc.color,
        isBot: acc.isBot,
        matches: acc.matches,
        wins: acc.wins,
        winRate,
        avgPeakFraction,
        bestPeakFraction: acc.bestPeakFraction,
        captures: acc.captures,
        timesCaptured: acc.timesCaptured,
        captureDiff: acc.captures - acc.timesCaptured,
        rating: acc.matches > 0 ? acc.ratingSum / acc.matches : 0,
        rank: 0,
      };
    })
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        b.winRate - a.winRate ||
        b.avgPeakFraction - a.avgPeakFraction ||
        a.label.localeCompare(b.label),
    );

  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });

  return ranked;
}
