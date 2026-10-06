# Security and privacy: player identity, xAPI export, children's data

Status: **design requirements, written before any code.** Nothing here is
implemented yet. This doc sets what Milestone 1 (`xapi-export-plan.md`) and
anything after it must satisfy. It isn't legal advice: before a school
pilot, the regulatory points below need checking with someone qualified
for the jurisdiction concerned.

Related:

- [`xapi-export-plan.md`](./xapi-export-plan.md) — Milestone 1: `Player`
  record, badge → player assignment, export
- [`LRS.md`](./LRS.md) — actor identifier choice (`mbox` vs `account`),
  Veracity setup
- [`../auth.md`](../auth.md) — Cognito setup (currently protects only
  `POST /api/chat`)
- `server/src/auth.ts`, `server/src/*.controller.ts`,
  `server/src/request-logging.middleware.ts`,
  `server/src/persistence/models.ts` — current state referenced below

---

## Why this matters now

The pilot starts as one adult learner (personal Korean vocabulary), but the
stated next step is a teacher's class, and **school children could be
playing**. Once a child's name, email or learning record is stored, or sent
to a third party (Veracity, OpenAI), we're handling children's personal
data. The rules for that are much stricter, and much harder to retrofit
than to design in. So the identity model, access control, audit logging
and data isolation are decided here, before the `Player` record and export
are coded.

---

## Current state (October 2026)

What the code does today, as checked against `server/src`:

| Area | Today | Risk once player identity exists |
| --- | --- | --- |
| API authentication | Only `POST /api/chat` uses `requireAuth`. All game endpoints are **unauthenticated**: `POST /api/games`, `/games/:id/state`, `/guesses`, `/questions`, `/games/:id/pairs`, `GET /games/:id/scores`, `/guess-chart`, `/badges`, etc. | Anyone who finds `emoji-staging.kogs.link` can create games, submit guesses, read scores and, once Step 1a lands, read or assign players. |
| Caller identity | `requireAuth` verifies the Cognito token but **doesn't attach** who the caller is (`sub`, groups) to the request. | No way to enforce "only this game's referee may…" or to write a meaningful audit entry. |
| `createdByUserId` | Taken from the **request body** (`game-flow.controller.ts`), so it's client-asserted. | Anyone can claim to be anyone. Audit records would be untrustworthy. |
| Roles | `GameParticipant.role` (`player`/`referee`/`spectator`) exists as data, but nothing enforces it. | — |
| Devices (Zero stations, badges) | Post guesses and status with no device credential. | A spoofed device could submit guesses as any badge, corrupting a child's learning record. |
| CORS | `cors()` with defaults (any origin). | Any website can call the API from a visitor's browser. |
| Request logging | Bodies are omitted in production; field redaction covers secrets and tokens. | The redaction pattern doesn't cover `email`/`name`. Fine while body logging is off in prod, but dev logs could capture PII. |
| Tenancy | Single shared database. No organisation or school concept. | One school's referee could see another school's players. |
| AI chat | The chat panel's tools can read app state and send it to OpenAI. | If tools can reach player names, children's data goes to OpenAI. |

