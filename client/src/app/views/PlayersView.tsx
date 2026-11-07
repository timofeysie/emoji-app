import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Loader2, Users } from 'lucide-react';
import type { Player } from './leitner';

/**
 * Every referee-made player: the same list as "Pick a student" in New
 * Leitner Game. Each opens its activity page.
 */
export function PlayersView() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/players', { credentials: 'same-origin' });
        if (!res.ok) {
          if (!cancelled) setFetchError(`Server returned ${res.status}`);
          return;
        }
        const data = (await res.json()) as { players: Player[] };
        if (!cancelled) setPlayers(data.players ?? []);
      } catch {
        if (!cancelled) setFetchError('Could not reach server.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between py-2">
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading…' : `${players.length} player${players.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading players…
        </div>
      )}

      {!loading && fetchError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {fetchError}
        </div>
      )}

      {!loading && !fetchError && players.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-8 w-8 opacity-40" aria-hidden />
          No players yet. Add one from a game&apos;s player bindings.
        </div>
      )}

      {!loading && players.length > 0 && (
        <div className="flex flex-col gap-2">
          {players.map((player) => (
            <Link
              key={player.id}
              to={`/players/${player.id}`}
              className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <span className="truncate font-semibold">{player.firstName}</span>
                <div className="mt-0.5 text-xs text-muted-foreground">{player.label}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
