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
  --region us-east-1
```

Note the `repositoryUri` in the output — you will need it in the next step.
It looks like `<account-id>.dkr.ecr.us-east-1.amazonaws.com/smart-home`.

---

### Step 2: Build and push the Docker image

Authenticate Docker with ECR, then build and push from the **workspace root**:

```bash
# Authenticate (replace region/account as needed)
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build the image (Dockerfile lives in samples/smart-home/)
docker build \
  -f samples/smart-home/Dockerfile \
  -t smart-home:latest \
  .

# Tag and push
docker tag smart-home:latest \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/smart-home:latest

docker push \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/smart-home:latest
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
      "ImageIdentifier": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/smart-home:latest",
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
  --region us-east-1
```

After a few minutes the service URL will appear in the AWS Console under
**App Runner → Services → smart-home**. It looks like
`https://<random>.us-east-1.awsapprunner.com`.

---

### Step 5: Verify the deployment

```bash
# Replace with your actual service URL
curl https://<random>.us-east-1.awsapprunner.com/api/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[]}'
```

Open the service URL in a browser to confirm the React SPA loads.

---

### Updating the deployment

Push a new image to ECR — App Runner will detect the change and redeploy
automatically (because `AutoDeploymentsEnabled` is `true`):

```bash
docker build -f samples/smart-home/Dockerfile -t smart-home:latest . \
  && docker tag smart-home:latest \
       <account-id>.dkr.ecr.us-east-1.amazonaws.com/smart-home:latest \
  && docker push \
       <account-id>.dkr.ecr.us-east-1.amazonaws.com/smart-home:latest
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

The smart-home sample does not include authentication out of the box. Before
making this service publicly accessible you will want to protect at least the
`/api/chat` endpoint, since every request proxies a paid OpenAI call.

There are three practical options, ranked by implementation effort:

### Option A — JWT middleware in Express (recommended starting point)

Add a middleware that verifies a signed JWT on every `/api/chat` request. Your
frontend obtains a token from your auth provider (Cognito, Auth0, Clerk, etc.)
and attaches it as a `Bearer` token.

Key decisions to discuss:

- Which auth provider to use (Cognito is AWS-native and has a free tier up to
  50,000 MAU)
- Whether the entire app requires auth or only the API route
- Whether you need social login (Google, GitHub, etc.)

### Option B — AWS Cognito + App Runner environment

Cognito handles sign-up, sign-in, and token issuance. The Express server only
needs to verify the `Authorization: Bearer <id-token>` header using the
Cognito JWKS endpoint. No third-party auth library is required — just
`jsonwebtoken` and a JWKS fetch.

Additional Cognito decisions:

- Hosted UI vs. custom login page in the React app
- User pools vs. identity pools (pools are sufficient for API protection)
- Whether to use Cognito's built-in social identity providers

### Option C — WAF IP allowlist (simplest, not user-auth)

Attach an AWS WAF web ACL to the App Runner service and restrict access to
specific IP ranges. Useful for internal tools or during development. Does not
provide per-user identity.

---

> Once you have decided on an auth approach, update this document with the
> implementation steps.
