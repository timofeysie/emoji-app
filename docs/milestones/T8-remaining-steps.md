# T8 remaining steps — close the milestone completely

[Milestone **T8** in `terraform-milestones.md](terraform-milestones.md#milestone-t8-cicd-for-terraform-plan-and-apply)` has two halves:

| Half                   | Meaning                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In the repo**        | Workflow + documented bootstrap IAM path — **already merged** unless you intentionally removed files.                                             |
| **Outside GitHub/AWS** | You still wire **OIDC → IAM**, the `**AWS_ROLE_TO_ASSUME`** secret, and **branch rules** so every real change goes **PR → plan → merge → apply**. |

Use this checklist to declare T8 **fully closed** once each item below is verified (not merely “documentation exists”).

Canonical IAM procedure (JSON, CLI sketches): `**[infra/terraform/ci/T8-setup-github-oidc.md](../../infra/terraform/ci/T8-setup-github-oidc.md)`**.

---

## 1. What is already in the app (repo)

Confirm these exist on `main` (paths from repository root):

| Item                                                                                                                                                  | Purpose                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `[.github/workflows/terraform-staging.yml](../../.github/workflows/terraform-staging.yml)`                                                            | PR: `fmt -check`, `init`, `validate`, `plan`, sticky comment + artifact. Push to `main`: `apply` for `infra/terraform/envs/staging`. |
| `[infra/terraform/ci/T8-setup-github-oidc.md](../../infra/terraform/ci/T8-setup-github-oidc.md)`                                                      | IAM OIDC provider, trust policy, suggested policies, secret name `**AWS_ROLE_TO_ASSUME**`.                                           |
| References in `[docs/milestones/terraform-milestones.md](terraform-milestones.md)` and `[infra/terraform/README.md](../../infra/terraform/README.md)` | T8 called out + status table notes “finish OIDC + secret”.                                                                           |


Behavioural constraints baked into the workflow (know these when troubleshooting):

- **Path filters**: Only changes under `**infra/terraform/**`** or the workflow file itself trigger `**Plan**` / `**Apply**`. Editing only `client/` does **not** run Terraform CI.
- **Forks**: `**Plan`** skips when `**pull_request.head.repo.full_name**` ≠ `**github.repository**` (no OIDC/secrets across forks).
- **Plan exit codes**: exit **2** = diff present (still success); only exit **1** fails the job.
- **Sticky PR comment**: may fail if the output file is missing; the step `**continue-on-error: true`** — still read the **Actions log** and the **plan artifact** if the comment is empty.

---

## 2. AWS (outside the repo) — OIDC and role permissions

Do this once per AWS account (or reuse an existing GitHub OIDC provider in that account).

### 2.1 Preconditions

- Admin (or sufficient IAM) access to account **100641718971** (or your target account).
- Region **ap-southeast-2** for Terraform state and resources (matches `[envs/staging](../../infra/terraform/envs/staging)`).
- Know your GitHub `**OWNER/REPO`** string (e.g. `myorg/emoji-app`).

### 2.2 Steps (summary)

Follow `**[infra/terraform/ci/T8-setup-github-oidc.md](../../infra/terraform/ci/T8-setup-github-oidc.md)**` in order:

1. **Create or verify** the IAM OIDC identity provider for `https://token.actions.githubusercontent.com` (client ID list includes `**sts.amazonaws.com`**).
2. **Create IAM role** (e.g. `**GitHubTerraformStaging`**) with a **trust policy** that allows:
  - `repo:OWNER/REPO:ref:refs/heads/main` (push/merge applies), and  
  - `repo:OWNER/REPO:pull_request` (PR plans).
   Do **not** widen `sub` to `repo:ORG/*` unless you accept any repo in the org assuming that role.
3. **Attach permissions** so `terraform plan` and `terraform apply` succeed against this stack. The doc suggests `**PowerUserAccess`** plus an explicit **state/lock** inline policy (S3 state bucket + DynamoDB lock table). Add `**IAMFullAccess`** only if applies fail on IAM changes and you accept that scope for this role.
4. **Copy the role ARN** (e.g. `arn:aws:iam::100641718971:role/GitHubTerraformStaging`).

### 2.3 Common failures


| Symptom                                                                 | Likely fix                                                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Could not assume role` / `AccessDenied` on `AssumeRoleWithWebIdentity` | Trust policy `**sub`** / `**aud**` mismatch; typo in `**OWNER/REPO**`; wrong account’s OIDC provider ARN.                                                               |
| `AccessDenied` during `plan`/`apply` on specific AWS APIs               | Missing managed/inline policy on the role (often IAM, PassRole, or a service API).                                                                                      |
| State lock errors in CI                                                 | Another run or laptop holds the lock — use **force-unlock** only when safe (see [Error acquiring the state lock](../issues/Error%20acquiring%20the%20state%20lock.md)). |


---

## 3. GitHub (outside the repo) — secret and org settings

### 3.1 Repository secret

1. Open the repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**
  - **Name:** `**AWS_ROLE_TO_ASSUME`** (must match the workflow — see `configure-aws-credentials` in `[.github/workflows/terraform-staging.yml](../../.github/workflows/terraform-staging.yml)`).  
  - **Value:** the IAM role ARN from §2.

No `**AWS_ACCESS_KEY_ID`** / `**AWS_SECRET_ACCESS_KEY**` are required for this design.

### 3.2 GitHub Actions and OIDC

- For **private repos** on github.com, OIDC for Actions is usually on by default.
- If the repo lives under a **GitHub Enterprise** org, confirm org policies allow **OpenID Connect** for Actions ([GitHub doc](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-cloud-providers)).

### 3.3 Optional: environments

The workflow does **not** use a GitHub **Environment** for approval gates. You can add an `environment: production` (or `terraform-staging`) on the **apply** job later if you want a manual approval before `terraform apply`.

---

## 4. Branch protection / rulesets (policy — not in git)

Milestone T8 expects:

1. **Pull requests required** to merge into `**main`** (no direct pushes that skip review for infra, if you want the spirit of T8).
2. **At least one approving review** for changes that touch `**infra/`** (or for all `main` merges — stricter is fine).
3. **Status check required:** the check name shown in GitHub for the plan job is `**Plan (staging)`** (see `jobs.plan.name` in the workflow). Require it **green** before merge on infra PRs.

How to set this (UI moves occasionally):

- **Classic:** **Settings** → **Branches** → **Branch protection rules** for `main` → require PR, reviews, and **status checks** → search for **Plan (staging)** after the first workflow run.
- **Rulesets:** **Settings** → **Rules** → **Rulesets** — same ideas: target `main`, require pass of `**Plan (staging)`** for PRs that change Terraform (you can scope by path if your plan allows).

Until this is configured, you can still merge with a broken plan or without review — T8 is not **operationally** complete.

---

## 5. First-time verification (prove CI end-to-end)

1. Open a **draft PR** that only touches something harmless under `**infra/terraform/`** (e.g. a comment in `envs/staging/main.tf`) **or** only the workflow file.
2. Confirm **Actions** runs **Terraform (staging)** → job **Plan (staging)** completes green.
3. Confirm a **sticky comment** or **artifact** contains a plan; read the log for `No changes` vs real diffs.
4. **Merge** to `**main`** after review.
5. Confirm the **Apply (staging)** job runs and finishes green (watch for long applies if `[wait_for_steady_state](../../infra/terraform/modules/ecs-service/variables.tf)` keeps ECS rolling).

After that, treat **laptop `terraform apply`** as **break-glass only** (state lock conflicts with CI are easy to cause if two writers run).

---

## 6. Definition of done (T8 fully finished)

You can mark T8 **closed** when:

- IAM OIDC provider + role + policies exist; role ARN is in `**AWS_ROLE_TO_ASSUME`**.  
- `**Plan (staging)**` is required (or equivalent ruleset) before merging infra PRs to `**main**`.  
- At least **one approval** is required for those merges (per team policy).  
- A real PR has shown a **green plan** and a merge has shown a **green apply** at least once.  
- Team agrees: **staging infra changes** default to **merge to `main`**, not ad-hoc laptop apply.

Then update narrative text in `[infra/terraform/README.md](../../infra/terraform/README.md)` (T8 row) if you still want the “add OIDC + secret” caveat removed.

---

## Related links


| Doc                                                            | Topic                                       |
| -------------------------------------------------------------- | ------------------------------------------- |
| `[terraform-milestones.md](terraform-milestones.md)`           | Full T0–T9 narrative                        |
| `[infra/terraform/README.md](../../infra/terraform/README.md)` | Day-to-day Terraform commands, image deploy |
| `[pre-T0.md](pre-T0.md)`                                       | Account IDs, state bucket names             |
| `[docs/aws/cloudwatch.md](../aws/cloudwatch.md)`               | Logs/metrics (operational, not T8-specific) |


