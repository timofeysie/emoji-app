# Step 6 — Referee Panel + Live Game Dashboard

Status: **✅ done**

This step made the React app a functional game control surface. A referee can
bind controllers to a game, drive the full game lifecycle, and open/close
questions — all without touching the command line. The `BadgesView` is extended
to show live game state per badge pair.

---

## What was built

| Endpoint / Event | Has UI? |
| --- | --- |
| `POST /api/games/:id/pairs` — bind pair | ✅ `GameRefereePanel` — one-click chips + manual input |
| `POST /api/games/:id/state` — lifecycle | ✅ `GameRefereePanel` — state-conditioned button set |
| `POST /api/questions/:id/state` — open/close | ✅ `GameDetailView` — inline Open/Close per question row |
| `GET /api/version` — expected versions | ✅ `BadgesView` — amber "outdated" chip per badge card |
| WS `game.state.changed` | ✅ `BadgesView` — game state + time shown on badge card |
| WS `controller.joined` | ✅ `BadgesView` — "Joined at HH:MM" on badge card |
| WS `nfc.tagged` | ✅ `BadgesView` — "NFC: B · HH:MM:SS" on badge card |

---

## 6a — `GameDetailView`: referee sidebar

### Layout (as built)

`GameDetailView` uses a responsive two-column layout: questions on the left
(flex-1), `GameRefereePanel` on the right (fixed 18 rem / `lg:w-72`). On
narrow screens the panel stacks below the question list (`lg:flex-row`).

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Games    My Quiz Night                              [active]       │
├────────────────────────────────────────┬────────────────────────────┤
│ Questions                    (3)       │ REFEREE CONTROLS           │
│ ─────────────────────────────────────  │ ─────────────────────────  │
│ Q1  What colour is the sky?  [closed]  │ Bound pairs                │
│     A: Blue ✓  B: Red  C: Green        │  green  ✓ joined           │
│     [Open]                             │  + power-cable (chip)      │
│                                        │ [pair name…] [+ Bind]      │
│ Q2  Capital of France?       [open]    │                            │
│     A: London  B: Paris ✓              │ Game state                 │
│     [Close]                            │  ● active                  │
│                                        │ [End Game]  [Pause]        │
└────────────────────────────────────────┴────────────────────────────┘
```

### 6a-i — Pair binding (as built)

`GameRefereePanel` fetches `GET /api/badges` on mount and extracts all
unique `pairName` values from badge status records. Pairs not yet bound to
the current game appear as clickable dashed chips for one-click binding:

```tsx
// Known-pair chips — one click calls POST /api/games/:id/pairs
{knownPairs
  .filter((n) => !game.boundPairs.some((bp) => bp.pairName === n))
  .map((n) => (
    <button onClick={() => bindPair(n)}>
      <Plus /> {n}
    </button>
  ))}

// Manual input as a fallback
<Input placeholder="pair name (e.g. green)" ... />
<Button onClick={() => bindPair()}>Bind</Button>
```

- Calls `POST /api/games/:gameId/pairs` with `{ pairName }`.
- On success, calls `onRefresh()` which re-fetches `GET /api/games/:gameId`.
- Bound pairs list shows each `pairName` with a green "ready to start" chip
  or "· waiting to join" text. `GameDetailView` refreshes this list on WS
  `controller.joined`.
- Inline loading spinner + error message on failure (surfaces server
  `error` and `message` fields).

### 6a-ii — Game lifecycle buttons (as built)

`GameRefereePanel` renders a set of buttons based on `game.state`:

| Current state | Buttons shown |
| --- | --- |
| `draft` | *(auto → `ready` when detail page opens)* |
| `ready` | **Open for Joining** |
| `lobby` | **Start Game** · **Cancel** |
| `active` | **End Game** · **Pause** |
| `paused` | **Resume** · **Cancel** |
| `completed` | **Play Again** |
| `cancelled` | **Restart** |

Each button calls `POST /api/games/:gameId/state` with the target state.
On success, `onRefresh()` re-fetches the full game so the state chip and
button set update. Inline spinner while in-flight; error message on failure
without losing the current view.

Transition map (mirrors server-side `allowedTransitions`):

```
draft      → ready      (open game detail page)
ready      → lobby      (Open for Joining)
lobby      → active     (Start Game)
lobby      → cancelled  (Cancel)
active     → completed  (End Game)
active     → paused     (Pause)
paused     → active     (Resume)
paused     → cancelled  (Cancel)
completed  → ready      (Play Again)
cancelled  → ready      (Restart)
```

### 6a-iii — Question open/close toggles (as built)

Each `QuestionCard` in `GameDetailView` gains an Open/Close button on the
right edge of the header row, visible and interactive **only** when
`game.state === 'active'`:

```tsx
{isActive && (
  <Button
    variant={isOpen ? 'default' : 'outline'}
    disabled={toggling || (!isOpen && hasOpenQuestion)}
    title={!isOpen && hasOpenQuestion ? 'Another question is already open' : undefined}
    onClick={handleToggle}
  >
    {isOpen ? 'Close' : 'Open'}
  </Button>
)}
```

- Calls `POST /api/questions/:questionId/state` with `{ gameId, state: 'open'|'closed' }`.
- On success, re-fetches via `GET /api/games/:gameId/questions` (lighter than the
  full game detail endpoint).
- The Open button on other questions is **disabled** (not just warned) when
  one question is already open — `hasOpenQuestion` is derived from
  `game.questions.some((q) => q.state === 'open')`.
- Inline spinner + error message on failure.

### 6a-iv — Auto-refresh after mutations (as built)

- Lifecycle state changes call `loadGame()` — full game detail re-fetch.
- Question open/close calls `refreshQuestions()` — lighter
  `GET /api/games/:gameId/questions` re-fetch; merges result into
  `game.questions` without replacing the rest of the game object.
- No full page reload required.

---

## 6b — `BadgesView`: live game event stream

### Extended `WsEnvelope` type (as built)

```ts
type WsEnvelope =
  | { type: 'status.changed';    payload: StatusChangedEvent }
  | { type: 'emoji.sent';        payload: EmojiSentEvent }
  | { type: 'game.state.changed'; gameId: string; state: string; serverTime: string }
  | { type: 'controller.joined';  gameId: string; pairName: string;
                                   controllerId?: string; serverTime: string }
  | { type: 'nfc.tagged';         gameId: string; questionId?: string; pairName?: string;
                                   controllerId?: string; badgeId?: string;
                                   cardUid?: string; slotLabel?: string; serverTime: string };
