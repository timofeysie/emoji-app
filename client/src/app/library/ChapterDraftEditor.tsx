import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Lock, Loader2, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '../shared/button';
import { ExpandableTextField } from '../shared/ExpandableTextField';
import { Input } from '../shared/input';
import { Label } from '../shared/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/select';
import { Textarea } from '../shared/textarea';
import { cn } from '../shared/utils';
import type { DraftProblem } from '../game-authoring/drafts-api';
import { GAME_LIMITS } from '../game-authoring/game-limits';
import { CHAPTER_LIMITS } from './chapter-limits';
import {
  emptyDecision,
  suggestBookSlug,
  type ChapterDialogLine,
  type ChapterDraftContent,
  type ChapterPattern,
  type ChapterWord,
  type FoundPattern,
  type FoundPatterns,
  type FoundSense,
  type FrozenChapter,
  type MyBook,
  type PatternDecision,
  type SenseDecision,
} from './library-api';
import { newEntryFor, reuseEntry } from './pattern-suggest';
import { newSenseFor } from './sense-suggest';

type Tab = 'dialog' | 'vocabulary' | 'patterns';

const NEW_BOOK = '__new__';

export type ChapterDraftEditorProps = {
  content: ChapterDraftContent;
  onContentChange: (next: ChapterDraftContent) => void;
  source: string;
  onSourceChange: (text: string) => void;
  onSourceCommit: () => void;
  books: MyBook[];
  /** An edit of a published chapter: its words and patterns stay (G8). */
  frozen: FrozenChapter | null;
  /** Existing senses per word, from the last lookup. */
  senses: ReadonlyMap<string, FoundSense[]>;
  /** Registry entries per book pattern (by its text), from the last lookup. */
  patternMatches: ReadonlyMap<string, FoundPatterns>;
  /** Looks up senses and patterns. */
  onLookUp: () => void;
  lookingUp: boolean;
  problems: DraftProblem[];
  readOnly: boolean;
  generation: {
    pending: boolean;
    progress: { lines: number; words: number };
    error: string | null;
    onGenerate: () => void;
    onCancel: () => void;
  };
};

function problemsAt(problems: DraftProblem[], prefix: string): DraftProblem[] {
  return problems.filter((problem) => problem.path === prefix || problem.path.startsWith(`${prefix}.`));
}

function ProblemList({ problems }: { problems: DraftProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="text-xs text-destructive">
      {problems.map((problem, i) => (
        <li key={i}>{problem.message}</li>
      ))}
    </ul>
  );
}

/**
 * A library chapter draft (docs/hashbrown/creating-games-with-hashbrown.md →
 * Feature 2): the passage and book on the left, the chapter on the right in
 * YALLA's Dialog, Vocabulary and Patterns tabs, with a sense decision per
 * word (G7) and the grammar entries each pattern teaches (GP5). Controlled:
 * the page saves what it reports.
 */
export function ChapterDraftEditor(props: ChapterDraftEditorProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <SourcePane {...props} />
      <ChapterPane {...props} />
    </div>
  );
}

