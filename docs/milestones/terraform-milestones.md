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
        main.tf
        variables.tf
        outputs.tf
        backend.tf
        terraform.tfvars  # non-secret values only, committed
      prod/
        ... (added later)
    versions.tf       # required_version + provider versions
    README.md
```

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
- A bucket key under `staging/` appears after the first `plan`.

## Milestone T2: Network and security baseline (import)

Goal: Terraform owns the security groups and references the existing default
VPC and subnets without recreating them.

Resources to import:

- `aws_security_group.alb` -> `emoji-staging-alb-sg`
- `aws_security_group.ecs` -> `emoji-staging-ecs-sg`
- The two security group rules between them (ingress on `3000` from ALB SG)

Resources to **read-only reference** (data sources, not imported):

- `data.aws_vpc.default` (default VPC)
- `data.aws_subnets.default` (default subnets, filtered by VPC ID)

Workflow:

1. In `modules/network/`, write security group resources that match the live
   inbound/outbound rules.
2. From `envs/staging/`, run for each existing SG:

   ```bash
   terraform import module.network.aws_security_group.alb sg-XXXXXXXX
   terraform import module.network.aws_security_group.ecs sg-YYYYYYYY
   ```

3. Run `terraform plan`. Iterate on the rule blocks until `plan` shows no
   changes.

Exit criteria:

- `terraform plan` is a no-op against staging for network/SG resources.
- Default VPC and subnets are exposed via outputs for downstream modules.

## Milestone T3: ALB and target group (import)

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

- `terraform plan` is a no-op for the ALB stack.
- Target group ARN is exposed as an output for the ECS service module.

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
