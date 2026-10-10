# Playwright end-to-end tests: plan

Status: **Phases 1–3 done** (2026-10-10): 22 tests, all passing locally
in about 15 s. Phase 4 waits for Step 1c. Run them with `npm run test:e2e`
(local Mongo replica set required, see `mongo.md`).

### What changed from the plan while building it

- **No `global-setup.ts`.** Playwright starts `webServer` *before*
  `globalSetup`. Dropping the database there would also drop the indexes
  the server has just synced. Instead `playwright/reset-e2e-db.mjs` runs
  first in the API server's command. It checks Mongo is reachable and is a
  replica set (it fails fast with a pointer to `mongo.md` if not), refuses
  any database not named `*-e2e`, and drops it.
- **`VITE_WS_URL` is set too.** In dev, `client/src/app/shared/ws-url.ts`
  connects straight to `ws://localhost:3000/ws`, not through the Vite
  proxy. Without `VITE_WS_URL=ws://localhost:3100/ws`, the e2e page would
  listen to the dev server's events and never see its own scans.
- **Viewport 1440×900.** At Playwright's default 1280×720, the chat panel
  leaves the rounds column so narrow (`xl:` breakpoint, about 130 px) that
  round text renders 0 px wide. That's an app layout issue at exactly
  1280 px, worth fixing separately.
- **Unassign doesn't bring the warning back for a guess already made.**
  The first-binding rule means an ended binding still covers the badge's
  earlier guesses. The UI tests cover both sides: unassigning after the
  guesses keeps the warning clear, and a guess made *after* unassigning
  brings it back for that badge.
- **Bug found and fixed:** after the referee assigned a player through
  the picker and then pressed ✕, the picker still showed the old player.
  Radix `Select` falls back to its own internal value when `value` is
  `undefined`. `PlayerBindingsPanel` now passes `''`, which shows the
  placeholder again.
- Extra script: `npm run typecheck:e2e`.

Goal: browser and API tests that drive the emoji-app game against a real
server and a real local MongoDB. They start with the xAPI Step 1a work
(players, badge → player bindings) and grow into the game flow and the
Step 1c export.

Related:

- [`../db/mongo.md`](../db/mongo.md): local Mongo (single-node replica
  set), `.env`, and the `curl` walkthrough these tests automate.
- [`../xAPI/xapi-export-plan.md`](../xAPI/xapi-export-plan.md): Step 1a
  (done), 1b/1c (next).
- [`../manual-tests.md`](../manual-tests.md): the manual flows worth
  turning into tests.
- [`milestone-3-smoke-tests.md`](./milestone-3-smoke-tests.md): staging
  smoke tests (out of scope here, see "Later").

---

## Same repo or a separate repo?

**Same repo: a top-level `playwright/` directory in `emoji-app`.** A
separate repo isn't required, and it would make things worse:

- **Tests track the code they test.** The tests use the app's routes,
  API shapes (`/api/games/:id/player-bindings`) and UI labels. In the same
  repo, a PR that changes a route can change its test in the same commit.
  A separate repo would need version pinning and cross-repo coordination
  for every change.
- **One install, one `.env`, one Mongo.** Playwright reuses the root
  `node_modules`, the server build (`npm run build:server`) and the local
  database from `docs/db/mongo.md`.
- **CI fits naturally.** A future workflow checks out one repo, builds,
  and runs `npm run test:e2e`.
- `emoji-app` is already its own git repo with npm workspaces (`apps/*`,
  `packages/*`). `playwright/` doesn't need to be a workspace: it has no
  package of its own to publish or build. `@playwright/test` goes in the
  root `devDependencies`, and the folder sits beside `client/` and
  `server/`.

Why `playwright/` and not `apps/` or `client/`:

- `apps/` holds separate products (land-grab).
- `client/` gets typechecked and bundled by Vite.

A top-level folder keeps the e2e config and tsconfig separate from both.

---

## Layout

```text
playwright/
  playwright.config.ts      # projects, webServer, baseURL, workers
  tsconfig.json             # extends ../tsconfig.base.json; types: @playwright/test
  reset-e2e-db.mjs          # drops the e2e database before the API server starts
  fixtures/
    api.ts                  # typed API helpers (createGame, bindStation, guess, …)
    game.ts                 # test.extend fixtures: a game in a given state
  tests/
    smoke.spec.ts
    players.api.spec.ts
    player-bindings.api.spec.ts
    player-bindings.ui.spec.ts
    game-flow.ui.spec.ts
```

Root `package.json` scripts:

```json
"test:e2e": "playwright test --config playwright/playwright.config.ts",
"test:e2e:ui": "playwright test --config playwright/playwright.config.ts --ui",
"test:e2e:report": "playwright show-report playwright/playwright-report"
```

`.gitignore` additions:

```text
playwright/playwright-report/
playwright/test-results/
playwright/.auth/
```

---

## How a test run works

### Servers: separate ports and a separate database

