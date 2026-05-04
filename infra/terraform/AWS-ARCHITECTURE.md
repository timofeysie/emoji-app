# Terraform ↔ AWS architecture (emoji-app staging)

This document summarizes what the Terraform under `infra/terraform/` provisions and how the pieces connect. It reflects the **staging** environment (`envs/staging/`).

## Table of contents

1. [Scope](#scope)
2. [End-to-end traffic and runtime](#1-end-to-end-traffic-and-runtime)
3. [Terraform module dependency graph](#2-terraform-module-dependency-graph)
4. [Network and security groups](#3-network-and-security-groups)
5. [IAM → ECS](#4-iam--ecs)
6. [Remote state backend (Terraform operations)](#5-remote-state-backend-terraform-operations)
7. [Future / not in diagrams yet](#6-future--not-in-diagrams-yet)

## Scope

- **In Terraform**: default VPC (referenced), security groups, ALB + target group + HTTP listener, IAM roles/policies, ECS cluster/service/task definition, CloudWatch log group.
- **Looked up, not created** (data sources): default VPC/subnets, Secrets Manager secret ARNs for MongoDB and optional OpenAI key.
- **Not managed here**: ECR repository and image pushes (you set `image_uri` in `terraform.tfvars`), secret *values*, MongoDB Atlas, Cognito. The ACM module exists as a **skeleton** (HTTPS/T7) and has no resources yet.

## 1. End-to-end traffic and runtime

Clients hit the public ALB; it forwards to Fargate tasks on port 3000. Tasks read secrets at startup and send logs to CloudWatch.

```mermaid
flowchart LR
  subgraph public["Public internet"]
    users["Users / curl"]
  end

  subgraph aws["AWS ap-southeast-2"]
    alb["Application Load Balancer\nemoji-load-balancer"]
    tg["Target group\nemoji-staging-tg :3000"]
    ecs["ECS Fargate service\nemoji-staging-service"]
    task["Task emoji-staging-task\ncontainer emoji-app :3000"]
    lg["CloudWatch Logs\n/ecs/emoji-staging-task"]
    sm["Secrets Manager\n(emoji-app/staging/*)"]
    ecr["ECR image\n(uri from tfvars)"]
  end

  subgraph external["Outside this Terraform"]
    atlas["MongoDB Atlas"]
    openai["OpenAI API"]
    cognito["Cognito\n(JWT verify)"]
  end

  users -->|"HTTP :80"| alb
  alb --> tg
  tg -->|"health /api/badges"| task
  ecs --> task
  task -->|"awslogs"| lg
  task -->|"MONGODB_URI"| atlas
  task -->|"optional OPENAI_API_KEY"| openai
  task -->|"COGNITO_* env"| cognito
  ecs -.->|"pull image"| ecr
  task -.->|"injected at start"| sm
```

---

## 2. Terraform module dependency graph

How `envs/staging/main.tf` wires modules (arrows read as “depends on / receives inputs from”).

```mermaid
flowchart TB
  net["module.network\nVPC data + ALB/ECS SGs"]
  iam["module.iam_ecs\nexecution + task roles"]
  alb["module.alb\nALB + TG + :80 listener"]
  ecs["module.ecs_service\ncluster + task + service + log group"]
  sec_m["data.aws_secretsmanager_secret\nmongodb_uri"]
  sec_o["data.aws_secretsmanager_secret\nopenai (optional)"]

  net --> alb
  net --> ecs
  iam --> ecs
  alb --> ecs
  sec_m --> ecs
  sec_o --> ecs
```

---

## 3. Network and security groups

The **default VPC** is only referenced (`data.aws_vpc.default`, `data.aws_subnets.default`). Terraform **creates** two security groups and rules: ALB allows 80/443 from the internet; ECS allows **3000/tcp only from the ALB security group**; both allow egress.

ALB and ECS tasks are pinned to an **explicit subnet pair** in `main.tf` (`local.alb_subnet_ids`) so the live ALB matches imported state (two AZs, not all default subnets).

```mermaid
flowchart LR
  subgraph vpc["Default VPC (data source)"]
    subgraph sgs["Managed by module.network"]
      sg_alb["SG emoji-staging-alb-sg\n:80 :443 in"]
      sg_ecs["SG emoji-staging-ecs-sg\n:3000 from ALB SG"]
    end
    alb["ALB subnets\n(local alb_subnet_ids)"]
    tasks["ECS tasks\nsame subnets\npublic IP"]
  end

  internet["0.0.0.0/0"] -->|:80 :443| sg_alb
  sg_alb --> sg_ecs
  sg_alb --- alb
  sg_ecs --- tasks
```

---

## 4. IAM → ECS

- **Execution role**: `AmazonECSTaskExecutionRolePolicy` plus inline policy to `GetSecretValue` / `DescribeSecret` on `emoji-app/staging/mongodb-uri` and `openai-api-key` (wildcard ARN patterns). Used for ECR pull, CloudWatch Logs, and **secret injection** into the container definition.
- **Task role**: same secrets read policy plus a legacy attach (`AmazonEC2ContainerServiceRole`) imported for parity; app runtime may not need the broad managed policy long term.

```mermaid
flowchart LR
  exec["IAM role\nemoji-staging-ecs-execution-role"]
  task["IAM role\nemoji-staging-ecs-task-role"]
  ecs_api["ECS agent / task start"]
  secrets["Secrets Manager"]

  exec -->|"ECR, logs, secrets block"| ecs_api
  task -->|"optional app AWS API use"| ecs_api
  exec --> secrets
  task --> secrets
```

---

## 5. Remote state backend (Terraform operations)

State lives in S3; locking uses DynamoDB. These resources were **bootstrapped manually** (see `README.md`); Terraform configures the backend in `backend.tf` only.

```mermaid
flowchart LR
  cli["terraform CLI"]
  s3["S3 bucket\nemoji-app-tfstate-..."]
  ddb["DynamoDB\nemoji-app-tflock"]
  state["staging/terraform.tfstate"]

  cli <-->|"state read/write"| s3
  cli --> state
  state --- s3
  cli <-->|"lock"| ddb
```

---

## 6. Future / not in diagrams yet

- **`modules/acm/`**: placeholder for ACM certificate and HTTPS listener (milestone T7); no AWS resources in code yet.
- **HTTPS**: today only **HTTP :80 → target group** (`modules/alb`).

For procedural detail (deploy image, outputs, milestones), see [`README.md`](README.md).
