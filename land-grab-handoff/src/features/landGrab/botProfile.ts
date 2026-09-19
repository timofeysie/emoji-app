/**
 * A bot's decision parameters — everything `decideBotFacing` (in `simulation.ts`)
 * reads when it scores the four candidate directions each tick. One of these hangs
 * off every `PlayerState`; bots use it directly, and a human does too once their
 * profile has `autopilot` switched on.
 *
 * The demo's Profiles panel edits these live: a change lands on the next tick, no
 * restart needed. See `docs/land-grab/bots.md` for how the scorer uses each field.
 */
export interface BotProfile {
  /** Trail length at which the bot stops exploring and beelines for home. */
  homesickTrailLength: number;
  /** Score for a move that leaves the board — a non-lethal wall, just a wasted tick. */
  offBoardPenalty: number;
  /** Score for crossing your own wake while still exploring — keeps the trail from tangling into itself. */
  earlyLoopPenalty: number;
  /** Bonus for diving back onto your own territory once homesick — this closes the loop and banks the capture. */
  closeLoopReward: number;
  /** Bonus added when the target cell is unclaimed neutral water (explore mode only). */
  neutralBonus: number;
  /** Weight of the pull back toward home while exploring, multiplied by Manhattan distance. */
  homePull: number;
  /** Upper bound of the random jitter (0..jitter) added to every explore-mode score. */
  jitter: number;
  // --- Surveyor archetype (see `surveyorStrategy.ts` / `docs/land-grab/bots.md`) ---
  /** Surveyor: hard cap on how far the head may get from owned land while extending. */
  maxTrailExposure: number;
  /** Surveyor: wake length that triggers the fold-back / return leg. */
  targetTrailLength: number;
  /** Surveyor: pull toward keeping the head exactly one cell outside own territory. */
  frontierHugBonus: number;
  /** Surveyor: bail to the return leg once a rival head gets this close (Manhattan). */
  rivalAvoidRadius: number;
  // --- Invader archetype (see `invaderStrategy.ts` / `docs/land-grab/bots.md`) ---
  /** Invader: along-line gap to the target at which `hunt` flips to `dodge`. */
  engageDistance: number;
  /** Invader: perpendicular steps the juke lasts before switching to `cut`. */
  dodgeDistance: number;
  /** Invader: how far the `cut` phase will chase a rival wake before regrouping. */
  cutSearchRadius: number;
  /** Invader: hard cap on ticks in one phase before falling back to `regroup` — the anti-deadlock guard. */
  commitLimit: number;
}

export const DEFAULT_BOT_PROFILE: BotProfile = {
  homesickTrailLength: 9,
  offBoardPenalty: -1000,
  earlyLoopPenalty: -20,
  closeLoopReward: 1,
  neutralBonus: 2,
  homePull: 0.01,
  jitter: 0.5,
  maxTrailExposure: 5,
  targetTrailLength: 10,
  frontierHugBonus: 3,
  rivalAvoidRadius: 3,
  engageDistance: 3,
  dodgeDistance: 1,
  cutSearchRadius: 4,
  commitLimit: 10,
};

export function cloneProfile(profile: BotProfile): BotProfile {
  return { ...profile };
}

export interface BotProfileField {
  key: keyof BotProfile;
  label: string;
  min: number;
  max: number;
  step: number;
  /** One-line explanation of what moving this slider does. */
  hint: string;
}

