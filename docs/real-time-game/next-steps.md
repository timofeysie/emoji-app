# Next Steps — Real-Time Game Integration

## Status snapshot

| Step | Title | Status |
| --- | --- | --- |
| 0–2 | WS server, pair identity, infra | ✅ done |
| 3 | Zero WS client + game mode + NFC relay | ✅ done |
| 4 | Pico game commands + TAG notify | ✅ done |
| 5 | Games CRUD + React Games view + GameDetailView | ✅ done |
| 6 | Referee panel + live game dashboard | ✅ done |
| 7 | NFC card → answer mapping (demo-ready) | 🔲 **next** |
| 8 | Scoring + question results + winner/loser announcements | 🔲 **next** |
| 9 | NFC card group management UI | 🔲 planned |
| 10 | Multi-badge (Mode 2) | 🔲 planned |

---

## Step 6 completion review

All acceptance criteria from `6-referee.md` are implemented.
Outstanding items to verify with physical hardware:

- [ ] After "Open for Joining", a Zero in game mode receives `game.opened`
      and shows "JOIN? KEY2" on its display.
- [ ] After "Start Game", the Zero shows "GAME ON" and the Pico shows the
      green square (`GAME:active`).
- [ ] After "Open question", the Zero shows "SCAN NOW" and the Pico shows
      the `?` glyph (`GAME:question_open`).
- [ ] NFC scan while question is open → `BadgesView` receives `nfc.tagged`
      and shows the slot label + timestamp on the badge card.
- [ ] After a WS reconnect or entering game mode while a game is already
      active, the Pico immediately syncs to the correct `GAME:*` state
      (fixed in `_apply_game_state_to_display` — needs hardware confirmation).

---

## Step 7 — NFC card → answer mapping (demo-ready)

### The problem

`POST /api/guesses` currently requires a full MongoDB path to resolve a
card UID to an answer slot:

```
cardUid → NfcCard (in active NfcCardGroup) → slotLabel → AnswerOption
```

This requires:

1. A `NfcCardGroup` document in MongoDB containing the physical card UIDs.
2. A `GameNfcCardGroupAssignment` linking that group to the current game.

Neither is set up for the demo. Until Step 9 adds a management UI, guesses
always fail with "No active NFC card group is assigned to this game."

### 7a — Extend the Zero's card map to include slot labels

The Zero already has a local `NFC_CARD_MAP` (loaded from `GET /api/nfc-cards`
or a built-in fallback in `pair_config.py`). Extend each entry to include
`slotLabel` so the Zero can send the answer slot alongside the card UID.

#### `pair_config.py` change

```python
# Maps card UID → { name, display, slotLabel }
# slotLabel matches the AnswerOption slot labels in the game (A, B, C, D, E).
NFC_CARD_MAP_LOCAL = {
    "5B:6F:B8:08": {"name": "R12 - Monkey", "display": "circle", "slotLabel": "A"},
    "DB:93:B7:08": {"name": "W3 - Clown",   "display": "x",      "slotLabel": "B"},
    # Add more cards here as needed for the demo set.
}
```

The Zero already applies the server-fetched map on startup; after the
`GET /api/nfc-cards` response gains a `slotLabel` field, the Zero will
pick it up automatically.

#### Zero script change (`emoji-os-zero.py`)

When building the guess POST payload, include `slotLabel` from the local map:

```python
card_info = NFC_CARD_MAP.get(card_uid, {})
payload = {
    "gameId":      _ws_game_id,
    "questionId":  _ws_question_id,
    "pairName":    PAIR_NAME,
    "cardUid":     card_uid,
    "slotLabel":   card_info.get("slotLabel"),  # NEW — may be None
    # badgeId carried as before
}
```

### 7b — Extend `GET /api/nfc-cards` to return `slotLabel`

The static `NfcCardService` seed list currently returns `{ id, name, display }`.
Add `slotLabel` to each entry so the Zero can fetch the mapping from the server
instead of hard-coding it in `pair_config.py`.

