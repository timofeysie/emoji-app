# Multi-badge plan — one controller, many named badges

Status: **planned**. This is the implementation plan for Step 10 in
[`next-steps.md`](./next-steps.md). It supersedes the short Mode 2 sketch in
that file and refines
[`game-modes.md`](./game-modes.md) Mode 2.

Related:

- [`game-realtime-design.md`](./game-realtime-design.md) — pair identity and
  Topology A / B notes
- [`game-modes.md`](./game-modes.md) — current 1:1 flow and original same-name
  Mode 2
- [`6-referee.md`](./6-referee.md) — `BadgesView` card and referee bind chips
- `rainbow-connection/python/emoji-os/pair_config.py` — device names
- `rainbow-connection/python/emoji-os/emoji-os-zero.py` — controller
- `rainbow-connection/python/emoji-os/emoji-os-pico.py` — badge

---

## Why this plan exists

Today a station is 1:1. The Zero and Pico share one `PAIR_NAME` from
`pair_config.py`. The Zero scans for `Pico-Client-<PAIR_NAME>`, sends
`PAIR:<PAIR_NAME>`, posts one `POST /api/status`, and the dashboard renders one
card keyed `controllerId::badgeId`. Game bind, join, guesses, and scores all
use that single `pairName`.

We need a learning-sport station where **one Zero commands several Picos**:

- Some badges have no buttons, so they cannot join or choose an emoji themselves.
- The controller must **auto-connect** to those badges and **auto-follow** them
  into the current game.
- When the controller chooses an emoji, **every connected badge** shows it.
- The React app must show the **controller plus one slot per configured badge
  name**, including badges that are not connected yet.

The original Mode 2 design had every Pico share the controller's `PAIR_NAME`.
That cannot show empty named slots, and it cannot tell two expected badges
apart until a MAC is known. This plan uses a **named roster** on the
controller instead.

---

## Milestone snapshot

| Milestone | Title | Layer | Status |
| --- | --- | --- | --- |
| 0 | Lock identity and `pair_config` shape | Config / docs | ✅ done |
| 1 | Zero multi-connect to named badges | Zero BLE | ✅ done |
| 2 | Fan-out emoji and `GAME:*` commands | Zero | ✅ done |
| 3 | Per-badge status posts + game follow | Zero → server | ✅ done |
| 4 | Server station + badge-slot model | NestJS | ✅ done |
| 5 | React station component | React | ✅ done |
| 6 | Game / referee surfaces + NFC attribution | Server + React | ✅ done |
| 7 | Docs, setup, hardware verification | Docs + devices | 🔲 planned |

Mode 1 (one controller, one badge) must keep working after every milestone.
If `BADGE_NAMES` is omitted or empty, the Zero treats the roster as
`[PAIR_NAME]`.

---

## Locked decisions

These are the design locks for implementation. Do not revisit them unless a
milestone proves them wrong on hardware.

### Station vs badge

| Field | Meaning | Example |
| --- | --- | --- |
| `PAIR_NAME` / `pairName` | Controller / station identity. Bind, join, readiness, guesses, and scores stay on this name. | `"white"` |
| `BADGE_NAMES` / `badgeNames` | Ordered roster of Pico `PAIR_NAME` values this Zero may connect to. | `["white", "white-2", "white-3"]` |
| `badgeName` | Stable slot id for one Pico. Equals that Pico's `PAIR_NAME`. | `"white-2"` |
| `badgeId` | Physical Pico id (MAC-derived). Diagnostic and NFC attribution only. | `"badge-28-cd-c1-…"` |
| `controllerId` | Zero logical id. Unchanged. | `"zero-1"` |

`pairName` is **not** renamed. A multi-badge station is still one player.

### Roster, not same-name flood

Each Pico keeps its own `pair_config.py` and advertises as
`Pico-Client-<its PAIR_NAME>`. The Zero only connects to names listed in
`BADGE_NAMES`.

```text
Zero PAIR_NAME="white"
  BADGE_NAMES=["white", "white-2", "white-3"]
        │
        ├── BLE Pico-Client-white     PAIR:white
        ├── BLE Pico-Client-white-2   PAIR:white-2
        └── BLE Pico-Client-white-3   PAIR:white-3
                │
                ▼
          emoji-app
          pairName=white  (one bind, one join, one score)
          slots: white / white-2 / white-3
```

