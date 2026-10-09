# xAPI export plan — completed games to an LRS

Status: **planning** — no implementation yet. This is the first concrete
slice carved out of [`xAPI.md`](./xAPI.md); everything else in that doc is
deferred (see "Out of scope" below).

> **Revision:** originally scoped as "export to Moodle." `moodle.md`
> established that Moodle is not itself an LRS and would need either a
> hosted/self-hosted LRS next to it or extra plugin/web-service work. For
> the pilot, a hosted LRS with its own dashboard is enough — Moodle is
> deferred until a real need to show results inside an LMS shows up. See
> "Revision: LRS instead of Moodle" below.
>
> **Revision (2026-10-09):** security and privacy decisions for school
> children were added before any code. The referee is the only person who
> logs in. Players have no email, and statements identify them only by a
> random `externalId`. Routes are split into `/api/*`, `/api/public/*`
> (spectators, share code) and `/api/device/*`. These land as a new
> **Step 0**. See [`security.md`](./security.md).
>
> **Revision (2026-10-09, later): prototype first.** The project's focus is
> the **rules and play flow of the "learning sport"**. This plan is a
> supporting slice. **Step 0 is deferred until the prototype is funded**
> (`security.md` D12), along with consent, tenancy, the audit log,
> AU-hosted LRS and deletion. Steps 1a–1c go ahead for the prototype
> under the [prototype guardrails](./security.md#prototype-guardrails-d12):
> - no real children's personal data
> - export only for consenting adults or pseudonymous playtest players
> - the permanent identity decisions (D2–D4) built in from the start
>
> `emoji-os` stays in `rainbow-connection` (D13).

Related:

- [`xAPI.md`](./xAPI.md) — background notes, standards landscape, and the
  Korean-vocabulary pilot scenario this plan targets first
- [`security.md`](./security.md) — security and privacy requirements for
  Step 1a (player identity, referee-only binding, auth prerequisites, audit)
- [`LRS.md`](./LRS.md) — LRS requirements, statement design detail, and the
  LRS options comparison that Step 1b/1c now follow
- [`moodle.md`](./moodle.md) — why Moodle is deferred, and the options
  (A–F) for if/when it comes back into scope
- [`../real-time-game/multi-badge-plan.md`](../real-time-game/multi-badge-plan.md),
  [`../real-time-game/8-scoring.md`](../real-time-game/8-scoring.md) — the
  game and scoring model this plan reads from
- `server/src/persistence/models.ts`, `game-data.repository.ts`,
  `game-flow.controller.ts` — current schemas and endpoints referenced below

---

## Why this plan exists

`xAPI.md` lays out a large standards landscape (xAPI, cmi5, SCORM, QTI,
OneRoster, LTI) and notes that building all of it at once isn't justified —
there's no real pilot user yet beyond a personal Korean-vocabulary use case.

This plan narrows that down to one validated slice: **take a completed
game's existing scoring data and emit it as xAPI statements, sent to a
Learning Record Store (LRS) and viewed through the LRS's own dashboard**,
so the idea can be checked end-to-end before any of the heavier standards
work — including Moodle itself — is considered.

---

## Revision: LRS instead of Moodle

`moodle.md` found that Moodle is not an LRS: a stock Moodle site has no
public endpoint that accepts externally-generated xAPI statements, and the
plugins that exist run the other direction (Moodle logs → external LRS) or
assume Moodle launches the content (cmi5), which conflicts with the
hardware-badge constraint already noted in `xAPI.md`.

So "export to Moodle" is replaced with **"export to an LRS"**:

- The delivery target (Step 1c) is a standard xAPI-conformant LRS, not
  Moodle. `LRS.md` picks **Veracity** (`lrs.io` free plan, with separate
  `dev`/`sandbox`/`pilot` LRSs). See that doc for the comparison and the
  setup steps.
- The LRS's own statement viewer/dashboard is the "view progress" surface
  for the pilot (`xAPI.md`'s Q: "export to Moodle and start using that to
  view the activity statements") — not a Moodle screen.
- Moodle moves to **out of scope for this plan** (below), alongside cmi5,
  SCORM, QTI, OneRoster, and LTI. `moodle.md` keeps the options (gradebook
  push, custom plugin, cmi5 launch) ready for if a teacher pilot later
  needs results inside an actual LMS.
- Nothing about the statement shape changes because of this — xAPI
  statements go to an LRS either way. `LRS.md` does add detail to the
  statement shape (stable IDs, `context.registration`, actor identifier
  choice) that Step 1b/1c now follow; see "Statement shape" below.

---

## Milestone snapshot

| Milestone | Title | Status |
| --- | --- | --- |
| 0 | Access-control foundations (route prefixes, spectator share codes, device credentials) | ⏸ deferred until funded. Required before any school/children's pilot; not before the prototype (guardrails apply). |
| 1 | Emit xAPI statements for completed games, export to a hosted LRS | 🟡 in progress (Step 1a implemented) |
| 2+ | cmi5, SCORM, QTI, OneRoster, LTI, Moodle (gradebook push / plugin / cmi5 launch) | ⏸ deferred indefinitely — see [Out of scope](#out-of-scope-for-this-plan) |

---

## Locked decisions

These are the design locks for Milestone 1. Do not revisit them unless the
milestone proves them wrong in practice.

| Term | Meaning |
| --- | --- |
| Statement | One xAPI Statement (JSON, xAPI 1.0.3 shape) describing one guess or one game result. |
| Actor | The player the statement is about, identified **only** by an xAPI `account` holding the player's random `externalId`: no email, no real name (`security.md` D3). **Not** `badgeName`/`pairName` directly. |
| Export | A manual, explicit action on one `completed` game that generates and sends its statements. Not automatic, not continuous. |

### Actor identity requires a real person record

Today the only identity in gameplay is `pairName` / `badgeName` /
`stationName`, scoped per game — there is no durable player profile. The
existing `User` model (`createdByUserId`, `authProviderId`) is the
referee/admin account, not a player, and `Guess.guesserUserId` is optional
and unpopulated by the pair-based play flow.

Decision: xAPI actors must be real people, so Milestone 1 adds a
**minimal** identity concept: a `Player` record and a per-game,
time-ranged assignment of `badgeName` → player. Decided on 2026-10-09 (see
`security.md` → Decisions D1–D4):

- **The referee is the only person who logs in.** Players (possibly school
  children) never log in and have no accounts.
- **The referee knows the children** and is the only one who creates
  players and binds a badge to a player, in person, as badges are handed
  out.
- **`Player` = `firstName` + `externalId`** (+ `createdByUserId` when
  referee login is enforced; + `orgId` and consent after funding).
  `firstName` is whatever the referee recognises, with no surnames.
  `externalId` is a random UUID v4. **There's no email field**, for adults
  either, so there's one code path.
- **Nothing identifying goes to the LRS.** The actor is
  `{"account": {"homePage": "https://kogs.link", "name": "<externalId>"}}`.
  The `externalId → firstName` mapping lives only in our database.

A game cannot be exported until every badge that recorded a guess has an
assigned player.

### Statement shape

- One **answered** statement per `Guess`: actor = assigned player, verb
  `http://adlnet.gov/expapi/verbs/answered`, object = the `Question` (as an
  Activity keyed by `gameId`/`questionId`), `result.success` = correctness
  (derived the same way `computeQuestionResult` derives it today),
  `result.response` = the chosen `slotLabel`/answer text.
- One **scored** statement per player per game, built from the existing
  `getGameScores` row: verb `http://adlnet.gov/expapi/verbs/scored`,
  object = the `Game` (as an Activity keyed by `gameId`), `result.score.raw`
  / `.max` from `correct` / `total`.
- `context.extensions` carries `gameId`, `stationName`, `badgeName` for
  traceability back to our own records. These are custom extensions, not
  standard xAPI vocabulary — fine for our own round-trip, not assumed
  portable to other LRS consumers.
- `LRS.md` adds the detail needed to make these statements useful in an
  LRS dashboard (not a change to this shape's intent): stable UUID `id`s
  and a per-game `context.registration` so one game's statements can be
  filtered as a group; a `choice`-interaction `object.definition` on
  `answered` statements (so a generic LRS report can show the question
  text, options, and correct answer); `result.duration` and
  `result.response`; and `result.score.scaled` on `scored` statements
  (most LRS dashboards chart `scaled`, not `raw`/`max`). See that doc for
  the full field tables and a worked example.
- **Actor identifier: decided as `account` + `externalId`** (no `mbox`, no
  real `actor.name`). See `LRS.md` → Actor and `security.md` → Identity
  model. It's effectively permanent once pilot statements exist.

### Trigger and delivery

- Export is a manual action that **only the game's referee** (or a
  platform admin) can take, under the authenticated `/api/*` prefix, on a
  game already in state `completed` (reusing the existing state machine in
  `game-flow.controller.ts` — no new trigger is added for entering that
  state).
- Delivery target: a configured xAPI **LRS** endpoint, using the standard
  xAPI REST API (`PUT`/`POST {endpoint}/statements`, Basic Auth,
  `X-Experience-API-Version: 1.0.3`). `LRS.md` picks a specific LRS for dev
  and for the pilot dashboard; because the client only speaks the standard
  REST API, swapping which LRS it points at is a config change
  (`XAPI_LRS_ENDPOINT` / `XAPI_LRS_KEY` / `XAPI_LRS_SECRET`), not a code
  change.
- No retry queue or backfill in Milestone 1. A failed export is re-run
  manually; stable statement `id`s (from `LRS.md`) make a re-send safe
  against the same LRS, so this is closer to idempotent than originally
  scoped.
- No voiding/correcting previously sent statements. A statement re-sent
  with the same `id` but different content gets a `409` from the LRS — if
  that happens, treat the game as already exported under the old shape
  rather than trying to patch it.

### Out of scope for this plan

- **Moodle** (in any role) — `moodle.md` found that a stock Moodle site has
  no endpoint that accepts externally-generated xAPI statements; getting
  Moodle involved would mean a gradebook push via web services, a custom
  xAPI-handling plugin, or a cmi5 launch — all extra integrations beyond
  pointing the export at an LRS. Deferred until a teacher pilot specifically
  needs results inside Moodle; `moodle.md` keeps the options ready.
- **cmi5** — xAPI profile for LMS-standard launch/tracking; deferred until
  there's a real LMS-launch requirement.
- **SCORM 1.2 / 2004** — legacy LMS fallback; deferred until a customer
  needs it.
- **QTI import/export** — question-bank interchange; deferred until content
  reuse from existing banks (e.g. Moodle question banks) is a real need.
- **OneRoster** — roster sync; deferred until a K-12 deployment needs SIS
  sync.
- **LTI 1.3 launch** (instructor launching the game from inside the LMS) —
  assumed infeasible given the hardware badges/controllers (see `xAPI.md`);
  revisit only if that assumption turns out to be wrong.
- **Player logins or a general roster system.** Players never log in
  (`security.md` D1). Milestone 1 adds only the minimal referee-managed
  `Player` record (first name + random `externalId`) needed to produce a
  pseudonymous actor. Roster import (CSV/OneRoster) and a separate
  org-admin role are deferred.
- **Automatic / real-time statement streaming** — exports stay a deliberate,
  after-the-fact action on completed games only.
- **AI-assisted question generation** (the Hashbrown-based authoring idea in
  `xAPI.md`) — does not exist in code today; not part of this plan.
- **Dashboards/BI beyond the chosen LRS's own UI** (e.g. standing up
  Superset) — only in scope if the chosen LRS's built-in viewer turns out
  to be insufficient; see `LRS.md`'s options comparison.

---

## Current code to change

| Area | Today | Target (Milestone 1) |
| --- | --- | --- |
| Access control | Only `POST /api/chat` requires login; game, device and `/ws` traffic is open; `createdByUserId` read from request bodies | Step 0: `/api/*` (referee, default-deny), `/api/public/*` (spectator share code), `/api/device/*` (device credential); WebSocket split to match; identity from the token |
| Identity | `pairName` / `badgeName` only; `Guess.guesserUserId` optional, unused by pair-based play | New minimal `Player` record (`firstName`, `externalId`, `orgId`, no email) + referee-made, time-ranged `badgeName → player` assignment |
| Game completion | `setGameState` transitions `active → completed` manually (`game-flow.controller.ts`) | Unchanged; export becomes available once a game is `completed` |
| Scoring data | `getGameScores`, `computeQuestionResult`, `getGameGuessChart` (`game-data.repository.ts`) return per-pair rows | Reused as the source data for statement generation; no change to their shape |
| Export | None exists | New module: xAPI statement builder + LRS delivery client |
| API | `GET /api/games/:gameId/scores`, `/guess-chart` (`game-flow.controller.ts`) | New endpoint, e.g. `POST /api/games/:gameId/xapi-export` |
| Client | No export UI | Small "assign player to badge" control + an "Export to LRS" action, shown only once a game is `completed` |

---

## Milestone 1 — Emit xAPI statements for completed games, export to a hosted LRS

Goal: a referee can take one completed game, assign a real player to each
badge that played, and export that game's activity as xAPI statements to an
LRS — validated first against the personal Korean-vocabulary pilot, and
visible through that LRS's own statement viewer/dashboard without any
Moodle involvement.

### Step 0 — Access-control foundations (⏸ deferred until funded)

> **Deferred (D12).** Not part of the prototype. It becomes a prerequisite
> before any school or children's pilot, and the prototype guardrails in
> `security.md` cover the gap until then. When it's scheduled, consider
> moving `emoji-os` into this repo first, with a shared device-contract
> file (`security.md` D13; for now it stays in `rainbow-connection`).
> Spectator expiry and rate limits are server config with env overrides
> (D10), not shared with the station.

Kept here as the agreed design for when it's picked up. Today every game
endpoint and `/ws` is open to the internet, which is why the prototype
stores no real children's personal data. The full design is in
`security.md` (Decisions D5–D7, Access control, Spectators and public
access).

- **Route prefixes, default-deny:**
  - `/api/*` requires a Cognito login (referee, platform admin), and
    `requireAuth` attaches `req.user = { sub, groups, orgId }`.
  - Explicit public exceptions: `GET /api/version`, health check, static
    SPA.
  - `createdByUserId` and similar fields come from `req.user`, **never**
    from request bodies.
- **Device prefix:**
  - Move the station calls (`guesses`, `status`, `emoji`,
    `games/:id/join`, `games/:id/readiness`, `pairs/:pairName`,
    `nfc-cards`) under `/api/device/*`, behind a per-device credential
    (stored hashed, revocable).
  - Update `rainbow-connection/python/emoji-os/emoji-os-zero.py` to match.
- **Spectator prefix `/api/public/*`:**
  - **GET-only**, separate handlers returning a **spectator projection**:
    badges, scores by badge, question text; no player IDs.
  - Access by a referee-issued **share code**: random, stored hashed, one
    per game, revocable/regenerable.
  - The code **expires** (default 2 h after the game completes, 24 h cap)
    and is **rate-limited** per IP and per code, with lockout after
    repeated invalid codes.
- **First names for spectators:** a per-game `spectatorsSeeFirstNames`
  flag, **default off**. Only the referee can set it, and the UI warns
  that anyone with the link will see the names.
- **WebSocket split:** `/ws/referee` (token in the first message),
  `/ws/public` (share code), `/ws/device` (device credential). Events are
  sent per game and projected per audience, instead of today's broadcast
  of every event to every client.
- **CORS** restricted to the app's own origin(s).
- **Audit events** (append-only `auditEvents` collection, IDs only) for:
  share code issued/revoked, first-name opt-in toggled, device credential
  issued/revoked. Step 1 adds binding and export events.

### Step 1a — Minimal player identity

- Add a `Player` schema in `models.ts`: `firstName` (no surnames; in
  prototype playtests with children, a nickname or badge name, per the
  guardrails) and `externalId` (random UUID v4, unique, immutable).
  **No email field.** `createdByUserId` comes from the token once referee
  login is enforced. `orgId` and consent fields are added after funding.
- Add a per-game assignment of `badgeName` → `playerId` (new schema, or a
  field alongside `PairBinding`/`Guess` — exact shape decided during
  implementation).
- Bindings are **referee-only**, time-ranged (`assignedAt`/`unassignedAt`,
  reason `initial`/`swap`/`replacement`, following
  `playerBadgeAssignment`). A guess belongs to whoever held the badge **at
  the time of the guess**. `assignedByUserId` (from the token) and an
  audit event per binding are added with Step 0, after funding.
- Add a small referee-facing UI control to assign a player to a badge
  (reusing existing badge/station display in `BadgesView.tsx` /
  `GameRefereePanel.tsx`).
- Validation: a game cannot be exported while any badge with a recorded
  guess has no assigned player.

**Implemented (2026-10-09):**

- Models (`models.ts`):
  - `Player` (`players`): `firstName`, `externalId` (`crypto.randomUUID()`).
  - `PlayerBinding` (`playerBindings`): `gameId`, `badgeName` (the
    `Guess.pairName` player key), `playerId`, `assignedAt`,
    `unassignedAt`, `reason` (`initial`/`swap`/`replacement`).
  - Unique-active indexes per badge and per player.
  - The unused `playerBadgeAssignments` (keyed to `User`/`Badge`) is left
    as is.
- Repository: `persistence/player.repository.ts`.
  - **Attribution rule:** `bindingAt()` picks the binding active when the
    guess was made.
  - The badge's **first** binding also covers guesses made before it, so
    the referee can bind after a round or after the game.
  - After an unbind with no new binding, later guesses are uncovered.
- Endpoints (`players.controller.ts`):
  - `GET/POST /api/players`. The body is strict, so `email` or any other
    extra field gets a 400.
  - `GET /api/games/:gameId/player-bindings`, returning `badgeNames`,
    `bindings` (history included) and `missingBadges`. Guesses are scoped
    to the current run (`startedAt`), like `getGameScores`.
  - `PUT|DELETE /api/games/:gameId/player-bindings/:badgeName`. A rebind
    ends the badge's previous binding and the player's binding on another
    badge. Reason defaults to `initial`, or `swap` if the badge was bound
    before.
- UI: `PlayerBindingsPanel.tsx` under the referee panel in
  `GameDetailView`. It has a player picker per badge, an "add player"
  field (first name/nickname) and a warning that lists `missingBadges`.
  Players show with their `Player 7F3A` label.
- Not yet:
  - `createdByUserId`/`assignedByUserId` and binding audit events wait for
    Step 0, since no identity comes from the token yet.
  - The roster is global (no `orgId`) until tenancy.
  - The "export blocked" check is `missingBadges`; Step 1c enforces it.

### Step 1b — Statement generation

- New module that reads `getGameScores` + `computeQuestionResult` (or the
  underlying `Guess`/`AnswerOption` rows) for a `completed` game and builds
  the statement set described in "Statement shape" above, including the
  `LRS.md` refinements (stable UUID `id`s, `context.registration`, `choice`
  interaction definition, `result.duration`/`response`,
  `result.score.scaled`).
- Base IRI is decided: `https://kogs.link/xapi/emoji-app` (see `LRS.md` →
  Identifiers). The actor is decided as
  `account { homePage: "https://kogs.link", name: externalId }`, with no
  `mbox` and no `firstName` anywhere in the statement. Both are permanent
  once pilot statements exist.
- Pure function from (game id, player assignments) → `Statement[]`; no
  network calls, so it can be unit-tested and inspected without an LRS.

### Step 1c — Export delivery

- New endpoint (e.g. `POST /api/games/:gameId/xapi-export`) that generates
  the statements from 1b and `POST`s/`PUT`s them to a configured LRS
  endpoint (`XAPI_LRS_ENDPOINT` / `XAPI_LRS_KEY` / `XAPI_LRS_SECRET`), with
  the `X-Experience-API-Version: 1.0.3` header.
- Target LRS: **Veracity** (`lrs.io`, free plan), with three LRSs: `dev`
  for development, `sandbox` for experiments and `pilot` for the pilot. Set
  up as described in `LRS.md` → "Veracity setup", with Strict API Mode on
  so malformed statements are rejected early. Run the curl smoke test
  there (Step 4) before writing the delivery client. It confirms the
  endpoint, keys and the identical vs changed re-send status codes this
  step's error handling relies on.
- Add `XAPI_LRS_ENDPOINT` / `XAPI_LRS_KEY` / `XAPI_LRS_SECRET` placeholders
  to `.env.example`. Real Veracity keys live only in `.env` locally.
- Staging (`emoji-staging.kogs.link`, which exports to `emojiapp-pilot`):
  key/secret go in a new optional Secrets Manager secret, injected via
  `modules/ecs-service/task-definition.tf` like the OpenAI key. The
  endpoint is a plain env var from `terraform.tfvars`. Outbound access to
  `lrs.io` already works (public IP + allow-all egress). Details are in
  `LRS.md` → Veracity setup, Step 3.
- The delivery client uses only the standard xAPI REST API. Don't use
  Veracity-specific endpoints (`/statements/search`, `/aggregate`, the
  `/api` admin API), so switching LRS stays a config change.
- Surface success/failure back to the referee (e.g. "N statements sent",
  or the LRS error — including a `409` as "already exported with a
  different shape", per `LRS.md`).

### Acceptance criteria — Milestone 1

- [ ] **Step 0 (deferred until funded):** every `/api/*` route except the explicit public ones
      returns 401 without a valid Cognito token, and `createdByUserId` is
      never read from a request body.
- [ ] **Step 0 (deferred until funded):** stations work only via `/api/device/*` and `/ws/device`
      with a valid device credential.
- [ ] **Step 0 (deferred until funded):** a spectator with a valid share code can watch one game
      via `/api/public/*` and `/ws/public` (GET only). The spectator view
      shows no player identity unless the game's first-name opt-in is on.
      An expired, revoked or wrong code gets 404, and repeated wrong codes
      are rate-limited.
- [ ] A `Player` (first name + generated `externalId`, no email) can be
      created by the referee and bound to a badge for a specific game; the
      binding records who made it.
- [ ] A game with any unassigned badge that recorded a guess cannot be
      exported; the error names the missing badge.
- [ ] Exporting a completed game produces one `answered` statement per
      guess and one `scored` statement per player, each with an `account`
      actor (`externalId`) and **no email or first name anywhere in the
      statement**,
      matching `getGameScores` / `computeQuestionResult`.
- [ ] Statements are successfully written to a real LRS endpoint and are
      visible in that LRS's own statement viewer/dashboard — no Moodle
      involved.
- [ ] Re-running the export on the same game is safe: a byte-identical
      re-send is a no-op on the LRS (stable statement `id`s), and a
      changed re-send fails loudly with the LRS's `409` rather than
      silently duplicating or corrupting local game data.
- [ ] None of Milestone 1 changes existing scoring, guessing, or game-state
      behavior for games that are never exported.

---

## Suggested implementation order

- *(Step 0 deferred until funded; see above. The prototype relies on the
  guardrails in `security.md`.)*
1. **Step 1a** — player identity + referee-only badge assignment (server +
   a minimal referee UI control).
2. **Step 1b** — statement generation as a pure, testable function (verify
   by logging/inspecting generated JSON; no LRS needed yet). In parallel,
   do the Veracity setup and curl smoke test in `LRS.md` (Steps 1–4), so
   the LRS is ready before 1c.
3. **Step 1c** — delivery to Veracity: develop against `emojiapp-dev`,
   then validate end-to-end with the personal Korean-vocabulary pilot game
   on `emojiapp-pilot`, viewed in Veracity's statement viewer/analytics
   (`LRS.md` Step 5).

---

## Risk notes

- **Pilot data lives with a third party.** The pilot LRS (Veracity, per
  `LRS.md`) is hosted SaaS. Statements carry only pseudonymous
  `externalId`s, with no names or emails, which greatly reduces the
  exposure. Even so, it's still pseudonymous personal data, so check
  Veracity's DPA and data location before a school pilot (`security.md` →
  Third parties). `LRS.md`'s self-hosted options (SQL LRS, Learning
  Locker) are the fallback if that matters.
- **Veracity free-tier reporting is unconfirmed.** It's unclear whether
  the free plan includes Analytics dashboards or only the statement viewer.
  `LRS.md` Step 5 checks this on `dev` after the first exports. If
  dashboards aren't included, CSV export covers a single-learner pilot,
  and Watershed Essentials is the fallback. Volume limits (100 MB, 10k
  calls/day) are far above pilot needs.
- **Manual identity mapping doesn't scale.** It's fine for a single-pilot
  scale (a handful of players); a real second user (e.g. a teacher's whole
  class) would need a less manual way to assign players to badges, which is
  explicitly deferred past this milestone.
- **Custom context extensions aren't portable.** `gameId`/`stationName`/
  `badgeName` in `context.extensions` are useful for our own traceability
  but are not a standard xAPI vocabulary other tools would understand.
- **The actor format and base IRI are effectively permanent** once real
  statements have been sent (per `LRS.md`). Both are now decided
  (`account` + `externalId`; `https://kogs.link/xapi/emoji-app`), so they
  must not drift during implementation.
- **Prototype runs on an open staging server.** Until Step 0 (deferred),
  anyone who finds `emoji-staging.kogs.link` can read or alter games. The
  guardrails (no real children's data) are what keep this acceptable. If
  a children's pilot comes up before funding, Step 0 must be done first.
- **Step 0 (when it's picked up) touches the station firmware/script
  too.** Moving device calls
  to `/api/device/*` with credentials needs a coordinated update of
  `emoji-os-zero.py`. Stations running the old script will stop working
  until updated.