function SourcePane({
  content,
  onContentChange,
  source,
  onSourceChange,
  onSourceCommit,
  books,
  frozen,
  problems,
  readOnly,
  generation,
}: ChapterDraftEditorProps) {
  const tooLong = source.length > GAME_LIMITS.maxSourceLength;
  const canGenerate = !readOnly && !frozen && !generation.pending && source.trim().length > 0 && !tooLong;
  const bookValue = content.bookSlug || NEW_BOOK;
  const hasChapter = content.dialog.length > 0 || content.vocabulary.length > 0;

  return (
    <section className="flex w-full flex-col gap-3 rounded-lg border bg-background p-3 lg:w-[22rem] lg:shrink-0">
      <h2 className="text-sm font-semibold">Book</h2>
      {frozen ? (
        <p className="flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Editing chapter {frozen.chapter} of {frozen.book}. Its {frozen.words.length} published words keep their place and
          sense: correct their meanings or add words after them.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chapter-book">Add to</Label>
            <Select
              value={bookValue}
              disabled={readOnly}
              onValueChange={(value) =>
                onContentChange({ ...content, bookSlug: value === NEW_BOOK ? '' : value })
              }
            >
              <SelectTrigger id="chapter-book">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {books.map((book) => (
                  <SelectItem key={book.slug} value={book.slug}>
                    {book.title} ({book.chapterCount} chapter{book.chapterCount === 1 ? '' : 's'})
                  </SelectItem>
                ))}
                <SelectItem value={NEW_BOOK}>A new book</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {bookValue === NEW_BOOK && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="chapter-book-title">New book title</Label>
                <Input
                  id="chapter-book-title"
                  value={content.newBook.title}
                  readOnly={readOnly}
                  maxLength={CHAPTER_LIMITS.maxTitleLength}
                  placeholder="e.g. Rabbit stories"
                  onChange={(event) => onContentChange({ ...content, newBook: { ...content.newBook, title: event.target.value } })}
                  onBlur={() => {
                    if (!content.newBook.slug && content.newBook.title.trim()) {
                      onContentChange({ ...content, newBook: { ...content.newBook, slug: suggestBookSlug(content.newBook.title) } });
                    }
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="chapter-book-slug">Link name</Label>
                <Input
                  id="chapter-book-slug"
                  value={content.newBook.slug}
                  readOnly={readOnly}
                  maxLength={CHAPTER_LIMITS.maxBookSlugLength}
                  placeholder="rabbit-stories-3f9a"
                  onChange={(event) => onContentChange({ ...content, newBook: { ...content.newBook, slug: event.target.value.toLowerCase() } })}
                />
                <p className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  It goes into learning records and can’t change after the first Publish. No one’s name in it.
                </p>
              </div>
            </>
          )}
          <ProblemList problems={[...problemsAt(problems, 'bookSlug'), ...problemsAt(problems, 'newBook')]} />
        </>
      )}

      <h2 className="mt-1 text-sm font-semibold">Source</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chapter-source">Passage</Label>
        <Textarea
          id="chapter-source"
          className="min-h-40 text-sm"
          placeholder="Paste a story or a conversation…"
          value={source}
          readOnly={readOnly || frozen !== null}
          onChange={(event) => onSourceChange(event.target.value)}
          onBlur={onSourceCommit}
        />
        <p className={cn('text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
          {source.length.toLocaleString()} / {GAME_LIMITS.maxSourceLength.toLocaleString()} characters
        </p>
        <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          The passage is sent to OpenAI to write the chapter. A published chapter, with its passage, is open to every
          signed-in user, who can study and remix it. Paste only text you may share, with no one’s personal details.
        </p>
      </div>

      {!readOnly && !frozen && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={generation.onGenerate} disabled={!canGenerate}>
            {generation.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {hasChapter ? 'Generate again' : 'Generate'}
          </Button>
          {generation.pending && (
            <Button variant="ghost" size="sm" onClick={generation.onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {!readOnly && hasChapter && !generation.pending && !frozen && (
        <p className="text-xs text-muted-foreground">Generating again replaces the whole chapter.</p>
      )}
      {generation.pending && (
        <p className="text-xs text-muted-foreground">
          Writing the chapter…
          {generation.progress.lines > 0 ? ` ${generation.progress.lines} lines` : ''}
          {generation.progress.words > 0 ? `, ${generation.progress.words} words` : ''}
        </p>
      )}
      {generation.error && <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{generation.error}</p>}
    </section>
  );
}

function ChapterPane(props: ChapterDraftEditorProps) {
  const { content, onContentChange, problems, readOnly } = props;
  const [tab, setTab] = useState<Tab>('vocabulary');
  const tabProblems = (which: Tab) => problemsAt(problems, which).length;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Chapter title</Label>
          <ExpandableTextField
            aria-label="Chapter title"
            value={content.titleTarget}
            readOnly={readOnly}
            maxLength={CHAPTER_LIMITS.maxTitleLength}
            placeholder="토끼와 거북이"
            onChange={(titleTarget) => onContentChange({ ...content, titleTarget })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Translated title</Label>
          <ExpandableTextField
            aria-label="Translated title"
            value={content.titleNative}
            readOnly={readOnly}
            maxLength={CHAPTER_LIMITS.maxTitleLength}
            placeholder="The rabbit and the turtle"
            onChange={(titleNative) => onContentChange({ ...content, titleNative })}
          />
        </div>
      </div>
      <ProblemList problems={[...problemsAt(problems, 'titleTarget'), ...problemsAt(problems, 'titleNative')]} />

      <div className="flex gap-1 border-b" role="tablist">
        {(
          [
            ['dialog', `Passage (${content.dialog.length})`],
            ['vocabulary', `Vocabulary (${content.vocabulary.length})`],
            ['patterns', `Patterns (${content.patterns.length})`],
          ] as const
        ).map(([which, label]) => (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={tab === which}
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-sm',
              tab === which ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(which)}
          >
            {label}
            {tabProblems(which) > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 text-[11px] text-destructive">{tabProblems(which)}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'dialog' && <DialogTab {...props} />}
      {tab === 'vocabulary' && <VocabularyTab {...props} />}
      {tab === 'patterns' && <PatternsTab {...props} />}
    </section>
  );
}

function DialogTab({ content, onContentChange, problems, readOnly }: ChapterDraftEditorProps) {
  const setLine = (index: number, line: ChapterDialogLine) =>
    onContentChange({ ...content, dialog: content.dialog.map((current, i) => (i === index ? line : current)) });
  return (
    <div className="flex flex-col gap-2">
      <ProblemList problems={problems.filter((problem) => problem.path === 'dialog')} />
      {content.dialog.length === 0 && <p className="text-sm text-muted-foreground">Generate the chapter, or add lines.</p>}
      {content.dialog.map((line, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground">{i + 1}</span>
            <Input
              aria-label={`Line ${i + 1} speaker`}
              className="h-7 w-32 text-xs"
              placeholder="Speaker (optional)"
              value={line.speakerNameTarget}
              readOnly={readOnly}
              onChange={(event) => setLine(i, { ...line, speakerNameTarget: event.target.value })}
            />
            {!readOnly && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => onContentChange({ ...content, dialog: content.dialog.filter((_, j) => j !== i) })}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
          <ExpandableTextField
            aria-label={`Line ${i + 1}`}
            value={line.speechTarget}
            readOnly={readOnly}
            onChange={(speechTarget) => setLine(i, { ...line, speechTarget })}
          />
          <ExpandableTextField
            aria-label={`Line ${i + 1} translation`}
            className="text-muted-foreground"
            value={line.speechNative}
            readOnly={readOnly}
            onChange={(speechNative) => setLine(i, { ...line, speechNative })}
          />
          <ProblemList problems={problemsAt(problems, `dialog.${i}`)} />
        </div>
      ))}
      {!readOnly && content.dialog.length < CHAPTER_LIMITS.maxDialogLines && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            onContentChange({
              ...content,
              dialog: [...content.dialog, { speakerNameTarget: '', speakerNameNative: '', speechTarget: '', speechNative: '' }],
            })
          }
        >
          <Plus aria-hidden /> Add a line
        </Button>
      )}
    </div>
  );
}

function VocabularyTab({ content, onContentChange, problems, readOnly, frozen, senses, onLookUp, lookingUp }: ChapterDraftEditorProps) {
  const frozenCount = frozen?.words.length ?? 0;
  const setWord = (index: number, word: ChapterWord) =>
    onContentChange({ ...content, vocabulary: content.vocabulary.map((current, i) => (i === index ? word : current)) });
  const move = (index: number, by: number) => {
    const next = [...content.vocabulary];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onContentChange({ ...content, vocabulary: next });
  };
  const unconfirmed = content.vocabulary.filter((word) => word.sense.decision === 'new' && !word.sense.confirmed).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Each word is one learning object: reuse a sense another book already teaches, or add a new one. New senses are
          permanent once used, so check them.
        </span>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={onLookUp} disabled={lookingUp || content.vocabulary.length === 0}>
            {lookingUp ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />} Look up senses
          </Button>
        )}
        {!readOnly && unconfirmed > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onContentChange({
                ...content,
                vocabulary: content.vocabulary.map((word) =>
                  word.sense.decision === 'new' ? { ...word, sense: { ...word.sense, confirmed: true } } : word,
                ),
              })
            }
          >
            Confirm all {unconfirmed} new senses
          </Button>
        )}
      </div>
      <ProblemList problems={problems.filter((problem) => problem.path === 'vocabulary')} />
      {content.vocabulary.map((word, i) => {
        const locked = i < frozenCount;
        return (
          <div key={i} className={cn('flex flex-col gap-1.5 rounded-md border p-2', locked && 'bg-muted/40')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <Input
                aria-label={`Word ${i + 1}`}
                className="h-8 w-36"
                lang={content.language?.target ?? 'ko'}
                value={word.targetLanguageText}
                readOnly={readOnly || locked}
                maxLength={CHAPTER_LIMITS.maxWordLength}
                onChange={(event) => setWord(i, { ...word, targetLanguageText: event.target.value })}
              />
              <div className="min-w-40 flex-1">
                <ExpandableTextField
                  aria-label={`Word ${i + 1} meaning`}
                  value={word.nativeLanguageText}
                  readOnly={readOnly}
                  maxLength={CHAPTER_LIMITS.maxGlossLength}
                  onChange={(nativeLanguageText) => setWord(i, { ...word, nativeLanguageText })}
                />
              </div>
              {locked ? (
                <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Published: keeps its place and sense" />
              ) : (
                !readOnly && (
                  <span className="flex">
                    <Button size="sm" variant="ghost" aria-label="Move up" disabled={i <= frozenCount} onClick={() => move(i, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={i === content.vocabulary.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove word ${i + 1}`}
                      onClick={() => onContentChange({ ...content, vocabulary: content.vocabulary.filter((_, j) => j !== i) })}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                )
              )}
            </div>
            <SenseField
              word={word}
              found={senses.get(word.targetLanguageText.trim()) ?? null}
              readOnly={readOnly || locked}
              onChange={(sense) => setWord(i, { ...word, sense })}
            />
            <ProblemList problems={problemsAt(problems, `vocabulary.${i}`)} />
          </div>
        );
      })}
      {!readOnly && content.vocabulary.length < CHAPTER_LIMITS.maxVocabulary && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            onContentChange({
              ...content,
              vocabulary: [...content.vocabulary, { targetLanguageText: '', nativeLanguageText: '', sense: emptyDecision() }],
            })
          }
        >
          <Plus aria-hidden /> Add a word
        </Button>
      )}
    </div>
  );
}

/** Reuse one of the word's existing senses, or add a new one the user confirms (G7). */
function SenseField({
  word,
  found,
  readOnly,
  onChange,
}: {
  word: ChapterWord;
  found: FoundSense[] | null;
  readOnly: boolean;
  onChange: (sense: SenseDecision) => void;
}) {
  const { sense } = word;
  const options = found ?? [];
  const reuseKnown = sense.decision === 'reuse' && !options.some((option) => option.id === sense.reuseId);
  const value = sense.decision === 'reuse' ? `reuse:${sense.reuseId}` : sense.decision;

  return (
    <div className="flex flex-wrap items-center gap-2 pl-8 text-xs">
      <span className="text-muted-foreground">Sense</span>
      <Select
        value={value}
        disabled={readOnly}
        onValueChange={(next) => {
          if (next.startsWith('reuse:')) {
            const id = next.slice('reuse:'.length);
            const option = options.find((candidate) => candidate.id === id);
            onChange({ ...emptyDecision(), decision: 'reuse', reuseId: id, kind: option?.kind === 'expression' ? 'expression' : 'lexeme' });
          } else if (next === 'new') {
            onChange(newSenseFor(word.targetLanguageText, word.nativeLanguageText));
          } else {
            onChange(emptyDecision());
          }
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-48 max-w-full text-xs" aria-label="Sense">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="undecided">Choose…</SelectItem>
          {reuseKnown && <SelectItem value={`reuse:${sense.reuseId}`}>reuse {sense.reuseId}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.id} value={`reuse:${option.id}`}>
              reuse {option.id} — {option.gloss}
              {option.from === 'library' ? ' (library)' : ''}
            </SelectItem>
          ))}
          <SelectItem value="new">new sense…</SelectItem>
        </SelectContent>
      </Select>
      {found === null && sense.decision !== 'reuse' && <span className="text-muted-foreground">Look up senses to see existing ones.</span>}
      {sense.decision === 'reuse' && !readOnly && (
        <span className="text-orange-600" data-testid="sense-reused">
          Reusing an existing sense, so practice counts toward the same progress. Change it if this word means something
          else here.
        </span>
      )}
      {found !== null && found.length === 0 && sense.decision === 'new' && (
        <span className="text-muted-foreground">No book teaches this word yet.</span>
      )}
      {sense.decision === 'new' && (
        <>
          <Input
            aria-label="New sense name"
            className="h-7 w-36 text-xs"
            value={sense.newSense}
            readOnly={readOnly}
            maxLength={CHAPTER_LIMITS.maxSenseSlugLength}
            placeholder="e.g. rabbit"
            onChange={(event) => onChange({ ...sense, newSense: event.target.value.toLowerCase(), confirmed: false })}
          />
          <Select
            value={sense.kind}
            disabled={readOnly}
            onValueChange={(kind) => onChange({ ...sense, kind: kind as SenseDecision['kind'], confirmed: false })}
          >
            <SelectTrigger className="h-7 w-32 text-xs" aria-label="Kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lexeme">lexeme</SelectItem>
              <SelectItem value="expression">expression</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={sense.confirmed}
              disabled={readOnly}
              onChange={(event) => onChange({ ...sense, confirmed: event.target.checked })}
            />
            Confirmed
          </label>
        </>
      )}
    </div>
  );
}

function PatternsTab({ content, onContentChange, problems, readOnly, frozen, patternMatches, onLookUp, lookingUp }: ChapterDraftEditorProps) {
  const frozenCount = frozen?.patternCount ?? 0;
  const language = content.language?.target ?? 'ko';
  const setPattern = (index: number, pattern: ChapterPattern) =>
    onContentChange({ ...content, patterns: content.patterns.map((current, i) => (i === index ? pattern : current)) });
  const field = (pattern: ChapterPattern, i: number, key: keyof ChapterPattern & string, label: string) => (
    <ExpandableTextField
      aria-label={`Pattern ${i + 1} ${label}`}
      placeholder={label}
      value={pattern[key] as string}
      readOnly={readOnly}
      onChange={(value) => setPattern(i, { ...pattern, [key]: value })}
    />
  );
  const unconfirmed = content.patterns.flatMap((pattern) => pattern.entries).filter((entry) => entry.decision === 'new' && !entry.confirmed).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Each pattern teaches one or more grammar entries, which students practise as fill-in-the-blank questions. Reuse an
          entry another book teaches, or add a new one. New entries are permanent once used, so check them.
        </span>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={onLookUp} disabled={lookingUp || content.patterns.length === 0}>
            {lookingUp ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />} Look up patterns
          </Button>
        )}
        {!readOnly && unconfirmed > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onContentChange({
                ...content,
                patterns: content.patterns.map((pattern) => ({
                  ...pattern,
                  entries: pattern.entries.map((entry) => (entry.decision === 'new' ? { ...entry, confirmed: true } : entry)),
                })),
              })
            }
          >
            Confirm all {unconfirmed} new pattern{unconfirmed === 1 ? '' : 's'}
          </Button>
        )}
      </div>
      <ProblemList problems={problems.filter((problem) => problem.path === 'patterns')} />
      {content.patterns.map((pattern, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Pattern {i + 1}</span>
            {!readOnly && i >= frozenCount && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                aria-label={`Remove pattern ${i + 1}`}
                onClick={() => onContentChange({ ...content, patterns: content.patterns.filter((_, j) => j !== i) })}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
          {field(pattern, i, 'patternTarget', 'Pattern')}
          {field(pattern, i, 'patternNative', 'Meaning')}
          {field(pattern, i, 'exampleSentenceTarget', 'Sentence from the passage')}
          {field(pattern, i, 'exampleSentenceNative', 'Its translation')}
          {pattern.sampleSentences.map((sample, j) => (
            <p key={`s${j}`} className="pl-2 text-xs">
              <span lang={language}>{sample.targetText}</span> <span className="text-muted-foreground">{sample.nativeText}</span>
            </p>
          ))}
          {pattern.exercises.map((exercise, j) => (
            <p key={`e${j}`} className="pl-2 text-xs text-muted-foreground">
              Exercise: {exercise.exercise} → <span lang={language}>{exercise.answerKey}</span>
            </p>
          ))}
          <PatternEntries
            pattern={pattern}
            found={patternMatches.get(pattern.patternTarget.trim()) ?? null}
            lockedIds={frozen?.patternIds[i] ?? []}
            readOnly={readOnly}
            language={language}
            onChange={(entries) => setPattern(i, { ...pattern, entries })}
          />
          <ProblemList problems={problemsAt(problems, `patterns.${i}`)} />
        </div>
      ))}
      {!readOnly && content.patterns.length < CHAPTER_LIMITS.maxPatterns && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            onContentChange({
              ...content,
              patterns: [
                ...content.patterns,
                {
                  patternTarget: '',
                  patternNative: '',
                  type: '',
                  exampleSentenceTarget: '',
                  exampleSentenceNative: '',
                  sampleSentences: [],
                  exercises: [],
                  entries: [],
                },
              ],
            })
          }
        >
          <Plus aria-hidden /> Add a pattern
        </Button>
      )}
    </div>
  );
}

const ADD_NEW = '__new__';

/**
 * The grammar entries a book pattern teaches (GP5): reused ones (exact
 * matches are chosen on lookup), entries found inside the pattern to add,
 * or a new entry the user confirms. Published links stay (G8).
 */
function PatternEntries({
  pattern,
  found,
  lockedIds,
  readOnly,
  language,
  onChange,
}: {
  pattern: ChapterPattern;
  found: FoundPatterns | null;
  lockedIds: readonly string[];
  readOnly: boolean;
  language: string;
  onChange: (entries: PatternDecision[]) => void;
}) {
  const { entries } = pattern;
  const known = new Map<string, FoundPattern & { inside: boolean }>();
  for (const option of found?.exact ?? []) known.set(option.id, { ...option, inside: false });
  for (const option of found?.contained ?? []) known.set(option.id, { ...option, inside: true });
  const linked = new Set(entries.filter((entry) => entry.decision === 'reuse').map((entry) => entry.reuseId));
  const offers = [...known.values()].filter((option) => !linked.has(option.id));
  const setEntry = (index: number, entry: PatternDecision) => onChange(entries.map((current, j) => (j === index ? entry : current)));

  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-2 text-xs">
      <span className="font-medium">Teaches</span>
      {entries.length === 0 && (
        <span className="text-muted-foreground">
          {found === null ? 'Look up patterns to see existing entries.' : 'Nothing yet: add the grammar this pattern teaches.'}
        </span>
      )}
      {entries.map((entry, j) => {
        const locked = entry.decision === 'reuse' && lockedIds.includes(entry.reuseId);
        const option = entry.decision === 'reuse' ? known.get(entry.reuseId) : undefined;
        return (
          <div key={j} className="flex flex-wrap items-center gap-2">
            {entry.decision === 'reuse' ? (
              <>
                <span lang={language} className="font-medium">
                  {option?.headword ?? entry.reuseId}
                </span>
                {option && <span className="text-muted-foreground">{option.gloss}</span>}
                <span className="text-muted-foreground">
                  {entry.reuseId}
                  {option?.from === 'library' ? ' (library)' : ''}
                </span>
                {!readOnly && !locked && (
                  <span className="text-orange-600" data-testid="pattern-reused">
                    Reused, so practice counts toward the same progress.
                  </span>
                )}
              </>
            ) : (
              <>
                <Input
                  aria-label="New pattern headword"
                  className="h-7 w-36 text-xs"
                  lang={language}
                  value={entry.headword}
                  readOnly={readOnly}
                  maxLength={CHAPTER_LIMITS.maxPatternHeadwordLength}
                  placeholder="-아/어/여지다"
                  onChange={(event) => setEntry(j, { ...entry, headword: event.target.value, confirmed: false })}
                />
                <Input
                  aria-label="New pattern meaning"
                  className="h-7 w-32 text-xs"
                  value={entry.meaning}
                  readOnly={readOnly}
                  maxLength={CHAPTER_LIMITS.maxSenseSlugLength}
                  placeholder="become"
                  onChange={(event) => setEntry(j, { ...entry, meaning: event.target.value.toLowerCase(), confirmed: false })}
                />
                <Input
                  aria-label="New pattern gloss"
                  className="h-7 min-w-40 flex-1 text-xs"
                  value={entry.gloss}
                  readOnly={readOnly}
                  maxLength={CHAPTER_LIMITS.maxPatternGlossLength}
                  placeholder="gets to be, becomes"
                  onChange={(event) => setEntry(j, { ...entry, gloss: event.target.value, confirmed: false })}
                />
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={entry.confirmed}
                    disabled={readOnly}
                    onChange={(event) => setEntry(j, { ...entry, confirmed: event.target.checked })}
                  />
                  Confirmed
                </label>
              </>
            )}
            {locked ? (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Published: this link stays" />
            ) : (
              !readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5"
                  aria-label="Remove this entry"
                  onClick={() => onChange(entries.filter((_, k) => k !== j))}
                >
                  <Trash2 aria-hidden />
                </Button>
              )
            )}
          </div>
        );
      })}
      {found?.problem && <span className="text-muted-foreground">Can’t match this pattern by its spelling: {found.problem}</span>}
      {!readOnly && entries.length < CHAPTER_LIMITS.maxPatternEntries && (
        <Select
          value=""
          onValueChange={(value) =>
            // A first new entry is named after the pattern; a further one (the other half of a combination) starts empty.
            onChange([
              ...entries,
              value === ADD_NEW
                ? entries.length === 0
                  ? newEntryFor(pattern)
                  : { ...newEntryFor(pattern), headword: '', meaning: '', gloss: '' }
                : reuseEntry({ id: value }),
            ])
          }
        >
          <SelectTrigger className="h-7 w-auto min-w-48 max-w-full text-xs" aria-label="Add an entry">
            <SelectValue placeholder="Add an entry…" />
          </SelectTrigger>
          <SelectContent>
            {offers.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                reuse {option.headword} — {option.gloss}
                {option.inside ? ' (found inside it)' : ''}
                {option.from === 'library' ? ' (library)' : ''}
              </SelectItem>
            ))}
            <SelectItem value={ADD_NEW}>new entry…</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
