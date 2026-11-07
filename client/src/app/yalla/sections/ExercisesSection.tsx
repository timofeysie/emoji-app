import { Check, Dumbbell, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../shared/button';
import { cn } from '../../shared/utils';
import { aspectLabel } from '../AspectPills';
import { useMeStore } from '../me.store';
import { PractisingAs } from '../PractisingAs';
import { useChapterProgress, useStudyChapter } from '../YallaChapterView';
import { chapterPath, YallaRequestError } from '../yalla-api';
import {
  channelFor,
  enqueueAttempt,
  flushOutbox,
  loadFormat,
  loadSavedSession,
  newAttemptId,
  OFFERED_CHANNELS,
  pendingCount,
  saveSession,
  startSession,
  subscribeOutbox,
  type GameFormat,
  type PracticeAspect,
  type PracticeItem,
  type SavedSession,
  type SlotLabel,
} from '../yalla-practice';

const COUNTS = [5, 10, 20] as const;
const ASPECTS: readonly PracticeAspect[] = ['reading', 'writing'];
const KEY_TO_SLOT: Record<string, SlotLabel> = { a: 'A', b: 'B', c: 'C', d: 'D', '1': 'A', '2': 'B', '3': 'C', '4': 'D' };

const CHANNEL_LABELS: Record<string, string> = { 'onscreen-choice': 'A–D Choose', keyboard: '⌨ Type' };

/**
 * Solo Leitner practice for this chapter (docs/yalla/implementation-plan.md
 * §6, milestone Y4): set up a session, answer A–D on screen, see the
 * summary. Answers go through the outbox; the header pills reload once
 * they're in the LRS.
 */
export function ExercisesSection() {
  const chapter = useStudyChapter();
  const progress = useChapterProgress();
  const playerId = useMeStore((state) => state.me?.player?.id ?? null);
  const [saved, setSaved] = useState<SavedSession | null>(null);

  useEffect(() => {
    setSaved(playerId ? loadSavedSession(playerId, chapter.book, chapter.chapter) : null);
  }, [playerId, chapter.book, chapter.chapter]);

  const update = useCallback((next: SavedSession | null) => {
    saveSession(next);
    setSaved(next);
  }, []);

  if (progress.linked === null) {
    return null;
  }
  if (progress.linked === false || !playerId) {
    return (
      <section aria-label="Exercises" className="rounded-lg border border-dashed p-8 text-center text-sm">
        <Dumbbell className="mx-auto mb-2 h-8 w-8 opacity-40" aria-hidden />
        <p className="mb-2 text-muted-foreground">Practice records your answers against a player.</p>
        <div className="flex justify-center">
          <PractisingAs />
        </div>
      </section>
    );
  }

  if (!saved) {
    return <SessionSetup book={chapter.book} chapter={chapter.chapter} onStart={update} />;
  }

  if (saved.finished) {
    return (
      <SessionSummary
        saved={saved}
        lang={chapter.language}
        playerId={playerId}
        onSent={progress.reload}
        onAgain={() => update(null)}
        vocabularyPath={`${chapterPath(chapter.book, chapter.chapter)}/vocabulary`}
      />
    );
  }
  return <PracticeCard saved={saved} playerId={playerId} lang={chapter.language} onChange={update} />;
}

function SessionSetup({ book, chapter, onStart }: { book: string; chapter: string; onStart: (saved: SavedSession) => void }) {
  const [scope, setScope] = useState<'chapter' | 'review'>('chapter');
  const [aspects, setAspects] = useState<PracticeAspect[]>([...ASPECTS]);
  const [count, setCount] = useState<number>(10);
  const [format] = useState<GameFormat>(loadFormat);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const playerId = useMeStore((state) => state.me?.player?.id ?? null);

  const toggleAspect = (aspect: PracticeAspect) =>
    setAspects((current) =>
      current.includes(aspect) ? current.filter((value) => value !== aspect) : ASPECTS.filter((a) => a === aspect || current.includes(a)),
    );

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      // Plan on levels that include every answer already given.
      if (playerId) await flushOutbox(playerId);
      const session = await startSession({ book, chapter, scope, aspects, count });
      if (session.items.length === 0) {
        setMessage('Nothing to practise right now: every word here is learned or not due yet.');
        return;
      }
      onStart({ session, answers: {}, startedAt: new Date().toISOString() });
    } catch (error) {
      setMessage(
        error instanceof YallaRequestError
          ? error.status === 409
            ? `${error.message}. Finish or export that badge game first.`
            : error.message
          : 'Could not reach the server. Your answers are kept and will be sent later.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Exercises" className="flex flex-col gap-4 rounded-lg border p-4" data-testid="practice-setup">
      <h2 className="text-lg font-semibold">Practise this chapter</h2>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Words</legend>
        {(
          [
            ['chapter', 'This chapter'],
            ['review', 'This chapter + due words from other chapters'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === value} onChange={() => setScope(value)} />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Skills</legend>
        {ASPECTS.map((aspect) => (
          <div key={aspect} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={aspects.includes(aspect)}
                onChange={() => toggleAspect(aspect)}
                data-testid={`setup-aspect-${aspect}`}
              />
              {aspectLabel(aspect)}
            </label>
            <span className="text-xs text-muted-foreground" data-testid={`setup-channel-${aspect}`}>
              {CHANNEL_LABELS[channelFor(format, aspect)]}
              {!OFFERED_CHANNELS.includes(format[aspect]) && ` (${CHANNEL_LABELS[format[aspect]]} comes soon)`}
            </span>
          </div>
        ))}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Questions</span>
        <select
          className="rounded-md border bg-background px-2 py-1"
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        >
          {COUNTS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      {message && (
        <p className="text-sm text-muted-foreground" data-testid="practice-message">
          {message}
        </p>
      )}
      <div>
        <Button onClick={() => void start()} disabled={busy || aspects.length === 0} data-testid="practice-start">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Start
        </Button>
      </div>
    </section>
  );
}

function PracticeCard({
  saved,
  playerId,
  lang,
  onChange,
}: {
  saved: SavedSession;
  playerId: string;
  lang: string;
  onChange: (saved: SavedSession) => void;
}) {
  const { session, answers } = saved;
  // The current item: the one whose feedback is showing, else the first
  // unanswered one, else (a refresh during the last feedback) the last one.
  const [showing, setShowing] = useState<string | null>(null);
  const item: PracticeItem =
    session.items.find((candidate) => candidate.itemId === showing) ??
    session.items.find((candidate) => !answers[candidate.itemId]) ??
    session.items[session.items.length - 1];
  const answer = answers[item.itemId];
  const [openedAt, setOpenedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!answer) setOpenedAt(new Date().toISOString());
  }, [item.itemId, answer]);

  const choose = useCallback(
    (slot: SlotLabel) => {
      if (answer) return;
      const correct = slot === item.answer;
      enqueueAttempt(playerId, session.sessionId, {
        attemptId: newAttemptId(),
        itemId: item.itemId,
        book: session.book,
        sourceRef: item.sourceRef,
        learningObjectId: item.learningObjectId,
        aspect: item.aspect,
        channel: 'onscreen-choice',
        options: item.options,
        response: slot,
        answeredAt: new Date().toISOString(),
        openedAt,
        correct,
      });
      void flushOutbox(playerId).catch(() => undefined);
      setShowing(item.itemId);
      onChange({ ...saved, answers: { ...answers, [item.itemId]: { response: slot, correct } } });
    },
    [answer, answers, item, onChange, openedAt, playerId, saved, session],
  );

  const last = session.items.every((candidate) => answers[candidate.itemId]);
  const next = useCallback(() => {
    setShowing(null);
    if (last) onChange({ ...saved, finished: true });
  }, [last, onChange, saved]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (answer) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          next();
        }
        return;
      }
      const slot = KEY_TO_SLOT[event.key.toLowerCase()];
      if (slot && item.options.some((option) => option.slotLabel === slot)) {
        event.preventDefault();
        choose(slot);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, choose, item.options, next]);

  const position = session.items.indexOf(item) + 1;
  // Reading asks the Korean word; writing asks the meaning and offers Korean spellings.
  const promptLang = item.aspect === 'reading' ? lang : 'en';
  const optionLang = item.aspect === 'reading' ? 'en' : lang;

  return (
    <section aria-label="Exercises" className="flex flex-col gap-4 rounded-lg border p-4" data-testid="practice-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="practice-position">
          {position} / {session.items.length}
        </span>
        <span>
          {aspectLabel(item.aspect)} · {item.reason === 'new' ? 'new word' : item.reason}
        </span>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {item.aspect === 'reading' ? 'What does this mean?' : 'Which is the right spelling?'}
      </p>
      <p lang={promptLang} className="text-center text-3xl font-semibold" data-testid="practice-prompt">
        {item.prompt}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {item.options.map((option) => {
          const chosen = answer?.response === option.slotLabel;
          const isAnswer = option.slotLabel === item.answer;
          return (
            <button
              key={option.slotLabel}
              type="button"
              disabled={Boolean(answer)}
              onClick={() => choose(option.slotLabel)}
              data-testid={`option-${option.slotLabel}`}
              data-correct={answer ? String(isAnswer) : undefined}
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3 text-left text-lg transition-colors',
                !answer && 'hover:bg-accent',
                answer && isAnswer && 'border-emerald-500 bg-emerald-50 text-emerald-900',
                answer && chosen && !isAnswer && 'border-destructive bg-destructive/10 text-destructive',
                answer && !chosen && !isAnswer && 'opacity-50',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold">
                {option.slotLabel}
              </span>
              <span lang={optionLang}>{option.text}</span>
            </button>
          );
        })}
      </div>
      {answer && (
        <div className="flex flex-wrap items-center justify-between gap-2" data-testid="practice-feedback">
          <p className={cn('flex items-center gap-1 text-sm font-medium', answer.correct ? 'text-emerald-700' : 'text-destructive')}>
            {answer.correct ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
            {answer.correct ? 'Correct' : 'Not quite'}
            <span className="font-normal text-muted-foreground">
              {' '}
              · <span lang={lang}>{item.word}</span> = {item.gloss}
            </span>
          </p>
          <Button onClick={next} data-testid="practice-next" autoFocus>
            {last ? 'See results' : 'Next'}
          </Button>
        </div>
      )}
      {!answer && <p className="text-center text-xs text-muted-foreground">Tap an answer, or press A–D (1–4).</p>}
    </section>
  );
}

function SessionSummary({
  saved,
  lang,
  playerId,
  onSent,
  onAgain,
  vocabularyPath,
}: {
  saved: SavedSession;
  lang: string;
  playerId: string;
  onSent: () => void;
  onAgain: () => void;
  vocabularyPath: string;
}) {
  const waiting = useSyncExternalStore(subscribeOutbox, () => pendingCount(playerId));
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const { session, answers } = saved;
  const correct = session.items.filter((item) => answers[item.itemId]?.correct).length;

  const send = useCallback(async () => {
    setSending(true);
    setFailed(false);
    try {
      await flushOutbox(playerId);
      onSent();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }, [onSent, playerId]);

  useEffect(() => {
    void send();
  }, [send]);

  return (
    <section aria-label="Exercises" className="flex flex-col gap-4 rounded-lg border p-4" data-testid="practice-summary">
      <h2 className="text-lg font-semibold" data-testid="practice-score">
        {correct} / {session.items.length} correct
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        {session.items.map((item) => {
          const ok = answers[item.itemId]?.correct;
          return (
            <li key={item.itemId} className="flex items-center gap-2">
              {ok ? (
                <Check className="h-4 w-4 text-emerald-600" aria-label="correct" />
              ) : (
                <X className="h-4 w-4 text-destructive" aria-label="wrong" />
              )}
              <span lang={lang}>{item.word}</span>
              <span className="text-muted-foreground">
                {item.gloss} · {aspectLabel(item.aspect)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground" data-testid="practice-outbox">
        {sending ? (
          'Saving your answers…'
        ) : waiting > 0 ? (
          <>
            {waiting} {waiting === 1 ? 'answer is' : 'answers are'} waiting to be saved
            {failed && ' (no connection)'}.{' '}
            <button type="button" className="underline" onClick={() => void send()}>
              Retry
            </button>
          </>
        ) : (
          'All answers saved. The levels above include them.'
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAgain} data-testid="practice-again">
          Practise again
        </Button>
        <Button variant="outline" asChild>
          <Link to={vocabularyPath}>Vocabulary</Link>
        </Button>
      </div>
    </section>
  );
}
