# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A generative-UI demo app for emoji badge games automation. An AI chat panel sits alongside a CRUD UI; the AI can read and mutate app state through structured tool calls.

## Setup

```bash
npm install
cp .env.example .env  # Add OPENAI_API_KEY
```

## Commands

```bash
npm run dev          # Run client (port 5200) + server (port 3000) concurrently
npm run dev:client   # Vite dev server only
npm run dev:server   # Express server only (Node watch mode)
npm run build        # Build both for production
npm run typecheck    # TypeScript validation across both projects
npm run lint         # ESLint on client/src and server/src
npm run docker:build # Build Docker image
npm run docker:run   # Run Docker container on port 3000 (requires .env)
```

## Architecture

**Monorepo** with two sub-projects sharing `tsconfig.base.json`:

- `client/` — React SPA (Vite, TypeScript)
- `server/` — Express API (esbuild-bundled for prod, Node watch for dev)

**Data flow:**
```
React UI ↔ Zustand store
RichChatPanel → POST /api/chat (streaming, application/octet-stream)
Express server → HashbrownOpenAI.stream.text() → OpenAI API
```

In development, Vite proxies `/api` to `localhost:3000`. In production, Express serves the React SPA as static files (`client-react/` directory relative to the server bundle) and handles `/api/chat` on the same origin.

## Key Files

| File | Purpose |
|------|---------|
| `client/src/app/app.tsx` | Root component — HashbrownProvider, 7-col grid layout (4 content + 3 chat), routing |
| `client/src/app/store/emoji-app.store.ts` | Zustand store — all CRUD actions for lights, scenes, scheduled scenes |
| `client/src/app/shared/RichChatPanel.tsx` | AI chat panel — defines all Hashbrown tools the AI can call |
| `server/src/main.ts` | Express server — `/api/chat` streaming endpoint + SPA static serving |

## Generative UI Pattern

`RichChatPanel.tsx` defines tools (using `@hashbrownai/react`) that the AI model can invoke to interact with the app:
- **State tools**: `getLights`, `getScenes` — read from Zustand store
- **Action tools**: `controlLight`, `createLight`, `deleteLight`, `deleteScene` — dispatch Zustand actions
- **DOM tools**: `setFormInputValue`, `clickButtonByText` — manipulate React form elements directly via DOM APIs, allowing the AI to fill forms and submit dialogs

Tool arguments are validated with Hashbrown's schema system (`s.object`, `s.string`, etc.).

## Tech Stack

- **Frontend**: React 18, Vite 7, React Router, Zustand 5, Radix UI, Tailwind CSS
- **AI**: Hashbrown (`@hashbrownai/core`, `@hashbrownai/openai`, `@hashbrownai/react`), OpenAI SDK
- **Backend**: Express 4, Node.js ≥22
- **Language**: TypeScript ~5.8, strict mode
- **Bundling**: Vite (client), esbuild (server)
- **Container**: Docker multi-stage (Node 22 Alpine)