Tests must never write into your dev data. Locally that's the
`emoji-app` database on `localhost:3000`/`5200`. So Playwright's
`webServer` starts its **own** pair of processes:

| Process | Port | Command (sketch) |
| --- | --- | --- |
| API server | 3100 | `node playwright/reset-e2e-db.mjs && npm run build:server && node dist/server/main.js` with `PORT=3100`, `MONGODB_URI=mongodb://127.0.0.1:27017/emoji-app-e2e?directConnection=true`, `DISABLE_AUTH=true`, `OPENAI_API_KEY=e2e-dummy` |
| Vite client | 5210 | `vite --config client/vite.config.ts --port 5210` with `VITE_API_TARGET=http://localhost:3100`, `VITE_WS_URL=ws://localhost:3100/ws`, `VITE_DISABLE_AUTH=true` |

- Same Mongo server, **different database** (`emoji-app-e2e`).
  `reset-e2e-db.mjs` drops it before each run. Indexes come back when the
  server starts (`syncIndexes()`, see `mongo.md`).
- Set `reuseExistingServer: false` for the API server, so a run never
  attaches to your dev server and its dev database by accident.
- One small app change is needed: `client/vite.config.ts` hard-codes the
  proxy target `http://localhost:3000` (and `ws://localhost:3000`). Make
  both read `process.env.VITE_API_TARGET`, defaulting to today's value.
  Dev behaviour is unchanged.

Alternative, kept in reserve: build the SPA and let Express serve it, as
the Docker image does (`dist/client` → `client-react/` next to the server
bundle). That's one process and closer to production, but slower to
iterate and needs a copy step locally. Worth it later for CI.

### State: each test makes its own game

- **No shared fixtures in the database.** Each test creates its own game
  through the API, with a unique title and **unique station and badge
  names** (e.g. `st-<testId>`, `red-<testId>`). The server keeps live
  station state **in memory** (`BadgeStateService`) and rejects badge names
  that belong to another station. Unique names stop tests interfering.
- **Players are a global roster** (no `orgId` yet), so tests use unique
  first names and never assert the *whole* player list, only that their
  own players are in it.
- **`workers: 1` to start.** It's simplest while the in-memory state is
  shared. Raise it once the tests prove independent.

### Stations without hardware

Tests play the station over HTTP, like `docs/db/mongo.md`'s walkthrough:

| Station action | API |
| --- | --- |
| Bind station + roster to a game | `POST /api/games/:id/pairs` `{ pairName, badgeNames }` |
| Scan a card | `POST /api/guesses` `{ gameId, questionId, pairName: station, badgeName, cardUid, slotLabel }`. With no NFC card group attached, the server trusts `slotLabel`. |
| Appear "live" in the referee panel | `POST /api/status` (station heartbeat; only needed for UI tests that check live/offline chips) |

`fixtures/api.ts` wraps these in typed helpers on Playwright's `request`
context. `fixtures/game.ts` builds on them, e.g.
`completedGameWithGuesses({ badges: ['red','blue'], answers: { red: 'A', blue: 'B' } })`.
Step 1a tests need that setup over and over.

Gotchas the helpers handle (found while writing `mongo.md`):

- A new round is `draft`. Start Game auto-opens only `closed` rounds, so
  open the round explicitly (`POST /api/questions/:id/state`).
- Play Again (`completed → ready`) **deletes the game's guesses and
  station bindings**. Tests that replay a game must expect that.

### Selectors

- Prefer role/label queries (`getByRole('button', { name: … })`,
  `getByLabel(…)`). `PlayerBindingsPanel` already has `aria-label`s on its
  unassign buttons and new-player input.
- Radix `Select` renders a `combobox` trigger and `option`s in a portal:
  click the trigger, then `getByRole('option', { name: /Mia/ })`.
- Add `data-testid` only where no accessible name exists, such as one
  badge's row in the Players panel (`data-testid="player-binding-<badge>"`).
  There are none in the client today.

### Auth

Prototype: `DISABLE_AUTH=true` / `VITE_DISABLE_AUTH=true`, so there's no
login. When Step 0 lands (Cognito required on `/api/*`), add a setup
project that logs in a Cognito test referee once and saves
`storageState` to `playwright/.auth/referee.json`. API helpers then send
its bearer token.

---

## Test plan

### Phase 1: foundation (first PR)

- Install `@playwright/test`, then `npx playwright install chromium`.
  Chromium only, for now.
- Add the config, tsconfig, DB reset script, the `VITE_API_TARGET` change,
  the scripts and the `.gitignore` lines.
- `smoke.spec.ts`:
  - `GET /api/version` returns 200 (proves the API server is up).
  - The `/games` page renders, and a game created through the API
    appears in the list (proves the client → proxy → server → Mongo path
    works).
- Prerequisite: local Mongo is running as a replica set (`mongo.md`). The
  run fails fast with a clear message if `127.0.0.1:27017` isn't
  reachable or isn't a replica set.
- [x] Done.

### Phase 2: Step 1a (players and bindings)

