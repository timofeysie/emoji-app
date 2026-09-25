import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import {
  computeTotalScore,
  createInitialGameState,
  setPlayerFacing,
  stepGame,
  DEFAULT_GAME_RULES,
  TICK_MS,
  type GameRules,
  type GameState,
  type PlayerConfig,
} from "@emoji-app/land-grab-core";
import {
  applyCaptureEvents,
  appendHeadHistory,
  chainPositions,
  clearDeadChains,
  CHAIN_TRAIL_ALPHA,
  type ChainMap,
} from "@emoji-app/land-grab-core";
import { cloneProfile, DEFAULT_BOT_PROFILE, type BotProfile } from "@emoji-app/land-grab-core";
import { createBotMemory, DEFAULT_BOT_TYPE, type BotType } from "@emoji-app/land-grab-core";
import { BotProfilePanel } from "./BotProfilePanel";
import { MatchRecordsPanel } from "./MatchRecordsPanel";
import {
  buildGameRecord,
  saveGameRecord,
  type LandGrabGameRecord,
} from "./gameRecord";
import { createReplayLog, recordFrame, type ReplayLog } from "@emoji-app/land-grab-core";
import { LandGrabReplay } from "./LandGrabReplay";
import { loadUserProfile, resolveUsername, saveUserProfile } from "./userProfile";
import { PlayerAvatarPreview, PlayerProfileEditor } from "./PlayerProfileEditor";
import { AVATAR_SIZE, createDefaultAvatar, type AvatarGrid } from "@emoji-app/land-grab-core";
import type { Direction } from "@emoji-app/land-grab-core";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/Dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/AlertDialog";
import { buttonVariants } from "../components/button";
import type { Vec2 } from "@emoji-app/land-grab-core";
import webPackage from "../../package.json";

const CELL_SIZE = 22;
const DEFAULT_DIMS = { rows: 16, cols: 24, cell: CELL_SIZE };
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
/** Fixed on-screen size for player/bot avatars on the minimap, regardless of world size. */
const MINIMAP_AVATAR_SCREEN_SIZE = 8;

interface GridDims {
  rows: number;
  cols: number;
  cell: number;
}

interface ViewportDims {
  width: number;
  height: number;
  cols: number;
  rows: number;
}

type AppScreen = "home" | "game" | "replay" | "records" | "profiles";

/**
 * A world several times bigger than the on-screen viewport, so the game plays like a
 * paper.io-style sliding window: the Phaser canvas stays viewport-sized and its camera
 * scrolls to follow the human player around the larger board.
 */
function computeLargeMapDims(): { world: GridDims; viewport: ViewportDims } {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const viewport = {
    width,
    height,
    cols: Math.ceil(width / CELL_SIZE),
    rows: Math.ceil(height / CELL_SIZE),
  };

  return {
    world: {
      cell: CELL_SIZE,
      cols: Math.min(LARGE_MAP_MAX_COLS, viewport.cols * LARGE_MAP_SCALE),
      rows: Math.min(LARGE_MAP_MAX_ROWS, viewport.rows * LARGE_MAP_SCALE),
    },
    viewport,
  };
}

const PLAYER_CONFIGS: PlayerConfig[] = [
  { id: "you", label: "Player", color: 0x38bdf8, isBot: false },
  { id: "bot-red", label: "Red Invader", color: 0xf87171, isBot: true, botType: "invader" },
  { id: "bot-yellow", label: "Yellow Rambler", color: 0xfacc15, isBot: true, botType: "rambler" },
  { id: "bot-green", label: "Green Surveyor", color: 0x4ade80, isBot: true, botType: "surveyor" },
];