```

### Game event state (as built)

`BadgesView` holds three new state slices updated by the WS `onmessage` handler:

```ts
const [activeGame, setActiveGame] = useState<GameEventState | null>(null);
// pairName → most recent join event
const [joinsByPair, setJoinsByPair] = useState<Record<string, JoinEvent>>({});
// pairName → most recent NFC tag event
const [nfcByPair, setNfcByPair] = useState<Record<string, NfcTagEvent>>({});
```

`game.state.changed` → updates `activeGame`.
`controller.joined` → upserts into `joinsByPair` keyed by `pairName`.
`nfc.tagged` → upserts into `nfcByPair` keyed by `pairName`.
Unknown event types are ignored rather than silently swallowed — only the
four handled types are dispatched.

### Badge card game section (as built)

A `BadgeCardGameSection` component renders below the emoji block on each
badge card when the card's `status.pairName` has a matching join or NFC event:

```
┌──────────────────────────────────┐
│ green                            │  ← pairName (bold)
│ badge-88-a2-…                    │  ← badgeId
│ ── BLE connection row ──         │
│ ── Emoji block ──                │
│ active  · 14:31                  │  ← game state + short time
│ Joined at 14:32                  │  ← join event
│ NFC: B · 14:33                   │  ← last tag (slotLabel + time)
└──────────────────────────────────┘
```

The game section is omitted entirely when no game event has been received
for that pair's `pairName`.

---

## 6c — Version outdated badge

### As built

`BadgesView` fetches `GET /api/version` once on mount:

```json
{
  "version": "1.1.9",
  "expectedControllerVersion": "0.6.1",
  "expectedPicoVersion": "0.4.1"
}
```

The server defaults (`app-version.ts`) were updated to `0.6.1` / `0.4.1`
to match the current running firmware.

For each badge card, `controllerVersion` and `picoVersion` are compared
against the expected values using a proper semver numeric comparison —
the chip only appears when the device version is **strictly older** than
the expected minimum (e.g. `0.5.8 < 0.6.1` → outdated):

```ts
function isVersionOutdated(actual: string | undefined, expected: string): boolean {
  // normalises "v" prefix and ".x" wildcard suffix, then compares
  // each numeric segment; returns true only when actual < expected.
}
```

An amber chip is shown inline next to the version text:

```
🎮 0.5.8  ⚠ outdated    CPU 0.3.2  ⚠ outdated
🎮 0.6.1  ✓             CPU 0.4.1  ✓
```

The chip uses `bg-amber-100 text-amber-800` styling.

**Note on original spec:** The first implementation used a string-prefix
match (`actual.startsWith(prefix)`) which incorrectly flagged newer device
versions as outdated. This was fixed to the semver comparison above after
hardware testing showed `0.6.1` being flagged against expected `0.5.8`.

---

## New file: `GameRefereePanel.tsx`

Extracted into its own component as planned:

```
client/src/app/views/components/GameRefereePanel.tsx
```

```tsx
export function GameRefereePanel({
  game,
  onRefresh,
}: {
  game: GameDetail;  // id, title, state, boundPairs[]
  onRefresh: () => void;
}) { ... }
```

The panel renders (top to bottom):

1. **Bound pairs list** — each pair with ready-to-start / waiting-to-join chip
   (live via `controller.joined` → `loadGame()`).
2. **Known-pair quick-bind chips** — dashed chips from `GET /api/badges`,
   filtered to exclude already-bound pairs. One click binds.
3. **Manual bind input + Bind button** — fallback for pairs not yet in
   the badge list.
4. **Game state indicator** — colour-coded dot + state label.
5. **Lifecycle buttons** — conditioned on `game.state` (see 6a-ii).

Question Open/Close buttons live in the `QuestionCard` component inside
`GameDetailView`, inline with each question row, as originally planned.

---

## `_apply_game_state_to_display` fix (Zero script)

A related fix was applied to `emoji-os-zero.py` during Step 6 testing:

**Problem:** When a user entered game mode (menu 3 / pos 4) while a game
was already active on the server, the Pico badge did not update — the
`_apply_game_state_to_display` function only redrew the Zero's own display.

**Fix:** `_apply_game_state_to_display` is now `async` and also writes the
appropriate `GAME:*` BLE command to the Pico based on `_ws_game_state`:

```python
async def _apply_game_state_to_display():
    if game_mode_active:
        draw_display()
    if _ws_game_state == "active" and _ws_question_id:
        await _ble_write_game_cmd("GAME:question_open")
    elif _ws_game_state == "active":
        await _ble_write_game_cmd("GAME:active")
    elif _ws_game_state == "completed":
        await _ble_write_game_cmd("GAME:ended")
