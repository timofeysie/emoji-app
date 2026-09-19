import { useEffect, useMemo, useRef, useState } from "react";
import { frameChainsAt, frameGridAt, frameHeadHistoryAt, type ReplayLog } from "./replayLog";
import { chainPositions, CHAIN_TRAIL_ALPHA } from "./chainTrail";
import { TICK_MS } from "./simulation";

export const SPEED_OPTIONS = [0.5, 1, 2, 4];

/** How long playback holds on the final frame before `onEnded` fires. */
const END_HOLD_MS = 3000;

/** Margin (in board cells) kept around every close-up player's head/trail. */
const CLOSEUP_PADDING = 4;
/** Close-up window never shrinks tighter than this, even nose-to-nose. */
const CLOSEUP_MIN_ROWS = 10;
const CLOSEUP_MIN_COLS = 14;
/** ...or grows past this — beyond this it's not a "close-up" any more. */
const CLOSEUP_MAX_ROWS = 22;
const CLOSEUP_MAX_COLS = 30;

interface CropRect {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

function fullBoardCrop(log: ReplayLog): CropRect {
  return { row: 0, col: 0, rows: log.rowCount, cols: log.colCount };
}

/**
 * A crop window sized to fit every still-alive player's head and current wake
 * from `fromIndex` through the last frame, plus a fixed padding margin — so
 * whichever players are left standing for the finish stay fully in frame for
 * every tick of the clip, rather than one drifting toward (or past) the edge.
 *
 * Deliberately ignores `cellChanges`: a capture's flood-fill can seize cells
 * far from where the boats actually were (an enclosed pocket clear across the
 * loop), which would drag — or blow out — the window away from the actual
 * fight. A trail is safe to include instead: it's laid immediately behind the
 * head, so it only ever extends the box along ground a tracked boat actually
 * covered.
 *
 * Sized (and clamped) once for the whole clip rather than re-centered per
 * frame — this is a fixed shot of the finish, not a camera that tracks motion.
 */
function computeCloseUpCrop(log: ReplayLog, fromIndex: number): CropRect {
  const lastIndex = log.frames.length - 1;
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  const touch = (row: number, col: number) => {
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  };

  for (let i = Math.max(0, Math.min(fromIndex, lastIndex)); i <= lastIndex; i++) {
    for (const player of Object.values(log.frames[i].players)) {
      if (!player.alive) continue;
      touch(player.head.row, player.head.col);
      for (const cell of player.trail) touch(cell.row, cell.col);
    }
  }

  if (!Number.isFinite(minRow)) {
    minRow = maxRow = Math.floor(log.rowCount / 2);
    minCol = maxCol = Math.floor(log.colCount / 2);
  }

  const centerRow = Math.round((minRow + maxRow) / 2);
  const centerCol = Math.round((minCol + maxCol) / 2);
  const rows = Math.min(
    log.rowCount,
    Math.max(CLOSEUP_MIN_ROWS, Math.min(CLOSEUP_MAX_ROWS, maxRow - minRow + 1 + CLOSEUP_PADDING * 2)),
  );
  const cols = Math.min(
    log.colCount,
    Math.max(CLOSEUP_MIN_COLS, Math.min(CLOSEUP_MAX_COLS, maxCol - minCol + 1 + CLOSEUP_PADDING * 2)),
  );
  return {
    row: Math.max(0, Math.min(log.rowCount - rows, centerRow - Math.floor(rows / 2))),
    col: Math.max(0, Math.min(log.colCount - cols, centerCol - Math.floor(cols / 2))),
    rows,
    cols,
  };
}

const BTN_PRIMARY =
  "px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity";
const BTN_SECONDARY =
  "px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed";

function rgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * Redraw `crop` (a window onto the board, in cells) at `index` — mirrors
 * `LandGrabScene.draw()`, minus Phaser. Anything outside `crop` is simply never
 * visited, so a close-up costs no more than the area it actually shows.
 */
function drawFrame(canvas: HTMLCanvasElement, log: ReplayLog, index: number, cell: number, crop: CropRect): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const grid = frameGridAt(log, index);
  const frame = log.frames[Math.max(0, Math.min(index, log.frames.length - 1))];
  const width = crop.cols * cell;
  const height = crop.rows * cell;
  // True when board cell (row, col) falls inside the crop window.
  const inCrop = (row: number, col: number) =>
    row >= crop.row && row < crop.row + crop.rows && col >= crop.col && col < crop.col + crop.cols;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);

  for (let row = crop.row; row < crop.row + crop.rows; row++) {
    for (let col = crop.col; col < crop.col + crop.cols; col++) {
      const state = grid[row][col];
      if (state.kind === "neutral") continue;
      const color = log.playerMeta[state.playerId]?.color ?? 0xffffff;
      ctx.fillStyle = rgba(color, state.kind === "territory" ? 0.9 : 0.4);
      ctx.fillRect((col - crop.col) * cell, (row - crop.row) * cell, cell, cell);
    }
  }

  // Display-only: the trailing chain of previously-captured avatars, replayed
  // the same way the live game builds it — see `chainTrail.ts`.
  const chains = frameChainsAt(log, index);
  const headHistory = frameHeadHistoryAt(log, index);
  for (const id of log.playerOrder) {
    const player = frame.players[id];
    const chain = chains[id];
    if (!player || !player.alive || !chain || chain.length === 0) continue;
    const positions = chainPositions(headHistory[id] ?? [], chain.length);
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      if (!inCrop(pos.row, pos.col)) continue;
      const capturedColor = log.playerMeta[chain[i]]?.color ?? log.playerMeta[id]?.color ?? 0xffffff;
      const cx = (pos.col - crop.col) * cell + cell / 2;
      const cy = (pos.row - crop.row) * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = rgba(capturedColor, CHAIN_TRAIL_ALPHA);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(0xffffff, CHAIN_TRAIL_ALPHA);
      ctx.stroke();
    }
  }

  for (const id of log.playerOrder) {
    const player = frame.players[id];
    if (!player || !player.alive || !inCrop(player.head.row, player.head.col)) continue;
    const color = log.playerMeta[id]?.color ?? 0xffffff;
    const cx = (player.head.col - crop.col) * cell + cell / 2;
    const cy = (player.head.row - crop.row) * cell + cell / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = hex(color);
    ctx.stroke();
  }
}

