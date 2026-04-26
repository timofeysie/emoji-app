# Leaving AWS App Runner (migration guidance)

## Context

This app is containerized and runs a Node/Nest API with future real-time features. App
Runner was a convenient starting point, but the platform is not the long-term default
for new workloads.

If you are evaluating migration timing, also note: AWS has communicated that
**App Runner will no longer accept new customers starting 2026-04-30**. Existing
services can continue running, but new adoption is discouraged.

## Best practical alternative (AWS-native) for this app

**Default recommendation: Amazon ECS on AWS Fargate (standard ECS).**

- **Why it fits**:
  - You keep a container-first deployment model similar to App Runner.
  - You get stronger, standard enterprise controls: VPC placement, load balancing, scaling,
    logging, and operational patterns that age well.
  - It pairs well with a future “real-time + HTTP API on one origin” setup using an
    ALB, which is a common and well-documented path.

**If you want the lowest-friction PaaS-like AWS option with fewer knobs**: Elastic
Beanstalk is often the easiest “lift and shift” off App Runner, but it is less
“modern” than ECS for long-term platform evolution and multi-service growth.

I would not pick a new non-AWS PaaS for this project unless the explicit goal is to
exit AWS compute entirely.

## Important coupling with the database and transactions

The server uses MongoDB/Mongoose and includes paths that can rely on
**multi-document transactions**. In practice, that means your MongoDB environment must
support transactions (typically a **replica set / cluster** model), not a toy
standalone “dev Mongo” without replica-set behavior.

- **Atlas** is usually a good default for this.
- Your compute plan should not assume a single-node, non-replica-set Mongo in staging
  or production.

## Where migration fits in milestone planning (recommended split)

Right now, **Milestone 3** in `docs/milestones.md` is focused on **MongoDB Atlas on
AWS** (database baseline). That is correct, but it means you should **separate
compute migration from database work** so the two don’t conflate or block each other.

Recommended structure:

- **Milestone 3 (as written)**: Atlas on AWS
  - cluster, access model, `MONGODB_URI` secret handling, backups, PITR, monitoring,
    restore drill

- **Add a dedicated milestone (common naming)**:
  - `Milestone 3.5` *or* `Milestone 4a`: **App Runner → ECS (Fargate) compute
    baseline**
  - build/push image, ECS service, autoscaling, health checks, logging
  - wire runtime configuration (env vars, Secrets Manager) equivalent to what App Runner
    provided
  - validate WebSocket readiness (even if you do not build all WebSocket infra yet)

- **Later milestones** (game hardening, WebSockets, scale): can proceed without you
  being “stuck” on a deprecated/limited platform path for new environments.

## Suggested execution order (clean and low-risk)

1. Stabilize database on **Atlas in staging** (Milestone 3).
2. Stand up **staging compute** on the new platform and point it at the staging
   `MONGODB_URI`.
3. Run smoke tests (including the DB-backed game flow paths).
4. Promote the same pattern to production once rollback and observability are acceptable.

## What “success” looks like

- Staging and production can be created **without** App Runner.
- The API serves `/api` routes reliably with correct DB connectivity, secrets, and
  health checks.
- You have a documented rollback path: previous image tag + previous service config.

## Notes

- This document intentionally focuses on the **hosting** decision. Database architecture
  details should remain the source of truth in `docs/milestone-2-data-model-finalization.md`
  and the operational runbooks in `docs/deployments.md`.