const HUMAN_ID = "you";
const HUMAN_AVATAR_COLOR = "#38bdf8";
const AVATAR_TEXTURE_KEY_PREFIX = "land-grab-avatar";
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
  /** The human's custom head-marker sprite, or `null` to draw the tinted default avatar. */
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
  /** Serialized avatar grids keyed by player id, so unchanged textures are reused each tick. */
  private bakedAvatarSignatures: Record<string, string> = {};
  private chainMarkers: Phaser.GameObjects.GameObject[] = [];
  /** The lower-left overview camera in "large map" mode, `null` otherwise. */
  private minimapCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  /**
   * Invisible follow target for the main camera in large-map mode. Moved to the human's exact
   * head position once per tick; the camera itself lerps toward it every render frame (via
   * `startFollow`), which is what turns the once-per-160ms cell jump into a smooth glide.
   */
  private cameraTarget: Phaser.GameObjects.Zone | null = null;
  /** World units per minimap screen pixel — used to size the fixed-screen-size player avatars. */
  private minimapZoom = 1;
  /** Player/bot avatars drawn only for the minimap (the normal head markers are too small to read at that zoom). */
  private minimapMarkers: Phaser.GameObjects.GameObject[] = [];
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

  private avatarFor(playerId: string, color: number): AvatarGrid {
    return playerId === HUMAN_ID && this.avatarRef.current
      ? this.avatarRef.current
      : createDefaultAvatar(colorToHex(color));
  }

  /** (Re)bake one player's grid, skipping the redraw when their avatar has not changed. */
  private ensureAvatarTexture(playerId: string, grid: AvatarGrid): string {
    const textureKey = `${AVATAR_TEXTURE_KEY_PREFIX}:${playerId}`;
    const signature = grid.join(",");
    if (this.bakedAvatarSignatures[playerId] === signature && this.textures.exists(textureKey)) {
      return textureKey;
    }
    this.bakedAvatarSignatures[playerId] = signature;
    const side = AVATAR_SIZE * AVATAR_TEXTURE_PIXEL_SIZE;
    if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
    const canvasTexture = this.textures.createCanvas(textureKey, side, side)!;
    canvasTexture.setFilter(Phaser.Textures.FilterMode.NEAREST);
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
    return textureKey;
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
        const capturedPlayer = state.players[chain[i]];
        if (!capturedPlayer) continue;
        const cx = pos.col * cell + cell / 2;
        const cy = pos.row * cell + cell / 2;
        const avatar = this.avatarFor(capturedPlayer.id, capturedPlayer.color);
        const key = this.ensureAvatarTexture(capturedPlayer.id, avatar);
        const marker = this.add.image(cx, cy, key);
        marker.setDisplaySize(cell * 0.5, cell * 0.5);
        marker.setAlpha(CHAIN_TRAIL_ALPHA);
        this.chainMarkers.push(marker);
      }
    }

    for (const marker of this.headMarkers) marker.destroy();
    this.headMarkers = [];
    for (const player of Object.values(state.players)) {
      if (!player.alive) continue;
      const cx = player.head.col * cell + cell / 2;
      const cy = player.head.row * cell + cell / 2;
      const avatar = this.avatarFor(player.id, player.color);
      const key = this.ensureAvatarTexture(player.id, avatar);
      const marker = this.add.image(cx, cy, key);
      marker.setDisplaySize(cell * 0.9, cell * 0.9);
      this.headMarkers.push(marker);
    }

    for (const marker of this.minimapMarkers) marker.destroy();
    this.minimapMarkers = [];
    if (this.isLargeMap && this.minimapCamera) {
      const worldSize = MINIMAP_AVATAR_SCREEN_SIZE / this.minimapZoom;
      for (const player of Object.values(state.players)) {
        if (!player.alive) continue;
        const cx = player.head.col * cell + cell / 2;
        const cy = player.head.row * cell + cell / 2;
        const avatar = this.avatarFor(player.id, player.color);
        const key = this.ensureAvatarTexture(player.id, avatar);
        const marker = this.add.image(cx, cy, key);
        marker.setDisplaySize(worldSize, worldSize);
        this.cameras.main.ignore(marker);
        this.minimapMarkers.push(marker);
      }
    }
  }
}

