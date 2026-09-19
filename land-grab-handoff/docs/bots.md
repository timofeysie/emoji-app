# Land Grab — Bots

How the computer-controlled boats in `src/features/landGrab/LandGrabDemo.tsx` choose
their moves. This is a companion to the [`### Bots`](land-grab.md#bots) summary in
the main plan — same behaviour, more detail.

> **Archetypes now split.** A default match is **one Rambler (Yellow) vs. one Invader
> (Red) vs. one Surveyor (Green) vs. the human** — one of each. The Rambler is the original
> greedy roamer described throughout the first half of this doc; the Surveyor is the
> deliberate territory farmer in
> [Archetype: the Surveyor](#archetype-the-surveyor-the-goal-oriented-farmer-green);
> the Invader is the raider in [Archetype: the Invader](#archetype-the-invader-the-raider-red)
> that baits a head-on stand-off and cuts on the dodge. All three run through the same
> one-call-per-tick registry — see [Bot types](#bot-types-solution-architecting).

> **Head-on stand-off (movement rule, all boats).** When two boats' moves would collide
> on a tick — swap cells driving straight at each other, or both push into the same cell —
> `stepGame` freezes *both*: no move, no trail laid, no trail cut. A face-off can't be won
> by ramming. Every bot scorer treats a move into a stand-off like the board edge (a dead
> tick) via `wouldStandOff` in `standoff.ts`, so bots peel out of a face-off rather than
> lock up; the Invader turns the rule into its whole game plan.

## Table of contents

- [TL;DR](#tldr)
- [The three bots](#the-three-bots)
- [Head-on stand-off](#head-on-stand-off)
- [The Rambler brain: `decideBotFacing`](#the-rambler-brain-decidebotfacing)
- [The scoring function](#the-scoring-function)
- [Behavioural phases](#behavioural-phases)
- [Tie-breaking and randomness](#tie-breaking-and-randomness)
- [What the bots deliberately don't do](#what-the-bots-deliberately-dont-do)
- [Bot types: solution architecting](#bot-types-solution-architecting)
- [Tuning them live in the demo](#tuning-them-live-in-the-demo)
- [Tuning knobs](#tuning-knobs)

## TL;DR

Every living bot picks a move the same way: each tick it scores the (up to four)
directions it could turn with a greedy one-cell lookahead and takes the
highest-scoring one — no pathfinding, and only the Invader keeps any model of another
player. `decideBotFacing` (`src/features/landGrab/simulation.ts`) is now a one-line
dispatch to the bot's **archetype**, registered in `botStrategy.ts`:

- **Rambler** (the Yellow boat) — the original brain, described in the sections below.
  Sails out laying wake; once its trail reaches `homesickTrailLength` (9) cells it turns
  "homesick" and beelines back to its own territory to close the loop and bank a modest
  capture, then repeats. Crossing its own wake does nothing — the loop only closes on
  home turf.
- **Surveyor** (the Green boat) — a goal-oriented territory farmer. Each loop
  lays a wake from its frontier out toward a fresh centre-biased `aim` point (bearing
  rotated per loop), then folds it back in once the wake hits `targetTrailLength`, reaches
  `aim`, or a rival becomes a real threat. Graded scoring with a real gradient and a
  no-backtrack rule mean it never toggles between two squares or spins one fixed orbit;
  the centre bias makes two Surveyors grow toward each other so a bot match resolves. See
  [Archetype: the Surveyor](#archetype-the-surveyor-the-goal-oriented-farmer-green).
- **Invader** (the Red boat) — the offensive archetype. Barely farms at all: it hunts
  the nearest living rival, gets onto its row or column facing it, and closes until the
  gap is inside `engageDistance`. Then it **jukes** perpendicular for `dodgeDistance`
  ticks — sliding out of the impending stand-off — and switches to **cut**, steering onto
  the rival's fresh wake (that step is the capture). If the cut doesn't land inside
  `commitLimit` ticks it beelines home to regroup and picks a new target. See
  [Archetype: the Invader](#archetype-the-invader-the-raider-red).

## The three bots

Defined by `PLAYER_CONFIGS` in `LandGrabDemo.tsx`. All four players (you + three bots)
obey identical game rules; `isBot` only decides *who picks the moves*, and `botType`
decides *which archetype* picks them (`undefined` → `"rambler"`).

| id | Label | Colour | Archetype | Start corner (default 16×24 board) |
| --- | --- | --- | --- | --- |
| `bot-red` | Red Invader | `#f87171` | `invader` | bottom-right — `(12, 19)` |
| `bot-yellow` | Yellow Rambler | `#facc15` | `rambler` | top-right — `(3, 19)` |
| `bot-green` | Green Surveyor | `#4ade80` | `surveyor` | bottom-left — `(12, 4)` |

The label is static (set in `PLAYER_CONFIGS`); switching a bot's archetype live from the
Profiles panel changes its behaviour and its card badge but not its name.

(You, `#38bdf8`, take the top-left corner `(3, 4)`.) Corners come from `startingSpots`
in `simulation.ts`, inset from the edges by `max(2, floor(rows/5))` rows and
`max(2, floor(cols/5))` cols.

Every player also carries a **`profile`** (`BotProfile`, from `botProfile.ts`) — the
seven numbers `decideBotFacing` scores moves against. Bots use it directly; a human's
profile only matters once **autopilot** is switched on for them. All four start on a
clone of `DEFAULT_BOT_PROFILE`; the demo's Profiles panel edits each one independently
and live (see [Tuning them live](#tuning-them-live-in-the-demo)).

Bot-specific lifecycle details:

- **Bots start on tick 1.** `hasStarted` is initialised to `config.isBot || autopilot`,
  so bots (and an autopiloted human) move immediately while a manual boat sits on its
  base until the first keypress. Same after a respawn.
- Each tick `stepGame` calls `decideBotFacing` for every living bot and writes the
  result straight into `player.queuedFacing`, overwriting whatever was there. So the
  input-buffering rules that matter for a human ("only the most recent queued turn is
  kept") are moot for bots — they re-decide from scratch every tick.

## Head-on stand-off

A movement rule that every boat — bot or human — plays by, enforced in `stepGame` and
understood by all three scorers.

**The rule.** Boats resolve one at a time in `state.playerOrder`. Before that loop runs,
`stepGame` scans every started boat's intended cell for this tick and flags any pair that
would **collide**:

- **Swap** — `A.next === B.head` *and* `B.next === A.head`: they're nose-to-nose and would
  drive through each other.
- **Same cell** — `A.next === B.next`: two (or more) boats push into one square.

Every flagged boat is frozen for the tick: it keeps its facing but does **not** move, lay
trail, or cut anything. It stays blocked until it or the other boat steers a different
way. A face-off therefore cannot be won by ramming — without this, the boat that happens
to resolve first just cuts the other's wake and captures them.

The geometry lives in `src/features/landGrab/standoff.ts` (`intendedNext`, `isStandoff`,
`wouldStandOff`), shared by `stepGame` (which enforces it) and the strategies (which read
`wouldStandOff(state, player, next)` and score that move like the board edge — a wasted
tick). That last part matters: two stand-off-*unaware* bots meeting nose-to-nose would
both keep picking "forward" and lock up forever. With the guard they peel away, and a
bot-only match always resolves.

**Exploiting it.** The [Invader](#archetype-the-invader-the-raider-red) baits the
stand-off on purpose: it lines up head-on, then side-steps one tick before contact and
curls back onto the rival's wake as they sail past — a cut the frozen ram could never
land.

## The Rambler brain: `decideBotFacing`

> This section and the two after it ([The scoring function](#the-scoring-function),
> [Behavioural phases](#behavioural-phases)) describe the **Rambler** archetype —
> the Yellow boat, and the default when `botType` is unset. `decideBotFacing` in
> `simulation.ts` is now just `strategyFor(player.botType).decide(state, player,
> player.botMemory)`; the code below lives in `botStrategy.ts` as `ramblerDecide`.
> The Surveyor's procedure is in
> [Archetype: the Surveyor](#archetype-the-surveyor-the-goal-oriented-farmer-green).

```ts
function ramblerDecide(state: GameState, player: PlayerState): Direction
```

Called from `stepGame` against a `scratchState` (the grid *after* respawns have been
placed for this tick). Procedure:

1. **Build the candidate list.** All four directions, minus a straight 180° reversal —
   unless the trail is empty, in which case reversing is allowed.
   `candidates = ALL_DIRECTIONS.filter(d => d !== OPPOSITE[facing] || trail.length === 0)`.
2. **Set the `homesick` flag:** `player.trail.length >= p.homesickTrailLength` (default 9),
   where `p = player.profile`.
3. **Score every candidate** with the nested `score(dir)` (below).
4. **Take the max.** The loop uses a strict `>` seeded at `-Infinity`, so on an exact
   tie the earliest candidate in `["up", "down", "left", "right"]` order wins. Fallback
   if `candidates` is somehow empty: keep the current `facing`.

## The scoring function

Every literal below is a field of `player.profile` (`p`); the parenthesised number is
the `DEFAULT_BOT_PROFILE` value.

```ts
function score(dir: Direction): number {
  const p = player.profile;
  const next = { row: player.head.row + DELTA[dir].row, col: player.head.col + DELTA[dir].col };

  // Off the board: the edge is a wall (the mover just holds position), so this is
  // only a wasted tick — ranked far below any real move but above suicide.
  if (!inBounds(state, next)) return p.offBoardPenalty;                 // -1000

  const cell = state.grid[next.row][next.col];
  const distanceToHome = Math.abs(next.row - player.home.row) + Math.abs(next.col - player.home.col);

  // Our own wake: crossing it no longer banks anything — the loop closes only
  // back on our own territory. Homesick → it's just clear path home; exploring →
  // steer away so the trail doesn't tangle into itself.
  if (cell.kind === "trail" && cell.playerId === player.id)
    return homesick ? -distanceToHome : p.earlyLoopPenalty;            // -20

  if (homesick) {
    // Diving onto our own colour with a trail still out IS the capture.
    const banking = cell.kind === "territory" && cell.playerId === player.id && player.trail.length > 0;
    return banking ? p.closeLoopReward - distanceToHome : -distanceToHome; // +1 bonus
  }

  const preferUnclaimed = cell.kind === "neutral" ? p.neutralBonus : 0; // 2
  return preferUnclaimed - distanceToHome * p.homePull + Math.random() * p.jitter; // 0.01, 0.5
}
```

Reading the exploration-mode score (`neutralBonus - distanceToHome * homePull + random*jitter`),
at defaults:

- **Neutral cells always beat non-neutral ones.** The `neutralBonus` gap is `2`; the
  random jitter maxes out at `0.5`, so it can never flip that ordering — *unless you raise
  `jitter` above `neutralBonus` in the panel*, at which point neutral-seeking stops being
  reliable.
- **Among cells of the same kind, the choice is essentially random.** The jitter (0–0.5)
  dwarfs the distance-to-home term (`homePull` = 0.01), which only acts as a faint
  tie-breaker nudging the bot back toward base. The jitter is there so the three bots
  don't move in lockstep.
- Own territory, enemy territory, and enemy trail all score the same (`preferUnclaimed = 0`) —
  the bot draws no distinction between them.

## Behavioural phases

A **Rambler**'s life cycles through two states, gated purely on trail length (the
**Surveyor** has its own `extend` / `return` cycle — see
[its archetype section](#archetype-the-surveyor-the-goal-oriented-farmer-green)):

| Phase | Condition | Behaviour |
| --- | --- | --- |
| **Explore** | `trail.length < 9` | Wander toward neutral water, jittered, with a 0.01-weight pull back toward home. Still *avoids* its own wake (`-20`) so the trail doesn't tangle into itself. |
| **Homesick** | `trail.length >= 9` | Ignore neutral/claimed distinctions. Score each move as `-Manhattan(next, home)` → a straight beeline for the base, crossing its own wake freely along the way. Stepping onto its own **territory** while a trail is out adds `closeLoopReward` (`+1`) — that dive back onto home turf is what closes the loop and banks the capture. |

So the loop a Rambler draws is: strike out ~9 cells into open water, then beeline home
and close the loop by re-entering its own territory. Captures are small and
frequent rather than large and risky — matching the "simplest useful bot" described in
the plan's [Open questions](land-grab.md#open-questions).

## Tie-breaking and randomness

- **Non-deterministic.** `Math.random()` is called in every exploration-mode score and
  is not seeded, so a bot's path differs run to run even from an identical board. (The
  unit tests in `src/test/` cover the pure grid/capture/split logic, not bot paths, so
  this doesn't make the suite flaky.)
- **Homesick mode is deterministic** apart from the board state: scores are small
  integers, and exact ties resolve by `up > down > left > right` candidate order.
- The `-1000` (off-board) and `-20` (explore-mode self-cross) sentinels are only ever
  chosen when *every* candidate is that bad — e.g. boxed into a corner by its own trail.

## What the bots deliberately don't do

Scoped to the **Rambler**. The AI is intentionally minimal: **no model of the other
players**, **no lookahead past one cell**. The Surveyor chips at the first three of
these — a hard exposure cap, a "don't step next to a rival head" guard, and an early
return when a rival closes — but still has no real offence and no multi-cell search. The
**Invader** breaks the first two outright: it *is* offence, it tracks a specific rival's
head and wake, and it predicts one tick ahead to time its dodge (`wouldStandOff` plus the
`hunt → dodge → cut` phase machine). It still has no search deeper than that. In
particular the Rambler has:

- **No offence.** It never steers toward an opponent's trail to cut them, even though a
  cut captures both wakes and every cell that player owned into one connected bridge and
  sinks them. Enemy trail scores the same as any other non-neutral cell.
- **No evasion.** It doesn't dodge opponents' heads or trails, and doesn't avoid driving
  through enemy territory (which is legal — you plow trail straight through it).
- **No self-trap avoidance** beyond the single adjacent cell. A bot can wander its own
  wake into a shape it then has to break out of; the homesick beeline is the only
  recovery mechanism.
- **No capture-area optimisation.** Once homesick it takes the shortest path back, not
  the path that would enclose the most ground.
- **No collision prediction.** Move resolution is order-dependent (`state.playerOrder`),
  and the bot doesn't account for where anyone else will be after this tick — beyond the
  shared `wouldStandOff` guard that keeps it from driving into a frozen face-off.

This is by design — Phase 0 only needs bots good enough to exercise the capture-fill and
split-resolution algorithms, not to be challenging opponents. The Invader is the first
archetype written to actually pressure the human.

## Bot types: solution architecting

> **Status:** Phases 2–5 have landed — see [Rollout plan](#rollout-plan). The
> `BotStrategy` interface, the `BOT_STRATEGIES` registry, the `decideBotFacing`
> dispatcher and the per-bot `botMemory` bag live in
> `src/features/landGrab/botStrategy.ts`; `"rambler"` (today's roamer, moved there
> verbatim), `"surveyor"` (`surveyorStrategy.ts`, the gradual-looping farmer) and
> `"invader"` (`invaderStrategy.ts`, the head-on raider) are all registered. The default
> match runs one of each: Yellow `"rambler"`, Red `"invader"`, Green `"surveyor"`. The
> Profiles panel names each driven card's archetype, renders only that archetype's
> `fields`, and has a per-card **Archetype** dropdown that hot-swaps the strategy
> mid-match (rebuilding the bot's `botMemory`). Only [later archetypes](#later-archetypes-sketch)
> remain.

### Why one brain is no longer enough

The capture rules changed underneath the bot AI:

- **Loops only close on your own colour.** Crossing your own wake is now a no-op, so a
  capture is a deliberate round trip: strike out, then get *all the way back* onto
  owned land. Small, frequent, near-home loops are cheap; large deliberate enclosures
  are where the board is actually won.
- **Cutting a rival's trail is a full capture + bridge.** The victim's wake, your wake,
  and every cell the victim owned all flip to your colour in one connected blob, and
  the victim must respawn. Offence is now enormously valuable — and being caught with a
  long exposed wake is now fatal, not just wasteful.
- **Losing your whole blob is death.** If a rival's capture fill encloses and flips
  *every* cell you own, you're sunk at the end of that tick and respawn — no land means
  no way to close a loop. A Surveyor that lets its frontier get walled off doesn't just
  stall, it dies; the exposure guard and rival-avoid trigger exist partly to prevent
  this.
- **The match ends.** A player who owns the whole board, or is the last boat afloat with
  nowhere for the dead to respawn, wins and the sim freezes (`GameState.winnerId`).
  "Roam forever banking tiny loops" no longer converges on a win.

The current bot — see [the Rambler](#archetype-the-rambler-todays-bot-yellow-keeps-it)
— copes but plateaus: it never consolidates a big region, never re-uses its own bridge,
never hunts a trail, and wanders through contested water trailing an exposed wake that a
human (or a future offensive bot) can cut for a landslide. We want a **small set of
archetypes with explicit, different goals** so that:

1. matches have texture (a farmer, a raider, a baseline roamer behave visibly differently);
2. the capture-fill and split-resolution code gets exercised by more varied play than
   one greedy scorer produces;
3. the human has something to actually play against.

### Design constraints the archetypes must respect

Whatever the structure, keep the properties that make the current bot layer testable and
cheap:

- **One decision call per living bot per tick**, signature stays
  `(state, player) => Direction`. No multi-tick planning that can't be re-derived from
  the current `GameState`.
- **Pure w.r.t. the sim.** A bot reads `GameState` and its own `PlayerState`; it must not
  mutate either. `stepGame` writes the result into `player.queuedFacing`.
- **Greedy one-cell lookahead is still the default.** An archetype may add a *cheap*
  objective (a couple of scalars in scratch memory) but not a search.
- **Profiles stay live-editable** from the panel, applied on the next tick, no restart.
- **Deterministic apart from `Math.random()` and board state**, so unit tests can target
  any new pure helpers directly (the way `src/test/` covers grid/capture/split today).
- **Back-compatible.** `PlayerConfig` with no type behaves exactly as now; existing tests
  and stored game records are untouched.

### Approaches to supporting multiple bot types

Three ways to let bots differ, roughly in order of increasing structure:

| # | Approach | Shape | Pros | Cons |
| --- | --- | --- | --- | --- |
| 1 | **Type tag + `switch`** | `PlayerConfig.botType`; `decideBotFacing` branches on it, sharing the candidate-list / argmax skeleton. | Smallest diff. One file. | `decideBotFacing` grows without bound; per-type knobs and defaults get tangled; hard to test one archetype in isolation. |
| 2 | **Strategy registry** *(recommended)* | `BOT_STRATEGIES: Record<BotType, BotStrategy>`; `decideBotFacing` becomes a 3-line dispatcher. Each strategy is its own module with its own `decide`, profile-field subset, and defaults. | Clean separation; each archetype unit-tested alone; per-archetype knob schema; adding one is additive. | A little ceremony up front (the interface + a registry file). |
| 3 | **Goal stack / behaviour tree per bot** | Each bot holds an ordered list of goals (`SurviveGoal`, `ExtendGoal`, `CloseLoopGoal`…) evaluated each tick. | Maximum flexibility; composable. | Overkill for 3–4 archetypes; a scheduler and goal-arbitration layer to maintain; harder to reason about ties. |

**Recommendation: approach 2.** Proposed interface:

```ts
// botStrategy.ts
export type BotType = "rambler" | "surveyor"; // add "privateer", "blockader"… later

export interface BotStrategy {
  type: BotType;
  label: string;                       // shown in the Profiles panel header
  /** Pure. Same contract decideBotFacing has today. `memory` is this bot's scratch bag. */
  decide(state: GameState, player: PlayerState, memory: BotMemory): Direction;
  /** Which BotProfile fields this archetype actually reads — drives the panel sliders. */
  fields: BotProfileField[];
  defaultProfile: BotProfile;
}

export const BOT_STRATEGIES: Record<BotType, BotStrategy> = { rambler, surveyor };
```

`decideBotFacing` then collapses to:

```ts
function decideBotFacing(state: GameState, player: PlayerState): Direction {
  const strategy = BOT_STRATEGIES[player.botType ?? "rambler"];
  return strategy.decide(state, player, botMemoryFor(player));
}
```

### Where per-bot planning state lives

The Rambler is stateless — everything it needs (`trail.length`, `head`, `home`) is on
`PlayerState` already. The Surveyor wants a scrap of memory ("am I extending or
returning, and around which edge?"). Options:

- **`PlayerState.botMemory?: BotMemory`** — a small typed bag, `{}` at spawn, cleared on
  respawn in `respawnPlayer`. Serialises with the state; visible to tests. Preferred.
- A module-level `WeakMap<PlayerState, BotMemory>` in the strategy layer — keeps the bag
  out of the sim type, but `stepGame` clones `PlayerState` every tick (`{ ...p }`), so
  the key identity is lost. Rejected for that reason.

Keep `BotMemory` a discriminated union keyed by `BotType` so each strategy owns its
shape and the others can ignore it.

### Profile knobs across archetypes

`BotProfile` today is a flat struct of seven numbers, all of which the Rambler reads.
New archetypes need new knobs (`maxTrailExposure`, `frontierHugBonus`, …) but shouldn't
show sliders they don't use.

- **Short term:** keep `BotProfile` one flat superset; add the new fields with sane
  defaults; let each `BotStrategy.fields` list the subset the panel renders for that
  bot. `DEFAULT_BOT_PROFILE` stays the union so nothing goes `undefined`.
- **If it gets unwieldy:** split into `{ core: {...}, rambler?: {...}, surveyor?: {...} }`.
  Not worth it at two archetypes.

### Archetype: the Rambler (today's bot; Yellow keeps it)

| | |
| --- | --- |
| **Goal** | Never sit still. Keep a wake out; bank a small loop whenever one is cheap to close. |
| **Mechanism** | The two-phase greedy scorer documented above — [explore](#behavioural-phases) (jittered wander toward neutral water, faint pull home) until `trail.length >= homesickTrailLength`, then [homesick](#behavioural-phases) (Manhattan beeline home, `closeLoopReward` for stepping back onto own territory). |
| **Emergent play** | A cloud of small, frequent captures hugging its start corner. Paths differ run-to-run from `jitter`. |
| **Strengths** | Cheap, robust, never deadlocks (the homesick beeline is a guaranteed-progress recovery). Good **control/baseline** to measure other archetypes against, and a fair warm-up opponent for the human. |
| **Weaknesses under the new rules** | No consolidation (never encloses a big pocket). No offence — walks past cuttable trails. No defence — trails an exposed wake through contested water. Never exploits its own bridges. Tends to *plateau* in cell count rather than push toward a board win. |
| **Assignment** | **The Yellow boat** (`bot-yellow`, labelled "Yellow Rambler"). `botType: "rambler"`, and the default when `botType` is omitted, so every existing `PlayerConfig` and test keeps its current behaviour. |

### Archetype: the Surveyor (the goal-oriented farmer; Green)

The "grow one safe blob outward from home" bot. `src/features/landGrab/surveyorStrategy.ts`,
covered by `src/test/landGrabSurveyorStrategy.test.ts`.

| | |
| --- | --- |
| **Goal** | Grow **one contiguous blob** by laying a wake from the frontier of owned land out toward an `aim` point, then folding it back in — keeping the wake short and close to owned ground so it's rarely cuttable. |
| **Core idea** | Every candidate move gets a **graded** score with a real gradient toward the current goal — never a flat plateau for a tie-break to spin on, and it can never step straight back onto the cell it just left (no toggling). Each loop reaches toward a fresh `aim`: a **board-centre-biased** point whose bearing **rotates every loop**, so successive loops sweep different sectors instead of re-tracing one spike, and the centre bias grows two Surveyors' blobs *toward each other* so a bot-vs-bot match actually comes to contact and resolves. |
| **Emergent play** | A blob fanning out from the start corner toward the middle. Two Surveyors meet near centre and one cuts / encloses the other; a four-bot match now resolves in a few hundred ticks instead of never. |

**Decision procedure** (`surveyorDecide`) — greedy one-cell lookahead, argmax over all
four directions (no candidate pre-filtering), with a small objective in `botMemory`:

1. **Memory:** `{ type: "surveyor", phase, recent: Vec2[], stuckTicks, loopCount, aim: Vec2 | null }`,
   rebuilt by `createSurveyorMemory()` on spawn and every respawn. `recent` is the last
   `RECENT_LEN` (8) head cells. `aim` is set when an extend leg starts (see `computeAim`):
   `reach` cells from the head along a centreward bearing rotated by
   `(loopCount mod SWEEP_ROTATE)` × 60°, fanning ±90° across the open interior.
2. **Phase arbitration:**
   - `"return" → "extend"` once the wake is banked and the head is back on owned land.
     Bumps `loopCount`, picks the next `aim`, resets `stuckTicks`.
   - In `"extend"` with a wake out: flip to `"return"` when `trail.length >=
     targetTrailLength` (and `estimateEnclosedArea >= min(6, targetTrailLength)`, so it
     doesn't fold a 1-wide finger), **or** the head has reached `aim`, **or** a rival is a
     *threat* — within `rivalAvoidRadius` **and** (our wake is already `>= targetTrailLength
     / 2` long **or** the rival is 1 cell away). A merely-nearby rival no longer makes it
     flee, so blobs actually make contact.
   - In `"extend"` with no wake yet: `stuckTicks++`; flip to `"return"` on a rival threat
     or `stuckTicks > STUCK_LIMIT` (30) — genuinely walled in, go home and regroup.
   - Hard backstop: `trail.length >= 2 * targetTrailLength` forces `"return"`.
3. **Scoring — `return`:** `-Manhattan(next, home)` (a monotone beeline), plus
   `closeLoopReward` for stepping onto own territory while a wake is out (that dive banks
   the loop). Own trail is passable at `-Manhattan`.
4. **Scoring — `extend`:** built so there's always a downhill move:
   - off-board → `offBoardPenalty`; the **came-from cell** → `BACKTRACK_PENALTY` (−300,
     below any real move but above off-board); a cell in `recent` → a revisit penalty
     that grows the more recent the visit.
   - **on own territory:** `TERRITORY_BASE − nearestNeutralDistance(next) * FRONTIER_SEEK`
     — a gradient *out of the blob* toward open water, so a buried head walks straight to
     the frontier instead of stalling.
   - **on own wake:** same, but a worse base (`TRAIL_BASE`) — crossing your wake tangles
     the loop.
   - **on neutral / enemy ground:** `+frontierHugBonus` if the cell hugs own territory,
     `+neutralBonus` for unclaimed water, a *soft* slope `−(ownedDist − maxTrailExposure)
     * EXPOSURE_WEIGHT` past the exposure cap (not a cliff), **`+AIM_PULL` per step of
     progress toward `aim`** (this is what varies the loop and drives growth inward), a
     faint `−ownedDist * homePull`, and `Math.random() * jitter`. `+CUT_BONUS` for stepping
     onto a rival's wake (a cut — reliably taken when adjacent, but it doesn't chase).
     `RIVAL_ADJ_PENALTY` for a cell touching a live rival head.

**Pure helpers** (exported from `surveyorStrategy.ts`, each unit-tested directly like the
grid/split helpers):

- `nearestOwnedDistance(grid, playerId, cell, maxRadius?)` — bounded BFS step distance to
  the closest cell `playerId` owns as territory; `Infinity` past the cap or off-board.
- `nearestNeutralDistance(grid, cell, maxRadius?)` — bounded BFS step distance to the
  nearest neutral cell; the gradient that walks a buried head back out to open water.
- `isFrontierAdjacent(grid, playerId, cell)` — is `cell` neutral **and** 4-adjacent to
  own territory?
- `estimateEnclosedArea(trail, head)` — bounding-box area of the wake plus head; a rough
  "is this loop worth closing" signal only (the real fill is still `resolveCapture`).
- `nearestRivalHeadDistance(state, player)` — Manhattan distance to the closest *other
  living* player's head; `Infinity` if alone.

The scoring weights (`RECENT_LEN`, `REVISIT_WEIGHT`, `BACKTRACK_PENALTY`, `FRONTIER_SEEK`,
`TERRITORY_BASE`, `TRAIL_BASE`, `EXPOSURE_WEIGHT`, `RIVAL_ADJ_PENALTY`, `CUT_BONUS`,
`STUCK_LIMIT`, `AIM_PULL`, `SWEEP_ROTATE`) are module constants in `surveyorStrategy.ts`,
not profile sliders.

**Knobs** — four fields on the flat `BotProfile` (`SURVEYOR_EXTRA_FIELDS`), with
`SURVEYOR_PROFILE_FIELDS` = those four plus every Rambler field except
`homesickTrailLength`. The Profiles panel renders exactly this subset on a Surveyor card
(`strategyFor(botType).fields`), so all four are live-editable:

| Field | Default | Effect |
| --- | --- | --- |
| `maxTrailExposure` | `5` | Distance from owned land past which a wake move starts taking the soft exposure slope. Lower → safer, slower growth. |
| `targetTrailLength` | `10` | Wake length that triggers the fold-back / return leg. Higher → bigger loops, more exposure. |
| `frontierHugBonus` | `3` | Pull toward laying the wake one cell outside own territory. |
| `rivalAvoidRadius` | `3` | Range at which a rival counts as a *threat* (see phase arbitration — it only bails if it also has a wake worth banking, or the rival is 1 cell away). |

**Why it can't toggle or spin one fixed orbit:** the came-from cell is ranked below every
real move, so a two-cell A↔B alternation is impossible; own-territory / own-wake moves
are graded by `nearestNeutralDistance` rather than a flat penalty, so a head on owned
ground always has a strictly-downhill move to the frontier (no first-in-iteration-order
tie); and the per-loop `aim` rotation means consecutive loops sweep different sectors
rather than re-laying the same spike. `stuckTicks` is a last-resort "walk home and start
over" if the frontier is genuinely unreachable.

**Assignment:** **the Green boat** (`bot-green`, labelled "Green Surveyor") →
`botType: "surveyor"` in `PLAYER_CONFIGS`. Red runs the
[Invader](#archetype-the-invader-the-raider-red) and Yellow the Rambler, so a default
match is one of each archetype vs. the human. (The `computeAim` centre bias still applies
whenever two Surveyors *do* share a board — e.g. after switching another card to Surveyor.)

### Archetype: the Invader (the raider; Red)

The offensive archetype — the [Privateer](#later-archetypes-sketch) sketch, built out.
`src/features/landGrab/invaderStrategy.ts`, covered by
`src/test/landGrabInvaderStrategy.test.ts`.

| | |
| --- | --- |
| **Goal** | Sink rivals, don't farm. Win by capturing boats, not by enclosing ground. |
| **Core idea** | A pure ram can't win a face-off — [the head-on stand-off](#head-on-stand-off) freezes both boats. So the Invader *uses* the stand-off: line up nose-to-nose with a target, then **juke sideways one tick before contact** and curl back onto the wake the target lays as it slides past. That cut is a full capture + bridge the frozen ram could never land. |
| **Emergent play** | A boat that ignores territory and chases people. It picks the nearest living rival, mirrors onto its row/column, feints straight in, dodges, and cuts — or, if the cut doesn't land, peels home to regroup and re-targets. It turns the Surveyor's centre-ward growth (and any boat that sails a long exposed wake) into a target-rich lane. |

**Decision procedure** (`invaderDecide`) — greedy one-cell lookahead, argmax over all four
directions, with a four-phase objective in `botMemory`:

1. **Memory:** `{ type: "invader", phase, targetId, axis, dodgeStepsLeft, recent: Vec2[],
   commitTicks }`, rebuilt by `createInvaderMemory()` on spawn and every respawn. `recent`
   is the last 8 head cells (anti-backtrack / anti-orbit, same as the Surveyor).
2. **Target selection:** while `hunt`ing or `regroup`ing, `targetId` is re-pointed at the
   nearest living rival head every tick (`nearestLivingRival`). Once `dodge`/`cut` start it
   stays locked to that rival (though *any* rival wake under the next step is still taken).
3. **Phase arbitration** (top of the tick, mutates memory):
   - **`hunt`** → **`dodge`** when the target shares our row or column (`alignmentAxis`),
     the along-line gap is `1 … engageDistance`, and our facing points at it. Captures the
     `axis` and sets `dodgeStepsLeft = dodgeDistance`. If we never line up within
     `commitLimit × 2` ticks → `regroup`.
   - **`dodge`** decrements `dodgeStepsLeft`; at 0 → **`cut`**.
   - **`cut`** → **`regroup`** after `commitLimit` ticks with no capture.
   - **`regroup`** → **`hunt`** once the wake is banked and the head is back on owned land.
4. **Scoring** (`score(dir)`), built so there's always a move:
   - off-board → `offBoardPenalty`; a move `wouldStandOff` → `offBoardPenalty` (never drive
     *into* the freeze); the came-from cell → `BACKTRACK_PENALTY` (−300); a `recent` cell →
     a recency-scaled revisit penalty.
   - **Any rival wake under `next`** → `CUT_REWARD` (+60), `+TARGET_CUT_BONUS` if it's the
     hunted target. This dominates every phase — an opportunistic cut is never passed up.
   - **`hunt`:** `+ALIGN_PULL` per step that shrinks the offset onto the target's line,
     `+CLOSE_PULL` per step that closes the remaining distance, a small neutral-water
     bonus, a faint `homePull` leash, and `jitter`.
   - **`dodge`:** `+DODGE_PERP` for a step perpendicular to `axis`, `−DODGE_PERP` for one
     along it — so the boat slides off the collision line.
   - **`cut`:** `+CUT_SEEK` per step of progress toward the nearest rival wake
     (`nearestRivalTrailDistance`, bounded by `cutSearchRadius`); if there's none in range
     it just drifts and `commitLimit` sends it home.
   - **`regroup`:** `−Manhattan(next, home)` beeline, `+closeLoopReward + BANK_BONUS` for
     the step that banks a live wake onto owned land.

**Pure helpers** (exported from `invaderStrategy.ts`, unit-tested directly):

- `nearestLivingRival(state, player)` — the closest living opponent `PlayerState` by head
  Manhattan distance; `null` if alone.
- `alignmentAxis(a, b)` — `"row"` / `"col"` / `null` for two heads' shared line.
- `nearestRivalTrailDistance(grid, playerId, cell, maxRadius?)` — bounded BFS to the
  nearest wake cell *not* owned by `playerId`; `Infinity` past the cap or off-board.

Plus `wouldStandOff` / `isStandoff` / `intendedNext` from
[`standoff.ts`](#head-on-stand-off), shared with the other scorers and `stepGame`.

Weights (`CUT_REWARD`, `ALIGN_PULL`, `CLOSE_PULL`, `DODGE_PERP`, `CUT_SEEK`,
`BACKTRACK_PENALTY`, `REVISIT_WEIGHT`, `BANK_BONUS`, `OWN_TRAIL_CROSS`,
`TARGET_CUT_BONUS`) are module constants in `invaderStrategy.ts`, not sliders.

**Knobs** — four fields on the flat `BotProfile` (`INVADER_EXTRA_FIELDS`);
`INVADER_PROFILE_FIELDS` = those four plus the shared movement knobs the scorer borrows
(`neutralBonus`, `jitter`, `homePull`, `closeLoopReward`, `offBoardPenalty`):

| Field | Default | Effect |
| --- | --- | --- |
| `engageDistance` | `3` | Along-line gap to the target at which `hunt` flips to `dodge`. Lower → later, riskier juke. |
| `dodgeDistance` | `1` | Perpendicular steps the juke lasts before `cut`. Wider → more room, slower cut. |
| `cutSearchRadius` | `4` | How far `cut` will chase a rival wake before giving up. |
| `commitLimit` | `10` | Hard cap on ticks in one phase before falling back to `regroup` — the anti-deadlock guard. |

**Why it can't deadlock:** every phase has a `commitTicks → regroup` escape except
`regroup` itself, which is a monotone beeline home; `dodge` counts down to `cut`; the
came-from ban + revisit penalty kill 2-cell orbits; and `wouldStandOff` stops it stalling
nose-to-nose. Worst case it loops `hunt → regroup → hunt` re-targeting, always moving.

**Assignment:** **the Red boat** (`bot-red`, relabelled "Red Invader") →
`botType: "invader"` in `PLAYER_CONFIGS` — Yellow keeps the Rambler and Green the
Surveyor, so the default match runs one of each. Any archetype is one Archetype-dropdown
click away on any card.

### Rollout plan

1. **This doc** — agree the archetype list and the `BotStrategy` interface. ✅
2. **Registry refactor, behaviour-neutral.** ✅ Landed. New `botStrategy.ts` holds
   `BotType`, `BotMemory`, the `BotStrategy` interface, `BOT_STRATEGIES` (only `rambler`,
   whose `decide` is the old `decideBotFacing` moved verbatim), `createBotMemory` and
   `strategyFor`. The direction tables (`DELTA` / `OPPOSITE` / `ALL_DIRECTIONS`) moved to
   a dep-free `geometry.ts` so `botStrategy.ts` needs only *type* imports from
   `simulation.ts` — no runtime cycle. `simulation.ts`: `decideBotFacing` is now a
   one-line dispatch to `strategyFor(player.botType).decide(...)`; `PlayerConfig` gained
   optional `botType?: BotType`; `PlayerState` gained `botType` + `botMemory`, seeded in
   `createInitialGameState` and rebuilt in `respawnPlayer`. All prior unit + e2e tests
   pass unedited; `src/test/landGrabBotStrategy.test.ts` covers the new wiring.
3. **Implement `surveyor`.** ✅ Landed (and since reworked twice — to be genuinely
   goal-oriented, then given the per-loop `aim` sweep so it stops spiking and a bot
   match resolves; see the archetype section). `surveyorStrategy.ts` holds the
   `BotStrategy`, `SurveyorMemory` (`phase`, `recent` cells, `stuckTicks`, `loopCount`,
   `aim`), `createSurveyorMemory`, and five exported pure helpers; `botStrategy.ts`
   widened `BotType`/`BotMemory` and registered `surveyor`; `createBotMemory` became a
   `switch`. `BotProfile` gained the four knobs (union default in `DEFAULT_BOT_PROFILE`),
   with `SURVEYOR_EXTRA_FIELDS` / `SURVEYOR_PROFILE_FIELDS` in `botProfile.ts`.
   `PLAYER_CONFIGS`: Red and Green `botType: "surveyor"`, Yellow explicit `"rambler"` (Red
   later reassigned to `"invader"` in Phase 5). `src/test/landGrabSurveyorStrategy.test.ts`
   covers the helpers, the wiring, a no-two-cell-toggle regression check, and a
   two-Surveyor-match-resolves check.
4. **Panel support.** ✅ Landed. `BotProfilePanel` takes a `botTypes` map + an
   `onBotTypeChange` callback; each driven card carries an archetype badge, an
   **Archetype** `<select>` (options from `BOT_STRATEGIES`), a one-line blurb, and the
   sliders for `strategyFor(botType).fields` only. `LandGrabDemo` owns `botTypes` state
   (seeded from `PLAYER_CONFIGS`, reset by **Reset all**), pushes it onto the live
   `GameState` each tick via `botTypesRef`, and rebuilds `player.botMemory` with
   `createBotMemory` when a card's archetype changes mid-match; `buildConfigs` threads the
   override so **Restart** keeps it. Cards get `data-testid="bot-card-<id>"`;
   `e2e/landGrabControls.spec.ts` exercises the swap. A human card shows the picker only
   on autopilot (an autopiloted human then runs the chosen archetype).
5. **Implement `invader`.** ✅ Landed alongside the [head-on stand-off](#head-on-stand-off)
   movement rule. New `standoff.ts` (`intendedNext` / `isStandoff` / `wouldStandOff`),
   shared by `stepGame` and all three scorers so no bot drives into a frozen face-off.
   `invaderStrategy.ts` holds the `BotStrategy`, `InvaderMemory` (`phase`, `targetId`,
   `axis`, `dodgeStepsLeft`, `recent`, `commitTicks`), `createInvaderMemory`, and three
   exported pure helpers; `botStrategy.ts` widened `BotType`/`BotMemory` and registered
   `invader`. `BotProfile` gained four knobs (`INVADER_EXTRA_FIELDS` /
   `INVADER_PROFILE_FIELDS`). `PLAYER_CONFIGS`: Red → `botType: "invader"` (relabelled
   "Red Invader"), reverting Red's Phase-3 Surveyor assignment; Yellow stays Rambler,
   Green stays Surveyor, so the default match is one of each. Covered by
   `src/test/landGrabInvaderStrategy.test.ts` and `src/test/landGrabStandoff.test.ts`.
6. **Later archetypes** (below), once the registry has proven out.

**Game records:** `LandGrabPlayerRecord` could gain `botType` (schema bump to `2`, old
rows still load and just lack the field). Still deferred — the current records viewer is
display-only and doesn't surface archetype.

### Later archetypes (sketch)

Not planned for this pass — listed so the registry interface is designed with room for
them. (The **Privateer** sketch shipped as the [Invader](#archetype-the-invader-the-raider-red).)

| Archetype | Goal | One-line mechanism | Exercises |
| --- | --- | --- | --- |
| **Blockader** | Defence / denial. | Hug and wall off a choke so rivals can't expand past it; tiny loops, never far from home. | Long thin territory strips, split resolution when a strip is cut. |
| **Opportunist** | Meta. | Run Surveyor, but switch to Invader scoring for a few ticks whenever a rival wake is short-and-close. | Strategy switching, `botMemory` phase changes. |

## Tuning them live in the demo

The Land Grab page has a **Pause** button (also <kbd>Space</kbd>) and a **Step** button
(also <kbd>.</kbd>) that advances exactly one tick while paused, plus a speed selector
(0.25×–4×, via `this.time.timeScale`). None of these touch the simulation — they only
gate how often `stepGame` runs.

The **Profiles** button opens a panel with one card per player:

- **You** — a read-only list of the fixed human rules (buffered input, no 180° reversal,
  start gate), plus an **Autopilot** checkbox. Tick it and your boat is driven by
  `decideBotFacing` with its own editable profile (`PlayerState.autopilot`,
  `PlayerConfig.autopilot`) — the way to watch a fair four-bot match, or to A/B a profile
  against the three defaults.
- **Each bot** (and **You** on autopilot) — an **Archetype** dropdown (Rambler /
  Surveyor / Invader) with a badge and one-line blurb, then a slider per field the chosen
  archetype reads (`strategyFor(botType).fields` — so a Rambler, Surveyor and Invader card
  show different sliders). Edits apply on the **next tick**, no restart: the Phaser tick
  loop copies the React-owned `profiles` / `autopilot` / `botTypes` / `rules` onto the
  live `GameState` before each `stepGame`, rebuilding a bot's `botMemory` when its
  archetype changed. Per-card **Reset** restores `DEFAULT_BOT_PROFILE` (not the
  archetype); **Reset all** also restores every archetype and the match rules.

A match-level **Respawn delay** slider (`GameState.rules.respawnDelayTicks`, default 12)
sits at the top of the panel.

## Tuning knobs

Per-player, on `PlayerState.profile` (`src/features/landGrab/botProfile.ts`). All three
archetypes share one flat `BotProfile`; each `BotStrategy.fields` lists the subset its
scorer reads (`BOT_PROFILE_FIELDS` for the Rambler, `SURVEYOR_PROFILE_FIELDS` for the
Surveyor, `INVADER_PROFILE_FIELDS` for the Invader), and the panel renders exactly that
subset on each driven card.

**Rambler fields** (also read by the Surveyor except `homesickTrailLength`):

| `BotProfile` field | Default | Effect |
| --- | --- | --- |
| `homesickTrailLength` | `9` | Rambler only. Trail length at which it flips from explore to beeline-home. Higher → bigger, riskier loops. |
| `neutralBonus` | `2` | Preference for unclaimed water over owned cells while exploring/extending. Must stay above `jitter` or neutral-seeking stops being reliable. |
| `jitter` | `0.5` | Upper bound of the random wander added to each explore/extend-mode score. `0` → bots trace near-identical paths from symmetric corners. |
| `homePull` | `0.01` | Weight of the pull back toward home/owned land while exploring/extending (× distance). Raise it to keep the bot hugging its corner. |
| `closeLoopReward` | `1` | Bonus for diving back onto your own **territory** once homesick/returning — the move that closes the loop and banks the capture. |
| `earlyLoopPenalty` | `-20` | Penalty for steering back across your own wake while exploring/extending. More negative → the trail stays untangled. |
| `offBoardPenalty` | `-1000` | Penalty for steering into the (non-lethal) board edge. Only needs to rank below any real move. (The Surveyor has its own `BACKTRACK_PENALTY` / soft-exposure scoring, in `surveyorStrategy.ts`.) |

**Surveyor-only fields** (`SURVEYOR_EXTRA_FIELDS`; shown only on a Surveyor card):

| `BotProfile` field | Default | Effect |
| --- | --- | --- |
| `maxTrailExposure` | `5` | Distance from owned land past which a wake move starts taking the soft exposure slope (not a hard cap). Lower → safer, slower growth. |
| `targetTrailLength` | `10` | Wake length that triggers the fold-back / return leg. Higher → bigger loops, more exposure. |
| `frontierHugBonus` | `3` | Pull toward laying the wake one cell outside own territory, so the closed loop encloses a thick strip. |
| `rivalAvoidRadius` | `3` | Bail straight to the return leg once a rival head gets this close (Manhattan). |

**Invader-only fields** (`INVADER_EXTRA_FIELDS`; shown only on an Invader card, alongside
the borrowed `neutralBonus` / `jitter` / `homePull` / `closeLoopReward` / `offBoardPenalty`):

| `BotProfile` field | Default | Effect |
| --- | --- | --- |
| `engageDistance` | `3` | Along-line gap to the hunted target at which `hunt` flips to `dodge`. Lower → later, riskier juke. |
| `dodgeDistance` | `1` | Perpendicular steps the sideways juke lasts before switching to `cut`. Wider → more room, slower cut. |
| `cutSearchRadius` | `4` | How far the `cut` phase chases the target's fresh wake before bailing to `regroup`. |
| `commitLimit` | `10` | Hard cap on ticks in any one phase before falling back to `regroup` — the anti-deadlock guard. |

Match- and presentation-level:

| Knob | Default | Where | Effect |
| --- | --- | --- | --- |
| `rules.respawnDelayTicks` | `12` | `GameState` (panel slider) | Ticks a dead player waits before it's eligible to respawn (still needs a clear 3×3). |
| `TICK_MS` | `160` | `simulation.ts` constant | Sim tick length. |
| speed | `1×` | demo only (`time.timeScale`) | How fast ticks fire; not part of the simulation. |
