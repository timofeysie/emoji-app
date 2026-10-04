# Game modes — controller and badge topologies

This document describes the two supported topologies for pairing a Pi Zero
controller with one or more Pico badge devices. Both topologies share the same
server data model; the differences are in BLE connection management on the Zero
and in how the dashboard groups and labels badge activity.

---

## Mode 1 — Standard pair (one controller, one badge) ✅ current

### Standard pair overview

One Raspberry Pi Zero controller is permanently paired to exactly one Pico
badge. This is the baseline topology for the current demo.

```text
┌─────────────────────────┐      BLE      ┌────────────────────────┐
│  Pi Zero controller     │ ◀────────────▶ │  Pico badge            │
│  PAIR_NAME = "green"    │               │  PAIR_NAME = "green"   │
│  controllerId = "zero-1"│               │  badgeId = "badge-aa…" │
└─────────────────────────┘               └────────────────────────┘
          │
          │ REST + WebSocket
          ▼
    emoji-app server
```

### Standard pair identity

| Field | Holds | Example |
| --- | --- | --- |
| `pairName` | Controller / station name (shared config) | `"green"` |
| `controllerId` | Zero's logical id (set in `emoji-os-zero.py`) | `"zero-living-room"` |
| `badgeId` | Pico's MAC-derived address (unique per chip) | `"badge-88-a2-9e-4c-8c-7f"` |

`pairName` is the human-facing label on the dashboard. `badgeId` is the
physical device identifier — it is already unique even in this 1:1 mode and
is carried on every server event.

### Standard pair configuration

Both devices share the same `pair_config.py`:

```python
PAIR_NAME = "green"
```

The Zero scans for a BLE peripheral advertising as `Pico-Client-green`. The
Pico only accepts the connection when the Zero sends `PAIR:green` and replies
`PAIR_OK:<VERSION>`.

### BLE connection lifecycle

```text
Zero boots → scans for "Pico-Client-green" → connects → sends "PAIR:green"
Pico replies "PAIR_OK:0.3.2" → Zero marks connected → heartbeat loop starts
```

One `BleakClient` instance. If the connection drops the Zero reconnects with
backoff.

### Server state

- `POST /api/status` — Zero posts `pairName`, `controllerVersion`, `picoVersion`,
  `batteryLevel`, `badgeId`, `bleStatus`.
- One station card appears on the dashboard, labelled by `pairName`, with a
  single badge slot.
- `submitGuess` carries `pairName` (and `badgeName`, which equals `pairName`
  in Mode 1).

### Current limitations

- One badge per station. If the physical Pico is swapped, the `badgeId` changes
  but `pairName` stays stable.
- For more than one badge on a station, use Mode 2 below. Mode 1 is the same
  code path with a one-name roster.

---

## Mode 2 — Multi-badge station (one controller, N named badges) ✅ implemented

Implementation plan and as-built notes:
[`multi-badge-plan.md`](./multi-badge-plan.md). Hardware verification is
tracked in that plan's Milestone 7 and Milestone 8 checklists.

### Multi-badge station overview

One Pi Zero controller keeps simultaneous BLE links to **several Pico badges**.
Each Pico has its **own** `PAIR_NAME`; the Zero connects only to the names in
its `BADGE_NAMES` roster. **Each badge is a separate player**, keyed by its
`badgeName`: each has its own binding, join, guess per question, score row,
and winner / loser outcome. This is not a team mode.

Badges can be buttonless. The Zero is the only input device: emoji choices,
join, and readiness all come from the Zero. The referee binds the station
once and one `KEY1` join covers every connected badge, but the server records
each badge as its own player.

