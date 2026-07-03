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
