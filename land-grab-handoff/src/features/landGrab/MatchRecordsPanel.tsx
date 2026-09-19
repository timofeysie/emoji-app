import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clearGameRecords,
  loadGameRecords,
  MAX_STORED_GAME_RECORDS,
  type LandGrabGameRecord,
  type LandGrabPlayerRecord,
} from "./gameRecord";
import { MatchRecordsChart } from "./MatchRecordsChart";

/** `mm:ss` from a millisecond duration. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Short local date + time, e.g. `10 Sep, 12:15`. */
function formatEndedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Standing({ player, isWinner }: { player: LandGrabPlayerRecord; isWinner: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
        style={{ backgroundColor: player.color }}
      />
      <span className={isWinner ? "text-foreground font-medium" : "text-muted-foreground"}>
        {player.label}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {player.peakOwnedCount} ({Math.round(player.peakOwnedFraction * 100)}%) peak
      </span>
      {player.timesCaptured > 0 && (
        <span className="tabular-nums text-destructive">· sunk {player.timesCaptured}×</span>
      )}
      {player.peakChainLength > 0 && (
        <span className="tabular-nums text-muted-foreground">· chain {player.peakChainLength}</span>
      )}
    </span>
  );
}

function RecordsTable({ records }: { records: LandGrabGameRecord[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pr-4 font-medium">Winner</th>
            <th className="py-2 pr-4 font-medium text-right">Score</th>
            <th className="py-2 pr-4 font-medium text-right">Cells</th>
            <th className="py-2 pr-4 font-medium text-right">Captures</th>
            <th className="py-2 pr-4 font-medium text-right">Ticks</th>
            <th className="py-2 pr-4 font-medium text-right">Time</th>
            <th className="py-2 pr-4 font-medium text-right">Board</th>
            <th className="py-2 font-medium">Standings (peak cells · times sunk)</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => {
            const standings = [...record.players].sort((a, b) => b.peakOwnedCount - a.peakOwnedCount);
            return (
              <tr key={`${record.endedAt}-${index}`} className="border-t border-border align-top">
                <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                  {formatEndedAt(record.endedAt)}
                </td>
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span
                      className="w-3 h-3 rounded-full inline-block shrink-0"
                      style={{ backgroundColor: record.winner.color }}
                    />
                    <span className="text-foreground font-medium">{record.winner.label}</span>
                  </span>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-foreground font-medium">
                  {record.winner.score.toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-foreground">
                  {record.winner.ownedCount} ({Math.round(record.winner.ownedFraction * 100)}%)
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-foreground">
                  {record.winner.captures}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-foreground">{record.ticks}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-foreground">
                  {formatDuration(record.durationMs)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                  {record.board.cols}×{record.board.rows}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {standings.map((player) => (
                      <Standing
                        key={player.id}
                        player={player}
                        isWinner={player.id === record.winner.id}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MatchRecordsPanel() {
  const [records, setRecords] = useState<LandGrabGameRecord[]>(() => loadGameRecords());

  const refresh = useCallback(() => setRecords(loadGameRecords()), []);
  const clear = useCallback(() => {
    clearGameRecords();
    setRecords([]);
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4" data-testid="match-records-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <h3 className="text-sm font-semibold text-foreground">Match records</h3>
        <p className="text-xs text-muted-foreground">
          Finished matches saved to this browser (<code>landgrab:game-records</code>), newest first, capped at{" "}
          {MAX_STORED_GAME_RECORDS}.
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={refresh}
            className="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Refresh
          </button>
          <button
            onClick={clear}
            disabled={records.length === 0}
            className="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear all
          </button>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches recorded yet — finish a game to log one.</p>
      ) : (
        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="chart">Leaderboard</TabsTrigger>
          </TabsList>
          <TabsContent value="table">
            <RecordsTable records={records} />
          </TabsContent>
          <TabsContent value="chart">
            <MatchRecordsChart records={records} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
