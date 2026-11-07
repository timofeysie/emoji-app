import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Clock3,
  HelpCircle,
  Loader2,
  Pause,
  Play,
  ScanLine,
  Trophy,
  XCircle,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '../shared/button';
import { TextReveal } from '../shared/text-reveal';
import { getWsUrl } from '../shared/ws-url';
import { LeitnerSummaryCard, useLeitnerPlayer } from './components/LeitnerGamePanel';
import type { GameKind, LeitnerSummary } from './leitner';

type GameState =
  | 'draft'
  | 'ready'
  | 'lobby'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

type PlayQuestion = {
  id: string;
  text: string;
  sequence: number;
  answerOptions: Array<{
    id: string;
    slotLabel: string;
    text: string;
    sequence: number;
  }>;
};

type PreviousResult = {
  questionId: string;
  text: string;
  sequence: number;
  answerOptions: Array<{
    id: string;
    slotLabel: string;
    text: string;
    sequence: number;
    isCorrect: boolean;
  }>;
  scans: Array<{
    pairName: string;
    stationName?: string;
    cardLabel: string | null;
    slotLabel: string | null;
    isCorrect: boolean;
  }>;
};

type GamePlayDetail = {
  id: string;
  title: string;
  state: GameState;
  /** Absent on older servers: a class game. */
  kind?: GameKind;
  boundPairs: Array<{
    pairName: string;
    stationName?: string;
    readyForNextQuestion: boolean | null;
  }>;
  totalRounds: number;
  nextRoundSequence: number | null;
  /** Leitner games: the next round opens by itself (absent on older servers). */
  countdown?: { reason: 'start' | 'next'; opensInMs: number } | null;
  currentQuestion: PlayQuestion | null;
  previousResult: PreviousResult | null;
};

/** A Leitner game exported and deleted: `GET …/play` answers 410 with its results. */
type FinishedGame = {
  gameId: string;
  title: string;
  playerId: string;
  statementsSent: number;
  summary: LeitnerSummary;
};

const LIVE_STATES: GameState[] = ['lobby', 'active', 'paused'];
const REFRESH_MS = 5_000;
/** How long the answer stays on screen after a round closes. */
const REVEAL_MS = 5_000;
const stageSpring = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 24,
};

/**
 * A finished Leitner game, for the student: the badge's outcome (fireworks
 * for a win, rain otherwise; docs/real-time-game/game-modes.md), then the
 * same results the referee sees.
 */
