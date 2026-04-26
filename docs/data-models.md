# Game Data Model (Implementation Agnostic)

## Goal

Define the core game domain independent of database technology or ORM/ODM.
This gives us a stable contract before choosing MongoDB or SQL.

## Core concepts

- A `Game` has a lifecycle and a controlled flow.
- A `Question` belongs to a `Game`.
- A `Question` has multiple `AnswerOption` records.
- A `User` can join a game as `player`, `referee`, or `spectator`.
- A `Player` uses one `Badge` in a game at a time, but can switch badges.
- A `Guess` is submitted by a user for a specific question and answer option.
- Each player has a `playMode` (`standard` or `cut-throat`) for a game session.
- Each question has a `mode` (`standard`, `cut-throat`, or `mixed`).
- Games are real-time: once the referee opens a question, all players can submit
  guesses concurrently via badge scans.
- NFC answer-slot cards (`A`, `B`, `C`, `D`, `E`) are reusable physical inputs
  that map to question answer slots for each round.

## Proposed entities

### User

- `id`
- `displayName`
- `authProviderId` (Cognito `sub` or equivalent)
- `createdAt`
- `updatedAt`

### Badge

- `id`
- `externalBadgeId` (device identifier from hardware stream)
- `label` (human-friendly name)
- `status` (active, inactive, broken, retired)
- `createdAt`
- `updatedAt`

### Game

- `id`
- `title`
- `state` (draft, lobby, active, paused, completed, cancelled)
- `createdByUserId`
- `startedAt`
- `endedAt`
- `createdAt`
- `updatedAt`

### GameParticipant

Membership and role for each user in a game.

- `id`
- `gameId`
- `userId`
- `role` (player, referee, spectator)
- `playMode` (standard, cut-throat, nullable for non-player roles)
- `joinedAt`
- `leftAt` (nullable)
- `status` (active, removed, disconnected)

### PlayerBadgeAssignment

Tracks which badge a player used and when, including switches.

- `id`
- `gameId`
- `userId` (must be a player in this game)
- `badgeId`
- `assignedAt`
- `unassignedAt` (nullable)
- `reason` (initial, swap, replacement, recovery, admin_override)

### Question

- `id`
- `gameId`
- `text`
- `sequence` (order within game)
- `mode` (standard, cut-throat, mixed)
- `state` (draft, open, closed, scored, archived)
- `openedAt`
- `closedAt`
- `createdByUserId` (typically referee)
- `createdAt`
- `updatedAt`

### AnswerOption

- `id`
- `questionId`
- `text`
- `sequence` (1..N)
- `slotLabel` (`A`, `B`, `C`, `D`, `E`, optional extension for larger sets)
- `isCorrect` (boolean correctness marker)
- `createdAt`

### NfcCard

Physical card inventory that can be reused across games.

- `id`
- `cardUid` (hardware UID, unique per card)
- `slotLabel` (`A`, `B`, `C`, `D`, `E`)
- `status` (active, retired, lost)
- `createdAt`
- `updatedAt`

### Guess

- `id`
- `gameId` (denormalized convenience link)
- `questionId`
- `answerOptionId`
- `guesserUserId`
- `createdAt`

## Relationship model

```text
User
  |--< Game (creator)
  |--< GameParticipant
  |--< Guess (guesser)
Game
  |--< GameParticipant
  |--< Question
  |--< PlayerBadgeAssignment
Question
  |--< AnswerOption
  |--< Guess
AnswerOption
  |--< Guess
Badge
  |--< PlayerBadgeAssignment
NfcCard
  |--|"maps to slot label"| AnswerOption
```

## Domain rules and invariants

- A user can have at most one role per game.
- A game should have exactly one active referee at a time.00
- `playMode` is required for `player` participants and null for non-player roles.
- Player `playMode` is one of `standard` or `cut-throat`.
- A single game can include both `standard` and `cut-throat` players at the
  same time.
- A player can have at most one active badge assignment per game.
- A badge can be actively assigned to at most one player in the same game.
- Badge swaps are modeled as history rows, not in-place overwrite.
- A guess must reference an answer option that belongs to the same question.
- A user can submit at most one active guess per question.
- Question mode controls answer composition:
  - `standard`: answer options should contain one correct option and remaining
    incorrect options.
  - `cut-throat`: answer options should still include correct and incorrect
    options, but scoring rewards avoiding the correct option.
  - `mixed`: answer options may include multiple correct and multiple incorrect
    options (for example, two correct and two incorrect).
- Guess scoring uses both `question.mode` and `participant.playMode`:
  - Standard player: rewarded for correct picks.
  - Cut-throat player: rewarded for avoiding correct picks.
- In a `standard` question, both standard and cut-throat players are allowed;
  they are scored differently according to player mode.
- Real-time submission window:
  - A guess is accepted only while `question.state = open`.
  - Referee closes the question to end submissions and trigger scoring.
- NFC slot mapping:
  - A badge scan with card label (for example `A`) resolves to the
    `AnswerOption` with matching `slotLabel` for the current question.
  - Slot labels are question-local mapping keys; physical cards are reusable
    across all games.
- Optional participation policy: only `spectator` can guess, or
  `spectator + player`; this remains a configurable business rule.

## Suggested uniqueness constraints

- `GameParticipant`: unique on `(gameId, userId)`.
- `Question`: unique on `(gameId, sequence)`.
- `AnswerOption`: unique on `(questionId, sequence)`.
- `AnswerOption`: unique on `(questionId, slotLabel)`.
- `NfcCard`: unique on `cardUid`.
- `NfcCard`: unique on `slotLabel` if cards are globally fixed one-per-slot;
  otherwise allow many cards per slot label.
