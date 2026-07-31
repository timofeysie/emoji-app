import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Loader2, Pencil, Play, Plus } from 'lucide-react';
import { Button } from '../shared/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../shared/dialog';
import { Input } from '../shared/input';
import { Label } from '../shared/label';
import { cn } from '../shared/utils';

/** Placeholder creator ID used when no auth is wired. Must be a 24-char hex ObjectId. */
const DEMO_CREATOR_ID = '000000000000000000000001';

type GameState =
  | 'draft'
  | 'ready'
  | 'lobby'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

type GameSummary = {
  id: string;
  title: string;
  state: GameState;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  questionCount: number;
};

function canPlayGame(game: GameSummary): boolean {
  return (
    game.questionCount > 0 &&
    (game.state === 'lobby' ||
      game.state === 'active' ||
      game.state === 'paused')
  );
}

const STATE_STYLES: Record<GameState, string> = {
  draft: 'bg-muted text-muted-foreground',
  ready: 'bg-emerald-50 text-emerald-800',
  lobby: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-blue-100 text-blue-800',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
};

function StateChip({ state }: { state: GameState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        STATE_STYLES[state] ?? STATE_CHIPS_DEFAULT,
      )}
    >
      {state}
    </span>
  );
}

const STATE_CHIPS_DEFAULT = 'bg-muted text-muted-foreground';

function NewGameDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [creatorId, setCreatorId] = useState(DEMO_CREATOR_ID);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), createdByUserId: creatorId.trim() }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Failed to create game.');
        return;
      }
      setOpen(false);
      setTitle('');
      onCreated();
    } catch {
      setError('Network error — could not create game.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTitle('');
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          New Game
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Game</DialogTitle>
          <DialogDescription>Create a new quiz game.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="game-title">Title</Label>
            <Input
              id="game-title"
              placeholder="e.g. Quiz Night Round 1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="creator-id">Creator ID</Label>
            <Input
              id="creator-id"
              placeholder="24-char hex ObjectId"
              value={creatorId}
              onChange={(e) => setCreatorId(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Demo placeholder — change when auth is wired.
            </p>
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Create
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GamesView() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadGames = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/games', { credentials: 'same-origin' });
      if (!res.ok) {
        setFetchError(`Server returned ${res.status}`);
        return;
      }
      const data = (await res.json()) as { games: GameSummary[] };
      setGames(data.games ?? []);
    } catch {
      setFetchError('Could not reach server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading…' : `${games.length} game${games.length === 1 ? '' : 's'}`}
        </p>
        <NewGameDialog onCreated={() => void loadGames()} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading games…
        </div>
      )}

      {!loading && fetchError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {fetchError}
        </div>
      )}

      {!loading && !fetchError && games.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Gamepad2 className="mx-auto mb-2 h-8 w-8 opacity-40" aria-hidden />
          No games yet. Click <strong>New Game</strong> to create one.
        </div>
      )}

      {!loading && games.length > 0 && (
        <div className="flex flex-col gap-2">
          {games.map((game) => {
            const playable = canPlayGame(game);
            const playTitle = playable
              ? `Play ${game.title} in student mode`
              : game.questionCount === 0
                ? 'Add at least one round before playing'
                : 'Open the game for joining before playing';

            return (
              <div
                key={game.id}
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{game.title}</span>
                    <StateChip state={game.state} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {game.questionCount} question
                    {game.questionCount === 1 ? '' : 's'}
                    {' · '}
                    {new Date(game.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${game.title}`}
                    title={`Edit ${game.title}`}
                    onClick={() => navigate(`/games/${game.id}`)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={playTitle}
                    title={playTitle}
                    disabled={!playable}
                    onClick={() => navigate(`/games/${game.id}/play`)}
                  >
                    <Play aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
