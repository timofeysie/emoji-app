# Multi-badge plan — one controller, many named badges

Status: **implemented** (hardware checklist in Milestone 7 pending). This is
the implementation plan for Step 10 in
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
| 7 | Docs, setup, hardware verification | Docs + devices | 🟡 docs done; hardware checklist pending |
| 8 | Each badge is a separate player | Server + Zero + React | ⬜ not started |
| 9 | Fix docs for per-badge players | Docs | ⬜ not started |

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

- [x] [`next-steps.md`](./next-steps.md) Step 10 — point at this file (done when
  this plan lands; mark milestones done as they ship).
- [x] [`game-modes.md`](./game-modes.md) Mode 2 — replace "all Picos share
  `PAIR_NAME`" with the roster model; keep Mode 1 as current.
- [x] [`game-realtime-design.md`](./game-realtime-design.md) multi-badge
  section — note Topology A game identity + named discovery.
- [x] `rainbow-connection/python/emoji-os/project/badge-setup.md` — each Pico
  gets its own `PAIR_NAME`; that name must appear in the Zero
  `BADGE_NAMES`.
- [x] `rainbow-connection/python/emoji-os/project/controller-setup.md` —
  document `BADGE_NAMES`.
- [x] `rainbow-connection/python/emoji-os/project/multiplayer-mode.md` —
  pairing section for N named targets.

### As implemented (Milestone 7)

- `game-modes.md` Mode 2 is rewritten for the roster model (identity,
  config, BLE lifecycle, game flow, NFC attribution, dashboard) with an
  updated Mode 1 / Mode 2 comparison table.
- `game-realtime-design.md` keeps Topologies A and B as the options
  considered and adds the implemented hybrid (named discovery, one station
  identity). The `pairBindings`, NFC relay, and example event payloads use
  `badgeName`; the multi-badge open question is marked resolved.
- `badge-setup.md` adds name rules, buttonless-badge behaviour, and the Zero
  log lines / dashboard slot that confirm a badge connected.
- `controller-setup.md` adds the boot / scan log lines, the 2–4 badge
  budget, and the one-bind / one-join station rules.
- `multiplayer-mode.md` updates the intro, handshake (`PAIR:<badgeName>`),
  behaviour summary, NFC flow (`badgeName`, one guess per pair), adds a
  Mode 2 action table and Mode 2 smoke-test steps.
- The hardware checklist below has to be run on devices (Zero `v0.7.16`).

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

## Milestone 8 — Each badge is a separate player

Goal: every badge on a Mode 2 station is its own scored player. The Zero
stays the only input device (it joins and answers the ready prompt for its
badges), but each badge has its own binding, guess, result, score row, and
winner / loser outcome.

Milestones 4–7 built Mode 2 as **one team per station**: one binding, one
guess per question from whichever badge scanned first, one score row. That
is wrong. Mode 2 is not a team mode. A team mode may be added later as a
separate mode; it is out of scope here.

### Locked decisions (Milestone 8)

These replace the conflicting locks earlier in this file (`pairName` is one
player, the "badges as separate scored players" out-of-scope bullet, and the
"Scoring uniqueness" risk note). Milestone 9 rewrites those sections.

| Term | Meaning after Milestone 8 |
| --- | --- |
| station | Controller `PAIR_NAME` (`stationName`). Not a player. |
| player | One badge, keyed by its `badgeName`. |

The station owns the WS room, the referee bind target, and the roster. The
player owns binding, join, readiness, guess, result, score, and outcome.

- **Player key = `badgeName`.** In Mode 1 the only badge's name equals
  `PAIR_NAME`, so Mode 1 keys, stored rows, and payloads do not change.
- **Storage reuses `pairName` as the player key.** `pairBindings.pairName`
  and `guesses.pairName` hold the `badgeName`, so the existing unique
  indexes (one binding per name, `uniq_guess_per_pair`) give one binding and
  one guess **per badge** per question. Both collections gain
  `stationName`. Rows without `stationName` (Mode 1 and existing data) read
  as `stationName = pairName`.
- **Badge names are unique across stations.** The BLE roster already needs
  this; the binding index now depends on it too. Binding a station whose
  roster name belongs to another live station is rejected with `409`.
