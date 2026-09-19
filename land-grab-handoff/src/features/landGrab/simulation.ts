import { countOwnedCells, createEmptyGrid, findOpenSpawn, isAreaFree, placeBase, resolveCapture, type CellState } from "./grid";
import { resolveTerritorySplit } from "./splitResolution";
import { cloneProfile, DEFAULT_BOT_PROFILE, type BotProfile } from "./botProfile";
import { DELTA, OPPOSITE } from "./geometry";
import { createBotMemory, DEFAULT_BOT_TYPE, strategyFor, type BotMemory, type BotType } from "./botStrategy";
import { intendedNext, isStandoff } from "./standoff";
import type { Direction, Vec2 } from "./types";

export const BASE_RADIUS = 1;
export const RESPAWN_DELAY_TICKS = 12;
/** @deprecated per-bot now: see `BotProfile.homesickTrailLength`. Kept as the default. */
export const BOT_HOMESICK_TRAIL_LENGTH = DEFAULT_BOT_PROFILE.homesickTrailLength;
export const TICK_MS = 160;

/** Match-level knobs that aren't tied to a single player. */
export interface GameRules {
  respawnDelayTicks: number;
}

export const DEFAULT_GAME_RULES: GameRules = {
  respawnDelayTicks: RESPAWN_DELAY_TICKS,
};

export interface PlayerConfig {
  id: string;
  label: string;
  color: number;
  isBot: boolean;
  /** Starting decision parameters; defaults to `DEFAULT_BOT_PROFILE` when omitted. */
  profile?: BotProfile;
  /** Which bot archetype picks this player's moves. Defaults to `"rambler"` (today's roamer) — see `botStrategy.ts`. */
  botType?: BotType;
  /** Drive a non-bot player with `decideBotFacing` from tick 1. */
  autopilot?: boolean;
}

export interface PlayerState extends PlayerConfig {
  alive: boolean;
  home: Vec2;
  head: Vec2;
  facing: Direction;
  queuedFacing: Direction | null;
  trail: Vec2[];
  ownedCount: number;
  /** The largest `ownedCount` this player has held at the end of any tick so far — their high-water mark. */
  peakOwnedCount: number;
  respawnAt: number | null;
  /** How many times this player has cut a rival's trail and seized their land. */
  captures: number;
  /** How many times a rival has cut this player's trail and sunk them. The mirror of `captures`, win or lose. */
  timesCaptured: number;
  /** Bots move every tick from the start; a human sits still at home until their first key press. */
  hasStarted: boolean;
  /** The decision parameters this player's moves are scored against (used when a bot or on autopilot). */
  profile: BotProfile;
  /** The archetype whose `decide` picks this player's moves when driven. Defaults to `"rambler"`. */
  botType: BotType;
  /** Per-archetype scratch space, rebuilt on spawn and every respawn. `stepGame` shares the ref across ticks. */
  botMemory: BotMemory;
  /** True for bots, or a human whose autopilot toggle is on. */
  autopilot: boolean;
}

/**
 * One player eliminating another on a single tick, by trail cut or by
 * encirclement — reported purely for cosmetics (the trailing chain of
 * captured avatars drawn by `LandGrabDemo`/`LandGrabReplay`, via
 * `chainTrail.ts`). Has no bearing on scoring or future ticks; `stepGame`
 * never reads a previous tick's `captureEvents` back.
 */
export interface CaptureEvent {
  capturerId: string;
  victimId: string;
}

export interface GameState {
  rowCount: number;
  colCount: number;
  grid: CellState[][];
  players: Record<string, PlayerState>;
  playerOrder: string[];
  tick: number;
  rules: GameRules;
  /**
   * `null` while the match is live. Set to a player id once the board is
   * decided — either that player owns every cell, or they're the last one alive
   * and no eliminated player can ever fit a fresh base. `stepGame` freezes once
   * this is set.
   */
  winnerId: string | null;
  /** Eliminations that happened on this tick specifically — empty on most ticks. */
  captureEvents: CaptureEvent[];
}

