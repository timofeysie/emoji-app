import type { CellState } from "./grid";
import type { CaptureEvent, GameState, PlayerState } from "./simulation";
import { applyCaptureEvents, appendHeadHistory, clearDeadChains, type ChainMap } from "./chainTrail";
import type { Direction, Vec2 } from "./types";

/**
 * An in-memory recording of one match, kept for post-game replay and for
 * debugging the capture / territory-split algorithm.
 *
 * This is deliberately *not* persisted: `gameRecord.ts` owns the small, capped
 * summary that goes to `localStorage`, and a full frame log is far too big for
 * that. A `ReplayLog` only lives as long as the tab that produced it.
 *
 * Frame 0 always carries a full grid snapshot; every later frame carries only
 * the cells that changed since the frame before it, so a long match on a big
 * board still comes to a few MB at most. `frameGridAt` rebuilds any frame's
 * full grid by replaying the deltas from frame 0 forward.
 *
 * The log holds at most `MAX_REPLAY_TICKS` frames. Once a match runs longer
 * than that, `recordFrame` starts dropping the oldest frame for every new one
 * it records — a ring buffer, not a hard stop — so the log always ends at the
 * current tick and a replay can always show how the match actually finished.
 * Dropping the oldest frame re-bases whichever frame becomes the new frame 0
 * with a full grid snapshot (via `leadingGrid`) and folds its capture events
 * into `leadingChains`, so `frameGridAt` / `frameChainsAt` keep working over
 * whatever window is currently retained.
 */

/** Per-player state captured at the end of one tick — the debugging payload. */
export interface ReplayPlayerFrame {
  head: Vec2;
  /** The direction actually applied this tick. */
  facing: Direction;
  /** Live wake cells, in the order they were laid. */
  trail: Vec2[];
  alive: boolean;
  ownedCount: number;
  /** Tick this player becomes eligible to respawn, or `null` if alive / not waiting. */
  respawnAt: number | null;
}

export interface ReplayCellChange {
  row: number;
  col: number;
  cell: CellState;
}

export interface ReplayFrame {
  tick: number;
  /** Cells that differ from the previous frame. Frame 0 lists every cell. */
  cellChanges: ReplayCellChange[];
  players: Record<string, ReplayPlayerFrame>;
  /** The winner id once the match is decided on this frame, else `null`. */
  winnerId: string | null;
  /** Eliminations on this tick — empty on most frames. Display-only, see `CaptureEvent`. */
  captureEvents: CaptureEvent[];
}

/** Static, once-per-match display info so the replay renderer needs no live state. */
export interface ReplayPlayerMeta {
  label: string;
  /** Packed `0xRRGGBB`, same as `PlayerState.color`. */
  color: number;
  isBot: boolean;
}

export interface ReplayLog {
  rowCount: number;
  colCount: number;
  playerOrder: string[];
  playerMeta: Record<string, ReplayPlayerMeta>;
  frames: ReplayFrame[];
  /** True once the match has run past `MAX_REPLAY_TICKS` and the oldest frames
   * have started being dropped — `frames[0]` is no longer tick 0. */
  truncated: boolean;
  /**
   * Running reconstruction of the *latest* recorded frame's grid (the trailing
   * edge), used only while recording to diff the next tick against. Rebuildable
   * from `frames` via `frameGridAt`, so it can be dropped before serialising.
   */
  runningGrid: CellState[][];
  /**
   * Running reconstruction of `frames[0]`'s grid (the leading edge). Tracked
   * so that when the oldest frame is dropped, the frame taking its place can be
   * re-based to a full snapshot in O(board size) rather than replaying the
   * whole log from a (now-gone) tick 0.
   */
  leadingGrid: CellState[][];
  /** Chain state as of just before `frames[0]` — the seed `frameChainsAt` starts from. */
  leadingChains: ChainMap;
}

/**
 * How many of the most recent ticks the log keeps. A match almost always ends
 * well under this, so it's rarely relevant — but once a long-running match
 * passes it, `recordFrame` drops the oldest frame for every new one recorded,
 * keeping the log a fixed-size window that always reaches the current tick.
 * That's what guarantees a replay can always show the actual finish, no matter
 * how long the match ran before it was decided.
 */
export const MAX_REPLAY_TICKS = 3000;

function cloneCell(cell: CellState): CellState {
  return cell.kind === "neutral"
    ? { kind: "neutral" }
    : { kind: cell.kind, playerId: cell.playerId };
}

function sameCell(a: CellState, b: CellState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== "neutral" && b.kind !== "neutral") return a.playerId === b.playerId;
  return true;
}

function playerFrame(player: PlayerState): ReplayPlayerFrame {
  return {
    head: { ...player.head },
    facing: player.facing,
    trail: player.trail.map((cell) => ({ ...cell })),
    alive: player.alive,
    ownedCount: player.ownedCount,
    respawnAt: player.respawnAt,
  };
}

function playersFrame(state: GameState): Record<string, ReplayPlayerFrame> {
  const out: Record<string, ReplayPlayerFrame> = {};
  for (const id of state.playerOrder) {
    const player = state.players[id];
    if (player) out[id] = playerFrame(player);
  }
  return out;
}