export interface LandGrabReplayProps {
  log: ReplayLog;
  /** Pixel size of one cell; defaults to a fit sized off the visible crop. */
  cellSize?: number;
  /** Start playing immediately, rather than resting paused on the last frame. */
  autoPlay?: boolean;
  /** Frame to start `autoPlay` from. Defaults to 0 (the opening frame). */
  startIndex?: number;
  /**
   * Crop to a `CLOSEUP_ROWS`×`CLOSEUP_COLS` window centered on the action from
   * `startIndex` onward, at a bigger cell size, instead of showing the whole
   * board shrunk to fit. Meant for the short highlight clip at game over —
   * especially on a "large map" board, where the endgame is a small corner of a
   * much bigger world.
   */
  closeUp?: boolean;
  /** Playback speed to start `autoPlay` at — one of `SPEED_OPTIONS`. Defaults to 2×. */
  initialSpeed?: number;
  /** Fired once when playback reaches the final frame (only while actually playing). */
  onEnded?: () => void;
  onClose?: () => void;
  /** Overrides the default card wrapper — pass `""` to drop it (e.g. inside a modal). */
  className?: string;
}

/**
 * Scrub / play back a recorded match. Pure viewer over a `ReplayLog` — it never
 * touches the live simulation, so it's safe to mount while a fresh match runs.
 */