/** A random spot to try for a fresh base, kept off the very edge of the board. */
function randomSpawnCandidate(rowCount: number, colCount: number, rng: () => number): Vec2 {
  const marginRow = Math.max(BASE_RADIUS + 1, Math.floor(rowCount / 5));
  const marginCol = Math.max(BASE_RADIUS + 1, Math.floor(colCount / 5));
  const rowSpan = Math.max(1, rowCount - 2 * marginRow);
  const colSpan = Math.max(1, colCount - 2 * marginCol);
  return {
    row: marginRow + Math.floor(rng() * rowSpan),
    col: marginCol + Math.floor(rng() * colSpan),
  };
}

export function createInitialGameState(
  rowCount: number,
  colCount: number,
  configs: PlayerConfig[],
  rules?: Partial<GameRules>,
  /** Source of randomness for starting spots; injected so tests can get deterministic homes. */
  rng: () => number = Math.random,
): GameState {
  let grid = createEmptyGrid(rowCount, colCount);
  const players: Record<string, PlayerState> = {};
  const playerOrder = configs.map((c) => c.id);

  configs.forEach((config) => {
    // Each player/bot gets a random spot, scanned outward if it collides with
    // an already-placed base — never the same static layout every game.
    const home = findOpenSpawn(grid, randomSpawnCandidate(rowCount, colCount, rng), BASE_RADIUS, rng);
    grid = placeBase(grid, home, config.id, BASE_RADIUS);
    const autopilot = config.autopilot ?? false;
    const botType = config.botType ?? DEFAULT_BOT_TYPE;
    players[config.id] = {
      ...config,
      profile: cloneProfile(config.profile ?? DEFAULT_BOT_PROFILE),
      botType,
      botMemory: createBotMemory(botType),
      autopilot,
      alive: true,
      home,
      head: home,
      facing: "up",
      queuedFacing: null,
      trail: [],
      ownedCount: 0,
      peakOwnedCount: 0,
      respawnAt: null,
      captures: 0,
      timesCaptured: 0,
      hasStarted: config.isBot || autopilot,
    };
  });

  for (const player of Object.values(players)) {
    player.ownedCount = countOwnedCells(grid, player.id);
    player.peakOwnedCount = player.ownedCount;
  }

  return {
    rowCount,
    colCount,
    grid,
    players,
    playerOrder,
    tick: 0,
    rules: { ...DEFAULT_GAME_RULES, ...rules },
    winnerId: null,
    captureEvents: [],
  };
}

export function setPlayerFacing(state: GameState, playerId: string, direction: Direction): void {
  const player = state.players[playerId];
  if (!player || !player.alive) return;
  // No reversing straight into the trail you just laid
  if (direction === OPPOSITE[player.facing] && player.trail.length > 0) return;
  player.queuedFacing = direction;
  player.hasStarted = true;
}

/** Paint a set of cells as `playerId` territory — folds both wakes into the capturing player's land on a trail cut. */
function claimCells(grid: CellState[][], cells: Vec2[], playerId: string): CellState[][] {
  if (cells.length === 0) return grid;
  const next = grid.map((row) => row.slice());
  const rows = next.length;
  const cols = next[0]?.length ?? 0;
  for (const { row, col } of cells) {
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    next[row][col] = { kind: "territory", playerId };
  }
  return next;
}

/**
 * Wipe a player's live wake off the board — used when they're sunk with no
 * land left to close onto. A stretch laid across a still-standing rival's
 * territory (`capturedFrom`) reverts to that rival rather than going neutral —
 * the rival never actually lost it, since this run never closed a loop or
 * landed a capture.
 */
function clearTrailCells(grid: CellState[][], playerId: string): CellState[][] {
  let changed = false;
  const next = grid.map((row) =>
    row.map((cell): CellState => {
      if (cell.kind === "trail" && cell.playerId === playerId) {
        changed = true;
        return cell.capturedFrom ? { kind: "territory", playerId: cell.capturedFrom } : { kind: "neutral" };
      }
      return cell;
    }),
  );
  return changed ? next : grid;
}

