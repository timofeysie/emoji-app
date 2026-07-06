# Game modes — controller and badge topologies

This document describes the two supported topologies for pairing a Pi Zero
controller with one or more Pico badge devices. Both topologies share the same
server data model; the differences are in BLE connection management on the Zero
and in how the dashboard groups and labels badge activity.

---

## Mode 1 — Standard pair (one controller, one badge) ✅ current

### Overview

One Raspberry Pi Zero controller is permanently paired to exactly one Pico
badge. This is the baseline topology for the current demo.

```
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

### Identity

| Field | Holds | Example |
| --- | --- | --- |
| `pairName` | Controller / station name (shared config) | `"green"` |
| `controllerId` | Zero's logical id (set in `emoji-os-zero.py`) | `"zero-living-room"` |
| `badgeId` | Pico's MAC-derived address (unique per chip) | `"badge-88-a2-9e-4c-8c-7f"` |

`pairName` is the human-facing label on the dashboard. `badgeId` is the
physical device identifier — it is already unique even in this 1:1 mode and
is carried on every server event.

### Configuration

Both devices share the same `pair_config.py`:

```python
PAIR_NAME = "green"
```

The Zero scans for a BLE peripheral advertising as `Pico-Client-green`. The
Pico only accepts the connection when the Zero sends `PAIR:green` and replies
`PAIR_OK:<VERSION>`.

### BLE connection lifecycle

```
Zero boots → scans for "Pico-Client-green" → connects → sends "PAIR:green"
Pico replies "PAIR_OK:0.3.2" → Zero marks connected → heartbeat loop starts
```

One `BleakClient` instance. If the connection drops the Zero reconnects with
backoff.

### Server state

- `POST /api/status` — Zero posts `pairName`, `controllerVersion`, `picoVersion`,
  `batteryLevel`, `badgeId`, `bleStatus`.
- One badge card appears on the dashboard, labelled by `pairName`.
- `submitGuess` carries `pairName` + `badgeId` (single badge, so `badgeId`
  is unambiguous).

### Current limitations

- One badge per station. If the physical Pico is swapped, the `badgeId` changes
  but `pairName` stays stable.
- The Zero cannot relay NFC events from more than one badge simultaneously.

---

## Mode 2 — Multi-badge pair (one controller, N badges) 🔮 planned

### Overview

One Pi Zero controller maintains simultaneous BLE connections to **N Pico
badges**, all sharing the same `PAIR_NAME`. This enables team-buzzer scenarios,
audience-participation sets, or classroom kits where one station manages a rack
of physical devices.

```
┌─────────────────────────┐  BLE  ┌──────────────────────────────┐
│  Pi Zero controller     │ ◀────▶ │  Pico badge 1 (badge-aa…)   │
│  PAIR_NAME = "green"    │  BLE  ├──────────────────────────────┤
│                         │ ◀────▶ │  Pico badge 2 (badge-bb…)   │
│                         │  BLE  ├──────────────────────────────┤
│                         │ ◀────▶ │  Pico badge 3 (badge-cc…)   │
└─────────────────────────┘       └──────────────────────────────┘
          │
          │ REST + WebSocket
          ▼
    emoji-app server
```

### Identity

`pairName` still identifies the **controller** (the Zero). Individual badges
are distinguished by `badgeId` — the Pico's Bluetooth MAC address, unique per
chip even when all Picos share the same `PAIR_NAME`.

| Field | Holds | Example |
| --- | --- | --- |
| `pairName` | Controller name (shared by all badges) | `"green"` |
| `badgeId` | Per-chip unique identifier | `"badge-aa-bb…"`, `"badge-cc-dd…"` |
| `controllerId` | Zero's logical id | `"zero-1"` |

No per-badge config file is needed — all Picos can use the identical
`pair_config.py`. This keeps provisioning simple for large sets.

### Configuration

All Picos share the same `pair_config.py`:

```python
PAIR_NAME = "green"
```

Each Pico advertises as `Pico-Client-green`. The Zero's scan loop is extended
to connect to **all** matching peripherals rather than the first one found.

### BLE connection lifecycle (planned)

```
Zero boots → scans for ALL devices named "Pico-Client-green"
           → opens one BleakClient per device
           → runs PAIR handshake on each in parallel
           → starts one heartbeat task per client
           → on NFC notify from badge-N, relays TAG event with badgeId = badge-N
```

Bleak on Linux supports multiple simultaneous BLE central connections. Each
Pico is a BLE peripheral that accepts one central at a time — so N Picos each
accept the Zero as their sole central.

### Server-side changes needed

The server data model requires **no breaking changes**. The following additions
are needed:

#### `pairBindings` — unchanged

`pairName → gameId` continues to bind the controller to a game. This does not
need to know how many badges are attached.

#### `badgeRegistrations` — new (optional)

If per-badge join/ready state is required, a new lightweight collection maps
each physical badge to its controller:

```text
badgeRegistrations
  badgeId     string   (unique Pico chip id, e.g. "badge-aa-bb…")
  pairName    string   (controller this badge belongs to)
  joinedAt    Date
  lastSeenAt  Date