**API (`players.api.spec.ts`, `player-bindings.api.spec.ts`).** Fast and
precise. These are the behaviours unit tests can only fake:

- [x] `POST /api/players` → 201 with `externalId` as a UUID v4 and a
      `Player XXXX` label.
- [x] `POST /api/players` with `email` (or any extra field) → 400 (D4).
- [x] Completed game with guesses from `red` and `blue` and no bindings →
      `missingBadges: ['blue','red']`.
- [x] Bind both → `missingBadges: []`; first bindings have reason
      `initial`.
- [x] **Swap:** bind `red` to the player holding `blue`.
  - `blue` loses its player (one active badge per player, enforced by the
    real unique index).
  - The new row's reason is `swap`.
- [x] **Time range:** bind `red`, guess round 1, unbind `red`, guess
      round 2 → `red` is missing again (only the round-2 guess is
      uncovered).
- [x] Bind after the game ends → earlier guesses are covered (the
      first-binding rule).
- [x] Unknown badge → 404; unknown player → 404; unbind a badge with no
      player → 404.
- [x] Play Again → `missingBadges` is empty because the guesses are gone,
      while `playerBindings` remain. This pins today's behaviour, so the
      Step 1c decision about it is deliberate.

**UI (`player-bindings.ui.spec.ts`).** The referee's path through the
Players panel on `/games/:id`:

- [x] A completed game with unbound guesses shows the amber "Guesses
      without a player: …" warning, naming the badges.
- [x] Add a player with the "First name or nickname" form. They then
      appear in each badge's picker with their `Player XXXX` label.
- [x] Assign players through the pickers. The warning disappears.
- [x] Unassign (✕) → the warning returns for that badge, **for guesses
      made after the unassign**. Earlier guesses stay covered (first-binding
      rule), so unassigning on a completed game leaves the warning clear.
- [x] A server error (e.g. a 404 forced through `page.route`) shows inline
      in the panel and doesn't crash it.

### Phase 3: game flow regression

These cover existing behaviour, so later work (1b/1c, Step 0) can't
quietly break it. They come from `manual-tests.md`:

- [x] Create a game in the UI, add a round (dialog), and see "1 Round".
- [x] Bind a station with two badges; Open for Joining → Start Game →
      round opens. (A UI-made round is `draft` too, so Start Game doesn't
      open it; the test clicks the round's **Open**.)
- [x] Two simulated scans → the guess chart shows correct/wrong per badge
      (cell titles `slot A · correct` / `slot B · wrong`); End Game
      → state chip shows `completed`.
- [x] Scores (`GET /api/games/:id/scores`) match the scans.

### Phase 4: Step 1c (export), when built

- [ ] The "Export to LRS" action is disabled or errors while
      `missingBadges` is non-empty, and the error names the badge.
- [ ] Export sends the expected statements. The export runs **on the
      server**, so `page.route` can't see it. Point `XAPI_LRS_ENDPOINT` at
      a **stub LRS**: a tiny HTTP server started by the Playwright config
      that records `PUT/POST /statements` and returns 200/204, or 409 on
      demand. Then assert:
  - no `mbox` and no first name anywhere in the statements (D3);
  - one `answered` per guess and one `scored` per player;
  - re-export is idempotent (same statement IDs).
- [ ] Separately and by hand: one export to Veracity `emojiapp-dev`
      (`LRS.md`). Not in the automated suite, to keep runs offline and
      free of keys.

---

## CI (later, not Phase 1)

- New workflow `.github/workflows/e2e.yml` on PRs touching `client/**`,
  `server/**` or `playwright/**`.
- Mongo **must be a replica set** (transactions, see `mongo.md`). GitHub
  service containers can't easily pass `--replSet`, so either:
  - run `docker run … mongo:7 --replSet rs0` plus `rs.initiate` as a step;
    or
  - use a maintained action that starts a replica set.
- `npx playwright install --with-deps chromium`, run `npm run test:e2e`,
  and upload `playwright-report/` as an artifact on failure.
- Consider the "Express serves the built SPA" mode there (one process,
  production-like).

## Later / out of scope for now

- Staging smoke tests against `emoji-staging.kogs.link`. Possible with a
  second config (`baseURL` = staging, read-only tests), but staging is
  open and shared (`security.md` guardrails), so keep e2e writes local.
- Simulating stations over the WebSocket (`/ws`) for live chips and
  readiness. HTTP covers Step 1a and the guess flow.
- Firefox/WebKit projects, visual snapshots, land-grab apps.

---

## Open questions

1. **Phase 3 now, or after 1c?** Recommendation: do the API half of Phase
   2 first, since it gives the most confidence per test. Then the Players
   UI, then Phase 3.
2. **Express-served build vs Vite for local runs.** Recommendation: Vite
   (faster, hot reload while debugging with `--ui`); the built SPA in CI.
3. **Stub LRS location** (Phase 4): a Playwright `webServer` entry or a
   `global-setup` process. Decide when 1c's client exists.
