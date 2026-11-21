import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Circle, CircleCheck, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '../shared/button';
import { ExpandableTextField } from '../shared/ExpandableTextField';
import { Input } from '../shared/input';
import { Label } from '../shared/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/select';
import { Textarea } from '../shared/textarea';
import { cn } from '../shared/utils';
import type { DraftProblem, DraftQuestion, DraftSettings, GameDraftContent, LanguagePair } from './drafts-api';
import { GAME_LIMITS, SLOT_LABELS } from './game-limits';
import { QUESTION_MIXES, questionFocusValues, scaleMix, type QuestionFocus } from './question-mixes';
import { languageName, type GenerationRequest } from './useGameGeneration';

const TARGET_LANGUAGES = ['ko', 'ja', 'zh', 'es', 'fr', 'de', 'en'];
const NATIVE_LANGUAGES = ['en', 'ko', 'ja', 'zh', 'es', 'fr', 'de'];

const FOCUS_STYLES: Record<QuestionFocus, string> = {
  vocabulary: 'bg-sky-100 text-sky-800',
  grammar: 'bg-violet-100 text-violet-800',
  comprehension: 'bg-amber-100 text-amber-800',
};

export type GameDraftEditorProps = {
  content: GameDraftContent;
  onContentChange: (next: GameDraftContent) => void;
  source: string;
  onSourceChange: (text: string) => void;
  /** Leaving the paste box: a good moment to keep the text as a source. */
  onSourceCommit: () => void;
  language: LanguagePair;
  onLanguageChange: (next: LanguagePair) => void;
  settings: DraftSettings;
  onSettingsChange: (next: DraftSettings) => void;
  /** From the server's last save (G3). */
  problems: DraftProblem[];
  /** Accepted drafts can't change. */
  readOnly: boolean;
  generation: {
    pending: GenerationRequest | null;
    partialCount: number;
    error: string | null;
    onGenerate: (request: GenerationRequest) => void;
    onCancel: () => void;
  };
};

function problemsAt(problems: DraftProblem[], prefix: string): DraftProblem[] {
  return problems.filter((problem) => problem.path === prefix || problem.path.startsWith(`${prefix}.`));
}

function blankQuestion(optionCount: number): DraftQuestion {
  return {
    text: '',
    focus: 'vocabulary',
    options: Array.from({ length: optionCount }, (_, i) => ({ text: '', isCorrect: i === 0 })),
  };
}

/**
 * The Draft Game editor (docs/hashbrown/creating-games-with-hashbrown.md →
 * The user's flow, Draft Game page): the source and settings on the left,
 * the questions on the right. Controlled: the page saves what it reports.
 */
export function GameDraftEditor(props: GameDraftEditorProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <SourcePane {...props} />
      <QuestionsPane {...props} />
    </div>
  );
}

