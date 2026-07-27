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
  Cpu,
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
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { cn } from '../shared/utils';
import {
  gameLogRef,
  logFromServerGameState,
  logGameState,
} from '../shared/game-state-log';
import {
  GAME_STATE_ICON_CLASS,
  GAME_STATE_ICONS,
  GAME_STATE_SHORT_LABELS,
  resolvePairVisualState,
  type GameVisualState,
  type QuestionResultEntry,
} from '../shared/game-state-icon';
import { getWsUrl } from '../shared/ws-url';

const FRESH_HIGHLIGHT_MS = 1800;

const cardSpring = { type: 'spring' as const, stiffness: 120, damping: 18, mass: 1.1 };
const crossfadeSpring = { type: 'spring' as const, stiffness: 500, damping: 35 };

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
  | { type: 'emoji.sent'; payload: EmojiSentEvent }
  | {
      type: 'game.state.changed';
      gameId: string;
      gameTitle?: string;
      state: string;
      serverTime: string;
    }
  | {
      type: 'controller.joined';
      gameId: string;
      gameTitle?: string;
      pairName: string;
      controllerId?: string;
      serverTime: string;
    }
  | {
      type: 'nfc.tagged';
      gameId: string;
      gameTitle?: string;
      questionId?: string;
      pairName?: string;
      controllerId?: string;
      badgeId?: string;
      cardUid?: string;
      slotLabel?: string;
      cardLabel?: string;
      isCorrect?: boolean;
      serverTime: string;
    }
  | {
      type: 'question.opened';
      gameId: string;
      gameTitle?: string;
      questionId: string;
      serverTime: string;
    }
  | {
      type: 'question.closed';
      gameId: string;
      gameTitle?: string;
      questionId: string;
      serverTime: string;
    }
  | {
      type: 'question.result';
      gameId: string;
      gameTitle?: string;
      questionId: string;
      correctSlotLabel: string;
      results: Array<{
        pairName: string;
        slotLabel: string | null;
        isCorrect: boolean;
      }>;
      serverTime: string;
    };

type BadgeRecord = {
  key: string;
  controllerId: string;
  badgeId: string;
  status?: StatusChangedEvent;
  emoji?: EmojiSentEvent;
};

type GameEventState = {
  gameId: string;
  gameTitle?: string;
  gameState: string;
  serverTime: string;
};

type JoinEvent = {
  gameId: string;
  pairName: string;
  controllerId?: string;
  serverTime: string;
};

type NfcTagEvent = {
  gameId: string;
  pairName?: string;
  controllerId?: string;
  badgeId?: string;
  cardUid?: string;
  slotLabel?: string;
  isCorrect?: boolean;
  serverTime: string;
};

type QuestionPhase = 'none' | 'open' | 'closed';

type VersionInfo = {
  version: string;
  expectedControllerVersion: string;
  expectedPicoVersion: string;
};

// TODO: To re-enable the dummy badge for local layout development, uncomment the block below
// and restore the `devExampleBadgeRecord` reference in the `badgeRecords` useMemo further down
// (look for the comment "DEV DUMMY BADGE"). Do not commit with this re-enabled.
//
// /** Shown in dev when there is no server/WebSocket data so badge card layout can be exercised. */
// const devExampleBadgeRecord: BadgeRecord = (() => {
//   const controllerId = 'dev-local';
//   const badgeId = 'example-badge';
//   const key = `${controllerId}::${badgeId}`;
//   return {
//     key,
//     controllerId,
//     badgeId,
//     status: {
//       controllerId,
//       badgeId,
//       bleStatus: 'connected',
//       timestamp: '2026-04-05T10:00:00.000Z',
//     },
//     emoji: {
//       controllerId,
//       badgeId,
//       menu: 0,
//       pos: 2,
//       neg: 1,
//       label: 'happy_dev',
//       timestamp: '2026-04-05T10:05:30.000Z',
//     },
//   };
// })();

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
    'h-5 w-5 shrink-0',
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
        <span className="relative mx-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={display}
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={crossfadeSpring}
            >
              <MidIcon className={midClass} strokeWidth={2} aria-hidden />
            </motion.span>
          </AnimatePresence>
        </span>
        <div className={lineClass} />
      </div>
      <ClientBadgeIcon />
    </div>
  );
}