```

`start_emoji_animation` (the game-mode entry point) now schedules this
async function via `asyncio.run_coroutine_threadsafe` so the Pico syncs
immediately. The `controller.welcome` handler now `await`s it.

---

## 6d — Restart a completed game

Status: **✅ done**

### Problem

`setGameState` in the repository only allows transitions out of the
terminal states `completed` and `cancelled`. Once a game ends, the referee
has no way to run the same game again — they would have to create a new game
and re-enter all the questions.

The goal is to let the referee click **Play Again** (on a `completed` game)
or **Restart** (on a `cancelled` game) and have the game reset cleanly to
`ready`, preserving the title and questions, so it can be opened, joined,
and played through again from the beginning.

### What a restart resets

| Field / collection | Reset to | Reason |
| --- | --- | --- |
| `game.state` | `'ready'` | Start the lifecycle over |
| `game.startedAt` | cleared (`$unset`) | Fresh timestamp on next Start |
| `game.endedAt` | cleared (`$unset`) | Remove the old end marker |
| `question.state` (all for this game) | `'closed'` | Ensure no question is left open from the previous run |
| `pairBinding.joined` (all for this game) | `false` | Pairs must re-join the new session |
| `guesses` (all for this game) | **deleted** | Clears `uniq_guess_per_pair` so the same pair can answer again |

**Guesses are deleted on Play Again / Restart.** Keeping them blocked replay
with `E11000 duplicate key` on `(questionId, pairName)`. Per-run history can
return later via a `runId` (scoped uniqueness) without blocking demos.

### Server changes

#### 1. Extend `allowedTransitions` in `setGameState`

```ts
const allowedTransitions: Partial<Record<GameState, GameState[]>> = {
  ready:     ['lobby'],
  lobby:     ['active', 'cancelled'],
  active:    ['paused', 'completed', 'cancelled'],
  paused:    ['active', 'cancelled'],
  completed: ['ready'],   // Play Again
  cancelled: ['ready'],   // Restart
};
```

#### 2. Reset side effects on `ready` entry from a terminal state

Add a branch in `setGameState` (or a dedicated `resetGameForReplay`
repository method called from the controller) that fires when the
**incoming** state is `ready` **and** the current state is `completed` or
`cancelled`:

```ts
if (input.state === 'ready' && ['completed', 'cancelled'].includes(game.state)) {
  // Clear timestamps on the game document
  await Game.updateOne(
    { _id: asObjectId(input.gameId) },
    { $set: { state: 'ready' }, $unset: { startedAt: '', endedAt: '' } },
  );

  // Reset all questions for this game back to closed
  await Question.updateMany(
    { gameId: asObjectId(input.gameId) },
    { $set: { state: 'closed' }, $unset: { openedAt: '', closedAt: '' } },
  );

  // Reset joined flag on all bound pairs
  await PairBinding.updateMany(
    { gameId: asObjectId(input.gameId) },
    { $set: { joined: false, updatedAt: new Date() } },
  );
}
```

This replaces the normal timestamp-stamp path (the `timestampFields` map
does not apply when transitioning to `ready`).

#### 3. WS event

The existing `game.state.changed` broadcast (emitted after every
`setGameState` call) carries the new `state: 'ready'` to the dashboard.
Bound Zero controllers also receive `game.ready`, which clears any
winner/loser sticky UI (fireworks / rain) and returns both Zero and Pico
to the standby `G` glyph. Controllers then receive `game.opened` when the
referee subsequently transitions to `lobby`.

### React UI changes

#### `GameRefereePanel` — add terminal-state buttons

Extend the `LIFECYCLE_BUTTONS` map with entries for the two terminal states:

```ts
const LIFECYCLE_BUTTONS: Record<GameState, LifecycleButton[]> = {
  // ... existing entries ...
  completed: [{ label: 'Play Again', targetState: 'ready' }],
  cancelled: [{ label: 'Restart',    targetState: 'ready' }],
};
```

No other UI change is required. The existing `transitionState` handler
already calls `POST /api/games/:id/state` and then `onRefresh()`, which
re-fetches the full game detail. After the refresh, the state chip shows
`ready`, the Open/Close question buttons disappear (game no longer `active`),
and the button set resets to **Open for Joining**.

### Zero / Pico changes

On `game.ready`, the Zero clears `_game_end_outcome`, stops any outcome
animation, redraws the standby `G` glyph, and BLE-writes `GAME:mode` to the
Pico. After that the lifecycle follows the same path as a new game:
`ready → lobby` (Open for Joining) → `game.opened` → "JOIN? KEY1" → …

### Acceptance criteria — 6d

- [x] **Play Again** button appears in `GameRefereePanel` when
      `game.state === 'completed'`; **Restart** appears when `cancelled`.
- [x] Clicking either button calls `POST /api/games/:id/state { state: 'ready' }`.
- [x] After the call: `game.state` is `'ready'`; `startedAt` and `endedAt`
      are cleared; all questions are `'closed'`; all bound pairs have
      `joined: false`.
- [x] Controllers receive `game.ready` and show standby `G` (not fireworks).
- [x] The state chip and lifecycle button set in `GameDetailView` update
      immediately (on `onRefresh()`).
- [x] The question Open/Close buttons no longer appear (game is not `active`).
- [x] Existing questions and answer options are preserved — no re-entry needed.
- [x] Guesses from the previous run are deleted so pairs can answer again.
- [x] Bound pairs are retained — referee does not need to re-bind controllers.
- [x] The game can then be opened, joined, and played through again from
      the `ready` state, exactly as a first run.

---

## Acceptance criteria

- [x] **Bind pair**: known pairs from `/api/badges` appear as one-click
      chips; manual input also available; bound pairs list refreshes on
      success; inline error on failure.
- [x] **Open for Joining**: clicking transitions game to `lobby`; state
      chip updates; lifecycle buttons change to Start/Cancel.
- [x] **Start Game**: transitions to `active`; question Open/Close buttons
      appear in each question row.
- [x] **Open question**: target question shows state "open"; Open buttons
      on other questions are disabled while one is open.
- [x] **NFC scan**: `BadgesView` receives `nfc.tagged` and shows slot label
      + timestamp on the matching pair's badge card.
- [x] **Close question**: question returns to "closed"; Open buttons
      re-enabled.
- [x] **End Game**: transitions to `completed`; lifecycle buttons disappear;
      question Open/Close buttons disappear (only shown when `active`).
- [x] **controller.joined** WS event: badge card for the joining pair shows
      "Joined at HH:MM".
- [x] **Version outdated**: amber "⚠ outdated" chip shown next to version
      text when device version is older than the server's expected minimum;
      uses proper semver comparison (not prefix match).
- [x] **All mutations**: inline loading spinner (button disabled) and inline
      error message on failure without losing the current view.

### Pending hardware verification

These items are implemented but need confirmation with a live Zero + Pico:

- [ ] After "Open for Joining", a Zero in game mode receives `game.opened`
      and shows "JOIN? KEY1" on the Zero display.
- [ ] After "Start Game", the Zero shows "GAME ON" and the Pico shows the
      green square (`GAME:active` command received).
- [ ] After "Open question", the Zero shows "SCAN NOW" and the Pico shows
      the `?` glyph.
- [ ] Entering game mode (menu 3 / pos 4) while a game is already active
      immediately syncs the Pico to the correct `GAME:*` state via the
      updated `_apply_game_state_to_display`.
- [ ] NFC scan while question is open flows through: Pico TAG → Zero
      `POST /api/guesses` → server `nfc.tagged` → BadgesView badge card.