/**
 * Turn a sunk player's live wake into territory. A stretch laid over open
 * ground is fair spoils for `fallbackOwner` (whoever cut them down, or the
 * player themself on a successful loop close). A stretch laid across a still-
 * standing rival's land (`capturedFrom`) never actually left that rival's
 * hands — this run ended before it could close a loop or land a capture, so
 * it reverts to them instead of following the rest of the wake.
 */
function settleTrail(grid: CellState[][], trail: Vec2[], fallbackOwner: string): CellState[][] {
  if (trail.length === 0) return grid;
  const next = grid.map((row) => row.slice());
  const rows = next.length;
  const cols = next[0]?.length ?? 0;
  for (const { row, col } of trail) {
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
    // Read capturedFrom off the *original* grid, not the copy being written to —
    // a trail can list the same cell twice (e.g. the tip the capturer just
    // stepped onto is also the wake's last entry), and re-reading a cell this
    // same pass already turned into "territory" would lose its capturedFrom
    // to the fallback on the second visit.
    const cell = grid[row][col];
    const owner = (cell.kind === "trail" && cell.capturedFrom) || fallbackOwner;
    next[row][col] = { kind: "territory", playerId: owner };
  }
  return next;
}

/** Repaint every `fromId` territory cell as `toId` — used when a trail cut hands one player's land to another. */
function transferTerritory(grid: CellState[][], fromId: string, toId: string): CellState[][] {
  let changed = false;
  const next = grid.map((row) =>
    row.map((cell): CellState => {
      if (cell.kind === "territory" && cell.playerId === fromId) {
        changed = true;
        return { kind: "territory", playerId: toId };
      }
      return cell;
    }),
  );
  return changed ? next : grid;
}

function respawnPlayer(grid: CellState[][], player: PlayerState, spawn: Vec2): CellState[][] {
  const next = placeBase(grid, spawn, player.id, BASE_RADIUS);
  player.home = spawn;
  player.head = spawn;
  player.facing = "up";
  player.queuedFacing = null;
  player.alive = true;
  player.respawnAt = null;
  player.hasStarted = player.isBot || player.autopilot;
  player.botMemory = createBotMemory(player.botType);
  return next;
}

function inBounds(state: GameState, cell: Vec2): boolean {
  return cell.row >= 0 && cell.row < state.rowCount && cell.col >= 0 && cell.col < state.colCount;
}

/** True while some fully-neutral 3x3 pocket still exists — i.e. an eliminated player could still respawn. */
function boardHasOpenSpawn(grid: CellState[][]): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (let row = BASE_RADIUS; row < rows - BASE_RADIUS; row++) {
    for (let col = BASE_RADIUS; col < cols - BASE_RADIUS; col++) {
      if (isAreaFree(grid, { row, col }, BASE_RADIUS)) return true;
    }
  }
  return false;
}

/** The match is decided once one player holds every cell, or is the last alive with nowhere for the dead to respawn. */
function findWinner(state: GameState, players: Record<string, PlayerState>, grid: CellState[][]): string | null {
  const roster = Object.values(players);
  if (roster.length < 2) return null;

  const totalCells = state.rowCount * state.colCount;
  const conqueror = roster.find((p) => p.ownedCount === totalCells);
  if (conqueror) return conqueror.id;

  const alive = roster.filter((p) => p.alive);
  if (alive.length === 1 && !boardHasOpenSpawn(grid)) return alive[0].id;

  return null;
}

/**
 * Pick a facing for a bot-driven player by handing off to its archetype's
 * scorer. The archetypes live in `botStrategy.ts`; today only `"rambler"` (the
 * original greedy roamer) is registered. See `docs/land-grab/bots.md`.
 */
function decideBotFacing(state: GameState, player: PlayerState): Direction {
  return strategyFor(player.botType).decide(state, player, player.botMemory);
}

