import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import Phaser from "phaser";
import {
  createInitialGameState,
  setPlayerFacing,
  stepGame,
  DEFAULT_GAME_RULES,
  TICK_MS,
  type GameRules,
  type GameState,
  type PlayerConfig,
  type PlayerState,
} from "./simulation";
import {
  applyCaptureEvents,
  appendHeadHistory,
  chainPositions,
  clearDeadChains,
  CHAIN_TRAIL_ALPHA,
  type ChainMap,
} from "./chainTrail";
import { cloneProfile, DEFAULT_BOT_PROFILE, type BotProfile } from "./botProfile";
import { createBotMemory, DEFAULT_BOT_TYPE, type BotType } from "./botStrategy";
import { BotProfilePanel } from "./BotProfilePanel";
import { MatchRecordsPanel } from "./MatchRecordsPanel";
import { buildGameRecord, saveGameRecord, type LandGrabGameRecord } from "./gameRecord";
import { computeTotalScore } from "./score";
import { createReplayLog, recordFrame, type ReplayLog } from "./replayLog";
import { LandGrabReplay, SPEED_OPTIONS as REPLAY_SPEED_OPTIONS } from "./LandGrabReplay";
import { loadUserProfile, resolveUsername, saveUserProfile } from "./userProfile";
import { AVATAR_SIZE, type AvatarGrid } from "./pixelAvatar";
import type { Direction } from "./types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import type { Vec2 } from "./types";

const CELL_SIZE = 22;
const DEFAULT_DIMS = { rows: 16, cols: 24, cell: CELL_SIZE };
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];
/** How many of the final ticks the auto-played, game-over highlight replay covers. */
const INTRO_REPLAY_TICKS = 10;

/** Minimum finger travel (CSS px) before a touch drag registers as a steering input — keeps taps and small jitter from turning the boat. */
const TOUCH_DRAG_THRESHOLD = 18;

/** How many times bigger the "large map" world is than the player's viewport, in each dimension. */
const LARGE_MAP_SCALE = 3;
const LARGE_MAP_MAX_COLS = 180;
const LARGE_MAP_MAX_ROWS = 120;
/** Longest edge of the lower-left overview map, in screen pixels. */
const MINIMAP_MAX_SIZE = 140;
const MINIMAP_MARGIN = 12;
/** Fixed on-screen radius for player/bot dots on the minimap, regardless of world size. */
const MINIMAP_MARKER_SCREEN_RADIUS = 4;

interface GridDims {
  rows: number;
  cols: number;
  cell: number;
}

type BoardMode = "demo" | "fullscreen" | "large";

/** Grow the board to fill the browser window while keeping the cell size constant. */
function computeFullScreenDims(): GridDims {
  const cell = CELL_SIZE;
  const gap = 16;
  const overlayPadding = 16 * 2; // matches the overlay's p-4
  const asideWidth = window.innerWidth >= 1400 ? 224 + gap : 0; // w-56 sidebar + gap
  const controlsHeight = 56; // Restart row under the board
  const availWidth = window.innerWidth - overlayPadding - asideWidth;
  const availHeight = window.innerHeight - overlayPadding - controlsHeight;
  return {
    cell,
    cols: Math.max(DEFAULT_DIMS.cols, Math.floor(availWidth / cell)),
    rows: Math.max(DEFAULT_DIMS.rows, Math.floor(availHeight / cell)),
  };
}

/**
 * A world several times bigger than the on-screen viewport, so the game plays like a
 * paper.io-style sliding window: the Phaser canvas stays viewport-sized and its camera
 * scrolls to follow the human player around the larger board.
 */
function computeLargeMapDims(): { world: GridDims; viewportCols: number; viewportRows: number } {
  const viewport = computeFullScreenDims();
  return {
    world: {
      cell: CELL_SIZE,
      cols: Math.min(LARGE_MAP_MAX_COLS, viewport.cols * LARGE_MAP_SCALE),
      rows: Math.min(LARGE_MAP_MAX_ROWS, viewport.rows * LARGE_MAP_SCALE),
    },
    viewportCols: viewport.cols,
    viewportRows: viewport.rows,
  };
}

const PLAYER_CONFIGS: PlayerConfig[] = [
  { id: "you", label: "You", color: 0x38bdf8, isBot: false },
  { id: "bot-red", label: "Red Invader", color: 0xf87171, isBot: true, botType: "invader" },
  { id: "bot-yellow", label: "Yellow Rambler", color: 0xfacc15, isBot: true, botType: "rambler" },
  { id: "bot-green", label: "Green Surveyor", color: 0x4ade80, isBot: true, botType: "surveyor" },
];

const HUMAN_ID = "you";
const AVATAR_TEXTURE_KEY = "land-grab-human-avatar";
/** Physical pixels per avatar cell in the baked texture — kept blocky/crisp rather than smoothed on scale-up. */
const AVATAR_TEXTURE_PIXEL_SIZE = 4;

function makeInitialProfiles(): Record<string, BotProfile> {
  return Object.fromEntries(PLAYER_CONFIGS.map((c) => [c.id, cloneProfile(DEFAULT_BOT_PROFILE)]));
}

function makeInitialAutopilot(): Record<string, boolean> {
  return Object.fromEntries(PLAYER_CONFIGS.map((c) => [c.id, false]));
}

