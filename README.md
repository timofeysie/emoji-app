# Emoji App

A generative-UI demo built with [Hashbrown](https://hashbrown.dev), React, and Express. An AI chat panel sits alongside a standard CRUD interface and can read and update app state directly — adding lights, creating scenes, and scheduling them — through structured tool calls rather than plain text.

## Workflow

### Prerequisites

- Node.js 22+
- An OpenAI API key

### Setup

```bash
npm install
cp .env.example .env
# Add your OPENAI_API_KEY to .env
```

### Running

```bash
npm run dev
npm run dev:client   # http://localhost:5200
npm run dev:server   # http://localhost:3000
npm run build        # production build of both client and server
npm run typecheck    # TypeScript check across both apps
npm run lint         # ESLint across client/src and server/src
npm run docker:build # build the production Docker image
npm run docker:run   # run the image locally on port 3000
```


## Architecture

```text
emoji-app/
├── client/          React SPA (Vite)
├── server/          Express API (Node)
└── dist/            production build output (gitignored)
    ├── client/      Vite output — served as static files by Express
    └── server/      esbuild bundle — the production Node process
```

### How the pieces fit together

```text
Browser
  └── React SPA (port 5200 in dev, same origin in production)
        ├── App UI  ──── reads/writes ──── Zustand store
        └── RichChatPanel
              │
              POST /api/chat  (streaming, application/octet-stream)
              │
              ▼
        Express server (port 3000)
              │
              └── HashbrownOpenAI.stream.text()
                    │
                    └── OpenAI API
```

In production the Express server also serves the React SPA as static files, so both run on a single origin with no CORS configuration required.

### Key dependencies

| Package | Role |
|---------|------|
| `@hashbrownai/react` | `HashbrownProvider`, hooks for structured AI output |
| `@hashbrownai/openai` | Server-side OpenAI streaming adapter |
| `@hashbrownai/core` | Shared types, schema helpers, transport protocol |
| `openai` | OpenAI Node SDK (peer dep of `@hashbrownai/openai`) |
| `express` | HTTP server and static file serving |
| `vite` | React SPA dev server and production bundler |
| `zustand` | Client-side state store |
| `tailwindcss` + Radix UI | Styling and accessible UI primitives |

## Production deployment

The app is deployed as a single Docker container on **AWS App Runner**. The
Express server serves the React SPA as static files and handles the
`/api/chat` streaming endpoint on the same origin.

See [`docs/deployments.md`](docs/deployments.md) for the full step-by-step
guide including ECR setup, IAM roles, environment variables, and the
auto-deploy CI workflow.

See [`docs/auth.md`](docs/auth.md) for authentication options (AWS Cognito
recommended).

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI secret key |
| `PORT` | No | `3000` | Port the Express server listens on |
| `HOST` | No | `localhost` | Host to bind (`0.0.0.0` in production) |
