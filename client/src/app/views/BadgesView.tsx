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
  Battery,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  Bluetooth,
  BluetoothOff,
  BluetoothSearching,
  Circle,
  CircleHelp,
  Flame,
  Gamepad2,
  Heart,
  Laugh,
  Loader2,
  Meh,
  Power,
  Skull,
  Smile,
  Square,
  Star,
  ThumbsUp,
  Unplug,
  X as XIcon,
  Zap,
} from 'lucide-react';
import { cn } from '../shared/utils';

/** Values accepted by `POST /api/status` (device-reported). */
type DeviceBleStatus =
  | 'startup'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected';

/** After `connected` goes stale (no recent liveness), UI shows offline. */
type DisplayBleStatus = DeviceBleStatus | 'offline' | 'unknown';

type StatusChangedEvent = {
  controllerId: string;
  badgeId: string;
  bleStatus: DeviceBleStatus;
  /** Server UTC (canonical). */
  timestamp: string;
  /** Optional device hint when clock was wrong; not used for ordering. */
  clientTimestamp?: string;
  /** Shared pair label from pair_config.py, e.g. "white". */
  pairName?: string;
  /** Zero script version, e.g. "0.5.8". */
  controllerVersion?: string;
  /** Pico badge script version parsed from PAIR_OK handshake, e.g. "0.3.2". */
  picoVersion?: string;
  /** Controller battery level 0–100 from INA219; absent when unavailable. */
  batteryLevel?: number | null;
};

type EmojiSentEvent = {
  controllerId: string;
  badgeId: string;
  menu: number;
  pos: number;
  neg: number;
  label: string;
  /** Server UTC (canonical). */
  timestamp: string;
  clientTimestamp?: string;
  pairName?: string;
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

/** Shown in dev when there is no server/WebSocket data so badge card layout can be exercised. */
const devExampleBadgeRecord: BadgeRecord = (() => {
  const controllerId = 'dev-local';
  const badgeId = 'example-badge';
  const key = `${controllerId}::${badgeId}`;
  return {
    key,
    controllerId,
    badgeId,
    status: {
      controllerId,
      badgeId,
      bleStatus: 'connected',
      timestamp: '2026-04-05T10:00:00.000Z',
    },
    emoji: {
      controllerId,
      badgeId,
      menu: 0,
      pos: 2,
      neg: 1,
      label: 'happy_dev',
      timestamp: '2026-04-05T10:05:30.000Z',
    },
  };
})();

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

/** NFC card display type returned by /api/nfc-cards. */
type NfcCard = {
  id: string;
  name: string;
  display: string;
};

/** Derived map from card ID → NfcCard for fast lookup. */
type NfcCardMap = Record<string, NfcCard>;

/** True when the label represents a positive NFC scan result (circle). */
function isNfcPos(label: string): boolean {
  return label === 'others_nfc_pos';
}

/** True when the label represents a negative NFC scan result (x). */
function isNfcNeg(label: string): boolean {
  return label === 'others_nfc_neg';
}

/** If `connected` but no liveness for this long, show offline (abrupt power-off, etc.). */
const STALE_CONNECTED_MS = 90_000;

function resolveBleDisplay(status?: StatusChangedEvent): DisplayBleStatus {
  if (!status) {
    return 'unknown';
  }
  if (status.bleStatus !== 'connected') {
    return status.bleStatus;
  }
  const t = new Date(status.timestamp).getTime();
  if (Number.isNaN(t)) {
    return 'offline';
  }
  if (Date.now() - t > STALE_CONNECTED_MS) {
    return 'offline';
  }
  return 'connected';
}

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
        'relative inline-flex h-6 w-6 shrink-0 items-center justify-center text-foreground',
        className,
      )}
      aria-hidden
    >
      <Square className="absolute inset-0 h-6 w-6" strokeWidth={2} />
      <Star
        className="relative h-3 w-3 fill-amber-400/90 text-amber-600"
        strokeWidth={1.5}
      />
    </span>
  );
}