```text
┌──────────────────────────────┐  BLE  ┌──────────────────────────────┐
│  Pi Zero controller          │ ◀────▶ │  Pico PAIR_NAME = "green"    │
│  PAIR_NAME   = "green"       │  BLE  ├──────────────────────────────┤
│  BADGE_NAMES = ["green",     │ ◀────▶ │  Pico PAIR_NAME = "green-2"  │
│    "green-2", "green-3"]     │  BLE  ├──────────────────────────────┤
│                              │ ◀────▶ │  Pico PAIR_NAME = "green-3"  │
└──────────────────────────────┘       └──────────────────────────────┘
          │
          │ REST + WebSocket (pairName = "green")
          ▼
    emoji-app server
```

### Multi-badge station identity

| Field | Holds | Example |
| --- | --- | --- |
| `pairName` / `stationName` | Controller / station id. WS room, referee bind target, roster owner. Not a player | `"green"` |
| `badgeNames` | Ordered roster from the Zero's `BADGE_NAMES` (dashboard slot order) | `["green", "green-2", "green-3"]` |
| `badgeName` | One roster slot; equals that Pico's `PAIR_NAME`. The player key: binding, join, readiness, guess, score | `"green-2"` |
| `badgeId` | Pico MAC-derived id. Diagnostics only | `"badge-aa-bb…"` |
| `controllerId` | Zero's logical id | `"zero-1"` |

`badgeName` is the stable badge identity. `badgeId` changes if a Pico is
swapped, so nothing is keyed on it. In Mode 1 the only badge's name equals
`PAIR_NAME`, so the station and the player share one name. Badge names must
be unique across all stations; binding a station whose roster name belongs
to another live station returns `409`.

### Multi-badge station configuration

Only the Zero file has a roster:

```python
# Zero pair_config.py
PAIR_NAME = "green"
BADGE_NAMES = ["green", "green-2", "green-3"]
```

Each Pico gets its own name, which must appear in that roster:

```python
# Pico pair_config.py
PAIR_NAME = "green-2"
```

Omitting `BADGE_NAMES` (or leaving it empty) is Mode 1: the roster is
`[PAIR_NAME]`. Names are case-sensitive. Keep them short; the Pico truncates
long `Pico-Client-<PAIR_NAME>` advertising names.

### Multi-badge BLE connection lifecycle

```text
Zero boots → logs PAIR_NAME and BADGE_NAMES
           → posts status "scanning" for every roster name (empty slots appear)
           → one scan for every unmatched Pico-Client-<badgeName>
           → connects matches one at a time
           → sends PAIR:<badgeName> to each, waits for PAIR_OK:<version>
           → syncs a late badge to the current GAME:* state
           → rescans periodically to fill empty slots
```

- Scans are serialized (BlueZ rejects overlapping scans).
- A Pico whose name is not in the roster is never connected.
- A drop on one badge reconnects only that slot.
- Plan for 2–4 badges per Zero on the first hardware pass; a connect that
  fails past the BLE budget leaves that slot **not connected**.

### Multi-badge game flow

| Controller event | Badge result |
| --- | --- |
| Emoji selection on the Zero | `MENU:POS:NEG` written to every connected badge; one `POST /api/emoji` for the station |
| Referee binds the station `pairName` | Server creates one player binding per roster badge |
| `game.opened` | Every connected badge shows `GAME:lobby` |
| `KEY1` join (`POST /api/games/:id/join` with `badgeNames`) | Every connected badge joins as a player and shows `GAME:lobby_joined` |
| Badge connects while the station is joined | The Zero auto-joins that badge and sends it the current `GAME:*` command |
| Question open / closed, ready prompt | Every connected badge gets the matching `GAME:*` |
| `question.result` | Each badge shows its own correct / wrong |
| `game.ended` | Each badge shows its own winner / loser |

NFC: any connected badge can scan. The Zero posts the guess with the station
`pairName` and the scanning badge as `badgeName` (the player):

```json
{
  "gameId": "…",
  "questionId": "…",
  "pairName": "green",
  "badgeName": "green-2",
  "cardUid": "…",
  "slotLabel": "B"
}
```