- `Guess`: unique on `(questionId, guesserUserId)`.
- Active badge assignment uniqueness:
  - one active row per `(gameId, userId)` where `unassignedAt` is null
  - one active row per `(gameId, badgeId)` where `unassignedAt` is null

## Minimal lifecycle flow

- Referee creates game.
- Users join game with role player.
- Players are assigned a play mode (`standard` or `cut-throat`).
- Players receive initial badge assignments.
- Referee opens question.
- Eligible users submit guesses in real time by scanning badge + NFC slot card.
- Referee closes question and advances.
- Badge may be swapped mid-game by ending old assignment and creating a new one.

## NFC slot-card setup lifecycle flow

This flow captures how reusable answer cards are prepared once and then attached
to individual games.

- Admin creates an `NfcCardGroup` (for example, "Default Answer Cards Set").
- Admin registers each physical card in the group with:
  - `cardUid` (raw NFC UID from scan)
  - `slotLabel` (`A`, `B`, `C`, `D`, `E`)
  - `displayName` (for example, "Answer Card A", "Answer Card B")
- System validates uniqueness:
  - `cardUid` unique globally
  - `slotLabel` unique within a given group
- Referee attaches one active `NfcCardGroup` to the game before opening
  questions.
- When a student scans badge + NFC card, the system resolves:
  - `cardUid -> group card -> slotLabel`
  - `slotLabel + current question -> answerOptionId`
- Guess is stored with both raw and resolved values for audit:
  - raw (`cardUid`, `slotLabel`)
  - resolved (`answerOptionId`, `questionId`, `gameId`)
- If a card is lost or replaced, admin updates the group membership while
  preserving historical guess records.

## API-shape implications

- Keep IDs stable and opaque across services.
- Include denormalized IDs (`gameId`, `questionId`) where they simplify reads.
- Keep history rows for auditability (`Guess`, `PlayerBadgeAssignment`).
- Make role checks explicit in service layer, not only in UI.
- Store both raw input metadata (`badgeId`, `cardUid`, `slotLabel`) and resolved
  domain target (`answerOptionId`) for auditability and reconciliation.

## Storage evaluation for this model

### MongoDB + Mongoose

Strong fit when game data is document-centric and we want flexible schema
iteration. Good for rapid product changes and event/history style records.

Pros:

- Fast iteration on nested game/question structures.
- Natural fit for append-heavy history (`Guess`, badge assignments).
- Popular pairing in Node for Mongo-backed products.

Cons:

- Cross-document integrity rules are app-enforced unless carefully indexed and
  transactional.
- Complex relational analytics can require aggregation pipelines.

### MongoDB driver + Zod

Good when we want explicit control and minimal ORM abstraction.

Pros:

- Small dependency surface and full query control.
- Zod can enforce strict boundary validation.

Cons:

- More boilerplate for repository and mapping code.
- Team must maintain consistency patterns manually.

### SQL + Prisma or TypeORM

Strong fit when strict relational constraints and reporting are top priorities.

Pros:

- First-class foreign keys and uniqueness constraints.
- Easier ad hoc reporting and relational queries.
- Widely recognized on full-stack job listings.

Cons:

- Schema migrations are less flexible for rapidly changing document shapes.
- Nested write/read patterns can be more verbose early on.

## Recommendation for next milestone decision

- If we optimize for rapid game feature iteration and badge/event history first:
  choose MongoDB (Mongoose or driver + Zod).
- If we optimize for strict relational integrity and analytics/reporting first:
  choose SQL (Prisma or TypeORM).
- In either path, keep this domain model as the source-of-truth contract and map
  persistence specifics behind repositories.

## AWS considerations for MongoDB + Mongoose

### Deployment options on AWS

- **MongoDB Atlas on AWS (recommended):** Fully managed MongoDB with first-class
  compatibility for Mongoose, built-in backups, and easier scaling.
- **Self-managed MongoDB on EC2:** Maximum control, but we own patching, backups,
  failover, replication, and operational runbooks.
- **Amazon DocumentDB:** API-compatible in many areas, but not fully equivalent to
  MongoDB. Validate Mongoose features, transactions, index behavior, and
  aggregation support before committing.

### Networking and security

- Run the app in private subnets and use private connectivity to the database
  (Atlas private endpoint/peering or equivalent).
- Store database credentials in AWS Secrets Manager and rotate regularly.
- Enable encryption in transit (TLS) and at rest (KMS-backed where available).
- Restrict inbound access by security groups and least-privilege network policy.

### Reliability and performance

- Use replica sets and multi-AZ deployment for high availability.
- Enable point-in-time recovery and test restore procedures early.
- Add indexes for hot paths (`gameId`, `questionId`, `guesserUserId`, `state`,
  `createdAt`) and monitor query latency.
- Keep document size bounded (especially for long-running games) and archive old
  history collections when needed.

### Observability and operations

- Centralize logs/metrics in CloudWatch (or Atlas monitoring plus CloudWatch
  integration) and alert on latency, connection pool saturation, and replication
  lag.
- Set explicit Mongoose connection pool and timeout settings to match expected
  concurrency during live rounds.
- Load test concurrent guess writes to verify throughput and lock in index design
  before production launch.

### Cost notes

- Main cost drivers are provisioned cluster size, storage, IOPS, data transfer,
  and backup retention.
- Cross-AZ and cross-region replication improves resilience but can materially
  increase cost.
- Start with right-sized production tiers and autoscaling guardrails; revisit
  after real match telemetry.

### Practical recommendation

- For this project, prefer **MongoDB Atlas on AWS + Mongoose** for fastest
  delivery with the least operational burden.
- Keep repository interfaces persistence-agnostic so we can migrate to SQL later
  if analytics/reporting needs dominate.
