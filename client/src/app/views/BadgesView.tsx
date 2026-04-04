import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Bluetooth,
  BluetoothOff,
  BluetoothSearching,
  CircleHelp,
  Flame,
  Gamepad2,
  Heart,
  Laugh,
  Meh,
  Skull,
  Smile,
  Square,
  Star,
  ThumbsUp,
  Zap,
} from 'lucide-react';
import { cn } from '../shared/utils';

type BleStatus = 'connected' | 'disconnected';

type StatusChangedEvent = {
  controllerId: string;
  badgeId: string;
  bleStatus: BleStatus;
  timestamp: string;
};

type EmojiSentEvent = {
  controllerId: string;
  badgeId: string;
  menu: number;
  pos: number;
  neg: number;
  label: string;
  timestamp: string;
};

type WsEnvelope =
  | { type: 'status.changed'; payload: StatusChangedEvent }
  | { type: 'emoji.sent'; payload: EmojiSentEvent };

type BadgeRecord = {
  key: string;
  controllerId: string;
  badgeId: string;
  status?: StatusChangedEvent;
  emoji?: EmojiSentEvent;
};

/** Maps common label strings to a Lucide icon; unknown labels fall back to a neutral icon. */
const LABEL_ICON_MAP: Record<string, LucideIcon> = {
  regular: Smile,
  smile: Smile,
  happy: Laugh,
  laugh: Laugh,
  sad: Meh,
  meh: Meh,
  love: Heart,
  heart: Heart,
  fire: Flame,
  hot: Flame,
  zap: Zap,
  electric: Zap,
  alert: AlertTriangle,
  warning: AlertTriangle,
  danger: Skull,
  skull: Skull,
  thumbs: ThumbsUp,
  thumbsup: ThumbsUp,
  ok: ThumbsUp,
  help: CircleHelp,
  unknown: CircleHelp,
};

function getEmojiIconForLabel(label: string): LucideIcon {
  const key = label.trim().toLowerCase();
  if (LABEL_ICON_MAP[key]) {
    return LABEL_ICON_MAP[key];
  }
  return Smile;
}

function getWsUrl(): string {
  const configuredWsUrl = import.meta.env['VITE_WS_URL'] as string | undefined;
  if (configuredWsUrl) {
    return configuredWsUrl;
  }

  if (import.meta.env.DEV) {
    return 'ws://localhost:3000/ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function formatTimestamp(ts?: string): string {
  if (!ts) {
    return '-';
  }

  const value = new Date(ts);
  if (Number.isNaN(value.getTime())) {
    return ts;
  }

  return value.toLocaleString();
}

/** Client = square framing a star (Lucide has no `SquareStar` in this package version). */
function ClientBadgeIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex h-7 w-7 shrink-0 items-center justify-center text-foreground',
        className,
      )}
      aria-hidden
    >
      <Square className="absolute inset-0 h-7 w-7" strokeWidth={2} />
      <Star
        className="relative h-3.5 w-3.5 fill-amber-400/90 text-amber-600"
        strokeWidth={1.5}
      />
    </span>
  );
}

function BleConnectionRow({ bleStatus }: { bleStatus?: BleStatus }) {
  const connected = bleStatus === 'connected';
  const disconnected = bleStatus === 'disconnected';
  const unknown = bleStatus === undefined;

  const lineClass = cn(
    'h-0.5 flex-1 min-w-[0.5rem]',
    connected && 'bg-primary/70',
    disconnected && 'border-t-2 border-dashed border-muted-foreground/70 bg-transparent',
    unknown && 'border-t-2 border-dashed border-muted-foreground/40 bg-transparent',
  );

  const MidIcon =
    connected ? Bluetooth : disconnected ? BluetoothOff : BluetoothSearching;

  const midClass = cn(
    'mx-1.5 h-6 w-6 shrink-0',
    connected && 'text-primary',
    disconnected && 'text-muted-foreground',
    unknown && 'text-muted-foreground/80',
  );

  return (
    <div
      className="flex w-full max-w-xl items-center gap-0 py-2"
      role="img"
      aria-label={
        unknown
          ? 'Bluetooth link status unknown'
          : connected
            ? 'Controller linked to badge over Bluetooth'
            : 'Bluetooth link broken between controller and badge'
      }
    >
      <Gamepad2 className="h-7 w-7 shrink-0 text-foreground" strokeWidth={2} />
      <div className="flex min-h-7 min-w-0 flex-1 items-center">
        <div className={lineClass} />
        <MidIcon className={midClass} strokeWidth={2} aria-hidden />
        <div className={lineClass} />
      </div>
      <ClientBadgeIcon />
    </div>
  );
}

function EmojiLabelBlock({ emoji }: { emoji?: EmojiSentEvent }) {
  if (!emoji) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        No emoji event yet
      </div>
    );
  }

  const Icon = getEmojiIconForLabel(emoji.label);

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4">
      <Icon className="h-10 w-10 text-foreground" strokeWidth={1.75} aria-hidden />
      <span className="text-center text-sm font-medium leading-tight">
        {emoji.label}
      </span>
      <div className="text-xs text-muted-foreground">
        menu {emoji.menu} · pos {emoji.pos} · neg {emoji.neg}
      </div>
      <div className="text-xs text-muted-foreground">
        {formatTimestamp(emoji.timestamp)}
      </div>
    </div>
  );
}

