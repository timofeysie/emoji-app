# Game flow — running a badge game end to end

Status: **current** (2026-10-16). This is the working checklist for running a
game with the emoji-app, a Zero controller and its Pico badges, from an
empty database to statements in the LRS. It was written after the first
played and exported Ch. 26 Korean vocabulary game.

Related:

- [`game-planning.md`](./game-planning.md): why games are built this way,
  and the Phase 0 plan this flow comes from
- [`../real-time-game/game-modes.md`](../real-time-game/game-modes.md):
  Mode 1 / Mode 2 topologies, the Zero button map and the full
  three-platform display table (what every badge, LCD and app state looks
  like)
- [`../db/mongo.md`](../db/mongo.md): running MongoDB locally
- [`../xAPI/xapi-export-plan.md`](../xAPI/xapi-export-plan.md) and
  [`../xAPI/security.md`](../xAPI/security.md): what the export sends and
  why players are pseudonymous

---

## Who uses what

| Role | Device | Shows | Used for |
| --- | --- | --- | --- |
| Referee | Laptop, game page (`/games/:gameId`, "edit mode") | Referee controls, rounds, bound pairs, players panel | Bind stations, open the lobby, start, open rounds, end, assign players, export |
| Referee | Zero controller | 1.44" LCD | Enter game mode, **KEY1** to join the lobby, **KEY1 / KEY3** for ready / wait between rounds |
| Players | Shared browser screen, play view (`/games/:gameId/play`, "view mode") | "Round N", the prompt and options `A`–`D` | Reading the question |
| Players | Pico badge (one per player in Mode 2) | 8×8 matrix | Scanning an answer card; seeing correct / wrong |
| Players | Answer cards `A`–`D` | Printed letter | The answer |

A **station** is one Zero (its `PAIR_NAME`, for example `power-cable`). In
Mode 2 a station has several badges (`BADGE_NAMES`, for example
`power-cable` and `black`), and **each badge is one player** with its own
guesses and score.

---

## One-time setup

### Local server on the wifi

Running locally costs nothing and needs no `terraform apply`.

1. MongoDB 7 running locally as a replica set (`../db/mongo.md`).
2. `emoji-app/.env`:
   - `MONGODB_URI=mongodb://127.0.0.1:27017/emoji-app?directConnection=true`
   - `HOST=0.0.0.0`, so the Zero can reach the server over the wifi
     (`localhost` only accepts connections from the same machine)
   - `XAPI_LRS_ENDPOINT`, `XAPI_LRS_KEY`, `XAPI_LRS_SECRET` for the export
3. `npm run dev` from `emoji-app/`. The server runs on `:3000`, the app on
   `:5200`. Allow incoming connections for `node` if macOS asks.
4. Open the app from any device on the wifi at `http://<laptop-ip>:5200`.

### Controller and badges

- `rainbow-connection/python/emoji-os/emoji-os-zero.py`: set
  `SERVER_URL = "http://<laptop-ip>:3000"`. The laptop's IP can change
  (`ipconfig getifaddr en0` on a Mac), so check it before each session.
- `pair_config.py` on the Zero: `PAIR_NAME` (the station) and
  `BADGE_NAMES` (its badges). Each Pico's own `pair_config.py` has its
  `PAIR_NAME` set to one of those badge names.
- Copy the latest `emoji-os-zero.py`, `emoji-os-pico.py` and the pair
  configs to the devices and restart them.

### Answer cards

Only the card's hardware UID is read. Nothing is written on the card. What
a card *means* comes from two maps keyed by UID:

- `SEED_NFC_CARDS` in `server/src/nfc-card.service.ts`. The Zero loads this
  from `GET /api/nfc-cards` at startup, and it **replaces** the local map.
- `NFC_CARD_MAP_LOCAL` in `pair_config.py`, used only when the server is
  unreachable.

