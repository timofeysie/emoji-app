import { Check, Dumbbell, Keyboard, ListChecks, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../shared/button';
import { cn } from '../../shared/utils';
import { diffTyped, isTypedCorrect, typedItem } from '../answer-check';
import { aspectLabel } from '../AspectPills';
import { useMeStore } from '../me.store';
import { PractisingAs } from '../PractisingAs';
import { useChapterProgress, useStudyChapter } from '../YallaChapterView';
import { chapterPath, YallaRequestError } from '../yalla-api';
import {
  DEFAULT_FORMAT,
  enqueueAttempt,
  flushOutbox,
  loadFormat,
  loadSavedSession,
  newAttemptId,
  pendingCount,
  sameFormat,
  saveLocalFormat,
  saveSession,
  startSession,
  subscribeOutbox,
  type GameFormat,
  type InputChannel,
  type PracticeAspect,
  type PracticeItem,
  type SavedSession,
  type SlotLabel,
} from '../yalla-practice';

const COUNTS = [5, 10, 20] as const;
const ASPECTS: readonly PracticeAspect[] = ['reading', 'writing'];
const KEY_TO_SLOT: Record<string, SlotLabel> = { a: 'A', b: 'B', c: 'C', d: 'D', '1': 'A', '2': 'B', '3': 'C', '4': 'D' };

const CHANNELS: ReadonlyArray<{ channel: InputChannel; label: string; icon: typeof Keyboard }> = [
  { channel: 'keyboard', label: 'Type', icon: Keyboard },
  { channel: 'onscreen-choice', label: 'A–D Choose', icon: ListChecks },
];

/**
 * The learner's format and a setter that saves it on their user (so it
 * follows them to other devices) and in this browser.
 */
function useFormat(): [GameFormat, (format: GameFormat | null) => void] {
  const saved = useMeStore((state) => state.me?.preferences?.yallaFormat ?? null);
  const setYallaFormat = useMeStore((state) => state.setYallaFormat);
  const [format, setFormat] = useState<GameFormat>(() => loadFormat(saved));
  useEffect(() => setFormat(loadFormat(saved)), [saved]);

  const update = useCallback(
    (next: GameFormat | null) => {
      saveLocalFormat(next);
      setFormat(next ?? DEFAULT_FORMAT);
      void setYallaFormat(next);
    },
    [setYallaFormat],
  );
  return [format, update];
}

/**
 * Solo Leitner practice for this chapter (docs/yalla/implementation-plan.md
 * §6, milestones Y4–Y5): set up a session, answer each word by typing it or
 * choosing A–D, see the summary. Answers go through the outbox; the header
 * pills reload once they're in the LRS.
 */
export function ExercisesSection() {
  const chapter = useStudyChapter();
  const progress = useChapterProgress();
  const playerId = useMeStore((state) => state.me?.player?.id ?? null);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const [format, setFormat] = useFormat();

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
    return (
      <SessionSetup
        book={chapter.book}
        chapter={chapter.chapter}
        playerId={playerId}
        format={format}
        onFormat={setFormat}
        onStart={update}
      />
    );
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
  return (
    <PracticeCard
      saved={saved}
      playerId={playerId}
      lang={chapter.language}
      onChange={update}
      onFormat={(next) => setFormat(next)}
    />
  );
}

function ChannelPicker({
  aspect,
  value,
  onChange,
}: {
  aspect: PracticeAspect;
  value: InputChannel;
  onChange: (channel: InputChannel) => void;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={`${aspectLabel(aspect)} input`}
      className="inline-flex overflow-hidden rounded-md border text-xs"
      data-testid={`channel-${aspect}`}
    >
      {CHANNELS.map(({ channel, label, icon: Icon }) => (
        <button
          key={channel}
          type="button"
          role="radio"
          aria-checked={value === channel}
          onClick={() => onChange(channel)}
          data-testid={`channel-${aspect}-${channel}`}
          className={cn(
            'flex items-center gap-1 px-2 py-1 transition-colors',
            value === channel ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </span>
  );
}

function SessionSetup({
  book,
  chapter,
  playerId,
  format,
  onFormat,
  onStart,
}: {
  book: string;
  chapter: string;
  playerId: string;
  format: GameFormat;
  onFormat: (format: GameFormat | null) => void;
  onStart: (saved: SavedSession) => void;
}) {
  const [scope, setScope] = useState<'chapter' | 'review'>('chapter');
  const [aspects, setAspects] = useState<PracticeAspect[]>([...ASPECTS]);
  const [count, setCount] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggleAspect = (aspect: PracticeAspect) =>
    setAspects((current) =>
      current.includes(aspect) ? current.filter((value) => value !== aspect) : ASPECTS.filter((a) => a === aspect || current.includes(a)),
    );

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      // Plan on levels that include every answer already given.
      await flushOutbox(playerId);
      const session = await startSession({ book, chapter, scope, aspects, count });
      if (session.items.length === 0) {
        setMessage('Nothing to practise right now: every word here is learned or not due yet.');
        return;
      }
      onStart({ session, answers: {}, format, choiceShown: [], startedAt: new Date().toISOString() });
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

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Skills and how you answer</legend>
        {ASPECTS.map((aspect) => (
          <div key={aspect} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label className="flex w-24 items-center gap-2">
              <input
                type="checkbox"
                checked={aspects.includes(aspect)}
                onChange={() => toggleAspect(aspect)}
                data-testid={`setup-aspect-${aspect}`}
              />
              {aspectLabel(aspect)}
            </label>
            <ChannelPicker
              aspect={aspect}
              value={format[aspect]}
              onChange={(channel) => onFormat({ ...format, [aspect]: channel })}
            />
          </div>
        ))}
        {!sameFormat(format, DEFAULT_FORMAT) && (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline"
            onClick={() => onFormat(null)}
            data-testid="format-reset"
          >
            Reset to defaults (type Writing, choose Reading)
          </button>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Questions</span>
        <select
          className="rounded-md border bg-background px-2 py-1"
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          data-testid="setup-count"
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
  onFormat,
}: {
  saved: SavedSession;
  playerId: string;
  lang: string;
  onChange: (saved: SavedSession) => void;
  onFormat: (format: GameFormat) => void;
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
  const choiceShown = saved.choiceShown.includes(item.itemId);
  // Once an item's options were on screen it stays A–D: typing then would be peeking.
  const channel: InputChannel = answer?.channel ?? (choiceShown ? 'onscreen-choice' : saved.format[item.aspect]);

  useEffect(() => {
    if (!answer) setOpenedAt(new Date().toISOString());
  }, [item.itemId, answer]);

  useEffect(() => {
    if (channel === 'onscreen-choice' && !answer && !choiceShown) {
      onChange({ ...saved, choiceShown: [...saved.choiceShown, item.itemId] });
    }
  }, [answer, channel, choiceShown, item.itemId, onChange, saved]);

  const record = useCallback(
    (entry: { channel: InputChannel; response: string; correct: boolean }) => {
      const base = {
        attemptId: newAttemptId(),
        itemId: item.itemId,
        book: session.book,
        sourceRef: item.sourceRef,
        learningObjectId: item.learningObjectId,
        aspect: item.aspect,
        answeredAt: new Date().toISOString(),
        openedAt,
        correct: entry.correct,
      };
      enqueueAttempt(
        playerId,
        session.sessionId,
        entry.channel === 'onscreen-choice'
          ? { ...base, channel: 'onscreen-choice', options: item.options, response: entry.response as SlotLabel }
          : { ...base, channel: 'keyboard', response: entry.response },
      );
      void flushOutbox(playerId).catch(() => undefined);
      setShowing(item.itemId);
      onChange({ ...saved, answers: { ...answers, [item.itemId]: entry } });
    },
    [answers, item, onChange, openedAt, playerId, saved, session],
  );

  const choose = useCallback(
    (slot: SlotLabel) => {
      if (answer) return;
      record({ channel: 'onscreen-choice', response: slot, correct: slot === item.answer });
    },
    [answer, item.answer, record],
  );

  const last = session.items.every((candidate) => answers[candidate.itemId]);
  const next = useCallback(() => {
    setShowing(null);
    if (last) onChange({ ...saved, finished: true });
  }, [last, onChange, saved]);

  /** Applies to this item (unless its options were already shown) and the rest of the session. */
  const switchTo = (to: InputChannel) => {
    const format = { ...saved.format, [item.aspect]: to };
    onChange({ ...saved, format });
    onFormat(format);
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (answer) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          next();
        }
        return;
      }
      if (channel !== 'onscreen-choice') return;
      const slot = KEY_TO_SLOT[event.key.toLowerCase()];
      if (slot && item.options.some((option) => option.slotLabel === slot)) {
        event.preventDefault();
        choose(slot);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, channel, choose, item.options, next]);

  const position = session.items.indexOf(item) + 1;
  const typed = typedItem(item.aspect, item.word, item.gloss);
  // Reading asks the Korean; writing asks the meaning and wants Korean.
  const promptLang = item.aspect === 'reading' ? lang : 'en';
  const answerLang = item.aspect === 'reading' ? 'en' : lang;
  const sessionChannel = saved.format[item.aspect];

  return (
    <section aria-label="Exercises" className="flex flex-col gap-4 rounded-lg border p-4" data-testid="practice-card">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid="practice-position">
          {position} / {session.items.length}
        </span>
        <span>
          {aspectLabel(item.aspect)} · {item.reason === 'new' ? 'new word' : item.reason}
        </span>
        <ChannelPicker aspect={item.aspect} value={sessionChannel} onChange={switchTo} />
      </div>
      {!answer && channel === 'onscreen-choice' && sessionChannel === 'keyboard' && (
        <p className="text-center text-xs text-muted-foreground" data-testid="practice-switch-note">
          You saw the options for this one, so typing starts with the next {aspectLabel(item.aspect)} word.
        </p>
      )}

      {channel === 'onscreen-choice' ? (
        <>
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
                  <span lang={answerLang}>{option.text}</span>
                </button>
              );
            })}
          </div>
          {!answer && <p className="text-center text-xs text-muted-foreground">Tap an answer, or press A–D (1–4).</p>}
        </>
      ) : (
        <TypedAnswer
          key={item.itemId}
          aspect={item.aspect}
          prompt={typed.prompt}
          expected={typed.answer}
          promptLang={promptLang}
          answerLang={answerLang}
          answered={answer ?? null}
          onAnswer={(response) =>
            record({ channel: 'keyboard', response, correct: isTypedCorrect(response, typed.answer) })
          }
        />
      )}

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
    </section>
  );
}

/** Type the answer; Enter (not mid-composition) checks it. After a miss, shows where it differs. */
function TypedAnswer({
  aspect,
  prompt,
  expected,
  promptLang,
  answerLang,
  answered,
  onAnswer,
}: {
  aspect: PracticeAspect;
  prompt: string;
  expected: string;
  promptLang: string;
  answerLang: string;
  answered: { response: string; correct: boolean } | null;
  onAnswer: (response: string) => void;
}) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (answered || text.trim().length === 0) return;
    onAnswer(text);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-center text-sm text-muted-foreground">
        {aspect === 'reading' ? 'Type the meaning, exactly as the book gives it' : 'Type it in Korean'}
      </p>
      <p lang={promptLang} className="text-center text-3xl font-semibold" data-testid="practice-prompt">
        {prompt}
      </p>
      {answered ? (
        !answered.correct && <TypedDiff typed={answered.response} expected={expected} lang={answerLang} />
      ) : (
        <>
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter while the Korean IME is composing finishes the syllable, not the answer.
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
            }}
            // Keep the prompt in view above the phone keyboard.
            onFocus={() => input.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
            lang={answerLang}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            aria-label={aspect === 'reading' ? 'Meaning in English' : 'Word in Korean'}
            className="rounded-lg border bg-background px-4 py-3 text-center text-xl"
            data-testid="practice-input"
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="submit" disabled={text.trim().length === 0} data-testid="practice-check">
              Check
            </Button>
            <Button type="button" variant="outline" onClick={() => onAnswer('')} data-testid="practice-dont-know">
              Don&apos;t know
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

function TypedDiff({ typed, expected, lang }: { typed: string; expected: string; lang: string }) {
  const parts = diffTyped(typed, expected);
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="practice-diff">
      {typed.trim() && (
        <p>
          <span className="text-muted-foreground">You typed: </span>
          <span lang={lang}>
            {parts
              .filter((part) => part.kind !== 'missing')
              .map((part, index) => (
                <span key={index} className={cn(part.kind === 'extra' && 'bg-destructive/15 text-destructive line-through')}>
                  {part.text}
                </span>
              ))}
          </span>
        </p>
      )}
      <p>
        <span className="text-muted-foreground">Answer: </span>
        <span lang={lang}>
          {parts
            .filter((part) => part.kind !== 'extra')
            .map((part, index) => (
              <span key={index} className={cn(part.kind === 'missing' && 'bg-emerald-100 font-semibold text-emerald-900')}>
                {part.text}
              </span>
            ))}
        </span>
      </p>
    </div>
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
          const given = answers[item.itemId];
          return (
            <li key={item.itemId} className="flex items-center gap-2">
              {given?.correct ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="correct" />
              ) : (
                <X className="h-4 w-4 shrink-0 text-destructive" aria-label="wrong" />
              )}
              <span lang={lang}>{item.word}</span>
              <span className="text-muted-foreground">
                {item.gloss} · {aspectLabel(item.aspect)}
                {given?.channel === 'keyboard' && ' · typed'}
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
