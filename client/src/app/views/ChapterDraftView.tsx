import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ExternalLink, Loader2, Share2, Trash2 } from 'lucide-react';
import { Button } from '../shared/button';
import { BackToDrafts, SaveIndicator, type SaveState } from '../game-authoring/DraftPageBits';
import {
  deleteDraft,
  DraftRequestError,
  shareDraft,
  useDraftChanged,
  type LanguagePair,
} from '../game-authoring/drafts-api';
import { ChapterDraftEditor } from '../library/ChapterDraftEditor';
import type { ChapterDraftOutput } from '../library/chapter-draft.schema';
import {
  emptyChapterContent,
  emptyDecision,
  findPatterns,
  findSenses,
  getChapterDraft,
  publishChapterDraft,
  updateChapterDraft,
  yallaChapterPath,
  type ChapterDraftContent,
  type ChapterDraftView as ChapterDraftData,
  type FoundPatterns,
  type FoundSense,
} from '../library/library-api';
import { suggestEntries } from '../library/pattern-suggest';
import { suggestDecision } from '../library/sense-suggest';
import { useChapterGeneration } from '../library/useChapterGeneration';

const AUTOSAVE_MS = 800;

function sourceKey(text: string, language: LanguagePair): string {
  return `${language.target}>${language.native}|${text.trim()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Network error: could not reach the server.';
}

/** The model's chapter, keeping the book choice. Words and patterns start undecided until they are looked up. */
function fromModel(output: ChapterDraftOutput, current: ChapterDraftContent): ChapterDraftContent {
  return {
    ...current,
    language: output.language,
    titleTarget: output.titleTarget,
    titleNative: output.titleNative,
    dialog: output.dialog.map((line) => ({ ...line })),
    vocabulary: output.vocabulary.map((word) => ({ ...word, sense: emptyDecision() })),
    patterns: output.patterns.map((pattern) => ({
      ...pattern,
      sampleSentences: pattern.sampleSentences.map((sample) => ({ ...sample })),
      exercises: pattern.exercises.map((exercise) => ({ ...exercise })),
      entries: [],
    })),
  };
}

/**
 * `/games/drafts/:draftId` for a library chapter draft
 * (docs/hashbrown/creating-games-with-hashbrown.md → Feature 2): generate the
 * chapter from the passage, decide each word's sense, then Publish it to a
 * book. Saves as the user goes, with the same revision check as game drafts.
 */
export function ChapterDraftView({ draftId }: { draftId: string }) {
  const navigate = useNavigate();
  const [view, setView] = useState<ChapterDraftData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState<ChapterDraftContent>(emptyChapterContent);
  const [sourceText, setSourceText] = useState('');
  const [language, setLanguage] = useState<LanguagePair>({ target: 'ko', native: 'en' });
  const [senses, setSenses] = useState<ReadonlyMap<string, FoundSense[]>>(new Map());
  const [patternMatches, setPatternMatches] = useState<ReadonlyMap<string, FoundPatterns>>(new Map());
  const [lookingUp, setLookingUp] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<ChapterDraftData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'publish' | 'share' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const latest = useRef({ content, sourceText, language });
  latest.current = { content, sourceText, language };
  const revision = useRef(0);
  const changeCount = useRef(0);
  const savedCount = useRef(0);
  const savedSource = useRef('');
  const sourceReady = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const stopped = useRef(false);

  const applyServerView = useCallback((next: ChapterDraftData) => {
    setView(next);
    revision.current = next.draft.revision;
    setContent(next.draft.payload ?? emptyChapterContent());
    setSourceText(next.source?.text ?? '');
    setLanguage(next.source?.language ?? next.draft.payload?.language ?? next.language);
    savedSource.current = next.source ? sourceKey(next.source.text, next.source.language) : '';
    sourceReady.current = false;
    changeCount.current = 0;
    savedCount.current = 0;
    stopped.current = false;
    setConflict(null);
    setSaveState('saved');
  }, []);

  useEffect(() => {
    let cancelled = false;
    getChapterDraft(draftId)
      .then((loaded) => {
        if (!cancelled) applyServerView(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof DraftRequestError && error.status === 404 ? 'Draft not found.' : errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, applyServerView]);

  useDraftChanged(draftId, () => {
    if (changeCount.current !== savedCount.current || inFlight.current) return;
    getChapterDraft(draftId)
      .then(applyServerView)
      .catch(() => undefined);
  });

  const save = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    if (stopped.current) return false;
    const { content: payload, sourceText: text, language: currentLanguage } = latest.current;
    const key = sourceKey(text, currentLanguage);
    const sendSource = sourceReady.current && text.trim().length > 0 && key !== savedSource.current;
    if (changeCount.current === savedCount.current && !sendSource) return true;

    const count = changeCount.current;
    setSaveState('saving');
    const run = (async () => {
      try {
        const next = await updateChapterDraft(draftId, {
          revision: revision.current,
          payload,
          ...(sendSource ? { source: { text: text.trim(), language: currentLanguage } } : {}),
        });
        revision.current = next.draft.revision;
        setView(next);
        if (sendSource) savedSource.current = key;
        savedCount.current = count;
        setSaveState(changeCount.current === count ? 'saved' : 'unsaved');
        return true;
      } catch (error) {
        if (error instanceof DraftRequestError && error.status === 409) {
          stopped.current = true;
          if (error.body.draft) {
            setConflict({
              draft: error.body.draft as unknown as ChapterDraftData['draft'],
              source: error.body.source ?? null,
              language: error.body.language ?? currentLanguage,
            });
          }
          setSaveState('conflict');
        } else {
          setSaveState('error');
          setActionError(errorMessage(error));
        }
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    const ok = await run;
    if (ok && changeCount.current !== savedCount.current) {
      timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    }
    return ok;
  }, [draftId]);

  const changed = useCallback(() => {
    changeCount.current += 1;
    if (stopped.current) return;
    setSaveState('unsaved');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [save]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (changeCount.current !== savedCount.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (changeCount.current !== savedCount.current) void save();
    };
  }, [save]);

  /**
   * Looks up the words' existing senses and the patterns' registry entries,
   * and fills in a guess for every undecided word and unlinked pattern.
   */
  const lookUp = useCallback(
    async (base?: ChapterDraftContent) => {
      const current = base ?? latest.current.content;
      const target = current.language?.target ?? latest.current.language.target;
      setLookingUp(true);
      try {
        const [found, patterns] = await Promise.all([
          findSenses(current.vocabulary.map((word) => word.targetLanguageText), target),
          findPatterns(current.patterns.map((pattern) => pattern.patternTarget), target),
        ]);
        const byWord = new Map(found.map((entry) => [entry.word, entry.senses]));
        const bySpelling = new Map(patterns.map((entry) => [entry.spelling, entry]));
        setSenses(byWord);
        setPatternMatches(bySpelling);
        const vocabulary = current.vocabulary.map((word) => {
          const options = byWord.get(word.targetLanguageText.trim());
          return word.sense.decision === 'undecided' && options
            ? { ...word, sense: suggestDecision(word.targetLanguageText, word.nativeLanguageText, options) }
            : word;
        });
        const linked = current.patterns.map((pattern) => {
          if (pattern.entries.length > 0) return pattern;
          const entries = suggestEntries(pattern, bySpelling.get(pattern.patternTarget.trim()));
          return entries.length > 0 ? { ...pattern, entries } : pattern;
        });
        const wordsChanged = vocabulary.some((word, i) => word !== current.vocabulary[i]);
        const patternsChanged = linked.some((pattern, i) => pattern !== current.patterns[i]);
        if (wordsChanged || patternsChanged) {
          setContent((now) => ({
            ...now,
            vocabulary: wordsChanged ? vocabulary : now.vocabulary,
            patterns: patternsChanged ? linked : now.patterns,
          }));
          changed();
        }
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setLookingUp(false);
      }
    },
    [changed],
  );

  // Once per draft: show the existing senses and patterns, and default undecided ones to them (reuse when there is one).
  const lookedUpFor = useRef<string | null>(null);
  useEffect(() => {
    if (!view || lookedUpFor.current === view.draft.id) return;
    lookedUpFor.current = view.draft.id;
    const payload = view.draft.payload;
    if (view.draft.status === 'draft' && payload && (payload.vocabulary.length > 0 || payload.patterns.length > 0)) void lookUp(payload);
  }, [view, lookUp]);

  const generation = useChapterGeneration((output) => {
    const next = fromModel(output, latest.current.content);
    setContent(next);
    changed();
    void lookUp(next);
  });

  if (loadError) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <BackToDrafts />
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading draft…
      </div>
    );
  }

  const { draft } = view;
  const frozen = view.chapter?.frozen ?? null;
  const readOnly = draft.status === 'accepted' || saveState === 'conflict';
  const mine = draft.mine;
  const problems = draft.problems;
  const saved = saveState === 'saved';
  const canPublish = mine && draft.status === 'draft' && saved && problems.length === 0 && !generation.pending && !lookingUp;

  const runAction = async (action: NonNullable<typeof busyAction>, fn: () => Promise<void>) => {
    setBusyAction(action);
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      if (error instanceof DraftRequestError && error.body.problems) {
        setView({ ...view, draft: { ...view.draft, problems: error.body.problems } });
      }
      setActionError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const onPublish = () =>
    runAction('publish', async () => {
      if (!(await save())) return;
      const { chapter } = await publishChapterDraft(draftId, revision.current);
      navigate(yallaChapterPath(chapter.book, chapter.chapter));
    });

  const onShare = (shared: boolean) =>
    runAction('share', async () => {
      if (!(await save())) return;
      const next = await shareDraft(draftId, shared);
      revision.current = next.draft.revision;
      setView({ ...view, draft: { ...view.draft, shared: next.draft.shared, revision: next.draft.revision } });
    });

  const onDelete = () =>
    runAction('delete', async () => {
      stopped.current = true;
      await deleteDraft(draftId);
      changeCount.current = savedCount.current;
      navigate('/games/drafts');
    });

  const heading = content.titleNative.trim() || content.titleTarget.trim() || 'Untitled chapter';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackToDrafts />
        <div className="flex flex-wrap items-center gap-2">
          <BookOpen className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="text-xl font-bold">{heading}</h1>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
            {frozen ? 'chapter edit' : 'library chapter'}
          </span>
          {draft.status === 'accepted' && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">published</span>
          )}
          {draft.shared && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">shared</span>}
          {!mine && <span className="text-xs text-muted-foreground">Shared by another referee</span>}
          <SaveIndicator state={saveState} />
        </div>
        {draft.remixedFromChapter && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Remix of{' '}
            <Link className="underline" to={yallaChapterPath(draft.remixedFromChapter.book, draft.remixedFromChapter.chapter)}>
              {draft.remixedFromChapter.book}, chapter {draft.remixedFromChapter.chapter}
            </Link>
            . Its words keep their senses, so practice counts toward the same progress.
          </p>
        )}
      </div>

      {conflict && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>This draft was changed in another tab or by another referee. Your last edits aren’t saved.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => applyServerView(conflict)}>
              Load their version
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                revision.current = conflict.draft.revision;
                stopped.current = false;
                setConflict(null);
                changeCount.current += 1;
                void save();
              }}
            >
              Keep mine
            </Button>
          </div>
        </div>
      )}

      {draft.status === 'accepted' && draft.resultChapter && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span>This draft was published and can no longer change.</span>
          <Link
            className="inline-flex items-center gap-1 font-medium underline"
            to={yallaChapterPath(draft.resultChapter.book, draft.resultChapter.chapter)}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open in YALLA
          </Link>
        </div>
      )}

      <ChapterDraftEditor
        content={content}
        onContentChange={(next) => {
          setContent(next);
          changed();
        }}
        source={sourceText}
        onSourceChange={(text) => {
          setSourceText(text);
          sourceReady.current = false;
        }}
        onSourceCommit={() => {
          sourceReady.current = true;
          if (sourceKey(sourceText, language) !== savedSource.current && sourceText.trim()) void save();
        }}
        books={view.chapter?.books ?? []}
        frozen={frozen}
        senses={senses}
        patternMatches={patternMatches}
        onLookUp={() => void lookUp()}
        lookingUp={lookingUp}
        problems={problems}
        readOnly={readOnly}
        generation={{
          pending: generation.pending,
          progress: generation.progress,
          error: generation.error,
          onGenerate: () => {
            sourceReady.current = true;
            void save();
            generation.generate(sourceText.trim(), language);
          },
          onCancel: generation.cancel,
        }}
      />

      {actionError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p>}

      {draft.status === 'draft' && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {mine ? (
            <>
              <Button onClick={() => void onPublish()} disabled={!canPublish || busyAction !== null}>
                {busyAction === 'publish' ? <Loader2 className="animate-spin" aria-hidden /> : <BookOpen aria-hidden />}
                {frozen ? 'Publish changes' : 'Publish'}
              </Button>
              <Button variant="outline" onClick={() => void onShare(!draft.shared)} disabled={busyAction !== null || readOnly}>
                <Share2 aria-hidden /> {draft.shared ? 'Unshare' : 'Share'}
              </Button>
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  Delete this draft?
                  <Button variant="destructive" size="sm" onClick={() => void onDelete()} disabled={busyAction !== null}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busyAction !== null}>
                  <Trash2 aria-hidden /> Delete
                </Button>
              )}
              {!canPublish && saved && problems.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Fix {problems.length} problem{problems.length === 1 ? '' : 's'} to publish.
                </span>
              )}
              {!frozen && (
                <span className="w-full text-xs text-muted-foreground">
                  Publishing makes the chapter open to every signed-in user in YALLA. After that its words can be corrected
                  or added to, but not removed or reordered.
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              Only the referee who shared this draft can publish it. Your edits save to their draft.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