export function LandGrabReplay({
  log,
  cellSize,
  autoPlay,
  startIndex,
  closeUp,
  initialSpeed,
  onEnded,
  onClose,
  className,
}: LandGrabReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCount = log.frames.length;

  const [index, setIndex] = useState(autoPlay ? (startIndex ?? 0) : frameCount - 1);
  const [playing, setPlaying] = useState(!!autoPlay);
  const [speed, setSpeed] = useState(initialSpeed ?? 2);
  // Fires `onEnded` at most once per log.
  const endedRef = useRef(false);

  // Fixed for the whole mount — see `computeCloseUpCrop`'s "fixed shot, not a
  // tracking camera" note.
  const crop = useMemo(
    () => (closeUp ? computeCloseUpCrop(log, startIndex ?? 0) : fullBoardCrop(log)),
    [log, closeUp, startIndex],
  );
  const cell =
    cellSize ??
    Math.max(6, Math.min(closeUp ? 32 : 22, Math.floor((closeUp ? 480 : 520) / Math.max(1, crop.cols))));

  // A new log (next finished match) resets playback per `autoPlay`/`startIndex`/`initialSpeed`.
  useEffect(() => {
    setIndex(autoPlay ? (startIndex ?? 0) : log.frames.length - 1);
    setPlaying(!!autoPlay);
    setSpeed(initialSpeed ?? 2);
    endedRef.current = false;
  }, [log, autoPlay, startIndex, initialSpeed]);

  useEffect(() => {
    if (canvasRef.current) drawFrame(canvasRef.current, log, index, cell, crop);
  }, [log, index, cell, crop]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setIndex((i) => Math.min(i + 1, frameCount - 1));
    }, TICK_MS / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, frameCount]);

  const clampedIndex = Math.max(0, Math.min(index, frameCount - 1));

  // Stop advancing once playback reaches the end. Split from the hold/announce
  // effect below: this one flips `playing`, so it must not also own the hold
  // timer — a single effect that both set `playing` and started the timeout
  // would re-run on its own `playing` change and cancel the timeout it just set.
  useEffect(() => {
    if (playing && clampedIndex >= frameCount - 1) setPlaying(false);
  }, [playing, clampedIndex, frameCount]);

  // Hold on the final frame for a beat so it actually reads, then announce it
  // once. Scrubbing/stepping away during the hold cancels the pending
  // announcement (the effect cleanup clears the timer).
  useEffect(() => {
    if (clampedIndex < frameCount - 1 || endedRef.current) return;
    endedRef.current = true;
    const timer = window.setTimeout(() => onEnded?.(), END_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [clampedIndex, frameCount, onEnded]);
  const frame = log.frames[clampedIndex];
  const width = crop.cols * cell;
  const height = crop.rows * cell;

  const step = (delta: number) => {
    setPlaying(false);
    setIndex((i) => Math.max(0, Math.min(frameCount - 1, i + delta)));
  };

  return (
    <div
      className={className ?? "rounded-lg border border-border bg-card/40 p-4"}
      data-testid="landgrab-replay"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground">Replay</h3>
        <p className="text-xs text-muted-foreground">
          {frameCount} frame{frameCount === 1 ? "" : "s"}
          {log.truncated && " · capped, later ticks not recorded"} · in-memory only, replaced when the
          next match ends
        </p>
        {onClose && (
          <button onClick={onClose} className={BTN_SECONDARY + " ml-auto !px-2.5 !py-1 !text-xs"}>
            Close
          </button>
        )}
      </div>

      <div
        className="w-full [&>canvas]:block [&>canvas]:h-auto [&>canvas]:max-w-full"
        style={{ maxWidth: width }}
      >
        <canvas ref={canvasRef} width={width} height={height} className="rounded-md border border-border" />
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button onClick={() => setPlaying((p) => !p)} className={BTN_PRIMARY}>
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => step(-1)} disabled={clampedIndex === 0} className={BTN_SECONDARY}>
          ◀ Step
        </button>
        <button
          onClick={() => step(1)}
          disabled={clampedIndex >= frameCount - 1}
          className={BTN_SECONDARY}
        >
          Step ▶
        </button>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Speed
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground tabular-nums ml-auto">
          tick {frame.tick} · frame {clampedIndex + 1}/{frameCount}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, frameCount - 1)}
        value={clampedIndex}
        onChange={(e) => {
          setPlaying(false);
          setIndex(Number(e.target.value));
        }}
        className="w-full mt-2 accent-primary"
        aria-label="Replay frame"
      />

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {log.playerOrder.map((id) => {
          const player = frame.players[id];
          const meta = log.playerMeta[id];
          if (!player || !meta) return null;
          return (
            <li key={id} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full inline-block shrink-0"
                style={{ backgroundColor: hex(meta.color) }}
              />
              <span className="text-foreground font-medium truncate">{meta.label}</span>
              <span className="text-muted-foreground tabular-nums ml-auto">{player.ownedCount}</span>
              <span className="text-muted-foreground text-xs w-12 text-right">
                {player.alive ? player.facing : "sunk"}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Always rendered (visibility toggled, not the element itself) so this
          line reaching the deciding frame doesn't change the card's height —
          which would otherwise jump the whole modal right as it lands. */}
      <p className={`mt-2 text-xs text-muted-foreground ${frame.winnerId ? "" : "invisible"}`}>
        Decided on this frame — winner:{" "}
        {frame.winnerId ? log.playerMeta[frame.winnerId]?.label ?? frame.winnerId : "—"}
      </p>
    </div>
  );
}
