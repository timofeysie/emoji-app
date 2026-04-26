# Milestones Roadmap (Post Milestone 1)

## Table of contents

- [Sequencing decision](#sequencing-decision)
- Milestone 1: Convert Express server to NestJS.
- [Milestone 2: Persistence foundation (MongoDB + Mongoose)](#milestone-2-persistence-foundation-mongodb--mongoose)
- [Milestone 3: Atlas on AWS deployment baseline](#milestone-3-atlas-on-aws-deployment-baseline)
- [Milestone 4: Data migration and game workflow hardening](#milestone-4-data-migration-and-game-workflow-hardening)
- [Milestone 5: Real-time updates via WebSocket (API Gateway)](#milestone-5-real-time-updates-via-websocket-api-gateway)
- [Milestone 6: Production readiness and scale](#milestone-6-production-readiness-and-scale)
- [Immediate next actions (this week)](#immediate-next-actions-this-week)

## Sequencing decision

Set up MongoDB, Mongoose, and MongoDB Atlas on AWS **before** WebSocket delivery.
WebSockets should publish game state that already has stable persistence,
indexes, and data access patterns.

Recommended order:

1. Convert Express server to NestJS.
2. Data model finalization and collection design.
3. MongoDB + Mongoose integration in the app.
4. Atlas on AWS environment setup and deployment hardening.
5. API and game-flow migration to persisted data.
6. Real-time delivery via WebSockets (API Gateway).

## Milestone 2: Persistence foundation (MongoDB + Mongoose)

Status: **Complete** (closure pass recorded on 2026-04-27)

Design artifact: `docs/milestone-2-data-model-finalization.md`

### Milestone 2 goals

- Introduce production-grade persistence for game domain entities.
- Keep service-layer interfaces stable so transport can evolve later.

### Milestone 2 scope

- Add Mongoose and connection management to server app startup.
- Implement schemas/models for:
  - `User`
  - `Badge`
  - `Game`
  - `GameParticipant`
  - `PlayerBadgeAssignment`
  - `Question`
  - `AnswerOption`
  - `NfcCard`
  - `NfcCardGroup` (new)
  - `Guess`
- Add indexes and uniqueness constraints from `docs/data-models.md`.
- Add repository layer to isolate Mongoose from route and service handlers.
- Add seed/dev bootstrap for local data.

### Milestone 2 exit criteria

- App runs end-to-end against local MongoDB.
- Core create/read/update flows work through repositories.
- Unique constraints and key indexes are in place.
- No breaking API contract changes for current UI.

### Milestone 2 closure evidence

- Added local bootstrap script `npm run seed:local` via `scripts/seed-local.mjs`
  to seed stable smoke-test IDs:
  - `teacherUserId=000000000000000000000001`
  - `studentUserId=000000000000000000000002`
  - `badgeId=000000000000000000000003`
- Recorded successful end-to-end local Mongo smoke flow using:
  - `POST /api/games`
  - `POST /api/games/:gameId/participants`
  - `POST /api/games/nfc-card-groups`
  - `POST /api/games/:gameId/nfc-card-groups/:groupId/attach`
  - `POST /api/questions`
  - `POST /api/questions/:questionId/state` (open/closed)
  - `POST /api/guesses`
- Smoke test success artifact values:
  - `gameId=69ee8d2c21dd52eba889ec46`
  - `groupId=69ee8d2c21dd52eba889ec47`
  - `questionId=69ee8d2c21dd52eba889ec4b`
  - `guessId=69ee8d2c21dd52eba889ec4e`

## Milestone 3: Atlas on AWS deployment baseline

### Milestone 3 goals

- Move persistence to a managed, secure, and observable environment.

### Milestone 3 scope

- Provision MongoDB Atlas project and cluster in AWS region.
- Configure network access:
  - Private networking strategy (preferred) or tightly scoped IP allowlist.
  - TLS required for all connections.
- Store connection secret in AWS Secrets Manager.
- Add environment-specific config (`dev`, `staging`, `prod`).
- Enable backups and point-in-time recovery.
- Configure monitoring and alerts for:
  - Query latency
  - Connection pool saturation
  - Storage growth
  - Replication health

### Milestone 3 exit criteria

- Staging server connects to Atlas successfully.
- Backup and restore drill is tested once.
- Baseline alerts are active and verified.

## Milestone 4: Data migration and game workflow hardening

### Milestone 4 goals

- Ensure all gameplay operations are persistence-backed and consistent.

### Milestone 4 scope

- Migrate game creation, join flow, question setup, and guess submission to DB.
- Implement NFC card-group attach flow per game:
  - Pre-register cards with `cardUid`, `slotLabel`, `displayName`.
  - Attach active card group to game before question open.
- Add transactional or compensating logic for critical multi-write paths:
  - Badge assignment swaps
  - Question close and score calculation
- Add idempotency and conflict handling for repeated scans/submissions.
- Add integration tests for invariants and race conditions.

### Milestone 4 exit criteria

- Critical game flows are fully DB-backed.
- Concurrent submissions behave correctly under load tests.
- NFC card mapping works from scan to stored guess records.

## Milestone 5: Real-time updates via WebSocket (API Gateway)

### Milestone 5 goals

- Deliver low-latency state updates to active game clients.

### Milestone 5 scope

- Add WebSocket API (Amazon API Gateway WebSocket or equivalent service).
- Add connection/session tracking by game and participant.
- Publish events for:
  - Question opened/closed
  - Guess accepted/rejected
  - Score updates
  - Badge assignment changes
- Introduce event payload versioning and contract tests.
- Add fallback/replay strategy for reconnecting clients.

### Milestone 5 exit criteria

- Clients receive real-time game updates with acceptable latency.
- Reconnect behavior recovers missed events.
- Event contracts are documented and test-covered.

## Milestone 6: Production readiness and scale

### Milestone 6 goals

- Prepare for classroom-scale and multi-game concurrency.

### Milestone 6 scope

- Performance profiling and index tuning from real telemetry.
- Capacity test with target concurrent games and participants.
- Operational runbooks:
  - Atlas incident response
  - API/WebSocket degradation handling
  - Data restore process
- Security review:
  - Secret rotation
  - Least-privilege IAM
  - Audit logging completeness

### Milestone 6 exit criteria

- Target load passes with stable latency and error rates.
- Runbooks are validated in at least one game-day simulation.
- Security and reliability checklist is complete.

## Immediate next actions (this week)

1. Confirm final entity list, including `NfcCardGroup` and game attachment model.
2. Implement Mongoose models and indexes.
3. Add repository interfaces and migrate one vertical slice:
   game create -> question create -> guess submit.
4. Stand up Atlas staging and wire secrets/config.
