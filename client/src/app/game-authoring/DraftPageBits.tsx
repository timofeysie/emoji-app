import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '../shared/button';
import { cn } from '../shared/utils';

/** Shared by the game and chapter draft pages. */
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export function BackToDrafts() {
  const navigate = useNavigate();
  return (
    <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate('/games/drafts')}>
      <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Drafts
    </Button>
  );
}

export function SaveIndicator({ state }: { state: SaveState }) {
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