export function stepGame(state: GameState): GameState {
  // Match is over — hand back the frozen state untouched.
  if (state.winnerId) return state;

  let grid = state.grid;
  const rules = state.rules ?? DEFAULT_GAME_RULES;
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(state.players)) players[id] = { ...p, trail: [...p.trail] };
  // Whoever's capture loop most recently reshuffled a bystander's territory
  // this tick — used to credit an "encircled and swallowed" elimination (no
  // trail was cut) to the right player in `captureEvents`, same as a direct
  // trail cut.
  const splitActor = new Map<string, string>();
  // Eliminations on this tick, reported for display only (see `CaptureEvent`).
  const captureEvents: CaptureEvent[] = [];

  const nextTick = state.tick + 1;

  for (const player of Object.values(players)) {
    if (player.alive || player.respawnAt === null || player.respawnAt > state.tick) continue;
    // Hold the player out until the board actually has a clear 3x3 pocket for a
    // fresh base; otherwise leave respawnAt as-is and try again next tick.
    const spawn = findOpenSpawn(grid, player.home, BASE_RADIUS);
    if (!isAreaFree(grid, spawn, BASE_RADIUS)) continue;
    grid = respawnPlayer(grid, player, spawn);
  }

  const scratchState: GameState = { ...state, grid, players };
  for (const player of Object.values(players)) {
    if (player.alive && (player.isBot || player.autopilot)) {
      // Autopilot skips the human start gate — a driven boat moves from tick 1.
      player.hasStarted = true;
      player.queuedFacing = decideBotFacing(scratchState, player);
    }
  }

  // Head-on stand-off. Players step one at a time below, so without this pass the
  // first mover in a face-off just cuts the other's trail and captures them.
  // Instead: when two boats would swap cells (driving straight at each other) or
  // push into the same cell, neither captures — both hold position this tick and
  // stay blocked until one of them steers a different way.
  const standoff = new Set<string>();
  {
    const intents = new Map<string, { head: Vec2; next: Vec2 }>();
    for (const id of state.playerOrder) {
      const player = players[id];
      if (!player.alive || !player.hasStarted) continue;
      const facing = player.queuedFacing ?? player.facing;
      intents.set(id, { head: player.head, next: intendedNext(player.head, facing) });
    }
    const ids = [...intents.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = intents.get(ids[i])!;
        const b = intents.get(ids[j])!;
        if (isStandoff(a.head, a.next, b.head, b.next)) {
          standoff.add(ids[i]);
          standoff.add(ids[j]);
        }
      }
    }
  }

  for (const id of state.playerOrder) {
    const player = players[id];
    if (!player.alive || !player.hasStarted) continue;

    const facing = player.queuedFacing ?? player.facing;
    player.facing = facing;
    player.queuedFacing = null;

    if (standoff.has(id)) {
      // Blocked by another boat head-on this tick: hold position, lay no trail,
      // capture nothing. Facing still points at the other boat, so a human stays
      // parked here until they steer elsewhere; a bot re-picks next tick.
      continue;
    }

    const next: Vec2 = { row: player.head.row + DELTA[facing].row, col: player.head.col + DELTA[facing].col };

    if (!inBounds(state, next)) {
      // The board edge is a wall, not a cliff: hold position for this tick. The
      // player's facing now points into the wall, so a human keeps sitting here
      // until they steer somewhere that stays on the board; a bot re-picks a
      // direction on the next tick.
      continue;
    }

    const targetCell = grid[next.row][next.col];

    // Running over your own live trail neither sinks you nor closes the loop —
    // you sail straight through it. The wake only becomes territory once you
    // make it all the way back to your own colour. Anyone else's trail is still
    // an elimination.
    const onOwnTrail = targetCell.kind === "trail" && targetCell.playerId === player.id;

    if (targetCell.kind === "trail" && targetCell.playerId !== player.id) {
      const victim = players[targetCell.playerId];

      // Cutting a rival's trail is a capture. The ground they still held and
      // your own wake flip to your colour — one connected bridge running from
      // your land, along your trail, to the territory you've just seized.
      // Their wake is spoils too, *except* any stretch of it that was only
      // ever passing across some third rival's still-standing land: their run
      // ended here, never closing a loop or landing a capture, so that ground
      // reverts to its rightful owner instead of following the rest of the
      // wake to you. The victim is sunk and must respawn.
      grid = settleTrail(grid, [...victim.trail, next], player.id);
      grid = claimCells(grid, player.trail, player.id);
      grid = transferTerritory(grid, victim.id, player.id);
      grid = resolveCapture(grid, player.id);

      victim.alive = false;
      victim.trail = [];
      victim.queuedFacing = null;
      victim.respawnAt = nextTick + rules.respawnDelayTicks;
      victim.timesCaptured += 1;

      player.captures += 1;
      player.trail = [];
      player.head = next;
      captureEvents.push({ capturerId: player.id, victimId: victim.id });

      // The capture fill can still swallow a pocket of a *third* player's land;
      // resolve their remaining territory the same way a normal capture does.
      for (const otherId of state.playerOrder) {
        if (otherId === player.id || otherId === victim.id) continue;
        const other = players[otherId];
        grid = resolveTerritorySplit(grid, other.id, [other.head, other.home]);
        splitActor.set(otherId, player.id);
      }
      continue;
    }

    const reenteringOwnLand = targetCell.kind === "territory" && targetCell.playerId === player.id;

    if (player.trail.length > 0 && reenteringOwnLand) {
      grid = resolveCapture(grid, player.id);
      player.trail = [];
      player.head = next;
      for (const otherId of state.playerOrder) {
        if (otherId === player.id) continue;
        const other = players[otherId];
        grid = resolveTerritorySplit(grid, other.id, [other.head, other.home]);
        splitActor.set(otherId, player.id);
      }
    } else if (reenteringOwnLand || onOwnTrail) {
      // Back on our own land with no loop to close, or just crossing our own
      // wake: advance the head, leave the trail untouched.
      player.head = next;
    } else {
      // Stepping onto open ground lays a plain trail cell. Stepping onto a
      // rival's still-standing territory (the only other option here —
      // `reenteringOwnLand` and the rival-trail branch above have already
      // claimed every other case) draws the trail *over* it without taking it
      // yet: the cell stays theirs for scoring (`countOwnedCells`) until this
      // run actually finishes by closing a loop or landing a capture; if we're
      // cut down first, `capturedFrom` is how it finds its way back to them
      // instead of vanishing or following our wake to whoever cut us.
      const capturedFrom = targetCell.kind === "territory" ? targetCell.playerId : undefined;
      const row = grid[next.row].slice();
      row[next.col] = capturedFrom
        ? { kind: "trail", playerId: player.id, capturedFrom }
        : { kind: "trail", playerId: player.id };
      grid = grid.slice();
      grid[next.row] = row;
      player.trail.push(next);
      player.head = next;
    }
  }

  for (const player of Object.values(players)) {
    player.ownedCount = countOwnedCells(grid, player.id);
    if (player.ownedCount > player.peakOwnedCount) player.peakOwnedCount = player.ownedCount;
  }

  // Someone whose entire territory was just swallowed by another player's
  // capture loop is finished: they're still afloat but hold zero ground, so
  // there's nothing left to close a loop onto. Sink them the same way a
  // trail-cut victim is sunk, and clear their now-orphaned wake off the board.
  // This applies even to a player who hasn't moved since spawning/respawning
  // (`hasStarted` false) — a human who gets boxed in before their first key
  // press is just as stuck as one who was mid-trail, and needs the same
  // respawn cycle rather than being left alive with no land to ever reclaim.
  for (const player of Object.values(players)) {
    if (!player.alive || player.ownedCount > 0) continue;
    player.alive = false;
    player.trail = [];
    player.queuedFacing = null;
    player.respawnAt = nextTick + rules.respawnDelayTicks;
    grid = clearTrailCells(grid, player.id);

    // Encircled and swallowed rather than trail-cut — still an elimination,
    // credited to whoever's loop closed around them, same as a trail cut.
    const captorId = splitActor.get(player.id);
    if (captorId && players[captorId]?.alive) {
      captureEvents.push({ capturerId: captorId, victimId: player.id });
    }
  }

  const winnerId = findWinner(state, players, grid);

  return {
    rowCount: state.rowCount,
    colCount: state.colCount,
    grid,
    players,
    playerOrder: state.playerOrder,
    tick: nextTick,
    rules,
    winnerId,
    captureEvents,
  };
}
