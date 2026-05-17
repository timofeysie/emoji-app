# T8 bootstrap: GitHub Actions → AWS (OIDC) for Terraform

This repo avoids long-lived AWS access keys in GitHub. Plans and applies use OIDC (`sts:AssumeRoleWithWebIdentity`).

Bootstrap steps match milestone **T8** in [`docs/milestones/terraform-milestones.md`](../../../docs/milestones/terraform-milestones.md).

## Prerequisites

- AWS CLI signed in as an admin in account **100641718971** (or run equivalent in your account).
- Your GitHub repository as **`OWNER/REPO`** — replace placeholders below.

Workflow file: **[`.github/workflows/terraform-staging.yml`](../../../.github/workflows/terraform-staging.yml)**.

## 1. IAM OIDC provider (once per AWS account)

Reuse if already present:

```powershell
aws iam list-open-id-connect-providers --output text
```

Create if missing ([AWS doc: GitHub Actions](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)):

```powershell
aws iam create-open-id-connect-provider `
  --url https://token.actions.githubusercontent.com `
  --client-id-list sts.amazonaws.com `
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

## 2. IAM role trust policy (GitHub → AWS)

Example role name: **`GitHubTerraformStaging`**.

Principal ARN:

`arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com`

Trust policy (allows **merged `main`** runs and **`pull_request`** plans):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GitHubOIDCStagingTerraform",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:OWNER/REPO:ref:refs/heads/main",
            "repo:OWNER/REPO:pull_request"
          ]
        }
      }
    }
  ]
}
```

For **`emoji-app`**, **`REPO`** is typically **`emoji-app`**; **`OWNER`** is your user or GitHub org.

Create the role (example filenames):

```powershell
aws iam create-role `
  --role-name GitHubTerraformStaging `
  --assume-role-policy-document file://trust-github-emoji-app.json `
  --description "GitHub Actions Terraform staging (OIDC)"
```

Fork PRs cannot use your **`AWS_ROLE_TO_ASSUME`** secret; the workflow also skips when `head.repo.full_name` ≠ `github.repository`.

## 3. Permissions attached to the role

Tight IAM for every resource this Terraform tree touches takes iteration. Practical path:

1. Attach AWS managed **`PowerUserAccess`** (add **`IAMFullAccess`** only if `apply` IAM errors persist — PowerUser skips some IAM admins).
2. Add an inline policy covering the **remote state backend** (required even if PowerUser overlaps):

Save as **`backend-policy.json`** and run **`put-role-policy`**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TerraformBackend",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::emoji-app-tfstate-100641718971-ap-southeast-2",
        "arn:aws:s3:::emoji-app-tfstate-100641718971-ap-southeast-2/*"
      ]
    },
    {
      "Sid": "TerraformLock",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:DescribeTable"
      ],
      "Resource": "arn:aws:dynamodb:ap-southeast-2:100641718971:table/emoji-app-tflock"
    },
    {
      "Sid": "StsMeta",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    }
  ]
}
```

```powershell
aws iam attach-role-policy `
  --role-name GitHubTerraformStaging `
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess

aws iam put-role-policy `
  --role-name GitHubTerraformStaging `
  --policy-name EmojiAppTerraformBackend `
  --policy-document file://backend-policy.json
```

Replace ARNs above if your bucket/table names differ.

## 4. GitHub secret

1. Copy the role ARN, e.g. `arn:aws:iam::100641718971:role/GitHubTerraformStaging`.
2. GitHub repo → **Settings → Secrets and variables → Actions**.
3. New repository secret **`AWS_ROLE_TO_ASSUME`** = that ARN.

## 5. Branch protection (console / rulesets)

- Require **≥1 approving review** on PRs targeting **`main`**.
- Require the **`Plan (staging)`** check green before merge (after the first infra PR validates the workflow).
- Optionally use [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) scoped to **`infra/terraform/**`.

## 6. Behaviour

| Event | Job | Effect |
| --- | --- | --- |
| PR changing `infra/terraform/**` into **`main`** | **Plan (staging)** | `fmt -check`, `init`, `validate`, `plan`, sticky PR comment |
| Merge / push on **`main`** with same paths | **Apply (staging)** | `init`, `apply -auto-approve` for **`envs/staging`** |

Serialise applies via job concurrency (**`terraform-staging-apply-main`**).

Stop merging infra PRs if the sticky plan comment shows unexpected **destroy** operations.

## 7. Troubleshooting OIDC

- **`Credentials could not be loaded`**: wrong secret name or **`AWS_ROLE_TO_ASSUME`** missing.
- **`Access denied`** assuming role: fix trust **`sub`** patterns (`OWNER/REPO` typo, org vs fork).
- **Thumbprint expired**: **`aws iam update-open-id-connect-provider-thumbprint`** (see AWS/GitHub OIDC docs).
