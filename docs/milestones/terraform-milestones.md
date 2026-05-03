# Terraform parallel path for AWS infrastructure

This document maps out a parallel adoption plan for managing the app's AWS
infrastructure with [Terraform](https://developer.hashicorp.com/terraform).
It runs **alongside** (not instead of) the existing milestones in
`docs/milestones.md`, and it explicitly honors the manual progress already made
in Milestones 2, 3A, and 4.

MongoDB Atlas remains intentionally **out of scope** for Terraform on this
project. We'll continue to manage Atlas via the Atlas console.

## Table of contents

- [Why add Terraform now](#why-add-terraform-now)
- [Pre-flight reference](#pre-flight-reference)
- [What this plan covers (and what it does not)](#what-this-plan-covers-and-what-it-does-not)
- [Manual progress this plan must honor](#manual-progress-this-plan-must-honor)
- [Adoption strategy: import-first, then evolve](#adoption-strategy-import-first-then-evolve)
- [Target repository layout](#target-repository-layout)
- [Remote state and locking](#remote-state-and-locking)
- [Provider and version baseline](#provider-and-version-baseline)
- [Naming, tagging, and module conventions](#naming-tagging-and-module-conventions)
- [Milestone T0: Tooling and repo skeleton](#milestone-t0-tooling-and-repo-skeleton)
- [Milestone T1: Remote state backend bootstrap](#milestone-t1-remote-state-backend-bootstrap)
- [Milestone T2: Network and security baseline (import)](#milestone-t2-network-and-security-baseline-import)
- [Milestone T3: ALB and target group (import)](#milestone-t3-alb-and-target-group-import)
- [Milestone T4: IAM roles and policies (import)](#milestone-t4-iam-roles-and-policies-import)
- [Milestone T5: Task definition under Terraform (re-author)](#milestone-t5-task-definition-under-terraform-re-author)
- [Milestone T6: ECS cluster, log group, and service (greenfield)](#milestone-t6-ecs-cluster-log-group-and-service-greenfield)
- [Milestone T7: HTTPS and ACM (greenfield)](#milestone-t7-https-and-acm-greenfield)
- [Milestone T8: CI/CD for Terraform plan and apply](#milestone-t8-cicd-for-terraform-plan-and-apply)
- [Milestone T9: Support for later product milestones](#milestone-t9-support-for-later-product-milestones)
- [Out of scope: MongoDB Atlas](#out-of-scope-mongodb-atlas)
- [Risk register and rollback strategy](#risk-register-and-rollback-strategy)
- [Reference snippets](#reference-snippets)

## Why add Terraform now

The manual console workflow we used through Milestone 4 has three persistent
problems that Terraform addresses well:

- **Drift and undocumented state.** It's easy to lose track of which security
  group rule, IAM policy, or ALB listener was already created.
- **Console UI churn.** AWS continually relabels and reorganizes screens, which
  makes step-by-step instructions go stale.
- **Reproducibility.** Standing up a fresh `prod` environment by hand is
  tedious and error-prone; Terraform makes it a code change plus a `plan/apply`.

Adopting Terraform now (after staging is mostly stood up) is realistic because:

- The hardest "first build" decisions (VPC strategy, SG topology, ALB shape,
  IAM role shape) are already made.
- We can **import** existing resources into Terraform state instead of
  recreating them, so we don't disrupt the running staging environment.

## Pre-flight reference

Before running anything in this plan, see
[`docs/milestones/pre-T0.md`](./pre-T0.md). It captures the actual AWS account
id, region, and the ARNs/IDs of every resource we'll import or reference. The
import commands in T2-T5 below assume those values are at hand.

## What this plan covers (and what it does not)

In scope for Terraform:

- VPC referencing (default VPC for staging, dedicated VPC for prod later)
- Security groups (`emoji-staging-alb-sg`, `emoji-staging-ecs-sg`)
- ALB and target group (`emoji-load-balancer`, `emoji-staging-tg`)
- IAM roles (`emoji-staging-ecs-execution-role`, `emoji-staging-ecs-task-role`)
  and the inline secret-read policy
- ECS cluster, ECS service, ECS task definition family (`emoji-staging-task`)
- CloudWatch log group (`/ecs/emoji-staging`)
- ACM certificate and ALB HTTPS listener (when ready)
- Optional: ECR repository (read-only reference if it already exists)

Not in scope for Terraform:

- MongoDB Atlas project, cluster, users, network access lists
- The actual secret values inside AWS Secrets Manager (Terraform will reference
  the secret ARNs only; secret rotation stays in AWS)
- Cognito user pools (still manual until Milestone 6)
- Application source code, container image build, or ECR pushes
  (handled by app build scripts and CI)

## Manual progress this plan must honor

The following resources already exist and are working in staging. Terraform
must adopt these via `terraform import` rather than create duplicates.

Milestone 2 (no AWS infra; reference only):

- App-level Mongoose models, repositories, controllers, and tests are in code.

Milestone 3A (Atlas + secret wiring):

- Atlas staging cluster `EmojiCluster` provisioned (manual).
- Atlas DB user and network access list configured (manual).
- AWS Secrets Manager secret holding `MONGODB_URI` is populated.
- Baseline alerts in Atlas configured.
- Closure evidence captured in `docs/testing/milestone-3-smoke-tests.md`.

Milestone 4 (compute infra already provisioned manually):

- ECR image (URI captured during ECR step).
- VPC and subnet selection (default VPC, multi-AZ).
- Security groups: `emoji-staging-alb-sg`, `emoji-staging-ecs-sg`.
- ALB: `emoji-load-balancer` (DNS
  `emoji-load-balancer-28533277.ap-southeast-2.elb.amazonaws.com`) with target
  group `emoji-staging-tg`. Note: the ALB's actual AWS name is
  `emoji-load-balancer`, not `emoji-staging-alb`. We adopt the existing name
  in Terraform; renames are not in scope.
- IAM roles:
  - `emoji-staging-ecs-execution-role` (ECR pull, CloudWatch logs).
  - `emoji-staging-ecs-task-role` with inline policy
    `emoji-staging-read-secrets` for Secrets Manager.
- ECS task definition family `emoji-staging-task` configured (env vars,
  secret references, log driver, port mapping).

Not yet created (greenfield candidates for Terraform):

- ECS cluster `emoji-staging-cluster`.
- CloudWatch log group `/ecs/emoji-staging`.
- ECS service `emoji-staging-service` (with ALB attachment).
- ACM certificate and HTTPS listener on the ALB.

## Adoption strategy: import-first, then evolve

We'll proceed in three phases per resource:

1. **Discover.** Read the resource via the AWS console or `aws` CLI to record
   its current shape (id, name, attributes, tags).
2. **Codify.** Write a Terraform resource block that matches that shape as
   closely as possible, then run `terraform import` to bind state without
   modification.
3. **Reconcile.** Run `terraform plan` and resolve any diffs by either
   adjusting the Terraform code (when AWS is the source of truth) or by
   accepting an apply that brings AWS into alignment with code (when the code
   is the source of truth). Prefer the first option for already-running
   resources during the initial import pass.

Guardrails:

- Always run `terraform plan` before `apply`.
- Never run `apply` against staging from a developer machine after T8 lands;
  use the CI pipeline.
- For destructive operations (security groups, IAM, ALB), require an explicit
  PR approval and a re-run of `plan` against the latest `main`.

## Target repository layout

We'll add Terraform inside the existing repo to keep app and infra in lockstep.

```text
infra/
  terraform/
    modules/
      network/        # VPC + subnet data sources, security groups
      alb/            # ALB, listeners, target group
      iam-ecs/        # exec role, task role, inline policies
      ecs-service/    # cluster, log group, task def, service
      acm/            # cert + listener wiring (used by alb)
    envs/
      staging/
        versions.tf       # required_version + provider versions
        backend.tf        # S3 + DynamoDB lock backend (wired in T1)
        main.tf           # provider config + module wiring
        variables.tf
        outputs.tf
        terraform.tfvars  # non-secret values only, committed
      prod/
        ... (added later)
    README.md
```

Note on `versions.tf` placement: Terraform only loads `*.tf` files from the
working directory it's invoked in, so the `terraform { ... }` block must
live inside each environment folder. Do not place a single shared
`versions.tf` at the top of `infra/terraform/`; it will not be picked up
when running from `envs/staging/`.

Key principles:

- Modules are *thin wrappers* around AWS resources, focused on the shapes our
  app actually uses (single-service ALB, Fargate-only ECS, etc.). We will not
  try to write a general-purpose module library.
- Environment folders (`envs/staging`, `envs/prod`) compose modules with
  per-env values. They are the only places `terraform apply` runs.
- Secrets are **never** committed. Files like `*.tfvars.local` and
  `*.auto.tfvars` should be in `.gitignore`.

## Remote state and locking

Local state is fine for a one-person prototype, but we should bootstrap
**S3 + DynamoDB locking** before we start importing. This:

- prevents two people (or two CI jobs) from clobbering each other,
- keeps state out of git,
- gives us versioned snapshots if state corrupts.

Resources to create once, manually, before T1:

- S3 bucket: `emoji-app-tfstate-<account>-<region>` with versioning + block
  public access enabled.
- DynamoDB table: `emoji-app-tflock` with primary key `LockID` (string).

These two resources are deliberately created **outside** Terraform to avoid the
chicken-and-egg "Terraform managing its own backend" problem.

## Provider and version baseline

```hcl
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      app         = "emoji-app"
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}
```

Pin the AWS provider to a minor version range so plans stay stable across
machines and CI.

## Naming, tagging, and module conventions

- Resource names continue the existing convention: `emoji-<env>-<role>`.
- All AWS resources receive default tags via the provider block (above).
- Modules accept an `environment` variable and prefix all names with it.
- Every module exposes the IDs/ARNs other modules need via outputs; modules
  never reach across each other directly.

## Milestone T0: Tooling and repo skeleton

Goal: set up local tooling so a developer can run `terraform plan` against
staging from their machine.

Steps:

1. Add `infra/terraform/` skeleton (directories above; empty placeholder
   `.tf` files are fine).
2. Add `infra/terraform/README.md` with:
   - prerequisites (Terraform >= 1.7, AWS CLI, AWS SSO profile),
   - how to log in,
   - how to run `terraform fmt`, `init`, `plan`,
   - link back to this milestones doc.
3. Update `.gitignore` to exclude:
   - `**/.terraform/`
   - `*.tfstate`
   - `*.tfstate.*`
   - `*.tfvars.local`
   - `*.auto.tfvars`
4. Add a recommended VS Code extension entry (`hashicorp.terraform`).

Exit criteria:

- `terraform fmt` runs cleanly on the skeleton.
- README clearly explains how to start.

## Milestone T1: Remote state backend bootstrap

Status: **Complete** (2026-05-03)

Goal: Terraform state lives in S3 with locking.

Steps:

1. Manually create the S3 bucket and DynamoDB table from the
   "Remote state and locking" section above.
2. Add `backend.tf` to `envs/staging/`:

   ```hcl
   terraform {
     backend "s3" {
       bucket         = "emoji-app-tfstate-<account>-<region>"
       key            = "staging/terraform.tfstate"
       region         = "<region>"
       dynamodb_table = "emoji-app-tflock"
       encrypt        = true
     }
   }
   ```

3. Run `terraform init` from `envs/staging/`.

Exit criteria:

- `terraform init` succeeds and reports the S3 backend.
- A bucket key under `staging/` appears after the first `plan` (or first
  `apply` for an empty configuration; Terraform skips state writes when
  there is nothing to record).

### T1 closure evidence

- S3 bucket `emoji-app-tfstate-100641718971-ap-southeast-2` created in
  `ap-southeast-2`. Versioning enabled, public access blocked, default
  SSE-S3 (AES256) encryption applied.
- DynamoDB table `emoji-app-tflock` created with `LockID` (string) hash key,
  `PAY_PER_REQUEST` billing.
- `infra/terraform/envs/staging/backend.tf` activated with the S3 backend.
- `terraform init` reported "Successfully configured the backend s3" and
  installed `hashicorp/aws v5.100.0`.
- `terraform apply -auto-approve` completed cleanly ("0 added, 0 changed,
  0 destroyed").
- State object verified in S3:
  `s3://emoji-app-tfstate-100641718971-ap-southeast-2/staging/terraform.tfstate`
  (181 bytes, empty resources).
- `terraform state list` from a fresh shell reads from S3 and returns
  empty (exit 0), confirming the backend round-trip works.

### Open follow-up: migrate to S3-native locking

Terraform 1.10+ deprecates the `dynamodb_table` parameter in favor of
`use_lockfile = true`, which uses a `.tflock` object inside the state
bucket itself. Our `init` and `plan` runs both surfaced this warning:

```text
Warning: Deprecated Parameter
The parameter "dynamodb_table" is deprecated. Use parameter
"use_lockfile" instead.
```

Migrating is a small, self-contained change to consider before T8
(CI/CD), since CI runs amplify the value of clean output. Steps when
ready:

1. Edit `backend.tf` to remove `dynamodb_table` and add `use_lockfile = true`.
2. Run `terraform init -reconfigure`.
3. Verify a `plan/apply` round-trip still works.
4. Delete the `emoji-app-tflock` DynamoDB table to stop paying for an
   unused resource (cents-per-year scale, but worth tidying).

## Milestone T2: Network and security baseline (import)

Status: **Complete** (2026-05-03)

Goal: Terraform owns the security groups and references the existing default
VPC and subnets without recreating them.

Resources to import:

- `aws_security_group.alb` -> `emoji-staging-alb-sg`
- `aws_security_group.ecs` -> `emoji-staging-ecs-sg`
- All five security group rules (ALB:80, ALB:443, ALB egress all,
  ECS:3000-from-ALB, ECS egress all)

Resources to **read-only reference** (data sources, not imported):

- `data.aws_vpc.default` (default VPC)
- `data.aws_subnets.default` (default subnets, filtered by VPC ID)

Implementation note: use the modern per-rule resources
(`aws_vpc_security_group_ingress_rule` / `aws_vpc_security_group_egress_rule`)
introduced in AWS provider 4.x rather than the legacy inline `ingress` /
`egress` blocks on `aws_security_group`. The per-rule resources avoid the
classic in-place rule drift problems and are imported by `sgr-*` rule ID.

Workflow:

1. Discover the live SG rules and rule IDs via
   `aws ec2 describe-security-group-rules`.
2. In `modules/network/`, write resources that mirror the live shape exactly.
3. From `envs/staging/`, run `terraform import` for each SG and rule.
4. Run `terraform plan`. The first plan after import will surface an
   additive diff because default tags from the provider block don't yet
   exist on the imported resources. Apply that diff once to establish the
   tagging baseline; subsequent plans are no-ops.

Exit criteria:

- `terraform plan` is a no-op against staging for network/SG resources
  (modulo the one-time additive tagging baseline).
- Default VPC and subnets are exposed via outputs for downstream modules.

### T2 closure evidence

- Discovered live shape from AWS CLI: 2 SGs in default VPC
  `vpc-00734c2d3a9a2caf0`, 5 rules total (`sgr-0af709fb085b0dc44`,
  `sgr-0d1b5f4a8753829e8`, `sgr-04666d0183a096020`,
  `sgr-04814651d294ff71d`, `sgr-045d11979f7357a57`).
- Authored `modules/network/` with `data.aws_vpc.default`,
  `data.aws_subnets.default`, two `aws_security_group` resources, three
  `aws_vpc_security_group_ingress_rule` resources, and two
  `aws_vpc_security_group_egress_rule` resources.
- Wired `module.network` into `envs/staging/main.tf` and exposed
  `vpc_id`, `subnet_ids`, `alb_security_group_id`, `ecs_security_group_id`
  via `envs/staging/outputs.tf`.
- All 7 imports succeeded on first attempt.
- Initial `plan` showed 7 in-place updates (additive: default tags +
  `revoke_rules_on_delete = false` Terraform-only fields). No replacements,
  no destructions.
- `terraform apply -auto-approve` reported "Apply complete! Resources:
  0 added, 7 changed, 0 destroyed.".
- Post-apply `plan` is a true no-op.
- `terraform state list` reports 9 managed entities (2 data sources, 2 SGs,
  5 rules); state file in S3 is 14,126 bytes (was 181 after T1).
- Output values:
  - `vpc_id = "vpc-00734c2d3a9a2caf0"`
  - `subnet_ids = ["subnet-04d6a20297d1b8357", "subnet-07cd30b25fe228e8f", "subnet-0e7030c134b0c450d"]`
  - `alb_security_group_id = "sg-08de63fa9f296d649"`
  - `ecs_security_group_id = "sg-09e4348dc1fc9ee08"`

## Milestone T3: ALB and target group (import)

Status: **Complete** (2026-05-03)

Goal: Terraform owns the ALB, listeners, and target group.

Resources to import (ARNs in `pre-T0.md`):

- `aws_lb.app` -> `emoji-load-balancer`
- `aws_lb_target_group.tg` -> `emoji-staging-tg`
- `aws_lb_listener.http` -> the existing HTTP:80 listener

Workflow:

1. In `modules/alb/`, write the ALB, target group, and HTTP listener
   resources to mirror the current setup (target type `ip`, port 3000,
   health check path `/api/badges`, matcher `200`). Use `name =
   "emoji-load-balancer"` on the ALB resource so import lines up cleanly.
2. Import each by ARN, e.g.:

   ```bash
   terraform import module.alb.aws_lb.app \
     arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:loadbalancer/app/emoji-load-balancer/5320cebe2e987bb7
   terraform import module.alb.aws_lb_target_group.tg \
     arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:targetgroup/emoji-staging-tg/46cf6b8cb3c5df66
   terraform import module.alb.aws_lb_listener.http \
     arn:aws:elasticloadbalancing:ap-southeast-2:100641718971:listener/app/emoji-load-balancer/5320cebe2e987bb7/2b06791ef4473d64
   ```

3. Reconcile `plan` until it's a no-op.

Exit criteria:

- `terraform plan` is a no-op for the ALB stack (modulo the one-time
  additive tagging baseline and listener forward-block normalization).
- Target group ARN is exposed as an output for the ECS service module.

### T3 closure evidence

- Discovered live shape via AWS CLI: ALB `internet-facing`, ipv4, on
  subnets `subnet-04d6a20297d1b8357` and `subnet-0e7030c134b0c450d` (only
  2 of the 3 default subnets); idle timeout 60s; HTTP/2 enabled; access
  logs disabled; HTTP:80 listener forwards to target group; target group
  HTTP/3000, target type `ip`, health check `/api/badges`, matcher 200,
  interval 30s, timeout 5s, healthy/unhealthy thresholds 5/2.
- Authored `modules/alb/` with `aws_lb.app`, `aws_lb_target_group.tg`,
  `aws_lb_listener.http`, plus `variables.tf` (vpc_id, subnet_ids,
  alb_security_group_id, environment) and `outputs.tf` (alb_arn,
  alb_dns_name, alb_zone_id, target_group_arn, http_listener_arn).
- Subnet decision: pinned the ALB to the existing 2 subnets via a
  `local.alb_subnet_ids` list in `envs/staging/main.tf`. Extending to the
  3rd default AZ is tracked as an availability decision separate from
  this import.
- All 3 imports succeeded on first attempt.
- First post-import plan showed 3 in-place updates (additive: default tags
  on all three; plus two recorded defaulted booleans on the target group
  and a listener `forward {}` block normalization). No replacements, no
  destructions, no behavioral change in AWS.
- `terraform apply -auto-approve` reported "Apply complete! Resources:
  0 added, 3 changed, 0 destroyed.".
- Post-apply `plan` is a true no-op.
- Output values:
  - `alb_arn = "arn:...loadbalancer/app/emoji-load-balancer/5320cebe2e987bb7"`
  - `alb_dns_name = "emoji-load-balancer-28533277.ap-southeast-2.elb.amazonaws.com"`
  - `target_group_arn = "arn:...targetgroup/emoji-staging-tg/46cf6b8cb3c5df66"`
  - `http_listener_arn = "arn:...listener/app/emoji-load-balancer/5320cebe2e987bb7/2b06791ef4473d64"`

### Tracked follow-ups (not blocking T4)

- **ALB AZ coverage.** ALB currently spans 2 of 3 AZs. Extending to all 3
  would improve availability at zero ALB cost change (data transfer cost
  is the only consideration). Defer the explicit decision; revisit before
  prod.
- **Idle timeout for WebSockets.** Default 60s is fine for HTTP, but
  long-lived WebSocket connections in T6 will need either a higher idle
  timeout or app-level pings. Raise as part of T6 transport tuning.

## Milestone T4: IAM roles and policies (import)

Goal: Terraform owns the two ECS roles and the inline secret-read policy.

Resources to import:

- `aws_iam_role.ecs_execution` -> `emoji-staging-ecs-execution-role`
- `aws_iam_role.ecs_task` -> `emoji-staging-ecs-task-role`
- `aws_iam_role_policy_attachment` for
  `AmazonECSTaskExecutionRolePolicy` on the execution role
- `aws_iam_role_policy.read_secrets` -> the inline policy
  `emoji-staging-read-secrets` on the task role

Workflow:

1. In `modules/iam-ecs/`, recreate the trust policies (trust principal:
   `ecs-tasks.amazonaws.com`) and the inline policy. Use a `data` source to
   look up the staging Secrets Manager secret ARN(s) so the inline policy is
   scoped tightly:

   ```hcl
   data "aws_secretsmanager_secret" "mongodb_uri" {
     name = "emoji-app/staging/mongodb-uri"
   }
   ```

2. Import each role and the inline policy by composite ID
   (`role-name:policy-name` for inline policies).
3. Reconcile `plan` until it's a no-op.

Exit criteria:

- `terraform plan` is a no-op for the IAM stack.
- Role ARNs exposed as outputs for the ECS task definition.

## Milestone T5: Task definition under Terraform (re-author)

Goal: Terraform manages future revisions of the `emoji-staging-task`
task definition family.

Note on import: AWS task definitions are **immutable revisions**, so importing
a single revision is low value. Instead, we'll re-author the task definition
in Terraform and let Terraform create the next revision. The currently
running revision stays as-is until the ECS service is updated.

Prerequisites surfaced in pre-T0:

- **OpenAI secret must exist before this step.** `pre-T0.md` shows only
  `emoji-app/staging/mongodb-uri` exists today; there is no
  `emoji-app/staging/openai-api-key`. Pick one of:
  - create the OpenAI secret in Secrets Manager (preferred, same pattern as
    Mongo URI), or
  - omit `OPENAI_API_KEY` from the staging task definition (the AI chat
    panel degrades but core game flow works), or
  - pass it as a plain env var (least secure, only acceptable as a stop-gap).
- **Image pinning decision.** The current ECR repo has only `:latest` as a
  tag. Decide before `apply` whether `var.image_uri` resolves to:
  - a digest (e.g.
    `100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app@sha256:ca33d43f...`)
    -- recommended for immutable rollbacks, or
  - a versioned tag like `staging-2026-04-27` -- easier to read in logs.
  Avoid pinning to `:latest` once Terraform manages the task def.

Steps:

1. In `modules/ecs-service/task-definition.tf`, define
   `aws_ecs_task_definition.this` with:
   - family `emoji-staging-task`
   - launch type `FARGATE`
   - CPU/memory matching current revision
   - container `emoji-app` with image URI from `var.image_uri`
   - environment variables: `NODE_ENV`, `HOST`, `PORT`,
     `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_REGION`
   - secrets: `MONGODB_URI` (and `OPENAI_API_KEY` only if the secret exists)
   - log configuration: `awslogs` -> `/ecs/emoji-staging`
2. Add `var.image_uri` so we can promote a known image from CI.
3. Initial `terraform apply` will create a **new revision** (`:N+1`).
   The running service still pins `:N` until T6.

Exit criteria:

- `terraform apply` produces a new task definition revision.
- The new revision is structurally equivalent to the manual one (modulo any
  resolved gaps above).
- Running ECS workload is undisturbed.

## Milestone T6: ECS cluster, log group, and service (greenfield)

Goal: Terraform owns the ECS cluster, log group, and the service that wires
the new task definition to the ALB target group.

Resources to create fresh (none of these exist yet):

- `aws_cloudwatch_log_group.app` -> `/ecs/emoji-staging`
- `aws_ecs_cluster.staging` -> `emoji-staging-cluster`
- `aws_ecs_service.app` -> `emoji-staging-service`
  - launch type `FARGATE`
  - desired count `1` for prototype
  - subnets from default VPC data source
  - security group from network module
  - load balancer block referencing target group from ALB module
  - depends on the task definition module output

Steps:

1. Implement the resources in `modules/ecs-service/`.
2. `terraform apply` from `envs/staging/`.
3. Validate using the existing checklist:
   - tasks reach `RUNNING`
   - target group health goes `healthy`
   - ALB DNS responds on `/api/badges`
   - DB-backed smoke flow from `docs/manual-tests.md` section 8 succeeds
   - WebSocket connection upgrades successfully through the ALB

Exit criteria:

- ECS service is fully managed by Terraform.
- Manual console-only changes for staging compute are no longer required.

## Milestone T7: HTTPS and ACM (greenfield)

Goal: Add HTTPS listener under Terraform once a staging domain is decided.

Steps:

1. Request an ACM certificate via Terraform (`aws_acm_certificate`) using DNS
   validation against the chosen domain.
2. Add a Route 53 (or external DNS) validation record. Route 53 hosted zones
   stay manual unless we adopt them later.
3. Add `aws_lb_listener.https` and (optionally) an HTTP-to-HTTPS redirect
   on the existing port 80 listener.

Exit criteria:

- `https://staging.<domain>` and `wss://staging.<domain>/...` work end to end.
- Certificate renewal is automatic (ACM-managed).

## Milestone T8: CI/CD for Terraform plan and apply

Goal: Stop running `terraform apply` from developer laptops.

Steps:

1. Add a GitHub Actions (or current CI) workflow that:
   - On PRs touching `infra/terraform/**`: runs `terraform fmt -check`,
     `init`, `validate`, and `plan -no-color` and posts the plan as a PR
     comment.
   - On merges to `main`: runs `apply` for `envs/staging/`.
2. Use OIDC federation between GitHub Actions and AWS so the pipeline assumes
   a least-privilege IAM role instead of long-lived access keys.
3. Require at least one approving review on PRs that change `infra/`.
4. Require successful plan output to be attached to the PR before merging.

Exit criteria:

- A documented, repeatable PR-driven workflow for changing staging infra.
- No long-lived AWS keys in CI.

## Milestone T9: Support for later product milestones

Where Terraform earns its keep for future milestones in `docs/milestones.md`.

- **Milestone 5 (gameplay integrity).** No infra change required, but having
  Terraform makes it cheap to spin up an ephemeral `loadtest` env for
  concurrency tests by adding `envs/loadtest/`.
- **Milestone 6 (real-time).** When we revisit transport layers, Terraform
  changes will be limited to:
  - ALB idle timeout tuning (`aws_lb` attribute),
  - target group stickiness if we add it,
  - any additional listener rules.
- **Milestone 7 (production readiness).**
  - Add `envs/prod/` with a dedicated VPC module.
  - Promote the staging modules unchanged; just provide different vars.
  - Add autoscaling targets (`aws_appautoscaling_target` and policy).
  - Add WAF, access logs to S3, and CloudWatch alarms via Terraform.

## Out of scope: MongoDB Atlas

Atlas (project, cluster, DB users, network access list, alerts) is intentionally
managed via the Atlas console. Reasons:

- We're on the free tier; the [MongoDB Atlas Terraform provider](https://registry.terraform.io/providers/mongodb/mongodbatlas/latest)
  is more valuable on paid tiers with private endpoints and PrivateLink.
- For a prototype, the Atlas console is faster and lower-risk.
- We can revisit codifying Atlas in a later hardening milestone (closer to
  Milestone 7) without disrupting the AWS Terraform path.

What Terraform **does** touch related to Atlas:

- The AWS Secrets Manager secret that stores the Atlas connection string is
  referenced as a `data` source so IAM policies can be tightly scoped.

## Risk register and rollback strategy

Top risks during adoption:

- **Import drift.** Imported resource doesn't exactly match the Terraform
  block, causing a destructive `plan`. Mitigation: never `apply` an import
  diff blindly; iterate on the code until `plan` is a no-op.
- **State corruption.** Mitigation: S3 versioning is enabled in T1; recover
  by reverting to a previous state version.
- **CI mis-permissions.** Mitigation: T8 uses a scoped role limited to the
  resources in this plan; widen it only when justified.
- **Atlas password rotation.** Not a Terraform concern, but the staging
  secret in Secrets Manager must be updated whenever Atlas credentials
  rotate. Document this in the runbook.

Rollback strategies:

- For any single Terraform change: `terraform apply` of the previous
  revision (PR revert).
- For broken state: restore a prior S3 state version, then re-plan.
- For broken ECS service: pin the service back to the prior task definition
  revision via Terraform variable `task_definition_revision`.

## Reference snippets

These are illustrative shapes only; final code lives in `infra/terraform/`.

Default VPC and subnets data sources:

```hcl
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}
```

ALB target group matching the existing manual config:

```hcl
resource "aws_lb_target_group" "tg" {
  name        = "emoji-staging-tg"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  health_check {
    path                = "/api/badges"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }
}
```

Tightly-scoped Secrets Manager read policy on the task role:

```hcl
data "aws_secretsmanager_secret" "mongodb_uri" {
  name = "emoji-app/staging/mongodb-uri"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      data.aws_secretsmanager_secret.mongodb_uri.arn,
    ]
  }
}

resource "aws_iam_role_policy" "read_secrets" {
  name   = "emoji-staging-read-secrets"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.read_secrets.json
}
```

ECS task definition with secrets and env vars. The OpenAI secret is gated
behind `var.openai_secret_enabled` so the plan still works before the secret
exists in Secrets Manager (see T5 prerequisites):

```hcl
data "aws_secretsmanager_secret" "openai_api_key" {
  count = var.openai_secret_enabled ? 1 : 0
  name  = "emoji-app/staging/openai-api-key"
}

locals {
  base_secrets = [
    {
      name      = "MONGODB_URI"
      valueFrom = data.aws_secretsmanager_secret.mongodb_uri.arn
    },
  ]

  openai_secret = var.openai_secret_enabled ? [
    {
      name      = "OPENAI_API_KEY"
      valueFrom = data.aws_secretsmanager_secret.openai_api_key[0].arn
    },
  ] : []

  container_secrets = concat(local.base_secrets, local.openai_secret)
}

resource "aws_ecs_task_definition" "app" {
  family                   = "emoji-staging-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "emoji-app"
    image     = var.image_uri
    essential = true
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "HOST",     value = "0.0.0.0" },
      { name = "PORT",     value = "3000" },
      { name = "COGNITO_USER_POOL_ID",  value = var.cognito_user_pool_id },
      { name = "COGNITO_APP_CLIENT_ID", value = var.cognito_app_client_id },
      { name = "COGNITO_REGION",        value = var.cognito_region },
    ]
    secrets = local.container_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}
```