- **Referee binds the station once.** `{ pairName: "white" }` expands to one
  player binding per roster name.
- **The Zero joins its badges.** One `KEY1` posts a join that lists every
  connected badge. A badge that connects later while the station is joined
  auto-joins.
- **Auto-close waits for joined players only.** An unpowered roster badge
  must not hold a question open. This also changes Mode 1: a bound pair that
  never joined no longer blocks auto-close.
- **Each Pico shows its own player state.** Correct / wrong and winner /
  loser go to that badge only. Station-wide phases (lobby, question open,
  question closed, ready prompt) still fan out.
- **The Zero LCD shows a station summary.** It keeps the station phase
  glyph, adds an `answered n/m` caption while a question is open, and plays
  fireworks at game end when any of its badges won (rain otherwise).

### Server

Model and repository (`server/src/persistence/models.ts`,
`game-data.repository.ts`):

- `pairBindingSchema`: add `stationName` and an index on
  `{ gameId, stationName }`.
- `guessSchema`: add `stationName`.
- `bindPair` becomes `bindStation({ stationName, badgeNames, gameId,
  controllerId })`. It upserts one binding per roster name and deletes
  bindings for that `stationName` whose name has left the roster.
- `markJoined` and `setPairReadyForNextQuestion` take a list of player names
  scoped by `stationName` and `gameId`.
