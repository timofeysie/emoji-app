import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Award, Loader2, Minus, RefreshCw } from 'lucide-react';
import { Button } from '../../shared/button';
import { cn } from '../../shared/utils';
import {
  errorBody,
  errorText,
  levelLabel,
  scopeLabel,
  senseOf,
  wordOf,
  type LeitnerGameInfo,
  type LeitnerSummary,
  type Player,
  type TrackChange,
} from '../leitner';

export type LeitnerExported = { statementsSent: number; summary: LeitnerSummary | null };

/** The student's player record, for the first name (shown only inside the app). */
export function useLeitnerPlayer(playerId: string | undefined): Player | null {
  const [player, setPlayer] = useState<Player | null>(null);
  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/players', { credentials: 'same-origin' });
        if (!res.ok || cancelled) return;
        const { players } = (await res.json()) as { players: Player[] };
        if (!cancelled) setPlayer(players.find((p) => p.id === playerId) ?? null);
      } catch {
        // the label from the title still identifies the game
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId]);
  return player;
}

/**
 * Referee sidebar for a `leitner-solo` game: who it's for, what was
 * planned, and its export. A completed Leitner game that's still stored
 * is pending export: Retry sends it again, and success deletes it
 * (docs/xAPI/leitner-method.md → lifecycle).
 */
export function LeitnerGamePanel({
  gameId,
  state,
  leitner,
  player,
  exportError,
  exportAttemptedAt,
  onExported,
}: {
  gameId: string;
  state: string;
  leitner: LeitnerGameInfo;
  player: Player | null;
  exportError: string | null;
  exportAttemptedAt: string | null;
  onExported: (result: LeitnerExported) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const pendingExport = state === 'completed';

  const retryExport = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/xapi-export`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await errorBody(res);
      if (!res.ok) {
        setRetryError(errorText(body, res.status));
        return;
      }
      onExported({
        statementsSent: Number(body['statementsSent'] ?? 0),
        summary: (body['summary'] as LeitnerSummary | undefined) ?? null,
      });
    } catch {
      setRetryError('Network error — could not export.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Leitner Game
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Student</dt>
        <dd>
          {player ? (
            <>
              <span className="font-medium">{player.firstName}</span>{' '}
              <span className="text-[11px] tabular-nums text-muted-foreground">{player.label}</span>
            </>
          ) : (
            <span className="text-muted-foreground">…</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Chapter</dt>
        <dd>{leitner.chapter}</dd>
        <dt className="text-muted-foreground">Scope</dt>
        <dd>{scopeLabel(leitner.scope)}</dd>
      </dl>

      {pendingExport ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <strong>Export pending.</strong> The LRS doesn&apos;t have this game yet, so the
              student&apos;s next game can&apos;t be planned.
              {exportError && <span className="mt-1 block font-mono text-[11px]">{exportError}</span>}
              {exportAttemptedAt && (
                <span className="mt-1 block text-[10px] text-amber-800">
                  Last tried {new Date(exportAttemptedAt).toLocaleString()}
                </span>
              )}
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 self-start bg-background text-xs"
            onClick={() => void retryExport()}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
            )}
            Retry export
          </Button>
          {retryError && <p className="text-destructive">{retryError}</p>}
        </div>
      ) : state === 'cancelled' ? (
        <p className="text-xs text-muted-foreground">
          Cancelled: its answers are discarded. The student&apos;s next Leitner game replaces it.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Single-use. When it ends, it&apos;s exported to the LRS and deleted.
        </p>
      )}
    </div>
  );
}

const CHANGE_ORDER: TrackChange['change'][] = ['retired', 'promoted', 'demoted', 'unchanged'];

const CHANGE_STYLES: Record<TrackChange['change'], { label: string; className: string; icon: typeof ArrowUp }> = {
  retired: { label: 'Retired', className: 'text-emerald-700', icon: Award },
  promoted: { label: 'Promoted', className: 'text-green-700', icon: ArrowUp },
  demoted: { label: 'Demoted', className: 'text-red-700', icon: ArrowDown },
  unchanged: { label: 'Unchanged', className: 'text-muted-foreground', icon: Minus },
};

/** End-of-game summary: the score and how each track moved. `forStudent` leaves out the LRS details. */
export function LeitnerSummaryCard({ result, forStudent = false }: { result: LeitnerExported; forStudent?: boolean }) {
  const { summary } = result;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          {summary
            ? `${summary.score.correct} / ${summary.score.total} correct`
            : 'Exported'}
        </p>
        {!forStudent && (
          <p className="text-[11px] text-muted-foreground">
            {result.statementsSent} statement{result.statementsSent === 1 ? '' : 's'} sent to the LRS
          </p>
        )}
      </div>

      {!summary || summary.changes === null ? (
        <p className="text-xs text-muted-foreground">
          Level changes aren&apos;t available (the student&apos;s earlier evidence couldn&apos;t be
          read). They&apos;ll show in the next plan.
        </p>
      ) : summary.changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No words were answered.</p>
      ) : (
        CHANGE_ORDER.map((change) => {
          const rows = summary.changes!.filter((row) => row.change === change);
          if (rows.length === 0) return null;
          const style = CHANGE_STYLES[change];
          const Icon = style.icon;
          return (
            <div key={change} className="flex flex-col gap-1">
              <p className={cn('flex items-center gap-1 text-xs font-semibold', style.className)}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {style.label} ({rows.length})
              </p>
              <ul className="flex flex-col gap-0.5 text-sm">
                {rows.map((row) => (
                  <li key={`${row.learningObjectId}:${row.aspect}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{wordOf(row.learningObjectId)}</span>{' '}
                      <span className="text-muted-foreground">{senseOf(row.learningObjectId).replace(/-/g, ' ')}</span>
                    </span>
                    <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{row.aspect}</span>
                    <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {levelLabel(row.from)} → {levelLabel(row.to)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
