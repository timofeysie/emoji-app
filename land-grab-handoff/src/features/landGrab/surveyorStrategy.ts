import { DEFAULT_BOT_PROFILE, SURVEYOR_PROFILE_FIELDS } from "./botProfile";
import { ALL_DIRECTIONS, DELTA } from "./geometry";
import { wouldStandOff } from "./standoff";
import type { CellState } from "./grid";
import type { BotStrategy } from "./botStrategy";
import type { GameState, PlayerState } from "./simulation";
import type { Direction, Vec2 } from "./types";

/**
 * The Surveyor — the goal-oriented territory farmer, in contrast to the Rambler's
 * greedy roaming. It grows one contiguous blob outward from home by laying a wake
 * along the frontier of its own land, then folding it back in — keeping the wake
 * short and close to owned ground so it's rarely cuttable.
 *
 * Each extend leg reaches toward an `aim` point: centre-of-board biased, its
 * bearing rotated a little every loop so successive loops sweep different sectors
 * instead of re-tracing one spike. The centre bias also grows rival blobs toward
 * each other, so a bot-vs-bot match actually comes to contact and resolves.
 *
 * Still a greedy one-cell lookahead. `botMemory` carries a tiny objective: the
 * current `phase`, a short trail of recent head cells (so it can never sit
 * toggling between two squares), a stuck counter, a loop counter and the current
 * aim. Every candidate move gets a *graded* score — there is no flat plateau for a
 * tie-break to spin on. This file imports only *types* from `botStrategy.ts` /
 * `simulation.ts`, so there's no runtime cycle.
 */
export interface SurveyorMemory {
  type: "surveyor";
  /** `"extend"` grows a wake out toward `aim`; `"return"` heads home to bank it. */
  phase: "extend" | "return";
  /** Recent head cells, oldest first — bans immediate backtracking and breaks orbit loops. */
  recent: Vec2[];
  /** Consecutive ticks stuck in `extend` with no wake out; trips the walk-home-and-regroup fallback. */
  stuckTicks: number;
  /** Bumped at the start of every extend leg; rotates the aim bearing so loops don't repeat. */
  loopCount: number;
  /** Board cell this extend leg reaches toward — centre-biased, rotated by `loopCount`. */
  aim: Vec2 | null;
}

/** A fresh Surveyor scratch bag; called on spawn and every respawn. */
export function createSurveyorMemory(): SurveyorMemory {
  return { type: "surveyor", phase: "extend", recent: [], stuckTicks: 0, loopCount: 0, aim: null };
}

// --- Tuning constants. The four BotProfile knobs (maxTrailExposure, targetTrailLength,
// frontierHugBonus, rivalAvoidRadius) stay panel-editable; these shape the scoring
// gradients and don't need a slider. ---
/** How many past head cells to remember for anti-backtracking / orbit-breaking. */
const RECENT_LEN = 8;
/** Score hit for revisiting a remembered cell, scaled by how recent the visit was. */
const REVISIT_WEIGHT = 6;
/** Score for stepping straight back onto the cell we just left — the toggle killer. Below any real move. */
const BACKTRACK_PENALTY = -300;
/** Pull out of your own blob toward the nearest open water, per step of distance. */
const FRONTIER_SEEK = 1.5;
/** Base score for crossing your own territory mid-extend: below any wake-laying move, above a revisit. */
const TERRITORY_BASE = -8;
/** Base score for crossing your own wake mid-extend: worse than territory — it tangles the loop. */
const TRAIL_BASE = -12;
/** Per-cell penalty once the head has drifted past `maxTrailExposure` from owned land (a slope, not a cliff). */
const EXPOSURE_WEIGHT = 8;
/** Score hit for stepping onto a cell that touches a living rival's head. */
const RIVAL_ADJ_PENALTY = -50;
/** Bonus for stepping onto a rival's wake — that's a cut. Enough to reliably take one when adjacent. */
const CUT_BONUS = 8;
/** Ticks in `extend` with no wake before the Surveyor gives up and walks home to regroup. */
const STUCK_LIMIT = 30;
/** Per-step reward for closing distance to this loop's `aim` point — steers which way the wake sweeps. */
const AIM_PULL = 1.5;
/** Number of distinct aim bearings before the rotation repeats (they fan across the board interior). */
const SWEEP_ROTATE = 4;