```

This is **not required** for the first multi-badge milestone. The dashboard
can infer per-badge activity from `nfc.tagged` events that carry `badgeId`.

#### `submitGuess` — `badgeId` added

```json
{ "gameId": "…", "questionId": "…", "pairName": "green", "badgeId": "badge-aa-bb…", "cardUid": "…" }
```

`badgeId` is required in multi-badge mode so the server and dashboard know
which physical badge scanned which card. In Mode 1 the Zero already knows its
single badge's `badgeId` and includes it automatically — no change to the
1:1 flow.

#### `nfc.tagged` dashboard event — `badgeId` added

```json
{ "type": "nfc.tagged", "pairName": "green", "badgeId": "badge-aa-bb…", "cardUid": "…", "slotLabel": "B", "serverTime": "…" }
```

### Dashboard changes needed

- Badge cards are already keyed by `controllerId::badgeId`, so N badges from
  the same controller already appear as N separate cards, each labelled with
  `pairName` as the primary label and `badgeId` as secondary.
- A grouping view ("all cards under pairName `green`") would be useful but is
  not required for the first milestone.
- NFC tag activity on the game view can show per-badge activity via `badgeId`.

### Zero code changes needed

The main work is in `emoji-os-zero.py`:

- **Multi-device scan loop** — `scan_for_device` currently returns the first
  match; extend to return a list of all matching devices.
- **Multiple `BleakClient` instances** — `BLEController` currently manages one
  client; refactor to manage a `dict[str, BleakClient]` keyed by device address.
- **Per-badge notification handler** — `_on_pico_tx_notify` must carry the
  source `badgeId` so NFC tag events are attributed correctly.
- **Parallel heartbeats** — one `_heartbeat_loop` task per connected badge.

### Pico code changes needed

None. Each Pico continues to behave identically: it advertises, accepts one
connection, handles PAIR/GAME/MENU commands, and notifies TAG events. The
multi-badge coordination happens entirely on the Zero.

### Use cases

| Use case | Badges per controller | Notes |
| --- | --- | --- |
| Individual player station | 1 | Mode 1 — current |
| Team buzzer (e.g. 4 per team) | 2–6 | Mode 2 — planned |
| Audience participation (large set) | 10+ | Mode 2, hardware-limited by Zero BLE stack |
| Classroom kit | N | Mode 2 — one Zero manages a tray of badges |

---

## Game flow — Zero controller and React app

This section describes the end-to-end operational flow for a single game
session, combining the physical Zero/Pico station with the React web app.

### Button map (Zero display HAT)

The Waveshare 1.44" display HAT has a 5-way joystick and three side buttons.

| Control | Action |
| --- | --- |
| **KEY2** | In `none` state → enter `start`; in `start` state → cycle menu (0→1→2→3→0); in `choosing` → confirm selection + animate; in game mode when `JOIN? KEY2` shown → POST join |
| **Joystick CENTER** | In `start` state → enter `choosing` with pos=1; in `choosing` → redraw |
| **Joystick UP** | In `choosing` → move pos up (cycles 1→2→3→4→1) |
| **Joystick DOWN** | In `choosing` → move pos down |
| **Joystick LEFT/RIGHT** | Navigate within choosing mode |
| **KEY1** | Positive emoji selection (or toggle/replay last positive) |
| **KEY3** | Negative emoji selection (or toggle/replay last negative) |

### Navigating to game mode

The game mode slot is at **menu 3 (Others), pos 4**.

```
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

### Zero display states in game mode

Once `game_mode_active` is True, the center of the display always shows the
large 'G' glyph. The status text (y=57) changes with the WebSocket game state:

| Zero shows | Meaning | What to do |
| --- | --- | --- |
| *(large 'G', no text)* | WS not connected, or pair not bound to any game | Check server connection; bind pair via API / Step 6 UI |
| `JOIN? KEY2` | Pair is bound to a game in `lobby` state, not yet joined | Press **KEY2** to join |
| `WAITING...` | Joined; waiting for referee to start the game | Wait |
| `GAME ON` | Game is `active`, no question currently open | Wait for referee to open a question |
| `SCAN NOW` | A question is open — NFC tag scan is ready | Player scans NFC card on Pico |
| `GAME OVER` | Game is `completed` | Session finished |

### Pico badge display states

The Pico receives `GAME:*` BLE commands from the Zero and shows:

