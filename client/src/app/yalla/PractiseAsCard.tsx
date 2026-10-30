import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authFetch } from '../auth/authFetch';
import { Button } from '../shared/button';
import { Card, CardContent, CardHeader, CardTitle } from '../shared/card';
import { Input } from '../shared/input';
import { Label } from '../shared/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shared/select';
import type { Player } from '../views/leitner';
import { useMeStore, type SetPlayerRequest } from './me.store';

/**
 * "Practise as" (docs/yalla/implementation-plan.md §4, security.md D14):
 * links the signed-in user to a player, whose LRS identity then records
 * their YALLA practice. Pick the player you play badge games as, so both
 * share one set of Leitner levels.
 */
export function PractiseAsCard() {
  const { me, loading, error, load, setPlayer } = useMeStore();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/players')
      .then(async (res) => (res.ok ? ((await res.json()) as { players: Player[] }).players : []))
      .then((list) => {
        if (!cancelled) setPlayers(list ?? []);
      })
      .catch(() => {
        if (!cancelled) setPlayers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [me?.player?.id]);

  async function save(request: SetPlayerRequest): Promise<void> {
    setSaving(true);
    setSaveError(null);
    const message = await setPlayer(request);
    setSaving(false);
    if (message) {
      setSaveError(message);
      return;
    }
    setSelected('');
    setNewName('');
  }

  const linked = me?.player ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Practise as</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p className="text-muted-foreground">
          YALLA records your practice under a player. Choose the player you play badge games as, so both share
          the same Leitner levels.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading…
          </div>
        )}
        {error && <p className="text-destructive">Could not load your profile. {error}</p>}

        {me && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            data-testid="practise-as-current"
          >
            {linked ? (
              <span>
                Practising as <strong>{linked.firstName}</strong>{' '}
                <span className="text-muted-foreground">({linked.label})</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Not linked to a player yet.</span>
            )}
            {linked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void save({ playerId: null })}
              >
                Unlink
              </Button>
            )}
          </div>
        )}

        {me && (
          <div className="grid gap-2">
            <Label htmlFor="practise-as-player">{linked ? 'Switch to another player' : 'Link to a player'}</Label>
            <div className="flex flex-wrap gap-2">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger id="practise-as-player" className="w-64" aria-label="Player">
                  <SelectValue placeholder={players.length ? 'Pick a player' : 'No players yet'} />
                </SelectTrigger>
                <SelectContent>
                  {players
                    .filter((player) => player.id !== linked?.id)
                    .map((player) => (
                      <SelectItem key={player.id} value={player.id}>
                        {player.firstName} ({player.label})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                disabled={!selected || saving}
                onClick={() => void save({ playerId: selected })}
              >
                Link
              </Button>
            </div>
          </div>
        )}

        {me && (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (newName.trim()) void save({ create: { firstName: newName.trim() } });
            }}
          >
            <Label htmlFor="practise-as-new">Or create a new player</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="practise-as-new"
                className="w-64"
                placeholder="First name or nickname"
                maxLength={40}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Button type="submit" size="sm" variant="outline" disabled={!newName.trim() || saving}>
                Create and link
              </Button>
            </div>
          </form>
        )}

        {saveError && (
          <p role="alert" className="text-destructive">
            {saveError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