function GameVisualBlock({
  visual,
  gameTitle,
  gameId,
}: {
  visual: GameVisualState;
  gameTitle?: string;
  gameId?: string;
}) {
  const Icon = GAME_STATE_ICONS[visual];
  const iconClass = GAME_STATE_ICON_CLASS[visual];
  const label = GAME_STATE_SHORT_LABELS[visual];
  const filled = visual === 'correct' || visual === 'active';

  return (
    <div className="flex min-w-0 w-full flex-col items-center gap-0.5 rounded-md border bg-muted/15 px-1.5 py-1.5 text-center">
      <Icon
        className={cn('h-7 w-7 shrink-0', iconClass ?? 'text-foreground')}
        strokeWidth={visual === 'wrong' ? 2.5 : filled ? 0 : 2}
        fill={filled ? 'currentColor' : 'none'}
        aria-hidden
      />
      <span className="w-full break-words text-xs font-semibold leading-tight">
        {label}
      </span>
      {(gameTitle || gameId) && (
        <div className="w-full break-words text-[10px] leading-tight text-muted-foreground">
          {gameTitle ?? `game ${gameId?.slice(-6)}`}
        </div>
      )}
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

function BadgePrimaryVisual({
  emoji,
  nfcCardMap,
  pairName,
  activeGame,
  joinsByPair,
  answerByPair,
  questionPhase,
  resultsByPair,
  winnerPairNames,
}: {
  emoji?: EmojiSentEvent;
  nfcCardMap: NfcCardMap;
  pairName?: string;
  activeGame: GameEventState | null;
  joinsByPair: Record<string, JoinEvent>;
  /** Sticky per-pair isCorrect from nfc.tagged / question.result. */
  answerByPair: Record<string, boolean>;
  questionPhase: QuestionPhase;
  resultsByPair: Record<string, QuestionResultEntry>;
  winnerPairNames: Set<string> | null;
}) {
  const joinEvent = pairName ? joinsByPair[pairName] : undefined;
  const result = pairName ? (resultsByPair[pairName] ?? null) : null;
  const answered =
    pairName != null && Object.prototype.hasOwnProperty.call(answerByPair, pairName);

  // Prefer live Platform game icon over free-play emoji while a game is running.
  const inGame =
    Boolean(activeGame) &&
    activeGame!.gameState !== 'draft' &&
    Boolean(pairName);
  const visual = inGame
    ? resolvePairVisualState({
        gameState: activeGame?.gameState,
        joined: Boolean(joinEvent),
        questionPhase,
        nfcIsCorrect: answered && pairName ? answerByPair[pairName] : null,
        result,
        winnerPairNames,
        pairName,
      })
    : null;

  const content = visual ? (
    <motion.div
      key={`game-${visual}-${activeGame?.gameId ?? ''}`}
      className="w-full"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={crossfadeSpring}
    >
      <GameVisualBlock
        visual={visual}
        gameTitle={activeGame?.gameTitle}
        gameId={activeGame?.gameId}
      />
    </motion.div>
  ) : (
    <motion.div
      key={`emoji-${emoji?.label ?? 'none'}-${emoji?.timestamp ?? ''}`}
      className="w-full"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={crossfadeSpring}
    >
      <EmojiLabelBlock emoji={emoji} nfcCardMap={nfcCardMap} />
    </motion.div>
  );

  return (
    <AnimatePresence mode="wait" initial={false}>
      {content}
    </AnimatePresence>
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

/**
 * Returns true if `actual` is strictly older than `expected` by semver rules.
 * Handles "x" wildcard suffixes in expected (e.g. "0.5.x" → "0.5.0").
 * If either value is empty / "unknown" we never flag as outdated.
 */
function isVersionOutdated(actual: string | undefined, expected: string): boolean {
  if (!actual || actual === 'unknown' || !expected) return false;
  const normalise = (v: string) =>
    v
      .replace(/^v/, '')
      .replace(/\.x$/i, '.0')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const a = normalise(actual);
  const e = normalise(expected);
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    const av = a[i] ?? 0;
    const ev = e[i] ?? 0;
    if (av !== ev) return av < ev;
  }
  return false;
}

function OutdatedChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
      ⚠ outdated
    </span>
  );
}

function BadgeCardHeader({
  record,
  versionInfo,
}: {
  record: BadgeRecord;
  versionInfo: VersionInfo | null;
}) {
  const pairName = record.status?.pairName;
  const controllerVersion = record.status?.controllerVersion;
  const picoVersion = record.status?.picoVersion;
  const batteryLevel = record.status?.batteryLevel;

  const controllerOutdated =
    versionInfo != null &&
    controllerVersion != null &&
    isVersionOutdated(controllerVersion, versionInfo.expectedControllerVersion);
  const picoOutdated =
    versionInfo != null &&
    picoVersion != null &&
    picoVersion !== 'unknown' &&
    isVersionOutdated(picoVersion, versionInfo.expectedPicoVersion);

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
              {controllerOutdated && <OutdatedChip />}
            </span>
          )}
          {picoVersion && picoVersion !== 'unknown' && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Pico badge version">
              <Cpu className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
              {picoVersion}
              {picoOutdated && <OutdatedChip />}
            </span>
          )}
          <BatteryIcon level={batteryLevel} />
        </div>
      )}
    </div>
  );
}