The server keeps one guess per badge per question. A scan from a sibling
badge is that badge's own guess; a repeat scan from the same badge is
rejected. The question closes automatically once every joined player has
guessed, so an unpowered roster badge does not hold it open. `nfc.tagged`,
`question.result` rows, and scores carry `badgeName` (the player) and
`stationName`.

### Multi-badge server and dashboard

- `POST /api/status` carries `badgeName` and `badgeNames` (one post per slot).
- `GET /api/badges` returns a `stations[]` view: one station per `pairName`
  with one slot per roster name, including never-connected names.
- The Badges view renders a **station card** (controller version, battery,
  `n/m badges`, and a `Joined x/m · answered y/x` summary) with one slot per
  roster name. Each slot shows its own joined state, NFC chip
  (`NFC · B`), and result.
- The referee panel binds the station `pairName` once and shows
  `n/m badges` on the invite list. Bound players are grouped under their
  station, each with its own joined / ready chip.
- Player views, scores, the guess chart, and `question.result` have one row
  per badge, with a station subtitle when it differs from the badge name.

### Multi-badge Pico changes

None. Each Pico advertises `Pico-Client-<PAIR_NAME>`, accepts only
`PAIR:<PAIR_NAME>`, applies emoji and `GAME:*` writes, and notifies
`TAG:<uid>`. All coordination happens on the Zero.

### Use cases

| Use case | Badges per controller | Notes |
| --- | --- | --- |
| Individual player station | 1 | Mode 1 |
| Learning-sport station with buttonless badges | 2–4 | Mode 2 |
| Several players sharing one controller | 2–4 | Mode 2; one score per badge |
| Larger sets | 5+ | Limited by the Zero's concurrent BLE connections |

A team mode (several badges sharing one team score) is not implemented. It
may be added later as a separate mode.

---

## Game flow — Zero controller and React app

This section describes the end-to-end operational flow for a single game
session, combining the physical Zero/Pico station with the React web app.

### Button map (Zero display HAT)

The Waveshare 1.44" display HAT has a 5-way joystick and three side buttons.

| Control | Action |
| --- | --- |
| **KEY2** | In `none` state → enter `start`; in `start` state → cycle menu (0→1→2→3→0); in `choosing` → confirm selection + animate; in game/fullscreen mode → exit to menu select (does not join) |
| **Joystick CENTER** | In `start` state → enter `choosing` with pos=1; in `choosing` → redraw |
| **Joystick UP** | In `choosing` → move pos up (cycles 1→2→3→4→1) |
| **Joystick DOWN** | In `choosing` → move pos down |
| **Joystick LEFT/RIGHT** | Navigate within choosing mode |
| **KEY1** | Positive emoji selection; in the game lobby → join; between rounds → ready |
| **KEY3** | Negative emoji selection; in the game lobby → remain unjoined; between rounds → wait |

### Navigating to game mode

The game mode slot is at **menu 3 (Others), pos 4**.

```text
Power on
  → state = "none"

Press KEY2
  → state = "start", menu = 0 shown

Press KEY2 (three more times)
  → menu cycles: 0 → 1 → 2 → 3 ("Other" highlighted)

Press CENTER
  → state = "choosing", pos = 1 (Others menu, first item)

Press Joystick UP (three times)
  → pos = 4 (the 'G' game mode slot is now the main emoji)

Press KEY2
  → confirm selection → animation → apply_selection() runs
  → game_mode_active = True
  → state = "none", pos = 0, neg = 0
  → display redraws with game status text
```

### Three-platform game-state display reference

The Zero receives game events from the server and relays `GAME:*` commands to
the Pico. The React column covers the player view, referee view, and dashboard
badge where they differ.

