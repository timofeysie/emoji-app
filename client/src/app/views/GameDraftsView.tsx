import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookPlus, ChevronLeft, FileText, Loader2, Plus } from 'lucide-react';
import { Button } from '../shared/button';
import { cn } from '../shared/utils';
import { ASKING_FOR_GAMES_URL, createDraft, listDrafts, type DraftSummary } from '../game-authoring/drafts-api';
import { createChapterDraft } from '../library/library-api';

type Tab = 'mine' | 'shared';

/**
 * `/games/drafts`: the user's game drafts, and the ones other referees
 * shared (docs/hashbrown/creating-games-with-hashbrown.md → Draft Game page).
 */
export function GameDraftsView() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('mine');
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<'game' | 'chapter' | null>(null);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    setError(null);
    try {
      const { drafts: rows } = await listDrafts(which === 'shared');
      setDrafts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  const onNewDraft = async (type: 'game' | 'chapter') => {
    setCreating(type);
    setError(null);
    try {
      const { draft } = type === 'chapter' ? await createChapterDraft({}) : await createDraft({});
      navigate(`/games/drafts/${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the draft.');
      setCreating(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate('/games')}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Games
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Draft games</h1>
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void onNewDraft('chapter')} disabled={creating !== null}>
              {creating === 'chapter' ? <Loader2 className="animate-spin" aria-hidden /> : <BookPlus aria-hidden />}
              New chapter draft
            </Button>
            <Button onClick={() => void onNewDraft('game')} disabled={creating !== null}>
              {creating === 'game' ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              New draft
            </Button>
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Paste a passage and the AI drafts the questions, or a library chapter for YALLA. Nothing is playable until you
          click Create game, and a chapter appears in YALLA only when you publish it.{' '}
          <a className="underline" href={ASKING_FOR_GAMES_URL} target="_blank" rel="noreferrer">
            Asking for games
          </a>
        </p>
      </div>

      <div className="flex gap-1 border-b" role="tablist">
        {(['mine', 'shared'] as const).map((which) => (
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
            {which === 'mine' ? 'My drafts' : 'Shared drafts'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading drafts…
        </div>
      )}
      {!loading && error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}
      {!loading && !error && drafts.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" aria-hidden />
          {tab === 'mine' ? (
            <>
              No drafts yet. Click <strong>New draft</strong> to start one.
            </>
          ) : (
            'No one has shared a draft yet.'
          )}
        </div>
      )}
      {!loading && drafts.length > 0 && (
        <div className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <button
              key={draft.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left hover:bg-accent"
              onClick={() => navigate(`/games/drafts/${draft.id}`)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{draft.title || 'Untitled draft'}</span>
                  {draft.type === 'chapter' && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
                      {draft.editsChapter ? 'chapter edit' : 'chapter'}
                    </span>
                  )}
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      draft.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {draft.status === 'accepted' ? (draft.type === 'chapter' ? 'published' : 'accepted') : 'draft'}
                  </span>
                  {draft.shared && tab === 'mine' && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">shared</span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {draft.type === 'chapter'
                    ? `${draft.vocabularyCount} word${draft.vocabularyCount === 1 ? '' : 's'}`
                    : `${draft.questionCount} question${draft.questionCount === 1 ? '' : 's'}`}
                  {draft.status === 'draft' && draft.problemCount > 0 && ` · ${draft.problemCount} to fix`}
                  {' · edited '}
                  {new Date(draft.updatedAt).toLocaleString()}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
