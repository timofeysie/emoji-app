# Milestones Roadmap (Post Milestone 1)

## Table of contents

- [Sequencing decision (updated roadmap)](#sequencing-decision-updated-roadmap)
- [Milestone 1: Server framework baseline (NestJS)](#milestone-1-server-framework-baseline-nestjs)
- [Milestone 2: Persistence foundation (MongoDB + Mongoose)](#milestone-2-persistence-foundation-mongodb--mongoose)
- [Milestone 3: Atlas on AWS for MongoDB](#milestone-3-atlas-on-aws-for-mongodb)
- [Milestone 4: ECS on Fargate and ALB](#milestone-4-ecs-on-fargate-and-alb)
- [Milestone 5: Gameplay integrity and scoring](#milestone-5-gameplay-integrity-and-scoring)
- [Milestone 6: Real-time features for game rooms](#milestone-6-real-time-features-for-game-rooms)
- [Milestone 7: Production readiness and scale](#milestone-7-production-readiness-and-scale)
- [Future directions (optional)](#future-directions-optional)
- [Immediate next actions (this week)](#immediate-next-actions-this-week)

## Sequencing decision (updated roadmap)

This app needs three foundations that should not be conflated:

- **Durable data** (Atlas + well-indexed game flows)
- **Reliable hosting** (ECS on Fargate, not App Runner, for a supported path forward)
- **Credible real-time** (ALB to your container first; add optional edge services later if needed)

Recommended order (best-practice, career-oriented):

1. Lock domain + persistence patterns (Milestone 2) — **complete**
2. Stand up **MongoDB Atlas** in AWS with security + ops basics (Milestone 3)
3. Migrate **compute** to **ECS on Fargate behind an ALB** (Milestone 4)  
   This is the most common “full-stack with DevOps awareness” default for containerized
   services on AWS.
4. Harden the **gameplay invariants and scoring** on durable data (Milestone 5)
5. Implement **room-scoped real-time delivery** to clients, built on the same
   process WebSocket path you already use, now deployed correctly behind ALB (Milestone 6)
6. Production **SRE hardening** (Milestone 7)

## Milestone 1: Server framework baseline (NestJS)

Status: **Complete**

### Milestone 1 goals

- Establish a server architecture that supports modules, testing, and incremental API growth.
- Keep HTTP + WebSocket hosting patterns compatible with typical AWS load balancing.

### Milestone 1 skills practiced (career map)

- Nest module boundaries, dependency injection, and controller-based routing patterns.

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

## Milestone 3: Atlas on AWS for MongoDB

Status: **In progress**

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

### Milestone 3 skills practiced (career map)

- Managed database operations: access control, backups, observability, restore drills.

### Milestone 3 execution tracker

- [x] Atlas runbook section added to `docs/deployments.md`
- [x] Staging smoke evidence template added to `docs/manual-tests.md`
- [ ] Atlas staging cluster provisioned and credentials created
- [ ] Staging network access model selected and approved
- [ ] `MONGODB_URI` wired via AWS Secrets Manager in staging runtime
- [ ] Backup and PITR enabled, with one successful restore drill
- [ ] Baseline alerts configured and routed to on-call owners
- [ ] Milestone 3 closure evidence recorded

## Milestone 4: ECS on Fargate and ALB

Rationale: App Runner is not the long-term default for new customers. A standard,
resume-friendly path is **containers on ECS** with a load balancer. For WebSockets,
**ALB supports WebSocket upgrades to your service**, which matches your current in-process
`ws` design.

### Milestone 4 goals

- Move hosting to a well-supported AWS compute path: **ECS on Fargate**.
- Put a production-grade **ALB** in front of the service (HTTP/HTTPS and WebSocket upgrades).

### Milestone 4 scope

- Create ECS cluster, task definition, service, autoscaling targets.
- Configure public ingress:
  - ALB + target group health checks
  - WebSocket-friendly idle timeouts and routing to a single service (initially)
- Build and deploy pipeline for immutable container releases (image tags, rollbacks).
- Replace App Runner-specific config with standard ECS/Secrets wiring.
- Staging and production environment separation (parameters, not copy-paste secrets).

### Milestone 4 exit criteria

- Staging URL serves the app and APIs reliably.
- `wss://` to the same host as `https://` works for the existing WebSocket path you choose
  to expose in production (consistent with the ALB/ECS pattern).
- Rollback is proven: deploy `N+1`, detect failure, roll back to `N`.
- No reliance on App Runner for new environments.

### Milestone 4 reference note

- Compute migration context: `docs/decicions/leaving-app-runner.md`

### Milestone 4 skills practiced (career map)

- Core AWS “three-tier cloud native” building blocks: VPC networking concepts, load
  balancers, container orchestration, secrets, observability, release engineering.

## Milestone 5: Gameplay integrity and scoring

This milestone is where “product correctness” meets “database engineering correctness”.

### Milestone 5 goals

- Make gameplay flows **provably correct** under concurrency and failure modes.
- Add scoring, referee controls, and auditability appropriate for a classroom product.

### Milestone 5 scope

- Invariants and enforcement in the service layer for:
  - join/role rules, referee progression, and guess eligibility
  - one guess per user per question (leveraging indexes + idempotency strategy)
- NFC group lifecycle correctness:
  - attach and supersede behavior
  - “lost card” operations without breaking history
- Scoring and reveal flows:
  - close question, compute results, store scoring artifacts (even if v1 is simple)
- Concurrency and race tests (integration level) for the hottest write paths
- Make transactions usage intentional:
  - document when transactions are required vs not
  - ensure environments are replica-set/Atlas-backed where transactions are used

### Milestone 5 exit criteria

- Load tests for concurrent guesses meet latency and correctness expectations.
- Known edge cases (duplicate scan, out-of-order events, late reconnect) are handled
  with explicit, tested behavior (even if the UX is simple).

### Milestone 5 skills practiced (career map)

- Distributed systems basics: invariants, idempotency, concurrency, observability, and
  data modeling trade-offs in MongoDB.

## Milestone 6: Real-time features for game rooms

### Milestone 6 goals

- Ship real-time updates to clients in a way that is reliable for classroom use.

### Milestone 6 scope

- Define a minimal event model for a game “room”:
  - `question.opened/closed`, `guess.recorded`, `score.updated` (as needed)
- Implement connection lifecycle handling:
  - `joinGame`, `leave`, heartbeat, reconnect, replay snapshot strategy
- Make events versioned and backwards compatible as you iterate.
- Align API + WebSocket security story with Cognito (short-lived tokens, refresh, etc.).

### Milestone 6 exit criteria

- A classroom-scale pilot works without requiring manual server babysitting.
- Reconnects recover a coherent UI state (snapshot + optionally incremental events).

### Milestone 6 skills practiced (career map)

- Real-time system design, contract-first evolution, and operational debuggability of live
  systems.

## Milestone 7: Production readiness and scale

### Milestone 7 goals

- Prepare for classroom-scale and multi-game concurrency with operational maturity.

### Milestone 7 scope

- Performance profiling and index tuning from real telemetry
- Capacity test with target concurrent games and participants
- Operational runbooks:
  - Atlas incident response
  - ECS/ALB rollbacks and “bad deploy” playbooks
  - WebSocket degradation and forced reconnect strategy
  - Data restore process
- Security review:
  - secret rotation and least privilege IAM for CI/CD and runtime roles
  - audit logging for referee actions and game mutations

### Milestone 7 exit criteria

- Target load passes with stable latency and error rates
- Runbooks are validated in at least one game-day simulation
- Security and reliability checklist is complete

## Future directions (optional)

This section is intentionally out of the near-term plan. Pick these only if you have a
specific scaling or org requirement that the baseline cannot meet.

- **API Gateway (HTTP or WebSocket)** as a managed edge API layer
- **ElastiCache/Redis** for high-volume fan-out, online presence, and ephemeral routing maps
- **SQS/SNS** for decoupling ingest from scoring (only if/when the write pattern demands it)
- **Split services** (game engine vs. badge ingest) if operational boundaries harden
- **Multi-region** (only with clear business requirements)

## Immediate next actions (this week)

1. Stand up **Atlas staging** and set `MONGODB_URI` via a secret strategy you intend to
   use in production.
2. Prototype **ECS on Fargate + ALB** in a sandbox AWS account and deploy the current
   container to staging (even if the app is not feature-complete yet).
3. Add an integration test plan for the hottest path: `open question` -> concurrent
   guesses -> `close question` (extend existing server tests with more realistic timing).
4. Decide the **v1 event contract** for the client room channel (message names, payload
   version field, and snapshot policy).