| BLE command received | Pico display |
| --- | --- |
| `GAME:active` | Solid green 4×4 square in centre of matrix |
| `GAME:question_open` | White '?' glyph (NFC ready — scan now) |
| `GAME:question_close` | Small white 2×2 dot (between questions) |
| `GAME:ended` | Scrolling "DONE" text, then matrix goes dark |

### App (React) referee actions

The referee drives the game lifecycle from the React app. After Step 6, all of
these are available via the `GameDetailView` referee panel. Until Step 6 is
built, use direct API calls.

| Referee action | API call | Zero reacts | Pico reacts |
| --- | --- | --- | --- |
| Bind controller to game | `POST /api/games/:id/pairs { pairName }` | Next WS connect: receives `controller.welcome` with game snapshot | — |
| Open for joining (lobby) | `POST /api/games/:id/state { state: "lobby" }` | Shows "JOIN? KEY2" | — |
| Player presses KEY2 | Zero posts `POST /api/games/:id/join` | Shows "WAITING..." | — |
| Start game | `POST /api/games/:id/state { state: "active" }` | Shows "GAME ON" | Green square |
| Open question | `POST /api/questions/:qid/state { gameId, state: "open" }` | Shows "SCAN NOW" | '?' glyph |
| Player scans NFC card | Pico notifies `TAG:<uid>` → Zero posts `POST /api/guesses` | Shows "SCAN NOW" until closed | — |
| Close question | `POST /api/questions/:qid/state { gameId, state: "closed" }` | Shows "GAME ON" | White dot |
| End game | `POST /api/games/:id/state { state: "completed" }` | Shows "GAME OVER" | Scrolls "DONE" |

### End-to-end sequence diagram

```
Referee (app)              Server             Zero               Pico
     │                       │                 │                  │
     ├─ POST /games           │                 │                  │
     │  (create game)         │                 │                  │
     │                        │                 │                  │
     ├─ POST /games/:id/pairs ─►               │                  │
     │  { pairName }          │                 │                  │
     │                        │                 │                  │
     ├─ POST /games/:id/state ─►               │                  │
     │  { state: lobby }      ├── WS game.opened ──►              │
     │                        │                 │ "JOIN? KEY2"     │
     │                        │                 │                  │
     │         (user presses KEY2 on Zero)       │                  │
     │                        ◄── POST /games/:id/join ──          │
     │                        ├── WS controller.joined ─► BadgesView
     │                        │                 │ "WAITING..."     │
     │                        │                 │                  │
     ├─ POST /games/:id/state ─►               │                  │
     │  { state: active }     ├── WS game.started ──►             │
     │                        │                 │ "GAME ON"       │
     │                        │                 ├── BLE GAME:active ──►
     │                        │                 │                  │ ■ green
     │                        │                 │                  │   square
     ├─ POST /questions/:q/state►              │                  │
     │  { state: open }       ├── WS question.opened ──►          │
     │                        │                 │ "SCAN NOW"      │
     │                        │                 ├── BLE GAME:question_open►
     │                        │                 │                  │ ? glyph
     │                        │                 │                  │
     │      (player scans NFC card on Pico)      │                  │
     │                        │                 ◄── BLE TAG:uid ───
     │                        ◄── POST /guesses ──                 │
     │                        ├── WS nfc.tagged ──► BadgesView     │
     │                        │                 │                  │
     ├─ POST /questions/:q/state►              │                  │
     │  { state: closed }     ├── WS question.closed ──►          │
     │                        │                 │ "GAME ON"       │
     │                        │                 ├── BLE GAME:question_close►
     │                        │                 │                  │ · dot
     ├─ POST /games/:id/state ─►               │                  │
     │  { state: completed }  ├── WS game.ended ──►               │
     │                        │                 │ "GAME OVER"     │
     │                        │                 ├── BLE GAME:ended ──►
     │                        │                 │                  │ DONE scroll
```

### Current limitations (pre-Step 6)

- Pair binding and game state transitions require direct API calls (curl or
  browser devtools). Step 6 adds referee buttons in `GameDetailView`.
- `BadgesView` does not yet show live game state or NFC tag events. Step 6
  extends it to consume `game.state.changed`, `controller.joined`, and
  `nfc.tagged` WebSocket events.
- Only one question can be meaningfully open at a time; the server does not
  enforce this — the referee must close one question before opening another.

---

## Comparison summary

| Aspect | Mode 1 (current) | Mode 2 (planned) |
| --- | --- | --- |
| Badges per controller | 1 | N |
| `pairName` meaning | Controller + badge station | Controller station only |
| Individual badge id | `badgeId` (present but redundant) | `badgeId` (essential) |
| Config per badge | Same `pair_config.py` | Same `pair_config.py` |
| Zero BLE clients | 1 | N |
| Server model changes | None | `badgeId` in guess/tag events; optional `badgeRegistrations` |
| Dashboard changes | None | Per-badge NFC activity; optional grouping view |
| Pico code changes | None | None |
