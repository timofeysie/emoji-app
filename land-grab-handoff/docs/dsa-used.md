# Land Grab — DSA used

Which entries from `[docs/dsa.md](../dsa.md)` (table of contents: `[docs/dsa-toc.md](../dsa-toc.md)`)
actually show up in `src/features/landGrab/`, and where. Land Grab started as a literal
port of the DFS solution in `[docs/problems/Number-of-Islands.md](../problems/Number-of-Islands.md)` —
the capture/elimination rules *are* that algorithm, not a visualization of it (see the
"How the algorithm powers the game" section on the [Land Grab page](../../src/pages/LandGrab.tsx))
— and the rest of the game accumulated a handful of other classic DSA around that core as
it grew bots, a scoreboard, and a replay system.

## TL;DR


| DSA                                         | Where                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **DFS / flood fill (connected components)** | `grid.ts` → `resolveCapture`; `splitResolution.ts` → `resolveTerritorySplit`                                                              |
| **BFS (bounded frontier search)**           | `invaderStrategy.ts` → `nearestRivalTrailDistance`; `surveyorStrategy.ts` → `nearestOwnedDistance`, `nearestNeutralDistance`              |
| **Stack** (explicit, iterative DFS)         | `grid.ts`, `splitResolution.ts`                                                                                                           |
| **Hash Set**                                | visited-cell tracking in every BFS above; `standoff` and `aliveIds` sets in `simulation.ts` / `chainTrail.ts`                             |
| **Hash table / Map**                        | `recordStats.ts` → `rankPlayers`; `intents`/`splitActor` in `simulation.ts`; every `Record<id, …>` in `simulation.ts`, `LandGrabDemo.tsx` |
| **Sorting (comparator, multi-key)**         | `recordStats.ts` → `rankPlayers`; leaderboard sort in `LandGrabDemo.tsx`                                                                  |
| **Greedy algorithm (paradigm)**             | `botStrategy.ts`, `surveyorStrategy.ts`, `invaderStrategy.ts` — every bot's one-tick-lookahead `decide`                                   |
| **Ring buffer (circular buffer)**           | `replayLog.ts` — `MAX_REPLAY_TICKS` frame window                                                                                          |
| **Delta/diff encoding**                     | `replayLog.ts` — `cellChanges` per frame instead of a full grid                                                                           |
| **2D grid as a graph**                      | `grid.ts`'s `CellState[][]` — same "cells are nodes, 4-neighbors are edges" model as Number of Islands                                    |


Union-Find, the other approach the Number-of-Islands doc walks through, isn't used here —
capture and split resolution both need the *set* of cells in a component (to repaint or
keep it), not just a count, so DFS's natural-fit "collect while you flood" beat "union
then count roots" for this game's needs.

---



## 1. DFS / flood fill — the core algorithm

This is the piece the [Land Grab page](../../src/pages/LandGrab.tsx) already calls out
as the point of the demo, not just a coincidence: the capture and split rules **are**
`depthFirstSearch(row, col)` from the Number of Islands doc, reused twice with a
different seed and a different meaning for "visited".

### `resolveCapture` (`grid.ts`)

Same base-case-then-recurse shape as the doc's `depthFirstSearch`, but:

- seeded from the **grid border** instead of a land cell (`floodFromBorder(0, col)`,
`floodFromBorder(row, 0)`, etc. around all four edges),
- "visited" means **reachable open water**, not "sunk land",
- and the base case stops the flood at the closing player's own trail/territory instead
of at non-land.

Whatever the border-seeded flood **can't** reach — and isn't the closing player's own
boundary — was enclosed by their loop and becomes their territory. This is exactly the
doc's insight that DFS/BFS sinks a whole connected region from one seed; here the region
being sunk is the *outside*, so what's left over (unreached) is the inside.

