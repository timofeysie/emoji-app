# Step 6 — Referee Panel + Live Game Dashboard

Status: **pending**

This step makes the React app a functional game control surface. A referee can
bind controllers to a game, drive the full game lifecycle, and open/close
questions — all without touching the command line. The `BadgesView` is extended
to show live game state per badge pair.

---

## Context

Steps 1–5 built all the server endpoints and the basic CRUD screens. What is
still missing is a **control surface** — buttons in the UI that call those
endpoints — and a **live event view** that consumes the game-related WebSocket
events the server already emits.

What exists today:

| Endpoint | Built? | Has UI? |
| --- | --- | --- |
| `POST /api/games/:id/pairs` — bind pair | ✅ | ❌ |
| `POST /api/games/:id/state` — lifecycle | ✅ | ❌ |
| `POST /api/questions/:id/state` — open/close | ✅ | ❌ |
| `GET /api/version` — expected versions | ✅ | ❌ |
| WS `game.state.changed` — emitted by server | ✅ | ❌ |
| WS `controller.joined` — emitted by server | ✅ | ❌ |
| WS `nfc.tagged` — emitted by server | ✅ | ❌ |

---

## 6a — `GameDetailView`: referee sidebar

### Layout

Add a collapsible sidebar (or a second column on wide screens) to
`GameDetailView` that only a referee interacts with. The questions list already
exists on the left; the referee controls sit on the right.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Games    My Quiz Night                              [active]       │
├────────────────────────────────────────┬────────────────────────────┤
│ Questions                              │ Referee Controls           │
│ ─────────────────────────────────────  │ ─────────────────────────  │
│ Q1  What colour is the sky?  [closed]  │ Bound pairs                │
│     A: Blue ✓  B: Red  C: Green        │  green  ✓ joined           │
│     [Open]                             │  white  · not joined       │
│                                        │ [+ Bind a pair]            │
│ Q2  Capital of France?       [open]    │                            │
│     A: London  B: Paris ✓              │ Game state                 │
│     [Close]                            │  ● active                  │
│                                        │ [End Game]  [Pause]        │
└────────────────────────────────────────┴────────────────────────────┘
```

On narrow screens the referee panel stacks below the question list.

### 6a-i — Pair binding

```tsx
// Input + button row under "Bound pairs" list
<Input placeholder="pair name (e.g. green)" value={pairName} onChange={...} />
<Button onClick={() => bindPair(gameId, pairName)}>Bind</Button>
```

- `POST /api/games/:gameId/pairs` body `{ pairName }`.
- On success, re-fetch `GET /api/games/:gameId` so the bound pairs list refreshes.
- Bound pairs list shows each `pairName` with a joined/not-joined chip.
  - Joined chip derived from `boundPairs[n].joined` from the GET response.

### 6a-ii — Game lifecycle buttons

Buttons are conditioned on the current `game.state`:

| Current state | Buttons shown |
| --- | --- |
| `draft` | **Open for Joining** |
| `lobby` | **Start Game** · **Cancel** |
| `active` | **End Game** · **Pause** |
| `paused` | **Resume** · **Cancel** |
| `completed` / `cancelled` | *(none — read-only)* |

Each button calls `POST /api/games/:gameId/state` with the target state and
then re-fetches the game detail so the state chip and button set updates.

Transition map (mirrors server-side `allowedTransitions`):

```
draft      → lobby      (Open for Joining)
lobby      → active     (Start Game)
lobby      → cancelled  (Cancel)
active     → completed  (End Game)
active     → paused     (Pause)
paused     → active     (Resume)
paused     → cancelled  (Cancel)
```

### 6a-iii — Question open/close toggles

Visible and interactive **only** while `game.state === 'active'`. Each question
row gets a button on the right edge:

```
Q1  What colour is the sky?   [closed]   [Open]
Q2  Capital of France?        [open]     [Close]
```

- `POST /api/questions/:questionId/state` body `{ gameId, state: 'open'|'closed' }`.
- On success, refresh the questions list via `GET /api/games/:gameId/questions`.
- Only one question should be open at a time (the server does not enforce this
  today; the UI should disable "Open" on other questions when one is already
  open — warn rather than block).

### 6a-iv — Auto-refresh after mutations

Each successful state-change call re-fetches the game detail endpoint. Do not
require a full page reload. The question list refresh (6a-iii) uses the lighter
`GET /api/games/:gameId/questions` endpoint rather than the full game detail.

---

## 6b — `BadgesView`: live game event stream

### Extend the WS envelope type

```ts
type WsEnvelope =
  | { type: 'status.changed';    payload: StatusChangedEvent }
  | { type: 'emoji.sent';        payload: EmojiSentEvent }
  | { type: 'game.state.changed'; gameId: string; state: string; serverTime: string }
  | { type: 'controller.joined';  gameId: string; pairName: string; controllerId?: string; serverTime: string }
  | { type: 'nfc.tagged';         gameId: string; questionId?: string; pairName?: string;
                                   controllerId?: string; badgeId?: string;
                                   cardUid?: string; slotLabel?: string; serverTime: string };
