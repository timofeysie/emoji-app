# Emoji App

A generative-UI demo built with [Hashbrown](https://hashbrown.dev), React, and
NestJS (Express-backed). An AI chat panel sits alongside a standard CRUD
interface and can read and update app state directly through structured tool
calls.

The repository also contains **LandGrab**, a multiplayer game side project.
Its Phaser web game is bundled inside an Expo `WebView`, allowing bots-only
practice without a server. The planned online mode will use the existing Node
server and WebSocket infrastructure for server-authoritative matches between
human players and bots. Shared simulation logic lives in
`packages/land-grab-core`.

See
[`land-grab-handoff/docs/overall-plan.md`](land-grab-handoff/docs/overall-plan.md)
for the product plan and
[`integration-with-emoji-app.md`](land-grab-handoff/docs/integration-with-emoji-app.md)
for the workspace and mobile-bundling design.

## Workflow

### Prerequisites

- Node.js 22+
- An OpenAI API key (local dev)
- For staging deploys: AWS CLI authenticated to account `100641718971`, Docker, Terraform `>= 1.7`

### Local development

Install all root and workspace dependencies from the repository root:

```bash
npm install
```

Do not install Expo at the repository root. Expo and React Native belong to
the `@emoji-app/land-grab-mobile` workspace and are installed by the root
command above.

#### Local MongoDB

The game API needs MongoDB. Locally it runs from Homebrew as a single-node
replica set; transactions require one. One-time setup is in
[`docs/db/mongo.md`](docs/db/mongo.md). Day to day:

```bash
brew services start mongodb/brew/mongodb-community@7.0
brew services list
mongosh --quiet --eval "rs.status().ok"
```

- `brew services list` should show `mongodb-community@7.0` as `started`.
- The `mongosh` check prints `1` when the replica set is healthy.
- It starts automatically after a reboot, so usually only the check is
  needed.

To stop it:

```bash
brew services stop mongodb/brew/mongodb-community@7.0
```

If the check fails:

- `MongoNetworkError` / `ECONNREFUSED` means it isn't running: start it,
  or look at `/opt/homebrew/var/log/mongodb/mongo.log`.
- `NotYetInitialized` means the one-time `rs.initiate(...)` from
  `docs/db/mongo.md` step 3 hasn't been run.

`.env` needs `MONGODB_URI=mongodb://127.0.0.1:27017/emoji-app?directConnection=true`.
When the server connects, `npm run dev` logs `MongoDB connected and indexes
synchronized.` To look at the data:

```bash
mongosh emoji-app --quiet --eval "db.getCollectionNames()"
```

#### Main emoji application

```bash
cp .env.example .env
npm run dev # both apps started and frontend available at http://localhost:5200
npm run dev:client
npm run dev:server
npm run build
npm run typecheck
npm run lint
npm run test:server
npm run docker:build
npm run docker:run
```

`npm run dev` starts the browser client on port 5200 and the API server on
port 3000. Add `OPENAI_API_KEY` and any optional Cognito values to `.env`.

Test the API at `http://localhost:3000/api/version`.

#### e2e Playwright tests

The e2e tests drive the game against a real server and the local MongoDB.
Mongo must be running as a single-node replica set
([`docs/db/mongo.md`](docs/db/mongo.md)). Install the browser once:

```bash
npx playwright install chromium
```

Then, from the repository root:

```bash
npm run test:e2e                       # all tests, headless
npm run test:e2e -- players            # only spec files whose name matches
npm run test:e2e -- -g "swap"          # only tests whose title matches
npm run test:e2e -- --headed           # watch the browser
npm run test:e2e:ui                    # Playwright UI mode, for debugging
npm run test:e2e:report                # open the HTML report of the last run
npm run typecheck:e2e
```

A run starts its own API server on port 3100 and Vite on port 5210, using
the `emoji-app-e2e` database, which is dropped at the start of each run.
Your dev servers (3000/5200) and the `emoji-app` database are not touched,
so `npm run dev` can stay running. The plan and coverage are in
[`docs/testing/playwright-plan.md`](docs/testing/playwright-plan.md).

#### LandGrab

Run the browser version directly while changing game UI or simulation code.  The Expo app also uses generated, embedded HTML rather than the Vite development server. Rebuild that HTML after changing the web game, then start Expo:

```bash
npm run dev:land-grab-web
npm run sync:land-grab-mobile
npm run dev:land-grab-mobile
```

Scan the QR code with an up-to-date Expo Go app that supports Expo SDK 57.
To restart Metro with a clean cache from the repository root, use:

```bash
npm exec --workspace @emoji-app/land-grab-mobile -- expo start --clear
```

Useful validation commands are:

```bash
npm run test:land-grab
npm run test:land-grab-web
npm run typecheck:land-grab
npm run build:land-grab-web
npm run export:land-grab-mobile
```

Local practice is bots-only and does not require the emoji API server. The
game-server URL bridge exists for the future WebSocket mode, but multiplayer
transport is not implemented yet.

### Deploy application changes to staging

> **Windows (PowerShell) instructions.** Commands below use PowerShell syntax
> with a backtick for line continuation and `$var = "..."` for variables.
> Git Bash uses `\` for continuation and `varname="..."`.
>
> **There is no automatic build pipeline for application code.** Merging to
> `main` only triggers `terraform apply` for changes under
> `infra/terraform/`. Building the Docker image and pushing it to ECR are
> always manual steps. ECS keeps running whatever image is pinned in
> `terraform.tfvars` until that file is updated **and** Terraform is applied.

Run all commands from the **repository root**. Make sure Docker Desktop is running first — the
error `open //./pipe/docker_engine: The system cannot find the file specified` means the daemon
is not up.

```powershell
# 1. Set the tag for today. If you already pushed one today, change the suffix (a, b, c...).
$suffix = "h"   # <-- change this if you deploy more than once on the same day
$tag = "staging-$(Get-Date -Format 'yyyy-MM-dd')$suffix"
$registry = "100641718971.dkr.ecr.ap-southeast-2.amazonaws.com"

# 2. Log in to ECR (once per shell session).
# Use the two-step form to avoid a pipe hang in PowerShell.
$token = aws ecr get-login-password --region ap-southeast-2
$token | docker login --username AWS --password-stdin $registry

aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin 100641718971.dkr.ecr.ap-southeast-2.amazonaws.com

# 3. Build the production image (client + server in one container).
#    VITE_COGNITO_DOMAIN is the value of VITE_COGNITO_DOMAIN in your .env file.
docker build -t "emoji-app:$tag" `
  --build-arg VITE_COGNITO_DOMAIN="https://ap-southeast-2myj579wg2.auth.ap-southeast-2.amazoncognito.com" `
  --build-arg VITE_COGNITO_CLIENT_ID="7d0kjtsi0h8kjhk2fg1ee64h55" `
  --build-arg VITE_COGNITO_SCOPES="openid email profile" `
  .

# 4. Push to ECR.
docker tag "emoji-app:$tag" "$registry/emoji-app:$tag"
docker push "$registry/emoji-app:$tag"

# 5. *** REQUIRED — EASY TO MISS ***
#    Update image_uri in terraform.tfvars to the new tag, then verify.
$newUri = "image_uri = `"$registry/emoji-app:$tag`""
(Get-Content infra/terraform/envs/staging/terraform.tfvars) `
  -replace 'image_uri = ".*"', $newUri |
  Set-Content infra/terraform/envs/staging/terraform.tfvars
Select-String image_uri infra/terraform/envs/staging/terraform.tfvars

# 6. Commit everything (your code changes + updated terraform.tfvars).
git add -A
git commit -m "release $tag"
```

Then push and open a PR against `main`. CI runs `terraform apply` automatically on merge
because `terraform.tfvars` changed. `terraform apply` blocks until ECS is healthy (~3-5 min).

#### Verify the rollout

```powershell
curl.exe -sS https://emoji-staging.kogs.link/api/version
# {"version":"<your package.json version>"}

curl.exe -sS -w "`nHTTP %{http_code}`n" https://emoji-staging.kogs.link/api/badges
# HTTP 200
```

If infra was previously torn down, steps 3-5 are still required for new code; step 6 alone
only recreates AWS resources using the already-pinned image.

### Wake staging infrastructure (no code changes)

When staging was destroyed to save cost and you only need the **last deployed image** back online:

```powershell
cd infra/terraform/envs/staging
terraform apply
```

ECR images and Secrets Manager values survive destroy; ECS/ALB are recreated.
DNS [emoji-staging.kogs.link](https://emoji-staging.kogs.link/) updates
automatically.

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
├── apps/
│   ├── land-grab-web/       React, Vite, and Phaser game
│   └── land-grab-mobile/    Expo and WebView native shell
├── packages/
│   └── land-grab-core/      Shared simulation, bots, records, and tests
├── client/                  Existing React SPA
├── server/                  NestJS app with Express adapter
├── infra/terraform/         AWS staging infrastructure
├── docs/                    Main application documentation
├── land-grab-handoff/docs/  LandGrab planning and migration notes
├── dist/                    Production output (gitignored)
├── Dockerfile               Production image
└── .github/workflows/       CI workflows
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

## Running locally

To develop without AWS (even after using `terraform destroy` there are still costs) while
still receiving live status updates from a Raspberry Pi Zero badge controller on the same
LAN.

1. .env changes to bind the server to 0.0.0.0 and disable Cognito auth
2. Starting npm run dev
3. Finding the laptop's LAN IP via ipconfig
4. Adding the Windows Firewall rule for port 3000
5. Updating SERVER_URL in emoji-os-zero.py on the Pi Zero
6. MongoDB options (keep using Atlas or run it locally in Docker)
7. A data-flow diagram showing the end-to-end path

### 1. Configure the server to accept LAN connections

By default `HOST=localhost` means the server only accepts connections from your own
machine. Set it to `0.0.0.0` so the Pi Zero can reach it. Auth is also disabled because
Cognito is an AWS resource that is unavailable when the stack is torn down.

Add to your `.env` (copy `.env.example` if you haven't already):

```env
HOST=0.0.0.0
DISABLE_AUTH=true
VITE_DISABLE_AUTH=true
```

### 2. Start the dev servers

```bash
npm run dev   # client :5200, server :3000
```

### 3. Find your laptop's LAN IP

```powershell
ipconfig
```

Look for the **IPv4 Address** under your active network adapter (e.g. `192.168.1.xxx`).

### 4. Allow inbound connections through Windows Firewall

Run once in an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Emoji App Dev Server" `
  -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### 5. Point the Pi Zero at your laptop

On the Pi Zero, edit `emoji-os-zero.py` and update `SERVER_URL`:

```python
SERVER_URL = "http://192.168.1.xxx:3000"   # replace with your laptop's LAN IP
```

Setting `SERVER_URL = ""` disables all server reporting (badge still works offline).

### 6. MongoDB

MongoDB Atlas is external to AWS and keeps running after `terraform destroy`. Confirm
your `.env` has your Atlas URI:

```env
MONGODB_URI=mongodb+srv://...
```

Alternatively, run MongoDB locally. It must be a **single-node replica
set**, because guesses run in transactions and a plain `mongod` rejects
them. See [Local MongoDB](#local-mongodb) above and
[`docs/db/mongo.md`](docs/db/mongo.md), which covers Homebrew and Docker.
Then set:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/emoji-app?directConnection=true
```

### How it fits together

```text
Pi Zero (emoji-os-zero.py)
  │  BLE ↔ Pico badge
  │  POST http://<laptop-ip>:3000/api/status  (on BLE state change + 40 s liveness)
  │  POST http://<laptop-ip>:3000/api/emoji   (on emoji selection)
  ▼
Express server (localhost:3000)
  │  BadgeStateService → in-memory state → WebSocket broadcast
  ▼
Dashboard browser (localhost:5200)
  │  WebSocket ws://localhost:3000/ws
```
