import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Copy, Loader2, Pencil } from 'lucide-react';
import { Button } from '../shared/button';
import { chapterPath, type StudyChapter } from '../yalla/yalla-api';
import { CreateChapterButton } from './CreateChapterButton';
import { createChapterDraft, setChapterArchived } from './library-api';

/**
 * A YALLA chapter's library actions (docs/hashbrown/creating-games-with-hashbrown.md
 * → Open content and remixing): **Remix** into a book of your own, and for
 * the owner **Edit** (G8), **Archive** and **New chapter** in the same book. Remixes credit the source by
 * title only (G12).
 */
export function ChapterLibraryActions({ chapter, onArchived }: { chapter: StudyChapter; onArchived: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'remix' | 'edit' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = { book: chapter.book, chapter: chapter.chapter };
  const mine = chapter.owner === 'mine';

  const run = async (action: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const openDraft = async (body: Parameters<typeof createChapterDraft>[0]) => {
    const { draft } = await createChapterDraft(body);
    navigate(`/games/drafts/${draft.id}`);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {chapter.archived && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="chapter-archived">
          Archived: hidden from the book’s chapter list, but still readable here, because learning records point at it.
        </p>
      )}
      {chapter.remixedFrom && (
        <p className="text-xs text-muted-foreground">
          Remixed from{' '}
          <Link className="underline" to={chapterPath(chapter.remixedFrom.book, chapter.remixedFrom.chapter)}>
            {chapter.remixedFrom.chapterTitle} ({chapter.remixedFrom.bookTitle})
          </Link>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          title="Copy this chapter into a draft for a book of your own"
          onClick={() => void run('remix', () => openDraft({ fromChapter: ref }))}
        >
          {busy === 'remix' ? <Loader2 className="animate-spin" aria-hidden /> : <Copy aria-hidden />} Remix
        </Button>
        {mine && (
          <>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('edit', () => openDraft({ editChapter: ref }))}>
              {busy === 'edit' ? <Loader2 className="animate-spin" aria-hidden /> : <Pencil aria-hidden />} Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                void run('archive', async () => {
                  await setChapterArchived(chapter.book, chapter.chapter, !chapter.archived);
                  onArchived();
                })
              }
            >
              {chapter.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {chapter.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <CreateChapterButton book={chapter.book} language={chapter.language} label="New chapter" />
          </>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