function makeInitialBotTypes(): Record<string, BotType> {
  return Object.fromEntries(PLAYER_CONFIGS.map((c) => [c.id, c.botType ?? DEFAULT_BOT_TYPE]));
}

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

/** Mutable knobs the React layer owns and the Phaser tick loop reads each frame. */
interface SceneControl {
  paused: boolean;
  speed: number;
  /** Set by the Step button to let exactly one tick through while paused. */
  stepOnce: boolean;
}

interface SceneData {
  gameStateRef: { current: GameState };
  controlRef: { current: SceneControl };
  profilesRef: { current: Record<string, BotProfile> };
  autopilotRef: { current: Record<string, boolean> };
  botTypesRef: { current: Record<string, BotType> };
  rulesRef: { current: GameRules };
  /** The human's custom head-marker sprite, or `null` to draw the plain color circle. */
  avatarRef: { current: AvatarGrid | null };
  /**
   * `chainPeaks` is each player's high-water mark for the display-only captured-avatar
   * chain so far this match; `chainLengths` is that same chain's *current* length —
   * how many previously-captured rivals are trailing this player right now. It resets
   * to `0` the instant this player is themself captured (`chainTrail.ts`), unlike the
   * lifetime `captures` counter, which is what makes it the right input for scoring.
   */
  onTick: (state: GameState, chainPeaks: Record<string, number>, chainLengths: Record<string, number>) => void;
  cellSize: number;
  /** "Large map" mode: the board is bigger than the canvas, so the camera follows the human and a minimap is drawn. */
  isLargeMap: boolean;
}

class LandGrabScene extends Phaser.Scene {
  private gameStateRef!: SceneData["gameStateRef"];
  private controlRef!: SceneData["controlRef"];
  private profilesRef!: SceneData["profilesRef"];
  private autopilotRef!: SceneData["autopilotRef"];
  private botTypesRef!: SceneData["botTypesRef"];
  private rulesRef!: SceneData["rulesRef"];
  private avatarRef!: SceneData["avatarRef"];
  private onTick!: SceneData["onTick"];
  private cellSize = CELL_SIZE;
  private isLargeMap = false;
  private graphics!: Phaser.GameObjects.Graphics;
  private headMarkers: Phaser.GameObjects.GameObject[] = [];
  /** Serialized form of the avatar grid last baked into `AVATAR_TEXTURE_KEY`, so a same-avatar tick skips regenerating it. */
  private bakedAvatarSignature: string | null = null;
  private chainMarkers: Phaser.GameObjects.Arc[] = [];
  /** The lower-left overview camera in "large map" mode, `null` otherwise. */
  private minimapCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  /**
   * Invisible follow target for the main camera in large-map mode. Moved to the human's exact
   * head position once per tick; the camera itself lerps toward it every render frame (via
   * `startFollow`), which is what turns the once-per-160ms cell jump into a smooth glide.
   */
  private cameraTarget: Phaser.GameObjects.Zone | null = null;
  /** World units per minimap screen pixel — used to size the fixed-screen-size player dots. */
  private minimapZoom = 1;
  /** Player/bot dots drawn only for the minimap (the normal head markers are too small to read at that zoom). */
  private minimapMarkers: Phaser.GameObjects.Arc[] = [];
  /** Display-only: who's currently trailing whom, built from each tick's `captureEvents`. */
  private chains: ChainMap = {};
  /** Recent head positions per player, used to lay the trailing chain out along consecutive cells like a snake body. Reset on death. */
  private headHistory: Record<string, Vec2[]> = {};
  /** Each player's high-water mark for `chains[id].length` this match — handed to `buildGameRecord` at game over. */
  private chainPeaks: Record<string, number> = {};

  constructor() {
    super("land-grab");
  }

  init(data: SceneData) {
    this.gameStateRef = data.gameStateRef;
    this.controlRef = data.controlRef;
    this.profilesRef = data.profilesRef;
    this.autopilotRef = data.autopilotRef;
    this.botTypesRef = data.botTypesRef;
    this.rulesRef = data.rulesRef;
    this.avatarRef = data.avatarRef;
    this.onTick = data.onTick;
    this.cellSize = data.cellSize;
    this.isLargeMap = data.isLargeMap;
  }

