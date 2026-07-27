import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LayoutGroup, motion } from 'motion/react';
import { CheckCircle2, ChevronLeft, Circle, Loader2, Plus } from 'lucide-react';
import { Button } from '../shared/button';
import { GameRefereePanel } from './components/GameRefereePanel';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../shared/dialog';
import { Input } from '../shared/input';
import { Label } from '../shared/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/select';
import { cn } from '../shared/utils';
import { gameLogRef, logGameState } from '../shared/game-state-log';
import { getWsUrl } from '../shared/ws-url';
import {
  PairGuessChart,
  type GuessChartData,
} from './components/PairGuessChart';

const focusSpring = { type: 'spring' as const, stiffness: 280, damping: 26 };

const DEMO_CREATOR_ID = '000000000000000000000001';
const SLOT_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;
type SlotLabel = (typeof SLOT_LABELS)[number];
type QuestionMode = 'standard' | 'cut-throat' | 'mixed';
type GameState =
  | 'draft'
  | 'ready'
  | 'lobby'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

/** Which stage panel should wear the sliding focus border. */
type FocusSection = 'referee' | 'questions' | 'guessChart' | null;

function focusSectionForState(state: GameState): FocusSection {
  if (state === 'ready' || state === 'lobby') return 'referee';
  if (state === 'active' || state === 'paused') return 'questions';
  if (state === 'completed') return 'guessChart';
  return null;
}

/** Shared sliding / state-driven focus ring (dotted border like Motion's state-updates demo). */
function StageFocusRing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <motion.div
      layoutId="game-stage-focus-ring"
      className="pointer-events-none absolute -inset-1 z-10 rounded-[calc(var(--radius)+4px)] border-[3px] border-dotted border-primary"
      transition={focusSpring}
      aria-hidden
    />
  );
}

type AnswerOption = {
  id: string;
  slotLabel: SlotLabel;
  text: string;
  isCorrect: boolean;
  sequence: number;
};

type Question = {
  id: string;
  text: string;
  sequence: number;
  mode: QuestionMode;
  state: string;
  /** Guesses already recorded for this question (any pair). */
  guessCount?: number;
  answerOptions: AnswerOption[];
};

type BoundPair = {
  pairName: string;
  joined: boolean;
  controllerId?: string;
};

type GameDetail = {
  id: string;
  title: string;
  state: GameState;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  questions: Question[];
  boundPairs: BoundPair[];
};

const STATE_STYLES: Record<GameState, string> = {
  draft: 'bg-muted text-muted-foreground',
  ready: 'bg-emerald-50 text-emerald-800',
  lobby: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-blue-100 text-blue-800',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
};

function StateChip({ state }: { state: GameState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        STATE_STYLES[state] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {state}
    </span>
  );
}

type OptionDraft = { text: string; slotLabel: SlotLabel; isCorrect: boolean };