function inBounds(rowCount: number, colCount: number, cell: Vec2): boolean {
  return cell.row >= 0 && cell.row < rowCount && cell.col >= 0 && cell.col < colCount;
}

function isOwned(grid: CellState[][], playerId: string, cell: Vec2): boolean {
  const g = grid[cell.row]?.[cell.col];
  return !!g && g.kind === "territory" && g.playerId === playerId;
}

/**
 * 4-connected step distance from `cell` to the nearest cell `playerId` owns as
 * territory. Bounded: gives up after `maxRadius` rings and returns `Infinity`.
 * `cell` itself is distance 0 when it's already owned.
 */
export function nearestOwnedDistance(
  grid: CellState[][],
  playerId: string,
  cell: Vec2,
  maxRadius = 16,
): number {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  if (!inBounds(rowCount, colCount, cell)) return Infinity;
  if (isOwned(grid, playerId, cell)) return 0;

  const seen = new Set<string>([`${cell.row},${cell.col}`]);
  let frontier: Vec2[] = [cell];
  for (let dist = 1; dist <= maxRadius; dist++) {
    const next: Vec2[] = [];
    for (const cur of frontier) {
      for (const dir of ALL_DIRECTIONS) {
        const n = { row: cur.row + DELTA[dir].row, col: cur.col + DELTA[dir].col };
        if (!inBounds(rowCount, colCount, n)) continue;
        const key = `${n.row},${n.col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (isOwned(grid, playerId, n)) return dist;
        next.push(n);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return Infinity;
}

/**
 * 4-connected step distance from `cell` to the nearest neutral (unclaimed) cell,
 * pathing through anything in between. Bounded: gives up after `maxRadius` rings
 * and returns `Infinity`. `cell` itself is distance 0 when it's already neutral.
 * Used to pull a buried Surveyor back out to open water where it can lay a wake.
 */
export function nearestNeutralDistance(grid: CellState[][], cell: Vec2, maxRadius = 16): number {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  if (!inBounds(rowCount, colCount, cell)) return Infinity;
  if (grid[cell.row][cell.col].kind === "neutral") return 0;

  const seen = new Set<string>([`${cell.row},${cell.col}`]);
  let frontier: Vec2[] = [cell];
  for (let dist = 1; dist <= maxRadius; dist++) {
    const next: Vec2[] = [];
    for (const cur of frontier) {
      for (const dir of ALL_DIRECTIONS) {
        const n = { row: cur.row + DELTA[dir].row, col: cur.col + DELTA[dir].col };
        if (!inBounds(rowCount, colCount, n)) continue;
        const key = `${n.row},${n.col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (grid[n.row][n.col].kind === "neutral") return dist;
        next.push(n);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return Infinity;
}

/** True when `cell` is neutral water 4-adjacent to a cell `playerId` owns as territory. */
export function isFrontierAdjacent(grid: CellState[][], playerId: string, cell: Vec2): boolean {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  if (!inBounds(rowCount, colCount, cell)) return false;
  if (grid[cell.row][cell.col].kind !== "neutral") return false;
  for (const dir of ALL_DIRECTIONS) {
    const n = { row: cell.row + DELTA[dir].row, col: cell.col + DELTA[dir].col };
    if (inBounds(rowCount, colCount, n) && isOwned(grid, playerId, n)) return true;
  }
  return false;
}

/**
 * Rough size of the region a loop closed right now would enclose: the
 * bounding-box area spanned by the current wake plus the head. Used only for the
 * "is this loop worth closing yet" decision — the real fill is `resolveCapture`.
 */
export function estimateEnclosedArea(trail: Vec2[], head: Vec2): number {
  let minRow = head.row;
  let maxRow = head.row;
  let minCol = head.col;
  let maxCol = head.col;
  for (const c of trail) {
    if (c.row < minRow) minRow = c.row;
    if (c.row > maxRow) maxRow = c.row;
    if (c.col < minCol) minCol = c.col;
    if (c.col > maxCol) maxCol = c.col;
  }
  return (maxRow - minRow + 1) * (maxCol - minCol + 1);
}

/** Manhattan distance from `player`'s head to the nearest other living player's head; `Infinity` if alone. */
export function nearestRivalHeadDistance(state: GameState, player: PlayerState): number {
  let best = Infinity;
  for (const id of state.playerOrder) {
    if (id === player.id) continue;
    const rival = state.players[id];
    if (!rival || !rival.alive) continue;
    const d = Math.abs(rival.head.row - player.head.row) + Math.abs(rival.head.col - player.head.col);
    if (d < best) best = d;
  }
  return best;
}

function isAdjacentToRivalHead(state: GameState, player: PlayerState, cell: Vec2): boolean {
  for (const id of state.playerOrder) {
    if (id === player.id) continue;
    const rival = state.players[id];
    if (!rival || !rival.alive) continue;
    const d = Math.abs(rival.head.row - cell.row) + Math.abs(rival.head.col - cell.col);
    if (d <= 1) return true;
  }
  return false;
}

function sameCell(a: Vec2, b: Vec2): boolean {
  return a.row === b.row && a.col === b.col;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/**
 * A target cell for the next extend leg: a point `reach` cells from `head` along a
 * board-centre bearing that is rotated by `loopCount`, so successive loops sweep
 * across a ~180° fan facing the open interior instead of re-tracing one spike.
 * The centre bias also walks rival blobs toward each other, so a bot match resolves.
 */
function computeAim(state: GameState, head: Vec2, loopCount: number, reach: number): Vec2 {
  const cRow = (state.rowCount - 1) / 2;
  const cCol = (state.colCount - 1) / 2;
  let vr = cRow - head.row;
  let vc = cCol - head.col;
  const mag = Math.hypot(vr, vc);
  if (mag < 1) {
    vr = 0;
    vc = 1; // head is ~centred: pick any bearing, the rotation still fans it out
  } else {
    vr /= mag;
    vc /= mag;
  }
  // Swing ±(SWEEP_ROTATE-1)/2 * 60° around the centreward bearing, stepping per loop.
  const angle = ((loopCount % SWEEP_ROTATE) - (SWEEP_ROTATE - 1) / 2) * (Math.PI / 3);
  const rr = vr * Math.cos(angle) - vc * Math.sin(angle);
  const rc = vr * Math.sin(angle) + vc * Math.cos(angle);
  return {
    row: clamp(Math.round(head.row + rr * reach), 0, state.rowCount - 1),
    col: clamp(Math.round(head.col + rc * reach), 0, state.colCount - 1),
  };
}

function surveyorDecide(state: GameState, player: PlayerState, memory: SurveyorMemory): Direction {
  const p = player.profile;
  const grid = state.grid;
  const head = player.head;
  const trailLen = player.trail.length;
  const onOwnLand = isOwned(grid, player.id, head);

  // --- anti-oscillation memory: log where we are, remember the last RECENT_LEN cells ---
  const recent = memory.recent;
  if (recent.length === 0 || !sameCell(recent[recent.length - 1], head)) {
    recent.push({ row: head.row, col: head.col });
    if (recent.length > RECENT_LEN) recent.shift();
  }
  const cameFrom = recent.length >= 2 ? recent[recent.length - 2] : null;

  // --- phase arbitration ---
  const aimReach = Math.max(p.targetTrailLength, p.maxTrailExposure + 4);
  const rivalDist = nearestRivalHeadDistance(state, player);
  // Only bail out of extending for a rival if we've already got a wake worth
  // banking, or the rival is right on top of us — otherwise keep growing toward
  // contested ground so the match actually comes to contact.
  const rivalThreat =
    rivalDist <= p.rivalAvoidRadius && (trailLen >= p.targetTrailLength / 2 || rivalDist <= 1);
  const loopWorthClosing =
    trailLen >= p.targetTrailLength &&
    estimateEnclosedArea(player.trail, head) >= Math.min(6, p.targetTrailLength);
  const reachedAim = trailLen > 0 && memory.aim != null && manhattan(head, memory.aim) <= 1;

  if (memory.phase === "return") {
    // Back on our own land with the wake banked → start a fresh loop, next sector.
    if (trailLen === 0 && onOwnLand) {
      memory.phase = "extend";
      memory.stuckTicks = 0;
      memory.loopCount += 1;
      memory.aim = computeAim(state, head, memory.loopCount, aimReach);
    }
  } else if (trailLen > 0) {
    memory.stuckTicks = 0;
    if (loopWorthClosing || reachedAim || rivalThreat) memory.phase = "return";
  } else {
    // In extend but no wake out yet — still working our way to the frontier.
    if (memory.aim == null) memory.aim = computeAim(state, head, memory.loopCount, aimReach);
    memory.stuckTicks += 1;
    if (rivalThreat || memory.stuckTicks > STUCK_LIMIT) memory.phase = "return";
  }

  // Wandered a wake twice as long as the target without closing → force the
  // return leg so the bot can never freeze mid-loop.
  const deadlocked = trailLen >= 2 * p.targetTrailLength;
  const returning = memory.phase === "return" || deadlocked;

  /** Penalty for stepping onto a cell we've stood on recently — bigger the more recent. */
  function revisitPenalty(next: Vec2): number {
    for (let idx = recent.length - 1; idx >= 0; idx--) {
      if (!sameCell(recent[idx], next)) continue;
      const age = recent.length - 1 - idx; // 0 = current head, 1 = came-from
      return age <= 1 ? 0 : (RECENT_LEN - age) * REVISIT_WEIGHT;
    }
    return 0;
  }

  function score(dir: Direction): number {
    const next = { row: head.row + DELTA[dir].row, col: head.col + DELTA[dir].col };
    if (!inBounds(state.rowCount, state.colCount, next)) return p.offBoardPenalty;
    // A head-on stand-off with another boat is frozen by stepGame — a dead tick,
    // same as walking into the wall. Steer around it (this is also what keeps two
    // Surveyors meeting nose-to-nose from locking up forever).
    if (wouldStandOff(state, player, next)) return p.offBoardPenalty;
    // Never walk straight back onto the cell we just left — this is what stops the
    // two-cell toggle. Ranked below every real move but above going off the board.
    if (cameFrom && sameCell(cameFrom, next)) return BACKTRACK_PENALTY;

    const cell = grid[next.row][next.col];
    const distanceToHome = Math.abs(next.row - player.home.row) + Math.abs(next.col - player.home.col);
    let s = -revisitPenalty(next);

    if (returning) {
      // Beeline home; stepping onto our own colour with a wake out banks the loop.
      if (cell.kind === "trail" && cell.playerId === player.id) return s - distanceToHome;
      const banking = cell.kind === "territory" && cell.playerId === player.id && trailLen > 0;
      return banking ? s + p.closeLoopReward - distanceToHome : s - distanceToHome;
    }

    // --- extend leg: always graded, never a flat tie ---
    if (isAdjacentToRivalHead(state, player, next)) s += RIVAL_ADJ_PENALTY;

    if (cell.kind === "territory" && cell.playerId === player.id) {
      // On our own land: head for the nearest open water so a wake can (re)start.
      const toWater = Math.min(nearestNeutralDistance(grid, next, 24), 24);
      return s + TERRITORY_BASE - toWater * FRONTIER_SEEK;
    }
    if (cell.kind === "trail" && cell.playerId === player.id) {
      const toWater = Math.min(nearestNeutralDistance(grid, next, 24), 24);
      return s + TRAIL_BASE - toWater * FRONTIER_SEEK;
    }
    if (cell.kind === "trail") {
      s += CUT_BONUS; // a rival's wake — stepping on it cuts them, free value in passing
    }

    const ownedDist = nearestOwnedDistance(grid, player.id, next, p.maxTrailExposure + 6);
    if (isFrontierAdjacent(grid, player.id, next)) s += p.frontierHugBonus; // hug one cell out
    if (cell.kind === "neutral") s += p.neutralBonus; // prefer unclaimed water
    if (ownedDist > p.maxTrailExposure) s -= (ownedDist - p.maxTrailExposure) * EXPOSURE_WEIGHT;
    // Sweep toward this loop's aim sector — this is what varies the loop and drives
    // growth toward the board interior (and toward rivals) instead of one spike.
    if (memory.aim) s += (manhattan(head, memory.aim) - manhattan(next, memory.aim)) * AIM_PULL;
    s -= ownedDist * p.homePull; // faint pull back toward safe land
    s += Math.random() * p.jitter; // so two Surveyors don't lock-step
    return s;
  }

  let best: Direction = player.facing;
  let bestScore = -Infinity;
  for (const dir of ALL_DIRECTIONS) {
    const sc = score(dir);
    if (sc > bestScore) {
      bestScore = sc;
      best = dir;
    }
  }
  return best;
}

export const surveyor: BotStrategy = {
  type: "surveyor",
  label: "Surveyor",
  decide: (state, player, memory) => surveyorDecide(state, player, memory as SurveyorMemory),
  fields: SURVEYOR_PROFILE_FIELDS,
  defaultProfile: DEFAULT_BOT_PROFILE,
};
