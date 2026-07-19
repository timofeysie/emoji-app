import { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Loader2, Plus } from 'lucide-react';
import { Button } from '../../shared/button';
import { Input } from '../../shared/input';
import { cn } from '../../shared/utils';

type GameState = 'draft' | 'lobby' | 'active' | 'paused' | 'completed' | 'cancelled';

type BoundPair = {
  pairName: string;
  joined: boolean;
  controllerId?: string;
};

type GameDetail = {
  id: string;
  title: string;
  state: GameState;
  boundPairs: BoundPair[];
};

type LifecycleButton = {
  label: string;
  targetState: GameState;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
};

const LIFECYCLE_BUTTONS: Record<GameState, LifecycleButton[]> = {
  draft: [{ label: 'Open for Joining', targetState: 'lobby' }],
  lobby: [
    { label: 'Start Game', targetState: 'active' },
    { label: 'Cancel', targetState: 'cancelled', variant: 'outline' },
  ],
  active: [
    { label: 'End Game', targetState: 'completed' },
    { label: 'Pause', targetState: 'paused', variant: 'outline' },
  ],
  paused: [
    { label: 'Resume', targetState: 'active' },
    { label: 'Cancel', targetState: 'cancelled', variant: 'outline' },
  ],
  completed: [{ label: 'Play Again', targetState: 'draft' }],
  cancelled: [{ label: 'Restart',    targetState: 'draft' }],
};