/** Drives the sliders in the Profiles panel; order here is the display order. */
export const BOT_PROFILE_FIELDS: BotProfileField[] = [
  {
    key: "homesickTrailLength",
    label: "Homesick trail length",
    min: 2,
    max: 40,
    step: 1,
    hint: "Wake length at which the bot quits exploring and heads straight home. Higher → bigger, riskier loops.",
  },
  {
    key: "neutralBonus",
    label: "Neutral-cell bonus",
    min: 0,
    max: 10,
    step: 0.5,
    hint: "How strongly the bot prefers unclaimed water over already-owned cells while exploring. Must stay above the jitter to be reliable.",
  },
  {
    key: "jitter",
    label: "Random jitter",
    min: 0,
    max: 5,
    step: 0.1,
    hint: "Randomness added to each explore-mode score. 0 makes the bots trace near-identical paths from symmetric corners.",
  },
  {
    key: "homePull",
    label: "Home pull",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "Bias back toward the home base while exploring (× Manhattan distance). Raise it to keep the bot hugging its corner.",
  },
  {
    key: "closeLoopReward",
    label: "Close-loop reward",
    min: -5,
    max: 20,
    step: 0.5,
    hint: "Pull toward diving back onto your own territory once homesick — this is what closes the loop and banks the capture.",
  },
  {
    key: "earlyLoopPenalty",
    label: "Early-loop penalty",
    min: -100,
    max: 0,
    step: 1,
    hint: "Penalty for steering back across your own wake while exploring. More negative → the trail stays untangled.",
  },
  {
    key: "offBoardPenalty",
    label: "Off-board penalty",
    min: -2000,
    max: 0,
    step: 10,
    hint: "Penalty for steering into the board edge. The edge is a non-lethal wall, so this only needs to rank below any real move.",
  },
];

/** The four Surveyor-only knobs, defined for the panel (Phase 4 wires them onto the Surveyor cards). */
export const SURVEYOR_EXTRA_FIELDS: BotProfileField[] = [
  {
    key: "maxTrailExposure",
    label: "Max trail exposure",
    min: 1,
    max: 20,
    step: 1,
    hint: "Hard cap on how far the head may drift from owned land while extending. Lower → safer, slower growth.",
  },
  {
    key: "targetTrailLength",
    label: "Target trail length",
    min: 4,
    max: 40,
    step: 1,
    hint: "Wake length that triggers the fold-back. Higher → bigger loops, more exposure.",
  },
  {
    key: "frontierHugBonus",
    label: "Frontier-hug bonus",
    min: 0,
    max: 10,
    step: 0.5,
    hint: "Pull toward keeping the head one cell outside your own territory, so the closed loop encloses a thick strip.",
  },
  {
    key: "rivalAvoidRadius",
    label: "Rival-avoid radius",
    min: 0,
    max: 12,
    step: 1,
    hint: "Bail straight to the return leg once a rival head gets this close (Manhattan distance).",
  },
];

/**
 * Fields the Surveyor archetype actually reads: the four knobs above plus every
 * Rambler field except `homesickTrailLength` (the Surveyor uses `targetTrailLength`
 * instead). Order here is the panel display order.
 */
export const SURVEYOR_PROFILE_FIELDS: BotProfileField[] = [
  ...SURVEYOR_EXTRA_FIELDS,
  ...BOT_PROFILE_FIELDS.filter((f) => f.key !== "homesickTrailLength"),
];

/** The four Invader-only knobs, defined for the panel. */
export const INVADER_EXTRA_FIELDS: BotProfileField[] = [
  {
    key: "engageDistance",
    label: "Engage distance",
    min: 1,
    max: 8,
    step: 1,
    hint: "Along-line gap to the target at which the Invader stops closing and jukes sideways. Lower → later, riskier dodge.",
  },
  {
    key: "dodgeDistance",
    label: "Dodge distance",
    min: 1,
    max: 3,
    step: 1,
    hint: "How many cells the sideways juke covers before the Invader curls back to cut. Wider → more room, slower cut.",
  },
  {
    key: "cutSearchRadius",
    label: "Cut search radius",
    min: 1,
    max: 10,
    step: 1,
    hint: "How far the Invader will chase the target's fresh wake to cut it before giving up and regrouping.",
  },
  {
    key: "commitLimit",
    label: "Commit limit",
    min: 3,
    max: 30,
    step: 1,
    hint: "Hard cap on ticks spent in one phase before bailing to a regroup. The anti-deadlock guard — raise it for a more stubborn hunter.",
  },
];

/**
 * Fields the Invader archetype actually reads: the four knobs above plus the
 * shared movement/scoring knobs it borrows (`neutralBonus`, `jitter`, `homePull`,
 * `closeLoopReward`, `offBoardPenalty`). Order here is the panel display order.
 */
export const INVADER_PROFILE_FIELDS: BotProfileField[] = [
  ...INVADER_EXTRA_FIELDS,
  ...BOT_PROFILE_FIELDS.filter((f) =>
    (["neutralBonus", "jitter", "homePull", "closeLoopReward", "offBoardPenalty"] as (keyof BotProfile)[]).includes(f.key),
  ),
];
