import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePlus, Loader2 } from 'lucide-react';
import { Button } from '../shared/button';
import { createChapterDraft, emptyChapterContent } from './library-api';

/**
 * **Create chapter** on one of the user's books (docs/hashbrown/creating-games-with-hashbrown-improvements.md,
 * I1a): an empty chapter draft with this book chosen, opened on the Draft Game
 * page. Published, it becomes the book's next chapter. Only for the owner (C1).
 */
export function CreateChapterButton({ book, language, label = 'Create chapter' }: { book: string; language: string; label?: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      // The book's language, so the chapter can be published into it (C5).
      const payload = { ...emptyChapterContent(), bookSlug: book, language: { target: language, native: 'en' } };
      const { draft } = await createChapterDraft({ payload });
      navigate(`/games/drafts/${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the chapter draft.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} title="Start a draft of a new chapter for this book" onClick={() => void onClick()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FilePlus aria-hidden />}
        {label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
