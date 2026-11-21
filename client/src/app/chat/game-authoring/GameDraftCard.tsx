import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleCheck, ExternalLink, Gamepad2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '../../shared/button';
import { cn } from '../../shared/utils';
import {
  acceptDraft,
  deleteDraft,
  DraftRequestError,
  getDraft,
  useDraftChanged,
  type DraftView,
} from '../../game-authoring/drafts-api';
import { SLOT_LABELS } from '../../game-authoring/game-limits';

const SHOWN = 5;

/**
 * A game draft in the chat (docs/hashbrown/creating-games-with-hashbrown.md →
 * Hashbrown pieces): the questions with their answers, the problems, and
 * Create game / Discard / Open in Draft Game. Editing happens on the Draft
 * Game page or by asking the chat. Only a person creates the game (G1).
 */
export function GameDraftCard({ draftId }: { draftId: string }) {
  const navigate = useNavigate();
  const [view, setView] = useState<DraftView | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'discard' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    getDraft(draftId)
      .then((loaded) => {
        setView(loaded);
        setGone(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DraftRequestError && err.status === 404) setGone(true);
        else setError(err instanceof Error ? err.message : 'Could not load the draft.');
      });
  }, [draftId]);

  useEffect(load, [load]);
  useDraftChanged(draftId, load);

  if (gone) {
    return <p className="text-xs italic text-muted-foreground">This draft was discarded.</p>;
  }
  if (!view) {
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading draft…
      </p>
    );
  }

  const { draft } = view;
  const questions = draft.payload?.questions ?? [];
  const shown = showAll ? questions : questions.slice(0, SHOWN);
  const canAccept = draft.mine && draft.status === 'draft' && draft.problems.length === 0;

  const onAccept = async () => {
    setBusy('accept');
    setError(null);
    try {
      const { gameId } = await acceptDraft(draftId, draft.revision);
      navigate(`/games/${gameId}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the game.');
      load();
    } finally {
      setBusy(null);
    }
  };

  const onDiscard = async () => {
    setBusy('discard');
    setError(null);
    try {
      await deleteDraft(draftId);
      setGone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not discard the draft.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{draft.title || 'Untitled draft'}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            draft.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground',
          )}
        >
          {draft.status === 'accepted' ? 'game created' : 'draft'}
        </span>
        <span className="text-xs text-muted-foreground">
          {questions.length} question{questions.length === 1 ? '' : 's'}
        </span>
      </div>

      <ol className="flex flex-col gap-1 text-sm">
        {shown.map((question, i) => {
          const correct = question.options.findIndex((option) => option.isCorrect);
          return (
            <li key={i} className="flex flex-col">
              <span>
                <span className="text-xs font-semibold text-muted-foreground">{i + 1}.</span> {question.text}
              </span>
              <span className="flex items-center gap-1 pl-4 text-xs text-muted-foreground">
                <CircleCheck className="h-3 w-3 text-green-600" aria-hidden />
                {correct >= 0 ? `${SLOT_LABELS[correct] ?? '?'}: ${question.options[correct].text}` : 'no correct option'}
                <span className="opacity-70">· {question.options.length} options{question.focus ? ` · ${question.focus}` : ''}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {questions.length > SHOWN && (
        <button type="button" className="w-fit text-xs underline" onClick={() => setShowAll((all) => !all)}>
          {showAll ? 'Show fewer' : `Show all ${questions.length}`}
        </button>
      )}

      {draft.status === 'draft' && draft.problems.length > 0 && (
        <ul className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {draft.problems.slice(0, 4).map((problem, i) => (
            <li key={i}>{problem.message}</li>
          ))}
          {draft.problems.length > 4 && <li>…and {draft.problems.length - 4} more</li>}
        </ul>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {draft.status === 'accepted' && draft.resultGameId ? (
          <Link className="inline-flex items-center gap-1 text-xs font-medium underline" to={`/games/${draft.resultGameId}`}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open the game
          </Link>
        ) : (
          <>
            {draft.mine && (
              <Button size="sm" disabled={!canAccept || busy !== null} onClick={() => void onAccept()}>
                {busy === 'accept' ? <Loader2 className="animate-spin" aria-hidden /> : <Gamepad2 aria-hidden />}
                Create game
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => navigate(`/games/drafts/${draftId}`)}>
              <ExternalLink aria-hidden /> Open in Draft Game
            </Button>
            {draft.mine &&
              (confirmDiscard ? (
                <span className="flex items-center gap-1 text-xs">
                  Discard?
                  <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void onDiscard()}>
                    Discard
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(true)}>
                  <Trash2 aria-hidden /> Discard
                </Button>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Opens a page once when the chat renders it, like `AddSceneDialogTrigger`. */
function useOpenOnce(path: string) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(path);
    // Once per message: re-renders of the chat must not navigate again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function OpenGameTrigger({ gameId }: { gameId: string }) {
  useOpenOnce(`/games/${gameId}`);
  return (
    <Link className="text-xs underline" to={`/games/${gameId}`}>
      Opened the game
    </Link>
  );
}

export function OpenDraftTrigger({ draftId }: { draftId: string }) {
  useOpenOnce(`/games/drafts/${draftId}`);
  return (
    <Link className="text-xs underline" to={`/games/drafts/${draftId}`}>
      Opened the draft
    </Link>
  );
}
