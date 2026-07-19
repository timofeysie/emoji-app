# Step 5 — Games CRUD + Read API

Status: **pending**

This step adds the missing server read (`GET`) endpoints for games and questions, then
builds the React CRUD screens so a referee can create and browse games before touching
the live referee controls (which land in Step 6).

---

## Context

Steps 1–4 built all the server _write_ paths (`POST /api/games`, `POST /api/questions`,
`POST /api/games/:id/state`, `POST /api/questions/:id/state`, `POST /api/games/:id/pairs`,
`POST /api/games/:id/join`, `POST /api/guesses`) and the physical-device layer (Zero + Pico).

The React app currently has:

- `BadgesView` — live badge status only (no game awareness)
- No view for listing, creating, or inspecting games or questions
- No `GET /api/games` or `GET /api/games/:id` endpoints on the server

A referee today must create a game via raw `curl` / Postman calls and has no way to see
what games exist or which questions they contain. This step closes that gap.

---

## What is already done

| Feature | Status |
| --- | --- |
| `POST /api/games` — create game | ✅ done (Step 1) |
| `POST /api/questions` — create question | ✅ done (Step 1) |
| `POST /api/games/:id/state` — lifecycle transition | ✅ done (Step 1) |
| `POST /api/games/:id/pairs` — bind a pair | ✅ done (Step 1) |
| `GET /api/pairs/:pairName` — pair binding snapshot | ✅ done (Step 1) |
| `GET /api/badges` — badge snapshot | ✅ done (pre-existing) |
| `GET /api/version` — expected versions | ✅ done (Step 1) |

---

## 5a — Server: add read endpoints

Three new `GET` endpoints in `GameFlowController` (or a dedicated `GamesReadController`).

### `GET /api/games`

Returns a list of all games, newest first.

```ts
// Response shape
{
  games: Array<{
    id: string;
    title: string;
    state: 'ready' | 'lobby' | 'active' | 'paused' | 'completed' | 'cancelled';
    createdByUserId: string;
    createdAt: string;          // ISO
    startedAt?: string | null;
    endedAt?: string | null;
    questionCount: number;      // derived
  }>
}
```

### `GET /api/games/:gameId`

Returns full game detail including its questions and bound pairs.

```ts
// Response shape
{
  id: string;
  title: string;
  state: string;
  createdByUserId: string;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  questions: Array<{
    id: string;
    text: string;
    sequence: number;
    mode: string;
    state: 'open' | 'closed';
    answerOptions: Array<{
      slotLabel: string;
      text: string;
      isCorrect: boolean;
      sequence: number;
    }>;
  }>;
  boundPairs: Array<{        // from pairBindings collection
    pairName: string;
    joined: boolean;
    controllerId?: string;
  }>;
}
```

### `GET /api/games/:gameId/questions`

Returns just the questions for a game (used to refresh the list without reloading the
full game detail). Same `questions[]` shape as above.

### Repository additions

Add methods to `GameDataRepository`:

```ts
listGames(): Promise<GameSummary[]>
getGameDetail(gameId: string): Promise<GameDetail | null>
getQuestionsByGameId(gameId: string): Promise<QuestionDetail[]>
```

---

## 5b — React: `GamesView`

New route `/games` added to `app.tsx`. Listed in `AppHeader` navigation alongside
Badges, Lights, Scenes.

### Layout

```
┌────────────────────────────────────────────────────┐
│ Games                              [+ New Game]     │
├────────────────────────────────────────────────────┤
│ ○ My Quiz Night     lobby    2 questions   [Open →] │
│ ○ Round 2 Ready     ready    4 questions   [Open →] │
│ ● Completed Game    completed 3 questions  [Open →] │
└────────────────────────────────────────────────────┘
```

- State chip: colour-coded pill (`ready` = grey, `lobby` = amber, `active` = green,
  `completed` = muted).
- **[+ New Game]** opens a dialog with `title` and `createdByUserId` fields (userId
  is pre-filled from the profile store or entered as a string for the demo).
- **[Open →]** navigates to `GameDetailView` (`/games/:gameId`).
- List is fetched from `GET /api/games` on mount; refreshed after creating a game.

### File: `client/src/app/views/GamesView.tsx`

Key state:

```ts
const [games, setGames] = useState<GameSummary[]>([]);
const [loading, setLoading] = useState(true);
const [createOpen, setCreateOpen] = useState(false);
```

`GameSummary` type mirrors the `GET /api/games` response item.

---

## 5c — React: `GameDetailView`

Route `/games/:gameId`.

### Layout

```
┌──────────────────────────────────────────────────────┐
│ ← Games    My Quiz Night                  [lobby]    │
├──────────────────────────────────────────────────────┤
│ Questions                        [+ Add Question]    │
│ ─────────────────────────────────────────────────── │
│ Q1  What colour is the sky?   standard  [closed]     │
│     A: Blue ✓  B: Red  C: Green  D: Yellow           │
│ Q2  Capital of France?        standard  [closed]     │
│     A: London  B: Paris ✓  C: Berlin  D: Rome        │
└──────────────────────────────────────────────────────┘
```

- **[+ Add Question]** opens a `CreateQuestionDialog` capturing: text, sequence, mode,
  and 2–5 answer options (each with text, slotLabel A–E, isCorrect). On submit calls
  `POST /api/questions` and refreshes the question list.
- Question row shows slot labels, answer texts, and a green checkmark on the correct
  option.
- Clicking a question row expands its answer options (accordion / inline).
- State pill on the game header is purely informational at this step; lifecycle
  controls land in Step 6.

### File: `client/src/app/views/GameDetailView.tsx`

Key data loading:

```ts
// On mount and after mutations
const data = await fetch(`/api/games/${gameId}`).then(r => r.json());
// data: { id, title, state, questions[], boundPairs[] }
```

---

## 5d — Navigation + routing

Changes to `app.tsx`:

```tsx
import { GamesView } from './views/GamesView';
import { GameDetailView } from './views/GameDetailView';

// Inside Routes:
<Route path="/games" element={<GamesView />} />
<Route path="/games/:gameId" element={<GameDetailView />} />
```

Changes to `AppHeader.tsx` — add a **Games** nav link between **Badges** and
whatever currently follows it.

---

## What this step does NOT include

The following are explicitly deferred to Step 6:

- Referee lifecycle controls (open / start / end game, open / close question)
- Pair binding UI (assigning a `pairName` to a game)
- Live WebSocket game events in `BadgesView`
- Join status and NFC tag activity display

---

## Acceptance criteria

- [ ] `GET /api/games` returns all games (newest first), with `questionCount`.
- [ ] `GET /api/games/:gameId` returns full detail including `questions[]` and
      `boundPairs[]`.
- [ ] `GET /api/games/:gameId/questions` returns the questions list alone.
- [ ] `/games` route lists all games with state chips and question counts.
- [ ] **+ New Game** dialog creates a game and adds it to the list without a full-page
      reload.
- [ ] **Open →** navigates to `/games/:gameId`.
- [ ] Game detail shows questions in sequence order with answer options and correct
      answer marked.
- [ ] **+ Add Question** dialog creates a question and adds it to the list.
- [ ] All new endpoints have at least one unit test in the spec file.
