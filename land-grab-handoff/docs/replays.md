# Land Grab — Replays

A frame-by-frame recording of the match in progress, kept so you can scrub back
through a finished game and debug the capture / territory-split algorithm. The
code is `src/features/landGrab/replayLog.ts` (the data model + the pure
record/reconstruct helpers), `src/features/landGrab/LandGrabReplay.tsx` (the
canvas viewer), and the wiring in `src/features/landGrab/LandGrabDemo.tsx` (start
a log per match, feed it each tick, freeze it at game over).

This is a companion to [Match Records](./records.md). The two are separate
systems: a **record** is the one-row summary of a finished match that persists in
`localStorage`; a **replay** is the full tick-by-tick history that only lives in
memory.

## Where it's stored

Nowhere. A `ReplayLog` is held in a `useRef` while the match runs and copied into
React state (`replay`) when the match is decided. It is never written to
`localStorage` — a full frame log is far too big, and `gameRecord.ts` already
owns the durable summary. Close the tab and the replay is gone.

`replay` is deliberately **kept across restarts** so the "Replay" button and the
game-over dialog's "Watch replay" stay useful after the board resets; the next
finished match overwrites it.

Only the fully-interactive demo records. The `hideControls` preview card on the
dashboard runs the same simulation but `replayLogRef` stays `null`, so it does no
recording.

## The frame model

`ReplayLog.frames` is one entry per tick, starting at tick 0.

- **Frame 0** carries the entire opening grid — every cell listed in
  `cellChanges` — plus each player's starting state.
- **Every later frame is a delta**: only the cells whose `kind` or `playerId`
  changed since the previous frame. A boat moving through its own territory
  records *zero* cell changes; a capture loop resolving records a burst of them.
  This keeps a long match on a big full-screen board to a few MB.

`frameGridAt(log, i)` rebuilds the full grid shown at frame `i` by starting from
an empty grid and replaying every frame's `cellChanges` from 0 up to `i`. The
index is clamped into range.

### The tick cap — a ring buffer, not a hard stop

`MAX_REPLAY_TICKS` (3000) is how many of the most recent ticks the log keeps.
A normal match ends in a few hundred ticks and never comes near it — but a
match that runs longer (a slow/paused game, an unusually durable stalemate)
used to just stop being recorded at the cap, which meant the replay could miss
the actual finish entirely. It doesn't anymore: past the cap, `recordFrame`
**drops the oldest frame for every new one it records**, so the log stays a
fixed-size window that always reaches the current tick. The viewer's "capped"
note now means "earlier ticks were dropped," not "recording stopped."

Dropping the oldest frame (`evictOldestFrame`) has to preserve two invariants
the rest of the module relies on:

- **`frameGridAt` needs frame 0 to always be a full grid snapshot**, not a
  delta — there's nothing older for a delta to apply on top of. `leadingGrid`
  tracks the grid as of `frames[0]` continuously (the mirror of `runningGrid`,
  which tracks the *latest* frame instead), so re-basing the frame that becomes
  the new frame 0 is an O(board size) dump of `leadingGrid`, not a replay of
  the whole (now partly gone) history.
- **`frameChainsAt` needs a valid starting point**, since the captured-avatar
  chain (below) is built by folding `captureEvents` forward from frame 0.
  `leadingChains` plays the same role as `leadingGrid` — chain state as of just
  before `frames[0]` — so a chain formed before the retained window still shows
  up instead of silently resetting once its originating frame is dropped.

## `ReplayLog` shape

| Field | Meaning |
| --- | --- |
| `rowCount`, `colCount` | Board dimensions for this match (constant for its lifetime). |
| `playerOrder` | Player ids in turn order, copied from `GameState`. |
| `playerMeta` | `{ [id]: { label, color, isBot } }` — static display info captured once so the viewer needs no live state. `color` is packed `0xRRGGBB`, same as `PlayerState.color`. |
| `frames` | One `ReplayFrame` per recorded tick, oldest first. Capped at `MAX_REPLAY_TICKS`. |
| `truncated` | `true` once the match ran past `MAX_REPLAY_TICKS` and the oldest frames started being dropped — `frames[0]` is no longer tick 0. |
| `runningGrid` | Scratch reconstruction of the *latest* frame's grid (trailing edge), used only while recording to diff the next tick. Rebuildable from `frames`, so it can be dropped before serialising. |
| `leadingGrid` | Scratch reconstruction of `frames[0]`'s grid (leading edge) — see above. Also droppable before serialising. |
| `leadingChains` | Chain state as of just before `frames[0]` — the seed `frameChainsAt` starts folding `captureEvents` onto. `{}` until frames have actually been dropped. |

### `ReplayFrame`

| Field | Meaning |
| --- | --- |
| `tick` | The simulation tick this frame captures. |
| `cellChanges` | `{ row, col, cell }[]` — cells that differ from the previous frame. Frame 0 lists every cell. |
| `players` | `{ [id]: ReplayPlayerFrame }` for every player in `playerOrder`. |
| `winnerId` | The winner's id once the match is decided on this frame, else `null`. |

### `ReplayPlayerFrame`

