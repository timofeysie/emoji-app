# Milestone 4: ECS on Fargate and ALB

## Goal

Migrate hosting from App Runner to ECS on Fargate behind an Application Load
Balancer (ALB), while keeping the current API and WebSocket behavior working in
staging.

## Scope

- In scope:
  - ECS cluster, task definition, service
  - ALB and target group setup
  - Runtime environment and secrets wiring
  - Staging deployment validation
  - Rollback procedure
- Out of scope:
  - API Gateway migration
  - Multi-region architecture
  - Major application refactors

## Prerequisites

- AWS account access with permissions for ECS, EC2, ELBv2, IAM, ECR, and
  Secrets Manager
- Existing ECR image for the app
- Existing staging MongoDB secret in Secrets Manager:
  `emoji-app/staging/mongodb-uri`
- Existing runtime secrets/values:
  - `OPENAI_API_KEY`
  - `COGNITO_USER_POOL_ID`
  - `COGNITO_APP_CLIENT_ID`
  - `COGNITO_REGION`

## Recommended staging naming

- Region: `ap-southeast-2` (or your chosen region)
- VPC: `emoji-staging-vpc`
- ECS cluster: `emoji-staging-cluster`
- Task definition family: `emoji-staging-task`
- ECS service: `emoji-staging-service`
- ALB: `emoji-staging-alb`
- Target group: `emoji-staging-tg`
- Container name: `emoji-app`

## Step-by-step AWS console runbook

### 1) ECR image readiness

Menu path:

- AWS Console -> `Amazon ECR` -> `Repositories` -> your app repository

Screen checks:

- Confirm a recent image tag exists (for example, `staging-<date>` or `latest`)
- Note the full image URI:
  `<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>`

### 2) Network baseline (VPC and subnets)

Menu path:

- AWS Console -> `VPC` -> `Your VPCs`, `Subnets`, `Internet Gateways`,
  `Route Tables`

Required setup (prototype-safe, explicit):

1. Pick a VPC strategy:
   - fastest: use default VPC, or
   - recommended: create dedicated staging VPC (`emoji-staging-vpc`).
2. Ensure at least 2 subnets in different AZs for ALB.
3. Ensure ECS tasks have outbound internet access for ECR pulls and AWS API calls.

Default VPC path (fast prototype):

1. `VPC` -> `Your VPCs`
   - Find the VPC where `Default VPC = Yes` in your target region.
2. `VPC` -> `Subnets`
   - Filter by the default VPC ID.
   - Select at least 2 subnets in different AZs.
3. `VPC` -> `Route Tables`
   - Find the route table associated with those subnets.
   - Confirm route `0.0.0.0/0` points to an Internet Gateway (`igw-*`).
4. `VPC` -> `Internet Gateways`
   - Confirm an IGW is attached to the default VPC.
5. ECS service networking choice (prototype):
   - Use those default VPC subnets.
   - Set `Assign public IP = ENABLED` on the ECS service/task network config.
   - This avoids NAT setup for early staging.
6. ALB networking:
   - Create ALB in the same default VPC.
   - Select the same two (or more) AZ subnets for ALB.

Default VPC checklist:

- At least 2 AZ subnets selected
- Subnet route tables include `0.0.0.0/0` -> `igw-*`
- ECS tasks configured with public IP enabled for prototype
- ALB and ECS service are in the same VPC

If creating a dedicated staging VPC, use this baseline:

- VPC CIDR: `10.40.0.0/16`
- Public subnet A: `10.40.0.0/20` (AZ-a)
- Public subnet B: `10.40.16.0/20` (AZ-b)
- Private subnet A: `10.40.32.0/20` (AZ-a)
- Private subnet B: `10.40.48.0/20` (AZ-b)

Console steps for dedicated VPC:

1. `VPC` -> `Your VPCs` -> `Create VPC`
   - Name: `emoji-staging-vpc`
   - CIDR: `10.40.0.0/16`
2. `VPC` -> `Subnets` -> `Create subnet`
   - Create the 4 subnets above across 2 AZs
3. `VPC` -> `Internet Gateways` -> `Create internet gateway`
   - Attach to `emoji-staging-vpc`
4. `VPC` -> `Route Tables`
   - Create `emoji-public-rt`
   - Add route `0.0.0.0/0` -> Internet Gateway
   - Associate with both public subnets
5. For private subnets, choose one:
   - **Option A (preferred):** create NAT Gateway in a public subnet,
     then add `0.0.0.0/0` from private route table to NAT Gateway.
   - **Option B (prototype shortcut):** run ECS tasks in public subnets with
     `Assign public IP = ENABLED` and skip NAT.

How to interpret what you currently see:

- If `Block public access = Off` but no route to Internet Gateway exists, the
  subnet is still not effectively public.
- Subnet public/private behavior is determined by route table association, not
  only by the block-public-access flag.

Screen checks before moving on:

- ALB subnets: at least two AZs, route table has `0.0.0.0/0` -> IGW.
- ECS subnets: either private + NAT, or public + assign public IP enabled.
- Security groups and NACLs allow expected traffic paths.

### 3) Security groups

Menu path:

- AWS Console -> `EC2` -> `Security Groups`

Create:

1. ALB security group (`emoji-staging-alb-sg`)
   - Inbound:
     - `80` from `0.0.0.0/0` (optional redirect)
     - `443` from `0.0.0.0/0`
   - Outbound:
     - all (default)

2. ECS service security group (`emoji-staging-ecs-sg`)
   - Inbound:
     - `3000` from `emoji-staging-alb-sg` only
   - Outbound:
     - all (default)

