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

Related:

- [`xAPI.md`](./xAPI.md) — background notes, standards landscape, and the
  Korean-vocabulary pilot scenario this plan targets first
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
| 1 | Emit xAPI statements for completed games, export to a hosted LRS | 🔲 planned |
| 2+ | cmi5, SCORM, QTI, OneRoster, LTI, Moodle (gradebook push / plugin / cmi5 launch) | ⏸ deferred indefinitely — see [Out of scope](#out-of-scope-for-this-plan) |

---

## Locked decisions

These are the design locks for Milestone 1. Do not revisit them unless the
milestone proves them wrong in practice.

| Term | Meaning |
| --- | --- |
| Statement | One xAPI Statement (JSON, xAPI 1.0.3 shape) describing one guess or one game result. |
| Actor | The real person (name + email) the statement is about — see identity decision below. **Not** `badgeName`/`pairName` directly. |
| Export | A manual, explicit action on one `completed` game that generates and sends its statements. Not automatic, not continuous. |

### Actor identity requires a real person record

Today the only identity in gameplay is `pairName` / `badgeName` /
`stationName`, scoped per game — there is no durable player profile. The
existing `User` model (`createdByUserId`, `authProviderId`) is the
referee/admin account, not a player, and `Guess.guesserUserId` is optional
and unpopulated by the pair-based play flow.

Decision: xAPI actors must be real, so Milestone 1 adds a **minimal**
identity concept — a `Player` record (`name`, `email`) and a per-game
assignment of `badgeName` → player. This is entered manually (e.g. by the
referee before or during the game); it is **not** a login/auth system. A
game cannot be exported until every badge that recorded a guess has an
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
- **Open, must decide before the first pilot export:** the actor
  identifier — `mbox` (email) vs. an opaque `account` id. `LRS.md` flags
  this because changing it later splits one learner into two actors in
  whichever LRS holds the data.

### Trigger and delivery

- Export is a manual action a referee/admin takes on a game already in
  state `completed` (reusing the existing state machine in
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
- **A general player/auth system** — Milestone 1 adds only the minimal
  name+email mapping needed to produce a real actor; it does not add
  account creation, login, or roster management.
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
| Identity | `pairName` / `badgeName` only; `Guess.guesserUserId` optional, unused by pair-based play | New minimal `Player` record (`name`, `email`) + per-game `badgeName → player` assignment |
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

### Step 1a — Minimal player identity

- Add a `Player` schema (`name`, `email`) in `models.ts`.
- Add a per-game assignment of `badgeName` → `playerId` (new schema, or a
  field alongside `PairBinding`/`Guess` — exact shape decided during
  implementation).
- Add a small referee-facing UI control to assign a player to a badge
  (reusing existing badge/station display in `BadgesView.tsx` /
  `GameRefereePanel.tsx`).
- Validation: a game cannot be exported while any badge with a recorded
  guess has no assigned player.

### Step 1b — Statement generation

- New module that reads `getGameScores` + `computeQuestionResult` (or the
  underlying `Guess`/`AnswerOption` rows) for a `completed` game and builds
  the statement set described in "Statement shape" above, including the
  `LRS.md` refinements (stable UUID `id`s, `context.registration`, `choice`
  interaction definition, `result.duration`/`response`,
  `result.score.scaled`).
- Base IRI is decided: `https://kogs.link/xapi/emoji-app` (see `LRS.md` →
  Identifiers). Still decide the actor
  identifier (`mbox` vs. `account`) before this step ships — both are
  called out in `LRS.md` as hard to change once statements exist.
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

- [ ] A `Player` (name + email) can be created and assigned to a badge for
      a specific game.
- [ ] A game with any unassigned badge that recorded a guess cannot be
      exported; the error names the missing badge.
- [ ] Exporting a completed game produces one `answered` statement per
      guess and one `scored` statement per player, each with a real actor,
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

1. **Step 1a** — player identity + badge assignment (server + a minimal
   referee UI control).
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
  `LRS.md`) is hosted SaaS — fine for a personal pilot, worth reconsidering before sending a real class's names and
  emails. `LRS.md`'s self-hosted options (SQL LRS, Learning Locker) are the
  fallback if that matters.
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
- **The `mbox`/`account` and base-IRI choices are effectively permanent**
  once real statements have been sent (per `LRS.md`) — decide both before
  the first pilot export, not during Step 1c.
