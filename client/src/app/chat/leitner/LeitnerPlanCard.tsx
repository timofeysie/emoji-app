import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '../../shared/button';
import { cn } from '../../shared/utils';
import { REASON_STYLES, scopeLabel, type LeitnerRefusal, type LeitnerScope, type LeitnerSetup, type Plan, type Player } from '../../views/leitner';
import { createLeitnerGame, LeitnerRefusedError, listPlayers, planLeitnerGame, type LeitnerGameRequest } from './leitner-chat-api';

const SHOWN = 10;

export type LeitnerPlanProps = {
  playerId: string;
  book: string;
  chapter: string;
  scope: string;
  /** Comma-separated, e.g. "reading,writing". */
  aspects: string;
  seed: number;
  now: string;
};

/** Created games by plan, so a re-rendered card shows the game instead of offering Create again. */
function createdKey(props: LeitnerPlanProps): string {
  return `leitner-plan-created:${props.playerId}:${props.book}:${props.chapter}:${props.seed}:${props.now}`;
}

function rememberedGame(props: LeitnerPlanProps): string | null {
  try {
    return sessionStorage.getItem(createdKey(props));
  } catch {
    return null;
  }
}

function requestOf(props: LeitnerPlanProps): LeitnerGameRequest {
  const aspects = props.aspects.split(',').map((aspect) => aspect.trim()).filter(Boolean);
  return {
    playerId: props.playerId,
    book: props.book,
    chapter: props.chapter,
    scope: (props.scope === 'chapter' ? 'chapter' : 'review') as LeitnerScope,
    aspects: aspects.length ? aspects : ['reading', 'writing'],
    ...(Number.isFinite(props.seed) && props.seed > 0 ? { seed: Math.round(props.seed) } : {}),
    ...(props.now && !Number.isNaN(Date.parse(props.now)) ? { now: props.now } : {}),
  };
}

/**
 * A Leitner game plan in the chat (docs/hashbrown/creating-games-with-hashbrown.md
 * → `createLeitnerGame`, H3): the card re-plans from its props (a dry run with
 * the same seed and time, so it shows exactly what Create makes), and only the
 * referee's click creates the game (G1). Works for built-in and library books.
 */
export function LeitnerPlanCard(props: LeitnerPlanProps) {
  const navigate = useNavigate();
  const { playerId, book, chapter, scope, aspects, seed, now } = props;
  // By value: the chat re-renders the card with new props objects while it streams.
  const request = useMemo(
    () => requestOf({ playerId, book, chapter, scope, aspects, seed, now }),
    [playerId, book, chapter, scope, aspects, seed, now],
  );
  const [plan, setPlan] = useState<Plan | null>(null);
  const [setup, setSetup] = useState<LeitnerSetup | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [refusal, setRefusal] = useState<LeitnerRefusal | null>(null);
  const [gameId, setGameId] = useState<string | null>(() => rememberedGame(props));
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listPlayers()
      .then((players) => !cancelled && setPlayer(players.find((p) => p.id === request.playerId) ?? null))
      .catch(() => undefined);
    if (gameId) return;
    planLeitnerGame(request)
      .then((planned) => {
        if (cancelled) return;
        setPlan(planned.plan);
        setSetup(planned.setup ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRefusal(
          error instanceof LeitnerRefusedError
            ? error.refusal
            : { message: error instanceof Error ? error.message : 'Could not plan the game.', gameIds: [], action: null },
        );
      });
    return () => {
      cancelled = true;
    };
    // The game id only matters on mount: once created, the card stops planning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const onCreate = async () => {
    if (!plan) return;
    setCreating(true);
    setRefusal(null);
    try {
      // The plan's own seed and time, so the game is the one shown.
      const created = await createLeitnerGame({ ...request, seed: plan.seed, now: plan.now });
      try {
        sessionStorage.setItem(createdKey(props), created.gameId);
      } catch {
        // Only a convenience: without it a re-rendered card offers Create again.
      }
      setGameId(created.gameId);
      navigate(`/games/${created.gameId}`);
    } catch (error) {
      if (error instanceof LeitnerRefusedError) {
        setRefusal(error.refusal);
        if (error.plan) setPlan(error.plan);
      } else {
        setRefusal({ message: 'Network error — could not create the game.', gameIds: [], action: null });
      }
    } finally {
      setCreating(false);
    }
  };

  const who = player ? `${player.firstName} (${player.label})` : 'the student';
  const where = `${plan?.book ?? request.book}, chapter ${request.chapter}`;

  if (gameId) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border bg-background p-3 text-sm text-foreground">
        <span className="flex items-center gap-2 font-semibold">
          <GraduationCap className="h-4 w-4 text-muted-foreground" aria-hidden /> Leitner game created for {who}
        </span>
        <Link className="inline-flex w-fit items-center gap-1 text-xs font-medium underline" to={`/games/${gameId}`}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open the game
        </Link>
      </div>
    );
  }

  const picks = plan?.picks ?? [];
  const shown = showAll ? picks : picks.slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="font-semibold">Leitner game for {who}</span>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">plan</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {where} · {scopeLabel(request.scope)} · {request.aspects.join(', ')}
      </p>

      {!plan && !refusal && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Planning…
        </p>
      )}

      {plan && picks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing to ask: every word in scope is retired or not due yet.
        </p>
      )}
      {picks.length > 0 && (
        <ol className="flex flex-col gap-0.5 text-sm">
          {shown.map((pick, i) => (
            <li key={`${pick.learningObjectId}-${pick.aspect}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-semibold text-muted-foreground">{i + 1}.</span>
              <span lang="ko">{pick.word}</span>
              <span className="text-xs text-muted-foreground">{pick.gloss}</span>
              <span className="text-[11px] capitalize text-muted-foreground">{pick.aspect}</span>
              <span className={cn('rounded px-1 text-[10px]', REASON_STYLES[pick.reason])}>{pick.reason}</span>
              {pick.chapter && pick.chapter !== plan?.chapter && (
                <span className="text-[10px] text-muted-foreground">ch. {pick.chapter}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {picks.length > SHOWN && (
        <button type="button" className="w-fit text-xs underline" onClick={() => setShowAll((all) => !all)}>
          {showAll ? 'Show fewer' : `Show all ${picks.length}`}
        </button>
      )}

      {setup && (setup.station || setup.cardGroup || setup.notes.length > 0) && (
        <p className="text-[11px] text-muted-foreground">
          {setup.station && `Presets ${setup.station.badgeName} at ${setup.station.stationName}. `}
          {setup.cardGroup && `Card group ${setup.cardGroup.name}. `}
          {setup.notes.join(' ')}
        </p>
      )}
      {plan && plan.supersedes.length > 0 && (
        <p className="text-[11px] text-amber-700">
          Creating replaces {plan.supersedes.length} unplayed Leitner game{plan.supersedes.length === 1 ? '' : 's'} for this student.
        </p>
      )}

      {refusal && (
        <div className="flex flex-col gap-1 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <p>{refusal.message}</p>
          {refusal.action &&
            refusal.gameIds.map((id) => (
              <Link key={id} className="w-fit underline" to={`/games/${id}`}>
                {refusal.action}
              </Link>
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!plan || picks.length === 0 || creating} onClick={() => void onCreate()}>
          {creating ? <Loader2 className="animate-spin" aria-hidden /> : <GraduationCap aria-hidden />}
          Create game
        </Button>
      </div>
    </div>
  );
}
