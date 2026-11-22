import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { Button } from '../../shared/button';
import { cn } from '../../shared/utils';
import { deleteDraft, DraftRequestError, notifyDraftChanged, useDraftChanged } from '../../game-authoring/drafts-api';
import {
  getChapterDraft,
  publishChapterDraft,
  updateChapterDraft,
  yallaChapterPath,
  type ChapterDraftView,
  type ChapterWord,
  type PatternDecision,
} from '../../library/library-api';

const SHOWN = 8;

function SenseLabel({ word }: { word: ChapterWord }) {
  const { sense } = word;
  if (sense.decision === 'reuse') return <span className="text-muted-foreground">reuses {sense.reuseId}</span>;
  if (sense.decision === 'new') {
    return (
      <span className={sense.confirmed ? 'text-emerald-700' : 'text-amber-700'}>
        new sense {sense.newSense} ({sense.kind}){sense.confirmed ? ' ✓' : ''}
      </span>
    );
  }
  return <span className="text-destructive">no sense yet</span>;
}

function EntryLabel({ entry }: { entry: PatternDecision }) {
  if (entry.decision === 'reuse') return <span className="text-muted-foreground">reuses {entry.reuseId}</span>;
  return (
    <span className={entry.confirmed ? 'text-emerald-700' : 'text-amber-700'}>
      new pattern {entry.headword} ({entry.meaning}){entry.confirmed ? ' ✓' : ''}
    </span>
  );
}

