# Land Grab — DFS / Flood Fill In Depth

This is a deep dive on the two functions that carry the Number-of-Islands DFS into the LandGrab game and a more production ready implementation:
`resolveCapture` (`src/features/landGrab/grid.ts`) and `resolveTerritorySplit`
(`src/features/landGrab/splitResolution.ts`). This doc assumes you've read
[`docs/problems/Number-of-Islands.md`](../problems/Number-of-Islands.md) — it picks up
exactly where that leaves off, showing what changes (and what doesn't) when the same
algorithm has to run inside a live game loop instead of answer one LeetCode input, and
works through the time/space complexity of each version in detail.

[`dsa-used.md`](dsa-used.md) covers *where* this DSA shows up across the whole feature in
one paragraph each; this doc is the zoomed-in version of just this one algorithm.

## Table of contents

- [1. The textbook version, briefly](#1-the-textbook-version-briefly)
- [2. The two production call sites](#2-the-two-production-call-sites)
- [3. `resolveCapture` — flood fill from the border](#3-deep-dive-resolvecapture--flood-fill-from-the-border)
- [4. `resolveTerritorySplit` — restricted `numIslands`](#4-deep-dive-resolveterritorysplit--restricted-numislands)
- [5. Why iterative, not recursive: a stack-safety rewrite](#5-why-iterative-not-recursive-a-stack-safety-rewrite)
- [6. Time complexity, in detail](#6-time-complexity-in-detail)
- [7. Space complexity, in detail](#7-space-complexity-in-detail)
- [8. A JS-specific gotcha: stack vs. queue performance](#8-a-js-specific-gotcha-stack-vs-queue-performance)
- [9. Correctness: how this is actually verified](#9-correctness-how-this-is-actually-verified)
- [10. Textbook vs. production, side by side](#10-textbook-vs-production-side-by-side)

---

## 1. The textbook version, briefly

The doc's `depthFirstSearch` sinks one connected island from a `'1'` seed:

```ts
function depthFirstSearch(row: number, col: number): void {
  if (row < 0 || row >= rowCount || col < 0 || col >= colCount || grid[row][col] !== "1") return;
  grid[row][col] = "0";
  depthFirstSearch(row - 1, col);
  depthFirstSearch(row + 1, col);
  depthFirstSearch(row, col - 1);
  depthFirstSearch(row, col + 1);
}
```

Three ingredients, all of which Land Grab reuses: a **base case** (out of bounds, or not
the thing we're looking for), a **visit** step (mark it so we never process it again),
and a **recurse** step (do the same to the four neighbors). The doc's `numIslands` then
wraps this in an outer scan: every time the scan finds an un-sunk `'1'`, that's a new
island — increment a counter and sink the whole thing.

Land Grab needs two different questions answered from that same shape, neither of which
is "how many islands are there":

1. *Which cells are enclosed by a loop I just closed?* → seed from the **border** instead
   of a land cell, flip the meaning of "visited" to "reachable open water", and the
   **un**visited cells are the answer. This is `resolveCapture`.
2. *Did cutting away some of my land split what's left into separate pieces?* → this
   *is* `numIslands`'s "count connected components" question, just restricted to one
   player's cells and answered by keeping one component instead of counting all of them.
   This is `resolveTerritorySplit`.

## 2. The two production call sites

Both are called from `stepGame` (`simulation.ts`) — never from a render loop, only when
a specific game event just happened:

| Function | Runs when | What it answers |
|---|---|---|
| `resolveCapture` | A player closes a loop (back onto their own land with a wake out) or cuts a rival's trail | "Which neutral/enemy cells are now enclosed by my territory, and should flip to mine?" |
| `resolveTerritorySplit` | After *any* capture event, once per player other than the actor | "Did that capture cut some bystander's land into disconnected pieces, and if so, which piece do they keep?" |

Both run **occasionally, not every tick** — most ticks are just a boat sliding forward
one cell, an O(1) update. That "rare tick" framing matters a lot for the complexity
discussion below, and it's already called out in
[`overall-plan.md`](overall-plan.md#performance-is-it-fast-enough-for-multiple-players-at-the-current-2x-rate):
*"the expensive part (`grid.ts` flood-fill, `splitResolution.ts`) only runs on the rare
tick where a loop actually closes, not every tick."*

## 3. `resolveCapture` — flood fill from the border

Full source, unmodified, from `grid.ts`:

```ts
export function resolveCapture(grid: CellState[][], playerId: string): CellState[][] {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const reachable: boolean[][] = Array.from({ length: rowCount }, () => new Array(colCount).fill(false));

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

  for (let col = 0; col < colCount; col++) {
    floodFromBorder(0, col);
    floodFromBorder(rowCount - 1, col);
  }
  for (let row = 0; row < rowCount; row++) {
    floodFromBorder(row, 0);
    floodFromBorder(row, colCount - 1);
  }

  return grid.map((rowCells, row) =>
    rowCells.map((cell, col): CellState => {
      if (isPlayerBoundary(cell, playerId)) return { kind: "territory", playerId };
      if (!reachable[row][col]) return { kind: "territory", playerId };
      return cell;
    })
  );
}
```

Line up the pieces against the textbook shape:

| Textbook `depthFirstSearch` | `resolveCapture`'s `floodFromBorder` |
|---|---|
| Base case: out of bounds, or `grid[row][col] !== "1"` | Base case: out of bounds, or `reachable[row][col]` already true, or `isPlayerBoundary(...)` (the closing player's own trail/territory) |
| Visit: `grid[row][col] = "0"` (mutate in place) | Visit: `reachable[row][col] = true` (a separate matrix — the input grid is never mutated) |
| Recurse: call on all 4 neighbors | Recurse: push all 4 neighbors onto the stack |
| Seed: one land cell, found by the outer scan | Seed: every border cell, in the `for` loops below `floodFromBorder`'s definition |

The one-line meaning inversion that makes it solve a different problem: **sunk land** in
the original becomes **reached water**, and instead of counting how many times we start a
new flood (islands), we run one continuous flood from *every* border cell into a single
shared `reachable` matrix and ask what it *couldn't* reach.

### Worked example

This is the exact grid `landGrabGrid.test.ts` builds — a 5×5 board with `p1` territory
forming a ring around one center cell:

```
. . . . .
. 1 1 1 .
. 1 ? 1 .
. 1 1 1 .
. . . . .
```

(`.` = neutral, `1` = p1 territory, `?` = the cell under test — either neutral, or `p2`
territory that happens to sit fully inside the ring.)

`resolveCapture(grid, "p1")` seeds `floodFromBorder` at all 16 border cells. Every one of
those is neutral, so the flood spreads freely across the outer ring of `.` cells —
`reachable[0][*]`, `reachable[4][*]`, `reachable[*][0]`, `reachable[*][4]` all end up
`true`, and so does anything else neutral it can reach. But every attempt to step from a
neutral border cell into the `1`-ring hits `isPlayerBoundary(cell, "p1")` and stops dead —
that's the base case doing its job. The flood can never step *through* the ring to reach
the center `?` cell, no matter which of the 16 border seeds it starts from. So
`reachable[2][2]` stays `false`.

Back in the final `.map`: every ring cell is `isPlayerBoundary` → stays/becomes `p1`
territory; the center cell has `reachable === false` → also becomes `p1` territory,
*regardless of whether it started out neutral or as `p2`'s land* — the "swallows an
opponent's untouched land if it was fully inside the loop" case, verified directly by
that test. Every other neutral cell (the four corners, the four outer edge-midpoints) has
`reachable === true` and is left alone.

This is the DFS-tree/backtracking idea from the Number-of-Islands doc's discussion
section, applied to the outside instead of the inside: "we go as deep as possible along
one path until we hit a boundary, then return (pop) and try the next" — except here the
"boundary" that stops exploration is the player's own claimed ground, and what's left
unexplored when every seed has exhausted its branches is the captured interior.

### Why the border needs *up to* `2·(rows + cols)` seed calls, not one

There's no single cell that's guaranteed to be on the border of open water — the border
itself might be partly blocked by someone's territory (imagine a rival's land running
along one whole edge). Seeding from *every* border cell, not just one corner, guarantees
the flood reaches every accessible patch of open border regardless of the board's shape.
[§6](#6-time-complexity-in-detail) works out why this doesn't multiply the running time
by `(rows + cols)` the way it might look like it should.

## 4. `resolveTerritorySplit` — restricted `numIslands`

Full source, unmodified, from `splitResolution.ts`:

```ts
export function resolveTerritorySplit(grid: CellState[][], playerId: string, anchors: Vec2[]): CellState[][] {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const visited: boolean[][] = Array.from({ length: rowCount }, () => new Array(colCount).fill(false));

  function isOwned(row: number, col: number): boolean {
    if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return false;
    const cell = grid[row][col];
    if (cell.kind === "territory") return cell.playerId === playerId;
    if (cell.kind === "trail") return cell.capturedFrom === playerId;
    return false;
  }

  function collectComponent(startRow: number, startCol: number): Vec2[] {
    const component: Vec2[] = [];
    const stack: Vec2[] = [{ row: startRow, col: startCol }];
    while (stack.length > 0) {
      const { row, col } = stack.pop()!;
      if (row < 0 || row >= rowCount || col < 0 || col >= colCount) continue;
      if (visited[row][col] || !isOwned(row, col)) continue;
      visited[row][col] = true;
      component.push({ row, col });
      stack.push({ row: row - 1, col }, { row: row + 1, col }, { row, col: col - 1 }, { row, col: col + 1 });
    }
    return component;
  }

  const components: Vec2[][] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      if (!isOwned(row, col) || visited[row][col]) continue;
      components.push(collectComponent(row, col));
    }
  }

  if (components.length <= 1) return grid;

  const containsAnchor = (component: Vec2[], anchor: Vec2): boolean =>
    component.some((cell) => cell.row === anchor.row && cell.col === anchor.col);

  let keeper: Vec2[] | undefined;
  for (const anchor of anchors) {
    keeper = components.find((component) => containsAnchor(component, anchor));
    if (keeper) break;
  }
  if (!keeper) {
    keeper = components.reduce((biggest, component) => (component.length > biggest.length ? component : biggest));
  }

  const next = grid.map((row) => row.slice());
  for (const component of components) {
    if (component === keeper) continue;
    for (const { row, col } of component) {
      const cell = next[row][col];
      next[row][col] = cell.kind === "trail" ? { kind: "trail", playerId: cell.playerId } : { kind: "neutral" };
    }
  }
  return next;
}
```

This is the doc's `numIslands` **outer loop verbatim** — "scan every cell; whenever you
find an unvisited one that qualifies, flood-sink the whole component it belongs to" — the
only change is `qualifies` means `isOwned(row, col)` (this player's territory, or a
still-live trail crossing that used to be their land) instead of `grid[row][col] === "1"`,
and instead of just *counting* how many components that scan finds, it collects each
one's actual cell list into `components`.

### Worked example

From `landGrabSplit.test.ts` — a 7×7 board where `p1` holds two separate blobs: a small
"stale home" pair near the corner, and a bigger 3-cell blob elsewhere, built up since:

```
1 1 . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . . . .
. . . . 1 1 .
. . . . . 1 .
```

(top-left pair at `(0,0)`–`(0,1)`; the bigger blob at `(5,4)`, `(5,5)`, `(6,5)`)

The outer scan hits `(0,0)` first — `collectComponent` floods it and its one neighbor
`(0,1)`, base-casing out everywhere else (every non-`p1` cell fails `isOwned`, and the
board edges fail the bounds check). That's component #1, two cells. The scan continues
and eventually hits `(5,4)`, flooding out to `(5,5)` and `(6,5)` — component #2, three
cells. `components.length` is `2`, so this *isn't* the "already one piece, no-op" early
return — there's real work to do.

`anchors` is `[head, home]` — `[{row:5,col:5}, {row:0,col:0}]` in the test, modeling "the
player is currently over here, but their original base was over there." The keeper search
walks `anchors` in order and takes the **first** component that contains one:
`{row:5,col:5}` is inside component #2, so component #2 wins immediately — the search
never even checks whether `{row:0,col:0}` (which *is* in component #1) would also have
matched. That priority order is deliberate: "wherever the player actually is right now"
beats "wherever they started the match," which is what lets a player who's built up a big
new territory keep it even if their long-abandoned home base gets cut off.

Component #1 (everything that isn't the keeper) gets stripped to neutral in the final
loop; component #2 is left untouched. If neither anchor had landed in any component — the
`!keeper` branch — the code falls back to `components.reduce(...)`, keeping whichever
fragment is simply the largest, so a player who's lost track of both their head and their
home entirely still keeps *something* rather than being wiped to zero outright.

### The two early-exit optimizations this function has that `resolveCapture` doesn't

- **`if (components.length <= 1) return grid;`** — if the scan finds at most one
  component, there's nothing to split; the original `grid` reference is returned
  untouched, with **no copy allocated at all**. (`landGrabSplit.test.ts`'s second case
  asserts this with `expect(next).toBe(grid)` — same object identity, not just equal
  content.)
- **`next[row][col] = cell.kind === "trail" ? ... : { kind: "neutral" }`** only ever
  touches cells belonging to a *stripped* component — every keeper cell is left as the
  exact same object reference it always was, via `row.slice()` (a shallow array copy,
  not a per-cell rebuild).

`resolveCapture` has neither optimization: it always returns a brand-new grid with every
single cell rebuilt into a new object via `.map(cell => ({...}))`, whether or not the
loop actually enclosed anything. [§7](#7-space-complexity-in-detail) puts a number on what
that costs.

## 5. Why iterative, not recursive: a stack-safety rewrite

Both functions use an explicit array as a stack (`push`/`pop`) instead of the textbook's
recursive calls. The comment on `resolveCapture` says why directly: *"Iterative (explicit
stack) so a large board's open water doesn't blow the JS call stack — this can visit tens
of thousands of cells on the 'large map' board size."*

This is worth taking seriously as an actual failure mode, not just a style choice:

- `LandGrabDemo.tsx` caps the "large map" world at `LARGE_MAP_MAX_COLS = 180` ×
  `LARGE_MAP_MAX_ROWS = 120` = **21,600 cells**.
- V8's default stack budget holds roughly a few thousand to ~15,000 simple call frames
  before throwing `RangeError: Maximum call stack size exceeded` — the exact number
  depends on frame size (this function's closure over `rowCount`/`colCount`/`playerId`/
  `grid` makes each frame heavier than a bare recursive call) and build settings.
- A worst-case shape — one long, thin, snaking corridor of open water winding across the
  whole board — forces the recursive version to go **21,600 calls deep before its first
  `return`**, because the textbook recursion doesn't return from the first branch until
  that entire path bottoms out. That's comfortably past the crash threshold.

An **explicit stack replaces call-stack depth with heap-allocated array length** — a JS
array can hold millions of entries without any special limit, so the same worst-case
shape that crashes the recursive version just makes the iterative version's `stack` array
grow larger for a moment, with no failure mode attached.

The rewrite doesn't change *what* gets computed, only *how* the traversal is driven:

| | Recursive | Iterative (this codebase) |
|---|---|---|
| "Frontier" of cells still to explore | The JS call stack (implicit) | A `stack: Array<...>` (explicit) |
| Order neighbors are explored | Fixed: whichever `depthFirstSearch(...)` call is written first (up, then down, then left, then right) fully finishes before the next starts | Reversed relative to push order, since `pop()` takes from the end — but *some* valid DFS order either way |
| Depth limit | Call-stack size (finite, fixed by the runtime) | Array length (bounded only by available memory) |
| Result (which cells end up `reachable`/in a `component`) | Identical | Identical |

That last row matters: connectivity — "can you get from A to B without crossing a
boundary" — doesn't care what order you explore in, only whether you eventually try every
reachable neighbor. Swapping the traversal order changes *which* cell gets marked
`reachable`/visited on which step, never *whether* it eventually does. So the rewrite is
a pure performance/safety change with zero behavioral difference — exactly the kind of
transformation the correctness argument in [§9](#9-correctness-how-this-is-actually-verified)
doesn't need to re-derive from scratch, since it was already true of the recursive form.

## 6. Time complexity, in detail

Let `R` = `rowCount`, `C` = `colCount`, `N` = `R × C` (total cells).

### `resolveCapture`: O(N), not O((R+C)·N)

The suspicious-looking part is the seeding: `2C + 2R` separate calls to `floodFromBorder`,
each of which *looks* like it could itself flood the whole board, suggesting
`O((R + C) · N)` in the worst case (imagine every seed call re-flooding a huge empty
board). That's not what happens, and the reason is the shared `reachable` matrix:

- The very first thing every popped cell does (after the bounds/boundary checks) is
  `reachable[row][col] = true`. Every subsequent visit to that same cell, from *any* seed
  call, hits `if (reachable[row][col] || ...) continue;` and does zero further work.
- So across *all* `2R + 2C` calls to `floodFromBorder` combined, each cell is "productively"
  visited (passes both guard checks, gets marked, pushes its neighbors) **at most once,
  total** — not once per seed call.
- A cell can still be **pushed onto the stack multiple times** before it's popped — up to
  once per already-reachable neighbor that discovers it, so up to 4 times for an interior
  cell. Each push/pop pair is O(1) work, and there are at most `4N` of them (one for each
  of the grid graph's ~`4N/2 = 2N` edges, counted from both directions) plus the
  `2R + 2C` initial seed pushes. That's `O(N + R + C)`, and since `R + C ≤ N` for any
  grid with both dimensions ≥ 1 (equality only in a 1×1 grid), this collapses to **O(N)**.

This is the same trick as **multi-source BFS/DFS**: conceptually, imagine adding one
virtual node connected to every border cell, then flooding from that single virtual node.
One flood from one source over a graph with `N` nodes and `O(N)` edges costs `O(N)` by
the standard DFS/BFS argument — the `2R + 2C` real seed calls here are just that virtual
node's edges, spelled out as separate `floodFromBorder` invocations instead of one queue
pre-loaded with every border cell. Either formulation does the same amount of total work.

After the flood, the final `grid.map(...)` rebuild visits every one of the `N` cells
exactly once. Total: **O(N) flood + O(N) rebuild = O(N)** — linear in board size, matching
the Number-of-Islands doc's own `numIslands` bound of O(m × n) exactly, just reached by a
different (multi-source) route.

### `resolveTerritorySplit`: O(N) per call, O(N) work total across its outer scan

Same argument as `numIslands` itself: the outer double loop visits every cell once
(`O(N)`), and `collectComponent`'s inner flood only ever runs on a cell that hasn't been
`visited` yet — so summed **across every `collectComponent` call the outer loop
triggers**, no cell is ever flooded twice. Total component-collection work is `O(N)`,
same bound, same reasoning as `resolveCapture`'s flood.

The two early exits from [§4](#4-deep-dive-resolveterritorysplit--restricted-numislands)
don't change the worst-case bound (still `O(N)` when a split genuinely happened) but they
do change the *typical* cost: the overwhelmingly common case — a capture that didn't
touch anyone else's land at all — bails out at `components.length <= 1` having done the
`O(N)` scan but skipped the copy entirely, and a genuine split only ever rewrites the
cells in the components being dropped, not the whole board.

### Per-tick cost: what actually happens in `stepGame`

Neither function is free-standing — `simulation.ts`'s `stepGame` decides *when* to call
them, and that's where the real per-tick cost comes from:

```ts
// On a trail cut (simulation.ts):
grid = resolveCapture(grid, player.id);                  // O(N), once
for (const otherId of state.playerOrder) {
  if (otherId === player.id || otherId === victim.id) continue;
  grid = resolveTerritorySplit(grid, other.id, [other.head, other.home]);  // O(N), per bystander
}

// On a loop close (reentering own land with a wake out):
grid = resolveCapture(grid, player.id);                   // O(N), once
for (const otherId of state.playerOrder) {
  if (otherId === player.id) continue;
  grid = resolveTerritorySplit(grid, other.id, [other.head, other.home]); // O(N), per bystander
}
```

With `P` total players, a capture-triggering tick costs **one `resolveCapture` call
(`O(N)`) plus up to `P − 1` `resolveTerritorySplit` calls (`O(N)` each)** — worst case
`O(P · N)`. Land Grab currently caps `P` at 4 (`PLAYER_CONFIGS` in `LandGrabDemo.tsx`:
one human + three bots), so this is `O(4N)`, i.e. still `O(N)` with a small constant.

Every other tick — the overwhelming majority of them — costs `O(1)` per player: a head
moves one cell, maybe one trail cell is appended. The `O(P · N)` cost only shows up on the
comparatively rare tick where a boat actually closes a loop or lands a cut, which is
exactly the framing `overall-plan.md` already gives this: *"the expensive part only runs
on the rare tick where a loop actually closes, not every tick."* This doc adds the number
behind "expensive": at the demo board (`16 × 24 = 384` cells) that's a few thousand basic
operations, over in well under a millisecond; at the large-map cap (`120 × 180 = 21,600`
cells) with 4 players, worst case is on the order of `4 × 21,600 ≈ 86,400` cell visits —
still comfortably inside a single tick's budget (`TICK_MS = 160`ms, or `40`ms at the
fastest `4×` UI speed setting) on any modern JS engine, but no longer the "may as well be
free" territory the small demo board lives in.

## 7. Space complexity, in detail

### Auxiliary bookkeeping structures: O(N)

- `resolveCapture`'s `reachable: boolean[][]` — one boolean per cell, `O(N)`.
- `resolveTerritorySplit`'s `visited: boolean[][]` — same, `O(N)`.

### The stack itself: O(N) worst case, usually far smaller

Each cell can be **pushed** up to once per neighbor that discovers it before it's ever
popped and marked (see [§6](#6-time-complexity-in-detail)'s edge-counting argument) — so
the stack's *maximum simultaneous size* is bounded by `O(N)` in the worst case (a large
open board with few obstacles pushes almost every border and interior cell onto the stack
in a short window before very many get popped). In practice, on a typical mid-match
board threaded with trails and territory, the reachable water is fragmented into much
smaller pockets and the stack rarely grows anywhere near that bound — but the *bound*
itself is `O(N)`, not `O(√N)` or some smaller figure, which is exactly why the recursive
version ([§5](#5-why-iterative-not-recursive-a-stack-safety-rewrite)) was a real crash
risk rather than a theoretical one: call-stack depth and this array's length are bounded
by the *same* `O(N)` worst case, just with a hard ceiling in one case and none in the
other.

### The returned grid: O(N), but with different allocation shapes

This is the sharpest space difference between the two functions, and it comes entirely
from *how* each one builds its new grid, not from the flood-fill logic itself:

- `resolveCapture` returns `grid.map((rowCells, row) => rowCells.map((cell, col) => ...))`
  — a **new array of new cell objects**, `N` freshly allocated objects, every single call,
  whether or not the loop enclosed a single cell. There is no cheap path.
- `resolveTerritorySplit` returns `grid.map((row) => row.slice())` — `N` array *slots*
  copied (`O(N)`), but each slot still points at the **original** cell object unless that
  specific cell belongs to a component being stripped. Combined with the
  `components.length <= 1` early return (no allocation at all), this function does
  meaningfully less allocation than `resolveCapture` in the common case, at the same
  asymptotic `O(N)` bound.

Both are still `O(N)` overall — the distinction is entirely about **constant factors and
GC pressure**, not Big-O. That distinction is real, though: on the large-map board,
`resolveCapture`'s per-call allocation is 21,600 new small objects, every single time a
loop closes anywhere on the board, for the lifetime of a match. React/Phaser demos like
this one tend to be forgiving of that (V8's generational GC is built exactly for a flood
of short-lived small objects), but it's the kind of cost that would be worth revisiting
first if this logic ever moved server-side and had to hold up under many concurrent
matches at once — see `overall-plan.md`'s note on Union-Find as a cheaper *incremental*
alternative to a full rescan on every capture.

## 8. A JS-specific gotcha: stack vs. queue performance

The Number-of-Islands doc's own BFS solution uses a literal queue:

```ts
const queue: [number, number][] = [[row, col]];
// ...
const [r, c] = queue.shift()!;
```

`Array.prototype.shift()` removes the *first* element, which in a plain JS array means
re-indexing every remaining element down by one — an `O(n)` operation, not `O(1)`. Called
once per dequeue across a loop that runs `n` times, a "queue" built this way costs
`O(n²)`, not the `O(n)` the BFS complexity argument assumes. This doesn't come up for the
doc's own examples (grids small enough that it never matters), but it's exactly the kind
of gap between "pseudocode complexity" and "what the chosen language's data structures
actually cost" that shows up the moment `n` gets large — like Land Grab's 21,600-cell
large map.

Land Grab's own code sidesteps this two different ways, for two different reasons:

- **The flood fills in this doc use a stack, not a queue** — `pop()` removes the
  *last* element, which is `O(1)` in a JS array (no re-indexing). Since flood-fill/
  connectivity doesn't care whether the traversal is depth-first or breadth-first
  ([§5](#5-why-iterative-not-recursive-a-stack-safety-rewrite)), a stack was free to
  choose here purely for that `O(1)` pop, with no algorithmic trade-off at all.
- **The BFS helpers that genuinely need breadth-first order** (`nearestOwnedDistance`,
  `nearestNeutralDistance` in `surveyorStrategy.ts`; `nearestRivalTrailDistance` in
  `invaderStrategy.ts` — covered in [`dsa-used.md` §2](dsa-used.md#2-bfs--bounded-frontier-search))
  can't switch to a stack without changing the answer, since a genuine "nearest cell"
  query depends on exploring in distance order. They dodge the same `shift()` trap a
  different way instead: build the *whole* next ring into a plain `next: Vec2[]` array
  with ordinary `push`, then replace `frontier` with it wholesale between rings. Every
  operation involved — pushing onto `next`, reassigning `frontier = next` — is `O(1)` or
  `O(ring size)`, and nothing ever calls `shift()`.

Same underlying lesson either way: the textbook's `O(V + E)` BFS/DFS bound is only real
once you've picked data-structure operations that actually deliver `O(1)` push/pop —
otherwise the Big-O on paper and the Big-O that runs on the large map silently diverge.

## 9. Correctness: how this is actually verified

Both functions have a dedicated vitest suite that exercises exactly the boundary
conditions this doc walks through by hand:

- **`src/test/landGrabGrid.test.ts`** → `resolveCapture`: the ring-enclosure case (the
  worked example in [§3](#3-deep-dive-resolvecapture--flood-fill-from-the-border)), the
  "swallows an opponent's untouched land" case, and confirming cells reachable from the
  border are correctly left alone.
- **`src/test/landGrabSplit.test.ts`** → `resolveTerritorySplit`: the two-blob split (the
  worked example in [§4](#4-deep-dive-resolveterritorysplit--restricted-numislands)), the
  no-op-when-already-connected case (asserted by reference equality, `toBe(grid)`, not
  just deep equality — a regression test for the `components.length <= 1` fast path
  specifically), the head-beats-stale-home anchor priority, the largest-fragment fallback
  when neither anchor matches, and non-interference with other players' cells.

Run them directly with `npx vitest run src/test/landGrabGrid.test.ts
src/test/landGrabSplit.test.ts` (see the root `CLAUDE.md` for the general test commands).
Because [§5](#5-why-iterative-not-recursive-a-stack-safety-rewrite) established that the
iterative rewrite can't change *which* cells end up reachable/in-component — only the
order they're discovered in — these tests are exercising the algorithm's actual
connectivity logic, not incidentally depending on traversal order to pass.

## 10. Textbook vs. production, side by side

| Concern | Number-of-Islands doc | Land Grab |
|---|---|---|
| Traversal | Recursive | Iterative, explicit stack — recursion would risk a real stack overflow at 21,600 cells ([§5](#5-why-iterative-not-recursive-a-stack-safety-rewrite)) |
| "Visited" storage | Mutate the input grid in place (`'1'` → `'0'`) | Separate `reachable`/`visited` matrix — the input grid must stay intact for the rest of the tick, and `resolveTerritorySplit` needs to distinguish "owned" from "trail crossing owned land" (`capturedFrom`), which flipping a single character can't express |
| Seed point(s) | One land cell per island, found by an outer scan | `resolveCapture`: every border cell (multi-source, [§6](#6-time-complexity-in-detail)). `resolveTerritorySplit`: an outer scan exactly like `numIslands`'s own |
| What "unvisited at the end" means | Never happens — the scan sinks every `'1'` eventually | The entire *answer*, for `resolveCapture`: unreached = enclosed |
| Output | A count (`islandCount`) | A brand-new (or, for `resolveTerritorySplit`, sometimes the *same*) `CellState[][]`, since the caller needs the resulting board, not a number |
| Called | Once, on a fixed input | Repeatedly, mid-match, on a live board that keeps changing — so allocation cost and GC pressure are real engineering concerns ([§7](#7-space-complexity-in-detail)), not just asymptotic ones |
| Time complexity | O(m × n) | O(N) per call, same bound — reached via a multi-source argument for `resolveCapture` rather than the single-seed argument that gives `numIslands` its bound |
| Space complexity | O(m × n) worst-case recursion stack | O(N) for the visited matrix and the explicit stack either way, but with no hard ceiling on the stack, and two different allocation strategies for the returned grid ([§7](#7-space-complexity-in-detail)) |

The headline complexity class never moves — this is still, provably, a linear-in-board-size
algorithm exactly like the one in the doc. What changes is everything *around* that bound:
how the traversal survives a much bigger worst-case input without crashing, how "visited"
has to coexist with state the input grid needs to keep, how often the whole thing runs
inside a real-time loop with a millisecond budget, and how much garbage each run leaves
for the collector to clean up.