This is closer to Topology B for **discovery** and Topology A for **game
identity**. It matches `badge-setup.md`: a badge name must appear in the
controller's config.

### Handshake is per badge name

The Pico still accepts only `PAIR:<its PAIR_NAME>`. The Zero must send
`PAIR:<badgeName>` for that slot, **not** always `PAIR:<controller PAIR_NAME>`.

Pico firmware does not need a protocol change for pairing, emoji, or `GAME:*`.

### Auto-bind and auto-join

Buttonless badges never initiate anything. The Zero is the only input device.

- **Auto-bind (BLE):** the Zero scans and connects to roster names on its own.
  No badge button, no referee action per badge.
- **Auto-join (game):** the referee still binds the controller `pairName` once.
  The player still joins once from the Zero (`KEY1` →
  `POST /api/games/:id/join`). Every connected badge immediately receives the
  current `GAME:*` command. A badge that connects later is synced to that
  same state. Badges are not separate `pairBindings` and do not post join
  themselves.

### Emoji and game commands fan out

One Zero selection → write `MENU:POS:NEG` (or `GAME:*`) to **every** connected
`BleakClient`. A failed write on one badge must not block the others.

### Dashboard slots are roster-driven

The UI shows one station card per controller `pairName`, then one badge
component per name in `badgeNames`. A configured name with no live status
renders as **not connected**. Live slots show the existing BLE statuses
(`scanning`, `connecting`, `connected`, `disconnected`, `offline`).

### BLE scan is serialized

BlueZ on the Pi Zero already fails when two scans overlap (`Operation already
in progress`). Milestone 1 must keep **one scan at a time** and connect
matches **serially**. Periodic rescan fills empty roster slots.

Pi Zero 2 W concurrent BLE centrals are limited (plan for **2–4** badges in
the first hardware pass; make the roster length the cap, not a hard-coded 1).

### Out of scope for this plan

- Badges as separate scored players (their own `pairName` bind / leaderboard
  row)
- A referee UI to assign arbitrary badges to a controller at runtime
- Pico firmware features beyond receiving the same commands they already
  handle
- Changing WS rooms — the room key stays the controller `pairName`

---

## Current code to change

| Area | Today (Mode 1) | Target (Mode 2 roster) |
| --- | --- | --- |
| `pair_config.py` | `PAIR_NAME = "white"` | Plus `BADGE_NAMES = [...]` |
| `BLEController` | One `client` / `device_address` | `dict[badgeName, connection]` |
| `scan_for_device` | First `Pico-Client-<PAIR_NAME>` | All unmatched roster names in one scan |
| `_do_pair_handshake` | Always `PAIR:{PAIR_NAME}` | `PAIR:{badgeName}` |
| `send_emoji_command` / `_ble_write_game_cmd` | One write | Write every connected client |
| `_on_pico_tx_notify` | No source badge | Closure / partial with `badgeName` |
| `_status_payload` | One `badgeId` + `pairName` | `pairName` + `badgeName` + `badgeNames` |
| `BadgeStateService` | Map keyed `controllerId::badgeId` | Station roster + slots keyed `controllerId::badgeName` |
| `BadgesView` | Flat card per `badgeId` | Station card + one slot per roster name |
| `GameRefereePanel` | Bind `pairName` | Unchanged bind; optional `2/3 badges` count |
| Pico `emoji-os-pico.py` | `PAIR_NAME` + `PAIR_OK` | No protocol change |

---

## Milestone 0 — Lock identity and `pair_config` shape

Goal: freeze the config contract so firmware and app work can proceed in
parallel.

### Controller `pair_config.py`

```python
PAIR_NAME = "white"

# Pico PAIR_NAME values this Zero may connect to.
# Order is the dashboard slot order. Duplicate names are ignored.
# Omit or leave empty to keep Mode 1: roster = [PAIR_NAME].
BADGE_NAMES = [
    "white",
    "white-2",
    "white-3",
]
```

Rules:

- `PAIR_NAME` remains required and is the station id sent to the server.
- `BADGE_NAMES` may include `PAIR_NAME` (typical primary badge) and extra
  names.
- Names are case-sensitive and must match the Pico file exactly.
- A Pico that is not in the roster is never connected, even if it is nearby.

