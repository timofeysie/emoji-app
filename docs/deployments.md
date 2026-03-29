# Deployment Guide

## Smart Home Sample — AWS App Runner

This guide deploys the **smart-home** sample as a single container on [AWS App Runner](https://aws.amazon.com/apprunner/). The Express server serves both the React SPA and the `/api/chat` endpoint from the same origin, so no CORS configuration is required in production.

### Architecture

```text
App Runner (HTTPS, auto-scaling)
  └── Express (port 3000)
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
  --repository-name smart-home \
  --region ap-southeast-2
```

Note the `repositoryUri` in the output — you will need it in the next step.
It looks like `<account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/smart-home`.

---

### Step 2: Build and push the Docker image

Authenticate Docker with ECR, then build and push from the **workspace root**:

```bash
# Authenticate (replace region/account as needed)
aws ecr get-login-password --region ap-southeast-2 \
  | docker login --username AWS --password-stdin \
    <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com

# Build the image (Dockerfile lives in samples/smart-home/)
docker build \
  -f samples/smart-home/Dockerfile \
  -t smart-home:latest \
  .

# Tag and push
docker tag smart-home:latest \
  <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/smart-home:latest

docker push \
  <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/smart-home:latest
```

> **Note:** The build context must be the workspace root (`.`) because the
> Dockerfile runs Nx commands that reference paths across the monorepo.

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
  --service-name smart-home \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "<account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/smart-home:latest",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "HOST": "0.0.0.0",
          "OPENAI_API_KEY": "<your-openai-api-key>"
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
**App Runner → Services → smart-home**. It looks like
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

### Updating the deployment

Push a new image to ECR — App Runner will detect the change and redeploy
automatically (because `AutoDeploymentsEnabled` is `true`):

```bash
docker build -f samples/smart-home/Dockerfile -t smart-home:latest . \
  && docker tag smart-home:latest \
       <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/smart-home:latest \
  && docker push \
       <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/smart-home:latest
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
and sends `Authorization: Bearer <access-token>`. Express verifies the JWT
against Cognito’s JWKS URL.

Full setup (user pool, app client, hosted domain, callback URLs) is documented
in [auth.md](./auth.md).

### App Runner / Docker environment

Set these on the **server** (runtime):

| Variable | Purpose |
|----------|---------|
| `COGNITO_USER_POOL_ID` | User pool ID (e.g. `ap-southeast-2_xxxxxxxxx`) |
| `COGNITO_APP_CLIENT_ID` | App client ID (must match the SPA client) |
| `COGNITO_REGION` or `AWS_REGION` | Region for issuer / JWKS URL |

Do **not** set `DISABLE_AUTH` in production (`NODE_ENV=production` ignores it
anyway).

The **client** needs Cognito values at **build time** (Vite embeds `VITE_*`):

| Variable | Purpose |
|----------|---------|
| `VITE_COGNITO_DOMAIN` | Hosted UI base URL, no trailing slash |
| `VITE_COGNITO_CLIENT_ID` | Same app client ID as on the server |

For Docker, pass `ARG` / `ENV` for those variables in the image build stage
before `npm run build:client`, or build with a `.env.production` file in the
build context.

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