**None of this is a problem for the current demo, which has no personal
data.** All of it has to be fixed before a child's identity is stored.

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
| **CC6** Logical access | Authenticated users, least privilege, role-based authorisation, access reviews, MFA for privileged users, revoking access promptly | [Access control](#access-control) |
| **CC7** System monitoring | Security-relevant events logged, logs protected and retained, anomalies noticed | [Audit logs](#audit-logs) |
| **CC8** Change management | Reviewed changes, separate environments, no production data in dev | [Data isolation](#data-isolation) → environments |
| **CC9** Vendor risk | Known subprocessors, contracts/DPAs, assessed risk (Veracity, OpenAI, MongoDB host, AWS) | [Third parties](#third-parties-subprocessors) |
| **C1** Confidentiality | Confidential data identified, protected, and disposed of when no longer needed | [Data minimisation](#identity-model-emails-player-ids-and-anonymous-players), [Retention](#retention-and-deletion) |
| **P1–P8** Privacy | Notice, consent, collection limited to purpose, use/retention/disposal, data-subject access, disclosure to third parties only as notified, data quality, complaints | Throughout, especially the identity model |

### Children's privacy law sits on top of SOC 2

SOC 2 doesn't replace these, and a school will ask about them first:

- **US:**
  - **COPPA**: under-13s, with verifiable parental consent; for schools,
    teacher/school consent in the educational context. The 2025
    amendments add a written data-retention policy and separate consent
    for disclosure to third parties.
  - **FERPA**: education records, with the vendor acting as a "school
    official" under the school's control.
  - State student-privacy laws, such as California's SOPIPA.
- **UK/EU:** GDPR / UK GDPR (children's data needs a lawful basis, and
  DPIAs are expected) and the UK **Age Appropriate Design Code**.
- **Australia** (our AWS region is `ap-southeast-2`): Privacy Act / APPs,
  and the OAIC **Children's Online Privacy Code**, which the 2024
  amendments require by December 2026.

The common thread in all of these, and in SOC 2's Privacy criteria:
**collect the minimum, keep it under the school's control, disclose it to
as few third parties as possible, and be able to delete it.** The design
below is built around that.

---

## Identity model: emails, player IDs and "anonymous" players

### The problem with emails plus player IDs

The current plan (`xapi-export-plan.md` Step 1a) gives each `Player` a
`name` + `email`. `LRS.md` left open whether xAPI statements identify
them by `mbox` (email) or by `account` (player ID). For children, that
raises several issues:

| Issue | Why it matters |
| --- | --- |
| **Email is direct PII and often not available.** | Many younger children have no email. School-issued ones are managed by the school, and collecting them adds consent and notice obligations (COPPA, GDPR, Privacy criteria P3 "collection limited to purpose"). We don't *need* a child's email to run a game or record progress. |
| **`mbox` in xAPI statements sends the email to Veracity** (and to anyone who can read that LRS), permanently. | xAPI has no hard delete, only voiding, so an email in a stored statement can't really be erased. Disclosure to a third party also needs notice and consent (P6, COPPA's separate third-party consent). |
| **`mbox_sha1sum` doesn't anonymise.** | Email hashes are trivially reversible by guessing likely addresses (`firstname.lastname@school`). Regulators treat that as personal data. |
| **A player ID is pseudonymous, not anonymous.** | If our database maps `playerId → name/email`, the LRS data is still personal data (GDPR's definition of pseudonymised data). That's fine and much better, but it still needs protecting and deleting. |
| **The actor `name` field leaks identity.** | Even with an `account` identifier, putting a child's real name in `actor.name` sends it to Veracity. |
| **Mongo ObjectIds as player IDs.** | They're guessable-ish (timestamp + counter) and are our internal keys. External identifiers should be separate random values so they can be rotated or unlinked. |
| **Holding email and player ID together** | means one breach of our database reveals everything. Keep PII in as few fields and places as possible. |
| **"Anonymous player"** | Truly anonymous play (no identity at all) means no learning record per child, which defeats the point of xAPI. In practice we want *pseudonymous* players whose real identity is known only to the school or teacher. |

### Recommended model

1. **Players never log in and have no accounts.** A player is a record the
   **referee/teacher** creates within their own organisation (see
   [Data isolation](#data-isolation)). Children never enter credentials or
   personal data into the system.
2. **`Player` fields:**
   - `displayName`: what the referee and teacher see. A first name, nickname
     or class code is enough; the teacher decides. Surnames aren't needed.
   - `externalId`: a **random UUID v4**, generated once, used only as the
     xAPI actor identifier. Not the Mongo `_id`.
   - `orgId`: the owning organisation (school/class owner).
   - `email`: **optional, omitted for children.** Only for adult learners
     who want it (e.g. the personal pilot), and **never sent to the LRS**.
3. **xAPI actor = `account` only.** Recommended answer to `LRS.md`'s open
   question:

   ```json
   "actor": {
     "objectType": "Agent",
     "account": { "homePage": "https://kogs.link", "name": "<Player.externalId>" }
   }
   ```

   - **No `mbox`, no real name.** Omit `actor.name`, or use a non-identifying
     label like `"Player 7F3A"` (derived from `externalId`) so the Veracity
     viewer stays readable.
   - The mapping `externalId → displayName` exists **only in our database**,
     visible to that org's authorised staff.
4. **Unlinking as deletion.** To erase a child's data, delete or anonymise
   their `Player` record. The LRS statements stay but can no longer be tied
   to a person (a "mapping deletion"). Optionally also void their statements
   or clear the LRS. This is how we meet erasure requests despite xAPI
   having no hard delete. It only works if no direct identifier ever went to
   the LRS, which is why points 2–3 matter.
5. **Badges and stations never hold PII.** The badge shows emoji/colours,
   the device knows `badgeName`/`stationName`, and player identity is
   joined only on the server.

### Referee-mediated badge ↔ player binding

The referee is the trust anchor that turns "whoever is holding badge-red"
into "player 7F3A". The flow:

1. The referee **signs in** (Cognito, MFA recommended) and opens a game they
   are the **referee of** in their own org.
2. The referee picks players from **their org's roster**, or adds a new
   player (display name only).
3. The referee **binds each physical badge** to a player, either by
   selecting the badge in the UI or by tapping/scanning it at a station.
   They visually confirm the right child holds the right badge; this is a
   supervised, in-person step.
4. The binding is stored with **who did it and when**. Swaps and
   replacements are new records with a reason, never overwrites.
   `playerBadgeAssignment` in `models.ts` already has
   `assignedAt`/`unassignedAt`/`reason` (`initial`/`swap`/`replacement`);
   reuse that pattern, pointing at `Player` rather than `User`, plus an
   `assignedByUserId` taken from the token.
5. A guess is attributed to whoever the badge was bound to **at the time of
   the guess** (bindings are time-ranged), so a mid-game swap doesn't
   reassign earlier guesses.
6. **Export** is allowed only for a `completed` game, only by that game's
   referee (or an org admin), and only if every badge with guesses has a
   binding. `xapi-export-plan.md` already requires the last part.

Accepted risk: **a badge is a bearer token.** Whoever holds it plays as
the bound player. In a supervised classroom with the referee confirming
bindings, that's acceptable and proportionate. Note it in the risk register
rather than engineering around it.

---

## Access control

### Roles

| Role | Who | Authenticates via | Scope |
| --- | --- | --- | --- |
| **Platform admin** | Us | Cognito + MFA (required) | All orgs. Break-glass only, every access audited. |
| **Org admin** | e.g. school IT or lead teacher | Cognito + MFA | One org: manage staff, roster, retention, exports |
| **Referee / teacher** | Runs games | Cognito (MFA recommended) | Own org; games they referee |
| **Spectator** | Display screen, observer | Cognito, or no login for a public scoreboard showing **no names** | Read-only, one game |
| **Device** | Zero station, badge relay | Per-device credential (not Cognito users) | Submit guesses/status for the game it's bound to |
| **Player** | Child | **None.** Doesn't log in. | — |

Roles come from **Cognito groups** (and an org membership record), carried
in the access token and attached to the request by `requireAuth`.

### Authorisation rules

| Action | Platform admin | Org admin | Referee (own game) | Device | Unauthenticated |
| --- | --- | --- | --- | --- | --- |
| Create/edit roster (`Player`) | ✅ (audited) | ✅ | ✅ add only | ❌ | ❌ |
| View player display names | ✅ (audited) | ✅ | ✅ own org | ❌ | ❌ |
| Create game / change state | ✅ | ✅ | ✅ | ❌ | ❌ |
| Bind badge ↔ player | ❌ | ✅ | ✅ | ❌ | ❌ |
| Submit guess | ❌ | ❌ | ❌ | ✅ bound game only | ❌ |
| View scores / guess chart | ✅ | ✅ | ✅ | ❌ | Pseudonymous public scoreboard only, if wanted |
| Export to LRS | ❌ | ✅ | ✅ | ❌ | ❌ |
| Delete player / erasure | ✅ | ✅ | ❌ | ❌ | ❌ |
| Read audit log | ✅ | ✅ own org | ❌ | ❌ | ❌ |

### Required changes (before any player identity is stored)

1. **Default-deny.** Apply `requireAuth` globally to `/api/*`. Explicitly
   allow-list the few public routes (`GET /api/version`, health check,
   static SPA).
2. **Attach identity.** `requireAuth` sets `req.user = { sub, groups, orgId }`
   from the verified token. Every "who did this" field (`createdByUserId`,
   `assignedByUserId`, the audit `actor`) comes from `req.user`, **never
   from the request body**.
3. **Role and ownership checks** in a guard/helper per the table above,
   including "is this caller the referee of this game in this org".
4. **Device credentials.** Each station gets its own secret (API key or
   signed token), stored hashed server-side, scoped to its station name
   and the game it's bound to, and revocable. It's accepted only on device
   endpoints (`POST /api/guesses`, `/api/badges/status`, `/emoji`).
5. **CORS** restricted to the app's own origin(s) (`https://emoji-staging.kogs.link`
   plus localhost in dev).
6. **MFA** required in Cognito for admin groups, recommended for referees.
7. **LRS credentials stay server-side** (already the plan: env/Secrets
   Manager, never sent to the browser). The Veracity keys follow least
   privilege (`LRS.md` Step 2).
8. **AI chat:** chat tools must not expose player display names or roster
   data to OpenAI, unless OpenAI is an approved subprocessor for that org.
   Default to IDs and pseudonymous labels only.
9. **Access reviews:** a periodic (e.g. quarterly) check of who's in the
   admin/referee groups. A SOC 2 control, cheap if group membership is
   the source of truth.

---

## Audit logs

### What gets logged

An **audit event** is written for every security- or privacy-relevant
action, separately from ordinary request logs:

| Category | Events |
| --- | --- |
| Authentication | Sign-in success/failure, MFA changes (from Cognito: enable Cognito/CloudTrail logging) |
| Roster / PII | Player created, display name changed, player deleted/anonymised, admin viewed another org's roster |
| Binding | Badge bound / unbound / swapped / replaced (who, game, badge, player, reason) |
| Game lifecycle | Game created, state changed (`active` → `completed`, etc.) |
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

- **IDs, not PII.** Audit details reference `playerExternalId`, never names
  or emails. The audit log itself mustn't become a PII store.
- **Append-only.** A separate `auditEvents` collection that the application's
  database user can **insert but not update or delete**, enforced by MongoDB
  role permissions, not just code. Later, also ship it to CloudWatch Logs or
  S3 with Object Lock for tamper evidence.
- **Written in the same operation as the action** (or the action fails),
  so there's no "bound but not audited".
- **Retention:** keep at least 12 months, which covers a SOC 2 Type II
  audit window. That's separate from, and longer than, gameplay data
  retention.
- **Readable** by org admins for their own org (support and school
  enquiries) and by platform admins.

### Request-log hygiene

`request-logging.middleware.ts` already omits bodies in production. Also:

- Add `email`, `name`, `displayName` to `SENSITIVE_FIELD_PATTERN`, so dev
  verbose logs don't capture PII either.
- Never log Veracity Basic Auth headers or full LRS responses that echo
  statements.
- Set a CloudWatch log-group retention (no unlimited retention).

---

## Data isolation

### Tenants (organisations)

- Introduce **`Organisation`** (a school, or an individual teacher/learner
  for personal use). Every tenant-owned document (`Game`, `Player`, binding,
  `Question` sets, audit events) carries `orgId`.
- **`orgId` always comes from the authenticated caller**, never from the
  request. Repository methods take `orgId` as a required parameter and
  always filter on it. Add tests asserting that a cross-org read returns
  404, not 403, so nothing leaks about another org's games.
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
- Statements carry no PII (identity model above), so even a misrouted
  statement exposes only a pseudonymous ID.

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

- In transit: HTTPS only (ALB with ACM cert, already in place). The LRS
  endpoint is HTTPS.
- At rest: MongoDB storage encryption (check the provider behind
  `MONGODB_URI`), encrypted EBS/S3 for anything else.
- Secrets: AWS Secrets Manager (already used for `MONGODB_URI`/OpenAI;
  extend to the LRS keys as in `LRS.md` Step 3). Rotate on staff
  changes or exposure.

---

## Third parties (subprocessors)

| Vendor | Receives | For children's data we need |
| --- | --- | --- |
| **Veracity** (LRS) | Pseudonymous statements (no names or emails, per the identity model) | DPA / terms reviewed, data location, retention and deletion process. The free tier may not offer a DPA; check before a school pilot. |
| **OpenAI** (chat) | Whatever chat tools expose | Keep player data out of tools (see access control #8). If that's impossible, OpenAI's DPA and zero-retention options. |
| **MongoDB host** | Everything, including the identity mapping | DPA, region (prefer in-country for schools), encryption, backups |
| **AWS** (ECS, Cognito, Secrets Manager, CloudWatch) | Referee identities, logs | AWS DPA (standard), region `ap-southeast-2` |

Keep this list current: schools (and SOC 2 CC9) require a published
subprocessor list and notice when it changes.

---

## Retention and deletion

- **Gameplay data:** a written retention policy per org (e.g. end of
  school year + N months), then delete it or anonymise the `Player`
  records. Required by COPPA's 2025 amendments, SOC 2 C1/P4, and the
  Australian APPs.
- **Erasure request:** an org admin deletes or anonymises the `Player`.
  That unlinks the LRS data. Optionally void their statements. The action
  is audited.
- **Org leaves:** export their data on request, then delete their org's
  records and their LRS (or clear it).
- **Audit events:** kept per the audit retention above, holding IDs only.

---

## Phasing: what's needed when

| Requirement | Personal pilot (adult, self) | Before a school / children's pilot | Before a SOC 2 audit |
| --- | --- | --- | --- |
| `account` actor with random `externalId`, no `mbox`/name in statements | ✅ do now (it's a one-way door, see `LRS.md`) | ✅ | ✅ |
| `Player.email` optional; `displayName` only | ✅ | ✅ | ✅ |
| Default-deny auth on `/api/*`, identity from token | Strongly advised (staging is public) | ✅ required | ✅ |
| Referee-only binding with `assignedByUserId` | ✅ (cheap to do in Step 1a) | ✅ | ✅ |
| Device credentials | Optional | ✅ required | ✅ |
| CORS restricted | ✅ (one line) | ✅ | ✅ |
| Append-only audit log | Binding + export events | ✅ full list | ✅ + tamper-evident storage, 12-month retention |
| `orgId` tenancy + scoped repositories | Optional (single org) | ✅ required | ✅ |
| Separate production environment | No | ✅ required | ✅ |
| Per-org LRS | No | ✅ (or justify single-org) | ✅ |
| MFA for admins, access reviews | Optional | ✅ | ✅ with evidence |
| Subprocessor list + DPAs, retention policy, privacy notice for schools | No | ✅ | ✅ |
| Written policies (incident response, access, change management), auditor | No | Recommended | ✅ |

---

## Impact on existing plans

These are recommendations for the owners of the other docs. Adopting them
changes:

- **`LRS.md` → Actor:** resolve the open question as **`account` with
  `homePage: "https://kogs.link"` and `name: <Player.externalId>`**, with
  no `mbox` and no real `actor.name`.
- **`xapi-export-plan.md` → Step 1a:**
  - `Player` becomes `displayName` + `externalId` + `orgId` + optional
    `email`, not required `name` + `email`.
  - Binding is referee-only and records `assignedByUserId` from the token.
  - Export is restricted to the game's referee or an org admin, and is
    audited.
- **New prerequisite before Step 1a:** default-deny `requireAuth` with
  `req.user`, and stop trusting `createdByUserId` from request bodies.

## Open questions

- Who is the "org" for the first school pilot: the school, or the
  individual teacher? This affects who can see rosters and who answers
  erasure requests.
- Will schools want to supply rosters (CSV / OneRoster) rather than
  referees typing names? (OneRoster is deferred in `xAPI.md`.)
- Is a public, name-free scoreboard (spectator view with no login) wanted?
- Jurisdiction of the first school (AU / US / UK) decides which children's
  privacy regime applies first.
- Does Veracity offer a DPA, and where is the data stored? (Check before a
  school pilot; otherwise use a self-hosted LRS in `ap-southeast-2`.)