### Pico `pair_config.py`

Unchanged:

```python
PAIR_NAME = "white-2"
```

That Pico advertises `Pico-Client-white-2` and expects `PAIR:white-2`.

### Zero loader

Extend the existing `pair_config.py` import in `emoji-os-zero.py` (the file
above the repo root, same path as today):

- Read `BADGE_NAMES` when it is a non-empty list of non-empty strings.
- Otherwise set `BADGE_NAMES = [PAIR_NAME]`.
- Log the roster at boot next to the existing `[PAIR]` lines.

### Acceptance criteria — Milestone 0

- [x] Documented config examples for Mode 1 (`PAIR_NAME` only) and Mode 2
      (roster of 2+ names).
- [x] Zero boot log prints controller `PAIR_NAME` and the resolved
      `BADGE_NAMES` list.
- [x] Missing `BADGE_NAMES` keeps current 1:1 behaviour.

---

## Milestone 1 — Zero multi-connect to named badges

Goal: the Zero can hold simultaneous BLE links to every roster Pico.

This is the largest firmware change. Do not touch emoji-app yet beyond what
is needed to keep existing 1:1 status posts working.

### Refactor `BLEController`

Replace the single `client` / `device_address` / `connected` fields with a
connection table:

```python
# badgeName -> { address, client, connected, pico_version, pair_event, ... }
self.links: dict[str, BadgeLink]
```

Keep a thin Mode 1 compatibility view if needed (`self.client` = the first
connected link) only until Milestone 2 removes single-client call sites.

### Scan

1. Compute `unmatched = [n for n in BADGE_NAMES if not connected(n)]`.
2. If `unmatched` is empty, skip scan.
3. Run **one** `BleakScanner.discover` (UUID scan, then general scan — same
   two-pass approach as today).
4. Select every device whose advertised name is `Pico-Client-<name>` for some
   `name` in `unmatched`.
5. Connect those devices **one at a time**.
6. For each connect: UART check, `PAIR:<badgeName>`, parse `PAIR_OK:<version>`,
   `start_notify` with a handler bound to that `badgeName`.

Do not use the current last-resort "test write to any nearby device" path for
roster names. Strict name match only. The known-MAC fallback can stay as a
debug aid but must still map onto a roster name.

### Reconnect

- `_on_pico_disconnect` and `_reconnect` become per-`badgeName`.
- A drop on `white-2` must not disconnect `white`.
- Global reconnect must not start a second scan while one is running.

### Heartbeat

One heartbeat task that iterates connected links (or one task per link).
Each successful heartbeat can still POST liveness; the payload shape is
finalized in Milestone 3. Until then, posting the existing single-badge
payload for the primary connected badge is acceptable so the 1:1 dashboard
does not go offline.

### Acceptance criteria — Milestone 1

- [x] Two Picos with distinct `PAIR_NAME`s in `BADGE_NAMES` both stay
      connected at once.
- [x] Handshake uses each badge's own name (`PAIR:white-2` for that Pico).
- [x] A third nearby Pico whose name is **not** in the roster is ignored.
- [x] Dropping one badge reconnects only that slot.
- [x] `BADGE_NAMES` omitted → identical to today's single-target scan.
- [x] No overlapping BlueZ scans in the logs.

Hardware confirmation is still required on the `power-cable` / `black` pair.

---

## Milestone 2 — Fan-out emoji and `GAME:*` commands

Goal: the controller is the only input; every connected badge mirrors it.

### Emoji

`send_emoji_command` writes `{menu}:{pos}:{neg}` to each connected link.
Collect per-badge success/failure in the log. Queue **one**
`POST /api/emoji` for the station (`pairName`) after the first successful
write so the dashboard does not flicker N duplicate events. Per-slot emoji
echo is added in Milestone 3/4 if the UI needs it.

### Game commands

`_ble_write_game_cmd` writes the same `GAME:*` string to every connected
link. Skip disconnected slots; log each skip.

### Late-join sync

When a roster badge completes handshake while a game snapshot is already
known (`_ws_game_state`, `_ws_joined`, `_ws_question_id`, readiness):

1. Map current Zero game state to the existing `GAME:*` command (same mapping
   `_apply_game_state_to_display` / `_GAME_CMD_TO_STATE` already uses).