```ts
// server/src/nfc-card.service.ts
const SEED_NFC_CARDS = [
  { id: '5B:6F:B8:08', name: 'R12 - Monkey', display: 'circle', slotLabel: 'A' },
  { id: 'DB:93:B7:08', name: 'W3 - Clown',   display: 'x',      slotLabel: 'B' },
];
```

The Zero already fetches this endpoint at startup and merges it with its
local fallback map.

### 7c — Accept `slotLabel` in `POST /api/guesses` (fallback path)

Extend `submitGuessSchema` to accept an optional `slotLabel` field. When
`slotLabel` is provided by the Zero and no MongoDB `GameNfcCardGroupAssignment`
exists, use the provided slot to resolve the `AnswerOption` directly:

```
cardUid + slotLabel (from Zero) → AnswerOption (by questionId + slotLabel)
```

This means the card-to-answer mapping lives on the device (Zero's map) for
the demo, bypassing the MongoDB card-group path entirely. The MongoDB path
remains intact and takes precedence when an assignment exists.

**`submitGuess` decision logic:**

```
1. Look for active GameNfcCardGroupAssignment for this game.
2. If found → use MongoDB path (existing behaviour).
3. If not found AND caller supplied slotLabel → find AnswerOption by
   (questionId, slotLabel) directly and record the guess.
4. If not found AND no slotLabel → return 400 "no card group assigned".
```

#### Schema change

```ts
const submitGuessSchema = z.object({
  gameId:        objectIdSchema,
  questionId:    objectIdSchema,
  pairName:      z.string().min(1).optional(),
  badgeId:       z.string().optional(),
  guesserUserId: objectIdSchema.optional(),
  cardUid:       z.string().min(1),
  slotLabel:     slotLabelSchema.optional(),   // NEW
});
```

#### Repository change (`submitGuess`)

Add the fallback branch after the MongoDB assignment lookup fails.

### 7d — `GameDetailView`: assign NFC card group to game

The server already has:
- `POST /api/nfc-card-groups` — create a card group with cards.
- `POST /api/nfc-card-groups/:groupId/games/:gameId` — attach a group to a game.

Extend `GameRefereePanel` with a compact "NFC card group" section that
shows the currently assigned group (if any) and lets the referee assign one:

```
┌─ NFC Card Group ──────────────────────────┐
│ Active group: Demo Set A (4 cards)         │
│ [Change group ▾]                           │
└────────────────────────────────────────────┘
```

For the initial demo, this section can simply show whether a group is
assigned and provide a "Assign demo group" button that calls
`POST /api/nfc-card-groups` with the static seed cards and then attaches
the result to the current game. This avoids needing a separate management
UI (Step 9).

### Acceptance criteria — Step 7

- [ ] Zero sends `slotLabel` alongside `cardUid` in `POST /api/guesses`.
- [ ] `POST /api/guesses` succeeds without a MongoDB card-group assignment
      when `slotLabel` is supplied by the Zero.
- [ ] `GET /api/nfc-cards` response includes `slotLabel` for each card.
- [ ] `submitGuess` still uses the MongoDB path when an active assignment
      exists (regression: existing tests still pass).
- [ ] A referee can optionally assign a card group from `GameDetailView`.

---

## Step 8 — Scoring + question results + winner/loser announcements

### Overview

After each question closes and at game end, the system must:

1. **Calculate** which pairs answered correctly.
2. **Broadcast** a result event so every client (dashboard + Zero) knows
   the outcome.
3. **Update badge displays**: the winning Pico shows a celebration animation;
   losing or non-answering Picos show a consolation animation.
4. **Show a leaderboard** in the React app throughout the game.

### 8a — Server: compute and broadcast question results

#### New WS event: `question.result`

Emitted by the server immediately after a question transitions to `closed`.

```json
{
  "type": "question.result",
  "gameId": "…",
  "questionId": "…",
  "correctSlotLabel": "B",
  "results": [
    { "pairName": "green",  "slotLabel": "B", "isCorrect": true  },
    { "pairName": "white",  "slotLabel": "A", "isCorrect": false },
    { "pairName": "red",    "slotLabel": null, "isCorrect": false }
  ],
  "serverTime": "…"
}
```

`results` includes every bound pair; `slotLabel: null` means no guess was
submitted before the question closed.

#### Trigger point

Extend `setQuestionState` (repository + controller) so that when the new
state is `"closed"`:

1. Find all guesses for this `(gameId, questionId)` keyed by `pairName`.
2. Find the correct `AnswerOption.slotLabel` for this question.
3. Build the `results` array.
4. Emit `question.result` to dashboards **and** to the pair rooms of the
   bound game (so the Zero receives it).

```ts
// After closing question, in GameFlowController:
const result = await this.gameDataRepository.computeQuestionResult(gameId, questionId);
this.badgeStateService.broadcastDashboard({ type: 'question.result', ...result });
this.badgeStateService.sendToPairNames(boundPairNames, { type: 'question.result', ...result });
```

#### New repository method: `computeQuestionResult`

```ts
async computeQuestionResult(gameId: string, questionId: string): Promise<QuestionResultPayload>
```

- Find the correct `AnswerOption` for the question (`isCorrect: true`).
- Load all `Guess` documents for `(gameId, questionId)`.
- Load all bound `pairName` values for the game.
- Build `results[]` — one entry per bound pair, with their submitted
  `slotLabel` (or `null`) and `isCorrect` flag.

#### New endpoint: `GET /api/games/:gameId/scores`

Returns cumulative correct-guess counts per pair for the whole game so far.
Used by the leaderboard on `GameDetailView`.

```json
{
  "gameId": "…",
  "scores": [
    { "pairName": "green", "correct": 3, "total": 4 },
    { "pairName": "white", "correct": 1, "total": 4 }
  ]
}
```

Computed by aggregating the `Guess` collection — joining with `AnswerOption`
to check `isCorrect`.

### 8b — Zero: handle `question.result`

The Zero receives `question.result` in `_ws_handle_event` and looks up
whether its own `pairName` got the question right:

```python
elif etype == "question.result":
    results = event.get("results", [])
    pair_result = next(
        (r for r in results if r.get("pairName") == PAIR_NAME), None
    )
    if game_mode_active:
        draw_display()
    if pair_result and pair_result.get("isCorrect"):
        await _ble_write_game_cmd("GAME:correct")
    else:
        await _ble_write_game_cmd("GAME:wrong")
```

After a short delay the display returns to the between-questions state:

```python
    await asyncio.sleep(4)
    await _ble_write_game_cmd("GAME:question_close")
```

### 8c — Zero: handle `game.ended` with final scores

Extend the existing `game.ended` handler to include final scoring so the
Zero can show a personalised end screen. The `game.state.changed` event
already broadcasts to dashboards; a new field `scores` can be included on
the controller-targeted `game.ended` event:

```json
{
  "type":    "game.ended",
  "gameId":  "…",
  "pairName": "green",
  "isWinner": true,
  "rank":     1,
  "score":    3,
  "serverTime": "…"
}
```

Zero handler:

```python
elif etype == "game.ended":
    _ws_game_state  = "completed"
    _ws_question_id = None
    if game_mode_active:
        draw_display()
    if event.get("isWinner"):
        await _ble_write_game_cmd("GAME:winner")
    else:
        await _ble_write_game_cmd("GAME:loser")
```

### 8d — Pico: new end-state BLE commands

Extend `handle_command` in `emoji-os-pico.py` with four new `GAME:*`
commands. These are additive — the existing `GAME:active`, `GAME:question_open`,
`GAME:question_close`, and `GAME:ended` stay unchanged.

| New command | Duration | Display |
| --- | --- | --- |
| `GAME:correct` | ~4 s then auto-clears | Bright flashing pattern — e.g. alternating full-grid on/off twice, then scrolling `"YES"` |
| `GAME:wrong` | ~4 s then auto-clears | Dim slow pulse — e.g. a single centre pixel blinks twice, then small 2×2 dot |
| `GAME:winner` | Until next command | Stars or confetti pattern; scrolls `"WIN"` |
| `GAME:loser` | Until next command | Sad minimal pattern; scrolls `"END"` |

After `GAME:correct` / `GAME:wrong` expire, the Pico should revert to the
white dot (`GAME:question_close` state). Implement by scheduling an internal
timed task (`asyncio.sleep` then clear) rather than waiting for the Zero to
resend.

**Suggested Pico display patterns:**

```
GAME:correct — 4 × 4 bright square, 2 flashes at 300 ms, then "YES" scroll
GAME:wrong   — single centre pixel, 2 slow blinks at 800 ms, then 2×2 dot
GAME:winner  — alternating checkerboard fill, then scrolling "WIN"
GAME:loser   — dim 1-pixel blink, then all off (Pico goes dark / idle)
```

### 8e — React: live leaderboard in `GameDetailView`

Add a compact leaderboard below the questions list (or in a third column on
wide screens) that refreshes after each `question.result` WS event:

```
┌─ Scores ──────────────────────┐
│ 1. green   3 / 4 correct  ★   │
│ 2. white   1 / 4 correct       │
│ 3. red     0 / 4 correct       │
└────────────────────────────────┘
```

The leaderboard is fetched from `GET /api/games/:id/scores` on mount and
updated in-place when `question.result` arrives on the WebSocket.

### 8f — React: extend `BadgesView` for question results

The `BadgesView` already shows join and NFC tag events per badge card.
Extend it to also handle `question.result`:

- Add a `resultsByPair: Record<string, { slotLabel: string | null; isCorrect: boolean }>` state slice.
- Update it on each `question.result` WS event.
- Show a small result chip on each badge card:
  - Green `✓ B` when correct (slot label + tick).
  - Red `✗ A` when incorrect (their slot label + cross).
  - Grey `—` when no guess was submitted.
- Clear the chip when the next `question.opened` event arrives.

### 8g — Extend `WsEnvelope` in `BadgesView`

Add the new event types to the union:

```ts
| { type: 'question.result';
    gameId: string;
    questionId: string;
    correctSlotLabel: string;
    results: Array<{ pairName: string; slotLabel: string | null; isCorrect: boolean }>;
    serverTime: string }
```

### Acceptance criteria — Step 8

- [ ] On `POST /questions/:id/state { state: "closed" }`, server emits
      `question.result` to dashboards and to bound pair rooms.
- [ ] Zero receives `question.result`, looks up its own pair, and sends
      `GAME:correct` or `GAME:wrong` to the Pico within 1 s.
- [ ] Pico shows win animation for 4 s after `GAME:correct`, then white dot.
- [ ] Pico shows lose animation for 4 s after `GAME:wrong`, then white dot.
- [ ] On game end, Zero sends `GAME:winner` (rank 1) or `GAME:loser` to Pico.
- [ ] `GET /api/games/:id/scores` returns correct counts per pairName.
- [ ] `GameDetailView` leaderboard updates live after each question closes.
- [ ] `BadgesView` badge cards show the result chip after `question.result`.

---

## Step 9 — NFC card group management UI (planned)

Currently card UIDs are hardwired in the server's `nfc-card.service.ts`.
Step 9 makes them manageable through the React app.

### What's already built

The server already has the full MongoDB data model:

- `NfcCardGroup` — a named set of physical cards.
- `NfcCard` — one card per UID, with `slotLabel` (A–E) and `displayName`.
- `GameNfcCardGroupAssignment` — links a group to a specific game.
- `POST /api/nfc-card-groups` — create a group with cards.
- `POST /api/nfc-card-groups/:groupId/games/:gameId` — attach to game.

### New React views needed

#### `NfcCardGroupsView` — `/nfc-card-groups`

List of card groups. Each row shows group name, card count, status.
"+ New Group" button opens a dialog where the referee enters:

- Group name (e.g. "Demo Set A").
- Cards: one row per card — UID, slot label (A/B/C/D/E), display name.
  UID can be typed or left as a placeholder to fill later.

#### `GameDetailView` extension — assign card group

A "Card Group" section in `GameRefereePanel` (see Step 7d mockup) that
shows the currently assigned group and lets the referee pick a different one
from a dropdown of existing groups.

### Card provisioning workflow (recommended for the demo)

1. Scan each physical NFC card once with the Zero (which logs the UID in
   the terminal output or `POST /api/status` extra fields).
2. Note the UID and the intended slot label for that card (A, B, C, or D).
3. Enter the mapping in the React `NfcCardGroupsView`.
4. Assign the group to the game from `GameDetailView`.

---

## Step 10 — Multi-badge Mode 2 (planned)

See `game-modes.md` for the full design. This step is not required for the
current demo. Key changes when needed:

- Zero: extend scan loop to connect to all `Pico-Client-<PAIR_NAME>` devices
  simultaneously, using a `dict[address, BleakClient]`.
- Zero: per-badge `_on_pico_tx_notify` carrying `badgeId`.
- Dashboard: badge cards are already keyed `controllerId::badgeId` so N
  badges from one controller already render as N cards.

---

## Summary of work by layer

### Server (NestJS)

| Task | Step |
| --- | --- |
| Extend `submitGuessSchema` to accept `slotLabel` | 7c |
| Fallback path in `submitGuess` (no card group) | 7c |
| Extend `GET /api/nfc-cards` to return `slotLabel` | 7b |
| `computeQuestionResult` repository method | 8a |
| `question.result` event emitted on question close | 8a |
| `GET /api/games/:id/scores` endpoint | 8a |
| Include scores / `isWinner` in `game.ended` controller event | 8c |
| `POST /api/nfc-card-groups` and assignment endpoints (already built) | 9 |

### Zero (`emoji-os-zero.py`)

| Task | Step |
| --- | --- |
| Include `slotLabel` in `POST /api/guesses` payload | 7a |
| Update `NFC_CARD_MAP_LOCAL` in `pair_config.py` with slot labels | 7a |
| Handle `question.result` event → `GAME:correct` / `GAME:wrong` | 8b |
| Auto-revert to `GAME:question_close` after 4 s | 8b |
| Handle `game.ended` with `isWinner` → `GAME:winner` / `GAME:loser` | 8c |

### Pico (`emoji-os-pico.py`)

| Task | Step |
| --- | --- |
| `GAME:correct` — brief win animation (~4 s) + auto-revert | 8d |
| `GAME:wrong` — brief lose animation (~4 s) + auto-revert | 8d |
| `GAME:winner` — sustained winner display | 8d |
| `GAME:loser` — sustained loser display | 8d |

### React client

| Task | Step |
| --- | --- |
| `GET /api/nfc-cards` response includes `slotLabel` (used by BadgesView) | 7b |
| `GameRefereePanel`: assign card group to game | 7d |
| `GameDetailView`: live leaderboard (from `GET /api/games/:id/scores`) | 8e |
| `BadgesView`: handle `question.result` → result chip per badge card | 8f |
| `WsEnvelope` extended with `question.result` | 8g |
| `NfcCardGroupsView` — card group CRUD | 9 |

---

## Recommended implementation order

1. **Step 7a+7b** (Zero + server, ~1 h): add `slotLabel` to card map on both
   sides — lowest risk, unblocks end-to-end guess flow.
2. **Step 7c** (server, ~1 h): fallback `slotLabel` path in `submitGuess` —
   makes guesses work without a MongoDB card group.
3. **Step 8d** (Pico, ~2 h): add `GAME:correct/wrong/winner/loser` display
   routines — can be tested locally with direct BLE writes before wiring the
   server.
4. **Step 8a** (server, ~2 h): `computeQuestionResult` + `question.result`
   event + `GET /api/games/:id/scores`.
5. **Step 8b+8c** (Zero, ~1 h): handle `question.result` and enriched
   `game.ended`.
6. **Step 8e+8f+8g** (React, ~2 h): leaderboard + badge result chips +
   WsEnvelope extension.
7. **Step 9** (React + server, ~3 h): NFC card group management UI.
