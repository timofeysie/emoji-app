import { TICK_MS, type GameRules, type GameState } from "./simulation";
import type { BotProfile } from "./botProfile";
import { computeTotalScore } from "./score";

/**
 * A finished match, frozen into a plain JSON-serialisable object. There's no
 * backend yet, so `saveGameRecord` just appends this to a capped list in
 * `localStorage`; swapping in a real API later only means replacing the two
 * storage helpers.
 */
export interface LandGrabGameRecord {
  /** Bump if the shape below changes so old rows can be filtered out on read. */
  schemaVersion: 4;
  /** ISO-8601, when the match was recorded. */
  endedAt: string;
  winner: LandGrabPlayerRecord;
  players: LandGrabPlayerRecord[];
  /** Ticks elapsed from the initial board to the deciding move. */
  ticks: number;
  /** `ticks * TICK_MS` — simulated match length, not wall-clock time. */
  durationMs: number;
  board: { rows: number; cols: number; totalCells: number };
  rules: GameRules;
}

export interface LandGrabPlayerRecord {
  id: string;
  label: string;
  /** `#rrggbb`. */
  color: string;
  isBot: boolean;
  autopilot: boolean;
  ownedCount: number;
  /** Share of the board this player held at the end, 0..1. */
  ownedFraction: number;
  /** The most cells this player held at any point in the match — their high-water mark. */
  peakOwnedCount: number;
  /** `peakOwnedCount / totalCells`, 0..1. */
  peakOwnedFraction: number;
  /** Rival trails this player cut (each seizing that player's land). */
  captures: number;
  /** Times a rival cut this player's trail and sank them — counted win or lose. */
  timesCaptured: number;
  /**
   * `ownedCount` cells plus a weighted bonus per rival *currently* trailing
   * this player in their captured-avatar chain (`chainTrail.ts`) — see
   * {@link computeTotalScore}. Deliberately based on that chain length, not
   * the lifetime `captures` counter above: it resets to `0` the instant this
   * player is themself captured, so score rewards an active capture streak,
   * not a running lifetime tally. `0` if the match ended before
   * `buildGameRecord` was given a chain-lengths snapshot.
   */
  score: number;
  /**
   * Most captured avatars this player had trailing them at once — their
   * high-water mark on the display-only chain (`chainTrail.ts`). Resets to 0
   * on death, so this is a streak record, not a running total; `0` if the
   * match ended before `buildGameRecord` was given a chain-peaks snapshot.
   */
  peakChainLength: number;
  alive: boolean;
  /** The decision parameters this player was running when the match ended. */
  profile: BotProfile;
}

export const GAME_RECORDS_STORAGE_KEY = "landgrab:game-records";
export const MAX_STORED_GAME_RECORDS = 50;

function hexColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function toPlayerRecord(
  player: GameState["players"][string],
  totalCells: number,
  playerCount: number,
  peakChainLength: number,
  chainLength: number,
): LandGrabPlayerRecord {
  return {
    id: player.id,
    label: player.label,
    color: hexColor(player.color),
    isBot: player.isBot,
    autopilot: player.autopilot,
    ownedCount: player.ownedCount,
    ownedFraction: totalCells > 0 ? player.ownedCount / totalCells : 0,
    peakOwnedCount: player.peakOwnedCount,
    peakOwnedFraction: totalCells > 0 ? player.peakOwnedCount / totalCells : 0,
    captures: player.captures,
    timesCaptured: player.timesCaptured,
    score: computeTotalScore(player.ownedCount, chainLength, totalCells, playerCount),
    peakChainLength,
    alive: player.alive,
    profile: { ...player.profile },
  };
}

export interface BuildGameRecordOptions {
  endedAt?: Date;
  /**
   * Each player's high-water mark on the display-only captured-avatar chain
   * (`chainTrail.ts`), keyed by player id — the live game and replay track
   * this outside `GameState`, so it has to be handed in explicitly. Missing
   * or omitted entries record as `0`.
   */
  chainPeaks?: Record<string, number>;
  /**
   * Each player's chain length at the moment the match ended — rivals
   * currently trailing them (`chainTrail.ts`), keyed by player id. Unlike
   * `chainPeaks`, this resets to `0` the instant a player is themself
   * captured, which is exactly what `score` is meant to weight. Missing or
   * omitted entries record as `0`.
   */
  chainLengths?: Record<string, number>;
}

/**
 * Turn a decided `GameState` (its `winnerId` set) into a storable record.
 * Throws if the match isn't actually over, so callers can't record a draw.
 */
export function buildGameRecord(state: GameState, options: BuildGameRecordOptions = {}): LandGrabGameRecord {
  const { endedAt = new Date(), chainPeaks = {}, chainLengths = {} } = options;
  const winner = state.winnerId ? state.players[state.winnerId] : undefined;
  if (!winner) throw new Error("buildGameRecord: game state has no winner yet");

  const totalCells = state.rowCount * state.colCount;
  const playerCount = state.playerOrder.length;
  const players = state.playerOrder
    .map((id) => state.players[id])
    .filter(Boolean)
    .map((player) =>
      toPlayerRecord(player, totalCells, playerCount, chainPeaks[player.id] ?? 0, chainLengths[player.id] ?? 0),
    );

  return {
    schemaVersion: 4,
    endedAt: endedAt.toISOString(),
    winner: toPlayerRecord(
      winner,
      totalCells,
      playerCount,
      chainPeaks[winner.id] ?? 0,
      chainLengths[winner.id] ?? 0,
    ),
    players,
    ticks: state.tick,
    durationMs: state.tick * TICK_MS,
    board: { rows: state.rowCount, cols: state.colCount, totalCells },
    rules: { ...state.rules },
  };
}

/** All stored records, newest first. Returns `[]` if storage is unavailable or corrupt. */
export function loadGameRecords(): LandGrabGameRecord[] {
  try {
    const raw = window.localStorage.getItem(GAME_RECORDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is LandGrabGameRecord => row?.schemaVersion === 4);
  } catch {
    return [];
  }
}

/** Prepend `record` to the stored list, cap it, and persist. Silently no-ops if storage is unavailable. */
export function saveGameRecord(record: LandGrabGameRecord): LandGrabGameRecord[] {
  const next = [record, ...loadGameRecords()].slice(0, MAX_STORED_GAME_RECORDS);
  try {
    window.localStorage.setItem(GAME_RECORDS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-mode / quota / no-DOM — the match still ends, it just isn't logged.
  }
  return next;
}

/** Drop every stored record. Silently no-ops if storage is unavailable. */
export function clearGameRecords(): void {
  try {
    window.localStorage.removeItem(GAME_RECORDS_STORAGE_KEY);
  } catch {
    // Private-mode / no-DOM — nothing to clear.
  }
}
