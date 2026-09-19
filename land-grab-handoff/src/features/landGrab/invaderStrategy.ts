import { INVADER_PROFILE_FIELDS, DEFAULT_BOT_PROFILE } from "./botProfile";
import { ALL_DIRECTIONS, DELTA } from "./geometry";
import { wouldStandOff } from "./standoff";
import type { CellState } from "./grid";
import type { BotStrategy } from "./botStrategy";
import type { GameState, PlayerState } from "./simulation";
import type { Direction, Vec2 } from "./types";

/**
 * The Invader — the offensive archetype. Where the Rambler roams and the Surveyor
 * farms, the Invader hunts a rival, deliberately lines up a head-on "game of
 * chicken" on a shared row or column, then jukes sideways at the last moment and
 * curls back onto the rival's fresh wake to cut them.
 *
 * It leans on the head-on stand-off rule in `stepGame`: two boats driving
 * straight at each other both freeze — neither captures. So a pure ram never
 * wins. The Invader instead approaches head-on to *bait* the stand-off, dodges
 * out of it one tick early, and takes the cut as the rival sails past.
 *
 * Four phases held in `botMemory`:
 *  - `hunt`    — close on the nearest living rival and get onto its row/column,
 *                facing it, until the gap is inside `engageDistance`.
 *  - `dodge`   — step perpendicular to the approach axis for `dodgeDistance`
 *                ticks, breaking out of the impending stand-off.
 *  - `cut`     — steer onto the nearest rival wake (that step *is* the capture,
 *                `stepGame` resolves it); give up after `commitLimit` ticks.
 *  - `regroup` — beeline home, bank any wake, then re-arm and hunt again.
 *
 * Still a greedy one-cell lookahead — argmax over the four directions, no search.
 * Imports only *types* from `botStrategy.ts` / `simulation.ts`, so there's no
 * runtime cycle. See `docs/land-grab/bots.md` → "Archetype: the Invader".
 */
export interface InvaderMemory {
  type: "invader";
  phase: "hunt" | "dodge" | "cut" | "regroup";
  /** The rival currently being hunted; re-picked each tick while hunting/regrouping. */
  targetId: string | null;
  /** Shared line captured when `hunt` flips to `dodge`: `"row"` = same row, juke vertically. */
  axis: "row" | "col" | null;
  /** Perpendicular steps left in the current dodge; hits 0 → `cut`. */
  dodgeStepsLeft: number;
  /** Recent head cells, oldest first — bans immediate backtracking and 2-cell orbits. */
  recent: Vec2[];
  /** Ticks spent in the current phase; trips the fall-back to `regroup`. */
  commitTicks: number;
}

/** A fresh Invader scratch bag; called on spawn and every respawn. */
export function createInvaderMemory(): InvaderMemory {
  return { type: "invader", phase: "hunt", targetId: null, axis: null, dodgeStepsLeft: 0, recent: [], commitTicks: 0 };
}

// --- Tuning constants. The four BotProfile knobs (engageDistance, dodgeDistance,
// cutSearchRadius, commitLimit) stay panel-editable; these shape the scoring
// gradients and don't need a slider. ---
/** How many past head cells to remember for anti-backtracking / orbit-breaking. */
const RECENT_LEN = 8;
/** Score hit for revisiting a remembered cell, scaled by how recent the visit was. */
const REVISIT_WEIGHT = 5;
/** Score for stepping straight back onto the cell we just left. Below any real move. */
const BACKTRACK_PENALTY = -300;
/** Score hit for crossing our own wake — tangles the loop, but not forbidden. */
const OWN_TRAIL_CROSS = -10;
/** Landing on a rival's wake is the capture — this dominates every other term. */
const CUT_REWARD = 60;
/** Extra pull toward cutting the specific rival we set out to hunt. */
const TARGET_CUT_BONUS = 20;
/** `hunt`: per-step reward for shrinking the offset onto the target's row/column. */
const ALIGN_PULL = 4;
/** `hunt`: per-step reward for closing the remaining distance to the target. */
const CLOSE_PULL = 2;
/** `dodge`: reward for a step perpendicular to the approach axis (penalty for one along it). */
const DODGE_PERP = 12;
/** `cut`: per-step reward for closing on the nearest rival wake. */
const CUT_SEEK = 6;
/** `regroup`: bonus for the step that banks the wake back onto owned land. */
const BANK_BONUS = 5;