function StudentResults({
  finished,
  studentName,
  onBack,
}: {
  finished: FinishedGame;
  studentName: string | null;
  onBack: () => void;
}) {
  const { score } = finished.summary;
  const won = score.correct > 0;
  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="ghost" className="w-fit" onClick={onBack}>
        <ChevronLeft aria-hidden />
        Games
      </Button>

      <motion.section
        initial={{ opacity: 0, scale: 0.9, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={stageSpring}
        className="flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center shadow-sm"
        aria-labelledby="student-results-heading"
      >
        <motion.span
          className="text-6xl leading-none"
          role="img"
          aria-label={won ? 'Fireworks' : 'Rain'}
          initial={{ scale: 0.3, rotate: -20 }}
          animate={{ scale: [0.3, 1.25, 1], rotate: [-20, 8, 0] }}
          transition={{ duration: 0.8, times: [0, 0.6, 1], ease: [0.22, 1, 0.36, 1] }}
        >
          {won ? '🎆' : '🌧️'}
        </motion.span>
        <h1 id="student-results-heading" className="mt-2 flex items-center gap-2 text-2xl font-bold">
          {won && <Trophy className="h-6 w-6 text-amber-500" aria-hidden />}
          {won ? 'Well done' : 'Keep practising'}
          {studentName ? `, ${studentName}` : ''}!
        </h1>
        <p className="text-lg tabular-nums">
          <span className="font-semibold">{score.correct}</span> of {score.total} correct
        </p>
        <p className="text-sm text-muted-foreground">
          {won
            ? 'Here’s how your words moved. Any you missed come back soon.'
            : 'These words come back in your next game.'}
        </p>
      </motion.section>

      <LeitnerSummaryCard
        result={{ statementsSent: finished.statementsSent, summary: finished.summary }}
        forStudent
      />

      <Button className="self-start" onClick={onBack}>
        Back to games
      </Button>
    </div>
  );
}

function unavailableMessage(state: GameState): string {
  if (state === 'draft' || state === 'ready') {
    return 'The referee must open this game for joining before student mode is available.';
  }
  if (state === 'completed') {
    return 'This game has ended.';
  }
  return 'This game was cancelled.';
}

/** Correct option green; options any player chose wrongly red, with who chose them. */
function RoundReveal({ result }: { result: PreviousResult }) {
  const pickedBy = (slotLabel: string) =>
    result.scans.filter((scan) => scan.slotLabel === slotLabel).map((scan) => scan.pairName);
  const optionSlots = new Set(result.answerOptions.map((option) => option.slotLabel));
  const notOnAnOption = result.scans.filter(
    (scan) => scan.slotLabel == null || !optionSlots.has(scan.slotLabel),
  );

  return (
    <motion.section
      key={`reveal-${result.questionId}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -28, scale: 0.92 }}
      transition={stageSpring}
      className="rounded-xl border bg-card p-5 shadow-sm"
      aria-labelledby="round-reveal-heading"
    >
      <p
        id="round-reveal-heading"
        className="mb-4 text-sm font-semibold uppercase tracking-wide text-primary"
      >
        Round {result.sequence} · answer
      </p>
      <h2 className="text-xl font-semibold leading-snug">{result.text}</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {result.answerOptions.map((option, index) => {
          const players = pickedBy(option.slotLabel);
          const wrong = !option.isCorrect && players.length > 0;
          return (
            <motion.div
              key={option.id}
              initial={{ opacity: 0.6, scale: 0.97 }}
              animate={{ opacity: option.isCorrect || wrong ? 1 : 0.55, scale: 1 }}
              transition={{ ...stageSpring, delay: 0.1 + index * 0.06 }}
              className={[
                'flex min-w-0 items-start gap-3 rounded-lg border-2 p-3',
                option.isCorrect
                  ? 'border-green-600 bg-green-50 dark:bg-green-950/40'
                  : wrong
                    ? 'border-red-600 bg-red-50 dark:bg-red-950/40'
                    : 'border-border bg-background',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                  option.isCorrect ? 'bg-green-600' : wrong ? 'bg-red-600' : 'bg-muted-foreground',
                ].join(' ')}
              >
                {option.slotLabel}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm font-medium">{option.text}</p>
                {players.length > 0 && (
                  <p className="mt-1 truncate text-xs capitalize text-muted-foreground">
                    {players.join(', ')}
                  </p>
                )}
              </div>
              {option.isCorrect ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-label="Correct answer" />
              ) : wrong ? (
                <XCircle className="h-5 w-5 shrink-0 text-red-600" aria-label="Chosen, wrong" />
              ) : null}
            </motion.div>
          );
        })}
      </div>
      {notOnAnOption.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {notOnAnOption
            .map((scan) =>
              scan.cardLabel ? `${scan.pairName}: ${scan.cardLabel}` : `${scan.pairName}: no answer`,
            )
            .join(' · ')}
        </p>
      )}
      <motion.div
        className="mt-4 h-1 rounded-full bg-primary/60"
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: REVEAL_MS / 1000, ease: 'linear' }}
        aria-hidden
      />
    </motion.section>
  );
}

/** Whole seconds left until `deadline` (a local Date.now() value), ticking. */
function useSecondsLeft(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Leitner games: "get ready" before the first round (and after Resume). */
function StartCountdown({ secondsLeft, round }: { secondsLeft: number; round: number | null }) {
  return (
    <motion.section
      key="start-countdown"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, y: -16 }}
      transition={stageSpring}
      className="rounded-xl border bg-card p-10 text-center shadow-sm"
      aria-live="polite"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">
        {round !== null && round > 1 ? `Round ${round} is coming` : 'The game is starting'}
      </p>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={secondsLeft}
          initial={{ opacity: 0, scale: 1.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          className="my-4 text-7xl font-bold tabular-nums"
        >
          {secondsLeft > 0 ? secondsLeft : 'Go!'}
        </motion.p>
      </AnimatePresence>
      <p className="text-sm text-muted-foreground">Get your cards ready.</p>
    </motion.section>
  );
}

function readinessLabel(ready: boolean | null): string {
  if (ready === true) return 'ready';
  if (ready === false) return 'wait';
  return 'awaiting response';
}

export function GamePlayView() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<GamePlayDetail | null>(null);
  const [finished, setFinished] = useState<FinishedGame | null>(null);
  const finishedPlayer = useLeitnerPlayer(finished?.playerId);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Question id whose answer is on screen; set when we see that round close.
  const [revealQuestionId, setRevealQuestionId] = useState<string | null>(null);
  const lastOpenQuestionIdRef = useRef<string | null>(null);
  // Local deadline for a Leitner countdown: Date.now() + opensInMs, so clock skew doesn't matter.
  const [countdownDeadline, setCountdownDeadline] = useState<number | null>(null);
  const [countdownReason, setCountdownReason] = useState<'start' | 'next' | null>(null);
  const secondsLeft = useSecondsLeft(countdownDeadline);

  const loadGame = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!gameId) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/games/${gameId}/play`, {
          credentials: 'same-origin',
        });
        if (res.status === 410) {
          const body = (await res.json().catch(() => ({}))) as { finished?: FinishedGame };
          if (body.finished) {
            setFinished(body.finished);
            setFetchError(null);
            return;
          }
        }
        if (!res.ok) {
          setFetchError(
            res.status === 404 ? 'Game not found.' : `Server returned ${res.status}.`,
          );
          return;
        }
        const detail = (await res.json()) as GamePlayDetail;
        setGame(detail);
        setFetchError(null);
        if (detail.countdown) {
          setCountdownDeadline(Date.now() + detail.countdown.opensInMs);
          setCountdownReason(detail.countdown.reason);
        } else {
          setCountdownDeadline(null);
          setCountdownReason(null);
        }
      } catch {
        setFetchError('Could not reach server.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [gameId],
  );

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  useEffect(() => {
    if (!gameId) return;
    const ws = new WebSocket(getWsUrl());
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          gameId?: string;
        };
        if (
          message.gameId === gameId &&
          (message.type === 'game.state.changed' ||
            message.type === 'question.opened' ||
            message.type === 'question.countdown' ||
            // A Leitner game is deleted once exported: reload for its results.
            message.type === 'game.deleted' ||
            message.type === 'question.closed' ||
            message.type === 'question.result' ||
            message.type === 'game.bindings.changed' ||
            message.type === 'controller.readiness.changed')
        ) {
          void loadGame({ silent: true });
        }
      } catch {
        // Ignore malformed WebSocket messages.
      }
    };
    return () => ws.close();
  }, [gameId, loadGame]);

  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => {
      void loadGame({ silent: true });
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadGame, finished]);

  useEffect(() => {
    if (!game) return;
    const openId = game.currentQuestion?.id ?? null;
    const wasOpen = lastOpenQuestionIdRef.current;
    lastOpenQuestionIdRef.current = openId;
    // Only on a close we watched happen, not on loading a long-closed round.
    if (wasOpen && !openId && game.previousResult?.questionId === wasOpen) {
      setRevealQuestionId(wasOpen);
    }
  }, [game]);

  useEffect(() => {
    if (!revealQuestionId) return;
    const id = window.setTimeout(() => setRevealQuestionId(null), REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [revealQuestionId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading game…
      </div>
    );
  }

  if (finished) {
    return (
      <StudentResults
        finished={finished}
        studentName={finishedPlayer?.firstName ?? null}
        onBack={() => navigate('/games')}
      />
    );
  }

  if (fetchError || !game) {
    return (
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => navigate('/games')}
        >
          <ChevronLeft aria-hidden />
          Games
        </Button>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {fetchError ?? 'Game not found.'}
        </div>
      </div>
    );
  }

  const isLive = LIVE_STATES.includes(game.state);
  const question = game.currentQuestion;
  const boundPairs = game.boundPairs ?? [];
  const totalRounds = game.totalRounds ?? game.previousResult?.sequence ?? 0;
  const nextRoundSequence = game.nextRoundSequence ?? null;
  const autoNext = countdownReason === 'next' && secondsLeft !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate('/games')}
        >
          <ChevronLeft aria-hidden />
          Games
        </Button>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">
          {game.state}
        </span>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Student mode
        </p>
        <h1 className="text-2xl font-bold">{game.title}</h1>
      </div>

      {game.kind === 'leitner-solo' && game.state === 'completed' ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Loader2 className="mx-auto mb-3 h-9 w-9 animate-spin text-primary" aria-hidden />
          <p className="font-semibold">Game over · saving your results…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            They&apos;ll show here as soon as they&apos;re saved.
          </p>
        </div>
      ) : !isLive ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Play className="mx-auto mb-3 h-9 w-9 text-muted-foreground" aria-hidden />
          <p className="font-semibold">Student mode unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {unavailableMessage(game.state)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => navigate(`/games/${game.id}`)}
          >
            Open referee view
          </Button>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {game.state === 'lobby' ? (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94, y: -16 }}
              transition={stageSpring}
              className="rounded-lg border border-dashed p-10 text-center"
            >
              <Loader2
                className="mx-auto mb-3 h-9 w-9 animate-spin text-primary"
                aria-hidden
              />
              <p className="text-lg font-semibold">Waiting for the game to start</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The game is open for joining.
              </p>
            </motion.div>
          ) : !question && countdownReason === 'start' && secondsLeft !== null ? (
            <StartCountdown secondsLeft={secondsLeft} round={nextRoundSequence} />
          ) : question ? (
            <motion.section
              key={`question-${question.id}`}
              initial={{
                opacity: 0,
                y: 40,
                scale: 0.72,
                rotate: -5,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: [0.72, 1.04, 1],
                rotate: [-5, 1.5, 0],
              }}
              exit={{ opacity: 0, y: -28, scale: 0.92, rotate: 3 }}
              transition={{
                duration: 0.72,
                times: [0, 0.72, 1],
                ease: [0.22, 1, 0.36, 1],
              }}
              className="rounded-xl border bg-card p-5 shadow-sm"
              aria-labelledby="current-round-heading"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <p
                  id="current-round-heading"
                  className="text-sm font-semibold uppercase tracking-wide text-primary"
                >
                  Round {question.sequence}
                </p>
                {game.state === 'paused' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">
                    <Pause className="h-3 w-3" aria-hidden />
                    Paused
                  </span>
                )}
              </div>
              <h2 className="text-xl font-semibold leading-snug">
                {question.text}
              </h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {question.answerOptions.map((option, index) => (
                  <motion.div
                    key={option.id}
                    initial={{ opacity: 0, x: -18 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      ...stageSpring,
                      delay: 0.3 + index * 0.08,
                    }}
                    className="flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {option.slotLabel}
                    </span>
                    <span className="min-w-0 pt-0.5 text-sm font-medium">
                      {option.text}
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.section>
          ) : game.previousResult &&
            game.previousResult.questionId === revealQuestionId &&
            game.previousResult.answerOptions?.length > 0 ? (
            <RoundReveal result={game.previousResult} />
          ) : game.previousResult ? (
            <motion.section
              key={`result-${game.previousResult.questionId}`}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -32, scale: 0.86, rotate: 4 }}
              transition={stageSpring}
              className="rounded-xl border bg-card p-5 shadow-sm"
              aria-labelledby="previous-result-heading"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {nextRoundSequence !== null
                      ? `Round ${nextRoundSequence}`
                      : `Total rounds: ${totalRounds}`}
                  </p>
                  <h2
                    id="previous-result-heading"
                    className="mt-1 text-lg font-semibold"
                  >
                    {nextRoundSequence === null
                      ? 'Game complete'
                      : autoNext
                        ? `Next round in ${secondsLeft}…`
                        : 'Waiting for the referee to open the next round.'}
                  </h2>
                </div>
                <ScanLine
                  className="h-7 w-7 shrink-0 text-primary"
                  aria-hidden
                />
              </div>

              {nextRoundSequence !== null && !autoNext && (
                <div className="mt-4 rounded-lg border border-dashed bg-muted/20 p-3">
                  <p className="mb-2 text-sm font-semibold">
                    Ready for round {nextRoundSequence}?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {boundPairs.map((pair) => (
                      <span
                        key={pair.pairName}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium"
                      >
                        {pair.readyForNextQuestion === null ? (
                          <HelpCircle
                            className="h-3.5 w-3.5 text-amber-600"
                            aria-label="Waiting for ready or wait response"
                          />
                        ) : pair.readyForNextQuestion ? (
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-green-600"
                            aria-label="Ready"
                          />
                        ) : (
                          <XCircle
                            className="h-3.5 w-3.5 text-red-600"
                            aria-label="Needs more time"
                          />
                        )}
                        <span className="capitalize">{pair.pairName}</span>
                        {pair.stationName && pair.stationName !== pair.pairName && (
                          <span className="text-muted-foreground">({pair.stationName})</span>
                        )}
                        <TextReveal
                          revealKey={readinessLabel(pair.readyForNextQuestion)}
                          className="text-muted-foreground"
                        >
                          · {readinessLabel(pair.readyForNextQuestion)}
                        </TextReveal>
                      </span>
                    ))}
                    {boundPairs.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        No controller pairs are connected.
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    The question stays hidden until the referee opens the round.
                  </p>
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {game.previousResult.scans.map((scan, index) => (
                  <motion.div
                    key={scan.pairName}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      ...stageSpring,
                      delay: index * 0.07,
                    }}
                    className="flex items-center gap-3 rounded-lg border bg-background p-3"
                  >
                    {scan.cardLabel == null ? (
                      <Clock3
                        className="h-5 w-5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    ) : scan.isCorrect ? (
                      <CheckCircle2
                        className="h-5 w-5 shrink-0 text-green-600"
                        aria-hidden
                      />
                    ) : (
                      <XCircle
                        className="h-5 w-5 shrink-0 text-red-600"
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold capitalize">
                        {scan.pairName}
                        {scan.stationName && scan.stationName !== scan.pairName && (
                          <span className="ml-1 text-xs font-normal normal-case text-muted-foreground">
                            on {scan.stationName}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {scan.slotLabel
                          ? `${scan.slotLabel} · ${scan.cardLabel ?? 'No tag scanned'}`
                          : 'No tag scanned'}
                      </p>
                    </div>
                  </motion.div>
                ))}
                {game.previousResult.scans.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No tag scans were recorded for this round.
                  </p>
                )}
              </div>
            </motion.section>
          ) : (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="rounded-lg border border-dashed p-10 text-center"
            >
              <Clock3
                className="mx-auto mb-3 h-9 w-9 text-muted-foreground"
                aria-hidden
              />
              <p className="text-lg font-semibold">Waiting for the next round</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The next question will appear here automatically.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
