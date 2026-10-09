import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { Button } from '../../shared/button';
import { Input } from '../../shared/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/select';

/** Referee-made player record: no email, no surname (security.md D4). */
type Player = {
  id: string;
  firstName: string;
  externalId: string;
  /** Non-identifying label, the same one the LRS viewer shows. */
  label: string;
};

type PlayerBinding = {
  id: string;
  badgeName: string;
  player: Player;
  assignedAt: string;
  unassignedAt: string | null;
  reason: 'initial' | 'swap' | 'replacement';
};

type GamePlayerBindings = {
  badgeNames: string[];
  bindings: PlayerBinding[];
  missingBadges: string[];
};

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `Server error ${res.status}`;
  } catch {
    return `Server error ${res.status}`;
  }
}

/**
 * Referee assigns a player to each badge in the game (xAPI export Step 1a).
 * `reloadKey` changes whenever badges, guesses or the game state change.
 */
export function PlayerBindingsPanel({
  gameId,
  reloadKey,
}: {
  gameId: string;
  reloadKey: string;
}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [data, setData] = useState<GamePlayerBindings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyBadge, setBusyBadge] = useState<string | null>(null);
  const [newFirstName, setNewFirstName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [playersRes, bindingsRes] = await Promise.all([
        fetch('/api/players', { credentials: 'same-origin' }),
        fetch(`/api/games/${gameId}/player-bindings`, { credentials: 'same-origin' }),
      ]);
      if (playersRes.ok) {
        setPlayers(((await playersRes.json()) as { players: Player[] }).players);
      }
      if (bindingsRes.ok) {
        setData((await bindingsRes.json()) as GamePlayerBindings);
      }
    } catch {
      // non-critical; the panel shows what it has
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const activeByBadge = useMemo(
    () =>
      new Map(
        (data?.bindings ?? [])
          .filter((binding) => binding.unassignedAt === null)
          .map((binding) => [binding.badgeName, binding]),
      ),
    [data],
  );

  const bind = async (badgeName: string, playerId: string) => {
    setBusyBadge(badgeName);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/${gameId}/player-bindings/${encodeURIComponent(badgeName)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
          credentials: 'same-origin',
        },
      );
      if (!res.ok) {
        setError(await errorMessage(res));
        return;
      }
      await load();
    } catch {
      setError('Network error — could not assign player.');
    } finally {
      setBusyBadge(null);
    }
  };

  const unbind = async (badgeName: string) => {
    setBusyBadge(badgeName);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/${gameId}/player-bindings/${encodeURIComponent(badgeName)}`,
        { method: 'DELETE', credentials: 'same-origin' },
      );
      if (!res.ok && res.status !== 404) {
        setError(await errorMessage(res));
        return;
      }
      await load();
    } catch {
      setError('Network error — could not unassign player.');
    } finally {
      setBusyBadge(null);
    }
  };

  const createPlayer = async () => {
    const firstName = newFirstName.trim();
    if (!firstName) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(await errorMessage(res));
        return;
      }
      setNewFirstName('');
      await load();
    } catch {
      setError('Network error — could not add player.');
    } finally {
      setCreating(false);
    }
  };

  const badgeNames = data?.badgeNames ?? [];
  const missing = data?.missingBadges ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Players
      </p>

      {badgeNames.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          Bind a station to assign players to its badges.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {badgeNames.map((badgeName) => {
            const active = activeByBadge.get(badgeName);
            const busy = busyBadge === badgeName;
            return (
              <div key={badgeName} className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 truncate text-xs font-medium" title={badgeName}>
                  {badgeName}
                </span>
                <Select
                  value={active?.player.id}
                  onValueChange={(playerId) => void bind(badgeName, playerId)}
                  disabled={busy || players.length === 0}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Assign player…" />
                  </SelectTrigger>
                  <SelectContent>
                    {players.map((player) => (
                      <SelectItem key={player.id} value={player.id}>
                        {player.firstName}
                        <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">
                          {player.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void unbind(badgeName)}
                  disabled={busy || !active}
                  title={`Unassign the player from ${badgeName}`}
                  aria-label={`Unassign the player from ${badgeName}`}
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <X className="h-3 w-3" aria-hidden />
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {missing.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            Guesses without a player: <strong>{missing.join(', ')}</strong>. Assign a player
            before exporting.
          </span>
        </p>
      )}

      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void createPlayer();
        }}
      >
        <Input
          value={newFirstName}
          onChange={(event) => setNewFirstName(event.target.value)}
          placeholder="First name or nickname"
          maxLength={40}
          className="h-8 text-sm"
          disabled={creating}
          aria-label="New player's first name or nickname"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          disabled={creating || newFirstName.trim().length === 0}
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-3.5 w-3.5" aria-hidden />
          )}
          Add
        </Button>
      </form>
      <p className="text-[10px] text-muted-foreground">
        No surnames. With children, use a nickname or the badge name.
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