function AddQuestionDialog({
  gameId,
  nextSequence,
  onCreated,
}: {
  gameId: string;
  nextSequence: number;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [mode, setMode] = useState<QuestionMode>('standard');
  const [options, setOptions] = useState<OptionDraft[]>([
    { text: '', slotLabel: 'A', isCorrect: false },
    { text: '', slotLabel: 'B', isCorrect: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setQuestionText('');
    setMode('standard');
    setOptions([
      { text: '', slotLabel: 'A', isCorrect: false },
      { text: '', slotLabel: 'B', isCorrect: false },
    ]);
    setError(null);
  };

  const addOption = () => {
    if (options.length >= SLOT_LABELS.length) return;
    const nextLabel = SLOT_LABELS[options.length];
    setOptions((prev) => [...prev, { text: '', slotLabel: nextLabel, isCorrect: false }]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((o, i) => ({ ...o, slotLabel: SLOT_LABELS[i] }));
    });
  };

  const setCorrect = (index: number) => {
    setOptions((prev) =>
      prev.map((o, i) => ({ ...o, isCorrect: i === index })),
    );
  };

  const handleSubmit = async () => {
    if (!questionText.trim()) {
      setError('Question text is required.');
      return;
    }
    if (options.some((o) => !o.text.trim())) {
      setError('All answer options must have text.');
      return;
    }
    if (!options.some((o) => o.isCorrect)) {
      setError('Select the correct answer.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          createdByUserId: DEMO_CREATOR_ID,
          text: questionText.trim(),
          sequence: nextSequence,
          mode,
          answerOptions: options.map((o, i) => ({
            text: o.text.trim(),
            slotLabel: o.slotLabel,
            isCorrect: o.isCorrect,
            sequence: i + 1,
          })),
        }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Failed to create question.');
        return;
      }
      setOpen(false);
      reset();
      onCreated();
    } catch {
      setError('Network error — could not create question.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Add Question
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Question</DialogTitle>
          <DialogDescription>
            Question {nextSequence} · NFC slot labels are auto-assigned (A–E).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-text">Question</Label>
            <Input
              id="q-text"
              placeholder="e.g. What colour is the sky?"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-mode">Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as QuestionMode)}>
              <SelectTrigger id="q-mode" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="cut-throat">Cut-throat</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Answer Options</Label>
              <span className="text-[11px] text-muted-foreground">
                Click circle to mark correct
              </span>
            </div>
            {options.map((opt, i) => (
              <div key={opt.slotLabel} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs font-bold text-muted-foreground">
                  {opt.slotLabel}
                </span>
                <button
                  type="button"
                  aria-label={`Mark option ${opt.slotLabel} as correct`}
                  onClick={() => setCorrect(i)}
                  className="shrink-0"
                >
                  {opt.isCorrect ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/50" aria-hidden />
                  )}
                </button>
                <Input
                  placeholder={`Option ${opt.slotLabel}`}
                  value={opt.text}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)),
                    )
                  }
                  className="flex-1"
                />
                {options.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove option ${opt.slotLabel}`}
                    onClick={() => removeOption(i)}
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            {options.length < SLOT_LABELS.length && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-xs"
                onClick={addOption}
              >
                <Plus className="mr-1 h-3 w-3" aria-hidden /> Add option
              </Button>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Add Question
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuestionCard({
  question,
  gameState,
  hasOpenQuestion,
  onToggleState,
}: {
  question: Question;
  gameState: GameState;
  hasOpenQuestion: boolean;
  onToggleState: (questionId: string, newState: 'open' | 'closed') => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const isActive = gameState === 'active';
  const isOpen = question.state === 'open';
  const hasAnswers = (question.guessCount ?? 0) > 0;
  const openLabel = hasAnswers ? 'Reopen' : 'Open';

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setToggling(true);
    setToggleError(null);
    try {
      await onToggleState(question.id, isOpen ? 'closed' : 'open');
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Failed to update question state.');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="mt-0.5 shrink-0 text-xs font-bold text-muted-foreground">
          Q{question.sequence}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{question.text}</p>
          <div className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
            <span>{question.mode}</span>
            <span>·</span>
            <span className="capitalize">{question.state}</span>
            <span>·</span>
            <span>{question.answerOptions.length} options</span>
            {hasAnswers && (
              <>
                <span>·</span>
                <span>
                  {question.guessCount} answer
                  {(question.guessCount ?? 0) === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isActive && (
            <Button
              size="sm"
              variant={isOpen ? 'default' : 'outline'}
              className="h-7 text-xs"
              disabled={toggling || (!isOpen && hasOpenQuestion)}
              title={
                !isOpen && hasOpenQuestion
                  ? 'Another question is already open'
                  : !isOpen && hasAnswers
                    ? 'This question already has answers — reopen to accept more'
                    : undefined
              }
              onClick={handleToggle}
            >
              {toggling ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : isOpen ? (
                'Close'
              ) : (
                openLabel
              )}
            </Button>
          )}
          <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {toggleError && (
        <p className="border-t px-4 py-2 text-xs text-destructive">{toggleError}</p>
      )}

      {expanded && (
        <div className="border-t px-4 py-3">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {question.answerOptions.map((opt) => (
              <div
                key={opt.id}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm',
                  opt.isCorrect && 'border-green-400/60 bg-green-50',
                )}
              >
                <span className="shrink-0 font-bold text-muted-foreground">{opt.slotLabel}</span>
                <span className="flex-1 leading-snug">{opt.text}</span>
                {opt.isCorrect && (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-green-600"
                    aria-label="Correct answer"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function GameDetailView() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [guessChart, setGuessChart] = useState<GuessChartData | null>(null);
  const [guessChartLoading, setGuessChartLoading] = useState(false);

  const loadGuessChart = useCallback(async () => {
    if (!gameId) return;
    setGuessChartLoading(true);
    try {
      const res = await fetch(`/api/games/${gameId}/guess-chart`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = (await res.json()) as GuessChartData;
      setGuessChart(data);
    } catch {
      // non-critical
    } finally {
      setGuessChartLoading(false);
    }
  }, [gameId]);

  const loadGame = useCallback(async (opts?: { silent?: boolean }) => {
    if (!gameId) return;
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    setFetchError(null);
    try {
      const res = await fetch(`/api/games/${gameId}`, { credentials: 'same-origin' });
      if (res.status === 404) {
        setFetchError('Game not found.');
        return;
      }
      if (!res.ok) {
        setFetchError(`Server returned ${res.status}`);
        return;
      }
      const data = (await res.json()) as GameDetail;
      setGame(data);
    } catch {
      setFetchError('Could not reach server.');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [gameId]);

  const refreshQuestions = useCallback(async () => {
    if (!gameId || !game) return;
    try {
      const res = await fetch(`/api/games/${gameId}/questions`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = (await res.json()) as { questions: Question[] };
      setGame((prev) => (prev ? { ...prev, questions: data.questions } : prev));
    } catch {
      // Silent refresh failure — user can reload manually
    }
  }, [gameId, game]);

  const toggleQuestionState = useCallback(
    async (questionId: string, newState: 'open' | 'closed') => {
      if (!gameId) return;
      const res = await fetch(`/api/questions/${questionId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, state: newState }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Failed to set question state to ${newState}.`);
      }
      const gameRef = gameLogRef({ id: gameId, title: game?.title });
      if (newState === 'open') {
        logGameState(
          'question_open',
          `referee Open questionId=${questionId} ${gameRef} icon=message-circle-question-mark`,
        );
      } else {
        logGameState(
          'question_closed',
          `referee Close questionId=${questionId} ${gameRef} icon=book-alert`,
        );
      }
      await refreshQuestions();
      if (newState === 'closed') {
        await loadGuessChart();
      }
    },
    [gameId, game?.title, refreshQuestions, loadGuessChart],
  );

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  // Opening the game detail page promotes draft → ready (setup → standby for controllers).
  const promotingDraftRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameId || !game || game.state !== 'draft') {
      return;
    }
    if (promotingDraftRef.current === gameId) {
      return;
    }
    promotingDraftRef.current = gameId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/games/${gameId}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'ready' }),
          credentials: 'same-origin',
        });
        if (cancelled) return;
        if (!res.ok) {
          promotingDraftRef.current = null;
          return;
        }
        logGameState(
          'ready',
          `referee opened game detail — draft → ready ${gameLogRef({
            id: gameId,
            title: game.title,
          })}`,
        );
        setGame((prev) => (prev ? { ...prev, state: 'ready' } : prev));
      } catch {
        promotingDraftRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game, gameId]);

  useEffect(() => {
    void loadGuessChart();
  }, [loadGuessChart]);

  useEffect(() => {
    if (!gameId) return;
    const ws = new WebSocket(getWsUrl());
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type?: string;
          gameId?: string;
          gameTitle?: string;
          questionId?: string;
          pairName?: string;
          cardLabel?: string;
          slotLabel?: string;
          cardUid?: string;
          isCorrect?: boolean;
        };
        if (message.gameId !== gameId) return;
        if (
          message.type === 'question.result' ||
          message.type === 'game.state.changed' ||
          message.type === 'nfc.tagged'
        ) {
          void loadGuessChart();
        }
        if (
          message.type === 'game.state.changed' ||
          message.type === 'controller.joined' ||
          message.type === 'nfc.tagged'
        ) {
          void loadGame({ silent: true });
        }
        if (message.type === 'nfc.tagged') {
          const gameRef = gameLogRef({
            id: message.gameId,
            title: message.gameTitle ?? game?.title,
          });
          const pair = message.pairName ?? '?';
          const card = message.cardLabel ?? message.slotLabel ?? '?';
          logGameState(
            'card_scanned',
            `WS nfc.tagged pair=${pair} card=${card} slot=${message.slotLabel ?? '?'} ${gameRef}`,
          );
          if (typeof message.isCorrect === 'boolean') {
            logGameState(
              message.isCorrect ? 'correct' : 'wrong',
              `pair=${pair} card=${card} ${gameRef} icon=${message.isCorrect ? 'circle' : 'x'}`,
            );
          }
        }
      } catch {
        // ignore malformed payloads
      }
    };
    return () => {
      ws.close();
    };
  }, [gameId, game?.title, loadGuessChart, loadGame]);

  // State-updates demo: spring x/y/rotate on the referee panel when entering lobby.
  const [refereePose, setRefereePose] = useState({ x: 0, y: 0, rotate: 0 });
  const prevStateRef = useRef<GameState | null>(null);
  useEffect(() => {
    const state = game?.state ?? null;
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (state === 'lobby' && prev !== 'lobby') {
      setRefereePose({ x: 6, y: -4, rotate: 2 });
      const t = window.setTimeout(() => {
        setRefereePose({ x: 0, y: 0, rotate: 0 });
      }, 450);
      return () => window.clearTimeout(t);
    }
    if (state !== 'lobby') {
      setRefereePose({ x: 0, y: 0, rotate: 0 });
    }
  }, [game?.state]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading game…
      </div>
    );
  }

  if (fetchError || !game) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <Button variant="ghost" size="sm" className="self-start" onClick={() => navigate('/games')}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Games
        </Button>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {fetchError ?? 'Unknown error'}
        </div>
      </div>
    );
  }

  const nextSequence = Math.max(0, ...game.questions.map((q) => q.sequence)) + 1;
  const hasOpenQuestion = game.questions.some((q) => q.state === 'open');
  const focusSection = focusSectionForState(game.state);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-1"
          onClick={() => navigate('/games')}
        >
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Games
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{game.title}</h1>
          <StateChip state={game.state} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Created {new Date(game.createdAt).toLocaleDateString()}
          {game.startedAt && ` · Started ${new Date(game.startedAt).toLocaleDateString()}`}
          {game.endedAt && ` · Ended ${new Date(game.endedAt).toLocaleDateString()}`}
        </p>
      </div>

      {/* Layout: questions + guess chart | referee */}
      <LayoutGroup id={`game-stage-${game.id}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          {/* Questions + guess chart column */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 xl:flex-row xl:items-start">
            <motion.div
              className="relative min-w-0 flex-1 rounded-lg"
              layout
            >
              <StageFocusRing active={focusSection === 'questions'} />
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">
                  Questions{' '}
                  <span className="text-muted-foreground">({game.questions.length})</span>
                </p>
                <AddQuestionDialog
                  gameId={game.id}
                  nextSequence={nextSequence}
                  onCreated={() => void refreshQuestions()}
                />
              </div>

              {game.questions.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No questions yet. Click <strong>Add Question</strong> to get started.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {game.questions.map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      gameState={game.state}
                      hasOpenQuestion={hasOpenQuestion}
                      onToggleState={toggleQuestionState}
                    />
                  ))}
                </div>
              )}
            </motion.div>

            <motion.div
              className="relative w-full shrink-0 rounded-lg xl:w-64"
              layout
            >
              <StageFocusRing active={focusSection === 'guessChart'} />
              <PairGuessChart chart={guessChart} loading={guessChartLoading} />
            </motion.div>
          </div>

          {/* Referee sidebar — Open for Joining lands the focus ring here */}
          <motion.div
            className="relative w-full shrink-0 lg:w-72"
            animate={refereePose}
            transition={focusSpring}
          >
            <StageFocusRing active={focusSection === 'referee'} />
            <GameRefereePanel
              game={game}
              onRefresh={() => {
                void loadGame({ silent: true });
                void loadGuessChart();
              }}
            />
          </motion.div>
        </div>
      </LayoutGroup>
    </div>
  );
}