function BleConnectionRow({ status }: { status?: StatusChangedEvent }) {
  const display = resolveBleDisplay(status);

  const lineClass = cn(
    'h-0.5 min-w-[0.5rem] flex-1',
    display === 'connected' && 'bg-primary/70',
    (display === 'disconnected' ||
      display === 'offline' ||
      display === 'unknown') &&
      'border-t-2 border-dashed border-muted-foreground/70 bg-transparent',
    (display === 'startup' ||
      display === 'scanning' ||
      display === 'connecting') &&
      'border-t-2 border-dashed border-primary/40 bg-transparent',
  );

  const MidIcon =
    display === 'connected'
      ? Bluetooth
      : display === 'disconnected'
        ? BluetoothOff
        : display === 'offline'
          ? Unplug
          : display === 'scanning'
            ? BluetoothSearching
            : display === 'connecting'
              ? Loader2
              : display === 'startup'
                ? Power
                : BluetoothSearching;

  const midClass = cn(
    'mx-1.5 h-5 w-5 shrink-0',
    display === 'connected' && 'text-primary',
    (display === 'disconnected' || display === 'offline') &&
      'text-muted-foreground',
    display === 'unknown' && 'text-muted-foreground/80',
    (display === 'startup' ||
      display === 'scanning' ||
      display === 'connecting') &&
      'text-primary/80',
    display === 'connecting' && 'animate-spin',
  );

  const ariaLabel =
    display === 'unknown'
      ? 'Bluetooth link status unknown'
      : display === 'connected'
        ? 'Controller linked to badge over Bluetooth'
        : display === 'offline'
          ? 'Controller or badge stopped reporting; link may be lost'
          : display === 'startup'
            ? 'Controller starting; Bluetooth not ready yet'
            : display === 'scanning'
              ? 'Scanning for badge (may be advertising)'
              : display === 'connecting'
                ? 'Connecting to badge over Bluetooth'
                : display === 'disconnected'
                  ? 'Bluetooth link broken between controller and badge'
                  : 'Bluetooth link status unknown';

  return (
    <div
      className="flex w-full min-w-0 items-center gap-0 py-0"
      role="img"
      aria-label={ariaLabel}
    >
      <Gamepad2
        className="h-6 w-6 shrink-0 text-foreground"
        strokeWidth={2}
        aria-hidden
      />
      <div className="flex min-h-7 min-w-0 flex-1 items-center">
        <div className={lineClass} />
        <MidIcon className={midClass} strokeWidth={2} aria-hidden />
        <div className={lineClass} />
      </div>
      <ClientBadgeIcon />
    </div>
  );
}

function EmojiLabelBlock({
  emoji,
  nfcCardMap,
}: {
  emoji?: EmojiSentEvent;
  nfcCardMap: NfcCardMap;
}) {
  if (!emoji) {
    return (
      <div className="rounded border border-dashed bg-muted/20 px-1.5 py-1 text-center text-[11px] leading-tight text-muted-foreground">
        No emoji yet
      </div>
    );
  }

  const nfcPos = isNfcPos(emoji.label);
  const nfcNeg = isNfcNeg(emoji.label);
  const isNfc = nfcPos || nfcNeg;

  // Determine display type from the card map when possible; fall back to label.
  // The card map keys are NFC UIDs but the emoji event only carries the label,
  // so we use the label to infer display type and show all matching card names.
  const matchingCards = isNfc
    ? Object.values(nfcCardMap).filter((c) =>
        nfcPos ? c.display === 'circle' : c.display !== 'circle',
      )
    : [];

  const Icon = isNfc
    ? nfcPos
      ? Circle
      : XIcon
    : getEmojiIconForLabel(emoji.label);

  const iconClass = isNfc
    ? nfcPos
      ? 'h-6 w-6 shrink-0 text-blue-500'
      : 'h-6 w-6 shrink-0 text-red-500'
    : 'h-6 w-6 shrink-0 text-foreground';

  const cardNames = matchingCards.map((c) => c.name).join(', ');

  return (
    <div className="flex min-w-0 w-full flex-col items-center gap-0.5 rounded-md border bg-muted/15 px-1.5 py-1 text-center">
      <Icon className={iconClass} strokeWidth={isNfc && nfcPos ? 2.5 : 2} aria-hidden />
      <span className="w-full break-words text-xs font-medium leading-tight">
        {isNfc && cardNames ? cardNames : emoji.label}
      </span>
      <div className="text-[10px] leading-tight text-muted-foreground">
        menu {emoji.menu} · pos {emoji.pos} · neg {emoji.neg}
      </div>
      <div className="text-[10px] text-muted-foreground">
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

function BatteryIcon({ level }: { level: number | null | undefined }) {
  if (level == null) {
    return null;
  }
  const Icon = level >= 75 ? BatteryFull : level >= 40 ? BatteryMedium : level >= 15 ? BatteryLow : Battery;
  const colorClass =
    level >= 40
      ? 'text-green-600'
      : level >= 15
        ? 'text-amber-500'
        : 'text-red-500';
  return (
    <span className="inline-flex items-center gap-0.5" title={`Battery ${level}%`}>
      <Icon className={cn('h-3 w-3 shrink-0', colorClass)} strokeWidth={2} aria-hidden />
      <span className={cn('text-[10px] tabular-nums', colorClass)}>{level}%</span>
    </span>
  );
}

function BadgeCardHeader({ record }: { record: BadgeRecord }) {
  const pairName = record.status?.pairName;
  const controllerVersion = record.status?.controllerVersion;
  const picoVersion = record.status?.picoVersion;
  const batteryLevel = record.status?.batteryLevel;

  return (
    <div className="flex flex-col gap-0.5 border-b bg-muted/40 px-1.5 py-1">
      {pairName ? (
        <p className="break-words text-sm font-bold leading-tight text-foreground">
          {pairName}
        </p>
      ) : null}
      <p className={cn('break-words leading-tight', pairName ? 'text-[11px] text-muted-foreground' : 'text-sm font-semibold')}>
        {record.badgeId}
      </p>
      <p className="break-words text-[10px] leading-tight text-muted-foreground">
        {record.controllerId}
      </p>
      {(controllerVersion || picoVersion || batteryLevel != null) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {controllerVersion && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Zero controller version">
              <Gamepad2 className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
              {controllerVersion}
            </span>
          )}
          {picoVersion && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Pico badge version">
              <ClientBadgeIcon className="h-2.5 w-2.5" />
              {picoVersion}
            </span>
          )}
          <BatteryIcon level={batteryLevel} />
        </div>
      )}
    </div>
  );
}