| State | Pico badge (8×8 matrix) | Zero controller (LCD) | React app |
| --- | --- | --- | --- |
| Game mode standby (`mode`) | Capital white `G` | Capital white `G` | Referee lifecycle shows `ready`; dashboard badge uses the Gamepad icon |
| Lobby choice (`lobby`) | Yellow 4×4 centre; green 2×2 top-right; red 2×2 bottom-right | Same three shapes; `KEY1 JOIN  KEY3 NO` | Player view says the game is open for joining; referee pair chip says `waiting to join`; dashboard uses Door Open |
| Joined lobby (`lobby_joined`) | White 4×4 outline | White 4×4 outline | Referee pair chip says `ready to start`; dashboard uses Hand Platter |
| Game active (`active`) | Solid green 4×4 centre | Solid green 4×4 centre | Referee state is `active`; this state is brief because Start Game automatically opens round 1 |
| Question open (`question_open`) | Question mark; NFC polling active | Question mark | Player view reveals the round question and answer options; referee round is `open`; dashboard uses Message Circle Question |
| Card scanned (`card_scanned`) | Green 4×4 outline while the guess response is pending | Holds the question or result display | Referee and dashboard receive `nfc.tagged`; the round closes automatically after every bound pair guesses |
| Correct (`correct`) | Blue filled circle | Blue filled circle | Dashboard and result UI use a blue Circle |
| Wrong (`wrong`) | Red X | Red X | Dashboard and result UI use a red X |
| Between-round prompt (`ready_prompt`) | Green 2×2 top-right and red 2×2 bottom-right | White 2×2 centre; `KEY1 READY  KEY3 WAIT` | Player view says `Ready for round X?`; pair chips in player and referee views show `?` while awaiting a response |
| Ready for next round (`ready`) | Green 2×2 top-right | White 2×2 centre; `READY` | Pair chips show a green check and `ready` |
| Wait before next round (`wait`) | Red 2×2 bottom-right | White 2×2 centre; `WAIT` | Pair chips show a red X and `wait` |
| Next round waiting | Retains ready, wait, or prompt display | Retains ready, wait, or prompt display | Player view hides the question and says `Waiting for the referee to open the next round.` |
| All rounds complete (`rounds_complete`) | Solid yellow 4×4 centre without join/no corners | Solid yellow 4×4 centre; `ROUNDS COMPLETE` | Player view shows `Total rounds: X` and `Game complete`; referee can end the game |
| Paused (`paused`) | Retains the current game display | Retains the current game display | Player view shows `Paused`; referee lifecycle shows `paused` |
| Game ended (`game_ended`) | Scrolls `DONE`, then goes dark | `GAME OVER` when no ranked outcome is available | Player view says the game ended; dashboard uses Sparkles |
| Winner (`winner`) | Fireworks animation | Fireworks animation | Dashboard uses Trophy and displays the winning score |
| Loser (`loser`) | Rain animation | Rain animation | Dashboard uses Eye Closed and displays the score |

### App (React) referee actions

The referee drives the game lifecycle from the React app. After Step 6, all of
these are available via the `GameDetailView` referee panel. Until Step 6 is
built, use direct API calls.

| Referee action | API call | Zero reacts | Pico reacts |
| --- | --- | --- | --- |
| Bind controller to game | `POST /api/games/:id/pairs { pairName }` | Next WS connect: receives `controller.welcome` with game snapshot | — |
| Open for joining (lobby) | `POST /api/games/:id/state { state: "lobby" }` | Shows yellow centre with green/red choices | Shows the same three shapes |
| Player presses KEY1 | Zero posts `POST /api/games/:id/join` | Shows white outline | Shows white outline |
| Start game | `POST /api/games/:id/state { state: "active" }` | Green square, then question mark | Green square, then question mark; round 1 opens automatically |
| Open a later round | `POST /api/questions/:qid/state { gameId, state: "open" }` | Shows question mark | Shows question mark and arms NFC |
| Player scans NFC card | Pico notifies `TAG:<uid>` → Zero posts `POST /api/guesses` | Shows correct or wrong | Shows correct or wrong; server closes the round after all bound pairs guess |
| Round closes | Automatic after all guesses, or referee posts `state: "closed"` | Shows `KEY1 READY  KEY3 WAIT` | Shows green/red corner choices |
| Player presses KEY1 / KEY3 | Zero posts `POST /api/games/:id/readiness` | Shows `READY` / `WAIT` | Shows the selected green / red corner |
| End game | `POST /api/games/:id/state { state: "completed" }` | Shows winner, loser, or `GAME OVER` | Fireworks, rain, or scrolling `DONE` |