type BadgesSnapshotResponse = {
  badges: Array<{
    key: string;
    controllerId: string;
    badgeId: string;
    status: StatusChangedEvent | null;
    emoji: EmojiSentEvent | null;
  }>;
};

function snapshotToRecords(
  badges: BadgesSnapshotResponse['badges'],
): Record<string, BadgeRecord> {
  const next: Record<string, BadgeRecord> = {};
  for (const b of badges) {
    next[b.key] = {
      key: b.key,
      controllerId: b.controllerId,
      badgeId: b.badgeId,
      status: b.status ?? undefined,
      emoji: b.emoji ?? undefined,
    };
  }
  return next;
}

const POLL_MS = 10_000;

export const BadgesView = () => {
  const [recordsByKey, setRecordsByKey] = useState<Record<string, BadgeRecord>>(
    {},
  );
  const [socketStatus, setSocketStatus] = useState<
    'connecting' | 'connected' | 'closed'
  >('connecting');
  const [tabVisible, setTabVisible] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible',
  );
  const socketStatusRef = useRef(socketStatus);
  socketStatusRef.current = socketStatus;

  const refreshSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/badges', { credentials: 'same-origin' });
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as BadgesSnapshotResponse;
      if (!Array.isArray(data.badges)) {
        return;
      }
      const fromServer = snapshotToRecords(data.badges);
      setRecordsByKey((prev) => ({ ...fromServer, ...prev }));
    } catch {
      // Snapshot is optional; WebSocket may still deliver events.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) {
        return;
      }
      await refreshSnapshot();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSnapshot]);

  useEffect(() => {
    const syncVisibility = () => {
      const visible = document.visibilityState === 'visible';
      setTabVisible(visible);
      if (visible && socketStatusRef.current === 'closed') {
        void refreshSnapshot();
      }
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, [refreshSnapshot]);

  /** App Runner and some hosts do not support WebSocket upgrades; poll when WS is down. */
  useEffect(() => {
    if (socketStatus !== 'closed' || !tabVisible) {
      return;
    }
    const id = window.setInterval(() => {
      void refreshSnapshot();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [socketStatus, tabVisible, refreshSnapshot]);

  useEffect(() => {
    const ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      setSocketStatus('connected');
    };

    ws.onclose = () => {
      setSocketStatus('closed');
    };

    ws.onerror = () => {
      setSocketStatus('closed');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WsEnvelope;
        if (message.type !== 'status.changed' && message.type !== 'emoji.sent') {
          return;
        }

        if (message.type === 'status.changed') {
          const payload = message.payload;
          const key = `${payload.controllerId}::${payload.badgeId}`;

          setRecordsByKey((current) => {
            const previous = current[key];
            const baseRecord: BadgeRecord = previous ?? {
              key,
              controllerId: payload.controllerId,
              badgeId: payload.badgeId,
            };

            return {
              ...current,
              [key]: { ...baseRecord, status: payload },
            };
          });
          return;
        }

        const payload = message.payload;
        const key = `${payload.controllerId}::${payload.badgeId}`;
        setRecordsByKey((current) => {
          const previous = current[key];
          const baseRecord: BadgeRecord = previous ?? {
            key,
            controllerId: payload.controllerId,
            badgeId: payload.badgeId,
          };

          return {
            ...current,
            [key]: { ...baseRecord, emoji: payload },
          };
        });
      } catch {
        // Ignore malformed websocket payloads.
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  const badgeRecords = useMemo(() => {
    return Object.values(recordsByKey).sort((a, b) =>
      a.badgeId.localeCompare(b.badgeId),
    );
  }, [recordsByKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-lg font-bold">Badges</p>
        <p className="text-sm text-muted-foreground">
          {socketStatus === 'connected' && 'Live updates: WebSocket'}
          {socketStatus === 'connecting' && 'Live updates: connecting…'}
          {socketStatus === 'closed' &&
            (tabVisible
              ? `Live updates: polling every ${POLL_MS / 1000}s (WebSocket unavailable)`
              : 'Live updates: paused while tab is in background')}
        </p>
      </div>

      {badgeRecords.length === 0 ? (
        <div className="p-4 border rounded-lg text-sm text-gray-600">
          No badge data yet. POST to <code className="text-xs">/api/status</code> or{' '}
          <code className="text-xs">/api/emoji</code>, then wait for polling or open
          this page after posting.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {badgeRecords.map((record) => (
            <div key={record.key} className="overflow-hidden rounded-lg border">
              <div className="border-b bg-muted/40 px-4 py-3">
                <p className="font-semibold">
                  {record.badgeId}{' '}
                  <span className="font-normal text-muted-foreground">
                    ({record.controllerId})
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Status: {record.status?.bleStatus ?? '—'} ·{' '}
                  {formatTimestamp(record.status?.timestamp)}
                </p>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Link
                  </p>
                  <BleConnectionRow bleStatus={record.status?.bleStatus} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Last emoji
                  </p>
                  <EmojiLabelBlock emoji={record.emoji} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
