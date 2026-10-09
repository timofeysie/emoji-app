# LRS — requirements and options for the xAPI prototype

Status: **LRS chosen: Veracity (`lrs.io`)**; see
[Veracity setup](#veracity-setup-chosen-lrs). The functional requirements
below build on the Milestone 1 locks in `xapi-export-plan.md`. The other
options stay documented as fallbacks. Pricing and tier details were checked in October 2026; confirm
them at sign-up.

Related:

- [`xapi-export-plan.md`](./xapi-export-plan.md) — Milestone 1 (statement
  shape, manual export, delivery client). Step 1c is where this doc applies.
- [`moodle.md`](./moodle.md) — why we're using an LRS directly and not Moodle
- [`xAPI.md`](./xAPI.md) — Korean-vocabulary pilot scenario
- [`security.md`](./security.md) — identity model, access control, audit
  logs, data isolation (children's data)
- `server/src/persistence/models.ts` — `Game`, `Question`, `AnswerOption`,
  `Guess` fields referenced below

---

## Decision so far

An **LRS dashboard is enough for the pilot**. Moodle is deferred (see
`moodle.md`, "Suggested path" step 3). The LRS is both where statements are
stored and where we look at progress.

**LRS: Veracity**, free hosted plan on `lrs.io` (we have an account). We use
three LRSs: `dev`, `sandbox` and `pilot`. See
[Veracity setup](#veracity-setup-chosen-lrs). Whether its free tier
includes dashboards is still to be confirmed. If it doesn't, CSV export
covers the pilot, and Watershed Essentials is the fallback.

---

## What we want the LRS to tell us

These are the questions the pilot (one learner, Korean vocabulary, many
games over weeks) should be able to answer from the LRS UI without custom
code:

| # | Question | Built from |
| --- | --- | --- |
| Q1 | What happened in game X? (every guess, right/wrong, in order) | `answered` statements filtered by `context.registration` |
| Q2 | How did each player score in game X? | `scored` statements for that game |
| Q3 | Is a learner improving over time? (score % per game, plotted by date) | `scored` statements for one actor, ordered by `timestamp` |
| Q4 | Which questions/words does the learner keep getting wrong? | `answered` statements with `result.success = false`, grouped by object (question activity) |
| Q5 | Are answers getting faster? | `result.duration` on `answered` statements |
| Q6 | Which wrong option is the common mistake? (distractor analysis) | `result.response` on `answered` statements |

Q1–Q3 are the must-haves. Q4–Q6 are nice-to-haves that depend on how good
the LRS's reporting is, and they're the main thing separating the options
below.

---

## Functional requirements for the LRS

### Must have

1. **xAPI 1.0.3 conformant** statement resource: `POST /statements`
   (array) and `PUT /statements?statementId=…`, with the
   `X-Experience-API-Version: 1.0.3` header. Prefer an LRS that passed the
   ADL LRS test suite.
2. **HTTP Basic Auth** with a key/secret per client, so the server config
   needs only `XAPI_LRS_ENDPOINT`, `XAPI_LRS_KEY`, `XAPI_LRS_SECRET`.
3. **Honours statement IDs**: a re-sent statement with the same `id` and
   the same content is accepted without creating a duplicate. This is what
   makes our manual re-export safe (see "Idempotency" below).
4. **Statement viewer** in the UI that can filter by actor, verb, activity
   and time range, and shows the raw JSON. That covers Q1, Q2, and Q3 at a
   pinch.
5. **Server-to-server use.** Our game server sends statements, not the
   browser, so CORS and browser launch credentials don't matter.
6. **At least two separate stores/credentials** (e.g. `dev` and `pilot`) so
   test exports don't pollute pilot data.
7. **Delete or reset data.** We need to clear dev data, and to remove a
   person's data if asked.

### Should have

8. **Dashboards or charts** without custom code: score over time per
   learner (Q3), success rate per activity (Q4).
9. **Export** to JSON/CSV, so we're never locked in and can do ad-hoc
   analysis in a spreadsheet.
10. **Standard query API** (`GET /statements?agent=…&verb=…&since=…`). It's
    part of the spec, so any conformant LRS has it. It's our fallback if
    the UI can't answer a question.

### Not needed for the pilot

- cmi5/launch, SCORM content hosting, statement forwarding, xAPI profiles
  validation, SSO, learner-facing portals, xAPI 2.0 (nice if present; we
  send 1.0.3).

---

### Volume and sizing

Our load is tiny by LRS standards. Exports are manual, one game at a
time, so there's no streaming and no browser traffic.

| Scenario | Statements | Approx. storage* | API calls |
| --- | --- | --- | --- |
| One game: 1 player, 20 questions | 21 (20 `answered` + 1 `scored`) | ~50 KB | 1 batch `POST` |
| Personal pilot: 1 game/day for 6 months | ~4,000 | ~10 MB | ~180 total |
| Teacher pilot: 30 students × 20 questions × 3 games/week × 12 weeks | ~23,000 | ~55 MB | ~36 batches (one per game) |

\* Assumes ~2–2.5 KB per stored statement. Each `answered` statement
repeats the question text and 3–5 answer choices, plus LRS overhead.

So every free tier in this doc covers the personal pilot many times over.
Even a one-class teacher pilot fits inside Veracity Free's 100 MB /
~50–100k statements and its 10k API calls/day. **Free-tier limits are not
what separates the options; reporting is.**

**What our system doesn't need from an LRS:** high throughput, real-time
ingestion, browser/CORS access, OAuth, cmi5 launch, SCORM content hosting,
statement forwarding, or a learner portal.

---

## Statement design (detail for Step 1b)

This expands the "Statement shape" lock in `xapi-export-plan.md` with
the fields the LRS needs to answer Q1–Q6. Nothing here changes the lock's
intent (one `answered` per guess, one `scored` per player per game).

### Identifiers

| Thing | xAPI field | Value |
| --- | --- | --- |
| Base IRI | — | **`https://kogs.link/xapi/emoji-app`** (decided; see below). **Don't change it once pilot statements exist.** |
| Game | Activity `id` | `{base}/games/{gameId}` |
| Question | Activity `id` | `{base}/games/{gameId}/questions/{questionId}` |
| Game session | `context.registration` | UUID derived from `gameId` (UUID v5). Groups all statements from one game, which gives Q1 with a single filter. |
| Statement | `id` | UUID v5 from `{gameId}:{guessId}:answered` / `{gameId}:{playerId}:scored`. Stable across re-exports. |
| Custom extensions | `context.extensions` keys | `{base}/ext/game-id`, `…/station-name`, `…/badge-name`. Extension keys must be IRIs. |

#### Base IRI: `https://kogs.link/xapi/emoji-app`

We own `kogs.link`, so IRIs under it are guaranteed unique to us. Why this
exact form:

- **Not `emoji-staging.kogs.link`.** An IRI is a permanent *name*, not a
  link to a deployment. The staging hostname describes one environment
  that may be renamed, torn down or replaced by a production hostname. The
  same game content should keep the same ID wherever it runs.
  Environments are separated by **which LRS** we send to
  (`dev`/`sandbox`/`pilot`), not by the IRI.
- **Apex domain + `/xapi/emoji-app`.** This leaves room for other
  `kogs.link` projects to emit xAPI under their own path without clashing.
- **It doesn't need to resolve.** xAPI only requires IRIs to be unique and
  stable, so there's no DNS record, route or Terraform change. Later we
  *could* serve activity metadata at these URLs, but that's optional and
  not planned.
- **No collisions between environments.** `gameId`/`questionId` are MongoDB
  ObjectIds, unique per database. Local and staging games never share IDs
  even though they share the base IRI.

Resulting IDs:

| Thing | Example |
| --- | --- |
| Game | `https://kogs.link/xapi/emoji-app/games/6650f…` |
| Question | `https://kogs.link/xapi/emoji-app/games/6650f…/questions/6650a…` |
| Extension keys | `https://kogs.link/xapi/emoji-app/ext/game-id`, `…/ext/station-name`, `…/ext/badge-name` |
| Actor `account.homePage` (if `account` is chosen) | `https://kogs.link` |

> **Open point:** question activities are keyed per game, so the same
> Korean word in two different games is two different activities, and Q4
> only works within a game. To track a *word* across games, the question
> needs a content-level ID (the "canonical question model" in `xAPI.md`).
> Until that exists, Q4 is per-game only. If we add a stable content ID
> later, put it in `context.contextActivities.grouping` without changing
> the activity ID.

### Actor

**Decided (2026-10-09):** an `account` identifier only. There's no email
(`mbox`) and no real name. See [`security.md`](./security.md) → Decisions
D1–D4: the referee is the only person who logs in, children may play, and
the `Player` record has no email field at all.

```json
"actor": {
  "objectType": "Agent",
  "account": { "homePage": "https://kogs.link", "name": "<Player.externalId>" }
}
```

- `externalId` is a random UUID v4 generated when the referee creates the
  player. It's not the Mongo `_id`.
- `actor.name` is omitted, or set to a non-identifying label derived from
  `externalId` (e.g. `"Player 7F3A"`) so Veracity's viewer stays readable.
  **Never the player's first name.**
- The `externalId → firstName` mapping exists only in our database. To find
  one child's statements in Veracity, the referee looks up their label in
  our app.
- This is permanent once pilot statements exist: changing the actor
  format later would split each learner into two actors in the LRS.
- A future Moodle join (see `moodle.md`) can't use email. It would need a
  referee-maintained mapping to Moodle users.

### `answered` statement (one per `Guess`)

| Field | Source |
| --- | --- |
| `verb.id` | `http://adlnet.gov/expapi/verbs/answered` |
| `object.id` | Question activity IRI |
| `object.definition.type` | `http://adlnet.gov/expapi/activities/cmi.interaction` |
| `object.definition.name` | `Question.text` |
| `object.definition.interactionType` | `choice` |
| `object.definition.choices` | One per `AnswerOption`: `id` = `slotLabel` (A–E), `description` = option text |
| `object.definition.correctResponsesPattern` | `[ "<slotLabel of the isCorrect option>" ]` |
| `result.response` | Chosen `slotLabel` (Q6) |
| `result.success` | Correctness, as `computeQuestionResult` derives it |
| `result.duration` | `Guess.createdAt − Question.openedAt` as ISO 8601 (e.g. `PT4.2S`) (Q5). Omit if `openedAt` is missing. |
| `timestamp` | `Guess.createdAt`, the time it **happened**, not the export time. The LRS adds its own `stored` time. |
| `context.registration` | Game session UUID |
| `context.contextActivities.parent` | `[ Game activity ]` |
| `context.extensions` | game-id, station-name, badge-name |

Example:

```json
{
  "id": "5f0c0c3e-8a4b-5c1e-9a7d-2b6f1e0d9c11",
  "actor": {
    "objectType": "Agent",
    "name": "Player 7F3A",
    "account": { "homePage": "https://kogs.link", "name": "7f3a2c1e-5b8d-4e6a-9c0f-1d2e3f4a5b6c" }
  },
  "verb": { "id": "http://adlnet.gov/expapi/verbs/answered", "display": { "en-US": "answered" } },
  "object": {
    "objectType": "Activity",
    "id": "https://kogs.link/xapi/emoji-app/games/6650f.../questions/6650a...",
    "definition": {
      "type": "http://adlnet.gov/expapi/activities/cmi.interaction",
      "name": { "en-US": "What does 사과 mean?" },
      "interactionType": "choice",
      "correctResponsesPattern": ["B"],
      "choices": [
        { "id": "A", "description": { "en-US": "Banana" } },
        { "id": "B", "description": { "en-US": "Apple" } },
        { "id": "C", "description": { "en-US": "Pear" } }
      ]
    }
  },
  "result": { "response": "A", "success": false, "duration": "PT4.2S" },
  "timestamp": "2026-10-05T09:14:03.120Z",
  "context": {
    "registration": "0b7e2a1c-3d4f-5a6b-8c9d-0e1f2a3b4c5d",
    "contextActivities": {
      "parent": [{ "id": "https://kogs.link/xapi/emoji-app/games/6650f..." }]
    },
    "extensions": {
      "https://kogs.link/xapi/emoji-app/ext/game-id": "6650f...",
      "https://kogs.link/xapi/emoji-app/ext/station-name": "station-1",
      "https://kogs.link/xapi/emoji-app/ext/badge-name": "badge-red"
    }
  }
}
```

### `scored` statement (one per player per game)

| Field | Source |
| --- | --- |
| `verb.id` | `http://adlnet.gov/expapi/verbs/scored` |
| `object.id` | Game activity IRI |
| `object.definition.type` | `http://adlnet.gov/expapi/activities/assessment` |
| `object.definition.name` | `Game.title` |
| `result.score` | `raw` = correct, `max` = total, `min` = 0, `scaled` = correct ÷ total (0–1) |
| `result.duration` | `Game.endedAt − Game.startedAt` |
| `timestamp` | `Game.endedAt` |
| `context.registration` | Game session UUID |

`result.score.scaled` matters: most LRS dashboards chart `scaled`, not
`raw/max`, so this is what makes Q3 work without custom reports.

Optional, cheap, and useful in most dashboards: also send a `completed`
statement per player per game (`http://adlnet.gov/expapi/verbs/completed`)
with the same score. Many off-the-shelf reports count completions by that
verb. Leave it out unless the chosen LRS's reports need it.

### Idempotency and re-export

- Statements carry stable UUID `id`s, so the spec requires the LRS to accept
  an identical re-send without storing a duplicate. Sending the **same id
  with different content** returns **409 Conflict**.
- So if we change the statement shape after a game has been exported,
  re-exporting that game will fail with 409. Either accept that (old games
  keep the old shape) or add a statement-shape version into the UUID seed.
  For the pilot, accepting it is fine.
- Send in batches (e.g. 50 statements per `POST`). One game is small, so a
  single batch normally covers it.

---

## LRS options

### Summary

| Option | Hosting | Cost for pilot | Statement viewer | Dashboards without custom code | Export | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Watershed Essentials** | SaaS | Free | Yes + debugging tools | **Yes**: 6 preconfigured reports, filters, drill-down | JSON / CSV | Best free dashboards. Limits not published; check at sign-up. Paid tiers are enterprise-priced. |
| **Veracity LRS (lrs.io) Free** | SaaS | Free | Yes | **Disputed:** the live pricing page lists "Statement Viewer" only for Free, but other summaries claim full dashboards. **Verify at sign-up.** Paid dashboards start at Starter, $100/mo. | Via API | 3 LRSs, 100 MB, ~50–100k statements, 10k API calls/day. Easy multiple stores. |
| **SCORM Cloud LRS** | SaaS | Free (externally generated statements) | Yes: filter, view raw, forward/export | Minimal | Forward to other LRS / API | From Rustici (behind xAPI). Passed the ADL LRS test suite. Best as a **conformance check**. |
| **Yet Analytics SQL LRS** | Self-host (Docker / one jar) | Free (Apache 2.0) | Basic admin UI + statement browser | No, but documented **Apache Superset** integration | Direct SQL | Lightweight; SQLite for dev, Postgres for pilot. Data stays with us. Easy to reset. |
| **Learning Locker** | Self-host (heavier) or paid SaaS | Software free (GPL 3.0); ~$30/mo hosting (e.g. small AWS instance); vendor-hosted = **Learning Pool LRS**, quote-only (see notes) | Yes | Yes: custom dashboards | Yes | Most dashboard power of the self-host options, but a multi-service stack (Mongo, Redis, …). |
| **Veracity Learning Lite** | Self-host | Free | Yes | Limited | Via API | Self-hosted version of Veracity. |

### Adoption ("most used")

Nobody publishes neutral LRS market-share data; vendor "most installed"
claims and listicles are all there is. Roughly, by how often each shows up
in the xAPI community, vendor integrations and comparison lists:

| Rank (approx.) | LRS | Evidence of use | Typical user |
| --- | --- | --- | --- |
| 1 | **SCORM Cloud** (Rustici) | The default test target for authoring tools and xAPI developers. Run by the company that led xAPI's creation. | Developers, content authors testing |
| 2 | **Learning Locker** (Learning Pool) | Calls itself the "most installed LRS in the world" (open source since 2014, so it has the largest self-host footprint). | Self-hosters, Learning Pool customers |
| 3 | **Watershed** | Most common in corporate L&D analytics; frequently top of comparison lists. | Enterprise L&D teams |
| 4 | **Veracity Learning** | Strong in US government/defence (ADL ecosystem); its free tier is popular for small projects. | Government, small projects |
| 5 | **Yet Analytics SQL LRS** | 100k+ Docker pulls (vendor figure); the go-to lightweight open-source LRS. | Developers, government/TLA projects |

Others that appear in lists but don't fit us: GrassBlade (WordPress-centric),
Learning Pool LRS (commercial Learning Locker), and LMSs with built-in LRSs
(Instancy, Valamis, etc.).

### Scoring against our questions

| | Q1 game timeline | Q2 game scores | Q3 progress over time | Q4 weak questions | Q5 speed | Q6 distractors | Dev/pilot separation | Data stays with us |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Watershed Essentials | ✅ | ✅ | ✅ dashboard | ✅ activity report | ⚠️ verify | ⚠️ verify | ⚠️ verify | ❌ |
| Veracity Free | ✅ viewer | ✅ viewer | ⚠️ raw list only (✅ if dashboards are included) | ❌ / ✅ if dashboards | ❌ / ⚠️ | ❌ / ⚠️ | ✅ 3 LRSs | ❌ |
| SCORM Cloud | ✅ viewer | ✅ viewer | ⚠️ raw list only | ❌ manual | ❌ | ❌ | ✅ per-app endpoints | ❌ |
| SQL LRS (+ Superset) | ✅ | ✅ | ✅ with Superset | ✅ with Superset | ✅ with Superset | ✅ with Superset | ✅ separate containers | ✅ |
| Learning Locker | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ stores | ✅ |

✅ = out of the box; ⚠️ = possible but unverified or needs effort; ❌ = not
without our own code.

### Notes per option

**Watershed Essentials.** Its six preconfigured reports (activity, people,
actions/interactions) map well to Q2–Q4, and it can export CSV. Unknowns:
statement/volume limits, whether multiple stores are allowed on the free
plan, and whether it reports `result.duration` and `result.response`. Paid
plans are priced for enterprises (thousands per month), so if we outgrow
the free plan we'd move off it rather than upgrade.

**Veracity free.** Fastest to set up, and having 3 LRSs is ideal for
`dev` / `pilot` separation. **Whether the free tier includes dashboards
is disputed.** The live pricing table (`lrs.io/home/lrs-pricing`, checked
October 2026) lists only "Statement Viewer" for Free. It puts "Statement
Viewer Customizations and Filters", "Saved Reports" and the "Analytics
Platform" in Starter ($100/mo) and above. Some third-party summaries (and
older Veracity material) describe the free plan as having full dashboards
and custom analytics. Sign-up takes minutes, so check it directly.

- **If dashboards are included:** Veracity becomes the strongest free
  hosted option. Its three stores give `dev`/`pilot` separation, and its
  dashboards cover Q3–Q4.
- **If not:** it's fine for storage and Q1/Q2, but weak for Q3–Q6.

**SCORM Cloud.** The best way to check that our statements are
well-formed. Use it once during Step 1c as a conformance check, not as the
dashboard.

**SQL LRS.** The best fit for local development. It's one container, can
be reset by deleting the SQLite file, and our delivery client can be
integration-tested against it. For pilot dashboards it needs Superset (or
any SQL/BI tool) pointed at its Postgres, which is extra setup but answers
every question and keeps the data ours.

**Learning Locker.** The most capable self-hosted dashboards, but the
heaviest to run. The software is free, but there's no free hosted tier.
Expect roughly **$30/month** in hosting, for example on a small AWS
instance. Check that a micro instance can actually run its
Mongo/Redis stack before budgeting on that figure.

The only SaaS version is **Learning Pool LRS**, the commercial edition from
Learning Pool, who own Learning Locker. It's fully managed (AWS by
default) but sold by quote, with no self-serve sign-up or free tier.
Published figures vary widely:
- "from $115/month" on software directories
- £9,750 per instance per year on the UK G-Cloud listing
- UK school pricing of £500–780/year
- $10k–80k for enterprise deals

There's a 30-day trial. Too much procurement for a prototype; a
self-hosted Learning Locker or another option fits better.

Only worth it if the hosted free tiers turn out to be too
limited *and* Superset is more trouble than it's worth.

---

## Recommendation

**Decision: Veracity.** Step-by-step setup is in the next section.

1. **Hosted dev and the pilot: Veracity**, using three free LRSs (`dev`,
   `sandbox`, `pilot`).
2. **Conformance:** Veracity's **Strict API Mode** catches most malformed
   statements. A one-off SCORM Cloud check is now optional, only worth
   doing if Veracity's strict-mode errors are unclear.
3. **Offline dev and automated integration tests (optional): SQL LRS in
   Docker.** Useful when we want tests that don't depend on the internet or
   a third-party rate limit. Not required to start.
4. **Fallbacks:**
   - **If the free tier lacks dashboards and CSV is too painful:**
     Watershed Essentials.
   - **If pilot data shouldn't leave our system:** SQL LRS (Postgres) +
     Superset.
5. **School pilot (after funding; children, Australia first):** the LRS must be hosted in
   Australia and support **per-actor deletion** (draft OAIC Children's
   Code: destroy on request). Veracity qualifies only if its answers
   (`security.md` → Checking Veracity) confirm AU hosting, a DPA and
   deletion. Otherwise use SQL LRS on our AWS account in `ap-southeast-2`.
   Veracity stays for dev and the adult personal pilot either way.

Because the delivery client only uses the standard xAPI REST API and the
endpoint comes from config, switching LRS is just a config change. The
only lasting commitments are the **base IRI** (decided:
`https://kogs.link/xapi/emoji-app`) and the **actor format** (decided:
`account` + random `externalId`, no email or name; see `security.md`).

---

## Veracity setup (chosen LRS)

We have a Veracity account on `lrs.io`, so Veracity is the LRS for hosted
dev and the pilot. This section sets it up to meet the
[functional requirements](#functional-requirements-for-the-lrs) above.
Menu names follow Veracity's user manual; if the UI has moved on, the
concepts still apply.

### Plan for the three free LRSs

The free plan allows 3 LRSs per account. Use one per purpose so test
exports never mix with pilot data (requirement 6):

| LRS name (example) | Purpose | Cleared? |
| --- | --- | --- |
| `emojiapp-dev` | Day-to-day development: every export while building Steps 1b/1c | Freely, whenever useful |
| `emojiapp-sandbox` | Experiments: statement-shape changes, 409/idempotency tests, Postman/curl pokes | Freely |
| `emojiapp-pilot` | The Korean-vocabulary pilot. Only real exports of real games. | Never during the pilot |

LRS names become part of the endpoint URL and must be **globally unique
on lrs.io**, so pick a prefix that's free (e.g. add initials) and record
the final names in the [setup record](#setup-record) below.

Storage (100 MB) and the 10k calls/day limit are per the plan, but our
volumes are tiny (see [Volume and sizing](#volume-and-sizing)). Clearing
`dev`/`sandbox` regularly keeps headroom for `pilot`.

### Step 1 — Create each LRS

On `lrs.io`, signed in, use the button near the top of the page to create a
new LRS. For each of the three:

| Field | Value | Why |
| --- | --- | --- |
| **LRS Name** | e.g. `emojiapp-dev` | Becomes the endpoint hostname |
| **Strict API Mode** | **On** | We're a new activity provider writing to the spec, so we want the LRS to reject anything non-conformant rather than quietly accept it. (The "leave off" advice in Veracity's manual is for legacy authoring tools.) This partly replaces the SCORM Cloud conformance check. |
| **Verbose Logs** | **On** | Lets us see why a request was rejected while building Step 1c |

Then open the LRS's management page and copy its **xAPI endpoint**. It
normally takes the form `https://<lrs-name>.lrs.io/xapi/`, but use the
exact URL Veracity shows. Note that `https://<lrs-name>.lrs.io/api` is
Veracity's own admin API, **not** the xAPI endpoint.

### Step 2 — Create access keys

xAPI uses HTTP Basic Auth. In Veracity a key is a username/password pair
(requirement 2). From the LRS's management page, create keys:

| Key Name | Read xAPI | Write xAPI | Limited Read | Advanced Queries | Used by |
| --- | --- | --- | --- | --- | --- |
| `emoji-app-server` | ✅ | ✅ | ❌ | ❌ | Our server's export (`XAPI_LRS_KEY` / `XAPI_LRS_SECRET`) |
| `readonly-tools` | ✅ | ❌ | ❌ | ✅ (optional) | Ad-hoc querying from curl/Postman, or a future custom report |

Notes:

- **Key Name becomes the statement `authority`.** Veracity sets each
  statement's `authority` from the key name, so `emoji-app-server` will
  identify our exports in the statement viewer. Keep it stable.
- **Why the server key has Read:** it lets the export do a cheap
  verification `GET` after sending, and lets us debug with the same
  credentials. It doesn't need anything more.
- **Limited Read off:** it would restrict queries to statements written by
  that key. That's harmless for the server key but would blind the
  read-only key.
- **Advanced Queries** (`/statements/search`, `/aggregate`) are
  Veracity-specific, not standard xAPI. Our code must not depend on them;
  allow them on the tools key only if we experiment.
- Use the suggested random username/password (don't invent memorable
  ones), and create separate keys per LRS. **Never commit them.**

### Step 3 — Configure the server

Per LRS, the three values go in `.env` (never in code). For example, for
dev:

```bash
# xAPI export (docs/xAPI/LRS.md)
XAPI_LRS_ENDPOINT=https://emojiapp-dev.lrs.io/xapi/
XAPI_LRS_KEY=<emoji-app-server username>
XAPI_LRS_SECRET=<emoji-app-server password>
```

Switching to the pilot is just a change of these three values. Add the
same three keys, with placeholder values, to `.env.example` when Step 1c
is implemented.

**Which environment talks to which LRS:**

| Environment | LRS | Where the config lives |
| --- | --- | --- |
| Local dev (`npm run dev`) | `emojiapp-dev` (or `-sandbox`) | `.env` |
| Staging (`https://emoji-staging.kogs.link`, ECS) | `emojiapp-pilot`. Pilot games are played against the deployed app. | Terraform (see below) |

**Staging (ECS) wiring, part of Step 1c's implementation:**

- **Network:** no change needed. The ECS service runs with
  `assign_public_ip = true` and an allow-all egress rule
  (`infra/terraform/modules/network`, `modules/ecs-service/service.tf`),
  so the task can already reach `https://<name>.lrs.io`.
- **Secrets:** store the key/secret the same way as the OpenAI key. Create
  a Secrets Manager secret (e.g. `emoji-app/staging/xapi-lrs`) holding
  JSON `{"XAPI_LRS_KEY": "...", "XAPI_LRS_SECRET": "..."}`. Inject both
  through the task definition's `secrets` list (see
  `modules/ecs-service/task-definition.tf`, which already does this for
  `MONGODB_URI` and `OPENAI_API_KEY`). Make it optional, like
  `openai_secret_enabled`, so staging still deploys before the secret
  exists.
- **Endpoint:** `XAPI_LRS_ENDPOINT` isn't secret, so a plain environment
  variable set from `terraform.tfvars` is fine.
- The export endpoint should fail with a clear message if the three values
  aren't set, rather than at startup, so the rest of the app is
  unaffected.

### Step 4 — Smoke test before any code

Confirm the endpoint, keys and strict mode with curl against
`emojiapp-sandbox`. Use a throwaway actor, not a real person:

```bash
LRS=https://emojiapp-sandbox.lrs.io/xapi
AUTH='<key>:<secret>'
ID=$(uuidgen | tr 'A-Z' 'a-z')

# 1. Write one statement with a fixed id → expect 204 (PUT)
curl -i -u "$AUTH" -X PUT "$LRS/statements?statementId=$ID" \
  -H 'X-Experience-API-Version: 1.0.3' -H 'Content-Type: application/json' \
  -d '{"id":"'$ID'","actor":{"name":"Player SMOKE","account":{"homePage":"https://kogs.link","name":"smoke-test-0001"}},
       "verb":{"id":"http://adlnet.gov/expapi/verbs/answered","display":{"en-US":"answered"}},
       "object":{"id":"https://kogs.link/xapi/emoji-app/smoke/q1"},
       "result":{"response":"A","success":true}}'

# 2. Read it back → expect 200 with the statement (and an "authority" = key name)
curl -s -u "$AUTH" "$LRS/statements?statementId=$ID" -H 'X-Experience-API-Version: 1.0.3'

# 3. Re-send identical → expect 204, still only one statement stored
# 4. Re-send same id with "success":false → expect 409 Conflict
```

Record the actual status codes in the [setup record](#setup-record). Steps
3–4 confirm the idempotency behaviour that our re-export design relies on
(see [Idempotency and re-export](#idempotency-and-re-export)). If Veracity
behaves differently, the referee-facing error handling in Step 1c must
follow what it actually does.

### Step 5 — Viewing results (mapping to Q1–Q6)

| Need | Where in Veracity | How |
| --- | --- | --- |
| Q1 game timeline | **xAPI Data → Statements** | Search/filter on the `registration` or game activity id, sort by timestamp. Toggle the **Results** and **Context** columns on. |
| Q2 game scores | **xAPI Data → Statements** | Filter verb = `scored` and the game activity |
| Q3 progress over time | **Analytics** (e.g. "LRS Overview" dashboard) | **If available on the free tier**, set scope to the learner and a time range. Otherwise use the CSV export of `scored` statements → spreadsheet chart. |
| Q4 weak questions | **Analytics** (activity widgets), or CSV export | Filter `answered` + `success = false`, group by object |
| Q5 speed / Q6 distractors | CSV export | `result.duration` / `result.response` columns in a spreadsheet |
| Raw JSON for debugging | **xAPI Data → Statements** → click a row | Shows the full statement as stored |

Export: in the statement viewer, the **"…"** menu downloads CSV
(requirement 9). Dashboard widgets also export JSON/CSV/Excel.

> ⚠️ Widgets also offer an **embed** link, which makes that data
> **public**. Never use it on `emojiapp-pilot`.

**This settles the "does the free tier have dashboards?" question.** Open
**Analytics** on `emojiapp-dev` after the first exports and note in the
[setup record](#setup-record) whether dashboards are available. If they
aren't, the CSV route covers Q3–Q6 for a single-learner pilot. Watershed
Essentials remains the fallback if spreadsheets become a chore.

### Step 6 — Housekeeping

- **Clear `dev`/`sandbox`** via the LRS management page ("clear xAPI data")
  whenever the statement shape changes. That removes old-shape statements
  that would otherwise cause 409s on re-export (requirement 7).
- **Before the pilot starts**, check the generated statements contain no
  email and no first name, only the `account` actor (`security.md` D3).
  Base IRI and actor format are both decided.
- **Removing a person's data** from `emojiapp-pilot`: standard xAPI has
  no delete, only *voiding* (the statement is hidden but still stored). Real
  deletion means clearing the LRS, or asking Veracity support. Acceptable
  for a personal pilot; revisit before a class pilot.
- **Rotate keys** if they're ever exposed: create a new key, update `.env`,
  then delete the old key.

### Setup record

Fill in as the setup is done:

| Item | Value |
| --- | --- |
| Dev LRS name / endpoint | |
| Sandbox LRS name / endpoint | |
| Pilot LRS name / endpoint | |
| Strict API Mode on (all three)? | |
| Keys created (names only, never secrets) | |
| Smoke test: PUT / GET / identical re-send / changed re-send status codes | |
| Analytics dashboards available on free tier? | |
| Base IRI decided | `https://kogs.link/xapi/emoji-app` ✅ |
| Actor format decided | `account` + `externalId`, no email/name ✅ (2026-10-09) |
| Veracity hosting region(s) / AU hosting possible? | **Yes (assumed for the prototype, 2026-10-09; not yet confirmed by Veracity)** |
| Veracity DPA + sub-processor list available? | **Yes (assumed for the prototype; not yet confirmed)** |
| Veracity per-actor permanent deletion? (how, how fast, backups) | **Yes (assumed for the prototype; not yet confirmed)** |

> The three Veracity answers above are working assumptions so the
> prototype can proceed on Veracity alone (`security.md` D12). Confirm
> them with Veracity after funding and before any school pilot. If any
> turns out to be no, the school pilot moves to a self-hosted SQL LRS in
> `ap-southeast-2`.

---

## Additions to Milestone 1 implied by this doc

These are refinements within `xapi-export-plan.md`'s existing scope, not new
features:

- [ ] Stable UUID v5 statement IDs and a per-game `context.registration`.
- [ ] `answered` statements include the `choice` interaction definition,
      `result.response` and `result.duration`.
- [ ] `scored` statements include `result.score.scaled`.
- [ ] `timestamp` = event time (guess time / game end), not export time.
- [ ] Config `XAPI_LRS_ENDPOINT` / `XAPI_LRS_KEY` / `XAPI_LRS_SECRET`
      (Veracity `dev` LRS in development); add placeholders to
      `.env.example`.
- [ ] Handle a 409 from the LRS as "already exported with a different
      shape" in the referee-facing error.

## Open questions

- Veracity Free: does it include dashboards or only the statement viewer?
  The pricing page and other summaries disagree; this gets answered at
  [Step 5](#step-5--viewing-results-mapping-to-q1q6) of the Veracity setup.
- Veracity: confirm the identical re-send and changed re-send status codes
  ([Step 4](#step-4--smoke-test-before-any-code)).
- Do we want word-level tracking across games (Q4 across games) soon? If
  so, the question model needs a content ID first.

---

## Sources (checked October 2026)

- [Veracity Learning user manual: basics (create LRS, access keys, statement viewer, analytics)](https://laureate.lrs.io/docs/manual/basics/)
- [Learning Locker pricing (GetApp)](https://www.getapp.com/hr-employee-management-software/a/learning-locker/) ·
  [Learning Pool on UK G-Cloud](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/137575071396193)
- [LRS platforms compared 2026 (ProProfs)](https://www.proprofstraining.com/blog/learning-record-store-lrs/) ·
  [Best LRS software 2026 (Visme)](https://visme.co/blog/learning-record-store/)
- [Veracity LRS pricing](https://lrs.io/home/lrs-pricing) ·
  [Veracity Learning Lite](https://veracity.it/veracity_learning_lite_free_xapi_learning_record_store_lrs)
- [Watershed Essentials free LRS](https://www.watershedlrs.com/blog/product/product-updates/watershed-essentials/)
- [SCORM Cloud LRS](https://rusticisoftware.com/products/scorm-cloud/lrs/) ·
  [SCORM Cloud pricing FAQ](https://rusticisoftware.com/products/scorm-cloud/pricing/) ·
  [SCORM Cloud xAPI support](https://support.scorm.com/hc/en-us/articles/115000064854-New-and-Improved-xAPI-support-for-SCORM-Cloud)
- [Yet Analytics SQL LRS (GitHub)](https://github.com/yetanalytics/lrsql) ·
  [SQL LRS docs](https://yetanalytics.github.io/lrsql/)
- [Learning Locker (GitHub)](https://github.com/LearningLocker/learninglocker) ·
  [Learning Locker pricing (Capterra)](https://www.capterra.com/p/197797/Learning-Locker/pricing/)