| Card UID | Printed | `slotLabel` | Use |
| --- | --- | --- | --- |
| `2B:73:B8:08` | 12 / A | `A` | Answer card |
| `4B:71:B8:08` | 11 / B | `B` | Answer card |
| `DB:69:B8:08` | 10 / C | `C` | Answer card |
| `1B:5D:B8:08` | D | `D` | Answer card |
| `5B:6F:B8:08` | R12 Monkey | none | NFC test card. Counts as wrong in a game |
| `DB:93:B7:08` | W3 Clown | none | NFC test card. Counts as wrong in a game |

---

## Creating the Ch. 26 Korean vocabulary game

Games are generated from the chapter's vocabulary list by a rule-based
generator. No AI and no API key are involved (see `game-planning.md` →
"Cheap generator").

With `npm run dev` running, in a second terminal from `emoji-app/`:

```bash
node scripts/create-vocab-game.mjs --dry-run   # preview, creates nothing
node scripts/create-vocab-game.mjs             # create the game
```

Use `node scripts/create-vocab-game.mjs` while the dev server is running.
`npm run create:vocab-game` does the same but rebuilds the server first,
which restarts the running dev server partway through. Use the npm command
when the server is stopped, or after changing generator code.

| Option | Default | Notes |
| --- | --- | --- |
| `--source` | `server/src/games/content/chapter26Data.json` | Any language-learning-app `chapterNNData.json` |
| `--skills` | `reading,writing` | Questions alternate in this order |
| `--count` | `10` | One question per vocabulary word; ch. 26 has 28 words |
| `--seed` | `26` | Same seed = same questions and option order. Change it for a new game |
| `--title` | `Ch. 26 vocab: reading + writing` | |
| `--server` | `http://localhost:3000` | Use the server laptop's address when it's another machine |

The game appears on the Games screen with 10 rounds:

- **Reading**: the Korean word, pick the English meaning. Wrong answers
  are meanings of other chapter words (verbs for a verb, nouns for a
  noun).
- **Writing**: the English meaning, pick the correct Korean spelling.
  Wrong answers change one syllable of the word, the same syllable in all
  three. A few are real words from outside the chapter (`벗다`, `굴리다`).
  That's accepted for the pilot.

```text
Question 1 (reading): 재다           Question 4 (writing): tonsil
  A. to show                           A. 편도서
  B. to measure   ✓                    B. 편도섬
  C. to lie down                       C. 편도선   ✓
  D. to be serious                     D. 편도순
```

Code: `server/src/games/generators/` (`vocab-choice.ts`, `hangul.ts`,
`seeded-random.ts`, with tests) and `scripts/create-vocab-game.mjs`.

---

## Running a game

Steps 2 and 3 can happen in either order. Binding a station sends its Zero
the game's current state, so a station bound after "Open for Joining" goes
straight to the join choice.

| # | Referee does | Zero / badges | Server state |
| --- | --- | --- | --- |
| 1 | Open the game's edit page on the laptop | — | `draft` → `ready` (automatic on opening the page) |
| 2 | **Invite a pair**: bind the station (e.g. `power-cable`). Optionally **Assign demo group** (attaches the "Quiz Cards A-D" group) | Zero in game mode shows `G` (it now knows the game ID) | `ready`, station bound, not joined |
| 3 | **Open for Joining** | Zero and badges show the join choice (`KEY1 JOIN  KEY3 NO`) | `lobby`. Referee chip: `waiting to join` |
| 4 | Press **KEY1** on the Zero | Every connected badge joins (white outline) | Chip: `ready to start` |
| 5 | Open the play view (`/games/:gameId/play`) on the players' screen | — | — |
| 6 | **Start Game** | Green square | `active`. Chip: `joined` |
| 7 | **Open** round 1 on the game page. Only needed on the game's first run, see below | `?` on badges, NFC armed | Round 1 `open`. The play view shows the prompt and `A`–`D` |
| 8 | Players scan an answer card | Badge: green outline (card read), then **blue circle** (correct) or **red X** (wrong) | One guess per badge per round |
| 9 | Round closes when every joined badge has answered, or the referee clicks **Close** | `KEY1 READY  KEY3 WAIT` | Round `closed`. Chip: `awaiting response`, then `ready` / `wait` |
| 10 | Players press **KEY1 / KEY3** (ready / wait). Referee **Opens** the next round | `?` again | Next round `open` |
| 11 | After the last round, **End Game** | Fireworks (winner) / rain (loser) | `completed`. Finishing round 10 does **not** end the game |

