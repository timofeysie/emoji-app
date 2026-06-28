# Server foundations

This document sequences the first slice of server work for the realtime game.
**Step 0** is a small, self-contained precursor: it moves the NFC card mapping
off the device and behind a server API. It is deliberately the simplest possible
server→device read flow, so it warms up every pattern Step 1 leans on (a NestJS
controller + Zod + service on the server, and an HTTP fetch with offline
fallback on the Zero) without touching game state. **Step 1** is the original
foundations work from [`game-realtime-design.md`](./game-realtime-design.md).

## Step 0 — NFC card mapping API (do this first)

### Goal

Replace the hardcoded `NFC_CARD_MAP` in `emoji-os-zero.py`
(`rainbow-connection/python/emoji-os/emoji-os-zero.py`, currently lines 107–110)
with a static mapping that lives on the server and is served over a read API.
The Zero fetches the mapping on startup and uses it exactly as today: when the
Pico scans a tag and sends `NFC:<card_id>`, the Zero maps the id to a name +
icon and tells the Pico which symbol to display. End-to-end behavior is
**unchanged**; only the source of the mapping moves from the device to the
server. The mapping stays static (in server config) for now — making it
dynamically editable (Mongo-backed, admin/AI-authored) is a later step.

### Mapping shape

Each card maps an `id` to a human-readable `name` and a `display` (the icon/emoji
key the Pico already understands — currently `circle` or `x`). We keep the field
name `display` to match the existing device code (`card["display"]`) and avoid
churn; treat it as "the icon to show".

```json
{
  "cards": [
    { "id": "5B:6F:B8:08", "name": "R12 - Monkey", "display": "circle" },
    { "id": "DB:93:B7:08", "name": "W3 - Clown",   "display": "x" }
  ]
}
```

### Server changes (`emoji-app/server`)

- Add a static seed of the two current cards as a server-side constant (e.g. a
  `NFC_CARDS` array or a tiny `NfcCardService` that holds the map). Mirror the
  `BadgeStateService` style in `server/src/badge-state.service.ts`.
- Expose `GET /api/nfc-cards` returning `{ cards: [{ id, name, display }] }`.
  Follow the `BadgesController` pattern in `server/src/badges.controller.ts`
  (`@Controller('api')`, `@Get('nfc-cards')`), and define a Zod schema for the
  card shape alongside the existing `statusBodySchema` / `emojiBodySchema`.
- Register the new controller (and service, if separate) in
  `server/src/app.module.ts` `controllers` / `providers`.
- Add a unit spec mirroring the existing `*.spec.ts` coverage (e.g.
  `nfc-cards.controller.spec.ts`) asserting the endpoint returns the seeded
  cards.

### Zero changes (`emoji-os-zero.py`)

- Add a `fetch_from_server(path)` GET helper next to the existing
  `post_to_server` (reuse `requests` and `SERVER_URL`; same no-op-when-empty and
  try/except resilience).
- On startup, call `GET /api/nfc-cards`, transform the list into the existing
  in-memory dict shape `{ id: { "name": ..., "display": ... } }`, and assign it
  to `NFC_CARD_MAP`.
- Keep the two current entries as a **hardcoded fallback** used when the fetch
  fails or `SERVER_URL` is empty, so the badge still works offline. (Optionally
  refresh periodically on the existing heartbeat loop; not required for parity.)
- Leave `_handle_nfc_card` and the `NFC_RESULT:<symbol>` send-to-Pico path
  unchanged — it just reads from the now server-sourced `NFC_CARD_MAP`.

### Pico changes (`emoji-os-pico.py`)

- **None required** for current behavior: the Pico still receives
  `NFC_RESULT:circle` / `NFC_RESULT:x` and renders the same symbols. Supporting a
  richer icon vocabulary (arbitrary emoji per card) is a future extension that
  would widen both the Zero→Pico command and the Pico display routines; it is out
  of scope for Step 0.

### Acceptance criteria

- `GET /api/nfc-cards` returns the two seeded cards; covered by a unit test.
- With `SERVER_URL` reachable, scanning each known tag shows the same name in the
  Zero log and the same symbol on both the Zero and Pico as before this change.