```ts
function floodFromBorder(startRow: number, startCol: number): void {
  const stack: Array<[number, number]> = [[startRow, startCol]];
  while (stack.length > 0) {
    const [row, col] = stack.pop()!;
    if (row < 0 || row >= rowCount || col < 0 || col >= colCount) continue;
    if (reachable[row][col] || isPlayerBoundary(grid[row][col], playerId)) continue;
    reachable[row][col] = true;
    stack.push([row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]);
  }
}
```



### `resolveTerritorySplit` (`splitResolution.ts`)

The doc's `numIslands` outer loop — "scan every cell, and every time you find an
unvisited one, DFS-sink the whole component you find it's part of" — restricted to one
player's owned cells. When an opponent's capture loop (or a dead rival's plowed-through
trail reverting to neutral) severs this player's territory, what's left can fall into
more than one connected component; this function finds every one of them the same way
`numIslands` finds every island, then keeps one (the component holding the player's head
or home — a priority-ordered anchor list) and reverts the rest to neutral ground.

Both functions use an **explicit stack** rather than recursion (see [§3](#3-stack)) — the
doc's own solution notes recursion's O(rows×cols) worst-case stack depth "for a long
snake of land"; Land Grab's "large map" board (up to 180×120 = 21,600 cells) makes that a
real risk, not just a theoretical one, so both flood fills are iterative.

## 2. BFS — bounded frontier search

Three helpers do the same job the doc's BFS section describes — "explore level-by-level
using a queue, sinking the whole connected component in BFS order" — except here the
search doesn't stop at one connected component; it fans outward through *any* cell
(owned or not) looking for the nearest cell matching some predicate, and gives up past a
radius cap instead of running to exhaustion:

- `nearestRivalTrailDistance` (`invaderStrategy.ts`) — nearest cell holding a rival's
wake, so the Invader's `cut` phase can steer toward one.
- `nearestOwnedDistance` (`surveyorStrategy.ts`) — nearest cell the Surveyor owns, used
to keep its wake from drifting too far from home.
- `nearestNeutralDistance` (`surveyorStrategy.ts`) — nearest unclaimed cell, to pull a
buried Surveyor back out to open water where it can lay a wake.

All three share the same shape: a `frontier: Vec2[]` array standing in for the queue (the
whole ring of cells at the current distance is processed together, then replaced by the
next ring — a level-order BFS without literally calling `.shift()` every cell), a
`Set<string>` of `"row,col"` keys for O(1) visited checks, and an early return the moment
the target predicate is hit:

```ts
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
      if (/* predicate */) return dist;
      next.push(n);
    }
  }
  if (next.length === 0) break;
  frontier = next;
}
return Infinity;
```

Bounding by `maxRadius` (default 16) is deliberate: these run inside a bot's per-tick
scoring loop, so an unbounded BFS across a 180×120 board every tick, for every candidate
direction, would be far too slow. The bot only needs "is something worth reacting to
nearby", not the true shortest path.

## 3. Stack

Both DFS flood fills (`resolveCapture`, `resolveTerritorySplit`) use a plain array as an
explicit stack (`push`/`pop`) instead of recursive calls, precisely to sidestep the call-stack
depth that worried the Number-of-Islands doc's own complexity notes. This is the direct,
practical answer to that doc's "Space: O(m × n) in the worst case for the recursion
stack" caveat.

## 4. Hash Set

Every BFS above uses a `Set<string>` for visited tracking (see [§2](#2-bfs--bounded-frontier-search)).
Elsewhere:

- `simulation.ts`'s `stepGame` builds a `standoff: Set<string>` of player ids frozen by
a head-on collision this tick.
- `chainTrail.ts`'s `clearDeadChains` takes a `ReadonlySet<string>` of currently-alive
player ids to decide whose trailing chain should reset.
- `replayLog.ts`'s `stepChains` rebuilds that same alive-ids set per replay frame.

This is the dsa.md [Set](../dsa.md#set--programming-shortcuts) section's "collection of
unique values with efficient membership checks" put to direct use — the win each time is
O(1) `has()` instead of scanning an array.

## 5. Hash table / Map

- `recordStats.ts`'s `rankPlayers` groups every stored match's players by id into a
`Map<string, Accum>`, exactly the "key → running total" accumulator pattern the
dsa.md [Hash table](../dsa.md#hash-table) section describes for fast lookup during a
single pass over records.
- `simulation.ts`'s `stepGame` uses a `Map<string, { head, next }>` (`intents`) to record
each player's proposed move for this tick before the pairwise stand-off check, and a
`Map<string, string>` (`splitActor`) to remember who most recently swallowed which
bystander's territory (for crediting an encirclement kill).
- Plain objects (`Record<string, PlayerState>`, `Record<string, BotProfile>`, etc.) are
the same idea used everywhere a player id needs to map to that player's state — the
dsa.md discussion of "a JavaScript object as a hash table" applies directly, since
every key here is a string id, not something that needs `Map`'s wider key-type support.



## 6. Sorting

`recordStats.ts`'s `rankPlayers` sorts the leaderboard with a **multi-key comparator** —
rating, then win rate, then average peak share, then label — so ties resolve
deterministically instead of depending on `Array.prototype.sort`'s allowed-but-unspecified
behavior for equal elements:

```ts
.sort(
  (a, b) =>
    b.rating - a.rating ||
    b.winRate - a.winRate ||
    b.avgPeakFraction - a.avgPeakFraction ||
    a.label.localeCompare(b.label),
);
```

`LandGrabDemo.tsx` does the same thing for the live in-match leaderboard, sorting players
by `scoreFor(player)` each tick. This is the same *comparator* concept dsa.md's Quicksort
section builds a whole `Comparator` utility around — here it's the browser's native sort
(good enough at leaderboard sizes) using a chained comparator instead of a hand-rolled
`compare` function, but the tie-breaking idea is identical.

## 7. Greedy algorithm (paradigm)

Every bot archetype (`botStrategy.ts`'s Rambler, `surveyorStrategy.ts`'s Surveyor,
`invaderStrategy.ts`'s Invader) picks its move the same way: score each of the (up to
four) candidate directions with a hand-tuned heuristic, and take the highest-scoring one
— "choose the best option available right now, without considering the future" — the
exact definition dsa.md's [Paradigm groupings](../dsa.md#paradigm-groupings) gives for
**Greedy**. None of them search ahead or backtrack; `docs/land-grab/bots.md` calls this
out explicitly as "a greedy one-cell lookahead — argmax over the four directions, no
search."

```ts
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
```



## 8. Ring buffer & delta encoding

`replayLog.ts` caps a match recording at `MAX_REPLAY_TICKS` (3000) frames. Once a match
runs longer, `recordFrame` drops the oldest frame for every new one it appends —
`log.frames.shift()` inside `evictOldestFrame` — which is a **ring buffer**: a fixed-size
window that always ends at the current tick instead of growing unboundedly or hard-stopping
recording. This isn't one of dsa.md's named data structures, but it's a well-known
structure in its own right (the same idea behind a circular audio buffer or a
fixed-length "last N events" log).

Alongside it, each frame after frame 0 stores only the cells that changed
(`ReplayCellChange[]`) rather than a full grid snapshot — classic **delta/diff encoding**,
the same trick that keeps the log a few MB even on a large, long-running board. Dropping
the oldest frame re-bases the new frame 0 to a full snapshot in O(board size) so
`frameGridAt` can still reconstruct any retained frame by replaying deltas forward from
frame 0.

## 9. The grid itself as a graph

Everything above operates on `CellState[][]` (`grid.ts`) the same way Number of Islands
operates on its `grid: string[][]` — cells are nodes, the four orthogonal neighbors are
edges, and "connected component" is the recurring question (is this loop's interior one
region? did a cut split a player's land into more than one piece? how far is the nearest
cell of some kind?). Land Grab never needed a different representation than the one the
original problem doc used; it just kept asking that graph new questions as the game grew.