```

### Game event state

Add a separate piece of React state to `BadgesView` that is updated by game
events (not badge records):

```ts
type GameEventState = {
  gameId: string;
  gameState: string;
  serverTime: string;
};

type JoinEvent = {
  gameId: string;
  pairName: string;
  controllerId?: string;
  serverTime: string;
};

type NfcTagEvent = {
  gameId: string;
  pairName?: string;
  controllerId?: string;
  badgeId?: string;
  cardUid?: string;
  slotLabel?: string;
  serverTime: string;
};
```

The `BadgesView` keeps:

```ts
const [activeGame, setActiveGame] = useState<GameEventState | null>(null);
// pairName → most recent join event
const [joinsByPair, setJoinsByPair] = useState<Record<string, JoinEvent>>({});
// pairName → most recent NFC tag event
const [nfcByPair, setNfcByPair] = useState<Record<string, NfcTagEvent>>({});
```

The WS `onmessage` handler dispatches into these state slices in addition to
the existing badge record updates.

### Badge card game section

Each badge card gains a compact game section below the existing emoji block,
visible when `status.pairName` matches a join or NFC event:

```
┌──────────────────────────────────┐
│ green                            │  ← pairName (bold)
│ badge-88-a2-…                    │  ← badgeId
│ ── BLE connection row ──         │
│ ── Emoji block ──                │
│ ── ── ── ── ── ── ── ──          │
│ Game  My Quiz Night  [active]    │  ← activeGame + state chip
│ Joined at 14:32                  │  ← join event
│ NFC: B · 14:33:12                │  ← last tag (slotLabel + time)
└──────────────────────────────────┘
```

The game section is omitted when no game event has been received for the pair.

---

## 6c — Version outdated badge

`GET /api/version` returns:

```json
{
  "version": "1.1.9",
  "expectedControllerVersion": "0.5.x",
  "expectedPicoVersion": "0.4.x"
}
```

Fetch this once on mount in `BadgesView`. For each badge card, compare
`status.controllerVersion` and `status.picoVersion` against the expected values.
If either is older (simple semver string comparison or prefix match), show a
small warning chip next to the version text:

```
🎮 0.5.2  ⚠ outdated    CPU 0.4.0 ✓
```

The chip uses `bg-amber-100 text-amber-800` styling consistent with the lobby
state chip from `GamesView`.

---

## New file: `GameRefereePanel.tsx`

Extract the referee sidebar into its own component to keep `GameDetailView`
manageable:

```tsx
// client/src/app/views/components/GameRefereePanel.tsx

export function GameRefereePanel({
  game,
  onRefresh,
}: {
  game: GameDetail;
  onRefresh: () => void;
}) { ... }
```

Props:
- `game` — the full `GameDetail` object (title, state, questions, boundPairs).
- `onRefresh()` — called after each mutation; `GameDetailView` re-fetches on
  this callback.

The panel renders:
1. Bound pairs list
2. Bind-pair input + button
3. Lifecycle buttons (conditioned on `game.state`)

Question open/close buttons stay in the question list in `GameDetailView` since
they sit inline with each question row.

---

## Acceptance criteria

- [ ] **Bind pair**: typing a pairName and clicking Bind calls
      `POST /api/games/:id/pairs`; the bound pairs list refreshes; a Zero whose
      `PAIR_NAME` matches receives the `game.opened` event when the game opens.
- [ ] **Open for Joining**: clicking the button transitions game to `lobby`;
      the state chip updates; a Zero in game mode shows "JOIN? KEY2".
- [ ] **Start Game**: transitions to `active`; question Open/Close buttons appear;
      the Zero shows "GAME ON".
- [ ] **Open question**: the target question shows `[open]`; other Open buttons
      are disabled; the Zero shows "SCAN NOW"; the Pico badge shows the '?'
      glyph.
- [ ] **NFC scan**: when a Zero relays a tag, `BadgesView` receives `nfc.tagged`
      and shows the slot label and timestamp on the badge card.
- [ ] **Close question**: question returns to `[closed]`; Pico shows small white
      dot.
- [ ] **End Game**: transitions to `completed`; lifecycle buttons disappear;
      question Open/Close buttons disappear; Pico scrolls "DONE".
- [ ] **controller.joined** WS event: the badge card for the joining pair shows
      "Joined at \<time\>".
- [ ] **Version outdated**: if `controllerVersion` or `picoVersion` on a badge
      card does not match the expected version prefix from `GET /api/version`,
      an amber "outdated" chip is shown next to the version text.
- [ ] All mutations provide inline loading state (button disabled + spinner)
      and show an error message on failure without losing the current view.