/** Start a fresh log from the opening state and record frame 0 (the whole grid). */
export function createReplayLog(state: GameState): ReplayLog {
  const runningGrid = state.grid.map((row) => row.map(cloneCell));
  const leadingGrid = state.grid.map((row) => row.map(cloneCell));
  const cellChanges: ReplayCellChange[] = [];
  for (let row = 0; row < state.rowCount; row++) {
    for (let col = 0; col < state.colCount; col++) {
      cellChanges.push({ row, col, cell: cloneCell(state.grid[row][col]) });
    }
  }

  const playerMeta: Record<string, ReplayPlayerMeta> = {};
  for (const id of state.playerOrder) {
    const player = state.players[id];
    if (player) {
      playerMeta[id] = { label: player.label, color: player.color, isBot: player.isBot };
    }
  }

  return {
    rowCount: state.rowCount,
    colCount: state.colCount,
    playerOrder: [...state.playerOrder],
    playerMeta,
    frames: [
      {
        tick: state.tick,
        cellChanges,
        players: playersFrame(state),
        winnerId: state.winnerId,
        captureEvents: [], // no captures on the opening frame
      },
    ],
    truncated: false,
    runningGrid,
    leadingGrid,
    leadingChains: {},
  };
}

/** Fold one frame's capture events into a chain map — shared by `frameChainsAt`'s replay and eviction's advance. */
function stepChains(chains: ChainMap, frame: ReplayFrame): ChainMap {
  const next = applyCaptureEvents(chains, frame.captureEvents);
  const aliveIds = new Set(Object.keys(frame.players).filter((id) => frame.players[id].alive));
  return clearDeadChains(next, aliveIds);
}

/**
 * Drop `frames[0]` and re-base the frame taking its place (formerly
 * `frames[1]`) so `frameGridAt`'s invariant — frame 0 is always a full grid
 * snapshot — keeps holding once the true tick-0 frame is gone. `leadingGrid`
 * already holds `frames[0]`'s grid, so advancing it past the dropped frame and
 * dumping every cell is O(board size), not a replay from history.
 * `leadingChains` advances the same way so `frameChainsAt` doesn't lose chains
 * that formed before the retained window.
 */
function evictOldestFrame(log: ReplayLog): void {
  const dropped = log.frames[0];
  const newBase = log.frames[1];

  log.leadingChains = stepChains(log.leadingChains, dropped);

  for (const change of newBase.cellChanges) {
    log.leadingGrid[change.row][change.col] = cloneCell(change.cell);
  }
  const fullDump: ReplayCellChange[] = [];
  for (let row = 0; row < log.rowCount; row++) {
    for (let col = 0; col < log.colCount; col++) {
      fullDump.push({ row, col, cell: cloneCell(log.leadingGrid[row][col]) });
    }
  }
  newBase.cellChanges = fullDump;

  log.frames.shift();
}

/**
 * Append one post-tick frame, then drop the oldest one if that pushed the log
 * past `MAX_REPLAY_TICKS` — see the ring-buffer note on `ReplayLog`. A no-op
 * when the incoming state isn't newer than the last frame (guards a double
 * call for the same tick — e.g. the frozen state re-delivered every tick after
 * game over).
 */
export function recordFrame(log: ReplayLog, state: GameState): void {
  const lastFrame = log.frames[log.frames.length - 1];
  if (state.tick <= lastFrame.tick) return;

  const cellChanges: ReplayCellChange[] = [];
  for (let row = 0; row < log.rowCount; row++) {
    for (let col = 0; col < log.colCount; col++) {
      const next = state.grid[row][col];
      if (!sameCell(next, log.runningGrid[row][col])) {
        const clone = cloneCell(next);
        cellChanges.push({ row, col, cell: clone });
        log.runningGrid[row][col] = clone;
      }
    }
  }

  log.frames.push({
    tick: state.tick,
    cellChanges,
    players: playersFrame(state),
    winnerId: state.winnerId,
    captureEvents: state.captureEvents,
  });

  if (log.frames.length > MAX_REPLAY_TICKS) {
    log.truncated = true;
    evictOldestFrame(log);
  }
}

/** Rebuild the full grid shown at frame `index` (clamped into range). */
export function frameGridAt(log: ReplayLog, index: number): CellState[][] {
  const target = Math.max(0, Math.min(index, log.frames.length - 1));
  const grid: CellState[][] = Array.from({ length: log.rowCount }, () =>
    Array.from({ length: log.colCount }, (): CellState => ({ kind: "neutral" })),
  );
  for (let i = 0; i <= target; i++) {
    for (const change of log.frames[i].cellChanges) {
      grid[change.row][change.col] = cloneCell(change.cell);
    }
  }
  return grid;
}

/**
 * Rebuild the captured-avatar chain map as of frame `index` (clamped into
 * range) by starting from `leadingChains` — chain state as of just before
 * `frames[0]`, `{}` unless old frames have been dropped — and replaying every
 * frame's `captureEvents` from there forward. Mirrors `frameGridAt`.
 * Display-only, same as the live game's chain.
 */
export function frameChainsAt(log: ReplayLog, index: number): ChainMap {
  const target = Math.max(0, Math.min(index, log.frames.length - 1));
  let chains: ChainMap = { ...log.leadingChains };
  for (let i = 0; i <= target; i++) {
    chains = stepChains(chains, log.frames[i]);
  }
  return chains;
}

/**
 * Rebuild each player's head-position history from frame 0 through `index`
 * (clamped into range) — the path `chainPositions` places trailing avatars
 * along. Mirrors the live game's per-tick `appendHeadHistory` calls, reset
 * whenever a player is dead on a frame.
 */
export function frameHeadHistoryAt(log: ReplayLog, index: number): Record<string, Vec2[]> {
  const target = Math.max(0, Math.min(index, log.frames.length - 1));
  const history: Record<string, Vec2[]> = {};
  for (let i = 0; i <= target; i++) {
    const frame = log.frames[i];
    for (const id of log.playerOrder) {
      const player = frame.players[id];
      if (!player) continue;
      if (!player.alive) {
        history[id] = [];
        continue;
      }
      history[id] = appendHeadHistory(history[id] ?? [], player.head);
    }
  }
  return history;
}