| Field | Meaning |
| --- | --- |
| `head` | The boat's head cell at the end of this tick. |
| `facing` | The direction actually applied this tick — the resolved move, not the queued one. |
| `trail` | Live wake cells, in the order they were laid. |
| `alive` | Whether the boat was afloat at the end of this tick. |
| `ownedCount` | Territory cells held at the end of this tick. |
| `respawnAt` | Tick this player becomes eligible to respawn, or `null` if alive / not waiting. |

## How recording is wired

In `LandGrabDemo.tsx`:

1. **Start** — the effect that builds the Phaser game calls
   `createReplayLog(initialState)` and stores it in `replayLogRef`
   (`null` when `hideControls`). Frame 0 is recorded here.
2. **Each tick** — the scene's `onTick(state)` callback calls
   `recordFrame(replayLogRef.current, state)` before anything else, so the
   deciding tick is captured. `recordFrame` no-ops if the incoming `tick` isn't
   newer than the last frame, which covers the frozen post-game state being
   re-delivered every tick.
3. **Game over** — in the same `winnerId` branch that writes the match record,
   `setReplay(replayLogRef.current)` freezes the log into state. After `winnerId`
   is set `stepGame` returns the same frozen object every tick, so no more frames
   are appended and the state/ref aliasing is safe.

## The viewer (`LandGrabReplay`)

A pure viewer over one `ReplayLog` — it never touches the live simulation, so
it's safe to mount while a fresh match runs.

- **Board** — a `<canvas>` redrawn on every frame change, mirroring
  `LandGrabScene.draw()` (dark ground, territory at 0.9 alpha, trail at 0.4, the
  captured-avatar chain, a white head marker ringed in the player's colour — no
  grid lines, solid colour fills edge-to-edge). No second Phaser instance. Cell
  size defaults to a fit that keeps the board ~520px wide.
- **Transport** — Play/Pause, single-step ◀▶, a 0.5–4× speed select (playback
  advances one frame per `TICK_MS / speed`), and a frame scrubber. Any manual
  step or scrub pauses playback.
- **Per-player row** — colour dot, label, `ownedCount`, and the current
  `facing` (or `sunk`) at the shown frame — the debugging payload. A note under
  it names the winner on the frame the match is decided.
- Props: `autoPlay` starts playing immediately; `startIndex` says which frame to
  start it from (default the opening frame); `initialSpeed` says which of
  `SPEED_OPTIONS` to start at (default 2×); `onEnded` fires once when playback
  reaches the last frame (only while actually playing); `className` overrides
  the card wrapper (pass `""` to drop it inside a modal).

### Two entry points

**Automatic, on game over** — the moment `winnerId` is set, the game-over modal
opens straight into the replay (no click needed), `autoPlay`ing from
`frames.length - 1 - INTRO_REPLAY_TICKS` (the last 10 ticks, clamped to 0) at the
slowest speed (`Math.min(...SPEED_OPTIONS)`) — a quick highlight of the deciding
move. When it ends, `onEnded` flips the modal back to the stats view (the same
block described in [Match Records](./records.md)), which is what actually
starts the windowed 5s auto-dismiss-and-restart timer — full screen just leaves
the modal open. `introReplayIndex` (`LandGrabDemo.tsx`) is `null` while this
isn't in effect, and non-`null` while it's the highlight replay driving the
modal (as opposed to the full rewatch below).

**Controls row → "Replay"**, or the stats view's **"Watch replay"** button —
both open a full-match `LandGrabReplay` (`autoPlay` from tick 0, default 2×
speed; `introReplayIndex` reset to `null`). The controls-row copy is an inline
panel below the board that rests paused on the final frame instead, and stays
available after the game-over modal is gone so you can re-watch while a new
match runs. Reaching the end of a modal rewatch also flips back to the stats
view, restarting the same windowed timer.

## Later: true algorithm re-execution

This replay renders *recorded* frames. It does not re-run `stepGame`, so you
can't set a breakpoint in the capture code and step the real algorithm through a
recorded match. Two things block that today:

- **Randomness** — `botStrategy.ts` and `surveyorStrategy.ts` both add
  `Math.random() * jitter` to their move scores, so re-running from the opening
  state produces a different match. A seeded PRNG stored on `GameState` would fix
  this.
- **Human input** — the human's moves come from keydown events, not from
  `stepGame`. A `facingOverrides` param on `stepGame` (id → forced direction)
  would let a replay feed recorded facings back in.

With both, a replay could be just `{ seed, configs, humanFacings }` — small
enough to persist next to the match record — and "fork from tick N" and
seed-plus-input regression fixtures become possible. Out of scope for the
snapshot recorder documented here.

## Tests

`src/test/landGrabReplayLog.test.ts` covers the pure module: frame 0 captures the
full grid and player meta, `recordFrame` appends deltas rather than whole boards,
`frameGridAt` reconstructs the exact live `state.grid` at every recorded frame, a
repeated call for the same tick is ignored, past `MAX_REPLAY_TICKS` the log keeps
dropping the oldest frame instead of stopping (recording still reaches the true
final tick, frame 0 still carries a full grid however far it's shifted), and a
chain formed before the retained window still shows up via `leadingChains` after
its originating frame has been dropped. The canvas viewer isn't unit-tested
(jsdom has no real 2D context).
