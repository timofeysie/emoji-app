import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookPlus, Loader2 } from 'lucide-react';
import { Button } from '../shared/button';
import { createChapterDraft } from './library-api';

/**
 * **Save as library chapter** (G13): a chapter draft from the passage the
 * game was made from, so it never has to be pasted again. Only for games
 * made from a pasted passage.
 */
export function SaveAsChapterButton({ gameId }: { gameId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const { draft } = await createChapterDraft({ fromGameId: gameId });
      navigate(`/games/drafts/${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the chapter draft.');
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void onClick()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <BookPlus aria-hidden />}
        Save as library chapter
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
