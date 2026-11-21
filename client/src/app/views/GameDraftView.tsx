import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronLeft, Copy, ExternalLink, Gamepad2, Loader2, Share2, Trash2 } from 'lucide-react';
import { Button } from '../shared/button';
import { cn } from '../shared/utils';
import {
  acceptDraft,
  ASKING_FOR_GAMES_URL,
  createDraft,
  deleteDraft,
  DraftRequestError,
  getDraft,
  shareDraft,
  updateDraft,
  type DraftSettings,
  type DraftView,
  type GameDraftContent,
  type LanguagePair,
} from '../game-authoring/drafts-api';
import { GameDraftEditor } from '../game-authoring/GameDraftEditor';
import { GAME_LIMITS } from '../game-authoring/game-limits';
import { useGameGeneration, type GenerationRequest } from '../game-authoring/useGameGeneration';
import type { GameDraftPayload } from '../game-authoring/game-draft.schema';

const AUTOSAVE_MS = 800;

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

function emptyContent(): GameDraftContent {
  return { title: '', questions: [] };
}

function sourceKey(text: string, language: LanguagePair): string {
  return `${language.target}>${language.native}|${text.trim()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Network error: could not reach the server.';
}

/** The model's answer as draft questions (focus and excerpt are kept for review). */
function fromModel(output: GameDraftPayload): GameDraftContent {
  return {
    title: output.title.slice(0, GAME_LIMITS.maxTitleLength),
    language: output.language,
    questions: output.questions.map((question) => ({
      text: question.text,
      focus: question.focus,
      options: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
      sourceExcerpt: question.sourceExcerpt,
    })),
  };
}

/**
 * `/games/drafts/:draftId`: one draft in the editor, saved as the user goes
 * (docs/hashbrown/creating-games-with-hashbrown.md → Draft Game page). Every
 * save carries the revision it was made from; if another tab or referee saved
 * first, the page stops and asks which version to keep.
 */
export function GameDraftView() {
  const { draftId = '' } = useParams<{ draftId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<DraftView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState<GameDraftContent>(emptyContent);
  const [settings, setSettings] = useState<DraftSettings>({ mix: 'vocabulary', questionCount: 10, optionsPerQuestion: 4 });
  const [sourceText, setSourceText] = useState('');
  const [language, setLanguage] = useState<LanguagePair>({ target: 'ko', native: 'en' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<DraftView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'accept' | 'share' | 'delete' | 'duplicate' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The async saver reads these, not the render's values.
  const latest = useRef({ content, settings, sourceText, language });
  latest.current = { content, settings, sourceText, language };
  const revision = useRef(0);
  const changeCount = useRef(0);
  const savedCount = useRef(0);
  const savedSource = useRef('');
  /** Set when the paste box is left or a generation starts: only then is the text saved as a source. */
  const sourceReady = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const stopped = useRef(false);

  const applyServerView = useCallback((next: DraftView) => {
    setView(next);
    revision.current = next.draft.revision;
    const source = next.source;
    setContent(next.draft.payload ?? emptyContent());
    setSettings(next.draft.settings);
    setSourceText(source?.text ?? '');
    setLanguage(source?.language ?? next.language);
    savedSource.current = source ? sourceKey(source.text, source.language) : '';
    sourceReady.current = false;
    changeCount.current = 0;
    savedCount.current = 0;
    stopped.current = false;
    setConflict(null);
    setSaveState('saved');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setLoadError(null);
    getDraft(draftId)
      .then((loaded) => {
        if (!cancelled) applyServerView(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof DraftRequestError && error.status === 404 ? 'Draft not found.' : errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, applyServerView]);

  const save = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    if (stopped.current) return false;
    const { content: payload, settings: currentSettings, sourceText: text, language: currentLanguage } = latest.current;
    const key = sourceKey(text, currentLanguage);
    const sendSource = sourceReady.current && text.trim().length > 0 && key !== savedSource.current;
    if (changeCount.current === savedCount.current && !sendSource) return true;

    const count = changeCount.current;
    setSaveState('saving');
    const run = (async () => {
      try {
        const next = await updateDraft(draftId, {
          revision: revision.current,
          payload,
          settings: currentSettings,
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
            setConflict({ draft: error.body.draft, source: error.body.source ?? null, language: error.body.language ?? currentLanguage });
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

  // Leaving the page: save what's left, and warn before closing the tab with unsaved edits.
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

  const generation = useGameGeneration((request: GenerationRequest, output: GameDraftPayload) => {
    const answer = fromModel(output);
    setContent((current) => {
      if (request.kind === 'all') {
        return answer;
      }
      if (request.kind === 'one') {
        const [replacement] = answer.questions;
        if (!replacement) return current;
        return { ...current, questions: current.questions.map((question, i) => (i === request.index ? replacement : question)) };
      }
      const room = GAME_LIMITS.maxQuestions - current.questions.length;
      return { ...current, questions: [...current.questions, ...answer.questions.slice(0, Math.max(0, room))] };
    });
    changed();
  });

  const startGeneration = (request: GenerationRequest) => {
    sourceReady.current = true;
    void save();
    generation.generate(request, { source: sourceText.trim(), language, settings, questions: content.questions });
  };

  const readOnly = view?.draft.status === 'accepted' || saveState === 'conflict';
  const mine = view?.draft.mine ?? false;
  const problems = view?.draft.problems ?? [];
  const saved = saveState === 'saved';
  const canAccept = mine && view?.draft.status === 'draft' && saved && problems.length === 0 && generation.pending === null;

  const runAction = async (action: NonNullable<typeof busyAction>, fn: () => Promise<void>) => {
    setBusyAction(action);
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      if (error instanceof DraftRequestError && error.body.problems && view) {
        setView({ ...view, draft: { ...view.draft, problems: error.body.problems } });
      }
      setActionError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const onAccept = () =>
    runAction('accept', async () => {
      if (!(await save())) return;
      const { gameId } = await acceptDraft(draftId, revision.current);
      navigate(`/games/${gameId}`);
    });

  const onShare = (shared: boolean) =>
    runAction('share', async () => {
      if (!(await save())) return;
      const next = await shareDraft(draftId, shared);
      revision.current = next.draft.revision;
      setView(next);
    });

  const onDelete = () =>
    runAction('delete', async () => {
      stopped.current = true;
      await deleteDraft(draftId);
      changeCount.current = savedCount.current;
      navigate('/games/drafts');
    });

  const onDuplicate = (gameId: string) =>
    runAction('duplicate', async () => {
      const { draft } = await createDraft({ fromGameId: gameId });
      navigate(`/games/drafts/${draft.id}`);
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackToDrafts />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{content.title.trim() || 'Untitled draft'}</h1>
          {draft.status === 'accepted' && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">accepted</span>
          )}
          {draft.shared && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">shared</span>}
          {!mine && <span className="text-xs text-muted-foreground">Shared by another referee</span>}
          <SaveIndicator state={saveState} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Not sure what to ask for?{' '}
          <a className="underline" href={ASKING_FOR_GAMES_URL} target="_blank" rel="noreferrer">
            Asking for games
          </a>
          .
        </p>
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
                // Keep my edits: save them over the newer revision.
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

      {draft.status === 'accepted' && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span>This draft became a game and can no longer change.</span>
          {draft.resultGameId && (
            <>
              <Link className="inline-flex items-center gap-1 font-medium underline" to={`/games/${draft.resultGameId}`}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open the game
              </Link>
              <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={() => void onDuplicate(draft.resultGameId!)}>
                <Copy aria-hidden /> Duplicate into a new draft
              </Button>
            </>
          )}
        </div>
      )}

      <GameDraftEditor
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
        language={language}
        onLanguageChange={(next) => {
          setLanguage(next);
          sourceReady.current = true;
          changed();
        }}
        settings={settings}
        onSettingsChange={(next) => {
          setSettings(next);
          changed();
        }}
        problems={problems}
        readOnly={readOnly}
        generation={{
          pending: generation.pending,
          partialCount: generation.partialCount,
          error: generation.error,
          onGenerate: startGeneration,
          onCancel: generation.cancel,
        }}
      />

      {actionError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p>
      )}

      {draft.status === 'draft' && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {mine ? (
            <>
              <Button onClick={() => void onAccept()} disabled={!canAccept || busyAction !== null}>
                {busyAction === 'accept' ? <Loader2 className="animate-spin" aria-hidden /> : <Gamepad2 aria-hidden />}
                Create game
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
              {!canAccept && saved && problems.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Fix {problems.length} problem{problems.length === 1 ? '' : 's'} to create the game.
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              Only the referee who shared this draft can create its game. Your edits save to their draft.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function BackToDrafts() {
  const navigate = useNavigate();
  return (
    <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate('/games/drafts')}>
      <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Drafts
    </Button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text: Record<SaveState, string> = {
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Not saved',
    conflict: 'Changed elsewhere',
  };
  return (
    <span
      className={cn(
        'ml-auto inline-flex items-center gap-1 text-xs',
        state === 'saved' ? 'text-muted-foreground' : state === 'error' || state === 'conflict' ? 'text-destructive' : 'text-amber-700',
      )}
    >
      {state === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : state === 'saved' ? <Check className="h-3 w-3" aria-hidden /> : null}
      {text[state]}
    </span>
  );
}
