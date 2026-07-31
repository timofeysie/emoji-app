import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  CreditCard,
  HelpCircle,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Button } from '../../shared/button';
import { Input } from '../../shared/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/select';
import { cn } from '../../shared/utils';
import {
  gameLogRef,
  logFromServerGameState,
  logGameState,
} from '../../shared/game-state-log';

const chipSpring = { type: 'spring' as const, stiffness: 420, damping: 28 };

type GameState =
  | 'draft'
  | 'ready'
  | 'lobby'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

type BoundPair = {
  pairName: string;
  joined: boolean;
  readyForNextQuestion: boolean | null;
  controllerId?: string;
};

type GameDetail = {
  id: string;
  title: string;
  state: GameState;
  boundPairs: BoundPair[];
  questions: Array<{ state: string }>;
};

type LifecycleButton = {
  label: string;
  targetState: GameState;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
};

const LIFECYCLE_BUTTONS: Record<GameState, LifecycleButton[]> = {
  // draft → ready happens automatically when GameDetailView opens
  draft: [],
  ready: [{ label: 'Open for Joining', targetState: 'lobby' }],
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
  completed: [{ label: 'Play Again', targetState: 'ready' }],
  cancelled: [{ label: 'Restart',    targetState: 'ready' }],
};

export function GameRefereePanel({
  game,
  onRefresh,
}: {
  game: GameDetail;
  onRefresh: () => void;
}) {
  const [pairName, setPairName] = useState('');
  const [selectedInvite, setSelectedInvite] = useState<string>('');
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  // Live pairs from GET /api/badges (Zeros that have posted status with pairName).
  const [knownPairs, setKnownPairs] = useState<string[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(true);

  const loadKnownPairs = useCallback(async () => {
    setBadgesLoading(true);
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
    } finally {
      setBadgesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKnownPairs();
    const id = window.setInterval(() => void loadKnownPairs(), 10_000);
    return () => window.clearInterval(id);
  }, [loadKnownPairs]);

  const unboundPairs = useMemo(
    () => knownPairs.filter((n) => !game.boundPairs.some((bp) => bp.pairName === n)),
    [knownPairs, game.boundPairs],
  );

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
      // Single idempotent call: ensures hardcoded Demo Set seed, then attaches.
      const res = await fetch(`/api/games/${game.id}/nfc-card-groups/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; message?: string };
        setAssignError(body.error ?? body.message ?? `Server error ${res.status}`);
        return;
      }
      const data = (await res.json()) as { group: CardGroupInfo };
      if (data.group) {
        setCardGroup(data.group);
      } else {
        await loadCardGroup();
      }
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
      setSelectedInvite('');
      onRefresh();
      void loadKnownPairs();
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
      const gameRef = gameLogRef({ id: game.id, title: game.title });
      if (targetState === 'lobby') {
        logGameState('lobby', `referee Open for Joining ${gameRef} icon=door-open`);
      } else if (targetState === 'active') {
        logGameState('active', `referee Start Game ${gameRef} icon=turntable`);
      } else if (targetState === 'completed') {
        logGameState('game_ended', `referee End Game ${gameRef} icon=sparkles`);
      } else {
        logFromServerGameState(targetState, `referee → ${targetState} ${gameRef}`);
      }
      onRefresh();
    } catch {
      setLifecycleError('Network error — could not update game state.');
    } finally {
      setLifecycleLoading(null);
    }
  };

  const lifecycleButtons = LIFECYCLE_BUTTONS[game.state] ?? [];
  const isBetweenRounds =
    game.state === 'active' &&
    !game.questions.some((question) => question.state === 'open');

  return (
    <div className="flex flex-col gap-5 rounded-lg border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Referee Controls
      </p>

      {/* Bound pairs + invite */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground">Bound pairs</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground"
            onClick={() => void loadKnownPairs()}
            disabled={badgesLoading}
            title="Refresh available pairs from Badges"
          >
            <RefreshCw
              className={cn('mr-1 h-3 w-3', badgesLoading && 'animate-spin')}
              aria-hidden
            />
            Refresh
          </Button>
        </div>

        {game.boundPairs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">None bound yet.</p>
        ) : (
          <div className="relative flex flex-col gap-1">
            <AnimatePresence mode="popLayout" initial={false}>
              {game.boundPairs.map((bp) => (
                <motion.div
                  key={bp.pairName}
                  layout
                  initial={{ opacity: 0, scale: 0.85, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -4 }}
                  transition={chipSpring}
                  className="flex items-center gap-2"
                >
                  <motion.span
                    layout
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs',
                      isBetweenRounds && bp.readyForNextQuestion === true
                        ? 'border-green-400/60 bg-green-50 text-green-800'
                        : isBetweenRounds && bp.readyForNextQuestion === false
                          ? 'border-red-400/60 bg-red-50 text-red-800'
                          : isBetweenRounds
                            ? 'border-amber-400/60 bg-amber-50 text-amber-800'
                            : bp.joined
                              ? 'border-green-400/60 bg-green-50 text-green-800'
                              : 'border-border bg-muted/50 text-muted-foreground',
                    )}
                  >
                    {bp.pairName}
                    <AnimatePresence mode="wait" initial={false}>
                      {isBetweenRounds ? (
                        <motion.span
                          key={`readiness-${String(bp.readyForNextQuestion)}`}
                          className="inline-flex items-center gap-1"
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          transition={chipSpring}
                        >
                          {bp.readyForNextQuestion === true ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" aria-label="Ready" />
                              <span className="text-[10px]">· ready</span>
                            </>
                          ) : bp.readyForNextQuestion === false ? (
                            <>
                              <XCircle className="h-3 w-3" aria-label="Needs more time" />
                              <span className="text-[10px]">· wait</span>
                            </>
                          ) : (
                            <>
                              <HelpCircle
                                className="h-3 w-3"
                                aria-label="Waiting for response"
                              />
                              <span className="text-[10px]">· awaiting response</span>
                            </>
                          )}
                        </motion.span>
                      ) : bp.joined ? (
                        <motion.span
                          key="joined"
                          className="inline-flex items-center gap-1"
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          transition={chipSpring}
                        >
                          <CheckCircle2 className="h-3 w-3" aria-label="Ready to start" />
                          <span className="text-[10px]">· ready to start</span>
                        </motion.span>
                      ) : (
                        <motion.span
                          key="waiting"
                          className="text-[10px]"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          · waiting to join
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        <p className="pt-1 text-xs font-medium text-foreground">Invite a pair</p>
        {badgesLoading && knownPairs.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Looking for live badges…
          </p>
        ) : unboundPairs.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <Select
              value={selectedInvite || undefined}
              onValueChange={setSelectedInvite}
              disabled={bindLoading}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a live pair…" />
              </SelectTrigger>
              <SelectContent>
                {unboundPairs.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void bindPair(selectedInvite)}
              disabled={bindLoading || !selectedInvite}
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
        ) : (
          <p className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
            No live pairs to invite.
          </p>
        )}

        {/* Manual bind fallback */}
        <div className="flex items-center gap-1.5 pt-0.5">
          <Input
            placeholder="Or type pair name (e.g. green)"
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
              (game.state === 'draft' || game.state === 'ready') && 'bg-muted-foreground/40',
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
