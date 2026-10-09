# Security and privacy: player identity, xAPI export, children's data

Status: **design decided, not yet implemented.** The
[decisions below](#decisions-2026-10-09) were agreed on 2026-10-09, before
any code.

> **Prototype first (D12, decided 2026-10-09).** The current focus is
> establishing the **rules and play flow of the new "learning sport"**.
> Only the cheap, one-way-door parts of this doc apply now. Everything
> else (access-control build-out, consent, Australian hosting, deletion,
> ST4S, SOC 2) is **deferred until the prototype is funded**. Deferring
> is safe because of the [prototype guardrails](#prototype-guardrails-d12).
> See [Phasing](#phasing-whats-needed-when). This doc sets what Milestone 1 (`xapi-export-plan.md`) and
anything after it must satisfy. It isn't legal advice: before a school
pilot, the regulatory points below need checking with someone qualified
for the jurisdiction concerned.

Related:

- [`xapi-export-plan.md`](./xapi-export-plan.md) — Milestone 1. Step 0
  implements the access-control decisions here; Step 1a the player
  identity.
- [`LRS.md`](./LRS.md) — actor format in xAPI statements, Veracity setup
- [`../auth.md`](../auth.md) — Cognito setup (currently protects only
  `POST /api/chat`)
- `server/src/auth.ts`, `server/src/main.ts`, `server/src/*.controller.ts`,
  `server/src/badge-state.service.ts`,
  `server/src/request-logging.middleware.ts`,
  `server/src/persistence/models.ts` — current state referenced below
- `rainbow-connection/python/emoji-os/emoji-os-zero.py` — the Zero station,
  which calls the device endpoints

---

## Why this matters now

The pilot starts as one adult learner (personal Korean vocabulary), but the
stated next step is a teacher's class, and **school children could be
playing**. Once a child's name or learning record is stored, or sent to a
third party (Veracity, OpenAI), we're handling children's personal data.
The rules for that are much stricter, and much harder to retrofit than to
design in. So identity, access control, audit logging and data isolation
are decided here, before the `Player` record and export are coded.

---

## Decisions (2026-10-09)

| # | Decision |
| --- | --- |
| D1 | **The referee is the only person who logs in** (plus us as platform admins). Players never log in and never have accounts. Spectators never log in. |
| D2 | **The referee is the trust anchor for identity.** They know the children by name and match each child to the badge they're handed. Only the referee binds badges to players. |
| D3 | **No email and no real name go to the LRS.** The xAPI actor is an `account` holding a random `externalId`. This applies to every player, adults included, so there's one code path. |
| D4 | **The `Player` record has no email field.** It holds a first name (or whatever label the referee recognises), the random `externalId`, and its organisation. |
| D5 | **Three route prefixes, each with its own authentication:** `/api/*` for referees and admins (Cognito login, the default), `/api/public/*` for spectators (no login, share code), `/api/device/*` for stations and badge relays (device credential). The WebSocket is split the same way. |
| D6 | **Spectators get in with a share code**, not a login. The code is issued per game by the referee, **expires**, and is **read-only** and **rate-limited**. |
| D7 | **Spectators see badges, not children,** by default. The referee can opt in **per game** to show first names to spectators. It's **off by default**. |
| D8 | **Organisation first means the teacher; schools come later.** An `Organisation` is a container with members, never the same thing as a user, so a teacher's org can later sit inside, or be merged into, a school org without changing player IDs. Individual learners use the same model as an org of one. See [Tenants](#tenants-organisations). |
| D9 | **The referee supplies the class list** (a teacher, school staff member or individual). There's no school-system integration. Manual entry first; pasting a list of first names comes later. |
| D10 | **Security limits are server configuration:** spectator expiry, rate limits and lockouts live in one server config module with env overrides. The **device contract** (routes, WebSocket paths, message types) is the part shared with the station code. See [Configuration](#configuration-and-the-device-contract). |
| D11 | **Australia first.** Privacy Act / APPs, the OAIC Children's Online Privacy Code and ST4S are the target. Other jurisdictions wait until the project is funded. See [Australia first](#australia-first-what-applies). |
| D12 | **Prototype first; heavy lifting after funding.** Now: the learning sport's rules and play flow, plus the cheap, permanent decisions (D2–D4, D7 default). Deferred until funded: Step 0 access control (D5, D6, device credentials, WebSocket split), audit log, tenancy build-out, parental consent, AU-hosted LRS, per-actor deletion, ST4S, SOC 2. |
| D13 | **`emoji-os` stays in `rainbow-connection` for now.** The move into the emoji-app repo and the shared device-contract file are deferred with Step 0. |

---

## Current state (as of 2026-10-09)

What the code does today, as checked against `server/src`:

| Area | Today | Risk once player identity exists |
| --- | --- | --- |
| API authentication | Only `POST /api/chat` uses `requireAuth`. All game endpoints are **unauthenticated**: `POST /api/games`, `/games/:id/state`, `/guesses`, `/questions`, `/games/:id/pairs`, `GET /games/:id/scores`, `/guess-chart`, `/badges`, etc. | Anyone who finds `emoji-staging.kogs.link` can create games, submit guesses, read scores and, once Step 1a lands, read or assign players. |
| WebSocket `/ws` | One open channel. `badge-state.service.ts` broadcasts **every event for every game** to every connected dashboard, and stations connect to the same path. | Anyone can connect and watch all games. Once events carry player labels, children's names would be broadcast publicly. |
| Caller identity | `requireAuth` verifies the Cognito token but **doesn't attach** who the caller is (`sub`, groups) to the request. | No way to enforce "only this game's referee may…" or to write a meaningful audit entry. |
| `createdByUserId` | Taken from the **request body** (`game-flow.controller.ts`), so it's client-asserted. | Anyone can claim to be anyone. Audit records would be untrustworthy. |
| Roles | `GameParticipant.role` (`player`/`referee`/`spectator`) exists as data, but nothing enforces it. | — |
| Devices (Zero stations, badges) | Call `POST /api/guesses`, `/api/status`, `/api/emoji`, `/api/games/:id/join`, `/api/games/:id/readiness`, `GET /api/pairs/:pairName`, `/api/nfc-cards` and `/ws` with no device credential. | A spoofed device could submit guesses as any badge, corrupting a child's learning record. |
| CORS | `cors()` with defaults (any origin). | Any website can call the API from a visitor's browser. |
| Request logging | Bodies are omitted in production; field redaction covers secrets and tokens. | The redaction pattern doesn't cover `name`/`firstName`/`displayName`. Fine while body logging is off in prod, but dev logs could capture names. |
| Tenancy | Single shared database. No organisation or school concept. | One school's referee could see another school's players. |
| AI chat | The chat panel's tools can read app state and send it to OpenAI. | If tools can reach player names, children's data goes to OpenAI. |

**None of this is a problem for the current demo, which has no personal
data.** All of it has to be fixed before a child's identity is stored.
`xapi-export-plan.md` Step 0 does that.

---

## SOC 2: what it means for us

SOC 2 isn't a law or a certificate you can design your way into. It's an
**independent auditor's report** on whether an organisation's controls meet
the AICPA Trust Services Criteria:

- **Security** is mandatory.
- **Availability, Confidentiality, Processing Integrity and Privacy** are
  optional.

A **Type II** report covers controls *operating over a period* (typically
3–12 months), and schools and districts increasingly ask edtech vendors
for one. For a prototype the realistic goal is **"SOC 2-ready by design"**:
build so that the controls an auditor would test already exist and leave
evidence.

The criteria that bear directly on player identity and xAPI:

| Criteria | What an auditor looks for | Where it lands in this doc |
| --- | --- | --- |
| **CC6** Logical access | Authenticated users, least privilege, role-based authorisation, access reviews, MFA for privileged users, revoking access promptly | [Access control](#access-control), [Spectators](#spectators-and-public-access) |
| **CC7** System monitoring | Security-relevant events logged, logs protected and retained, anomalies noticed | [Audit logs](#audit-logs) |
| **CC8** Change management | Reviewed changes, separate environments, no production data in dev | [Data isolation](#data-isolation) → environments |
| **CC9** Vendor risk | Known subprocessors, contracts/DPAs, assessed risk (Veracity, OpenAI, MongoDB host, AWS) | [Third parties](#third-parties-subprocessors) |
| **C1** Confidentiality | Confidential data identified, protected, and disposed of when no longer needed | [Identity model](#identity-model), [Retention](#retention-and-deletion) |
| **P1–P8** Privacy | Notice, consent, collection limited to purpose, use/retention/disposal, data-subject access, disclosure to third parties only as notified, data quality, complaints | Throughout, especially the identity model |

### Children's privacy law sits on top of SOC 2

SOC 2 doesn't replace these, and a school will ask about them first.
**Australia is the first target (D11)**, detailed in the next section.
Other regimes are noted for later:

- **US (later):**
  - **COPPA**: under-13s, with verifiable parental consent; for schools,
    teacher/school consent in the educational context. The 2025
    amendments add a written data-retention policy and separate consent
    for disclosure to third parties.
  - **FERPA**: education records, with the vendor acting as a "school
    official" under the school's control.
  - State student-privacy laws, such as California's SOPIPA.
- **UK/EU (later):** GDPR / UK GDPR (children's data needs a lawful
  basis, and DPIAs are expected) and the UK **Age Appropriate Design
  Code**.

The common thread in all of these, and in SOC 2's Privacy criteria:
**collect the minimum, keep it under the school's control, disclose it to
as few third parties as possible, and be able to delete it.** Decisions
D1–D7 are built around that.

### Australia first: what applies (D11)

Checked October 2026. This is a design checklist, not legal advice.

| Instrument | What it means for us |
| --- | --- |
| **Privacy Act 1988 / Australian Privacy Principles (APPs)** | Collection limited to what's necessary (APP 3), notice (APP 5), use and disclosure (APP 6), **cross-border disclosure (APP 8)**: we stay accountable for what an overseas recipient like a US-hosted LRS does with the data. Also security (APP 11) and access and correction (APPs 12–13). The small-business exemption (turnover under $3M) may technically apply to us now, but don't rely on it: the Children's Code and school contracts expect APP-level handling regardless. |
| **Notifiable Data Breaches scheme** | An eligible breach must be assessed within 30 days and notified to the OAIC and affected individuals. The audit log and incident runbook support this. |
| **OAIC Children's Online Privacy Code** (exposure draft 31 Mar 2026; must be registered by **10 Dec 2026**; compliance date not yet set) | It explicitly covers online services such as **apps, games and educational tools** likely to be accessed by children. Key draft obligations:<ul><li>Privacy by default: only "strictly necessary" collection.</li><li>Collection, use and disclosure must be in the **child's best interests**.</li><li>**Under-15s need parental consent**, with reasonable steps to verify it, and consent is refreshed every 12 months.</li><li>**On request, personal information must be destroyed, not just de-identified.**</li></ul> |
| **Safer Technologies 4 Schools (ST4S)** (Education Services Australia) | A voluntary national assessment of edtech privacy, security and safety, endorsed by every Australian school sector. Many schools prefer or require ST4S-assessed products. **This is the practical "compliance badge" for Australian schools**, more relevant than SOC 2 for a first school pilot. |
| **State education department rules** | Schools often run their own privacy impact assessment before adopting a tool, and may require data to stay in Australia. Ask the first school what their process is. |

**What this changes in our design:**

1. **Destruction, not just unlinking.** If the draft Code's "destroy on
   request" survives into the registered Code, deleting the `Player`
   mapping isn't enough. Pseudonymous statements in the LRS are still
   personal information. We'd need to **delete a player's statements from
   the LRS**, which standard xAPI can't do (voiding only hides them). So
   the LRS for a school pilot must support per-actor deletion: either a
   vendor admin feature or a self-hosted LRS where we control the
   database. See [Retention and deletion](#retention-and-deletion).
2. **Data residency.** The pilot LRS (Veracity) is a US company on
   US-fronted infrastructure (see [Third parties](#third-parties-subprocessors)).
   That's an APP 8 cross-border disclosure. It's acceptable for the adult
   personal pilot, but likely unacceptable to an Australian school. A
   school pilot should use an LRS in `ap-southeast-2`, such as SQL LRS on
   our existing AWS account, unless Veracity can show AU hosting and a
   DPA.
3. **Consent for under-15s.** For school use, how parental consent is
   obtained (by the school, as part of their normal digital-tools consent,
   or by us) needs settling with the first school. Our design should
   record per-player consent status and date, entered by the referee, and
   block export for players without it.
4. **Plan for an ST4S assessment** before approaching schools beyond a
   friendly pilot. Its questionnaire overlaps heavily with this doc.

---

## Identity model

### Why not emails (background to D3/D4)

The original plan gave each `Player` a `name` + `email` and left open
whether xAPI statements would identify them by `mbox` (email). For
children, that raised these issues:

| Issue | Why it matters |
| --- | --- |
| **Email is direct PII and often not available.** | Many younger children have no email. School-issued ones are managed by the school, and collecting them adds consent and notice obligations. We don't *need* a child's email to run a game or record progress. |
| **`mbox` in xAPI statements sends the email to Veracity permanently.** | xAPI has no hard delete, only voiding, so an email in a stored statement can't really be erased. Disclosure to a third party also needs notice and consent. |
| **`mbox_sha1sum` doesn't anonymise.** | Email hashes are trivially reversible by guessing likely addresses (`firstname.lastname@school`). |
| **The actor `name` field leaks identity.** | Even with an `account` identifier, putting a child's real name in `actor.name` sends it to Veracity. |
| **Mongo ObjectIds as external IDs.** | They're partly predictable (timestamp + counter) and are our internal keys. External identifiers should be separate random values. |
| **"Anonymous player"** | Truly anonymous play (no identity at all) means no learning record per child, which defeats the point of xAPI. We want **pseudonymous** players whose real identity is known only to the referee. |

A random player ID is **pseudonymous, not anonymous**. Our database maps
it to a first name, so the LRS data is still personal data (GDPR's
definition of pseudonymised data). That's fine, but the mapping must be
protected, and deleting it is how erasure works.

### The model

1. **Players never log in (D1).** A player is a record the **referee**
   creates in their own organisation (see
   [Data isolation](#data-isolation)). Children never enter anything into
   the system.
2. **`Player` fields (D4):**
   - `firstName`: what the referee recognises. A first name, nickname or
     class code; **no surnames**. Shown to the referee and, only if the
     game opts in, to spectators (D7).
   - `externalId`: a **random UUID v4**, generated once, used only as the
     xAPI actor identifier. Not the Mongo `_id`.
   - `orgId`: the owning organisation.
   - `createdByUserId`: the referee, taken from the login token.
   - **No email field.** This applies to everyone, including the adult
     personal pilot, so there's one code path.
   - `consent` (needed before a school pilot, not for the adult pilot):
     status (`not-required` | `pending` | `granted` | `withdrawn`), date,
     and who recorded it. The referee enters it. Export is blocked for
     children without `granted`. This follows the Australian draft
     Children's Code's parental consent for under-15s (see
     [Australia first](#australia-first-what-applies)).
3. **xAPI actor = `account` only (D3):**

   ```json
   "actor": {
     "objectType": "Agent",
     "account": { "homePage": "https://kogs.link", "name": "<Player.externalId>" }
   }
   ```

   - **No `mbox`, no real name.** `actor.name` is omitted, or set to a
     non-identifying label derived from `externalId` (e.g. `"Player 7F3A"`)
     so the Veracity viewer stays readable.
   - The mapping `externalId → firstName` exists **only in our database**,
     visible to the referee who owns it.
   - To find a child's records in Veracity, the referee looks up their
     label (e.g. `Player 7F3A`) in our app and searches for it in Veracity.
4. **Unlinking as deletion.** To erase a child's data, delete or anonymise
   their `Player` record. The LRS statements stay but can no longer be
   tied to a person (a "mapping deletion"). Optionally also void their
   statements or clear the LRS. This works only because no direct
   identifier ever went to the LRS.
5. **Badges and stations never hold PII.** The badge shows emoji/colours,
   the station knows `badgeName`/`stationName`, and player identity is
   joined only on the server.

### Referee-mediated badge ↔ player binding (D2)

The referee turns "whoever is holding badge-red" into "Mia (player 7F3A)":

1. The referee **signs in** (Cognito, MFA recommended) and opens a game
   they are the **referee of**, in their own org.
2. The referee picks players from **their org's roster**, or adds a new
   player (first name only).
3. The referee **hands each child a badge and binds it** to that child's
   player record, either by selecting the badge in the UI or by tapping it
   at a station. They visually confirm the right child holds the right
   badge; this is a supervised, in-person step.
4. The binding is stored with **who did it and when**. Swaps and
   replacements are new records with a reason, never overwrites.
   `playerBadgeAssignment` in `models.ts` already has
   `assignedAt`/`unassignedAt`/`reason` (`initial`/`swap`/`replacement`).
   Reuse that pattern, pointing at `Player` rather than `User`, plus an
   `assignedByUserId` taken from the token.
5. A guess is attributed to whoever the badge was bound to **at the time of
   the guess** (bindings are time-ranged), so a mid-game swap doesn't
   reassign earlier guesses.
6. **Export** is allowed only for a `completed` game, only by that game's
   referee, and only if every badge with guesses has a binding.

Accepted risk: **a badge is a bearer token.** Whoever holds it plays as
the bound player. In a supervised classroom with the referee confirming
bindings, that's acceptable and proportionate. It's recorded here as a
known risk rather than engineered around.

---

## Access control

### Route prefixes (D5)

Authentication is decided by **URL prefix**, with one middleware per
prefix. A new route can only be public if it's deliberately placed under
`/api/public`. Forgetting to add a check can't make it public.

| Prefix | Caller | Authentication | Methods |
| --- | --- | --- | --- |
| `/api/*` (default) | Referee, platform admin | Cognito access token (`Authorization: Bearer`) → `req.user = { sub, groups, orgId }` | All |
| `/api/public/*` | Spectator | Share code (see [Spectators](#spectators-and-public-access)) | `GET` only |
| `/api/device/*` | Zero station, badge relay | Per-device credential | Only the device endpoints listed below |
| `GET /api/version`, health check, static SPA | Anyone | None | `GET` |

Everything under `/api/*` that isn't one of the explicit exceptions
requires a login. The global middleware **rejects by default**.

**Device endpoints.** These are the station calls that exist today
(`emoji-os-zero.py`), moved under `/api/device/*`:

| Today | Becomes |
| --- | --- |
| `POST /api/guesses` | `POST /api/device/guesses` |
| `POST /api/status` | `POST /api/device/status` |
| `POST /api/emoji` | `POST /api/device/emoji` |
| `POST /api/games/:gameId/join` | `POST /api/device/games/:gameId/join` |
| `POST /api/games/:gameId/readiness` | `POST /api/device/games/:gameId/readiness` |
| `GET /api/pairs/:pairName` | `GET /api/device/pairs/:pairName` |
| `GET /api/nfc-cards` | `GET /api/device/nfc-cards` |
| WebSocket `/ws` | `/ws/device` |

If any of these are also used by the referee UI (e.g. `/api/nfc-cards`),
keep a referee version under `/api/*` as well, rather than letting one
route accept both kinds of credential.

### WebSocket channels

The single `/ws` broadcast becomes three channels, mirroring the HTTP
prefixes:

| Channel | Caller | Authentication | Receives |
| --- | --- | --- | --- |
| `/ws/referee` | Referee UI | Cognito access token, sent in the **first message** (not the URL, which ends up in logs) | Full events for games the referee owns, including first names |
| `/ws/public` | Spectator view | Share code in the first message | **Spectator-safe** events for that one game only |
| `/ws/device` | Stations | Device credential in `controller.hello` | Events for the station's bound game |

`badge-state.service.ts` must stop broadcasting every event to every
client. Instead it sends each event only to subscribers of that game,
**projected per audience** (see the spectator projection below).

### Roles

| Role | Who | Authenticates via | Scope |
| --- | --- | --- | --- |
| **Platform admin** | Us | Cognito + MFA (required) | All orgs. Break-glass only, every access audited. |
| **Referee** | Teacher or game runner who knows the children | Cognito (MFA recommended) | Own org: roster, own games, badge binding, export. For now the referee also performs org-owner actions (roster edits, erasure). A separate org-admin role is deferred until a school has several referees. |
| **Spectator** | Classroom projector, parents, other students | **Share code, no login** | One game, read-only, spectator-safe data |
| **Device** | Zero station, badge relay | Per-device credential | Device endpoints for the game it's bound to |
| **Player** | Child | **None** | — |

Roles come from **Cognito groups** (`platform-admin`, `referee`) plus an
org membership record, carried in the access token and attached to the
request by `requireAuth`.

### Authorisation rules

| Action | Platform admin | Referee (own org / own game) | Spectator (valid share code) | Device | No credentials |
| --- | --- | --- | --- | --- | --- |
| Create/edit roster (`Player`) | ✅ (audited) | ✅ | ❌ | ❌ | ❌ |
| See first names | ✅ (audited) | ✅ | Only if the game opts in (D7) | ❌ | ❌ |
| Create game / change state | ✅ | ✅ | ❌ | ❌ | ❌ |
| Bind badge ↔ player | ❌ | ✅ | ❌ | ❌ | ❌ |
| Issue / revoke share code; toggle first-name opt-in | ❌ | ✅ | ❌ | ❌ | ❌ |
| Submit guess, status, join/readiness | ❌ | ❌ | ❌ | ✅ bound game only | ❌ |
| View game, scores, guess chart (full) | ✅ | ✅ | ❌ | ❌ | ❌ |
| View game, scores (spectator projection) | — | — | ✅ | ❌ | ❌ |
| Export to LRS | ❌ | ✅ | ❌ | ❌ | ❌ |
| Delete player / erasure | ✅ | ✅ | ❌ | ❌ | ❌ |
| Read audit log | ✅ | ✅ own org | ❌ | ❌ | ❌ |

### Other required changes

1. **Attach identity.** `requireAuth` sets `req.user = { sub, groups, orgId }`
   from the verified token. Every "who did this" field (`createdByUserId`,
   `assignedByUserId`, the audit `actor`) comes from `req.user`, **never
   from the request body**.
2. **Role and ownership checks** in a guard/helper per the table above,
   including "is this caller the referee of this game in this org".
3. **Device credentials.** Each station gets its own secret (API key or
   signed token), stored **hashed** server-side, scoped to its station
   name, and revocable. The station script reads it from local config,
   never from source control.
4. **CORS** restricted to the app's own origin(s)
   (`https://emoji-staging.kogs.link` plus localhost in dev). Public
   spectator pages are served from the same origin, so they need no extra
   CORS rule.
5. **MFA** required in Cognito for `platform-admin`, recommended for
   `referee`.
6. **LRS credentials stay server-side** (env / Secrets Manager, never sent
   to the browser). Veracity keys follow least privilege (`LRS.md` Step 2).
7. **AI chat:** chat tools must not expose first names or roster data to
   OpenAI. Default to badge names and pseudonymous labels only.
8. **Access reviews:** a periodic (e.g. quarterly) check of who's in the
   `platform-admin`/`referee` groups. A SOC 2 control, cheap if group
   membership is the source of truth.

---

## Spectators and public access

Spectators watch a game **without logging in (D6)**: a classroom
projector, a parent's phone, other students.

### Share code

- The referee turns on **"Allow spectators"** for a game. The server
  generates a **share code**: random, at least ~50 bits of entropy, from
  an unambiguous alphabet, e.g. `K7PQ-X4M9-TR`. The link is
  `https://<host>/spectate/K7PQ-X4M9-TR`, and the UI also shows it as a QR
  code for the projector.
- The code is **not** the game ID. Game IDs are partly predictable and
  would let someone browse other games.
- Stored as a `SpectatorAccess` record: `gameId`, `orgId`, **hash** of the
  code, `createdByUserId`, `createdAt`, `expiresAt`, `revokedAt`. Only the
  hash is stored, so a database leak doesn't hand out live links.
- **One active code per game.** The referee can **revoke** it or
  **regenerate** it (which revokes the old one) at any time, e.g. if the
  link was shared too widely.

### Expiry

- A code is valid from issue until **a set time after the game
  completes**. The default is 2 hours after `completed`, and 24 hours after
  issue at most if the game never completes. The exact values are a config
  setting.
- After expiry or revocation, public endpoints return **404** (not 403), so
  they reveal nothing about whether the game exists. Open public WebSocket
  connections are closed.

### Read-only

- `/api/public/*` accepts **`GET` only**. Any other method returns 405.
- Public handlers use their own **spectator projection**. They are
  separate handlers, not the referee endpoints with authentication
  removed, so new referee fields can't leak by accident.

**Spectator projection.** This is what a spectator can see:

| Included | Never included |
| --- | --- |
| Game title, state | Player `externalId`, Mongo IDs of players |
| Current question text and options (while open) | Emails (none exist), surnames (none exist) |
| Per badge: badge name, colour/emoji, joined/answered yes/no | Card UIDs, station credentials, NFC group details |
| Correct answer and per-badge right/wrong, **after** the question closes | Referee identity |
| Leaderboard **by badge** ("🔴 Red: 7") | First names, **unless** the game opts in (D7) |

### First-name opt-in (D7)

- A per-game flag, `spectatorsSeeFirstNames`, **default `false`**. Only
  that game's referee can set it, and turning it on is audited.
- When it's on, the projection adds `firstName` next to each badge. The
  referee UI warns: *"Anyone with the spectator link will see these first
  names."*
- It applies only to that game and resets for each new game. Nothing about
  it carries over.
- The setting never affects the LRS. Statements never contain names
  either way (D3).

### Rate limiting

The numbers below are **defaults in server config**, not constants in
code (see [Configuration](#configuration-and-the-device-contract)).

- `/api/public/*` is limited **per IP** (e.g. 60 requests/minute) and
  **per share code** (e.g. 600 requests/minute across all viewers).
- `/ws/public` caps concurrent connections **per share code** (e.g. 100).
  That covers a class of viewers but limits a widely leaked link.
- Repeated invalid share codes from one IP are slowed down and then
  blocked (e.g. 10 failures in 10 minutes), to stop people guessing codes.
- An in-process limiter is enough for a single ECS task. A shared store
  (Redis) or AWS WAF rate rules are needed only if we scale out.

### Configuration and the device contract (D10)

Two different things are easily confused here:

- **Security limits (server-only).** Spectator expiry, rate limits,
  connection caps and lockout thresholds are enforced only by the server.
  The station code never needs them. They live in **one server config
  module** (e.g. `server/src/config/security.config.ts`) with documented
  defaults and env overrides, so staging and production can differ
  without a code change:

  | Setting | Default | Env override |
  | --- | --- | --- |
  | Share code valid after game completes | 2 h | `SPECTATE_EXPIRY_AFTER_COMPLETE_MIN` |
  | Share code maximum lifetime | 24 h | `SPECTATE_MAX_LIFETIME_MIN` |
  | Public requests per IP | 60/min | `PUBLIC_RATE_PER_IP_PER_MIN` |
  | Public requests per share code | 600/min | `PUBLIC_RATE_PER_CODE_PER_MIN` |
  | Public WebSocket connections per code | 100 | `PUBLIC_WS_MAX_PER_CODE` |
  | Invalid-code lockout | 10 failures / 10 min | `PUBLIC_INVALID_CODE_LIMIT`, `PUBLIC_INVALID_CODE_WINDOW_MIN` |

- **Device contract (shared).** What *is* shared between the server and
  the station code is the protocol:
  - route paths (`/api/device/...`)
  - WebSocket paths (`/ws/device`)
  - message types (`controller.hello`, `game.opened`, ...)
  - slot labels and credential header names

  Today these are hand-copied between `emoji-app` and
  `rainbow-connection`, and a copy of `emoji-os-zero.py` even sits in
  `emoji-app/docs/python/`. A single machine-readable contract (e.g.
  `contract/device-contract.json`, read by both the TypeScript server
  and the Python station) removes that drift. It works best in one
  repo, which the proposal below provides.

**Proposal, deferred (D13): move `emoji-os` into the emoji-app repo.**
For now it stays in `rainbow-connection`. Revisit when Step 0 is
scheduled after funding.

- **Why:** Step 0 changes both sides at once (device routes,
  credentials, WebSocket split). In one repo that's one reviewed change,
  with the contract file and tests covering both.
- **What:** move `rainbow-connection/python/emoji-os/` to
  `emoji-app/devices/emoji-os/`. It goes at the top level, not under
  `apps/`, because `apps/*` are npm workspaces and Python isn't. The
  move keeps git history (e.g. `git filter-repo --subdirectory-filter`
  then merge, or `git subtree add`).
- **After the move:**
  - Delete `emoji-app/docs/python/` copies.
  - Leave a pointer README in `rainbow-connection`.
  - Update the deploy/copy steps used to put scripts on the Pico/Zero.
- **When:** if adopted, before Step 0, so the station changes land with
  the server changes.

---

## Audit logs

### What gets logged

An **audit event** is written for every security- or privacy-relevant
action, separately from ordinary request logs:

| Category | Events |
| --- | --- |
| Authentication | Sign-in success/failure, MFA changes (from Cognito: enable Cognito/CloudTrail logging) |
| Roster / PII | Player created, first name changed, player deleted/anonymised, platform admin viewed an org's roster |
| Binding | Badge bound / unbound / swapped / replaced (who, game, badge, player, reason) |
| Game lifecycle | Game created, state changed (`active` → `completed`, etc.) |
| Spectators | Share code issued / revoked / regenerated / expired; first-name opt-in turned on/off; repeated invalid-code lockouts |
| Export | xAPI export requested: who, game, LRS (`dev`/`pilot`), statement count, result/HTTP status, 409s |
| Access control | Role/group changes, device credential issued/revoked, permission denied (403) on sensitive routes |
| Data subject | Access/erasure request received and completed |
| Secrets | LRS key rotation, Secrets Manager changes (CloudTrail) |

### Event shape

```json
{
  "_id": "…",
  "at": "2026-10-05T09:14:03.120Z",
  "orgId": "…",
  "actor": { "type": "user", "id": "<cognito sub>", "role": "referee" },
  "action": "badge.bound",
  "target": { "type": "game", "id": "<gameId>" },
  "details": { "badgeName": "badge-red", "playerExternalId": "<uuid>", "reason": "initial" },
  "requestId": "…",
  "ip": "…"
}
```

**Rules:**

- **IDs, not PII.** Audit details reference `playerExternalId`, never first
  names. The audit log itself mustn't become a PII store.
- **Append-only.** A separate `auditEvents` collection that the
  application's database user can **insert but not update or delete**,
  enforced by MongoDB role permissions, not just code. Later, also ship it
  to CloudWatch Logs or S3 with Object Lock for tamper evidence.
- **Written in the same operation as the action** (or the action fails),
  so there's no "bound but not audited".
- **Retention:** keep at least 12 months, which covers a SOC 2 Type II
  audit window. That's separate from, and longer than, gameplay data
  retention.
- **Readable** by the referee for their own org, and by platform admins.

### Request-log hygiene

`request-logging.middleware.ts` already omits bodies in production. Also:

- Add `name`, `firstName` and `displayName` to `SENSITIVE_FIELD_PATTERN`,
  so dev verbose logs don't capture names either.
- Never log share codes, device credentials, Veracity Basic Auth headers,
  or full LRS responses that echo statements. Log the share-code record ID
  instead of the code.
- Set a CloudWatch log-group retention (no unlimited retention).

---

## Data isolation

### Tenants (organisations)

- Introduce **`Organisation`** with a `type` (`individual` | `teacher` |
  `school`). Every tenant-owned document (`Game`, `Player`, binding,
  `SpectatorAccess`, `Question` sets, audit events) carries `orgId`.
- **Membership, not ownership (D8).** Users join an org through an
  `OrgMembership` record (`orgId`, `userId`, `role`: `owner` | `referee`).
  `orgId` is never a user's ID, and nothing assumes "one user = one org".
  - **First:** each teacher gets an org of type `teacher` and is its
    `owner`. An individual learner gets an org of type `individual`, and is
    both its referee and its only player.
  - **Later, schools** (this doesn't rule anything out):
    - **Absorb:** convert the teacher's org to type `school` and add other
      staff as members.
    - **Merge:** create a school org, then move the teacher's games and
      players into it by changing their `orgId` in one audited migration.
    - Either way, players keep their `externalId`, so their LRS history
      continues unchanged.
  - Optional nesting (a teacher org with a `parentOrgId` pointing at its
    school) can be added then if schools want class-level separation.
    Nothing now depends on it.
- **`orgId` always comes from the authenticated caller.** For referees
  that's the token; for spectators it's the share-code record; for devices
  it's the device credential. It's never taken from the request.
  Repository methods take `orgId` as a required parameter and always filter
  on it. Add tests asserting that a cross-org read returns 404, not 403,
  so nothing leaks about another org's games.
- Players belong to exactly one org. The same child in two schools is two
  players, and `externalId`s are never shared across orgs.
- Badges/devices are physical shared hardware. Bind them to an org (or to
  a game in an org) for the duration of use, and release them after, so a
  badge carried between schools doesn't carry identity with it.

### LRS isolation

- **Pilot:** one org (us), so one Veracity LRS (`emojiapp-pilot`). Fine.
- **Multiple schools:** one LRS per org (or per school group), each with
  its own keys. A single shared LRS would let any key with read access see
  every school's statements. Veracity's "Limited Read" only narrows reads
  to a key's *own* writes, which isn't org isolation. The free tier's
  3-LRS cap means multi-school use needs a paid plan or a self-hosted LRS.
  Decide that when a second org appears.
- Statements carry no PII (D3), so even a misrouted statement exposes only
  a pseudonymous ID.

### Environments

| Environment | Data allowed | LRS |
| --- | --- | --- |
| Local dev | Synthetic only | `emojiapp-dev` / `-sandbox` |
| Staging (`emoji-staging.kogs.link`) | **Today: also the pilot environment.** Fine for the personal (adult) pilot. | `emojiapp-pilot` |
| Production (to be created) | **The only place children's data may live** | Per-org LRS |

**Before a school pilot, stand up a separate production environment.**
Staging should go back to synthetic data only, because it's where
untested changes get deployed (CC8: no real data in non-production).
Never copy production data into dev or staging.

### Encryption and secrets

- In transit: HTTPS only (ALB with ACM cert, already in place), including
  `wss://` for all WebSocket channels. The LRS endpoint is HTTPS.
- At rest: MongoDB storage encryption (check the provider behind
  `MONGODB_URI`), encrypted EBS/S3 for anything else.
- Secrets: AWS Secrets Manager (already used for `MONGODB_URI`/OpenAI;
  extend to the LRS keys as in `LRS.md` Step 3). Rotate on staff changes
  or exposure.

---

## Third parties (subprocessors)

| Vendor | Receives | For children's data we need |
| --- | --- | --- |
| **Veracity** (LRS) | Pseudonymous statements only (no names or emails, D3) | See [Checking Veracity](#checking-veracity-dpa-and-data-location). Known so far: US company (Veracity Technology Consultants, LLC), hosted on AWS + MongoDB Atlas, `lrs.io` fronted by Cloudflare, EU–US Data Privacy Framework certified, FedRAMP environment available. **No published DPA, sub-processor list or hosting region found.** Fine for the adult pilot; for a school pilot, an AU-hosted LRS is the likely answer. |
| **OpenAI** (chat) | Whatever chat tools expose | Keep player data out of tools (access control, change 7). If that's impossible, OpenAI's DPA and zero-retention options. |
| **MongoDB host** | Everything, including the `externalId → firstName` mapping | DPA, region (prefer in-country for schools), encryption, backups |
| **AWS** (ECS, Cognito, Secrets Manager, CloudWatch) | Referee identities, logs | AWS DPA (standard), region `ap-southeast-2` |

Keep this list current: schools (and SOC 2 CC9) require a published
subprocessor list and notice when it changes.

### Checking Veracity: DPA and data location

What's public (checked 2026-10-09):

- The privacy policy (`veracity.it/privacy-policy`) covers the LRS and
  states EU–US Data Privacy Framework certification.
- Their support article on security practices says AWS runs the
  infrastructure and MongoDB Atlas the database.
- `lrs.io` resolves to Cloudflare IPs, so the edge is anycast. That says
  nothing about where the data is stored.
- No region, DPA, sub-processor list, deletion process or retention
  terms are published.

To find out the rest:

1. **Ask Veracity directly** through the support desk at
   `veracitytech.zohodesk.com` or the contact on `veracity.it`, from the
   account email. Ask:
   - Which AWS and MongoDB Atlas **regions** store lrs.io data, and can a
     tenant be hosted in **Australia** (`ap-southeast-2`)?
   - Is there a **Data Processing Agreement** for SaaS customers (including
     the free tier), and a **sub-processor list**?
   - Can we **permanently delete** all statements for a given actor
     (`account.name`), not just void them? Is it via the UI, an API or a
     support request, and how fast?
   - What happens to data on "clear LRS" and on account closure, including
     backups (how long until they're purged)?
   - Encryption at rest and in transit; breach notification commitments
     and timeframe.
   - Any certifications or reports (SOC 2, ISO 27001) beyond FedRAMP, and
     whether they cover lrs.io SaaS.
2. **Read their terms of service** for the SaaS plan: data ownership,
   licence to use data, termination and data return.
3. **Record the answers** in the [setup record](./LRS.md#setup-record) in
   `LRS.md`, and decide:
   - **AU hosting + DPA + per-actor deletion all yes:** Veracity can stay
     for a school pilot.

   **Status (2026-10-09):** for the prototype, all three are **assumed
   yes** and recorded that way in `LRS.md`'s setup record, so Veracity is
   the only LRS. They're **not yet confirmed by Veracity**, so asking them
   is deferred until after funding, before any school pilot.
   - **Any no:** the school pilot uses a self-hosted SQL LRS in
     `ap-southeast-2` (`LRS.md` → Options), and Veracity stays for
     dev/adult pilot only.

---

## Retention and deletion

- **Gameplay data:** a written retention policy per org (e.g. end of
  school year + N months), then delete it or anonymise the `Player`
  records. Required by COPPA's 2025 amendments, SOC 2 C1/P4, and the
  Australian APPs.
- **Erasure request:** the referee (as org owner) deletes or anonymises the
  `Player`. That unlinks the LRS data. The action is audited.
  - **For children (Australia, D11):** the draft Children's Code requires
    **destruction, not just de-identification**. So erasure must also
    **delete that player's statements from the LRS**: by vendor per-actor
    deletion if Veracity supports it, or directly in the database of a
    self-hosted LRS.
  - Voiding alone isn't enough. Design the erasure flow so this step
    exists from the start, even if it's manual for the pilot.
- **Spectator codes:** expired and revoked `SpectatorAccess` records are
  deleted after the audit retention period. Only hashes were stored anyway.
- **Org leaves:** export their data on request, then delete their org's
  records and their LRS (or clear it).
- **Audit events:** kept per the audit retention above, holding IDs only.

---

## Phasing: what's needed when

### Prototype guardrails (D12)

While the heavy lifting is deferred, these rules keep the prototype safe
without building it:

1. **No real children's personal data.** Playtests with children use
   badge names, colours or made-up nicknames as player names. Never
   surnames, and no other details. Real first names only for adults who
   choose to use their own.
2. **xAPI export to Veracity only for consenting adults** (e.g. the
   personal Korean-vocabulary pilot) or for pseudonymous playtest players
   from rule 1.
3. **The cheap, permanent decisions are built in from the start:**
   - no email field (D4)
   - `account` actor with random `externalId` (D3)
   - referee-only badge binding (D2), which is part of the play flow
     anyway
   - badges, not names, on shared screens by default (D7)

   These are hard to change later and cost almost nothing now.
4. **Staging is known to be open.** All game endpoints and `/ws` are
   unauthenticated (see [Current state](#current-state-as-of-2026-10-09)),
   so nothing sensitive goes into it until Step 0 lands.
5. **If a real school or children's pilot is proposed before funding,**
   the "After funding" column below becomes a prerequisite, not optional.

### Phasing table

| Requirement | Prototype (now) | After funding, before a school / children's pilot | Before a SOC 2 audit |
| --- | --- | --- | --- |
| Learning sport rules and play flow | ✅ **main focus** | — | — |
| `account` actor with random `externalId`, no `mbox`/name in statements (D3) | ✅ (one-way door) | ✅ | ✅ |
| `Player` = `firstName` + `externalId`, no email (D4) | ✅ | ✅ (+ `orgId`, consent) | ✅ |
| Referee-only badge binding (D2) | ✅ (part of play flow; `assignedByUserId` once auth exists) | ✅ | ✅ |
| Badges, not names, for spectators by default (D7) | ✅ | ✅ (+ per-game opt-in) | ✅ |
| Prototype guardrails above | ✅ | — (replaced by full controls) | — |
| Route prefixes + default-deny auth, identity from token (D5) | Deferred | ✅ required | ✅ |
| WebSocket split, per-game, per-audience events | Deferred | ✅ required | ✅ |
| Spectator share code, expiry, read-only, rate limit, projection (D6) | Deferred | ✅ required | ✅ |
| Device credentials (`/api/device/*`) | Deferred | ✅ required | ✅ |
| CORS restricted | Optional quick win | ✅ | ✅ |
| Append-only audit log | Deferred | ✅ | ✅ + tamper-evident storage, 12-month retention |
| `Organisation` + membership tenancy (D8), scoped repositories | Deferred | ✅ required | ✅ |
| Separate production environment | No | ✅ required | ✅ |
| Per-player consent status; export blocked without it | Deferred | ✅ required | ✅ |
| LRS in Australia with per-actor deletion | No (Veracity, assumed OK) | ✅ required (confirm Veracity or self-host) | ✅ |
| Erasure deletes LRS statements, not just the mapping | Manual if ever needed | ✅ | ✅ |
| Per-org LRS | No | ✅ (or justify single-org) | ✅ |
| Move `emoji-os` + shared device contract (D13) | No | Consider with Step 0 | — |
| ST4S assessment | No | Before wider school use | ✅ |
| MFA for admins, access reviews | Optional | ✅ | ✅ with evidence |
| Subprocessor list + DPAs, retention policy, privacy notice for schools | No | ✅ | ✅ |
| Written policies (incident response, access, change management), auditor | No | Recommended | ✅ |

---

## Where these decisions are applied

Also, from D8–D11:

- **`LRS.md`:** the recommendation notes that a school pilot needs an
  AU-hosted LRS with per-actor deletion, and the setup record has
  Veracity's DPA/region/deletion answers.

- **`xapi-export-plan.md`:**
  - New **Step 0 — access-control foundations** (D5–D7) comes before Step
    1a.
  - Step 1a uses the `Player` model (D4) and referee-only binding (D2).
  - The actor lock is `account` (D3).
- **`LRS.md`:** the actor is decided as `account` with
  `homePage: "https://kogs.link"` and `name: <Player.externalId>`. The
  example statements and smoke test are updated.
- **`moodle.md`:** a future Moodle join can't use email. It would need a
  referee-maintained mapping.
- **`../auth.md`:** notes the planned move from "protect `/api/chat` only"
  to route-prefix authentication.
- **Station code (`rainbow-connection/.../emoji-os-zero.py`):** must switch
  to `/api/device/*`, `/ws/device` and send its device credential. Its
  calls are listed in [Route prefixes](#route-prefixes-d5).

## Open questions

Resolved on 2026-10-09:
- who the org is (D8)
- who supplies class lists (D9)
- where spectator limits live (D10)
- which jurisdiction comes first (D11)
- prototype scope (D12)
- `emoji-os` location (D13)
- Veracity: assumed OK for the prototype

All remaining questions are **deferred until after funding**:

- **Veracity's real answers:** region, DPA, per-actor deletion (see
  [Checking Veracity](#checking-veracity-dpa-and-data-location)). The
  prototype assumes yes.
- **Parental consent for under-15s:** obtained by the school or by us?
- **Final Children's Code text** (due by 10 Dec 2026): re-check the
  destruction, consent and age provisions when it's registered.
- **ST4S assessment** timing.
- **Moving `emoji-os`** into the emoji-app repo with a shared device
  contract (D13).
