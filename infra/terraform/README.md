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

## Deploy a new container image (ECR + ECS)

After you change application code or the `Dockerfile`, ECS needs a new image
in ECR and Terraform needs to point the task definition at that tag.

Prefer an **immutable tag** (e.g. `staging-2026-05-03`) instead of `:latest`,
so `terraform plan` always matches a specific image you can roll back to.

1. **Build** the image locally (from the repo root). Pass Cognito `VITE_*`
   build args if the client bundle must match staging hosted UI settings.

   Cognito → app client callback / sign-out must include your **public HTTPS origin**. For ECS
   staging with a custom domain, add **`https://emoji-staging.kogs.link/auth/callback`** and
   **`https://emoji-staging.kogs.link/`** (see [`docs/auth.md`](../../docs/auth.md)).

   ```powershell
   cd <repo-root>
   docker build -t emoji-app:staging-2026-05-03 `
     --build-arg VITE_COGNITO_DOMAIN="https://<your-pool>.auth.<region>.amazoncognito.com" `
     --build-arg VITE_COGNITO_CLIENT_ID="<app-client-id>" `
     --build-arg VITE_COGNITO_SCOPES="openid email profile" `
     .
   ```

2. **Log in to ECR** (once per shell session, or when the token expires):

   ```powershell
   aws ecr get-login-password --region ap-southeast-2 |
     docker login --username AWS --password-stdin 100641718971.dkr.ecr.ap-southeast-2.amazonaws.com
   ```

3. **Tag and push** the same tag you will put in Terraform:

   ```powershell
   $registry = "100641718971.dkr.ecr.ap-southeast-2.amazonaws.com"
   $tag = "staging-2026-05-03"
   docker tag "emoji-app:$tag" "$registry/emoji-app:$tag"
   docker push "$registry/emoji-app:$tag"
   ```

   If you already built and only tagged `:latest`, you can add a second tag
   without rebuilding: `docker tag emoji-app:latest "$registry/emoji-app:$tag"`
   then `docker push "$registry/emoji-app:$tag"`.

4. **Set `image_uri`** in `envs/staging/terraform.tfvars` to the full URI:

   ```text
   100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:staging-2026-05-03
   ```

5. **Apply** from the staging env (registers a new task definition revision
   and updates the service):

   ```powershell
   cd infra/terraform/envs/staging
   terraform plan
   terraform apply
   ```

6. **Smoke-test the ALB** — get the DNS name, then hit the health route.

   ```powershell
   terraform output -raw alb_dns_name
   ```

   On Windows, use **`curl.exe`** (not the `curl` alias) so you get real curl
   behavior:

   ```powershell
   curl.exe -sS -w "\nHTTP %{http_code}\n" "http://$(terraform output -raw alb_dns_name)/api/badges"
   ```

   With a literal hostname (example from your environment):

   ```powershell
   curl.exe -sS -w "\nHTTP %{http_code}\n" "http://emoji-load-balancer-28533277.ap-southeast-2.elb.amazonaws.com/api/badges"
   ```

   Expect HTTP **200** if the target group health check path is healthy.

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
