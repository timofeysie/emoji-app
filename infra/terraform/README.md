# `infra/terraform/`

Terraform code for the AWS infrastructure that hosts emoji-app. This is the
skeleton committed in Milestone T0 of the Terraform parallel path.

For background, design, and per-milestone procedure, read the two milestone
docs first:

- [`docs/milestones/terraform-milestones.md`](../../docs/milestones/terraform-milestones.md):
  the full T0–T9 plan (what to import, what to greenfield, why).
- [`docs/milestones/pre-T0.md`](../../docs/milestones/pre-T0.md):
  the discovered IDs and ARNs every import command needs.

## Layout

```text
infra/terraform/
  modules/
    network/        # VPC + subnet data sources, security groups (T2)
    alb/            # ALB, listeners, target group (T3)
    iam-ecs/        # exec role, task role, inline policies (T4)
    ecs-service/    # cluster, log group, task def, service (T5/T6)
    acm/            # cert + HTTPS listener (T7)
  envs/
    staging/        # only environment with real resources during the prototype
      versions.tf       # required_version + provider versions
      backend.tf        # S3 + DynamoDB lock backend (wired in T1)
      main.tf           # provider config + module wiring
      variables.tf      # input variables
      outputs.tf        # environment-level outputs
      terraform.tfvars  # non-secret values (committed)
    prod/           # added later
  README.md         # this file
```

A note on `versions.tf` placement: Terraform only loads `*.tf` files from the
working directory it's invoked in, so `terraform { ... }` blocks must live
inside each environment folder. We therefore keep `versions.tf` per-env.
When `prod/` is added, it gets its own copy.

## Prerequisites

- Terraform `>= 1.7` (verify with `terraform -version`).
- AWS CLI v2, authenticated to the staging account
  (`aws sts get-caller-identity` should resolve to
  `arn:aws:iam::100641718971:user/cdk-user`).
- AWS region defaulted to `ap-southeast-2`
  (`aws configure set region ap-southeast-2` if not already).

If any of those is missing, see `docs/milestones/pre-T0.md` for install
instructions.

## Common workflow

All commands run from inside an environment folder, e.g.:

```powershell
cd infra/terraform/envs/staging
```

Format and validate the code:

```powershell
terraform fmt -recursive
terraform validate
```

Initialize providers and (later) the remote backend:

```powershell
terraform init
```

Preview a change without applying it:

```powershell
terraform plan
```

Apply (only after T8 lands, this is done by CI rather than from a laptop):

```powershell
terraform apply
```

## Status by milestone

| Milestone | Status | Touches |
| --- | --- | --- |
| T0: Tooling and repo skeleton | done | this directory, `.gitignore`, `.vscode/extensions.json` |
| T1: Remote state backend bootstrap | done | S3 bucket + DynamoDB lock table (manual), `backend.tf` |
| T2: Network and security baseline (import) | done | `modules/network/` |
| T3: ALB and target group (import) | done | `modules/alb/` |
| T4: IAM roles and policies (import) | done | `modules/iam-ecs/` |
| T5: Task definition under Terraform | done | `modules/ecs-service/` |
| T6: ECS cluster, log group, service | infra done; runtime validation pending image rebuild | `modules/ecs-service/`, `Dockerfile` |
| T7: HTTPS and ACM | pending | `modules/acm/` |
| T8: CI/CD plan and apply | pending | `.github/workflows/` |
| T9: Support for later product milestones | pending | follow-on work |

## Conventions

- Module folders are thin wrappers around the AWS resources our app actually
  uses. They are not a general-purpose library.
- Resource AWS names use the existing `emoji-staging-*` convention with the
  one exception called out in `pre-T0.md`: the ALB's AWS name is
  `emoji-load-balancer`.
- All resources receive default tags via the provider block in `main.tf`:
  `app=emoji-app`, `environment=<env>`, `managed_by=terraform`.
- `*.tfvars.local` and `*.auto.tfvars` are gitignored. Never commit secrets.
- During the import-first phase, treat any non-empty `terraform plan` as a
  signal to update the Terraform code, not to run `apply`.

## Out of scope here

MongoDB Atlas (project, cluster, users, network access list, alerts) is
managed manually via the Atlas console. See `docs/milestones.md` Milestone
3A and `docs/testing/milestone-3-smoke-tests.md`.

This Terraform code only references the existing AWS Secrets Manager secret
that holds the Atlas connection string; it does not manage the secret value
or its rotation.