### End-to-end sequence diagram

```text
Referee (app)              Server             Zero               Pico
     │                       │                 │                  │
     ├─ POST /games/:id/pairs ─►               │                  │
     │  { pairName }          │                 │                  │
     │                        │                 │                  │
     ├─ POST /games/:id/state ─►               │                  │
     │  { state: lobby }      ├── WS game.opened ──►              │
     │                        │                 ├── GAME:lobby ───►│
     │                        │                 │ join/no choices  │ join/no choices
     │                        │                 │                  │
     │         (user presses KEY1 on Zero)       │                  │
     │                        ◄── POST /games/:id/join ──          │
     │◄── WS controller.joined ┤                 ├── lobby_joined ►│
     │                        │                 │                  │
     ├─ POST /games/:id/state ─►               │                  │
     │  { state: active }     ├── WS game.started ──►             │
     │                        ├── auto-open round 1                │
     │◄── WS question.opened ─┤                 ├── question_open ►│
     │ player reveals round 1 │                 │ ? glyph          │ ? glyph
     │                        │                 │                  │
     │      (player scans NFC card on Pico)      │                  │
     │                        │                 ◄── BLE TAG:uid ───
     │                        ◄── POST /guesses ──                 │
     │◄── WS nfc.tagged ──────┤                 │                  │
     │                        ├── all pairs guessed: close round   │
     │◄── WS question.closed ─┤                 ├── ready_prompt ─►│
     │ Ready for round 2?     │                 │ KEY1/KEY3        │ green/red
     │                        │                 │                  │
     │       (user presses KEY1 ready)            │                  │
     │                        ◄── POST /games/:id/readiness ────── │
     │◄── readiness.changed ──┤                 ├── GAME:ready ──►│
     │ pair chip: ready       │                 │                  │ green corner
     │                        │                 │                  │
     ├─ POST /questions/:q/state►              │                  │
     │  { state: open }       ├── WS question.opened ──►          │
     │ player reveals round 2 │                 ├── question_open ►│
     │                        │                 │                  │ ? glyph
     │                        │                 │                  │
     ├─ POST /games/:id/state ─►               │                  │
     │  { state: completed }  ├── WS game.ended ──►               │
     │                        │                 ├── winner/loser ─►│
     │ scores + outcome       │                 │ outcome animation│ outcome animation
```

### Current implementation notes

- Start Game automatically opens only the first round.
- Later questions stay hidden from the player view until the referee opens them.
- The server automatically closes a round after every joined player submits a
  guess.
- Ready and wait responses are persisted on `pairBindings` and broadcast to the
  player and referee views.
- Only one question can be open at a time.

---

## Comparison summary

| Aspect | Mode 1 | Mode 2 |
| --- | --- | --- |
| Badges per controller | 1 | Roster of N (2–4 tested target) |
| `pairName` meaning | Controller + badge station (one player) | Controller station (not a player) |
| Player key | `pairName` (equals the badge name) | `badgeName`, one player per badge |
| Individual badge id | Not needed | `badgeName` (roster slot); `badgeId` diagnostic |
| Zero config | `PAIR_NAME` only | `PAIR_NAME` + `BADGE_NAMES` |
| Pico config | Same `PAIR_NAME` as the Zero | Own `PAIR_NAME`, listed in `BADGE_NAMES` |
| Zero BLE clients | 1 | One per connected roster name |
| Referee bind / `KEY1` join | Once per `pairName` | Once per station; expands to every badge |
| Guess / score / outcome | One per `pairName` | One per badge |
| Guess payload | `pairName` | `pairName` + `badgeName` |
| Dashboard | One-slot station card | Station card with one slot per roster name |
| Pico code changes | None | None |
