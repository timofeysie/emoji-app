import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Clock3,
  HelpCircle,
  Loader2,
  Pause,
  Play,
  ScanLine,
  XCircle,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '../shared/button';
import { getWsUrl } from '../shared/ws-url';

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

type GamePlayDetail = {
  id: string;
  title: string;
  state: GameState;
  boundPairs: Array<{
    pairName: string;
    readyForNextQuestion: boolean | null;
  }>;
  currentQuestion: PlayQuestion | null;
  previousResult: {
    questionId: string;
    text: string;
    sequence: number;
    scans: Array<{
      pairName: string;
      cardLabel: string | null;
      slotLabel: string | null;
      isCorrect: boolean;
    }>;
  } | null;
};

const LIVE_STATES: GameState[] = ['lobby', 'active', 'paused'];
const REFRESH_MS = 5_000;
const stageSpring = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 24,
};

function unavailableMessage(state: GameState): string {
  if (state === 'draft' || state === 'ready') {
    return 'The referee must open this game for joining before student mode is available.';
  }
  if (state === 'completed') {
    return 'This game has ended.';
  }
  return 'This game was cancelled.';
}

export function GamePlayView() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<GamePlayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadGame = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!gameId) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/games/${gameId}/play`, {
          credentials: 'same-origin',
        });
        if (!res.ok) {
          setFetchError(
            res.status === 404 ? 'Game not found.' : `Server returned ${res.status}.`,
          );
          return;
        }
        setGame((await res.json()) as GamePlayDetail);
        setFetchError(null);
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
            message.type === 'question.closed' ||
            message.type === 'question.result' ||
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
    const id = window.setInterval(() => {
      void loadGame({ silent: true });
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadGame]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading game…
      </div>
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

      {!isLive ? (
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
                    Round {game.previousResult.sequence} result
                  </p>
                  <h2
                    id="previous-result-heading"
                    className="mt-1 text-lg font-semibold"
                  >
                    {game.previousResult.text}
                  </h2>
                </div>
                <ScanLine
                  className="h-7 w-7 shrink-0 text-primary"
                  aria-hidden
                />
              </div>

              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Ready for the next round?
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
                    </span>
                  ))}
                  {boundPairs.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No controller pairs are connected.
                    </span>
                  )}
                </div>
              </div>

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

              <p className="mt-5 text-center text-xs text-muted-foreground">
                Waiting for the referee to open the next round.
              </p>
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