Notes:

- **Round 1 on a first run.** Generated and UI-made rounds start as
  `draft`. Start Game auto-opens only a `closed` round, so on a game's
  first run the referee opens round 1. After **Play Again** or
  **Restart**, rounds are reset to `closed` and Start Game opens round 1
  automatically.
- **The green outline is not "correct".** It only means the card was read.
  Correct / wrong comes after the Zero gets the server's reply.
- **Pause / Resume** keep the current display. **Cancel** is available from
  the lobby or while paused.
- Only one round can be open at a time.

---

## After the game: export to the LRS

Statements are sent only when the referee exports a **completed** game.
Nothing is sent while playing.

1. **End Game** (state must be `completed`).
2. In the **Players** panel on the game page:
   1. Type a first name or nickname under **"First name or nickname"** and
      click **Add**. The **Assign player…** dropdowns stay disabled until
      at least one player exists. With children, use a nickname or the
      badge name. No surnames.
   2. Pick a player for every badge listed in the warning ("Guesses
      without a player: …"). Badges that made no guesses, for example a
      badge that didn't join, can stay unassigned: they're left out of the
      export.
3. **Export to LRS** becomes enabled. Click it.

The LRS receives:

- one `answered` statement per guess, with `success` (correct or not),
  `duration` (time from the round opening to the scan), the question text
  and options, and the chosen slot
- one `scored` statement per player, with correct / total. A badge with a
  player but no guesses gets a 0 score. A badge with neither gets nothing

Players are identified only by a random ID. Their name never leaves the
database. Exporting the same game again is safe: statement IDs are stable,
so nothing is duplicated.

---

## Playing again

- **Play Again** (from `completed`) or **Restart** (from `cancelled`) puts
  the game back to `ready`. It **clears the station bindings and guesses**
  and resets rounds to `closed`.
- So after a replay, **bind the station again** (step 2), before or after
  Open for Joining.
- For a different set of questions, generate a new game with another
  `--seed`.

---

## Known issues and troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Zero shows `G` but no join option, while the referee chip says `waiting to join`; or Zero log `TAG … ignored — no active game/question (gameId=None …)` | The Zero missed the game's state: it was not connected when the station was bound, or the server predates the bind snapshot (2026-10-16) | Restart `emoji-os-zero.py`. On reconnect it fetches `GET /api/pairs/:pairName` and shows the lobby. Then KEY1 |
| Every scan of an answer card is wrong | Card has no `A`–`D` `slotLabel` in the server seed (the Zero uses the server's map when it's reachable), or the game has an old card group attached | Check `SEED_NFC_CARDS`. Re-click **Assign demo group** to attach "Quiz Cards A-D" |
| Zero can't reach the server | `HOST=localhost` in `.env`, wrong `SERVER_URL` IP, or macOS firewall | `HOST=0.0.0.0`, check the laptop IP, allow `node` |
| No statements in the LRS | Game not `completed`, not exported, or a badge with guesses has no player | End Game → assign players → Export to LRS |
| **Assign player…** is greyed out | No players exist yet | Add one with **First name or nickname** → **Add** |
| Games screen is empty | No game has been generated in this database | Run `node scripts/create-vocab-game.mjs` |

**How the Zero learns its game.** When a station is bound
(`POST /api/games/:gameId/pairs`), the server sends its Zero a
`controller.welcome` with the same snapshot as `GET /api/pairs/:pairName`:
game ID, state, open round and each badge's join and guess state. The Zero
fetches that snapshot itself when it reconnects, and after that it follows the
`game.*` events. Code: `sendSnapshotToStation` in
`server/src/pair-bindings.controller.ts`.
