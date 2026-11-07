import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, GraduationCap, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '../shared/button';
import { cn } from '../shared/utils';
import {
  dueLabel,
  errorBody,
  errorText,
  levelLabel,
  type Level,
  type Player,
  type TrackStatus,
} from './leitner';

/** `GET /api/players/:id/activity` (server/src/learning/player-activity.ts). */
type ActivitySession = {
  gameId: string;
  title: string | null;
  kind: string;
  firstAnswerAt: string | null;
  lastAnswerAt: string | null;
  answered: number;
  correct: number;
  score: { raw: number; max: number } | null;
  chapters: string[];
};

type ActivityAnswer = {
  statementId: string;
  timestamp: string;
  gameId: string | null;
  kind: string;
  question: string;
  response: string | null;
  correctAnswer: string | null;
  success: boolean;
  aspect: string | null;
  chapter: string | null;
  durationSeconds: number | null;
};

type ActivityTrack = {
  learningObjectId: string;
  aspect: string;
  status: TrackStatus;
  level: Level;
  dueAt: string | null;
  lastSeenAt: string | null;
  seenCount: number;
  correctCount: number;
  incorrectCount: number;
  due: boolean;
  word: string | null;
  gloss: string | null;
};

type LeitnerGameRow = {
  gameId: string;
  state: string;
  endedAt: string | null;
  guessCount: number;
  exportError: string | null;
};

type PlayerActivity = {
  asOf: string;
  statementCount: number;
  leitnerGames: LeitnerGameRow[];
  summary: {
    games: number;
    answered: number;
    correct: number;
    firstActivityAt: string | null;
    lastActivityAt: string | null;
    words: number;
    tracks: number;
    active: { L0: number; L1: number; L2: number; L3: number };
    retired: number;
    due: number;
  };
  sessions: ActivitySession[];
  recentAnswers: ActivityAnswer[];
  tracks: ActivityTrack[];
};

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function percent(correct: number, total: number): string {
  return total > 0 ? `${Math.round((correct / total) * 100)}%` : '—';
}

function KindChip({ kind }: { kind: string }) {
  if (kind !== 'leitner-solo') {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        class
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
      <GraduationCap className="h-3 w-3" aria-hidden />
      Leitner
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PlayerDetailView() {
  const { playerId } = useParams<{ playerId: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [activity, setActivity] = useState<PlayerActivity | null>(null);
  const [leitnerGames, setLeitnerGames] = useState<LeitnerGameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!playerId) return;
    setLoading(true);
    setPlayerError(null);
    setActivityError(null);
    try {
      const [playerRes, activityRes] = await Promise.all([
        fetch(`/api/players/${playerId}`, { credentials: 'same-origin' }),
        fetch(`/api/players/${playerId}/activity`, { credentials: 'same-origin' }),
      ]);
      if (playerRes.ok) {
        setPlayer(((await playerRes.json()) as { player: Player }).player);
      } else {
        setPlayerError(errorText(await errorBody(playerRes), playerRes.status));
      }
      const body = await errorBody(activityRes);
      if (activityRes.ok) {
        const data = body as unknown as PlayerActivity;
        setActivity(data);
        setLeitnerGames(data.leitnerGames);
      } else {
        setActivity(null);
        // 503 (no LRS) still lists the games in our database.
        setLeitnerGames(Array.isArray(body['leitnerGames']) ? (body['leitnerGames'] as LeitnerGameRow[]) : []);
        setActivityError(errorText(body, activityRes.status));
      }
    } catch {
      setPlayerError('Could not reach server.');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex items-center justify-between gap-2 py-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/players">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
            Players
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          Refresh
        </Button>
      </div>

      {playerError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {playerError}
        </div>
      )}

      {player && (
        <div>
          <p className="text-2xl font-bold">{player.firstName}</p>
          <p className="text-xs text-muted-foreground">
            {player.label}
            <span className="ml-2 font-mono text-[10px]" title="xAPI actor account name">
              {player.externalId}
            </span>
          </p>
        </div>
      )}

      <LeitnerGamesNotice games={leitnerGames} />

      {activityError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Couldn&apos;t load activity from the LRS: {activityError}
        </div>
      )}

      {loading && !activity && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Reading statements from the LRS…
        </div>
      )}

      {activity && <ActivityBody activity={activity} />}
    </div>
  );
}