/** `Confirm 3 new senses and 1 new pattern`. */
function confirmLabel(senses: number, patterns: number): string {
  const parts = [
    senses > 0 ? `${senses} new sense${senses === 1 ? '' : 's'}` : '',
    patterns > 0 ? `${patterns} new pattern${patterns === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `Confirm ${parts.join(' and ')}`;
}

/**
 * A library chapter draft in the chat (docs/hashbrown/creating-games-with-hashbrown.md →
 * Feature 2): the book, the words with their sense decisions, the patterns
 * with the grammar they teach, the problems, and Confirm new senses and
 * patterns / Publish / Open in Draft Game / Discard. Only a person confirms
 * them (G7, GP5) and publishes (G1).
 */
export function ChapterDraftCard({ draftId }: { draftId: string }) {
  const navigate = useNavigate();
  const [view, setView] = useState<ChapterDraftView | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'publish' | 'discard' | 'confirm' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    getChapterDraft(draftId)
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

  if (gone) return <p className="text-xs italic text-muted-foreground">This draft was discarded.</p>;
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
  const content = draft.payload;
  const words = content?.vocabulary ?? [];
  const shown = showAll ? words : words.slice(0, SHOWN);
  const patterns = content?.patterns ?? [];
  const unconfirmedSenses = words.filter((word) => word.sense.decision === 'new' && !word.sense.confirmed).length;
  const unconfirmedPatterns = patterns.flatMap((pattern) => pattern.entries).filter((entry) => entry.decision === 'new' && !entry.confirmed).length;
  const unconfirmed = unconfirmedSenses + unconfirmedPatterns;
  const bookName = draft.editsChapter
    ? `${draft.editsChapter.book}, chapter ${draft.editsChapter.chapter}`
    : content?.bookSlug
      ? (view.chapter?.books.find((book) => book.slug === content.bookSlug)?.title ?? content.bookSlug)
      : content?.newBook.title
        ? `${content.newBook.title} (new book)`
        : 'no book chosen yet';
  const canPublish = draft.mine && draft.status === 'draft' && draft.problems.length === 0;

  const run = async (action: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      load();
    } finally {
      setBusy(null);
    }
  };

  const onConfirmAll = () =>
    run('confirm', async () => {
      if (!content) return;
      const next = await updateChapterDraft(draftId, {
        revision: draft.revision,
        payload: {
          ...content,
          vocabulary: content.vocabulary.map((word) =>
            word.sense.decision === 'new' ? { ...word, sense: { ...word.sense, confirmed: true } } : word,
          ),
          patterns: content.patterns.map((pattern) => ({
            ...pattern,
            entries: pattern.entries.map((entry) => (entry.decision === 'new' ? { ...entry, confirmed: true } : entry)),
          })),
        },
      });
      setView(next);
      notifyDraftChanged(draftId);
    });

  const onPublish = () =>
    run('publish', async () => {
      const { chapter } = await publishChapterDraft(draftId, draft.revision);
      navigate(yallaChapterPath(chapter.book, chapter.chapter));
      load();
    });

  const onDiscard = () =>
    run('discard', async () => {
      await deleteDraft(draftId);
      setGone(true);
    });

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="font-semibold">{content?.titleNative || content?.titleTarget || 'Untitled chapter'}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            draft.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-violet-800',
          )}
        >
          {draft.status === 'accepted' ? 'published' : 'chapter draft'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {content?.titleTarget && <span lang={content.language?.target ?? 'ko'}>{content.titleTarget} · </span>}
        {bookName} · {content?.dialog.length ?? 0} lines · {words.length} words · {content?.patterns.length ?? 0} patterns
      </p>

      <ol className="flex flex-col gap-0.5 text-sm">
        {shown.map((word, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-semibold text-muted-foreground">{i + 1}.</span>
            <span lang={content?.language?.target ?? 'ko'}>{word.targetLanguageText}</span>
            <span className="text-xs text-muted-foreground">{word.nativeLanguageText}</span>
            <span className="text-[11px]">
              <SenseLabel word={word} />
            </span>
          </li>
        ))}
      </ol>
      {words.length > SHOWN && (
        <button type="button" className="w-fit text-xs underline" onClick={() => setShowAll((all) => !all)}>
          {showAll ? 'Show fewer' : `Show all ${words.length}`}
        </button>
      )}
      {patterns.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {patterns.map((pattern, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-semibold text-muted-foreground">P{i + 1}.</span>
              <span lang={content?.language?.target ?? 'ko'}>{pattern.patternTarget}</span>
              <span className="text-xs text-muted-foreground">{pattern.patternNative}</span>
              <span className="text-[11px]">
                {pattern.entries.length === 0 ? (
                  <span className="text-destructive">teaches nothing yet</span>
                ) : (
                  pattern.entries.map((entry, j) => (
                    <span key={j}>
                      {j > 0 && ' + '}
                      <EntryLabel entry={entry} />
                    </span>
                  ))
                )}
              </span>
            </li>
          ))}
        </ul>
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
        {draft.status === 'accepted' && draft.resultChapter ? (
          <Link
            className="inline-flex items-center gap-1 text-xs font-medium underline"
            to={yallaChapterPath(draft.resultChapter.book, draft.resultChapter.chapter)}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open in YALLA
          </Link>
        ) : (
          <>
            {draft.mine && unconfirmed > 0 && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void onConfirmAll()}>
                {busy === 'confirm' && <Loader2 className="animate-spin" aria-hidden />}
                {confirmLabel(unconfirmedSenses, unconfirmedPatterns)}
              </Button>
            )}
            {draft.mine && (
              <Button size="sm" disabled={!canPublish || busy !== null} onClick={() => void onPublish()}>
                {busy === 'publish' ? <Loader2 className="animate-spin" aria-hidden /> : <BookOpen aria-hidden />}
                Publish
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
      {draft.mine && unconfirmed > 0 && (
        <p className="text-[11px] text-muted-foreground">
          New senses and patterns become permanent learning objects once used. Check them here or in the Draft Game page first.
        </p>
      )}
    </div>
  );
}

export function OpenYallaChapterTrigger({ book, chapter }: { book: string; chapter: string }) {
  const navigate = useNavigate();
  const path = yallaChapterPath(book, chapter);
  useEffect(() => {
    navigate(path);
    // Once per message: re-renders of the chat must not navigate again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Link className="text-xs underline" to={path}>
      Opened the chapter
    </Link>
  );
}