function formatShortTime(ts?: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function ResultChip({ result }: { result: QuestionResultEntry }) {
  if (result.slotLabel == null) {
    return (
      <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
        —
      </span>
    );
  }
  if (result.isCorrect) {
    return (
      <span className="rounded bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-700">
        ✓ {result.slotLabel}
      </span>
    );
  }
  return (
    <span className="rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium text-red-700">
      ✗ {result.slotLabel}
    </span>
  );
}

function BadgeCardGameSection({
  pairName,
  activeGame,
  joinsByPair,
  nfcByPair,
  answerByPair,
  questionPhase,
  resultsByPair,
  winnerPairNames,
}: {
  pairName?: string;
  activeGame: GameEventState | null;
  joinsByPair: Record<string, JoinEvent>;
  nfcByPair: Record<string, NfcTagEvent>;
  answerByPair: Record<string, boolean>;
  questionPhase: QuestionPhase;
  resultsByPair: Record<string, QuestionResultEntry>;
  winnerPairNames: Set<string> | null;
}) {
  if (!pairName) return null;
  const joinEvent = joinsByPair[pairName];
  const nfcEvent = nfcByPair[pairName];
  const result = resultsByPair[pairName] ?? null;
  const answered = Object.prototype.hasOwnProperty.call(answerByPair, pairName);
  if (!joinEvent && !nfcEvent && !activeGame && !result && !answered) return null;

  const visual = resolvePairVisualState({
    gameState: activeGame?.gameState,
    joined: Boolean(joinEvent),
    questionPhase,
    nfcIsCorrect: answered ? answerByPair[pairName] : null,
    result,
    winnerPairNames,
    pairName,
  });
  const statusLabel = visual
    ? GAME_STATE_SHORT_LABELS[visual]
    : activeGame?.gameState;

  return (
    <div className="w-full rounded-md border bg-muted/10 px-1.5 py-1 text-[10px] text-muted-foreground">
      {activeGame && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <span className="font-medium text-foreground">{statusLabel}</span>
          {activeGame.gameTitle && (
            <span className="text-[9px]">· {activeGame.gameTitle}</span>
          )}
          <span className="text-[9px]">· {formatShortTime(activeGame.serverTime)}</span>
        </div>
      )}
      {joinEvent && (
        <div>Joined at {formatShortTime(joinEvent.serverTime)}</div>
      )}
      {nfcEvent && (
        <div className="flex items-center gap-1">
          <span>
            NFC{nfcEvent.slotLabel ? `: ${nfcEvent.slotLabel}` : ''} ·{' '}
            {formatShortTime(nfcEvent.serverTime)}
          </span>
          {answered && !result && (
            <ResultChip
              result={{
                slotLabel: nfcEvent.slotLabel ?? null,
                isCorrect: answerByPair[pairName],
              }}
            />
          )}
        </div>
      )}
      {result && (
        <div className="mt-0.5 flex items-center gap-1">
          <span>Result</span>
          <ResultChip result={result} />
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
  const [freshKeys, setFreshKeys] = useState<Set<string>>(() => new Set());
  const knownKeysRef = useRef<Set<string>>(new Set());
  const freshTimeoutsRef = useRef<Map<string, number>>(new Map());
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
  const gameTitlesByIdRef = useRef<Record<string, string>>({});

  // Game event state
  const [activeGame, setActiveGame] = useState<GameEventState | null>(null);
  const [joinsByPair, setJoinsByPair] = useState<Record<string, JoinEvent>>({});
  const [nfcByPair, setNfcByPair] = useState<Record<string, NfcTagEvent>>({});
  /** Sticky isCorrect per pair — survives question.closed; cleared on next open. */
  const [answerByPair, setAnswerByPair] = useState<Record<string, boolean>>({});
  const [questionPhase, setQuestionPhase] = useState<QuestionPhase>('none');
  const [resultsByPair, setResultsByPair] = useState<
    Record<string, QuestionResultEntry>
  >({});
  const [winnerPairNames, setWinnerPairNames] = useState<Set<string> | null>(
    null,
  );
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  const markFreshKeys = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setFreshKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      return next;
    });
    for (const key of keys) {
      const existing = freshTimeoutsRef.current.get(key);
      if (existing != null) window.clearTimeout(existing);
      const id = window.setTimeout(() => {
        freshTimeoutsRef.current.delete(key);
        setFreshKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, FRESH_HIGHLIGHT_MS);
      freshTimeoutsRef.current.set(key, id);
    }
  }, []);

  /**
   * Track known badge keys. Until the first snapshot finishes, new keys are
   * baseline only (no highlight). After that, newly seen keys get a brief pulse.
   */
  const snapshotDoneRef = useRef(false);

  useEffect(() => {
    return () => {
      for (const id of freshTimeoutsRef.current.values()) {
        window.clearTimeout(id);
      }
      freshTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const newcomers: string[] = [];
    for (const [key, record] of Object.entries(recordsByKey)) {
      if (record.badgeId === 'unknown') continue;
      if (!knownKeysRef.current.has(key)) {
        newcomers.push(key);
        knownKeysRef.current.add(key);
      }
    }
    if (!snapshotDoneRef.current || newcomers.length === 0) return;
    markFreshKeys(newcomers);
  }, [recordsByKey, markFreshKeys]);

  const loadWinnerPairs = useCallback(async (gameId: string) => {
    try {
      const res = await fetch(`/api/games/${gameId}/scores`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        scores: Array<{ pairName: string; correct: number }>;
      };
      if (!Array.isArray(data.scores) || data.scores.length === 0) {
        setWinnerPairNames(new Set());
        return;
      }
      const top = Math.max(...data.scores.map((s) => s.correct));
      // Mirror server: 0-correct is never a win (solo/all-wrong → loser icon).
      setWinnerPairNames(
        new Set(
          top > 0
            ? data.scores.filter((s) => s.correct === top).map((s) => s.pairName)
            : [],
        ),
      );
    } catch {
      // optional enrichment for winner/loser icons
    }
  }, []);

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
      // First snapshot only: seed baseline keys so the initial grid is not "fresh".
      if (!snapshotDoneRef.current) {
        for (const [key, record] of Object.entries(fromServer)) {
          if (record.badgeId !== 'unknown') {
            knownKeysRef.current.add(key);
          }
        }
      }
      setRecordsByKey((prev) => ({ ...prev, ...fromServer }));
    } catch {
      // Snapshot is optional; WebSocket may still deliver events.
    } finally {
      snapshotDoneRef.current = true;
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
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/version', { credentials: 'same-origin' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as VersionInfo;
        setVersionInfo(data);
      } catch {
        // Version info is optional; outdated chip will not show.
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

        const rememberGameTitle = (gameId: string, gameTitle?: string) => {
          if (gameTitle) {
            gameTitlesByIdRef.current[gameId] = gameTitle;
          }
        };
        const refFor = (gameId: string, gameTitle?: string) => {
          rememberGameTitle(gameId, gameTitle);
          return gameLogRef({
            id: gameId,
            title: gameTitle ?? gameTitlesByIdRef.current[gameId],
          });
        };

        if (message.type === 'game.state.changed') {
          setActiveGame({
            gameId: message.gameId,
            gameTitle: message.gameTitle ?? gameTitlesByIdRef.current[message.gameId],
            gameState: message.state,
            serverTime: message.serverTime,
          });
          if (message.gameTitle) {
            gameTitlesByIdRef.current[message.gameId] = message.gameTitle;
          }
          if (message.state === 'draft' || message.state === 'ready') {
            setQuestionPhase('none');
            setResultsByPair({});
            setNfcByPair({});
            setAnswerByPair({});
            setWinnerPairNames(null);
            setJoinsByPair({});
          } else if (message.state === 'lobby') {
            setQuestionPhase('none');
            setResultsByPair({});
            setNfcByPair({});
            setAnswerByPair({});
            setWinnerPairNames(null);
            setJoinsByPair({});
          } else if (message.state === 'active') {
            // Do not reset questionPhase here — question.opened often arrives in
            // the same burst and resetting to 'none' races to the green "active"
            // square over "?". Clear prior-question answers only.
            setResultsByPair({});
            setNfcByPair({});
            setAnswerByPair({});
            setWinnerPairNames(null);
          } else if (message.state === 'completed' || message.state === 'cancelled') {
            void loadWinnerPairs(message.gameId);
          }
          logFromServerGameState(
            message.state,
            `WS game.state.changed ${refFor(message.gameId, message.gameTitle)}`,
          );
          return;
        }

        if (message.type === 'controller.joined') {
          setJoinsByPair((prev) => ({
            ...prev,
            [message.pairName]: {
              gameId: message.gameId,
              pairName: message.pairName,
              controllerId: message.controllerId,
              serverTime: message.serverTime,
            },
          }));
          logGameState(
            'lobby_joined',
            `WS controller.joined pair=${message.pairName} ${refFor(message.gameId, message.gameTitle)} icon=hand-platter`,
          );
          return;
        }

        if (message.type === 'question.opened') {
          setQuestionPhase('open');
          setResultsByPair({});
          setNfcByPair({});
          setAnswerByPair({});
          logGameState(
            'question_open',
            `WS question.opened questionId=${message.questionId} ${refFor(message.gameId, message.gameTitle)} icon=message-circle-question-mark`,
          );
          return;
        }

        if (message.type === 'question.closed') {
          setQuestionPhase('closed');
          logGameState(
            'question_closed',
            `WS question.closed questionId=${message.questionId} ${refFor(message.gameId, message.gameTitle)} icon=book-alert`,
          );
          return;
        }

        if (message.type === 'question.result') {
          const next: Record<string, QuestionResultEntry> = {};
          const nextAnswers: Record<string, boolean> = {};
          for (const row of message.results) {
            next[row.pairName] = {
              slotLabel: row.slotLabel,
              isCorrect: row.isCorrect,
            };
            if (row.slotLabel != null) {
              nextAnswers[row.pairName] = row.isCorrect;
            } else {
              nextAnswers[row.pairName] = false;
            }
          }
          setResultsByPair(next);
          setAnswerByPair((prev) => ({ ...prev, ...nextAnswers }));
          const gameRef = refFor(message.gameId, message.gameTitle);
          for (const row of message.results) {
            if (row.slotLabel == null) {
              logGameState(
                'wrong',
                `WS question.result pair=${row.pairName} no guess ${gameRef}`,
              );
            } else {
              logGameState(
                row.isCorrect ? 'correct' : 'wrong',
                `WS question.result pair=${row.pairName} slot=${row.slotLabel} ${gameRef}`,
              );
            }
          }
          return;
        }

        if (message.type === 'nfc.tagged') {
          const pairName = message.pairName;
          if (pairName) {
            setNfcByPair((prev) => ({
              ...prev,
              [pairName]: {
                gameId: message.gameId,
                pairName: message.pairName,
                controllerId: message.controllerId,
                badgeId: message.badgeId,
                cardUid: message.cardUid,
                slotLabel: message.slotLabel,
                isCorrect: message.isCorrect,
                serverTime: message.serverTime,
              },
            }));
            if (typeof message.isCorrect === 'boolean') {
              setAnswerByPair((prev) => ({
                ...prev,
                [pairName]: message.isCorrect as boolean,
              }));
            }
          }
          const pair = pairName ?? '?';
          const slot = message.slotLabel ?? '?';
          const card = message.cardLabel ?? slot;
          const gameRef = refFor(message.gameId, message.gameTitle);
          logGameState(
            'card_scanned',
            `WS nfc.tagged pair=${pair} card=${card} slot=${slot} cardUid=${message.cardUid ?? '?'} ${gameRef}`,
          );
          if (typeof message.isCorrect === 'boolean') {
            logGameState(
              message.isCorrect ? 'correct' : 'wrong',
              `pair=${pair} card=${card} slot=${slot} ${gameRef} icon=${message.isCorrect ? 'circle' : 'x'}`,
            );
          }
          return;
        }

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
  }, [loadWinnerPairs]);

  const badgeRecords = useMemo(() => {
    // DEV DUMMY BADGE: to inject a static example badge for layout development without a physical
    // device, uncomment the block below and uncomment devExampleBadgeRecord near the top of this
    // file. Do not commit with this enabled.
    //
    // const hasRealBadges = Object.keys(recordsByKey).length > 0;
    // const source =
    //   import.meta.env.DEV && !hasRealBadges
    //     ? { [devExampleBadgeRecord.key]: devExampleBadgeRecord }
    //     : recordsByKey;
    const source = recordsByKey;

    let records = Object.values(source);

    // Hide "pre-connection" entries: the Zero posts status events with bleStatus
    // "startup" / "scanning" before the Pico BLE address is known, producing a
    // badgeId of "unknown". These entries have no useful information for the dashboard.
    records = records.filter((r) => r.badgeId !== 'unknown');

    return records.sort((a, b) => a.badgeId.localeCompare(b.badgeId));
  }, [recordsByKey]);

  const skipStaggerRef = useRef(false);
  const useStagger = !skipStaggerRef.current;

  useEffect(() => {
    if (badgeRecords.length > 0) {
      skipStaggerRef.current = true;
    }
  }, [badgeRecords.length]);

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
        <LayoutGroup>
          <motion.div
            layout
            className="relative -mx-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2"
          >
            <AnimatePresence mode="popLayout">
              {badgeRecords.map((record, index) => {
                const isFresh = freshKeys.has(record.key);
                return (
                  <motion.div
                    key={record.key}
                    layout
                    initial={{ opacity: 0, scale: 0.6, y: 16 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      y: 0,
                      boxShadow: isFresh
                        ? '0 0 0 2px hsl(var(--primary)), 0 8px 24px -8px hsl(var(--primary) / 0.45)'
                        : '0 0 0 0px transparent',
                    }}
                    exit={{ opacity: 0, scale: 0.85, y: -8 }}
                    transition={{
                      ...cardSpring,
                      delay: useStagger ? Math.min(index * 0.12, 0.7) : 0,
                    }}
                    className={cn(
                      'min-w-0 overflow-hidden rounded-lg border bg-background',
                      isFresh && 'border-primary/70',
                    )}
                  >
                    <BadgeCardHeader record={record} versionInfo={versionInfo} />
                    <div className="flex flex-col items-center gap-1 p-1.5">
                      <BleConnectionRow status={record.status} />
                      <BadgePrimaryVisual
                        emoji={record.emoji}
                        nfcCardMap={nfcCardMap}
                        pairName={record.status?.pairName}
                        activeGame={activeGame}
                        joinsByPair={joinsByPair}
                        answerByPair={answerByPair}
                        questionPhase={questionPhase}
                        resultsByPair={resultsByPair}
                        winnerPairNames={winnerPairNames}
                      />
                      <BadgeCardGameSection
                        pairName={record.status?.pairName}
                        activeGame={activeGame}
                        joinsByPair={joinsByPair}
                        nfcByPair={nfcByPair}
                        answerByPair={answerByPair}
                        questionPhase={questionPhase}
                        resultsByPair={resultsByPair}
                        winnerPairNames={winnerPairNames}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      )}
    </div>
  );
};