2. Write that command to **only** the newly connected badge.

This is how buttonless badges "join the game under the command of the
controller" without a join POST of their own.

### NFC notify source

`_on_pico_tx_notify` must know which `badgeName` sent `TAG:` / `NFC:`. Use a
closure when calling `start_notify`. Guess POST still uses controller
`pairName`; include `badgeName` in the log now, and on the payload in
Milestone 6.

### Acceptance criteria — Milestone 2

- [x] Choosing an emoji on the Zero updates every connected Pico matrix.
- [x] `GAME:lobby` / `GAME:question_open` / `GAME:correct` reach all
      connected badges.
- [x] Connecting a second badge during an open question shows `?` without
      another `KEY1`.
- [x] A write failure on one badge does not drop the other links.
- [x] Mode 1 (single badge) still shows emoji and game states as today.

Hardware confirmation is still required on the `power-cable` / `black` pair.

---

## Milestone 3 — Per-badge status posts + game follow

Goal: the server can see the roster and each slot's BLE state.

### Status payload (additive)

Extend `_status_payload` (field names must match the Milestone 4 schema):

```json
{
  "controllerId": "zero-1",
  "pairName": "white",
  "badgeName": "white-2",
  "badgeId": "badge-28-cd-c1-05-ab-a4",
  "badgeNames": ["white", "white-2", "white-3"],
  "bleStatus": "connected",
  "controllerVersion": "0.7.0",
  "picoVersion": "0.4.0",
  "batteryLevel": 82,
  "timestamp": "…"
}
```

Rules:

- `pairName` is always the controller name.
- `badgeName` is the roster slot this post describes.
- `badgeNames` is the full roster on every post (small, lets the server
  create empty slots before any badge has connected).
- `badgeId` stays MAC-derived when that slot is connected; use
  `unknown` only when the slot has never connected.
- On boot, POST once per roster name with `bleStatus: "disconnected"` (or
  `"scanning"`) so empty slots appear immediately.
- When a slot connects / drops, POST that slot only (roster still included).

`controller.hello` also gains optional `badgeNames` so a dashboard that
connects after hello can render slots without waiting for HTTP.

### Game follow (controller side)

No extra join API. Confirm these Zero paths already fan out after Milestone 2:

| Controller event | Badge result |
| --- | --- |
| `game.opened` → Zero shows join prompt | All connected badges get `GAME:lobby` |
| `KEY1` join POST succeeds | All connected badges get `GAME:lobby_joined` |
| Later badge connects while joined | That badge gets `GAME:lobby_joined` (or current state) |
| Question / result / end events | All connected badges get the matching `GAME:*` |

### Acceptance criteria — Milestone 3

- [x] Server receives `badgeNames` and a `badgeName` on each status post.
- [x] Three configured names produce three status identities even if only
      one Pico is on.
- [x] Battery and `controllerVersion` still belong to the station (same
      values on every slot post is fine).