- With the server unreachable, the Zero falls back to the built-in two-card map
  and behaves exactly as it does today.

### Why before Step 1

This establishes the smallest real server→device contract and exercises the
controller/Zod/service + Zod-validated HTTP patterns that Step 1 builds on
(`/api/pairs`, version reporting, `/api/games/:id/state`), with zero game-state
risk — a safe on-ramp into the foundations work below.

## Step 0.5 — Pair identity, versions, and battery reporting ✅ implemented

This slice was delivered before Step 1. It wires the existing device-side data
(`PAIR_NAME`, `VERSION`, Pico version, battery %) into the server and
dashboard without touching game state.

### What was done

#### Pico (`emoji-os-pico.py`)

- `_handle_pair_attempt` now replies `PAIR_OK:<VERSION>` (e.g. `PAIR_OK:0.3.2`)
  instead of a bare `PAIR_OK`, so the Zero can learn the Pico's version during
  the BLE handshake. Backward-compatible: the Zero accepts both forms.

#### Zero (`emoji-os-zero.py`)

- Added `_CONTROLLER_VERSION` (normalized `VERSION`, e.g. `"0.5.8"`) and
  `_pico_version` (parsed from the `PAIR_OK:<version>` reply; falls back to
  `"unknown"` for older Pico firmware).
- `_do_pair_handshake` now parses the optional version suffix from the Pico's
  reply and stores it in the global `_pico_version`.
- `_status_payload` now includes `pairName`, `controllerVersion`, `picoVersion`,
  and `batteryLevel` (0–100 from INA219, omitted when unavailable).
- `_emoji_payload` now includes `pairName`.

#### Server (`badge-state.service.ts`)

- `statusBodySchema` accepts optional `pairName`, `controllerVersion`,
  `picoVersion`, and `batteryLevel` fields.
- `emojiBodySchema` accepts optional `pairName`.
- `StatusDto` and `EmojiDto` carry the new fields through to `status.changed`
  WebSocket events and `GET /api/badges` responses.

#### Frontend (`BadgesView.tsx`)

- `StatusChangedEvent` and `EmojiSentEvent` types extended with new fields.
- Badge cards now show:
  - **`pairName`** as the primary bold label (e.g. "white"), falling back to
    `badgeId` when absent.
  - **`controllerVersion`** and **`picoVersion`** as small icon+text badges
    below the identifiers.
  - **Battery level** as a color-coded percentage with a battery icon
    (green ≥ 40 %, amber ≥ 15 %, red < 15 %), hidden when unavailable.

### What remains for Step 1

- `pairBindings` model (keyed by `pairName`) + bind/get endpoints.
- `EXPECTED_CONTROLLER_VERSION` / `EXPECTED_PICO_VERSION` config and the
    computed `outdated` flag.
- `POST /api/games/:gameId/state` (+ repository transition method) and
    `POST /api/games/:gameId/join` (by `pairName`).
- Extend `submitGuess` to accept `pairName` and emit `nfc.tagged`.
- Refactor ws into a registry with `broadcastDashboard` +
    `sendToPairsOfGame`; handle `controller.hello` (record `pairName`; accept but
    do not validate `token`); emit controller and dashboard events.
- Unit tests mirroring existing `*.spec.ts` coverage.

## Step 1 — Server foundations (no device impact)

- `pairBindings` model (keyed by `pairName`) + bind/get endpoints.
- `EXPECTED_CONTROLLER_VERSION` / `EXPECTED_PICO_VERSION` config and expose
    the expected values (or a computed `outdated` flag).
- `POST /api/games/:gameId/state` (+ repository transition method) and
    `POST /api/games/:gameId/join` (by `pairName`).
- Extend `submitGuess` to accept `pairName` and emit `nfc.tagged`.
- Refactor ws into a registry with `broadcastDashboard` +
    `sendToPairsOfGame`; handle `controller.hello` (record `pairName`; accept but
    do not validate `token`); emit controller and dashboard events.
- Unit tests mirroring existing `*.spec.ts` coverage.
