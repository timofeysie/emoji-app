# Deployment Guide

## AWS App Runner (this repo)

This guide deploys the app as a single container on [AWS App Runner](https://aws.amazon.com/apprunner/). The NestJS server (running on the Express adapter) serves both the React SPA and the `/api/chat` endpoint from the same origin, so no CORS configuration is required in production.

Side note: in Milestone 1, the server runtime was migrated from Express to NestJS while preserving existing API behavior.

### Before you deploy

1. **Cognito** — You already use a user pool locally. In the Cognito console, add your **production** URLs to the same app client:
   - **Callback:** `https://<your-app-runner-host>/auth/callback`
   - **Sign-out:** `https://<your-app-runner-host>/`  
   You will not know the exact App Runner URL until after the first service is created (unless you use a custom domain). After the first deploy, copy the service URL (see [domains.md](./domains.md) for where it appears and for custom domains), add those URLs in Cognito, then **rebuild the client** if you change `VITE_*` (usually not needed if only Cognito allowlists changed).
2. **Secrets** — Have `OPENAI_API_KEY` ready; prefer [Secrets Manager](#storing-secrets-safely) in production.
3. **Image** — Build from the **repository root**; the [Dockerfile](../Dockerfile) runs `npm run build:client` and `npm run build:server`. **Vite bakes `VITE_*` into the SPA at build time**, so pass Cognito client settings as `--build-arg` when building the image (see [Step 2](#step-2-build-and-push-the-docker-image)).

### Architecture

```text
App Runner (HTTPS, auto-scaling)
  └── NestJS (Express adapter, port 3000)
        ├── GET  /*           → React SPA (static files)
        └── POST /api/chat    → Hashbrown streaming endpoint
```

### Estimated cost

| Traffic level | Approx. monthly cost |
|---------------|---------------------|
| Low (mostly idle) | $3–5 |
| Moderate | $10–20 |

Includes TLS, load balancing, and auto-scaling. No separate ALB charge.

---

### Prerequisites

- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) configured (`aws configure`)
- [Docker](https://docs.docker.com/get-docker/) installed and running
- An OpenAI API key
- Node.js 22+ and npm

---

### Step 1: Create an ECR repository

```bash
aws ecr create-repository \
  --repository-name emoji-app \
  --region ap-southeast-2
```

Note the `repositoryUri` in the output — you will need it in the next step.
It looks like `<account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app`.

---

### Step 2: Build and push the Docker image

Authenticate Docker with ECR, then build and push from the **repository root**
(where `Dockerfile` and `package.json` live).

Pass **build arguments** for the React app so `VITE_COGNITO_*` is embedded in
the static bundle (same values as in your local `.env`, using your real Cognito
domain and client ID). Do **not** set `VITE_DISABLE_AUTH=true` for production
images.

```bash
# Authenticate (replace region/account as needed)
aws ecr get-login-password --region ap-southeast-2 \
  | docker login --username AWS --password-stdin \
    <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com

# Build (example — replace Cognito values)
docker build \
  -t emoji-app:latest \
  --build-arg VITE_COGNITO_DOMAIN="https://<prefix>.auth.ap-southeast-2.amazoncognito.com" \
  --build-arg VITE_COGNITO_CLIENT_ID="<your-cognito-app-client-id>" \
  --build-arg VITE_COGNITO_SCOPES="openid email profile" \
  .

# Tag and push (repository name from Step 1, e.g. smart-home or emoji-app)
docker tag emoji-app:latest \
  <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/<repository-name>:latest

docker push \
  <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/<repository-name>:latest
```

#### Windows (PowerShell)

PowerShell treats **`<`** as a special character. **Do not** paste placeholders like
`<account-id>` literally — substitute your real **12-digit AWS account ID** (from the
ECR repository URI) with **no** angle brackets.

The ECR console may show **AWS Tools for PowerShell** login. Either use that or the
**AWS CLI** one-liner (works in PowerShell if `aws` is on your `PATH`).

**Login — AWS CLI (recommended if you already use `aws configure`):**

```powershell
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com
```

Replace `123456789012` with your account ID (same digits as in
`123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app` in the console).

**Login — AWS Tools for PowerShell** (as in the ECR “Push commands” panel; install
[AWS Tools for PowerShell](https://docs.aws.amazon.com/powershell/latest/userguide/pstools-getting-set-up.html) if needed):

```powershell
(Get-ECRLoginCommand -Region ap-southeast-2).Password | docker login --username AWS --password-stdin 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com
```

If your console snippet uses `(Get-ECRLoginCommand).Password` without `-Region`, set the
default region first or add `-Region ap-southeast-2`. Use your real registry host in
place of `123456789012`.

**Build, tag, push** — run from the **git repo root** (where the `Dockerfile` is). Use
the **same** `docker build` as above, including **`--build-arg`** for Cognito; the
plain `docker build -t emoji-app .` from the ECR wizard is **not** enough for this app.

```powershell
docker build `
  -t emoji-app:latest `
  --build-arg VITE_COGNITO_DOMAIN="https://YOUR_COGNITO_PREFIX.auth.ap-southeast-2.amazoncognito.com" `
  --build-arg VITE_COGNITO_CLIENT_ID="YOUR_COGNITO_APP_CLIENT_ID" `
  --build-arg VITE_COGNITO_SCOPES="openid email profile" `
  .

docker tag emoji-app:latest 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:latest

docker push 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:latest
```

Replace `123456789012` with your AWS account ID, and replace the `YOUR_*` placeholders
with your real Cognito domain prefix, client ID, and (if needed) scopes.

> **Note:** If you omit `VITE_*` build-args, the SPA may be built without Cognito
> settings and the UI will show “Set VITE_COGNITO_*…” or sign-in will not work.

See also: `npm run docker:build` (add `--build-arg` after `-t emoji-app .` as needed).

---

### Step 3: Create an App Runner access role

App Runner needs an IAM role to pull images from ECR.

```bash
# Create the trust policy
cat > apprunner-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "build.apprunner.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name AppRunnerECRAccessRole \
  --assume-role-policy-document file://apprunner-trust.json

aws iam attach-role-policy \
  --role-name AppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

---

### Step 4: Create the App Runner service

```bash
aws apprunner create-service \
  --service-name emoji-app \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "<account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/<repository-name>:latest",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "HOST": "0.0.0.0",
          "OPENAI_API_KEY": "<your-openai-api-key>",
          "COGNITO_USER_POOL_ID": "<ap-southeast-2_xxxxxxxxx>",
          "COGNITO_APP_CLIENT_ID": "<same-app-client-id-as-in-VITE_>",
          "COGNITO_REGION": "ap-southeast-2"
        }
      },
      "ImageRepositoryType": "ECR"
    },
    "AutoDeploymentsEnabled": true,
    "AuthenticationConfiguration": {
      "AccessRoleArn": "arn:aws:iam::<account-id>:role/AppRunnerECRAccessRole"
    }
  }' \
  --instance-configuration '{
    "Cpu": "0.25 vCPU",
    "Memory": "0.5 GB"
  }' \
  --region ap-southeast-2
```

After a few minutes the service URL will appear in the AWS Console under
**App Runner → Services → emoji-app** (or the name you chose). It looks like
`https://<random>.ap-southeast-2.awsapprunner.com`.

---

### Step 5: Verify the deployment

```bash
# Replace with your actual service URL. Without a Cognito access token you
# should receive HTTP 401 (auth is enabled in production).
curl -i https://<random>.ap-southeast-2.awsapprunner.com/api/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[]}'
```

Open the service URL in a browser to confirm the React SPA loads. Use **Sign in**
after configuring Cognito (see [Authentication](#authentication)) before using the
chat panel.

---

### Workflow: deploy or redeploy after you change the app

After every `docker build` you must `docker tag` and `docker push` (unless your
CI does that for you). The new layers only reach AWS when the image is in ECR;
App Runner runs what ECR holds.

Put **real** Cognito values in `--build-arg` (the same hosted UI domain and app
client ID as in the Cognito console). **Do not** paste doc placeholders such as
`YOUR_CLIENT_ID` or `your_prefix` — they become literal text in the production
JavaScript bundle.

**Why login URL sometimes showed `YOUR_CLIENT_ID`:** The [Dockerfile](../Dockerfile)
uses `COPY . .`, which used to include your local `.env`. Vite then embedded
those `VITE_*` values at build time. The repo now has a [.dockerignore](../.dockerignore)
that excludes `.env`, so production client builds rely on **`--build-arg`** only.
After pulling this change, run **`docker build --no-cache`** once with your real
`--build-arg` values, then tag, push, and wait for App Runner to deploy.

#### 1. One-time / as needed: log in to ECR

The login token expires (roughly 12 hours). Run when `docker push` fails with
auth errors:

```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com
```

(PowerShell notes and `123456789012`-style examples are in [Step 2](#step-2-build-and-push-the-docker-image).)

#### 2. Build from the repository root

```bash
docker build \
  -t emoji-app:latest \
  --build-arg VITE_COGNITO_DOMAIN="https://<your-prefix>.auth.ap-southeast-2.amazoncognito.com" \
  --build-arg VITE_COGNITO_CLIENT_ID="<your-cognito-app-client-id>" \
  --build-arg VITE_COGNITO_SCOPES="openid email profile" \
  .
```

- **Client (`VITE_*`)** — Baked in at this step. Change these args whenever Cognito
  domain, client ID, or scopes change.
- **Server-only env** (`OPENAI_API_KEY`, `COGNITO_USER_POOL_ID`, etc.) — Set in
  **App Runner** (or `docker run --env-file`), not in this build, unless you
  change how the server is built.

#### 3. Tag the local image for your ECR repository

```bash
docker tag emoji-app:latest <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:latest
```

Use your account ID and repository name (e.g. `emoji-app`).

#### 4. Push to ECR

```bash
docker push <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:latest
```

#### 5. Let App Runner run the new image

If **Auto deploy** is enabled for the ECR image, App Runner starts a deployment
after the push (may take a few minutes). Otherwise open **App Runner** → your
service → **Deploy** (or **Actions** → deploy latest).

#### If the live site still looks unchanged after `docker push`

1. **Confirm a deployment actually ran** — **App Runner** → your service →
   **Deployments**. Open the latest row; status should be **Succeeded** and the
   **start time** should be **after** your push. If there is no new deployment,
   **auto deployments** may be off: **Configuration** → **Source** → ensure the
   ECR image is set to deploy on push, or use **Deploy** → **Deploy latest
   version** manually.
2. **Wait for the deployment to finish** — a new revision only replaces the
   running tasks when the deployment completes (often a few minutes).
3. **Hard refresh** the browser (`Ctrl+Shift+R`) or use a **private window** so
   an old Service Worker or cache is not serving stale JS.
4. **Verify the image tag** — App Runner must point at the same tag you pushed
   (e.g. `:latest`). Pushing a new digest to `latest` still requires a deployment
   (automatic or manual) to pull it.
5. **Optional sanity check** — this app shows **`v` + package version** next to
   **Emoji App** in the header (from `package.json`). Bump `version` in
   [`package.json`](../package.json) when you want a visible release marker after
   deploy.

#### 6. When you only change server configuration

If you did **not** change the React app or `VITE_*`, you can still use the same
build (NestJS with the Express adapter is bundled in the same image). To change secrets or Cognito
**server** env vars only, update **App Runner → Configuration → Environment
variables** and redeploy — no new image required unless you also changed code.

#### Quick copy-paste chain (bash)

From the repo root, after replacing placeholders:

```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com

docker build -t emoji-app:latest \
  --build-arg VITE_COGNITO_DOMAIN="https://<your-prefix>.auth.ap-southeast-2.amazoncognito.com" \
  --build-arg VITE_COGNITO_CLIENT_ID="<your-cognito-app-client-id>" \
  --build-arg VITE_COGNITO_SCOPES="openid email profile" \
  . \
  && docker tag emoji-app:latest <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:latest \
  && docker push <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:latest
```

---

### Storing secrets safely

Avoid passing `OPENAI_API_KEY` as a plain environment variable in production.
Use AWS Secrets Manager instead:

```bash
# Store the secret
aws secretsmanager create-secret \
  --name smart-home/openai-api-key \
  --secret-string '{"OPENAI_API_KEY":"sk-..."}'
```

Then reference it in the App Runner service configuration rather than
hard-coding the value. See the
[App Runner secrets documentation](https://docs.aws.amazon.com/apprunner/latest/dg/using-secrets-manager.html)
for the full setup.

---

## Authentication

`POST /api/chat` is protected with **AWS Cognito** unless auth is explicitly
disabled for local development. The React app uses the Cognito Hosted UI (PKCE)
and sends `Authorization: Bearer <access-token>`. NestJS (Express adapter) verifies the JWT
against Cognito’s JWKS URL.

Full setup (user pool, app client, hosted domain, callback URLs) is documented
in [auth.md](./auth.md).

### App Runner / Docker environment

Set these on the **server** (runtime):

| Variable | Purpose |
| -------- | ------- |
| `COGNITO_USER_POOL_ID` | User pool ID (e.g. `ap-southeast-2_xxxxxxxxx`) |
| `COGNITO_APP_CLIENT_ID` | App client ID (must match the SPA client) |
| `COGNITO_REGION` or `AWS_REGION` | Region for issuer / JWKS URL |

Do **not** set `DISABLE_AUTH` in production (`NODE_ENV=production` ignores it
anyway).

The **client** needs Cognito values at **build time** (Vite embeds `VITE_*`):

| Variable | Purpose |
| -------- | ------- |
| `VITE_COGNITO_DOMAIN` | Hosted UI base URL, no trailing slash |
| `VITE_COGNITO_CLIENT_ID` | Same app client ID as on the server |

The root [Dockerfile](../Dockerfile) already declares `ARG` / `ENV` for
`VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`, and optional `VITE_COGNITO_SCOPES`
before `npm run build:client`. Alternatively, add a `.env.production` at the
repo root **in the build context** (not committed with secrets) so Vite picks
it up via `envDir: '..'` in `client/vite.config.ts`.

Register callback and logout URLs in the Cognito app client, for example:

- `https://<your-apprunner-host>/auth/callback`
- `https://<your-apprunner-host>/` (sign-out redirect)

### Local development without Cognito

Set `DISABLE_AUTH=true` in `.env` for the Node server and `VITE_DISABLE_AUTH=true`
so the SPA does not require sign-in. Remove or set to `false` when testing
Cognito end-to-end.

### Other options

For a quick internal-only guard without user identity, an API key header is
described in [auth.md](./auth.md). A WAF IP allowlist is another alternative for
internal tools.

---

### Typical first-time flow (checklist)

1. Create ECR repository → build image **with** `--build-arg` Cognito `VITE_*` values → push.
2. Create IAM role for App Runner → create App Runner service **with** runtime env vars including `COGNITO_*` and `OPENAI_API_KEY`.
3. Open the App Runner default domain in a browser; confirm SPA loads and chat returns **401** without signing in.
4. Copy the **HTTPS** service URL → add `/auth/callback` and `/` to Cognito app client **callback and sign-out URLs** → save.
5. Sign in via the deployed app and test chat streaming.

If sign-in redirects fail, compare Cognito URLs (scheme, host, path) with the
exact App Runner URL (no typo, `https` only).

---

## Appendix: Create an ECR repository (AWS Management Console)

Use this if you prefer the website to the CLI in [Step 1](#step-1-create-an-ecr-repository). The
result is the same: a private registry you push Docker images to.

1. Sign in to the [AWS Management Console](https://console.aws.amazon.com/).
2. In the **top bar**, choose the region where you want the registry (for this
   project, **Asia Pacific (Sydney)** `ap-southeast-2` to match the rest of this
   guide).
3. Open **Elastic Container Registry** (search the top search bar for **ECR**).
4. In the left sidebar, choose **Repositories** (under **Private registry**).
5. Choose **Create repository**.
6. **General settings**
   - **Visibility settings**: **Private** (recommended for application images).
   - **Repository name**: e.g. `emoji-app` (must match the name you use in
     `docker tag` and push commands, or use any name and stay consistent).
7. **Optional**: Image tag immutability, scan on push, encryption — defaults are
   fine to start.
8. Choose **Create repository**.

After creation, open the new repository. Copy the **URI** shown (for example
`<account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app`). You’ll use it for
`docker login`, image tags, and the App Runner **Image identifier** in
[Step 4](#step-4-create-the-app-runner-service).

To push an image from your machine, you still need Docker and AWS credentials
with permission to push to ECR; follow [Step 2](#step-2-build-and-push-the-docker-image) using
that URI.
