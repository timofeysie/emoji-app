# Step 8 — Scoring, results, and platform icons

Status: **🔲 planned** (Step 7 NFC card → answer mapping is ✅ done)

This step closes the demo loop after a guess is recorded: every platform
shows a clear visual for each game state, players get immediate
correct/wrong feedback on card tap, the server broadcasts per-question
results and cumulative scores, and end-of-game winner/loser displays fire
on the Pico, Zero, and React app.

**Authoritative visual contract:**
[Platform icon / display reference](../../../rainbow-connection/python/emoji-os/project/multiplayer-mode.md#platform-icon--display-reference)
in `multiplayer-mode.md`. Where older notes in `next-steps.md` (e.g. scroll
`YES` / `WIN`) disagree with that table, the Platform icon table wins.

Related:

- `next-steps.md` — Step 8 overview (scoring events + leaderboard)
- `game-realtime-design.md` — overall plan
- `6-referee.md` — referee UI and BadgesView game section (done)
- Step 7 (NFC `slotLabel` path) — done; no dedicated step file

---

## Goals

1. **Shared visual language** — Pico matrix, Zero LCD, and emoji-app Lucide
   icons all map 1:1 to the Platform icon table for every game state.
2. **Immediate correct/wrong on card scan** — Zero resolves correctness from
   the guess response (or local map), updates its LCD, and sends
   `GAME:correct` / `GAME:wrong` to the Pico without waiting for question
   close.
3. **Question results + scores** — On question close, server emits
   `question.result`; React shows a live leaderboard and result chips.
4. **Winner / loser end state** — Enriched `game.ended` drives fireworks
   (winner) or rain (loser) on Pico + Zero, and Lucide icons in the app.

---

## Platform icon / display contract

Copy of the target table. Implement every row on all three platforms.

| Event / state | Pico badge (8×8) | Zero LCD | Emoji-app (Lucide) |
| --- | --- | --- | --- |
| Lobby — not yet joined | Solid yellow 4×4 centre square | Solid yellow 4×4 centre square | `DoorOpen` |
| Lobby — joined, waiting | White 4×4 outline square (1 px border, black interior) | White 4×4 outline square | `HandPlatter` |
| Game started / active | Solid green 4×4 centre square | Solid green 4×4 centre square | `Turntable` |
| Question open | `?` glyph; NFC polling active | `?` glyph | `MessageCircleQuestion` |
| Card scanned (tap ack) | Green 4×4 outline square briefly | *(then immediate correct/wrong)* | *(then blue circle / red x)* |
| Correct answer | Blue filled circle | Blue filled circle | `Circle` (blue) |
| Wrong answer | Red X | Red X | `X` (red) |
| Question closed | Small white 2×2 centre dot | Small white 2×2 centre dot | `BookAlert` |
| Game ended (generic) | Scrolls `DONE`, then dark | Text: `GAME OVER` (red) — or keep until winner/loser | `Sparkles` |
| Game winner | Fireworks (animations menu — positive 1) | Fireworks (same animation) | `Podium` |
| Game loser | Rain (animations menu) | Rain (same animation) | `EyeClosed` |

### Gap analysis (current → target)

| State | Pico today | Zero today | React today |
| --- | --- | --- | --- |
| Lobby not joined | *(no lobby command)* | Text `JOIN? KEY2` + `G` glyph | Text `lobby` only |
| Lobby joined | *(none)* | Text `WAITING...` + `G` glyph | Join time text |
| Active | ✅ green 4×4 fill | Text `GAME ON` + `G` glyph | Text `active` |
| Question open | ✅ `?` | Text `SCAN NOW` + `G` glyph | *(none / game state)* |
| Card tap ack | Green **circle** outline 5 s | Uses NFC map display | Slot label text |
| Correct / wrong | *(not in game path)* | NFC path has circle/X; game path does not send `GAME:correct/wrong` | No result chip |
| Question closed | ✅ white 2×2 | Text `GAME ON` (not white dot glyph) | *(none)* |
| Game ended | ✅ `DONE` scroll | Text `GAME OVER` | Text `completed` |
| Winner / loser | *(none)* | Fireworks/rain exist in menu, not wired to game end | *(none)* |

---

## Design decisions (locked for this step)

### D1 — Visuals follow Platform icon table

- Zero game mode stops using text-only status for states that have a matrix
  glyph in the table (lobby squares, `?`, blue circle, red X, white dot).
  Text may remain as a thin overlay where useful (e.g. `GAME OVER`), but the
  **main** full-screen content must match Pico.
- Pico tap acknowledgment becomes a **green 4×4 outline square** (not the
  current green circle), then correct/wrong replaces it.

### D2 — Correct/wrong timing: immediate on scan

Per multiplayer-mode "Card scan → immediate correct/wrong flow":

```text
Pico tap ack → TAG → Zero POST /api/guesses → response includes isCorrect
  → Zero LCD blue circle / red X
  → Zero BLE GAME:correct / GAME:wrong
  → Pico blue filled circle / red X
  → emoji-app nfc.tagged (+ isCorrect) → blue Circle / red X
```

`question.result` on close still runs for the **dashboard leaderboard** and
for pairs that never scanned (show "no guess"). Devices that already showed
correct/wrong on scan should not flash a second contradictory animation on
`question.result` unless the server outcome differs (should not happen).

### D3 — Winner/loser reuse existing animations

No new pixel art. Pico and Zero call the existing fireworks / rain routines
already used from the animations menu.

### D4 — Lucide names

Use Lucide React exports (kebab names in the table map as follows):

| Table name | Import |
| --- | --- |
| `door-open` | `DoorOpen` |
| `hand-platter` | `HandPlatter` |
| `turntable` | `Turntable` |
| `message-circle-question-mark` | `MessageCircleQuestion` |
| `circle` / `x` | `Circle` / `X` |
| `book-alert` | `BookAlert` |
| `sparkles` | `Sparkles` |
| `podium` | `Podium` |
| `eye-closed` | `EyeClosed` |

If a package version lacks an icon (e.g. `Turntable`), bump `lucide-react`
or temporarily substitute the nearest icon and note it in the PR.

---

## 8a — Server: guess response + question results + scores

### 8a-i — Return `isCorrect` from `POST /api/guesses`

`submitGuess` already resolves an `AnswerOption`. Extend the return value
and HTTP 201 body:

```json
{
  "guessId": "…",
  "answerOptionId": "…",
  "slotLabel": "B",
  "isCorrect": true
}
```

Also include `isCorrect` on the dashboard `nfc.tagged` WS payload so
`BadgesView` can show blue/red without a second fetch.

### 8a-ii — `computeQuestionResult` + `question.result`

When `setQuestionState` transitions a question to `"closed"`:

1. Load correct `AnswerOption.slotLabel` for the question.
2. Load all `Guess` docs for `(gameId, questionId)`.
3. Load bound `pairName`s for the game.
4. Build `results[]` — one entry per bound pair
   (`slotLabel: null` if no guess).
5. Emit `question.result` to dashboards **and** bound pair rooms.

```json
{
  "type": "question.result",
  "gameId": "…",
  "questionId": "…",
  "correctSlotLabel": "B",
  "results": [
    { "pairName": "green", "slotLabel": "B", "isCorrect": true },
    { "pairName": "white", "slotLabel": "A", "isCorrect": false },
    { "pairName": "red", "slotLabel": null, "isCorrect": false }
  ],
  "serverTime": "…"
}
```

### 8a-iii — `GET /api/games/:gameId/scores`

Cumulative correct counts per `pairName` for the current game:

```json
{
  "gameId": "…",
  "scores": [
    { "pairName": "green", "correct": 3, "total": 4 },
    { "pairName": "white", "correct": 1, "total": 4 }
  ]
}
```

**Restart note (from 6d):** guesses are retained across Play Again. For the
demo, either:

- Scope scores to guesses with `createdAt >= game.startedAt`, or
- Accept inflated totals after restart until a later cleanup endpoint exists.

Prefer scoping to `startedAt` when present.

### 8a-iv — Enrich controller `game.ended`

When the game transitions to `completed`, send each bound pair a targeted
event (in addition to dashboard `game.state.changed`):

```json
{
  "type": "game.ended",
  "gameId": "…",
  "pairName": "green",
  "isWinner": true,
  "rank": 1,
  "score": 3,
  "serverTime": "…"
}
```

Winner = rank 1 by correct count (ties: all rank-1 pairs get `isWinner: true`
for the demo, or break ties by earliest last-correct guess — pick one and
document in the PR).

---

## 8b — Zero: displays + event handlers

### 8b-i — Game-mode matrix glyphs (replace text-primary states)

Introduce shared 8×8 matrices (or draw helpers) used as the **main**
fullscreen emoji in game mode:

| State | Matrix |
| --- | --- |
| Lobby not joined | Yellow 4×4 fill |
| Lobby joined | White 4×4 outline |
| Active (no open Q) | Green 4×4 fill |
| Question open | `?` glyph (same art as Pico) |
| Question closed / between Qs | White 2×2 centre dot |
| Correct | Blue filled circle (`others_circle` / NFC circle) |
| Wrong | Red X |

`_game_status_label()` text becomes optional / secondary. Prefer matching
Pico so a glance at either device reads the same.

BLE sync mapping (extend `_apply_game_state_to_display` / event handlers):

| Condition | BLE to Pico |
| --- | --- |
| Lobby, not joined | `GAME:lobby` *(new)* |
| Lobby, joined | `GAME:lobby_joined` *(new)* |
| Active, no open Q | `GAME:active` |
| Question open | `GAME:question_open` |
| Question closed | `GAME:question_close` |
| Completed (before winner/loser) | `GAME:ended` |

### 8b-ii — Immediate correct/wrong after guess POST

In the TAG → `/api/guesses` path:

```python
# After successful POST:
is_correct = response_json.get("isCorrect")
if is_correct:
    # show blue circle on Zero LCD
    await _ble_write_game_cmd("GAME:correct")
else:
    # show red X on Zero LCD
    await _ble_write_game_cmd("GAME:wrong")
```

Hold the result display until `question.closed` (or a short timeout, then
stay on result until close — prefer stay until close so players can see
their answer).

### 8b-iii — `question.result` handler

```python
elif etype == "question.result":
    pair_result = next(
        (r for r in event.get("results", []) if r.get("pairName") == PAIR_NAME),
        None,
    )
    # If this pair already showed correct/wrong on scan, skip re-animate.
    # If no guess (slotLabel is None), optionally show wrong / dim state.
    ...
```

### 8b-iv — Enriched `game.ended`

```python
elif etype == "game.ended":
    _ws_game_state = "completed"
    _ws_question_id = None
    if game_mode_active:
        draw_display()
    if event.get("isWinner"):
        await _ble_write_game_cmd("GAME:winner")
        # start fireworks on Zero LCD (existing animation helper)
    else:
        await _ble_write_game_cmd("GAME:loser")
        # start rain on Zero LCD
```

Bump Zero `VERSION` when shipping (minor).

---

## 8c — Pico: new `GAME:*` commands + lobby states

Extend `_handle_game_command` / display helpers.

| Command | Display | Duration |
| --- | --- | --- |
| `GAME:lobby` | Solid yellow 4×4 centre | Until next command |
| `GAME:lobby_joined` | White 4×4 outline | Until next command |
| `GAME:active` | Green 4×4 fill *(existing)* | Until next |
| `GAME:question_open` | `?` *(existing)*; NFC on | Until next / scan |
| *(tap ack, local)* | Green 4×4 outline | Brief, then wait for correct/wrong |
| `GAME:correct` | Blue filled circle | Until `question_close` / next |
| `GAME:wrong` | Red X | Until `question_close` / next |
| `GAME:question_close` | White 2×2 *(existing)* | Until next |
| `GAME:ended` | `DONE` scroll then dark *(existing)* | One-shot |
| `GAME:winner` | `matrix.fireworks()` (or equivalent) | Until next / idle |
| `GAME:loser` | `matrix.rain()` | Until next / idle |

Change tap acknowledgment from green circle to green 4×4 outline to match
the Platform icon table.

Bump Pico `VERSION` when shipping (minor).

---

## 8d — React: icons, result chips, leaderboard

### 8d-i — Shared game-state → Lucide map

Add a small helper (e.g. `game-state-icon.ts`) used by `BadgesView` (and
optionally `GameDetailView`):

```ts
type GameVisualState =
  | 'lobby'
  | 'lobby_joined'
  | 'active'
  | 'question_open'
  | 'correct'
  | 'wrong'
  | 'question_closed'
  | 'completed'
  | 'winner'
  | 'loser';

const GAME_STATE_ICONS: Record<GameVisualState, LucideIcon> = {
  lobby: DoorOpen,
  lobby_joined: HandPlatter,
  active: Turntable,
  question_open: MessageCircleQuestion,
  correct: Circle,          // className: text-blue-500
  wrong: X,                 // className: text-red-500
  question_closed: BookAlert,
  completed: Sparkles,
  winner: Podium,
  loser: EyeClosed,
};
```

Derive per-badge visual state from WS events:

- `game.state.changed` + join map → lobby / lobby_joined / active / completed
- open question tracking (from referee flow or a new/lightweight
  `question.opened` on dashboard) → `question_open`
- `nfc.tagged` + `isCorrect` → `correct` / `wrong`
- `question.result` → result chip; clear on next `question.opened`
- `game.ended` enrichment is pair-targeted; dashboard can compute winner
  from scores for icon purposes

### 8d-ii — `BadgesView` result chip

Extend `WsEnvelope` with `question.result` and `isCorrect` on `nfc.tagged`.

Per badge card:

- Green/blue `✓ B` or blue `Circle` when correct
- Red `✗ A` or red `X` when wrong
- Grey `—` when `question.result` says no guess

### 8d-iii — `GameDetailView` live leaderboard

Fetch `GET /api/games/:id/scores` on mount; refresh on `question.result`:

```text
┌─ Scores ──────────────────────┐
│ 1. green   3 / 4 correct  ★   │
│ 2. white   1 / 4 correct       │
│ 3. red     0 / 4 correct       │
└────────────────────────────────┘
```

Place below questions or as a third column on wide layouts.

---

## 8e — Docs sync

When implementation lands:

1. Mark Step 8 ✅ in `next-steps.md` and `game-realtime-design.md`.
2. Update `multiplayer-mode.md` Pico/Zero command tables so Step 8 rows are
   no longer "planned" (and remove superseded YES/WIN scroll wording if any
   remains outside the Platform icon section).
3. Resolve open question in `game-realtime-design.md` ("Pico display
   semantics") by pointing at the Platform icon table.

---

## Implementation order

| Order | Work | Layer | Est. |
| --- | --- | --- | --- |
| 1 | Lobby + correct/wrong + winner/loser matrix routines; tap ack = green outline | Pico | ~2 h |
| 2 | Game-mode glyphs + `GAME:lobby*` sync; immediate correct/wrong from guess POST; winner/loser animations | Zero | ~2 h |
| 3 | `isCorrect` on guess response + `nfc.tagged`; `computeQuestionResult`; `question.result`; scores endpoint; enriched `game.ended` | Server | ~2–3 h |
| 4 | Lucide state icons; result chips; leaderboard; WsEnvelope | React | ~2 h |
| 5 | Hardware walkthrough against acceptance criteria | All | ~1 h |

Pico/Zero display work can start before the server emits `question.result`,
because immediate feedback only needs the guess POST body.

---

## Acceptance criteria

### Visual parity (Platform icon table)

- [ ] Lobby not joined: Pico + Zero show yellow 4×4; BadgesView shows `DoorOpen`.
- [ ] Lobby joined: Pico + Zero show white 4×4 outline; BadgesView shows `HandPlatter`.
- [ ] Active: Pico + Zero green 4×4; BadgesView shows `Turntable`.
- [ ] Question open: Pico + Zero `?`; BadgesView shows `MessageCircleQuestion`.
- [ ] Card tap: Pico green 4×4 outline, then blue circle or red X within ~1 s of
      a successful guess POST.
- [ ] Zero LCD shows blue circle / red X for the same outcome.
- [ ] BadgesView shows blue `Circle` / red `X` (or equivalent chip) from
      `nfc.tagged` + `isCorrect`.
- [ ] Question closed: Pico + Zero white 2×2; BadgesView shows `BookAlert`.
- [ ] Game winner: Pico + Zero fireworks; BadgesView shows `Podium`.
- [ ] Game loser: Pico + Zero rain; BadgesView shows `EyeClosed`.

### Scoring / events

- [ ] `POST /api/guesses` 201 body includes `isCorrect`.
- [ ] Closing a question emits `question.result` to dashboards and bound pairs.
- [ ] `GET /api/games/:id/scores` returns per-pair correct/total (scoped sensibly
      after Play Again).
- [ ] `GameDetailView` leaderboard updates after each `question.result`.
- [ ] On game complete, each Zero receives `game.ended` with `isWinner` / `rank`
      / `score` and drives `GAME:winner` or `GAME:loser`.

### Regression

- [ ] Existing Step 4–7 flows still work (open/close question, TAG → guess,
      slotLabel fallback, referee panel).
- [ ] MongoDB card-group path in `submitGuess` still preferred when assigned.

---

## Open questions (resolve while implementing)

1. **Tie for first place** — all tied pairs get fireworks, or a single winner
   by earliest correct guess?
2. **Hold duration for correct/wrong** — until question close (preferred) vs
   fixed ~4 s then revert to `?` while question still open?
3. **Dashboard `question.opened`** — does BadgesView already learn open
   questions, or should the server broadcast `question.opened` /
   `question.closed` to dashboards (today they may only go to pair rooms)?
4. **Generic `GAME:ended` vs winner/loser** — skip `DONE` scroll when
   enriched end event will immediately start fireworks/rain?

---

## Out of scope (later steps)

- Step 9 — NFC card group management UI
- Step 10 — Multi-badge Mode 2
- Deleting guesses on Play Again (optional later endpoint)
