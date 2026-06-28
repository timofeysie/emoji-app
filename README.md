# Emoji App

A generative-UI demo built with [Hashbrown](https://hashbrown.dev), React, and NestJS (Express-backed). An AI chat panel sits alongside a standard CRUD interface and can read and update app state directly — adding lights, creating scenes, and scheduling them — through structured tool calls rather than plain text.

## Workflow

### Prerequisites

- Node.js 22+
- An OpenAI API key (local dev)
- For staging deploys: AWS CLI authenticated to account `100641718971`, Docker, Terraform `>= 1.7`

### Local development

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY (and optionally Cognito values)
npm run dev            # client on :5200, server on :3000 (open http://localhost:5200)
npm run dev:client     # Vite SPA only
npm run dev:server     # NestJS server only
npm run build          # production build of both
npm run typecheck      # TypeScript check across both
npm run lint           # ESLint across client/src and server/src
npm run test:server    # Jest server tests
npm run docker:build   # build the production Docker image
npm run docker:run     # run the image locally on port 3000
```

### Deploy application changes to staging

Run from the repository root unless noted. Full detail also lives in [`infra/terraform/README.md`](infra/terraform/README.md) (“Deploy a new container image”).

Make sure Docker desktop is running before these steps.  The error `open //./pipe/docker_engine: The system cannot find the file specified` means the Docker CLI is installed, but the engine (daemon) isn’t up. On Windows that’s almost always because Docker Desktop is closed or still starting.

```powershell
# 1. Build production image (client + server in one container)
#    Use the same VITE_COGNITO_* values as local .env / Cognito console.
#    cognito_app_client_id is in infra/terraform/envs/staging/terraform.tfvars.
$tag = "staging-$(Get-Date -Format 'yyyy-MM-dd')"
docker build -t "emoji-app:$tag" `
  --build-arg VITE_COGNITO_DOMAIN="https://<prefix>.auth.ap-southeast-2.amazoncognito.com" `
  --build-arg VITE_COGNITO_CLIENT_ID="7d0kjtsi0h8kjhk2fg1ee64h55" `
  --build-arg VITE_COGNITO_SCOPES="openid email profile" `
  .

# 2. Log in to ECR (once per shell session)
aws ecr get-login-password --region ap-southeast-2 |
  docker login --username AWS --password-stdin `
  100641718971.dkr.ecr.ap-southeast-2.amazonaws.com

# 3. Tag and push
$registry = "100641718971.dkr.ecr.ap-southeast-2.amazonaws.com"
docker tag "emoji-app:$tag" "$registry/emoji-app:$tag"
docker push "$registry/emoji-app:$tag"

# 4. Point Terraform at the new image
#    Edit infra/terraform/envs/staging/terraform.tfvars:
#    image_uri = "<registry>/emoji-app:<tag>"
#    Commit and open a PR for CI apply, or apply locally (see below).

# 5. Roll out on ECS
cd infra/terraform/envs/staging
terraform plan
terraform apply
```

#### Verify the rollout

The deployment takes roughly 3–5 minutes from terraform apply to prompt return. The health check math is the dominant factor (5 × 30s = 150s after the grace period).

```powershell
curl.exe -sS https://emoji-staging.kogs.link/api/version
# expect {"version":"<your package.json version>"}

curl.exe -sS -w "`nHTTP %{http_code}`n" https://emoji-staging.kogs.link/api/badges
# expect HTTP 200
```

If infra was torn down, steps 1–4 are still required when you have **new code**; step 5 alone only recreates AWS resources and pulls the **existing** pinned image.

### Wake staging infrastructure (no code changes)

When staging was destroyed to save cost and you only need the **last deployed image** back online:

```powershell
cd infra/terraform/envs/staging
terraform apply
```

ECR images and Secrets Manager values survive destroy; ECS/ALB are recreated. DNS **https://emoji-staging.kogs.link/** updates automatically.

### Staging cost management (personal / side-project use)

AWS costs accumulate hourly even when idle (~$30-40/mo with ALB + Fargate running
continuously). For a personal project the recommended habit is to **tear down staging
between active sessions** and rebuild when needed.

All commands run from `infra/terraform/envs/staging`.

```powershell
cd infra/terraform/envs/staging

# Tear down all staging infra (stops billing for ECS, ALB, etc.)
terraform destroy

# Rebuild when you need it again
terraform apply
```

**What is preserved** across a destroy/apply cycle (these are not destroyed):

- ECR images (your pushed Docker images stay in ECR)
- Secrets Manager secrets (MongoDB URI, OpenAI key)
- S3 Terraform state bucket and DynamoDB lock table
- ACM certificate (auto-renewed by AWS, free)
- Route 53 hosted zone and records (`kogs.link` — $0.50/mo)
- Domain registration (`kogs.link` — annual fee, separate from Terraform)

**What is recreated** on `terraform apply`:

- ECS cluster, service, and task (new public IP; DNS alias updates automatically)
- ALB, listeners, target group
- Security groups and IAM roles

**Cheaper alternative to full teardown — scale tasks to zero:**

```powershell
# Stop paying for Fargate compute (ALB still charges ~$18/mo)
aws ecs update-service `
  --cluster emoji-staging-cluster `
  --service emoji-staging-service `
  --desired-count 0

# Scale back up when needed
aws ecs update-service `
  --cluster emoji-staging-cluster `
  --service emoji-staging-service `
  --desired-count 1
```

**Task sizing** is controlled by `task_cpu` and `task_memory` in
`infra/terraform/envs/staging/terraform.tfvars`. Current values use the minimum
Fargate size (`256` CPU / `512` MB ≈ $4/mo) rather than the previous default
(`1024` CPU / `3072` MB ≈ $45/mo).

### Terraform CI (infra changes)

Infra changes go through pull requests — the GitHub Actions workflow plans on the PR
and applies on merge to `main`. No manual `terraform apply` from a laptop is needed
for routine changes.

```powershell
# From infra/terraform/envs/staging — local plan preview only
terraform plan

# Emergency apply from laptop (break-glass; prefer CI)
terraform apply
```

## Repository layout

```text
emoji-app/
├── client/              React SPA (Vite)
├── server/              NestJS app (Express adapter)
├── infra/terraform/      AWS staging (ECS, ALB, ACM, IAM) — see infra/terraform/README.md
├── docs/                Deeper docs (deploy, auth, AWS, milestones)
├── dist/                production build output (gitignored)
│   ├── client/          Vite output — bundled into the Docker image as client-react
│   └── server/          Compiled server entry (e.g. main.js + modules)
├── Dockerfile           multi-stage prod image (Node 22 Alpine)
└── .github/workflows/   CI (Terraform plan/apply for staging infra)
```

### How the pieces fit together

```text
Browser
  └── React SPA (port 5200 in dev; same origin in production)
        ├── App UI  ──── reads/writes ──── Zustand store
        └── RichChatPanel
              │
              POST /api/chat  (streaming, application/octet-stream)
              │
              ▼
        NestJS HTTP server (port 3000 in dev)
              │
              └── Hashbrown / OpenAI streaming
                    │
                    └── OpenAI API
```

In production the server process also serves the built SPA (`client-react` next to
`main.js` in the container), so the browser and `/api/*` share one origin — no extra
CORS setup for typical browsing.

### Key dependencies

| Package | Role |
| ------- | ---- |
| `@hashbrownai/react` | `HashbrownProvider`, hooks for structured AI output |
| `@hashbrownai/openai` | Server-side OpenAI streaming adapter |
| `@hashbrownai/core` | Shared types, schema helpers, transport protocol |
| `openai` | OpenAI Node SDK (peer dep of `@hashbrownai/openai`) |
| `@nestjs/core` (+ Express platform) | HTTP API, middleware, controllers |
| `express` | Underlying HTTP engine and static SPA serving |
| `vite` | React SPA dev server and production bundler |
| `zustand` | Client-side state store |
| `tailwindcss` + Radix UI | Styling and accessible UI primitives |

## Production deployment (current)

Staging runs on **Amazon ECS on Fargate** behind an **Application Load Balancer**:

- Infrastructure is declared in **`infra/terraform/`** ([module layout and workflows](infra/terraform/README.md)).
- Containers are pushed to **ECR**; the task pulls the pinned image URI from **`terraform.tfvars`**.
- **HTTPS** uses **ACM + Route 53** (custom host, e.g. `emoji-staging.kogs.link`); milestones and procedure live in **`docs/milestones/terraform-milestones.md`**.
- **Logs** flow to **CloudWatch Logs** (`awslogs`). Metrics vs logs, Container Insights,
  and noisy device traffic like `POST /api/status` are explained in **`docs/aws/cloudwatch.md`**.
- GitHub Actions can **plan on PR** and **apply on merge** to `main` for Terraform
  (OIDC, no long‑lived keys): workflow at **`.github/workflows/terraform-staging.yml`**,
  one-time IAM setup **`infra/terraform/ci/T8-setup-github-oidc.md`**.

### Auth

- Hosted UI flows use **Amazon Cognito**; callback/sign-out URLs must match the public HTTPS host. See [**`docs/auth.md`**](docs/auth.md) and the staging URL checklist in [**`docs/domains.md`**](docs/domains.md).

### Legacy / history

- The project previously documented **AWS App Runner** flows. Compute is **ECS** now.
  Migration context: [**`docs/decisions/leaving-app-runner.md`**](docs/decisions/leaving-app-runner.md).
  **`docs/deployments.md`** still has useful **Docker + Cognito build-arg** guidance; pair it with [**`infra/terraform/README.md`**](infra/terraform/README.md) for the current push/apply loop.

## Environment variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `OPENAI_API_KEY` | Yes (local prod image) | — | OpenAI secret key |
| `PORT` | No | `3000` | Port the server listens on |
| `HOST` | No | `localhost` | Bind host (`0.0.0.0` typical in containers) |

On **ECS staging**, runtime secrets such as **`OPENAI_API_KEY`** and **`MONGODB_URI`**
usually come from **AWS Secrets Manager** and are wired via Terraform — not from a `.env`
inside the task. See **`infra/terraform/README.md`** and module **`ecs-service`**.

Further reading: glossary-style terms (**ALB**, **ACM**, **Fargate**, etc.) in **`docs/terms.md`**.
More breadth: **`docs/setup.md`**, **`docs/milestones.md`**.