### 4) Create ALB and target group

Menu path:

- AWS Console -> `EC2` -> `Load Balancers` -> `Create load balancer` ->
  `Application Load Balancer`

ALB screen choices:

- Scheme: `internet-facing`
- IP type: `ipv4`
- VPC: staging VPC
- Subnets: at least two AZs
- Security group: `emoji-staging-alb-sg`
- Listener: `HTTP:80` first (add HTTPS later when certificate ready)

Create target group:

- Type: `IP` (required for Fargate)
- Protocol: `HTTP`
- Port: `3000`
- Health check path: `/api/badges`
  - This endpoint is lightweight and currently available in the app
- Health check matcher: `200`

Listener rule:

- Forward default traffic from ALB listener to `emoji-staging-tg`

### 5) IAM roles for ECS

Menu path:

- AWS Console -> `IAM` -> `Roles`

Create/confirm:

1. Task execution role (for pulling image and writing logs)
   - Trusted entity: `ecs-tasks.amazonaws.com`
   - Policy: `AmazonECSTaskExecutionRolePolicy`

2. Task role (runtime app permissions)
   - Trusted entity: `ecs-tasks.amazonaws.com`
   - Add minimum Secrets Manager access to required secrets
   - Example permission scope:
     - `secretsmanager:GetSecretValue` on specific staging secret ARNs

### 6) ECS cluster

Menu path:

- AWS Console -> `Amazon ECS` -> `Clusters` -> `Create cluster`

Screen choices:

- Cluster type: `Networking only (AWS Fargate)` or latest equivalent
- Name: `emoji-staging-cluster`

### 7) CloudWatch log group

Menu path:

- AWS Console -> `CloudWatch` -> `Log groups` -> `Create log group`

Create:

- Name: `/ecs/emoji-staging`
- Retention: 7-14 days for prototype

### 8) Task definition

Menu path:

- AWS Console -> `Amazon ECS` -> `Task definitions` -> `Create new task definition`

Task-level choices:

- Launch type compatibility: `FARGATE`
- Family: `emoji-staging-task`
- Task role: runtime task role
- Execution role: task execution role
- CPU/Memory: start with `0.5 vCPU` and `1 GB` (adjust as needed)

Container section choices:

- Name: `emoji-app`
- Image URI: from ECR
- Port mappings: container port `3000` (TCP)
- Log driver: `awslogs`
  - Log group: `/ecs/emoji-staging`
  - Region: your staging region
  - Stream prefix: `ecs`

Environment section:

- Plain env vars:
  - `NODE_ENV=production`
  - `HOST=0.0.0.0`
  - `PORT=3000`
  - `COGNITO_USER_POOL_ID=<value>`
  - `COGNITO_APP_CLIENT_ID=<value>`
  - `COGNITO_REGION=<value>`
- Secrets (from Secrets Manager):
  - `MONGODB_URI` -> `emoji-app/staging/mongodb-uri`
  - `OPENAI_API_KEY` -> your staging secret

### 9) ECS service

Menu path:

- AWS Console -> `Amazon ECS` -> `Clusters` -> `emoji-staging-cluster` ->
  `Create` (service)

Service screen choices:

- Launch type: `FARGATE`
- Task definition: `emoji-staging-task:<revision>`
- Service name: `emoji-staging-service`
- Desired tasks: `1` for prototype
- VPC/subnets: private subnets preferred
- Security group: `emoji-staging-ecs-sg`
- Public IP: `DISABLED` when using private subnets + ALB

Load balancing section:

- Load balancer type: `Application Load Balancer`
- Existing load balancer: `emoji-staging-alb`
- Target group: `emoji-staging-tg`
- Container to load balance: `emoji-app:3000`

Deployment settings:

- Rolling update defaults are fine for prototype

### 10) HTTPS (optional now, recommended soon)

Menu path:

- AWS Console -> `Certificate Manager` -> `Request`
- AWS Console -> `EC2` -> `Load Balancers` -> listeners

Steps:

1. Request ACM certificate for staging domain
2. Validate domain ownership
3. Add `HTTPS:443` listener on ALB with certificate
4. (Optional) redirect `HTTP:80` to `HTTPS:443`

### 11) Validation checklist

Run these checks after service is stable:

1. ECS tasks are healthy and running
2. Target group health is healthy
3. ALB DNS responds
4. App endpoints work:
   - `GET /api/badges`
   - DB-backed flow from `docs/manual-tests.md` section 8
5. WebSocket connection works through ALB:
   - connect to `wss://<staging-host>/ws`
   - verify status/emoji events
6. Logs show:
   - Mongo connection success
   - no repeated crash loops

## Rollback playbook

If deployment fails:

1. ECS -> service -> `Deployments`
2. Identify last healthy task definition revision
3. Update service to use previous revision
4. Wait for healthy targets
5. Confirm endpoints and smoke flow

Record after rollback:

- Failed revision
- Rolled-back revision
- Root-cause notes
- Follow-up fix owner

## Evidence to capture for milestone completion

- ECS cluster/service names and region
- ALB DNS name and target group health screenshot
- Successful DB-backed smoke artifact IDs
- Successful WebSocket connection proof
- One tested rollback event (or dry-run with documented procedure)

## Completion criteria (Milestone 4)

- Staging URL serves app and API reliably behind ALB
- WebSocket path functions through ALB
- Runtime secrets are sourced securely (not plaintext in images)
- Rollback procedure is documented and verified