/** `mm:ss` from a millisecond duration. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function colorToHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function LandGrabDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<GridDims>(DEFAULT_DIMS);
  const [viewport, setViewport] = useState<ViewportDims | null>(null);
  const [screen, setScreen] = useState<AppScreen>("home");
  const [showGameReplay, setShowGameReplay] = useState(false);
  const [gameReplayStartIndex, setGameReplayStartIndex] = useState(0);
  const [profiles, setProfiles] = useState<Record<string, BotProfile>>(makeInitialProfiles);
  const [autopilot, setAutopilot] = useState<Record<string, boolean>>(makeInitialAutopilot);
  const [botTypes, setBotTypes] = useState<Record<string, BotType>>(makeInitialBotTypes);
  const [rules, setRules] = useState<GameRules>({ ...DEFAULT_GAME_RULES });
  const [initialUserProfile] = useState(loadUserProfile);
  const [username, setUsername] = useState<string>(initialUserProfile.username);
  const [avatar, setAvatar] = useState<AvatarGrid | null>(initialUserProfile.avatar ?? null);
  const [profileSetupComplete, setProfileSetupComplete] = useState(initialUserProfile.setupComplete === true);

  const controlRef = useRef<SceneControl>({ paused: false, speed: 2, stepOnce: false });
  const profilesRef = useRef(profiles);
  const autopilotRef = useRef(autopilot);
  const botTypesRef = useRef(botTypes);
  const rulesRef = useRef(rules);
  const usernameRef = useRef(username);
  const avatarRef = useRef(avatar);

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
  const [livePlayers, setLivePlayers] = useState(stateHolderRef.current.current.players);
  const [chainLengths, setChainLengths] = useState<Record<string, number>>({});
  const [restartToken, setRestartToken] = useState(0);
  const [gameOver, setGameOver] = useState<LandGrabGameRecord | null>(null);
  // Frozen at game over for the replay viewer. Kept across restarts so the
  // Replay button stays useful — the next finished match overwrites it.
  const [replay, setReplay] = useState<ReplayLog | null>(null);
  // The live recording for the in-progress match; read/written only inside the
  // Phaser tick loop.
  const replayLogRef = useRef<ReplayLog | null>(null);
  // Guards the once-per-match record write from inside the Phaser tick loop.
  const recordedRef = useRef(false);

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

  const startGame = () => {
    if (!profileSetupComplete) return;
    const { world, viewport: nextViewport } = computeLargeMapDims();
    setDims(world);
    setViewport(nextViewport);
    setGameOver(null);
    setShowGameReplay(false);
    setGameReplayStartIndex(0);
    touchDragRef.current = null;
    setScreen("game");
    setRestartToken((value) => value + 1);
  };

  const goHome = () => {
    setGameOver(null);
    setShowGameReplay(false);
    setGameReplayStartIndex(0);
    touchDragRef.current = null;
    setScreen("home");
  };

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
    if (profileSetupComplete) {
      saveUserProfile({ schemaVersion: 1, username, avatar, setupComplete: true });
    }
  }, [username, avatar, profileSetupComplete]);
  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  useEffect(() => {
    if (screen !== "game" || !containerRef.current || !viewport) return;

    const initialState = createInitialGameState(dims.rows, dims.cols, buildConfigs(), rulesRef.current);
    stateHolderRef.current.current = initialState;
    setLivePlayers(initialState.players);
    setChainLengths({});
    replayLogRef.current = createReplayLog(initialState);
    recordedRef.current = false;
    controlRef.current.paused = false;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: viewport.width,
      height: viewport.height,
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
        isLargeMap: true,
        onTick: (state: GameState, chainPeaks: Record<string, number>, chainLengths: Record<string, number>) => {
          if (replayLogRef.current) recordFrame(replayLogRef.current, state);
          setLivePlayers(state.players);
          setChainLengths(chainLengths);
          if (state.winnerId && !recordedRef.current) {
            recordedRef.current = true;
            const record = buildGameRecord(state, { chainPeaks, chainLengths });
            saveGameRecord(record);
            const log = replayLogRef.current;
            setReplay(log);
            setGameOver(record);
            // As soon as the match ends, auto-play the last few ticks so the
            // deciding move is visible before the stats replace it.
            if (log) {
              setGameReplayStartIndex(Math.max(0, log.frames.length - 1 - INTRO_REPLAY_TICKS));
              setShowGameReplay(true);
            }
            controlRef.current.paused = true;
          }
        },
      } satisfies SceneData
    );

    return () => {
      game.destroy(true);
    };
    // Profiles/rules/autopilot are read from refs on build, not deps — editing
    // them must not tear down and restart the match.
  }, [restartToken, dims, viewport, screen]);

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
  const handleCompleteProfileSetup = () => {
    const resolvedUsername = resolveUsername(username);
    setUsername(resolvedUsername);
    saveUserProfile({
      schemaVersion: 1,
      username: resolvedUsername,
      avatar,
      setupComplete: true,
    });
    setProfileSetupComplete(true);
  };
  const winnerName =
    gameOver?.winner.id === HUMAN_ID ? resolveUsername(username) : gameOver?.winner.label;
  const totalCells = dims.rows * dims.cols;
  const playerCount = Object.keys(livePlayers).length;
  const leaderboard = Object.values(livePlayers)
    .map((player, rosterIndex) => ({
      player,
      rosterIndex,
      score: computeTotalScore(
        player.ownedCount,
        chainLengths[player.id] ?? 0,
        totalCells,
        playerCount,
      ),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.player.ownedCount - a.player.ownedCount ||
        a.rosterIndex - b.rosterIndex,
    );

  return (
    <>
      {screen === "home" && (
        <main className="home-screen">
          <section className="home-card" aria-labelledby="landgrab-title">
            <p className="home-eyebrow">Emoji App Arcade</p>
            <div className="home-title">
              <h1 id="landgrab-title">LandGrab</h1>
              <span className="home-version" aria-label={`Version ${webPackage.version}`}>
                v{webPackage.version}
              </span>
            </div>
            <p className="home-copy">
              Swipe to steer. Close loops to claim the map and cut rival trails to capture them.
            </p>
            <nav className="home-menu" aria-label="Main menu">
              <button type="button" className="home-menu-button home-menu-button-primary" onClick={startGame}>
                Start game
              </button>
              <button
                type="button"
                className="home-menu-button"
                onClick={() => setScreen("replay")}
                disabled={!replay}
                title={replay ? undefined : "Finish a game to unlock replay"}
              >
                Replay
              </button>
              <button type="button" className="home-menu-button" onClick={() => setScreen("records")}>
                Records
              </button>
              <button type="button" className="home-menu-button" onClick={() => setScreen("profiles")}>
                Profiles
              </button>
            </nav>
          </section>
        </main>
      )}

      <Dialog open={!profileSetupComplete} onOpenChange={() => undefined}>
        <DialogContent className="dialog profile-setup-dialog" data-testid="player-profile-setup">
          <DialogHeader>
            <DialogTitle>Set up your profile</DialogTitle>
          </DialogHeader>
          <PlayerProfileEditor
            username={username}
            avatar={avatar}
            seedColor={HUMAN_AVATAR_COLOR}
            onUsernameChange={setUsername}
            onAvatarChange={setAvatar}
          />
          <DialogFooter>
            <button
              type="button"
              onClick={handleCompleteProfileSetup}
              className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:ml-auto sm:w-auto"
            >
              Continue
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {screen === "game" && (
        <main className="game-screen" aria-label="LandGrab game">
          <div
            ref={containerRef}
            className="game-surface"
            onPointerDown={handleBoardPointerDown}
            onPointerMove={handleBoardPointerMove}
            onPointerUp={handleBoardPointerEnd}
            onPointerCancel={handleBoardPointerEnd}
          />
          <aside
            className="game-leaderboard"
            aria-labelledby="game-leaderboard-title"
            data-testid="landgrab-live-leaderboard"
          >
            <header className="game-leaderboard-header">
              <h2 id="game-leaderboard-title">Leaderboard</h2>
              <span>Score</span>
            </header>
            <ol className="game-leaderboard-list">
              {leaderboard.map(({ player, score }, index) => {
                const isHuman = player.id === HUMAN_ID;
                return (
                  <li
                    key={player.id}
                    className={[
                      "game-leaderboard-row",
                      isHuman ? "game-leaderboard-row-current" : "",
                      !player.alive ? "game-leaderboard-row-respawning" : "",
                    ].filter(Boolean).join(" ")}
                    aria-current={isHuman ? "true" : undefined}
                  >
                    <span className="game-leaderboard-rank" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="game-leaderboard-icon">
                      <PlayerAvatarPreview
                        avatar={isHuman ? avatar : null}
                        seedColor={colorToHex(player.color)}
                        size={24}
                      />
                    </span>
                    <span className="game-leaderboard-name">{player.label}</span>
                    <span className="game-leaderboard-score" aria-label={`${score} points`}>
                      {score.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ol>
          </aside>
        </main>
      )}

      {screen === "replay" && replay && (
        <main className="replay-screen" aria-label="Replay">
          <LandGrabReplay log={replay} onClose={goHome} />
        </main>
      )}

      {(screen === "records" || screen === "profiles") && (
        <main className="menu-screen">
          <header className="menu-screen-header">
            <button
              type="button"
              className="menu-back-button"
              aria-label="Back to main menu"
              onClick={goHome}
            >
              <span aria-hidden>←</span>
            </button>
            <h1>{screen === "records" ? "Records" : "Profiles"}</h1>
          </header>

          <div className="menu-screen-content">
            {screen === "records" && <MatchRecordsPanel />}
            {screen === "profiles" && (
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
          </div>
        </main>
      )}

      {screen === "game" && gameOver && showGameReplay && replay && (
        <section className="replay-overlay" aria-label="Game replay">
          <LandGrabReplay
            log={replay}
            autoPlay
            startIndex={gameReplayStartIndex}
            onEnded={() => setShowGameReplay(false)}
            onClose={() => setShowGameReplay(false)}
          />
        </section>
      )}

      <AlertDialog
        open={screen === "game" && gameOver !== null && !showGameReplay}
        onOpenChange={(open) => !open && goHome()}
      >
        <AlertDialogContent data-testid="landgrab-gameover" className="dialog result-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {gameOver && (
                <PlayerAvatarPreview
                  avatar={gameOver.winner.id === HUMAN_ID ? avatar : null}
                  seedColor={gameOver.winner.color}
                  size={20}
                />
              )}
              {winnerName} wins
            </AlertDialogTitle>
          </AlertDialogHeader>

          {gameOver && (
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
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={goHome}>Home</AlertDialogCancel>
            {replay && (
              <button
                type="button"
                onClick={() => {
                  setGameReplayStartIndex(0);
                  setShowGameReplay(true);
                }}
                className={`${buttonVariants({ variant: "secondary" })} mt-2 sm:mt-0`}
              >
                Watch replay
              </button>
            )}
            <AlertDialogAction onClick={startGame}>Play again</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