function SourcePane({
  source,
  onSourceChange,
  onSourceCommit,
  language,
  onLanguageChange,
  settings,
  onSettingsChange,
  content,
  readOnly,
  generation,
}: GameDraftEditorProps) {
  const counts = scaleMix(QUESTION_MIXES.find((mix) => mix.id === settings.mix)?.counts ?? QUESTION_MIXES[0].counts, settings.questionCount);
  const busy = generation.pending !== null;
  const tooLong = source.length > GAME_LIMITS.maxSourceLength;
  const canGenerate = !readOnly && !busy && source.trim().length > 0 && !tooLong;

  return (
    <section className="flex w-full flex-col gap-3 rounded-lg border bg-background p-3 lg:w-[22rem] lg:shrink-0">
      <h2 className="text-sm font-semibold">Source</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-source">Passage</Label>
        <Textarea
          id="draft-source"
          className="min-h-48 text-sm"
          placeholder="Paste a few paragraphs, e.g. a Korean story…"
          value={source}
          readOnly={readOnly}
          onChange={(event) => onSourceChange(event.target.value)}
          onBlur={onSourceCommit}
        />
        <p className={cn('text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
          {source.length.toLocaleString()} / {GAME_LIMITS.maxSourceLength.toLocaleString()} characters
        </p>
        <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          The passage is sent to OpenAI to write the questions and is kept with the draft. Other signed-in users can
          see it once you share the draft or make a game from it. Paste only text you may share, with no one’s
          personal details.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <LanguageSelect
          id="draft-target"
          label="Learning"
          value={language.target}
          options={TARGET_LANGUAGES}
          disabled={readOnly}
          onChange={(target) => onLanguageChange({ ...language, target })}
        />
        <LanguageSelect
          id="draft-native"
          label="Learner speaks"
          value={language.native}
          options={NATIVE_LANGUAGES}
          disabled={readOnly}
          onChange={(native) => onLanguageChange({ ...language, native })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-mix">Mix</Label>
        <Select
          value={settings.mix}
          disabled={readOnly}
          onValueChange={(mix) => onSettingsChange({ ...settings, mix: mix as DraftSettings['mix'] })}
        >
          <SelectTrigger id="draft-mix">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUESTION_MIXES.map((mix) => (
              <SelectItem key={mix.id} value={mix.id}>
                {mix.label}
                {mix.id === 'vocabulary' ? ' (default)' : ''}
              </SelectItem>
            ))}
            {settings.mix === 'custom' && <SelectItem value="custom">Custom (from the chat)</SelectItem>}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {settings.mix === 'custom'
            ? 'The counts asked for in the chat. Generating keeps the same proportions.'
            : `${counts.vocabulary} vocabulary · ${counts.grammar} grammar · ${counts.comprehension} comprehension. ${
                QUESTION_MIXES.find((mix) => mix.id === settings.mix)?.description
              }.`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="draft-count">Questions</Label>
          <Input
            id="draft-count"
            type="number"
            min={1}
            max={GAME_LIMITS.maxQuestions}
            value={settings.questionCount}
            disabled={readOnly}
            onChange={(event) => {
              const value = Math.round(Number(event.target.value));
              if (Number.isFinite(value)) {
                onSettingsChange({ ...settings, questionCount: Math.min(GAME_LIMITS.maxQuestions, Math.max(1, value)) });
              }
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="draft-options">Options each</Label>
          <Select
            value={String(settings.optionsPerQuestion)}
            disabled={readOnly}
            onValueChange={(value) => onSettingsChange({ ...settings, optionsPerQuestion: Number(value) })}
          >
            <SelectTrigger id="draft-options">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4 (A–D)</SelectItem>
              <SelectItem value="5">5 (A–E)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {settings.optionsPerQuestion === 5 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Needs a card group with an E card.
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => generation.onGenerate({ kind: 'all' })} disabled={!canGenerate}>
            {generation.pending?.kind === 'all' ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Sparkles aria-hidden />
            )}
            {content.questions.length > 0 ? 'Generate again' : 'Generate'}
          </Button>
          {busy && (
            <Button variant="ghost" size="sm" onClick={generation.onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {!readOnly && content.questions.length > 0 && !busy && (
        <p className="text-xs text-muted-foreground">Generating again replaces all {content.questions.length} questions.</p>
      )}
      {busy && (
        <p className="text-xs text-muted-foreground">
          Writing questions…{generation.partialCount > 0 ? ` (${generation.partialCount} so far)` : ''}
        </p>
      )}
      {generation.error && (
        <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{generation.error}</p>
      )}
    </section>
  );
}

function LanguageSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (code: string) => void;
}) {
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {all.map((code) => (
            <SelectItem key={code} value={code}>
              {languageName(code)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function QuestionsPane({ content, onContentChange, settings, problems, readOnly, generation }: GameDraftEditorProps) {
  const busy = generation.pending !== null;
  const room = GAME_LIMITS.maxQuestions - content.questions.length;
  const [moreCount, setMoreCount] = useState(3);

  const setQuestions = (questions: DraftQuestion[]) => onContentChange({ ...content, questions });
  const updateQuestion = (index: number, next: DraftQuestion) =>
    setQuestions(content.questions.map((question, i) => (i === index ? next : question)));
  const move = (index: number, by: -1 | 1) => {
    const questions = [...content.questions];
    const [moved] = questions.splice(index, 1);
    questions.splice(index + by, 0, moved);
    setQuestions(questions);
  };

  const topProblems = problems.filter((problem) => !problem.path.startsWith('questions.'));

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-background p-3">
      <div className="flex flex-col gap-1.5">
        <Label>Game title</Label>
        <ExpandableTextField
          aria-label="Game title"
          placeholder="e.g. Story quiz: 토끼와 거북이"
          value={content.title}
          readOnly={readOnly}
          maxLength={GAME_LIMITS.maxTitleLength}
          onChange={(title) => onContentChange({ ...content, title })}
        />
        <p className="text-xs text-muted-foreground">The title goes to the LRS: never put a person’s name in it.</p>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {content.questions.length} question{content.questions.length === 1 ? '' : 's'}
        </h2>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            disabled={room <= 0}
            onClick={() => setQuestions([...content.questions, blankQuestion(settings.optionsPerQuestion)])}
          >
            <Plus aria-hidden /> Add question
          </Button>
        )}
      </div>

      {topProblems.length > 0 && <ProblemList problems={topProblems} />}

      {content.questions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {readOnly ? 'No questions.' : 'Paste a passage and click Generate, or add questions by hand.'}
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {content.questions.map((question, index) => (
            <QuestionEditor
              key={index}
              index={index}
              count={content.questions.length}
              question={question}
              problems={problemsAt(problems, `questions.${index}`)}
              readOnly={readOnly}
              busy={busy}
              regenerating={generation.pending?.kind === 'one' && generation.pending.index === index}
              onChange={(next) => updateQuestion(index, next)}
              onMove={(by) => move(index, by)}
              onDelete={() => setQuestions(content.questions.filter((_, i) => i !== index))}
              onRegenerate={(note) => generation.onGenerate({ kind: 'one', index, note: note || undefined })}
            />
          ))}
        </ol>
      )}

      {!readOnly && content.questions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || room <= 0}
            onClick={() => generation.onGenerate({ kind: 'more', count: Math.min(moreCount, room) })}
          >
            {generation.pending?.kind === 'more' ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            Generate more
          </Button>
          <Input
            type="number"
            aria-label="How many more"
            className="h-8 w-16"
            min={1}
            max={Math.max(1, room)}
            value={moreCount}
            onChange={(event) => setMoreCount(Math.max(1, Math.min(GAME_LIMITS.maxQuestions, Math.round(Number(event.target.value)) || 1)))}
          />
          <span className="text-xs text-muted-foreground">
            {room > 0
              ? `in the ${QUESTION_MIXES.find((mix) => mix.id === settings.mix)?.label.toLowerCase() ?? 'custom'} mix`
              : `${GAME_LIMITS.maxQuestions} is the most a game can have`}
          </span>
        </div>
      )}
    </section>
  );
}

function ProblemList({ problems }: { problems: DraftProblem[] }) {
  return (
    <ul className="flex flex-col gap-0.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
      {problems.map((problem, i) => (
        <li key={i}>{problem.message}</li>
      ))}
    </ul>
  );
}

function QuestionEditor({
  index,
  count,
  question,
  problems,
  readOnly,
  busy,
  regenerating,
  onChange,
  onMove,
  onDelete,
  onRegenerate,
}: {
  index: number;
  count: number;
  question: DraftQuestion;
  problems: DraftProblem[];
  readOnly: boolean;
  busy: boolean;
  regenerating: boolean;
  onChange: (next: DraftQuestion) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
  onRegenerate: (note: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const setOption = (o: number, text: string) =>
    onChange({ ...question, options: question.options.map((option, i) => (i === o ? { ...option, text } : option)) });
  const markCorrect = (o: number) =>
    onChange({ ...question, options: question.options.map((option, i) => ({ ...option, isCorrect: i === o })) });
  const removeOption = (o: number) => onChange({ ...question, options: question.options.filter((_, i) => i !== o) });

  return (
    <li className={cn('flex flex-col gap-2 rounded-lg border bg-card p-3', regenerating && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Q{index + 1}</span>
        {readOnly ? (
          question.focus && (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', FOCUS_STYLES[question.focus])}>
              {question.focus}
            </span>
          )
        ) : (
          <Select value={question.focus ?? 'vocabulary'} onValueChange={(focus) => onChange({ ...question, focus: focus as QuestionFocus })}>
            <SelectTrigger aria-label={`What question ${index + 1} tests`} className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {questionFocusValues.map((focus) => (
                <SelectItem key={focus} value={focus} className="capitalize">
                  {focus}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!readOnly && (
          <div className="ml-auto flex items-center">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Regenerate"
              title="Regenerate this question"
              disabled={busy}
              onClick={() => setNoteOpen((open) => !open)}
            >
              {regenerating ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete question" title="Delete question" onClick={onDelete}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {noteOpen && !readOnly && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2"
          onSubmit={(event) => {
            event.preventDefault();
            onRegenerate(note.trim());
            setNoteOpen(false);
            setNote('');
          }}
        >
          <Input
            autoFocus
            className="h-8 min-w-0 flex-1 text-sm"
            placeholder="Note (optional): harder, about 았더니…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Regenerate
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
            Cancel
          </Button>
        </form>
      )}

      {/* Never cut off: long text ends in "…" and expands on click or tap. */}
      <ExpandableTextField
        aria-label={`Question ${index + 1}`}
        placeholder="The question"
        value={question.text}
        readOnly={readOnly}
        maxLength={GAME_LIMITS.maxPromptLength}
        onChange={(text) => onChange({ ...question, text })}
      />

      <div className="flex flex-col gap-1">
        {question.options.map((option, o) => (
          <div key={o} className="flex items-start gap-2">
            <button
              type="button"
              className={cn('mt-2.5 shrink-0', option.isCorrect ? 'text-green-600' : 'text-muted-foreground', readOnly && 'cursor-default')}
              aria-label={option.isCorrect ? `Option ${SLOT_LABELS[o]} is correct` : `Mark option ${SLOT_LABELS[o] ?? o + 1} correct`}
              title={option.isCorrect ? 'Correct answer' : 'Mark as the correct answer'}
              disabled={readOnly}
              onClick={() => markCorrect(o)}
            >
              {option.isCorrect ? <CircleCheck className="h-4 w-4" aria-hidden /> : <Circle className="h-4 w-4" aria-hidden />}
            </button>
            <span className="mt-2.5 w-4 shrink-0 text-xs font-semibold text-muted-foreground">{SLOT_LABELS[o] ?? '?'}</span>
            <ExpandableTextField
              aria-label={`Question ${index + 1}, option ${SLOT_LABELS[o] ?? o + 1}`}
              className="min-w-0 flex-1"
              value={option.text}
              readOnly={readOnly}
              maxLength={GAME_LIMITS.maxOptionLength}
              onChange={(text) => setOption(o, text)}
            />
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon"
                className="mt-1 h-7 w-7 shrink-0"
                aria-label={`Remove option ${SLOT_LABELS[o] ?? o + 1}`}
                title="Remove option"
                disabled={question.options.length <= GAME_LIMITS.minOptions}
                onClick={() => removeOption(o)}
              >
                <X aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {!readOnly && question.options.length < GAME_LIMITS.maxOptions && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => onChange({ ...question, options: [...question.options, { text: '', isCorrect: false }] })}
          >
            <Plus aria-hidden /> Option {SLOT_LABELS[question.options.length]}
          </Button>
        )}
      </div>

      {question.sourceExcerpt && (
        <p className="border-l-2 pl-2 text-xs italic text-muted-foreground" title="The sentence it's about (for review; not saved on the game)">
          {question.sourceExcerpt}
        </p>
      )}
      {problems.length > 0 && <ProblemList problems={problems} />}
    </li>
  );
}