/** Leitner games for this student still in our database: pending export, in play, or not played yet. */
function LeitnerGamesNotice({ games }: { games: LeitnerGameRow[] }) {
  if (games.length === 0) return null;
  const describe = (game: LeitnerGameRow): string => {
    if (game.state === 'completed') return `Export pending${game.exportError ? `: ${game.exportError}` : ''}`;
    if (game.state === 'active' || game.state === 'paused') return `Being played (${game.state})`;
    if (game.state === 'cancelled') return 'Cancelled';
    return `Not played yet (${game.state})`;
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm">
      <p className="text-xs font-semibold">Leitner games not in the LRS yet</p>
      {games.map((game) => (
        <Link
          key={game.gameId}
          to={`/games/${game.gameId}`}
          className={cn(
            'flex items-start gap-1.5 text-xs hover:underline',
            game.state === 'completed' && 'text-amber-800',
          )}
        >
          {game.state === 'completed' && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span>
            {describe(game)}
            {game.guessCount > 0 && ` · ${game.guessCount} answers`}
          </span>
        </Link>
      ))}
    </div>
  );
}

function ActivityBody({ activity }: { activity: PlayerActivity }) {
  const { summary } = activity;
  const tiles: Array<[string, string]> = [
    ['Games', String(summary.games)],
    ['Answers', String(summary.answered)],
    ['Correct', percent(summary.correct, summary.answered)],
    ['Words tracked', String(summary.words)],
    ['Due now', `${summary.due} of ${summary.tracks}`],
    ['Retired', `${summary.retired} of ${summary.tracks}`],
  ];

  if (activity.statementCount === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No statements in the LRS for this player yet. Games show here once they&apos;re exported.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card px-3 py-2">
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-[11px] text-muted-foreground">
        Last active {formatDateTime(summary.lastActivityAt)} · first {formatDateTime(summary.firstActivityAt)} ·{' '}
        {activity.statementCount} statements · as of {formatDateTime(activity.asOf)}
      </p>

      {activity.tracks.length > 0 && <LevelsSection activity={activity} />}
      <SessionsSection sessions={activity.sessions} />
      <AnswersSection answers={activity.recentAnswers} total={summary.answered} />
    </>
  );
}

const LEVEL_CELLS: Array<{ key: 'L0' | 'L1' | 'L2' | 'L3' | 'retired'; className: string }> = [
  { key: 'L0', className: 'bg-red-200' },
  { key: 'L1', className: 'bg-amber-200' },
  { key: 'L2', className: 'bg-lime-200' },
  { key: 'L3', className: 'bg-emerald-300' },
  { key: 'retired', className: 'bg-emerald-600' },
];

/** Leitner boxes across every chapter, then word × aspect. */
function LevelsSection({ activity }: { activity: PlayerActivity }) {
  const { summary } = activity;
  const counts = { ...summary.active, retired: summary.retired };
  const aspects = useMemo(() => [...new Set(activity.tracks.map((track) => track.aspect))].sort(), [activity.tracks]);
  const rows = useMemo(() => {
    const byObject = new Map<string, { word: string; gloss: string; byAspect: Map<string, ActivityTrack> }>();
    for (const track of activity.tracks) {
      const row = byObject.get(track.learningObjectId) ?? {
        word: track.word ?? track.learningObjectId.split('/')[2] ?? track.learningObjectId,
        gloss: track.gloss ?? '',
        byAspect: new Map<string, ActivityTrack>(),
      };
      row.byAspect.set(track.aspect, track);
      byObject.set(track.learningObjectId, row);
    }
    return [...byObject.entries()];
  }, [activity.tracks]);

  return (
    <Section title={`Leitner levels · ${summary.tracks} tracks (word × aspect)`}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {LEVEL_CELLS.map(({ key, className }) =>
          counts[key] > 0 ? (
            <div key={key} className={className} style={{ width: `${(counts[key] / summary.tracks) * 100}%` }} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LEVEL_CELLS.map(({ key, className }) => (
          <span key={key} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
            <span className={cn('h-2 w-2 rounded-full', className)} aria-hidden />
            <span className="font-semibold tabular-nums">{counts[key]}</span>
            <span className="text-muted-foreground">{key}</span>
          </span>
        ))}
      </div>
      <details className="rounded-md border text-sm">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium">
          {rows.length} word{rows.length === 1 ? '' : 's'} by aspect
        </summary>
        <div className="max-h-80 overflow-auto border-t">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground">
                <th className="px-2.5 py-1 font-medium">Word</th>
                {aspects.map((aspect) => (
                  <th key={aspect} className="px-2.5 py-1 font-medium capitalize">
                    {aspect}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([id, row]) => (
                <tr key={id} className="border-t">
                  <td className="px-2.5 py-1">
                    <span className="font-medium">{row.word}</span>{' '}
                    <span className="text-muted-foreground">{row.gloss}</span>
                  </td>
                  {aspects.map((aspect) => {
                    const track = row.byAspect.get(aspect);
                    return (
                      <td key={aspect} className="px-2.5 py-1 tabular-nums">
                        {track ? (
                          <span
                            title={`${track.correctCount} right, ${track.incorrectCount} wrong · last seen ${formatDateTime(track.lastSeenAt)}`}
                            className={cn(
                              track.status === 'retired' && 'text-emerald-700',
                              track.due && track.status === 'active' && 'font-semibold',
                            )}
                          >
                            {levelLabel(track)}
                            {dueLabel(track) && (
                              <span className="ml-1 text-[10px] text-muted-foreground">{dueLabel(track)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Section>
  );
}

function SessionsSection({ sessions }: { sessions: ActivitySession[] }) {
  return (
    <Section title="Games">
      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No games yet.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-md border text-sm">
          {sessions.map((session) => {
            const score = session.score ?? { raw: session.correct, max: session.answered };
            return (
              <li key={session.gameId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{session.title ?? `Game ${session.gameId.slice(-6)}`}</span>
                    <KindChip kind={session.kind} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(session.lastAnswerAt ?? session.firstAnswerAt)}
                    {session.chapters.length > 0 && ` · ch. ${session.chapters.join(', ')}`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {score.raw}/{score.max}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{percent(score.raw, score.max)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function AnswersSection({ answers, total }: { answers: ActivityAnswer[]; total: number }) {
  return (
    <Section title={total > answers.length ? `Recent answers (latest ${answers.length} of ${total})` : 'Answers'}>
      {answers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No answers yet.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-md border text-sm">
          {answers.map((answer) => (
            <li key={answer.statementId} className="flex items-start gap-2 px-3 py-1.5">
              {answer.success ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Correct" />
              ) : (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="Wrong" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate">{answer.question}</p>
                <p className="text-[11px] text-muted-foreground">
                  {answer.success ? (
                    <>Answered {answer.response ?? '—'}</>
                  ) : (
                    <>
                      Answered <span className="text-red-700">{answer.response ?? '—'}</span> · correct:{' '}
                      {answer.correctAnswer ?? '—'}
                    </>
                  )}
                </p>
              </div>
              <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                <p>{formatDateTime(answer.timestamp)}</p>
                <p>
                  {[answer.aspect, answer.chapter && `ch. ${answer.chapter}`, answer.durationSeconds !== null && `${answer.durationSeconds}s`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
