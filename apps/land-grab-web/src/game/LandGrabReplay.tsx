import { useEffect, useRef, useState } from "react";
import { frameChainsAt, frameGridAt, frameHeadHistoryAt, type ReplayLog } from "@emoji-app/land-grab-core";
import { chainPositions, CHAIN_TRAIL_ALPHA } from "@emoji-app/land-grab-core";
import { TICK_MS } from "@emoji-app/land-grab-core";

/** How long playback holds on the final frame before `onEnded` fires. */
const END_HOLD_MS = 3000;
const REPLAY_CELL_SIZE = 4;
const REPLAY_SPEED = 1;

function rgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** Redraw the complete board at `index` — mirrors `LandGrabScene.draw()`, minus Phaser. */
function drawFrame(canvas: HTMLCanvasElement, log: ReplayLog, index: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const grid = frameGridAt(log, index);
  const frame = log.frames[Math.max(0, Math.min(index, log.frames.length - 1))];
  const cell = REPLAY_CELL_SIZE;
  const width = log.colCount * cell;
  const height = log.rowCount * cell;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);

  for (let row = 0; row < log.rowCount; row++) {
    for (let col = 0; col < log.colCount; col++) {
      const state = grid[row][col];
      if (state.kind === "neutral") continue;
      const color = log.playerMeta[state.playerId]?.color ?? 0xffffff;
      ctx.fillStyle = rgba(color, state.kind === "territory" ? 0.9 : 0.4);
      ctx.fillRect(col * cell, row * cell, cell, cell);
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
      const capturedColor = log.playerMeta[chain[i]]?.color ?? log.playerMeta[id]?.color ?? 0xffffff;
      const cx = pos.col * cell + cell / 2;
      const cy = pos.row * cell + cell / 2;
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
    if (!player || !player.alive) continue;
    const color = log.playerMeta[id]?.color ?? 0xffffff;
    const cx = player.head.col * cell + cell / 2;
    const cy = player.head.row * cell + cell / 2;
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
  /** Start playing immediately, rather than resting paused on the last frame. */
  autoPlay?: boolean;
  /** Frame to start `autoPlay` from. Defaults to 0 (the opening frame). */
  startIndex?: number;
  /** Fired after auto-play reaches the final frame. */
  onEnded?: () => void;
  onClose: () => void;
}

export function LandGrabReplay({
  log,
  autoPlay,
  startIndex,
  onEnded,
  onClose,
}: LandGrabReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCount = log.frames.length;
  const [index, setIndex] = useState(autoPlay ? (startIndex ?? 0) : frameCount - 1);
  const [playing, setPlaying] = useState(!!autoPlay);
  const [completedPlayback, setCompletedPlayback] = useState(false);

  useEffect(() => {
    setIndex(autoPlay ? (startIndex ?? 0) : log.frames.length - 1);
    setPlaying(!!autoPlay);
    setCompletedPlayback(false);
  }, [log, autoPlay, startIndex]);

  useEffect(() => {
    if (canvasRef.current) drawFrame(canvasRef.current, log, index);
  }, [log, index]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setIndex((i) => Math.min(i + 1, frameCount - 1));
    }, TICK_MS / REPLAY_SPEED);
    return () => window.clearInterval(timer);
  }, [playing, frameCount]);

  const clampedIndex = Math.max(0, Math.min(index, frameCount - 1));

  useEffect(() => {
    if (!playing || clampedIndex < frameCount - 1) return;
    setPlaying(false);
    setCompletedPlayback(true);
  }, [playing, clampedIndex, frameCount]);

  useEffect(() => {
    if (!completedPlayback) return;
    const timer = window.setTimeout(() => onEnded?.(), END_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [completedPlayback, onEnded]);

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      setCompletedPlayback(false);
      return;
    }
    setCompletedPlayback(false);
    setIndex((current) => (current >= frameCount - 1 ? 0 : current));
    setPlaying(true);
  };

  return (
    <div className="replay-player" data-testid="landgrab-replay">
      <div className="replay-board">
        <canvas
          ref={canvasRef}
          width={log.colCount * REPLAY_CELL_SIZE}
          height={log.rowCount * REPLAY_CELL_SIZE}
          aria-label="Match replay board"
        />
      </div>

      <div className="replay-controls">
        <button
          type="button"
          onClick={togglePlayback}
          className="replay-control-button replay-toggle-button"
          aria-label={playing ? "Pause replay" : "Play replay"}
          title={playing ? "Pause" : "Play"}
        >
          <svg className="replay-control-icon" viewBox="0 0 24 24" aria-hidden="true">
            {playing ? (
              <>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </>
            ) : (
              <path d="M8 5.5v13l10-6.5z" />
            )}
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={clampedIndex}
          onChange={(event) => {
            setPlaying(false);
            setCompletedPlayback(false);
            setIndex(Number(event.target.value));
          }}
          className="replay-scrubber"
          aria-label="Scrub replay"
        />
        <button
          type="button"
          onClick={onClose}
          className="replay-control-button"
          aria-label="Close replay"
          title="Close"
        >
          <svg className="replay-control-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
