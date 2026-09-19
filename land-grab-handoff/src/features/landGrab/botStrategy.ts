import { BOT_PROFILE_FIELDS, DEFAULT_BOT_PROFILE, type BotProfile, type BotProfileField } from "./botProfile";
import { ALL_DIRECTIONS, DELTA, OPPOSITE } from "./geometry";
import { wouldStandOff } from "./standoff";
import { createSurveyorMemory, surveyor, type SurveyorMemory } from "./surveyorStrategy";
import { createInvaderMemory, invader, type InvaderMemory } from "./invaderStrategy";
import type { GameState, PlayerState } from "./simulation";
import type { Direction, Vec2 } from "./types";

/**
 * Bot archetypes.
 *
 * Rollout in `docs/land-grab/bots.md`. Three registered: `"rambler"` (the original
 * greedy roamer, moved here verbatim), `"surveyor"` (the gradual-looping territory
 * farmer, in `surveyorStrategy.ts`), and `"invader"` (the raider that baits a
 * head-on stand-off then cuts on the dodge, in `invaderStrategy.ts`). Each is its
 * own module with its own `decide`, profile-field subset and memory shape.
 *
 * `simulation.ts` imports `strategyFor` / `createBotMemory` from here; this file
 * imports only *types* from `simulation.ts`, so there's no runtime cycle.
 */
export type BotType = "rambler" | "surveyor" | "invader";

/** Used whenever a `PlayerConfig` doesn't name an archetype. */
export const DEFAULT_BOT_TYPE: BotType = "rambler";

/**
 * Per-bot scratch space, tagged by archetype so each strategy owns its shape.
 * Rebuilt on spawn and every respawn (`respawnPlayer`). `stepGame` shares the
 * reference across ticks, so a strategy that needs state should mutate this bag
 * in place rather than expect a fresh copy each tick.
 *
 * The rambler is stateless; the surveyor keeps its `phase`, a short trail of
 * recent head cells, and a stuck counter here (see `surveyorStrategy.ts`); the
 * invader keeps its hunt/dodge/cut phase, current target and juke state (see
 * `invaderStrategy.ts`).
 */
export type BotMemory = { type: "rambler" } | SurveyorMemory | InvaderMemory;

export interface BotStrategy {
  type: BotType;
  /** Shown on the bot's card in the Profiles panel. */
  label: string;
  /**
   * Pick a facing for this tick. Pure: reads `state` and `player` (its own
   * `PlayerState`), never mutates the game state. May mutate `memory` in place.
   */
  decide(state: GameState, player: PlayerState, memory: BotMemory): Direction;
  /** Which `BotProfile` fields this archetype actually reads — drives which sliders the panel renders. */
  fields: BotProfileField[];
  defaultProfile: BotProfile;
}

/** A fresh scratch bag for a bot of `type`; called on spawn and every respawn. */
export function createBotMemory(type: BotType): BotMemory {
  switch (type) {
    case "surveyor":
      return createSurveyorMemory();
    case "invader":
      return createInvaderMemory();
    case "rambler":
    default:
      return { type: "rambler" };
  }
}

function inBounds(state: Pick<GameState, "rowCount" | "colCount">, cell: Vec2): boolean {
  return cell.row >= 0 && cell.row < state.rowCount && cell.col >= 0 && cell.col < state.colCount;
}

/**
 * The original Land Grab bot: greedy one-cell lookahead. Explores toward neutral
 * water until its wake reaches `homesickTrailLength`, then beelines home to close
 * the loop and bank a small capture. See `docs/land-grab/bots.md` →
 * "Archetype: the Rambler".
 *
 * Moved verbatim from `decideBotFacing` in `simulation.ts` — behaviour unchanged.
 */
function ramblerDecide(state: GameState, player: PlayerState): Direction {
  const p = player.profile;
  const candidates = ALL_DIRECTIONS.filter((d) => d !== OPPOSITE[player.facing] || player.trail.length === 0);
  const homesick = player.trail.length >= p.homesickTrailLength;

  function score(dir: Direction): number {
    const next = { row: player.head.row + DELTA[dir].row, col: player.head.col + DELTA[dir].col };
    // Board edge is just a wall now (the mover holds position), so it's merely
    // wasteful, not fatal — rank it well below any real move but above suicide.
    if (!inBounds(state, next)) return p.offBoardPenalty;
    // A head-on stand-off with another boat is frozen the same way — a dead tick.
    if (wouldStandOff(state, player, next)) return p.offBoardPenalty;
    const cell = state.grid[next.row][next.col];
    const distanceToHome = Math.abs(next.row - player.home.row) + Math.abs(next.col - player.home.col);
    // Crossing our own wake no longer banks anything — the loop only closes back
    // on our own territory. Homesick, treat the wake as clear path home; while
    // exploring, still steer clear so the trail doesn't tangle into itself.
    if (cell.kind === "trail" && cell.playerId === player.id) {
      return homesick ? -distanceToHome : p.earlyLoopPenalty;
    }
    if (homesick) {
      // Diving back onto our own colour with a trail out is the capture — pull
      // hard toward it once we're close.
      const banking = cell.kind === "territory" && cell.playerId === player.id && player.trail.length > 0;
      return banking ? p.closeLoopReward - distanceToHome : -distanceToHome;
    }
    const preferUnclaimed = cell.kind === "neutral" ? p.neutralBonus : 0;
    return preferUnclaimed - distanceToHome * p.homePull + Math.random() * p.jitter;
  }

  let best: Direction = candidates[0] ?? player.facing;
  let bestScore = -Infinity;
  for (const dir of candidates) {
    const s = score(dir);
    if (s > bestScore) {
      bestScore = s;
      best = dir;
    }
  }
  return best;
}

const rambler: BotStrategy = {
  type: "rambler",
  label: "Rambler",
  decide: ramblerDecide,
  fields: BOT_PROFILE_FIELDS,
  defaultProfile: DEFAULT_BOT_PROFILE,
};

export const BOT_STRATEGIES: Record<BotType, BotStrategy> = { rambler, surveyor, invader };

/** The strategy for `type`, falling back to the default archetype when it's unset. */
export function strategyFor(type: BotType | undefined): BotStrategy {
  return BOT_STRATEGIES[type ?? DEFAULT_BOT_TYPE];
}