export const BadgesView = () => {
  /** Re-render periodically so stale `connected` can flip to offline without waiting for poll. */
  const [, bumpStaleCheck] = useState(0);
  const [recordsByKey, setRecordsByKey] = useState<Record<string, BadgeRecord>>(
    {},
  );
  const [nfcCardMap, setNfcCardMap] = useState<NfcCardMap>({});
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
      setRecordsByKey((prev) => ({ ...prev, ...fromServer }));
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
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/nfc-cards', { credentials: 'same-origin' });
        if (!res.ok || cancelled) {
          return;
        }
        const data = (await res.json()) as { cards: NfcCard[] };
        if (!Array.isArray(data.cards)) {
          return;
        }
        const map: NfcCardMap = {};
        for (const card of data.cards) {
          map[card.id] = card;
        }
        setNfcCardMap(map);
      } catch {
        // NFC card map is optional; icons will degrade gracefully.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      bumpStaleCheck((n) => n + 1);
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

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
    const hasRealBadges = Object.keys(recordsByKey).length > 0;

    // In dev mode, fall back to a static example record so the card layout can
    // be exercised without a physical device. In production this branch never
    // runs because import.meta.env.DEV is replaced with `false` at build time.
    const source =
      import.meta.env.DEV && !hasRealBadges
        ? { [devExampleBadgeRecord.key]: devExampleBadgeRecord }
        : recordsByKey;

    let records = Object.values(source);

    // In production, hide "pre-connection" placeholder entries: the Zero posts
    // status events with bleStatus "startup" / "scanning" before the Pico BLE
    // address is known, producing a badgeId of "unknown". These entries have no
    // useful information for the dashboard and are filtered out in production.
    // In dev mode they remain visible as a debugging aid.
    if (!import.meta.env.DEV) {
      records = records.filter((r) => r.badgeId !== 'unknown');
    }

    return records.sort((a, b) => a.badgeId.localeCompare(b.badgeId));
  }, [recordsByKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="py-2 sm:flex sm:justify-end">
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
        <div className="-mx-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
          {badgeRecords.map((record) => (
            <div key={record.key} className="min-w-0 overflow-hidden rounded-lg border">
              <BadgeCardHeader record={record} />
              <div className="flex flex-col items-center gap-1 p-1.5">
                <BleConnectionRow status={record.status} />
                <EmojiLabelBlock emoji={record.emoji} nfcCardMap={nfcCardMap} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