  create() {
    this.graphics = this.add.graphics();
    if (this.isLargeMap) this.setupLargeMapCamera();
    this.draw();

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      // Phaser listens on window, so a keypress inside the Profiles panel lands
      // here too. Don't steer the boat (or swallow the key) when a form control
      // has focus — the panel's sliders need their own arrow-key handling.
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
      const direction = KEY_TO_DIRECTION[event.key];
      if (!direction) return;
      event.preventDefault();
      setPlayerFacing(this.gameStateRef.current, HUMAN_ID, direction);
    });

    this.time.addEvent({
      delay: TICK_MS,
      loop: true,
      callback: () => {
        const control = this.controlRef.current;
        this.time.timeScale = control.speed;
        if (control.paused && !control.stepOnce) return;
        control.stepOnce = false;

        const state = this.gameStateRef.current;
        // Push the React-owned knobs onto the live state before stepping.
        state.rules.respawnDelayTicks = this.rulesRef.current.respawnDelayTicks;
        for (const id of Object.keys(state.players)) {
          const player = state.players[id];
          const profile = this.profilesRef.current[id];
          if (profile) player.profile = profile;
          player.autopilot = !!this.autopilotRef.current[id];
          // Live archetype swap from the Profiles panel — rebuild the scratch bag
          // so the new strategy never reads the old one's memory shape.
          const nextType = this.botTypesRef.current[id];
          if (nextType && player.botType !== nextType) {
            player.botType = nextType;
            player.botMemory = createBotMemory(nextType);
          }
        }

        this.gameStateRef.current = stepGame(state);
        this.draw();
        const chainLengths = Object.fromEntries(
          Object.keys(this.gameStateRef.current.players).map((id) => [id, this.chains[id]?.length ?? 0]),
        );
        this.onTick(this.gameStateRef.current, this.chainPeaks, chainLengths);
      },
    });
  }

  /** Constrain the main camera to the board and add the lower-left overview camera. Runs once, before the first draw. */
  private setupLargeMapCamera() {
    const state = this.gameStateRef.current;
    const cell = this.cellSize;
    const worldWidth = state.colCount * cell;
    const worldHeight = state.rowCount * cell;

    const aspect = worldWidth / worldHeight;
    const mmWidth = aspect >= 1 ? MINIMAP_MAX_SIZE : Math.round(MINIMAP_MAX_SIZE * aspect);
    const mmHeight = aspect >= 1 ? Math.round(MINIMAP_MAX_SIZE / aspect) : MINIMAP_MAX_SIZE;
    const x = MINIMAP_MARGIN;
    const y = this.scale.height - mmHeight - MINIMAP_MARGIN;

    // Pad the camera's scroll bounds out past the true world edge, on every side, by more
    // than the minimap's footprint. Phaser clamps the main camera to stay within its bounds,
    // so without this a player hugging (say) the bottom-left corner gets pinned flush against
    // the viewport's bottom-left corner too — exactly where the minimap overlay sits, hiding
    // them under it. The padded strip beyond the edge draws nothing (same background color as
    // the board, so it reads as more board, not a visible seam), which is what lets the camera
    // keep backing off and giving the player breathing room as they approach any edge.
    const edgePadding = Math.max(mmWidth, mmHeight) + MINIMAP_MARGIN * 2;
    this.cameras.main.setBounds(
      -edgePadding,
      -edgePadding,
      worldWidth + edgePadding * 2,
      worldHeight + edgePadding * 2,
    );

    this.minimapZoom = mmWidth / worldWidth;
    const minimap = this.cameras.add(x, y, mmWidth, mmHeight);
    minimap.setZoom(this.minimapZoom);
    minimap.centerOn(worldWidth / 2, worldHeight / 2);
    minimap.setBackgroundColor(0x0f172a);
    this.minimapCamera = minimap;

    // Outlines the world edge, in world space, so it sits right at the minimap's frame —
    // it also reads as the minimap panel's own border, since the minimap is zoomed to fit
    // the world exactly. Drawn only by the minimap camera: the minimap is added after the
    // main camera, so it renders on top and a screen-space border under it (main camera,
    // scroll-factor 0) would just get painted over by the minimap's own background fill.
    const minimapBorderWidth = 2 / this.minimapZoom;
    const minimapInset = minimapBorderWidth / 2;
    const minimapBorder = this.add.graphics();
    minimapBorder.lineStyle(minimapBorderWidth, 0x64748b, 0.9);
    minimapBorder.strokeRect(
      minimapInset,
      minimapInset,
      worldWidth - minimapInset * 2,
      worldHeight - minimapInset * 2,
    );
    this.cameras.main.ignore(minimapBorder);

    // Same outline again in the main view — the camera bounds are padded past the true edge
    // (see `edgePadding` above) so a player near the edge can see blank space beyond it, and
    // without a line marking the actual boundary that blank strip just reads as more board.
    // Drawn only by the main camera; the minimap already has its own copy above.
    const fieldBorder = this.add.graphics();
    fieldBorder.lineStyle(2, 0x64748b, 0.9);
    fieldBorder.strokeRect(1, 1, worldWidth - 2, worldHeight - 2);
    minimap.ignore(fieldBorder);

    const human = state.players[HUMAN_ID];
    const startX = human ? human.head.col * cell + cell / 2 : worldWidth / 2;
    const startY = human ? human.head.row * cell + cell / 2 : worldHeight / 2;
    this.cameraTarget = this.add.zone(startX, startY, 1, 1);
    // Lerp toward the target every render frame instead of snapping to it once per tick —
    // that's what turns the once-per-160ms cell jump into a smooth glide.
    this.cameras.main.startFollow(this.cameraTarget, false, 0.12, 0.12);
  }

  /** (Re)bake `grid` into the shared avatar canvas texture, skipping the redraw when it's unchanged since last tick. */
  private ensureAvatarTexture(grid: AvatarGrid): string {
    const signature = grid.join(",");
    if (this.bakedAvatarSignature === signature && this.textures.exists(AVATAR_TEXTURE_KEY)) {
      return AVATAR_TEXTURE_KEY;
    }
    this.bakedAvatarSignature = signature;
    const side = AVATAR_SIZE * AVATAR_TEXTURE_PIXEL_SIZE;
    if (this.textures.exists(AVATAR_TEXTURE_KEY)) this.textures.remove(AVATAR_TEXTURE_KEY);
    const canvasTexture = this.textures.createCanvas(AVATAR_TEXTURE_KEY, side, side)!;
    const ctx = canvasTexture.getContext();
    for (let row = 0; row < AVATAR_SIZE; row++) {
      for (let col = 0; col < AVATAR_SIZE; col++) {
        const color = grid[row * AVATAR_SIZE + col];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(col * AVATAR_TEXTURE_PIXEL_SIZE, row * AVATAR_TEXTURE_PIXEL_SIZE, AVATAR_TEXTURE_PIXEL_SIZE, AVATAR_TEXTURE_PIXEL_SIZE);
      }
    }
    canvasTexture.refresh();
    return AVATAR_TEXTURE_KEY;
  }

  private draw() {
    const state = this.gameStateRef.current;
    const cell = this.cellSize;
    const width = state.colCount * cell;
    const height = state.rowCount * cell;
    const g = this.graphics;
    g.clear();

    if (this.isLargeMap && this.cameraTarget) {
      const human = state.players[HUMAN_ID];
      if (human) this.cameraTarget.setPosition(human.head.col * cell + cell / 2, human.head.row * cell + cell / 2);
    }

    g.fillStyle(0x0f172a, 1);
    g.fillRect(0, 0, width, height);

    // Cells are normally inset by 1px so a grid of gaps shows through; in large-map mode that
    // gap reads as a grid line across a whole territory, so fill edge-to-edge there instead.
    const cellInset = this.isLargeMap ? 0 : 1;
    for (let row = 0; row < state.rowCount; row++) {
      for (let col = 0; col < state.colCount; col++) {
        const cellState = state.grid[row][col];
        if (cellState.kind === "neutral") continue;
        const player = state.players[cellState.playerId];
        const color = player?.color ?? 0xffffff;
        g.fillStyle(color, cellState.kind === "territory" ? 0.9 : 0.4);
        g.fillRect(col * cell + cellInset, row * cell + cellInset, cell - cellInset * 2, cell - cellInset * 2);
      }
    }

    // Skipped in large-map mode: at that cell density the grid reads as noise, and this is
    // thousands of lineBetween calls per tick just to redraw a texture the player already saw.
    if (!this.isLargeMap) {
      g.lineStyle(1, 0x1e293b, 0.6);
      for (let col = 0; col <= state.colCount; col++) {
        g.lineBetween(col * cell, 0, col * cell, height);
      }
      for (let row = 0; row <= state.rowCount; row++) {
        g.lineBetween(0, row * cell, width, row * cell);
      }
    }

    // Display-only bookkeeping: fold this tick's eliminations into who's
    // trailing whom, then track each player's recent head positions so the
    // chain has somewhere to sit — consecutive cells right behind the head,
    // like a snake body. Dead players restart both from wherever they respawn.
    this.chains = applyCaptureEvents(this.chains, state.captureEvents);
    this.chains = clearDeadChains(
      this.chains,
      new Set(Object.values(state.players).filter((p) => p.alive).map((p) => p.id)),
    );
    for (const id of Object.keys(state.players)) {
      const length = this.chains[id]?.length ?? 0;
      if (length > (this.chainPeaks[id] ?? 0)) this.chainPeaks[id] = length;
    }
    for (const player of Object.values(state.players)) {
      if (!player.alive) {
        this.headHistory[player.id] = [];
        continue;
      }
      const chainLength = this.chains[player.id]?.length ?? 0;
      this.headHistory[player.id] = appendHeadHistory(this.headHistory[player.id] ?? [], player.head, chainLength + 1);
    }

    for (const marker of this.chainMarkers) marker.destroy();
    this.chainMarkers = [];
    for (const player of Object.values(state.players)) {
      if (!player.alive) continue;
      const chain = this.chains[player.id];
      if (!chain || chain.length === 0) continue;
      const positions = chainPositions(this.headHistory[player.id] ?? [], chain.length);
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const cx = pos.col * cell + cell / 2;
        const cy = pos.row * cell + cell / 2;
        const capturedColor = state.players[chain[i]]?.color ?? player.color;
        const marker = this.add.circle(cx, cy, cell * 0.22, capturedColor, CHAIN_TRAIL_ALPHA);
        marker.setStrokeStyle(1.5, 0xffffff, CHAIN_TRAIL_ALPHA);
        this.chainMarkers.push(marker);
      }
    }

    for (const marker of this.headMarkers) marker.destroy();
    this.headMarkers = [];
    const humanAvatar = this.avatarRef.current;
    for (const player of Object.values(state.players)) {
      if (!player.alive) continue;
      const cx = player.head.col * cell + cell / 2;
      const cy = player.head.row * cell + cell / 2;
      if (player.id === HUMAN_ID && humanAvatar) {
        const key = this.ensureAvatarTexture(humanAvatar);
        const sprite = this.add.image(cx, cy, key);
        sprite.setDisplaySize(cell * 0.9, cell * 0.9);
        this.headMarkers.push(sprite);
      } else {
        const marker = this.add.circle(cx, cy, cell * 0.28, 0xffffff);
        marker.setStrokeStyle(2, player.color);
        this.headMarkers.push(marker);
      }
    }

    for (const marker of this.minimapMarkers) marker.destroy();
    this.minimapMarkers = [];
    if (this.isLargeMap && this.minimapCamera) {
      const worldRadius = MINIMAP_MARKER_SCREEN_RADIUS / this.minimapZoom;
      for (const player of Object.values(state.players)) {
        if (!player.alive) continue;
        const cx = player.head.col * cell + cell / 2;
        const cy = player.head.row * cell + cell / 2;
        const marker = this.add.circle(cx, cy, worldRadius, player.color);
        marker.setStrokeStyle(Math.max(1, worldRadius * 0.25), 0xffffff, 0.9);
        this.cameras.main.ignore(marker);
        this.minimapMarkers.push(marker);
      }
    }
  }
}

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** `mm:ss` from a millisecond duration. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export interface LandGrabDemoProps {
  hideControls?: boolean;
}