- [x] `picoVersion` is per slot (from that badge's `PAIR_OK`).
- [x] Existing Mode 1 posts remain valid (`badgeName` may equal `pairName`).

---

## Milestone 4 — Server station + badge-slot model

Goal: persist a station roster and expose it to the dashboard without
breaking Mode 1 clients.

### Schema (additive)

`statusBodySchema` / `StatusDto`:

- `badgeName`: optional string; default `pairName` or `badgeId` if absent.
- `badgeNames`: optional `string[]`.

`emojiBodySchema` may take optional `badgeName` later; not required if
emoji stays station-scoped.

Key change in `BadgeStateService`:

- Keep ingesting Mode 1 posts keyed `controllerId::badgeId`.
- Also maintain a station map keyed by `pairName` (or `controllerId`) that
  stores `badgeNames`, battery, controller version, and a slot map keyed by
  `badgeName`.

Empty slots: when `badgeNames` arrives, ensure a slot exists for each name.
If no status has been seen for that name, `bleStatus` is synthesized as
`disconnected` (UI label: **not connected**).

### `GET /api/badges`

Keep the current flat `badges[]` array for Mode 1 / existing tests.

Add a grouped view the new React component will use:

```json
{
  "badges": [ "…existing flat records…" ],
  "stations": [
    {
      "pairName": "white",
      "controllerId": "zero-1",
      "controllerVersion": "0.7.0",
      "batteryLevel": 82,
      "badgeNames": ["white", "white-2", "white-3"],
      "badges": [
        {
          "badgeName": "white",
          "badgeId": "badge-aa-…",
          "bleStatus": "connected",
          "picoVersion": "0.4.0",
          "emoji": { "label": "finn", "…" : "…" }
        },
        {
          "badgeName": "white-2",
          "badgeId": null,
          "bleStatus": "disconnected",
          "picoVersion": null,
          "emoji": null
        }
      ]
    }
  ]
}
```

If a Mode 1 client never sends `badgeNames`, synthesize
`stations[].badgeNames = [pairName]` from the single record so the new UI
can render Mode 1 as a one-slot station.

### WebSocket

`status.changed` gains `badgeName` and `badgeNames` when present. Dashboards
update the matching station slot in place.

### As implemented (Milestone 4)

- Stations are keyed by `pairName` (`controllerId` if a client sends no
  `pairName`). Slots are keyed by `badgeName`, defaulting to the station
  name, so a Mode 1 client is a one-slot station. A dashboard applying
  `status.changed` uses the same rule: station `pairName ?? controllerId`,
  slot `badgeName ?? station`.
- `badgeNames` comes from the latest post that carried it. Without one, the
  roster is the slots seen so far.
- `badgeId` and `picoVersion` of `"unknown"` are returned as `null`.
- Battery and `controllerVersion` keep their last non-null value, so a post
  without battery does not blank the station.
- Emoji stays station-scoped: `stations[].emoji` is the last selection, and
  each slot's `emoji` repeats it only while that slot is `connected` (the
  Zero wrote it to every connected badge).
- The server does not synthesize `offline`. As today, the client marks a
  stale `connected` slot offline by comparing its `timestamp` (server time).
- Tests: `server/src/badges.controller.spec.ts`.

### Tests

Extend `badges` / `badge-state` specs:

- Mode 1 post still returns one flat badge and a one-slot station.
- Mode 2 post with three `badgeNames` and one connected `badgeName` returns
  three slots.
- A later post for `white-2` updates only that slot.

### Acceptance criteria — Milestone 4

- [x] Existing status/emoji tests still pass.
- [x] `GET /api/badges` includes `stations` with roster order preserved.
- [x] Missing roster names appear as disconnected / not-connected slots.
- [x] `status.changed` is enough for the dashboard to update one slot
      without a full refetch.

---

## Milestone 5 — React station component

Goal: replace the flat "one card per `badgeId`" grid with a station card
that always shows the configured badge slots.

### Layout

```text
┌─ Station white ──────────────────────────────────────┐
│ Zero  v0.7.0   🔋 82%   WS live                      │
│ Game: lobby · joined · Quiz Night                    │
│                                                      │
│  ┌ white ──────┐  ┌ white-2 ────┐  ┌ white-3 ────┐   │
│  │ connected   │  │ not connected│  │ connecting  │   │
│  │ pico 0.4.0  │  │              │  │             │   │
│  │ [emoji/G]   │  │  —           │  │  —          │   │
│  └─────────────┘  └──────────────┘  └─────────────┘   │
└──────────────────────────────────────────────────────┘
```

- Outer card: controller `pairName`, `controllerId`, versions, battery,
  station-level game section (reuse `BadgeCardGameSection` against
  `pairName`).
- Inner cards: one per `badgeNames` entry, reuse BLE row + primary visual
  from the current badge card.
- Slot without a live connected status: muted **not connected**. Do not
  invent a `badgeId`.
- Preserve the existing card entrance animation on the station card; slots
  can appear without the spin.

### Data

Prefer `stations` from `GET /api/badges`. On `status.changed` / `emoji.sent`,
patch the matching `pairName` + `badgeName`. If `stations` is absent
(old server), fall back to grouping flat records by `pairName`.

### Files

- New: `client/src/app/views/components/StationCard.tsx` (or equivalent)
- Update: `BadgesView.tsx` — iterate stations, not raw `badgeRecords`
- Keep `BadgeCardHeader` pieces for slot chrome; do not show controller
  battery on every inner badge

### As implemented (Milestone 5)

