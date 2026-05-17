# Emoji App

A generative-UI demo built with [Hashbrown](https://hashbrown.dev), React, and NestJS (Express-backed). An AI chat panel sits alongside a standard CRUD interface and can read and update app state directly — adding lights, creating scenes, and scheduling them — through structured tool calls rather than plain text.

## Workflow

### Prerequisites

- Node.js 22+
- An OpenAI API key (local dev)

### Setup

```bash
npm install
cp .env.example .env
# Add your OPENAI_API_KEY to .env
```

### Running

```bash
npm run dev          # run both server and client
npm run dev:client   # http://localhost:5200
npm run dev:server   # http://localhost:3000
npm run build        # production build of both client and server
npm run typecheck    # TypeScript check across both apps
npm run lint         # ESLint across client/src and server/src
npm run docker:build # build the production Docker image
npm run docker:run   # run the image locally on port 3000
npm run test:server  # run the server tests
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
