# Land Grab — Match Records

What Land Grab remembers about a finished match, where it lives, and what each
field means. The code is `src/features/landGrab/gameRecord.ts` (the data model +
storage helpers), `src/features/landGrab/MatchRecordsPanel.tsx` (the tabbed panel
that renders it), `src/features/landGrab/recordStats.ts` (the pure leaderboard
aggregation), and `src/features/landGrab/MatchRecordsChart.tsx` (the leaderboard
chart). Per-player counters are accumulated during the simulation in
`src/features/landGrab/simulation.ts`.

## Where it's stored

There's no backend. When a match is decided, `LandGrabDemo` calls
`buildGameRecord(state)` and `saveGameRecord(record)`, which prepends the record to
a list in `localStorage` under the key **`landgrab:game-records`**, newest first,
capped at **`MAX_STORED_GAME_RECORDS` (50)**. Older rows fall off the end.

Only the fully-interactive demo records. The `hideControls` preview card on the
dashboard runs the same simulation but never writes a record or pops the game-over
dialog.

Swapping in a real API later means replacing `saveGameRecord` / `loadGameRecords` /
`clearGameRecords` and nothing else.

### Schema version

Every row carries `schemaVersion`. `loadGameRecords` keeps only rows whose version
matches the current one and silently drops the rest, so a shape change never has to
migrate old data — it just invalidates it.

- **v1** — original shape. Recorded each player's cell count *at the final tick*
  and rendered that in the standings column.
- **v2** — keeps every v1 field and adds `peakOwnedCount` / `peakOwnedFraction` and
  `timesCaptured` per player. The end-of-match cell count is still stored
  (`ownedCount`), but the standings column now shows the peak instead, because the
  final count for the winner just repeats the "Cells" column and the final count
  for everyone else is usually 0 (they were sunk). v1 rows already in `localStorage`
  are discarded on the first read after upgrading.
- **v3** — adds `peakChainLength` per player: their high-water mark on the
  display-only captured-avatar chain (`chainTrail.ts`), handed in separately via
  `BuildGameRecordOptions.chainPeaks` since the chain lives outside `GameState`.
  Missing/omitted entries record as `0`.
- **v4** (current) — adds `score` per player, see "Total score" below.

Bumping `schemaVersion` in `gameRecord.ts` discards every locally-stored row on the
next read.

## Record shape (`LandGrabGameRecord`)

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `4`. See above. |
| `endedAt` | ISO-8601 timestamp of when the record was written (≈ when the match ended). |
| `winner` | The winning player, as a `LandGrabPlayerRecord` (see below). |
| `players` | Every player, in `playerOrder`, each a `LandGrabPlayerRecord`. Includes the winner again. |
| `ticks` | Simulation ticks from the opening board to the deciding move. |
| `durationMs` | `ticks * TICK_MS` — *simulated* match length, not wall-clock time. |
| `board` | `{ rows, cols, totalCells }` of the board this match was played on. |
| `rules` | The `GameRules` in effect (currently just `respawnDelayTicks`). |

A match is only recorded once it has a winner — either one player holds every cell,
or one player is the last afloat with no room left for the eliminated to respawn.
`buildGameRecord` throws on an undecided state, so draws can't be logged.

## Per-player shape (`LandGrabPlayerRecord`)

| Field | Meaning |
| --- | --- |
| `id`, `label`, `color` | Identity. `label` is the human's chosen username or the bot's fixed name; `color` is `#rrggbb`. |
| `isBot` | True for the computer boats. |
| `autopilot` | True if this player was being driven by the bot brain (always true for bots; true for the human only if they toggled autopilot on). |
| `ownedCount` | Cells held **at the final tick**. For the winner this equals the "Cells" column; for a sunk player it's usually `0`. |
| `ownedFraction` | `ownedCount / board.totalCells`, `0..1`. |
| `peakOwnedCount` | **High-water mark** — the most cells this player held at the end of any single tick during the match. This is what the standings column shows. |
| `peakOwnedFraction` | `peakOwnedCount / board.totalCells`, `0..1`. |
| `captures` | Times **this player cut a rival's trail** and seized their land — i.e. the number of rival players this player captured. |
| `timesCaptured` | Times **a rival cut this player's trail** and sank them — counted whether or not this player went on to win. The mirror of `captures`. |
| `score` | Composite "total score" — `ownedCount` cells plus a weighted bonus per rival *currently* trailing this player. See "Total score" below. |
| `peakChainLength` | High-water mark on the display-only captured-avatar chain trailing this player (`chainTrail.ts`). Resets to `0` on death, so it's a streak record, not a running total; `0` if the match predates v3 or no `chainPeaks` snapshot was given. |
| `alive` | Whether this player was afloat at the final tick. |
| `profile` | The `BotProfile` decision parameters this player was running when the match ended. |

## Total score

`score` (`src/features/landGrab/score.ts`, unit-tested in
`src/test/landGrabScore.test.ts`) folds a player's territory and their kills into a
single number, weighted to emphasize **capturing rival players** over merely holding
cells:

```
captureValue = totalCells / playerCount   // one even share of the board
score        = round(ownedCount + capturedCount * captureValue)
```

Sinking one rival is worth as much as owning a clean, even share of the whole board
— e.g. a quarter of the board in a 4-player match — deliberately outweighing typical
tick-to-tick territory gain, while still scaling automatically with board size and
player count instead of a hand-tuned constant.