- `client/src/app/views/badge-stations.ts` holds the station model: the
  status / emoji event types, `stationsFromSnapshot` (prefers `stations`,
  falls back to replaying flat `badges` in time order), and the
  `applyStatusToStations` / `applyEmojiToStations` WebSocket patches. They
  use the server's slot rule: station `pairName ?? controllerId`, slot
  `badgeName ?? station`.
- The card (`StationCardHeader`, `StationSlotCard`, `StationCardBody`) lives
  in `BadgesView.tsx`, because it reuses the BLE row, primary visual, game
  section, battery and version helpers already in that file.
- Station header: `pairName`, `controllerId`, controller version, battery,
  `n/m badges` (only for rosters of 2+), and the game section.
- Slot: name, status label, BLE row, Pico version, `badgeId`, and the
  primary visual (station emoji or game icon) only while connected.
- A slot with no `badgeId` reads **not connected** unless it is connecting.
  The Zero posts `scanning` for every name at boot and an unpowered badge
  never posts again. A badge that connected and then dropped reads
  `disconnected` / `offline`.
- Verified in the browser against a live `power-cable` Zero (one connected,
  one never-seen slot) plus simulated Mode 1 and three-name stations.

### Acceptance criteria — Milestone 5

- [x] A 3-name roster always renders 3 badge components.
- [x] Unpowered badges show **not connected**.
- [x] A connecting / connected / disconnected update changes only that slot.
- [x] Mode 1 still reads as one station with one badge.
- [x] Game join / result chips stay on the station header (one player), not
      duplicated as three joined players.

---

## Milestone 6 — Game / referee surfaces + NFC attribution

Goal: multi-badge stations play as one team; the UI can still say which
badge scanned.

### Bind and join (no new endpoints)

- Referee binds `{ pairName: "white" }` only.
- `GameRefereePanel` known-pair chips still come from station `pairName`.
- Optional chip subtitle: `2/3 badges` from connected slot count.
- `controller.joined`, readiness, `question.result`, and scores stay keyed
  by controller `pairName`.

### Guess / NFC

`POST /api/guesses` already accepts optional `badgeId`. Add optional
`badgeName` (string) and echo it on `nfc.tagged`.

The Zero includes `badgeName` from the notify closure. Unique guess
constraint remains **one guess per `pairName` per question** — the first
scan from any of the station's badges counts. Later scans from sibling
badges in the same question are ignored or rejected the same way a second
scan from the same pair is today.

Dashboard: station header shows the guess; the source slot can flash a
small NFC chip (`white-2 · B`).

### Player / play views

`GamePlayView` and leaderboard rows stay one row per `pairName`. Do not
add a row per badge.

### As implemented (Milestone 6)

- `POST /api/guesses` takes optional `badgeName` (non-empty string). It is
  stored on the `Guess` document and echoed on `nfc.tagged` only when sent.
- Uniqueness is unchanged: the `uniq_guess_per_pair` index
  (`questionId` + `pairName`) rejects a sibling badge's later scan with the
  same `400` a repeat scan gets today. With one bound pair the first guess
  also auto-closes the question, so the sibling sees "not open".
- Zero `0.7.16`: `_relay_nfc_tag` adds `badgeName` from the notify closure
  and resolves `badgeId` per slot (still sent only when it is a 24-char
  ObjectId override).
- Dashboard: the station game section reads `NFC: B from white-2` for
  rosters of 2+. The source slot shows a `white-2 · B` chip (blue when
  correct, red when wrong) that pulses on arrival and clears on the next
  `question.opened`. Mode 1 is visually unchanged.
- Referee panel: known pairs come from `stations` (via
  `stationsFromSnapshot`, so old servers still work). Bound-pair chips and
  invite options show `n/m badges` for rosters of 2+. The connected count
  uses the shared `isLiveConnected` stale rule in `badge-stations.ts`.
- `GameDetailView` and `BadgesView` game logs include `badge=<badgeName>`.
- Tests: `server/src/game-flow.controller.spec.ts` (echo, omission, empty
  `badgeName` rejected).
- Verified in the browser with a simulated 3-name station (two connected):
  one bind and one join, a scan from the second badge scored the station
  once, and the sibling's scan was rejected.

### Acceptance criteria — Milestone 6

- [x] Binding `white` once is enough for all of that station's badges to
      receive game events (via the Zero fan-out).