- `getBinding(pairName)` resolves the station and returns a station snapshot
  plus `players: [{ badgeName, joined, readyForNextQuestion, guessed,
  slotLabel, isCorrect }]` for the open question. Top-level `joined` and
  `readyForNextQuestion` stay for Mode 1 (the single player's values).
- `getBindingsByGameId` returns player names. Add `getStationNamesByGameId`
  for WS routing.
- `submitGuess`: player = `badgeName ?? pairName`. When `badgeName` is sent,
  require a binding with that name, `stationName = pairName`, and the same
  `gameId`. Store the player in `pairName` and the station in `stationName`.
- `haveAllBoundPairsGuessed` becomes `haveAllJoinedPlayersGuessed` and only
  counts `joined: true` bindings.
- `computeQuestionResult`, `getGameScores`, `getGameGuessChart`, and
  `getGameDetail().boundPairs` return one row per player, each with
  `stationName` and `badgeName`.

Controllers:

- `pair-bindings.controller.ts`
  - Bind: body `{ pairName, controllerId?, badgeNames? }`. Roster comes from
    the body, else the live `BadgeStateService` station, else `[pairName]`.
  - Join: optional `badgeNames: string[]` (default `[pairName]`). Emit one
    `controller.joined` per player with `pairName` (station) and
    `badgeName`.
  - Readiness: optional `badgeNames`. Emit one
    `controller.readiness.changed` per player with `badgeName`.
- `game-flow.controller.ts`
  - Route controller events by station name, deduplicated, so a 3-badge
    station receives one copy of each station-wide event.
  - `question.result`: one `results[]` row per player with `stationName`
    and `badgeName`.
  - `game.ended` on `completed`: one enriched event per player (`badgeName`,
    `rank`, `score`, `isWinner`) sent to that player's station room. Rank
    and winner are computed across all players, not stations.
  - `nfc.tagged`: always carries `badgeName` (the player) and adds
    `stationName`.
  - `GET /api/games/:gameId/play`: `boundPairs` and `previousResult.scans`
    are per player with `stationName`.
- `badge-state.service.ts`: expose the live roster for a station so bind can
  expand it.

Tests:

- `pair-bindings.controller.spec.ts`: binding a 3-name station creates three
  player bindings; rebinding with a shorter roster removes the stale one;
  join with `badgeNames` marks only the listed players; readiness is per
  player; a roster name owned by another station returns `409`.
- `game-flow.controller.spec.ts`: two badges on one station guess the same
  question and both are stored, both appear in `question.result`, and both
  score; a second guess from the same badge returns `400`; auto-close fires
  once every joined player has guessed and ignores a not-joined roster
  badge; `game.ended` is sent once per player to a single station room;
  Mode 1 payloads are unchanged.
- `game-data.repository.spec.ts`: score and guess-chart rows per player with
  `stationName`; a legacy binding without `stationName` still resolves.

### Zero firmware (`emoji-os-zero.py`)

Per-badge game state:

- `_game_pair_result`, `_game_answered_this_question`, and
  `_game_end_outcome` become dicts keyed by `badgeName`.
- `_ws_joined` becomes a set of joined badge names. The station counts as
  joined when the set is non-empty.
- `_next_question_ready` stays station-level (only the Zero has buttons),
  but the readiness POST applies it to every joined badge.
- `_current_game_cmd(badge_name)` uses that badge's state.
  `_sync_badge_game_state` and `_apply_game_state_to_display` write the
  right command to each badge instead of one fan-out command.

Join and readiness:

- `KEY1` join posts `{ pairName, controllerId, badgeNames }` with every
  connected roster badge.
- When a roster badge completes its handshake while the station is joined
  and the game is `lobby` or `active`, POST join for that badge only, then
  sync it.
- The readiness POST includes `badgeNames` (joined, connected badges).
- Mode 1 sends `badgeNames: [PAIR_NAME]`.

NFC:

- `_relay_nfc_tag(card_uid, badge_name)`: the "already answered" guard is
  per badge. A second scan from the same badge is ignored; a scan from a
  sibling badge is a new guess. Always send `badgeName` (Mode 1:
  `PAIR_NAME`). Update the docstring that says sibling scans are rejected.
- `_schedule_pair_answer` and `_apply_pair_answer` take `badge_name` and
  write `GAME:correct` / `GAME:wrong` to that badge only. The other badges
  stay on `GAME:question_open`.
- An unknown card is wrong for the scanning badge only.

Server events:

- `question.result`: for each joined badge, find the row by `badgeName`
  (fall back to `pairName` for older servers) and apply it to that badge. A
  joined badge with no guess shows wrong, as the station does today.
- `game.ended` with `badgeName`: winner / loser goes to that badge. Without
  `badgeName` (older server), apply to every badge as today.
- `game.ready`, `game.opened`, `game.started`, `question.opened`, and
  `question.closed` still fan out to every badge and reset per-badge state.
- Welcome / HTTP poll snapshot: restore per-badge joined and answered state
  from `players[]`.

Bump the Zero version (for example `0.8.0`) and the expected version in
`GET /api/version` so the dashboard flags older controllers.

No Pico change: badges still receive the same `GAME:*` commands, just
addressed per badge.

### React

- `client/src/app/views/badge-stations.ts`: `controller.joined`,
  `controller.readiness.changed`, `nfc.tagged`, `question.result`, and
  `game.ended` carry `badgeName`. Add per-slot game state (joined, ready,
  guess, result, outcome) and patch helpers keyed by station and
  `badgeName`.
- `BadgesView.tsx`: each slot shows its own joined chip, guess chip
  (`white-2 · B`), correct / wrong result, and winner / loser. The station
  header keeps the game title and state plus `joined 2/3` and
  `answered 1/2` counts. Remove the station-level `NFC: B from white-2`
  line.
- `GameRefereePanel.tsx`: bind chips stay per station. The bound list shows
  players grouped under their station, each with joined and ready state.
  Any "all ready" count uses players, not stations.
- `GamePlayView.tsx`: leaderboard and previous-result scans have one row
  per player, labelled with the `badgeName` and a station subtitle for
  rosters of 2+.
- `PairGuessChart.tsx`: one column per player.
- `GameDetailView.tsx`: bound pairs, scores, and game logs per player.
- Mode 1 stays visually unchanged.

### Hardware checklist (Milestone 8)

- [ ] Mode 1 regression: pair, emoji, join, NFC guess, scoring, winner /
      loser.
- [ ] Mode 2 (`white`, `white-2`): one `KEY1` join shows both badges joined
      in the referee panel.
- [ ] Scan on `white` shows correct / wrong on `white` only; `white-2`
      stays on `?`.
- [ ] Scan on `white-2` records its own guess; the question auto-closes
      after both badges answer.
- [ ] A second scan on the same badge in the same question is ignored.
- [ ] An unpowered third roster badge does not hold the question open.
- [ ] Powering a roster badge during the lobby auto-joins it.
- [ ] The leaderboard has one row per badge, and each badge shows its own
      winner / loser at game end.

### Acceptance criteria — Milestone 8

- [ ] Binding a Mode 2 station creates one player binding per roster name.
- [ ] Every connected badge is a joined player after one `KEY1` join.
- [ ] Each badge can record one guess per question, independent of its
      siblings.
- [ ] `question.result`, scores, the guess chart, and the play view have
      one row per badge.
- [ ] `game.ended` gives each badge its own rank, score, and winner flag.
- [ ] Each Pico shows only its own correct / wrong and winner / loser.
- [ ] The dashboard shows join, guess, and result per badge slot.
- [ ] Mode 1 behaviour and payloads are unchanged (except the joined-only
      auto-close rule).

---

## Milestone 9 — Fix docs for per-badge players

Goal: remove the "one station = one player / team" description written in
Milestones 6 and 7 and describe Mode 2 as one player per badge. Do this
after Milestone 8 ships so the docs match the code.

### This plan (`multi-badge-plan.md`)

- [ ] Status line: mention Milestone 8.
- [ ] Locked decisions, "Station vs badge": `pairName` is the station, not
      the player; add the player row (`badgeName`) and remove "A multi-badge
      station is still one player."
- [ ] Roster diagram: replace `(one bind, one join, one score)` with one
      station bind expanding to one player per badge.
- [ ] "Auto-bind and auto-join": replace "Badges are not separate
      `pairBindings`" with the Milestone 8 rules (station bind expands, the
      Zero joins its badges, late badges auto-join).
