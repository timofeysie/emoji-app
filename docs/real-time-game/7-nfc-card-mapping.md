# Step 7 — NFC Card → Answer Mapping (Demo-Ready)

Status: **✅ done**

This step made end-to-end NFC guesses work for the demo without requiring a
MongoDB `NfcCardGroup` / `GameNfcCardGroupAssignment` to be configured in
advance. The card-to-slot mapping now lives on the Zero (via `pair_config.py`
and the server's `GET /api/nfc-cards` endpoint), and the referee can
optionally assign a MongoDB card group from `GameRefereePanel` when needed.

---

## What was built

| Change | File(s) |
| --- | --- |
| `NFC_CARD_MAP_LOCAL` with `slotLabel` added to `pair_config.py` | `rainbow-connection/python/emoji-os/pair_config.py` |
| Zero loads `NFC_CARD_MAP_LOCAL` from `pair_config.py` if present | `emoji-os-zero.py` — pair_config loading block |
| `NFC_CARD_MAP_FALLBACK` entries extended with `slotLabel` | `emoji-os-zero.py` — lines ~150–153 |
| `load_nfc_card_map()` preserves `slotLabel` from server response | `emoji-os-zero.py` — `load_nfc_card_map` |
| `_relay_nfc_tag()` includes `slotLabel` in `POST /api/guesses` payload | `emoji-os-zero.py` — `_relay_nfc_tag` |
| `GET /api/nfc-cards` response now includes `slotLabel` per card | `server/src/nfc-card.service.ts` |
| `POST /api/guesses` accepts optional `slotLabel`; fallback path bypasses card group | `server/src/game-flow.controller.ts` + `game-data.repository.ts` |
| `GET /api/games/:gameId/nfc-card-group` — active assignment status | `server/src/game-flow.controller.ts` + `game-data.repository.ts` |
| `assignedByUserId` made optional on attach endpoint | `server/src/game-flow.controller.ts` + `game-data.repository.ts` |
| `GameRefereePanel` — NFC card group section with Assign/Reassign button | `client/src/app/views/components/GameRefereePanel.tsx` |

---

## 7a — Zero card map extended with `slotLabel`

### `pair_config.py`

A new `NFC_CARD_MAP_LOCAL` dict is defined alongside `PAIR_NAME`. Each entry
maps a card UID to `{ name, display, slotLabel }` where `slotLabel` matches
the `AnswerOption` slot labels in the game (`A`–`E`):

```python
NFC_CARD_MAP_LOCAL = {
    "5B:6F:B8:08": {"name": "R12 - Monkey", "display": "circle", "slotLabel": "A"},
    "DB:93:B7:08": {"name": "W3 - Clown",   "display": "x",      "slotLabel": "B"},
}
```

This file lives **outside** the repo (at `<repo_parent>/pair_config.py`) so
`git pull` cannot overwrite it. The copy inside
`python/emoji-os/pair_config.py` is the template.

### `emoji-os-zero.py` — four changes

**1. `NFC_CARD_MAP_FALLBACK`** (built-in fallback) — `slotLabel` added to
both entries so the Zero resolves answers even without `pair_config.py` or a
reachable server:

```python
NFC_CARD_MAP_FALLBACK = {
    "5B:6F:B8:08": {"name": "R12 - Monkey", "display": "circle", "slotLabel": "A"},
    "DB:93:B7:08": {"name": "W3 - Clown",   "display": "x",      "slotLabel": "B"},
}
```

**2. `pair_config.py` loading block** — after reading `PAIR_NAME`, the Zero
now also reads `NFC_CARD_MAP_LOCAL` if it exists on the module, overriding
both `NFC_CARD_MAP_FALLBACK` and `NFC_CARD_MAP`:

```python
if hasattr(_pair_mod, "NFC_CARD_MAP_LOCAL") and isinstance(_pair_mod.NFC_CARD_MAP_LOCAL, dict):
    NFC_CARD_MAP_FALLBACK = _pair_mod.NFC_CARD_MAP_LOCAL
    NFC_CARD_MAP = dict(NFC_CARD_MAP_FALLBACK)
    print(f"[NFC] local card map: {len(NFC_CARD_MAP_FALLBACK)} card(s) from pair_config.py", flush=True)
```

**3. `load_nfc_card_map()`** — the server-response parse loop now includes
`slotLabel` when the field is present:

```python
entry = {"name": card["name"], "display": card["display"]}
if "slotLabel" in card:
    entry["slotLabel"] = card["slotLabel"]
new_map[card["id"]] = entry
```

Entries without `slotLabel` are still accepted so the Zero does not break if
the server is on an older version.

**4. `_relay_nfc_tag()`** — `slotLabel` from `NFC_CARD_MAP` is included in
the `POST /api/guesses` payload. The log line also prints the resolved slot:

```python
card_info = NFC_CARD_MAP.get(card_uid, {})
payload = {
    "gameId":     _ws_game_id,
    "questionId": _ws_question_id,
    "pairName":   PAIR_NAME,
    "badgeId":    _resolve_badge_id(),
    "cardUid":    card_uid,
    "slotLabel":  card_info.get("slotLabel"),
}
print(f"[NFC] relaying TAG {card_uid!r} slotLabel={payload['slotLabel']!r} → POST /api/guesses", flush=True)
```

`slotLabel` may be `None` if the card UID is not in `NFC_CARD_MAP` — the
server handles that case gracefully (see 7c).

---

## 7b — `GET /api/nfc-cards` now returns `slotLabel`

`nfc-card.service.ts` — `nfcCardSchema` and `SEED_NFC_CARDS` updated:

```ts
export const nfcCardSchema = z.object({
  id:         z.string().min(1),
  name:       z.string().min(1),
  display:    z.string().min(1),
  slotLabel:  z.enum(['A', 'B', 'C', 'D', 'E']).optional(),
});

const SEED_NFC_CARDS: NfcCard[] = [
  { id: '5B:6F:B8:08', name: 'R12 - Monkey', display: 'circle', slotLabel: 'A' },
  { id: 'DB:93:B7:08', name: 'W3 - Clown',   display: 'x',      slotLabel: 'B' },
];
```

The Zero fetches this endpoint at startup and merges the result into
`NFC_CARD_MAP`, so the server is the authoritative source when reachable.
`pair_config.py` / the built-in fallback take effect only when the server is
unavailable.

---

## 7c — `POST /api/guesses` fallback path via `slotLabel`

### Schema (`game-flow.controller.ts`)

`slotLabel` added as an optional field to `submitGuessSchema`:

```ts
const submitGuessSchema = z.object({
  gameId:        objectIdSchema,
  questionId:    objectIdSchema,
  guesserUserId: objectIdSchema.optional(),
  pairName:      z.string().min(1).optional(),
  badgeId:       objectIdSchema.optional(),
  cardUid:       z.string().min(1),
  slotLabel:     slotLabelSchema.optional(),   // NEW
});
```

### `SubmitGuessInput` type (`game-data.repository.ts`)

```ts
export type SubmitGuessInput = {
  gameId:        string;
  questionId:    string;
  guesserUserId?: string;
  pairName?:     string;
  badgeId?:      string;
  cardUid:       string;
  slotLabel?:    SlotLabel;   // NEW
};
```

### `submitGuess` decision logic (as built)

The MongoDB assignment lookup is retained and takes **precedence**. The
fallback only fires when no active assignment exists:

```
1. Look for active GameNfcCardGroupAssignment for this game.
2. If found  → MongoDB path: resolve slotLabel via NfcCard document (existing).
3. If not found AND caller supplied slotLabel
             → Fallback path: use the Zero-supplied slotLabel directly.
4. If not found AND no slotLabel
             → 400 "No active NFC card group is assigned to this game
               and no slotLabel was provided."
```

The `resolvedSlotLabel` variable then feeds the same `AnswerOption` lookup
and `Guess.create` call regardless of which path was taken:

```ts
const answerOption = await AnswerOption.findOne(
  { questionId: asObjectId(input.questionId), slotLabel: resolvedSlotLabel },
  ...
);
```

---

## 7d — `GameRefereePanel`: NFC card group section

### New server endpoint

`GET /api/games/:gameId/nfc-card-group` returns the active assignment for the
game (or `null`):

```json
{ "group": { "groupId": "…", "name": "Demo Set", "cardCount": 2 } }
{ "group": null }
```

The controller queries `GameNfcCardGroupAssignment` for the active record,
then fetches the `NfcCardGroup` name and counts active `NfcCard` documents.

### `assignedByUserId` made optional

The attach endpoint (`POST /api/games/:gameId/nfc-card-groups/:groupId/attach`)
previously required `assignedByUserId`. It is now optional; the repository
substitutes the all-zero placeholder ObjectId (`000000000000000000000000`)
when absent, satisfying the Mongo `required: true` constraint without needing
an authenticated user in the demo.

### `GameRefereePanel` — new section (as built)

The panel renders a new "NFC card group" block between the Bound pairs section
and the Game state section:

```
┌─ NFC card group ──────────────────────────┐
│ 💳 Demo Set  (2 cards)                     │  ← when assigned
│ [Reassign demo group]                      │
│                                            │
│ No group assigned.                         │  ← when not assigned
│ [Assign demo group]                        │
└────────────────────────────────────────────┘
```

- Fetches `GET /api/games/:id/nfc-card-group` on mount and after any
  assignment action.
- **Assign demo group** / **Reassign demo group** button:
  1. `POST /api/games/nfc-card-groups` with the two seed cards → receives
     `{ groupId }`.
  2. `POST /api/games/:id/nfc-card-groups/:groupId/attach` with `{}` (no
     `assignedByUserId` required).
  3. Re-fetches the assignment and updates the display.
- Inline `Loader2` spinner while in-flight; inline error on failure.
- Uses `CreditCard` Lucide icon.

---

## Acceptance criteria

- [x] Zero sends `slotLabel` alongside `cardUid` in `POST /api/guesses`.
- [x] `POST /api/guesses` succeeds without a MongoDB card-group assignment
      when `slotLabel` is supplied by the Zero.
- [x] `GET /api/nfc-cards` response includes `slotLabel` for each card.
- [x] `submitGuess` still uses the MongoDB path when an active assignment
      exists (regression: existing tests still pass).
- [x] A referee can assign the demo card group from `GameRefereePanel` with
      one click, without needing a separate management UI.
- [x] `GET /api/games/:gameId/nfc-card-group` returns the active assignment
      name + card count, or `null` when none is assigned.

### Pending hardware verification

These items are implemented but require a live Zero + badge to confirm:

- [ ] Tapping a physical NFC card with the Zero during an open question
      results in a successful `POST /api/guesses` with the correct `slotLabel`
      (no MongoDB card group needed).
- [ ] The Zero logs `slotLabel=<value>` next to the `TAG:` relay line when a
      known card is scanned.
- [ ] When the card UID is not in `NFC_CARD_MAP`, the Zero sends
      `slotLabel=None` and the server returns a 400 (no match found).