function inBounds(rowCount: number, colCount: number, cell: Vec2): boolean {
  return cell.row >= 0 && cell.row < rowCount && cell.col >= 0 && cell.col < colCount;
}

function sameCell(a: Vec2, b: Vec2): boolean {
  return a.row === b.row && a.col === b.col;
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function isOwnedTerritory(grid: CellState[][], playerId: string, cell: Vec2): boolean {
  const g = grid[cell.row]?.[cell.col];
  return !!g && g.kind === "territory" && g.playerId === playerId;
}

/** The living rival whose head is closest (Manhattan) to `player`'s head; `null` if alone. */
export function nearestLivingRival(state: GameState, player: PlayerState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDist = Infinity;
  for (const id of state.playerOrder) {
    if (id === player.id) continue;
    const rival = state.players[id];
    if (!rival || !rival.alive) continue;
    const d = manhattan(rival.head, player.head);
    if (d < bestDist) {
      bestDist = d;
      best = rival;
    }
  }
  return best;
}

/**
 * The shared line between two heads: `"row"` when they sit on the same row (and
 * differ in column), `"col"` for the same column, `null` when neither holds.
 */
export function alignmentAxis(a: Vec2, b: Vec2): "row" | "col" | null {
  if (a.row === b.row && a.col !== b.col) return "row";
  if (a.col === b.col && a.row !== b.row) return "col";
  return null;
}

/**
 * 4-connected step distance from `cell` to the nearest wake cell belonging to any
 * player other than `playerId`, pathing through anything in between. Bounded:
 * gives up after `maxRadius` rings and returns `Infinity`. `cell` itself is
 * distance 0 when it already holds a rival wake.
 */
export function nearestRivalTrailDistance(
  grid: CellState[][],
  playerId: string,
  cell: Vec2,
  maxRadius = 16,
): number {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  if (!inBounds(rowCount, colCount, cell)) return Infinity;
  const here = grid[cell.row][cell.col];
  if (here.kind === "trail" && here.playerId !== playerId) return 0;

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
        const g = grid[n.row][n.col];
        if (g.kind === "trail" && g.playerId !== playerId) return dist;
        next.push(n);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return Infinity;
}

function invaderDecide(state: GameState, player: PlayerState, memory: InvaderMemory): Direction {
  const p = player.profile;
  const grid = state.grid;
  const head = player.head;
  const trailLen = player.trail.length;
  const cutRadius = Math.max(1, Math.round(p.cutSearchRadius));
  const commitLimit = Math.max(1, Math.round(p.commitLimit));

  // --- anti-oscillation memory ---
  const recent = memory.recent;
  if (recent.length === 0 || !sameCell(recent[recent.length - 1], head)) {
    recent.push({ row: head.row, col: head.col });
    if (recent.length > RECENT_LEN) recent.shift();
  }
  const cameFrom = recent.length >= 2 ? recent[recent.length - 2] : null;

  // --- target selection: opportunistic while hunting/regrouping, locked once committed ---
  if (memory.phase === "hunt" || memory.phase === "regroup") {
    memory.targetId = nearestLivingRival(state, player)?.id ?? null;
  }
  let target = memory.targetId ? state.players[memory.targetId] ?? null : null;
  if (target && !target.alive) target = null;

  // --- phase arbitration ---
  memory.commitTicks += 1;
  switch (memory.phase) {
    case "regroup": {
      if (trailLen === 0 && isOwnedTerritory(grid, player.id, head)) {
        memory.phase = "hunt";
        memory.commitTicks = 0;
      }
      break;
    }
    case "hunt": {
      const axis = target ? alignmentAxis(head, target.head) : null;
      if (target && axis) {
        const gap =
          axis === "row" ? Math.abs(head.col - target.head.col) : Math.abs(head.row - target.head.row);
        const facingDelta = DELTA[player.facing];
        const facingToward =
          axis === "row"
            ? facingDelta.col !== 0 && Math.sign(target.head.col - head.col) === facingDelta.col
            : facingDelta.row !== 0 && Math.sign(target.head.row - head.row) === facingDelta.row;
        if (gap >= 1 && gap <= Math.max(1, Math.round(p.engageDistance)) && facingToward) {
          memory.phase = "dodge";
          memory.axis = axis;
          memory.dodgeStepsLeft = Math.max(1, Math.round(p.dodgeDistance));
          memory.commitTicks = 0;
        }
      }
      if (memory.phase === "hunt" && memory.commitTicks > commitLimit * 2) {
        memory.phase = "regroup";
        memory.commitTicks = 0;
      }
      break;
    }
    case "dodge": {
      memory.dodgeStepsLeft -= 1;
      if (memory.dodgeStepsLeft <= 0) {
        memory.phase = "cut";
        memory.commitTicks = 0;
      }
      break;
    }
    case "cut": {
      if (memory.commitTicks > commitLimit) {
        memory.phase = "regroup";
        memory.commitTicks = 0;
      }
      break;
    }
  }

  const phase = memory.phase;

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
    if (cameFrom && sameCell(cameFrom, next)) return BACKTRACK_PENALTY;
    // A head-on stand-off is frozen by stepGame before any capture resolves — a
    // dead tick. The Invader baits the stand-off but takes the cut by dodging
    // *around* it, never by driving into it.
    if (wouldStandOff(state, player, next)) return p.offBoardPenalty;

    const cell = grid[next.row][next.col];
    let s = -revisitPenalty(next);

    // A rival wake under the head is a capture no matter the phase — take it.
    if (cell.kind === "trail" && cell.playerId !== player.id) {
      return s + CUT_REWARD + (cell.playerId === memory.targetId ? TARGET_CUT_BONUS : 0);
    }
    if (cell.kind === "trail" && cell.playerId === player.id) s += OWN_TRAIL_CROSS;

    if (phase === "regroup") {
      const dHome = manhattan(next, player.home);
      const banking = trailLen > 0 && isOwnedTerritory(grid, player.id, next);
      return banking ? s + p.closeLoopReward + BANK_BONUS - dHome : s - dHome;
    }

    if (phase === "dodge" && memory.axis) {
      const perpendicular = memory.axis === "row" ? dir === "up" || dir === "down" : dir === "left" || dir === "right";
      s += perpendicular ? DODGE_PERP : -DODGE_PERP;
      if (cell.kind === "neutral") s += p.neutralBonus;
      return s + Math.random() * p.jitter;
    }

    if (phase === "cut") {
      const d = nearestRivalTrailDistance(grid, player.id, next, cutRadius);
      if (d !== Infinity) s += (cutRadius + 1 - d) * CUT_SEEK;
      else s -= manhattan(next, head); // nothing to cut nearby — drift; commitLimit will regroup us
      return s + Math.random() * p.jitter * 0.5;
    }

    // phase === "hunt"
    if (target) {
      const alignBefore = Math.min(Math.abs(head.row - target.head.row), Math.abs(head.col - target.head.col));
      const alignAfter = Math.min(Math.abs(next.row - target.head.row), Math.abs(next.col - target.head.col));
      s += (alignBefore - alignAfter) * ALIGN_PULL;
      s += (manhattan(head, target.head) - manhattan(next, target.head)) * CLOSE_PULL;
    }
    if (cell.kind === "neutral") s += p.neutralBonus * 0.5;
    s -= manhattan(next, player.home) * p.homePull;
    return s + Math.random() * p.jitter;
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

export const invader: BotStrategy = {
  type: "invader",
  label: "Invader",
  decide: (state, player, memory) => invaderDecide(state, player, memory as InvaderMemory),
  fields: INVADER_PROFILE_FIELDS,
  defaultProfile: DEFAULT_BOT_PROFILE,
};