- [ ] "Out of scope": remove "Badges as separate scored players"; add "Team
      mode (one score per station)" as a possible future mode.
- [ ] "Current code to change": update the `GameRefereePanel` row.
- [ ] Milestone 5 acceptance (station-header chips, "not duplicated as
      three joined players") and all of Milestone 6 (goal, Guess / NFC,
      Player / play views, As implemented, acceptance): add a short note
      that Milestone 8 superseded the team behaviour. Keep the history.
- [ ] Milestone 7 hardware checklist: replace "scores the station once"
      with a pointer to the Milestone 8 checklist.
- [ ] Risk notes: rewrite "Scoring uniqueness" (per-badge bindings are now
      intended; the risk is two stations sharing a badge name).

### Other docs touched in Milestone 7

- [ ] [`game-modes.md`](./game-modes.md): Mode 2 intro ("one player: one
      bind, one join, one guess per question, one score row"), the NFC
      attribution paragraph (sibling scan rejected), the use-case table row
      "Team buzzer … one team score" (move to a future team mode), and the
      Mode 1 / Mode 2 comparison row "Controller station (one player)".
- [ ] [`game-realtime-design.md`](./game-realtime-design.md): the hybrid
      topology note ("one bind / join / score"), the `pairBindings` section
      ("never bound separately … score one team"), and the example
      `question.result` / `game.ended` / `nfc.tagged` payloads (add
      `stationName` and `badgeName`). Topology A can stay as an option
      considered, but say the implemented Mode 2 scores per badge.
- [ ] `rainbow-connection/python/emoji-os/project/badge-setup.md`: the
      paragraph saying the first scan is the station's answer and sibling
      scans are ignored.
- [ ] `rainbow-connection/python/emoji-os/project/controller-setup.md`:
      "The station is one player in emoji-app" and the one-bind / one-join
      rules (bind once, but each badge is a player; late badges auto-join).
- [ ] `rainbow-connection/python/emoji-os/project/multiplayer-mode.md`: the
      intro ("still plays as one player"), the Mode 2 section ("one player
      with several badges"), the NFC flow step ("one guess per pairName per
      question"), the Mode 2 action table, and the Mode 2 smoke test.
- [ ] [`next-steps.md`](./next-steps.md) Step 10: status reflects
      Milestone 8.

### Acceptance criteria — Milestone 9

- [ ] No doc says a Mode 2 station is one player, one team, or has one
      score.
- [ ] Every doc that describes Mode 2 scoring says one player per badge,
      keyed by `badgeName`.
- [ ] Team play is only mentioned as a possible future mode.

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
9. **Milestone 8** — per-badge players: server first (tests), then Zero
   firmware, then React.
10. **Milestone 9** — rewrite the team-mode wording from Milestones 6 and 7.

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