- [x] One join from the Zero marks the station joined; badge slots do not
      each appear as waiting players.
- [x] First NFC from any connected badge records the station guess.
- [x] `nfc.tagged` includes `badgeName` when sent.
- [x] Scores and `question.result` still have one entry for `white`.

Hardware confirmation is still required (Milestone 7 checklist).

---

## Milestone 7 — Docs, setup, hardware verification

Goal: operators can flash mixed buttoned / buttonless badges and confirm
the sport flow.

### Docs to update

- [`next-steps.md`](./next-steps.md) Step 10 — point at this file (done when
  this plan lands; mark milestones done as they ship).
- [`game-modes.md`](./game-modes.md) Mode 2 — replace "all Picos share
  `PAIR_NAME`" with the roster model; keep Mode 1 as current.
- [`game-realtime-design.md`](./game-realtime-design.md) multi-badge
  section — note Topology A game identity + named discovery.
- `rainbow-connection/python/emoji-os/project/badge-setup.md` — each Pico
  gets its own `PAIR_NAME`; that name must appear in the Zero
  `BADGE_NAMES`.
- `rainbow-connection/python/emoji-os/project/controller-setup.md` —
  document `BADGE_NAMES`.
- `rainbow-connection/python/emoji-os/project/multiplayer-mode.md` —
  pairing section for N named targets.

### Hardware checklist

- [ ] Mode 1 regression: one Zero, one Pico, same `PAIR_NAME`, no
      `BADGE_NAMES` — pair, emoji, join, NFC guess, scoring.
- [ ] Mode 2: one Zero, two Picos (`white`, `white-2`). Both connect.
      Emoji on Zero appears on both matrices.
- [ ] Buttonless Pico (`white-2`) never needs a key press. After Zero
      `KEY1` join, both badges show joined / active / question states.
- [ ] Power `white-2` after the question is already open — it shows `?`.
- [ ] Power off `white` — `white-2` stays connected; dashboard slot
      `white` goes not connected / disconnected.
- [ ] Unknown Pico `red` nearby is not captured by the `white` Zero.
- [ ] Dashboard always shows two slots for a two-name roster.
- [ ] Referee bind + join + one NFC scan scores the station once.

---

## Suggested implementation order

Do these in order. Each milestone should be shippable on its own.

1. **Milestone 0** — config + boot log (controller file only).
2. **Milestone 1** — BLE table and named scan/connect (test with two Picos
   and `STATUS` / pair logs; dashboard may still look 1:1).
3. **Milestone 2** — emoji + `GAME:*` fan-out + late-join sync (this is the
   first "feels like multi-badge" demo on hardware).
4. **Milestone 3** — status payload with `badgeName` / `badgeNames`.
5. **Milestone 4** — server `stations` grouping (tests first).
6. **Milestone 5** — React station card (verify in the browser: Mode 1
   one-slot, Mode 2 empty slots, live connect/disconnect).
7. **Milestone 6** — referee chip count + `badgeName` on NFC.
8. **Milestone 7** — docs and the hardware checklist.

---

## Pico notes

`emoji-os-pico.py` already:

- Advertises `Pico-Client-<PAIR_NAME>`
- Accepts only `PAIR:<PAIR_NAME>`
- Applies emoji and `GAME:*` writes after pair
- Notifies `TAG:<uid>` / `NFC:<uid>`

No Pico protocol work is required for this plan. Buttonless hardware is
supported because **join and emoji originate on the Zero**. Flash each
buttonless Pico with its own `pair_config.py` name and add that name to
the controller roster.

If a future badge needs local buttons, it can still use the same
`PAIR_NAME` / roster slot; the Zero remains authoritative for game join.

---

## Risk notes

- **BlueZ scan races** — serialize scan/connect; one global scan lock.
- **Connection budget** — first hardware pass targets 2 badges, then 3–4.
  If a fifth connect fails, leave that slot **not connected** and log it.
- **Advertised name length** — Pico already truncates long
  `Pico-Client-<PAIR_NAME>` names. Keep roster names short.
- **Dashboard flicker** — do not emit N `emoji.sent` events per selection;
  one station emoji plus per-slot BLE status is enough.
- **Scoring uniqueness** — do not create per-badge `pairBindings` or the
  leaderboard will treat one team as N players.