Both inputs are deliberately **current-state, not lifetime totals**:

- `ownedCount` is the player's cell count right now, not their peak, so a sunk
  player's score doesn't keep the credit for land they've since lost.
- `capturedCount` is the player's *current* captured-avatar chain length —
  rivals presently trailing them (`chainTrail.ts`'s `ChainMap`) — **not** the
  `captures` field above. The chain resets to `0` the instant this player is
  themself captured, so the bonus rewards holding an active capture streak,
  not a running lifetime tally: capture three rivals then get sunk yourself,
  and your `captures` stays `3` forever but your chain (and this part of your
  score) drops back to `0`.

Because of that, a sunk player's final score falls back to `0` unless they
re-captured someone (rebuilt a chain) right before the match ended.

This is the same `score` stored on each `LandGrabPlayerRecord` — `buildGameRecord`
takes the final chain lengths via `BuildGameRecordOptions.chainLengths`, the same way
it already took `chainPeaks` — and it's what `LandGrabDemo` shows live:

- **In-game HUD** — the human player's current score, top-left over the board,
  recomputed every tick from the live `players` state and the live chain lengths.
- **Leaderboard** (both the `>=1400px` aside and the narrow-viewport inline list) —
  now ranked by `score` rather than raw cell count, and shows each player's current
  chain length (captured players presently trailing them) next to their cell count.
- **Game-over dialog** — a "Winner score" row alongside cells/peak/captures/sunk.

### How the counters accumulate

All three per-player stats live on `PlayerState` and are carried tick to tick by
`stepGame`:

- **`peakOwnedCount`** — seeded to the opening base size in
  `createInitialGameState`, then after every tick recomputes `ownedCount` and bumps
  the peak if the new count is higher. It never decreases, so losing land to a
  rival's capture loop doesn't lower it.
- **`captures`** — incremented on the aggressor when a trail cut resolves (existing
  behaviour, unchanged).
- **`timesCaptured`** — incremented on the victim in the same trail-cut branch, so
  `sum(captures)` across all players always equals `sum(timesCaptured)`.
  - **Not counted:** a player whose entire territory gets swallowed by someone
    else's capture loop is also sunk (`alive` goes false, respawn scheduled), but
    there's no single "who did it", so this does not add to `timesCaptured`. Only a
    direct trail cut does.

`score` isn't itself a `PlayerState` counter — it's derived at record-build time
(and, live, on every tick in `LandGrabDemo`) from `ownedCount` and `captures`, plus
the match's `totalCells` and player count. See "Total score" above.

## What the panel shows (`MatchRecordsPanel`)

The header (title, storage note, "Refresh", "Clear all") is shared; below it a
two-tab view (`src/components/ui/tabs.tsx`) switches between **Table** and
**Leaderboard**. "Refresh" re-reads `localStorage`; "Clear all" removes the key.
Both tabs read the same in-memory `records` array, so a refresh updates both.

### Table tab (`RecordsTable`)

One row per stored match, newest first:

- **When** — local date + time from `endedAt`.
- **Winner** — colour dot + label.
- **Score** — the winner's `score` (see "Total score" above).
- **Cells** — the winner's final `ownedCount` and percentage.
- **Captures** — the winner's `captures` (rival trails they cut).
- **Ticks** / **Time** — `ticks` and `mm:ss` of `durationMs`.
- **Board** — `cols`×`rows`.
- **Standings (peak cells · times sunk)** — every player, sorted by
  `peakOwnedCount` descending. Each entry is `label — peakOwnedCount (peak%) peak`,
  followed by `· sunk N×` when `timesCaptured > 0`.

### Leaderboard tab (`MatchRecordsChart` + `recordStats.ts`)

An aggregate view across **all** stored matches, not one row per match. Every
player (bots and the human alike) is collapsed to a single row by their stable
`id`; the most recent match supplies the displayed `label` and `color`, so a
renamed human stays one row.

`rankPlayers(records)` (pure, unit-tested in `src/test/landGrabRecordStats.test.ts`)
produces one `PlayerRanking` per player with `matches`, `wins`, `winRate`,
`avgPeakFraction`, `bestPeakFraction`, `captures`, `timesCaptured`, `captureDiff`,
and a composite `rating`. Rows are sorted by `rating` descending, then `winRate`,
then `avgPeakFraction`, then `label` — a stable, total order even when ratings tie —
and `rank` is the 1-based position after that sort.

**Rating** is the mean over a player's matches of `matchRating`:

```
matchRating = (won ? 1 : 0)
            + peakOwnedFraction            // 0..1, board share at the player's peak
            + 0.05 * captures
            - 0.05 * timesCaptured
```

The weights live in `RATING_WEIGHTS` in `recordStats.ts`. Winning a match is worth
one point, dominating the board at your peak is worth up to another, and cutting /
being cut nudge the score ±0.05 each. Averaging per match keeps a long unbeaten run
ahead of a single lucky win. A player who never scored and was sunk repeatedly can
land slightly negative; the bar just clamps to zero width while the number stays
honest.

The chart is a ranked horizontal bar chart — bar length is `rating` (relative to
the top-ranked player), row order is the ranking. Each bar is filled with that
player's own colour; identity is also carried by the dot + name so it never rests
on colour alone. A muted line under each bar shows the breakdown
(`matches · W (win%) · avg peak · best · captures / sunk`), also surfaced as the
row's hover title.