export function LandGrabDemo({ hideControls }: LandGrabDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<GridDims>(DEFAULT_DIMS);
  const [boardMode, setBoardMode] = useState<BoardMode>("demo");
  // Canvas size in "large map" mode, where the board (`dims`) is bigger than what's on screen. `null` elsewhere.
  const [viewport, setViewport] = useState<{ cols: number; rows: number } | null>(null);

  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  // The game-over modal is showing the replay in place of the stats.
  const [replayInModal, setReplayInModal] = useState(false);
  // Frame the in-modal replay should auto-play from. Set to the last
  // `INTRO_REPLAY_TICKS` ticks as soon as a match ends; `null` means a
  // full-match rewatch (from tick 0, default speed) via the "Watch replay" button.
  const [introReplayIndex, setIntroReplayIndex] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<Record<string, BotProfile>>(makeInitialProfiles);
  const [autopilot, setAutopilot] = useState<Record<string, boolean>>(makeInitialAutopilot);
  const [botTypes, setBotTypes] = useState<Record<string, BotType>>(makeInitialBotTypes);
  const [rules, setRules] = useState<GameRules>({ ...DEFAULT_GAME_RULES });
  const [username, setUsername] = useState<string>(() => loadUserProfile().username);
  const [avatar, setAvatar] = useState<AvatarGrid | null>(() => loadUserProfile().avatar ?? null);

  const controlRef = useRef<SceneControl>({ paused: false, speed: 2, stepOnce: false });
  const profilesRef = useRef(profiles);
  const autopilotRef = useRef(autopilot);
  const botTypesRef = useRef(botTypes);
  const rulesRef = useRef(rules);
  const usernameRef = useRef(username);
  const avatarRef = useRef(avatar);

  /** The human's display name, trimmed and never empty. Bots keep their fixed labels. */
  const displayLabel = (player: Pick<PlayerState, "id" | "label">): string =>
    player.id === HUMAN_ID ? resolveUsername(username) : player.label;

  const buildConfigs = (): PlayerConfig[] =>
    PLAYER_CONFIGS.map((c) => ({
      ...c,
      label: c.id === HUMAN_ID ? resolveUsername(usernameRef.current) : c.label,
      profile: cloneProfile(profilesRef.current[c.id] ?? DEFAULT_BOT_PROFILE),
      autopilot: !!autopilotRef.current[c.id],
      botType: botTypesRef.current[c.id] ?? c.botType,
    }));

  const stateHolderRef = useRef<{ current: GameState }>({
    current: createInitialGameState(DEFAULT_DIMS.rows, DEFAULT_DIMS.cols, buildConfigs(), rulesRef.current),
  });
  const [players, setPlayers] = useState<Record<string, PlayerState>>(stateHolderRef.current.current.players);
  // Each player's *current* chain length — previously-captured rivals trailing them right
  // now (`chainTrail.ts`) — keyed by player id. Resets to 0 the instant that player is
  // themself captured, unlike `player.captures`; this is what scoring is based on.
  const [chainLengths, setChainLengths] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const [restartToken, setRestartToken] = useState(0);
  const [gameOver, setGameOver] = useState<LandGrabGameRecord | null>(null);
  // Frozen at game over for the replay viewer. Kept across restarts so the
  // Replay button stays useful — the next finished match overwrites it.
  const [replay, setReplay] = useState<ReplayLog | null>(null);
  // The live recording for the in-progress match; read/written only inside the
  // Phaser tick loop. `null` on the preview card (`hideControls`), which never records.
  const replayLogRef = useRef<ReplayLog | null>(null);
  // Guards the once-per-match record write from inside the Phaser tick loop.
  const recordedRef = useRef(false);
  // Read inside the tick loop; the preview card (hideControls) doesn't record or pop a dialog.
  const hideControlsRef = useRef(hideControls);
  hideControlsRef.current = hideControls;

  // In-progress touch drag used to steer on mobile. Re-anchored every time it fires a
  // direction change, so a single unlifted finger can chain turns (e.g. drag down, then
  // right, without leaving the screen) instead of only reading its start-to-now vector.
  const touchDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  /** touchstart-equivalent: arm steering for this finger. Mouse/pen pointers are left alone so desktop click/drag behavior is unaffected. */
  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || touchDragRef.current) return;
    touchDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** Once the finger has traveled past the threshold, turn the boat toward the dominant axis and re-anchor from here. */
  const handleBoardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = touchDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) < TOUCH_DRAG_THRESHOLD) return;
    const direction: Direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    // Mutates the live game state directly, same as the keyboard handler inside the Phaser
    // scene — both read/write `stateHolderRef.current.current`, which the tick loop owns.
    setPlayerFacing(stateHolderRef.current.current, HUMAN_ID, direction);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };

  const handleBoardPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (touchDragRef.current?.pointerId === event.pointerId) touchDragRef.current = null;
  };

  const restart = () => setRestartToken((n) => n + 1);

  /** Dismiss the game-over modal and reset its replay sub-state. */
  const closeGameOver = () => {
    setGameOver(null);
    setReplayInModal(false);
    setIntroReplayIndex(null);
  };

  // Fixed for the whole match — players don't leave the roster on death, only `alive` flips.
  const totalCells = dims.rows * dims.cols;
  const playerCount = Object.keys(players).length;
  const scoreFor = (player: Pick<PlayerState, "id" | "ownedCount">) =>
    computeTotalScore(player.ownedCount, chainLengths[player.id] ?? 0, totalCells, playerCount);
  const leaderboard = Object.values(players).sort((a, b) => scoreFor(b) - scoreFor(a));
  const humanScore = players[HUMAN_ID] ? scoreFor(players[HUMAN_ID]) : 0;

  useEffect(() => {
    controlRef.current.paused = paused;
  }, [paused]);
  useEffect(() => {
    controlRef.current.speed = speed;
  }, [speed]);
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);
  useEffect(() => {
    autopilotRef.current = autopilot;
  }, [autopilot]);
  useEffect(() => {
    botTypesRef.current = botTypes;
  }, [botTypes]);
  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);
  useEffect(() => {
    usernameRef.current = username;
    saveUserProfile({ schemaVersion: 1, username, avatar });
  }, [username, avatar]);
  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  // Space toggles pause, "." single-steps. Ignore while a control has focus so
  // the panel's sliders/buttons keep their own key handling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPaused((p) => !p);
      } else if (event.key === ".") {
        event.preventDefault();
        controlRef.current.stepOnce = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Switching board modes changes the cell count (and, for "large", the world/viewport
  // split), so the game restarts on a fresh board. Picking the already-active mode exits
  // back to the small demo board.
  const enterMode = (mode: BoardMode) => {
    const next = boardMode === mode ? "demo" : mode;
    setBoardMode(next);
    if (next === "demo") {
      setDims(DEFAULT_DIMS);
      setViewport(null);
    } else if (next === "fullscreen") {
      setDims(computeFullScreenDims());
      setViewport(null);
    } else {
      const { world, viewportCols, viewportRows } = computeLargeMapDims();
      setDims(world);
      setViewport({ cols: viewportCols, rows: viewportRows });
    }
  };

  useEffect(() => {
    if (boardMode === "demo") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBoardMode("demo");
        setDims(DEFAULT_DIMS);
        setViewport(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardMode]);

  // Windowed mode: once the stats view is showing (the auto-played highlight
  // replay has finished, or there was nothing to replay), auto-dismiss the
  // result modal and start a fresh match after 5s. Full screen (and large map)
  // keeps the modal up so the final board stays on screen until dismissed.
  // Suspended while a replay is playing in the modal — flipping `replayInModal`
  // back to `false` (via the replay's `onEnded`) is what starts this timer.
  useEffect(() => {
    if (hideControls || boardMode !== "demo" || gameOver === null || replayInModal) return;
    const timer = window.setTimeout(() => {
      closeGameOver();
      restart();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [gameOver, boardMode, hideControls, replayInModal]);

  useEffect(() => {
    if (!containerRef.current) return;

    stateHolderRef.current.current = createInitialGameState(dims.rows, dims.cols, buildConfigs(), rulesRef.current);
    setPlayers(stateHolderRef.current.current.players);
    setChainLengths({});
    setTick(0);
    setGameOver(null);
    setShowReplay(false);
    setReplayInModal(false);
    setIntroReplayIndex(null);
    replayLogRef.current = hideControlsRef.current
      ? null
      : createReplayLog(stateHolderRef.current.current);
    recordedRef.current = false;
    controlRef.current.paused = false;
    setPaused(false);

    const canvasCols = viewport?.cols ?? dims.cols;
    const canvasRows = viewport?.rows ?? dims.rows;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: canvasCols * dims.cell,
      height: canvasRows * dims.cell,
      parent: containerRef.current,
      backgroundColor: "#0f172a",
    });

    game.scene.add(
      "land-grab",
      LandGrabScene,
      true,
      {
        gameStateRef: stateHolderRef.current,
        controlRef,
        profilesRef,
        autopilotRef,
        botTypesRef,
        rulesRef,
        avatarRef,
        cellSize: dims.cell,
        isLargeMap: boardMode === "large",
        onTick: (state: GameState, chainPeaks: Record<string, number>, chainLengths: Record<string, number>) => {
          if (replayLogRef.current) recordFrame(replayLogRef.current, state);
          setPlayers({ ...state.players });
          setChainLengths(chainLengths);
          setTick(state.tick);
          if (!hideControlsRef.current && state.winnerId && !recordedRef.current) {
            recordedRef.current = true;
            const record = buildGameRecord(state, { chainPeaks, chainLengths });
            saveGameRecord(record);
            const log = replayLogRef.current;
            setReplay(log);
            setGameOver(record);
            // As soon as the match ends, auto-play the last few ticks so the
            // deciding move is visible before the stats replace it.
            if (log) {
              setIntroReplayIndex(Math.max(0, log.frames.length - 1 - INTRO_REPLAY_TICKS));
              setReplayInModal(true);
            }
            controlRef.current.paused = true;
            setPaused(true);
          }
        },
      } satisfies SceneData
    );

    return () => {
      game.destroy(true);
    };
    // Profiles/rules/autopilot are read from refs on build, not deps — editing
    // them must not tear down and restart the match.
  }, [restartToken, dims, viewport, boardMode]);

  const handleProfileChange = (id: string, key: keyof BotProfile, value: number) => {
    setProfiles((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  };
  const handleResetProfile = (id: string) => {
    setProfiles((prev) => ({ ...prev, [id]: cloneProfile(DEFAULT_BOT_PROFILE) }));
  };
  const handleResetAll = () => {
    setProfiles(makeInitialProfiles());
    setBotTypes(makeInitialBotTypes());
    setRules({ ...DEFAULT_GAME_RULES });
  };

  return (
    <div
      className={
        (boardMode !== "demo" ? "fixed inset-0 z-50 bg-background p-4 overflow-auto " : "") + "flex flex-col gap-4"
      }
    >
      <div className="flex flex-col min-[1400px]:flex-row min-[1400px]:items-start gap-4">
        <div className="flex flex-col gap-4 min-w-0">
          <div className="relative" style={{ maxWidth: (viewport?.cols ?? dims.cols) * dims.cell }}>
            <div
              ref={containerRef}
              className="overflow-hidden border border-border w-full touch-none [&>canvas]:block [&>canvas]:h-auto [&>canvas]:max-w-full"
              onPointerDown={handleBoardPointerDown}
              onPointerMove={handleBoardPointerMove}
              onPointerUp={handleBoardPointerEnd}
              onPointerCancel={handleBoardPointerEnd}
            />
            {!hideControls && (
              <div
                className="absolute top-2 left-2 z-10 pointer-events-none flex items-center gap-1 rounded-md bg-background/80 backdrop-blur px-2 py-1 text-xs font-semibold text-foreground shadow-sm"
                title="Score"
              >
                <Star className="w-3.5 h-3.5 fill-current" aria-hidden />
                {humanScore.toLocaleString()}
              </div>
            )}
          </div>
          {!hideControls && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={restart}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Restart
              </button>
              <button
                onClick={() => setPaused((p) => !p)}
                disabled={!!gameOver}
                className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                aria-pressed={paused}
              >
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={() => {
                  controlRef.current.stepOnce = true;
                }}
                disabled={!paused || !!gameOver}
                className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Step
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
              <button
                onClick={() => setShowProfiles((s) => !s)}
                className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                aria-expanded={showProfiles}
              >
                {showProfiles ? "Hide profiles" : "Profiles"}
              </button>
              <button
                onClick={() => setShowRecords((s) => !s)}
                className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                aria-expanded={showRecords}
              >
                {showRecords ? "Hide records" : "Records"}
              </button>
              <button
                onClick={() => setShowReplay((s) => !s)}
                disabled={!replay}
                className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                aria-expanded={showReplay}
              >
                {showReplay ? "Hide replay" : "Replay"}
              </button>
              <ul className="flex flex-wrap gap-4 text-sm min-[1400px]:hidden">
                {leaderboard.map((player) => (
                  <li key={player.id} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: colorToHex(player.color) }} />
                    <span className="text-foreground font-medium">{displayLabel(player)}</span>
                    <span className="text-muted-foreground">
                      {player.ownedCount} cells · {chainLengths[player.id] ?? 0}
                    </span>
                    {!player.alive && <span className="text-destructive text-xs">trying to respawn…</span>}
                  </li>
                ))}
              </ul>
              <span className="text-xs text-muted-foreground ml-auto" data-testid="landgrab-tick">
                Arrow keys / WASD (or drag the board on touch) to move · Space pauses · “.” steps · tick {tick}
              </span>
            </div>
          )}
          {/* Mode switches: kept outside the >=1400px-only aside below so they're reachable on
              mobile too, where there's no room for a permanent sidebar. */}
          {!hideControls && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => enterMode("fullscreen")}
                className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {boardMode === "fullscreen" ? "Exit full screen" : "Full screen"}
              </button>
              <button
                onClick={() => enterMode("large")}
                className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {boardMode === "large" ? "Exit large map" : "Large map"}
              </button>
              {boardMode !== "demo" && (
                <span className="text-xs text-muted-foreground">
                  {boardMode === "large"
                    ? `${dims.cols}×${dims.rows} world · ${viewport?.cols}×${viewport?.rows} view · press Esc to exit`
                    : `${dims.cols}×${dims.rows} cells · press Esc to exit`}
                </span>
              )}
            </div>
          )}
        </div>
        {!hideControls && (
          <aside
            className={
              (boardMode !== "demo" ? "block " : "hidden min-[1400px]:block ") +
              "shrink-0 w-56 rounded-lg border border-border p-4"
            }
          >
            <h3 className="text-sm font-semibold text-foreground mb-3">Leaderboard</h3>
            <ol className="flex flex-col gap-2 text-sm">
              {leaderboard.map((player, index) => (
                <li key={player.id} className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums w-4">{index + 1}</span>
                  <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ backgroundColor: colorToHex(player.color) }} />
                  <span className="text-foreground font-medium truncate">{displayLabel(player)}</span>
                  <span className="ml-auto flex items-baseline gap-1.5" title="Cells owned · players currently captured">
                    <span className="text-foreground tabular-nums">{player.ownedCount}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">{chainLengths[player.id] ?? 0}</span>
                  </span>
                </li>
              ))}
            </ol>
            <ul className="mt-3 flex flex-col gap-1">
              {leaderboard.filter((p) => !p.alive).map((player) => (
                <li key={player.id} className="text-destructive text-xs">{displayLabel(player)} trying to respawn…</li>
              ))}
            </ul>
          </aside>
        )}
      </div>
      {!hideControls && showRecords && (
        <MatchRecordsPanel key={gameOver?.endedAt ?? "records"} />
      )}
      {!hideControls && showReplay && replay && (
        <LandGrabReplay log={replay} onClose={() => setShowReplay(false)} />
      )}
      {!hideControls && showProfiles && (
        <BotProfilePanel
          configs={PLAYER_CONFIGS}
          humanId={HUMAN_ID}
          username={username}
          avatar={avatar}
          profiles={profiles}
          autopilot={autopilot}
          botTypes={botTypes}
          rules={rules}
          onUsernameChange={setUsername}
          onAvatarChange={setAvatar}
          onProfileChange={handleProfileChange}
          onAutopilotChange={(id, on) => setAutopilot((prev) => ({ ...prev, [id]: on }))}
          onBotTypeChange={(id, type) => setBotTypes((prev) => ({ ...prev, [id]: type }))}
          onResetProfile={handleResetProfile}
          onResetAll={handleResetAll}
          onRulesChange={(patch) => setRules((prev) => ({ ...prev, ...patch }))}
        />
      )}
      {!hideControls && (
        <AlertDialog open={gameOver !== null} onOpenChange={(open) => !open && closeGameOver()}>
          <AlertDialogContent
            data-testid="landgrab-gameover"
            className={replayInModal ? "sm:max-w-2xl" : undefined}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <span
                  className="w-3.5 h-3.5 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: gameOver?.winner.color }}
                />
                {gameOver?.winner.label} wins
              </AlertDialogTitle>
              <AlertDialogDescription>
                {replayInModal
                  ? introReplayIndex !== null
                    ? "Replaying the final moments."
                    : "Replaying the match from the first tick."
                  : gameOver && gameOver.winner.ownedCount >= gameOver.board.totalCells
                    ? `${gameOver.winner.label} captured the entire board.`
                    : `${gameOver?.winner.label} was the last boat afloat with nowhere left for the others to respawn.`}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {replayInModal ? (
              <div className="space-y-3">
                {replay && (
                  <LandGrabReplay
                    log={replay}
                    autoPlay
                    startIndex={introReplayIndex ?? undefined}
                    closeUp={introReplayIndex !== null}
                    initialSpeed={introReplayIndex !== null ? Math.min(...REPLAY_SPEED_OPTIONS) : undefined}
                    onEnded={() => setReplayInModal(false)}
                    className=""
                  />
                )}
              </div>
            ) : (
              gameOver && (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt>Ticks</dt>
                    <dd className="tabular-nums text-foreground">{gameOver.ticks}</dd>
                    <dt>Match time</dt>
                    <dd className="tabular-nums text-foreground">{formatDuration(gameOver.durationMs)}</dd>
                    <dt>Board</dt>
                    <dd className="tabular-nums text-foreground">
                      {gameOver.board.cols}×{gameOver.board.rows} · {gameOver.board.totalCells} cells
                    </dd>
                    <dt>Winner score</dt>
                    <dd className="tabular-nums text-foreground">{gameOver.winner.score.toLocaleString()}</dd>
                    <dt>Winner cells</dt>
                    <dd className="tabular-nums text-foreground">
                      {gameOver.winner.ownedCount} ({Math.round(gameOver.winner.ownedFraction * 100)}%)
                    </dd>
                    <dt>Winner peak</dt>
                    <dd className="tabular-nums text-foreground">
                      {gameOver.winner.peakOwnedCount} ({Math.round(gameOver.winner.peakOwnedFraction * 100)}%)
                    </dd>
                    <dt>Winner captures</dt>
                    <dd className="tabular-nums text-foreground">{gameOver.winner.captures}</dd>
                    <dt>Winner sunk</dt>
                    <dd className="tabular-nums text-foreground">{gameOver.winner.timesCaptured}×</dd>
                    <dt>Winner longest chain</dt>
                    <dd className="tabular-nums text-foreground">{gameOver.winner.peakChainLength}</dd>
                  </dl>
                  <p className="text-xs">
                    Saved to this browser as a game record (<code>landgrab:game-records</code>).
                  </p>
                </div>
              )
            )}

            <AlertDialogFooter>
              <AlertDialogCancel onClick={closeGameOver}>Dismiss</AlertDialogCancel>
              {!replayInModal && replay && (
                <button
                  type="button"
                  onClick={() => {
                    setIntroReplayIndex(null); // full match, from tick 0, default speed
                    setReplayInModal(true);
                  }}
                  className={`${buttonVariants({ variant: "secondary" })} mt-2 sm:mt-0`}
                >
                  Watch replay
                </button>
              )}
              <AlertDialogAction onClick={restart}>Play again</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
