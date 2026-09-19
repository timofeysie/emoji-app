import { useMemo } from "react";
import { rankPlayers, type PlayerRanking } from "./recordStats";
import type { LandGrabGameRecord } from "./gameRecord";

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

function breakdown(row: PlayerRanking): string {
  return [
    `${row.matches} match${row.matches === 1 ? "" : "es"}`,
    `${row.wins}W (${pct(row.winRate)})`,
    `avg peak ${pct(row.avgPeakFraction)}`,
    `best ${pct(row.bestPeakFraction)}`,
    `captures ${row.captures} / sunk ${row.timesCaptured}`,
  ].join(" · ");
}

/**
 * Aggregate leaderboard for every player across all stored matches, drawn as a
 * ranked horizontal bar chart. Bar length is the composite `rating` (see
 * {@link rankPlayers}); the row order is the ranking. Each bar is filled with the
 * player's own colour, and identity is also carried by the dot + name so it never
 * rests on colour alone.
 */
export function MatchRecordsChart({ records }: { records: LandGrabGameRecord[] }) {
  const ranked = useMemo(() => rankPlayers(records), [records]);
  const maxRating = useMemo(
    () => Math.max(0.0001, ...ranked.map((row) => row.rating)),
    [ranked],
  );

  if (ranked.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No players to rank yet — finish a game to log one.
      </p>
    );
  }

  return (
    <div data-testid="match-records-chart">
      <p className="text-xs text-muted-foreground mb-4">
        Ranked by <span className="text-foreground font-medium">rating</span> — per match, a win
        scores <span className="tabular-nums">1.0</span>, peak board share adds up to another{" "}
        <span className="tabular-nums">1.0</span>, and each capture / sinking nudges it{" "}
        <span className="tabular-nums">±0.05</span>; averaged over the games played.
      </p>

      <ol className="flex flex-col gap-3">
        {ranked.map((row) => {
          const width = `${Math.max(0, Math.min(1, row.rating / maxRating)) * 100}%`;
          return (
            <li key={row.id} className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1" title={breakdown(row)}>
              <span className="row-span-2 text-sm tabular-nums text-muted-foreground pt-0.5 text-right">
                {row.rank}
              </span>

              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-sm text-foreground font-medium truncate">{row.label}</span>
                {!row.isBot && <span className="text-xs text-muted-foreground shrink-0">you</span>}
                <span className="ml-auto text-sm tabular-nums text-foreground shrink-0">
                  {row.rating.toFixed(2)}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width, backgroundColor: row.color }}
                  />
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">{breakdown(row)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