export function GameRefereePanel({
  game,
  onRefresh,
}: {
  game: GameDetail;
  onRefresh: () => void;
}) {
  const [pairName, setPairName] = useState('');
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  // Known pair names from /api/badges (for one-click bind suggestions)
  const [knownPairs, setKnownPairs] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/badges', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          badges: Array<{ status?: { pairName?: string } | null }>;
        };
        const names = new Set<string>();
        for (const b of data.badges) {
          const name = b.status?.pairName;
          if (name) names.add(name);
        }
        setKnownPairs([...names].sort());
      } catch {
        // suggestions are optional
      }
    })();
  }, []);

  // NFC card group assignment
  type CardGroupInfo = { groupId: string; name: string; cardCount: number } | null;
  const [cardGroup, setCardGroup] = useState<CardGroupInfo>(undefined as unknown as CardGroupInfo);
  const [cardGroupLoading, setCardGroupLoading] = useState(true);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const loadCardGroup = async () => {
    try {
      const res = await fetch(`/api/games/${game.id}/nfc-card-group`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = (await res.json()) as { group: CardGroupInfo };
      setCardGroup(data.group);
    } catch {
      // non-critical
    } finally {
      setCardGroupLoading(false);
    }
  };

  useEffect(() => { void loadCardGroup(); }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignDemoGroup = async () => {
    setAssignLoading(true);
    setAssignError(null);
    try {
      const createRes = await fetch('/api/games/nfc-card-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Demo Set',
          cards: [
            { cardUid: '5B:6F:B8:08', slotLabel: 'A', displayName: 'R12 - Monkey' },
            { cardUid: 'DB:93:B7:08', slotLabel: 'B', displayName: 'W3 - Clown' },
          ],
        }),
        credentials: 'same-origin',
      });
      if (!createRes.ok) {
        const body = (await createRes.json()) as { error?: string };
        setAssignError(body.error ?? `Server error ${createRes.status}`);
        return;
      }
      const { groupId } = (await createRes.json()) as { groupId: string };

      const attachRes = await fetch(`/api/games/${game.id}/nfc-card-groups/${groupId}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'same-origin',
      });
      if (!attachRes.ok) {
        const body = (await attachRes.json()) as { error?: string };
        setAssignError(body.error ?? `Server error ${attachRes.status}`);
        return;
      }
      await loadCardGroup();
    } catch {
      setAssignError('Network error — could not assign card group.');
    } finally {
      setAssignLoading(false);
    }
  };

  const bindPair = async (name?: string) => {
    const target = (name ?? pairName).trim();
    if (!target) return;
    setBindLoading(true);
    setBindError(null);
    try {
      const res = await fetch(`/api/games/${game.id}/pairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairName: target }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; message?: string };
        setBindError(body.error ?? body.message ?? `Server error ${res.status}`);
        return;
      }
      setPairName('');
      onRefresh();
    } catch {
      setBindError('Network error — could not bind pair.');
    } finally {
      setBindLoading(false);
    }
  };

  const transitionState = async (targetState: GameState) => {
    setLifecycleLoading(targetState);
    setLifecycleError(null);
    try {
      const res = await fetch(`/api/games/${game.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: targetState }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setLifecycleError(body.error ?? `Failed to transition to ${targetState}.`);
        return;
      }
      onRefresh();
    } catch {
      setLifecycleError('Network error — could not update game state.');
    } finally {
      setLifecycleLoading(null);
    }
  };

  const lifecycleButtons = LIFECYCLE_BUTTONS[game.state] ?? [];

  return (
    <div className="flex flex-col gap-5 rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Referee Controls
      </p>

      {/* Bound pairs */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-foreground">Bound pairs</p>
        {game.boundPairs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">None bound yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {game.boundPairs.map((bp) => (
              <div key={bp.pairName} className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs',
                    bp.joined
                      ? 'border-green-400/60 bg-green-50 text-green-800'
                      : 'border-border bg-muted/50 text-muted-foreground',
                  )}
                >
                  {bp.pairName}
                  {bp.joined ? (
                    <CheckCircle2 className="h-3 w-3" aria-label="Joined" />
                  ) : (
                    <span className="text-[10px]">· not joined</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Known-pair quick-bind chips */}
        {knownPairs.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {knownPairs
              .filter((n) => !game.boundPairs.some((bp) => bp.pairName === n))
              .map((n) => (
                <button
                  key={n}
                  type="button"
                  className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                  disabled={bindLoading}
                  onClick={() => void bindPair(n)}
                  title={`Bind "${n}"`}
                >
                  <Plus className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                  {n}
                </button>
              ))}
          </div>
        )}

        {/* Manual bind input */}
        <div className="flex items-center gap-1.5 pt-1">
          <Input
            placeholder="pair name (e.g. green)"
            value={pairName}
            onChange={(e) => setPairName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void bindPair();
            }}
            className="h-8 text-sm"
            disabled={bindLoading}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void bindPair()}
            disabled={bindLoading || !pairName.trim()}
            className="h-8 shrink-0"
          >
            {bindLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            )}
            Bind
          </Button>
        </div>
        {bindError && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {bindError}
          </p>
        )}
      </div>

      {/* NFC card group */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-foreground">NFC card group</p>
        {cardGroupLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : cardGroup ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-medium text-foreground">{cardGroup.name}</span>
              {' '}({cardGroup.cardCount} card{cardGroup.cardCount !== 1 ? 's' : ''})
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground italic">No group assigned.</p>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void assignDemoGroup()}
          disabled={assignLoading}
          className="h-8 w-fit text-xs"
        >
          {assignLoading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <CreditCard className="mr-1 h-3 w-3" aria-hidden />
          )}
          {cardGroup ? 'Reassign demo group' : 'Assign demo group'}
        </Button>
        {assignError && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {assignError}
          </p>
        )}
      </div>

      {/* Game state */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-foreground">Game state</p>
        <p className="flex items-center gap-1.5 text-sm">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              game.state === 'active' && 'bg-green-500',
              game.state === 'lobby' && 'bg-amber-400',
              game.state === 'paused' && 'bg-blue-400',
              game.state === 'draft' && 'bg-muted-foreground/40',
              (game.state === 'completed' || game.state === 'cancelled') && 'bg-slate-400',
            )}
            aria-hidden
          />
          <span className="capitalize font-medium">{game.state}</span>
        </p>

        {lifecycleButtons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {lifecycleButtons.map((btn) => (
              <Button
                key={btn.targetState}
                size="sm"
                variant={btn.variant ?? 'default'}
                onClick={() => void transitionState(btn.targetState)}
                disabled={lifecycleLoading !== null}
                className="h-8 text-xs"
              >
                {lifecycleLoading === btn.targetState && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                )}
                {btn.label}
              </Button>
            ))}
          </div>
        )}

        {lifecycleError && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {lifecycleError}
          </p>
        )}
      </div>
    </div>
  );
}
