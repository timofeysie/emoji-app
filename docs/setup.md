# Standalone Repo Setup Plan

This document describes how to extract the `smart-home` sample into its own
self-contained repository, independent of the Hashbrown monorepo.

## Goals

- Full parity with the React SPA and Express server code in this repo
- Same build outputs (Vite for the client, esbuild for the server)
- Same Docker-based deployment (as documented in `docs/deployments.md`)
- No dependency on Nx or the monorepo toolchain
- `@hashbrownai/*` packages consumed as published npm packages

---

## New repo structure

```text
smart-home/
├── client/                     # React SPA
│   ├── src/                    # copied from samples/smart-home/react/src/
│   ├── index.html
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   └── vite.config.ts          # simplified (no Nx plugins)
├── server/                     # Express API
│   ├── src/
│   │   └── main.ts             # copied from samples/smart-home/server/src/
│   ├── tsconfig.json
│   └── tsconfig.app.json
├── dist/                       # build output — gitignored
│   ├── client/
│   └── server/
├── .env.example
├── .gitignore
├── Dockerfile
├── package.json
└── tsconfig.base.json
```

---

## Step 1 — Create the repo and copy source files

```bash
mkdir smart-home && cd smart-home
git init

# Copy React source
mkdir -p client
cp -r <monorepo>/samples/smart-home/react/src       client/src
cp    <monorepo>/samples/smart-home/react/index.html client/
cp    <monorepo>/samples/smart-home/react/tailwind.config.js client/
cp    <monorepo>/samples/smart-home/react/postcss.config.js  client/

# Copy server source
mkdir -p server/src
cp <monorepo>/samples/smart-home/server/src/main.ts server/src/
```

---

## Step 2 — Root `package.json`

Create `package.json` at the repo root. All packages that were previously
resolved from the monorepo root are listed here explicitly.

```json
{
  "name": "smart-home",
  "version": "1.0.0",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build --config client/vite.config.ts",
    "build:server": "esbuild server/src/main.ts --bundle --platform=node --format=cjs --outfile=dist/server/main.js --sourcemap=false",
    "dev:client": "vite --config client/vite.config.ts",
    "dev:server": "node --watch --env-file=.env dist/server/main.js",
    "dev": "npm run build:server && concurrently \"npm run dev:client\" \"npm run dev:server\"",
    "typecheck": "tsc -p client/tsconfig.app.json --noEmit && tsc -p server/tsconfig.app.json --noEmit",
    "lint": "eslint client/src server/src",
    "docker:build": "docker build -t smart-home .",
    "docker:run": "docker run -p 3000:3000 --env-file .env smart-home"
  },
  "dependencies": {
    "@hashbrownai/core": "0.4.1-alpha.1",
    "@hashbrownai/openai": "0.4.1-alpha.1",
    "@hashbrownai/react": "0.4.1-alpha.1",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "rxjs": "~7.8.0",
    "tslib": "^2.4.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-scroll-area": "^1.2.5",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "@types/react": "18.3.1",
    "@types/react-dom": "18.3.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "concurrently": "^9.0.0",
    "date-fns": "^3.6.0",
    "esbuild": "^0.25.0",
    "eslint": "^9.8.0",
    "lucide-react": "^0.488.0",
    "openai": "^6.9.0",
    "postcss": "^8.4.5",
    "react-day-picker": "^8.10.1",
    "react-markdown": "^10.1.0",
    "react-router-dom": "6.29.0",
    "tailwind-merge": "^3.2.0",
    "tailwindcss": "^3.4.17",
    "typescript": "~5.8.0",
    "uuid": "^11.1.0",
    "vaul": "^1.1.2",
    "vite": "^7.0.0",
    "vite-tsconfig-paths": "^5.0.0",
    "zustand": "^5.0.3"
  }
}
```

> **Note on `@hashbrownai/*` versions:** the packages are at `0.4.1-alpha.1`
> in this monorepo. Pin to the same version or update to the latest published
> release on npm (`npm show @hashbrownai/core version`).

---

## Step 3 — Root `tsconfig.base.json`

In the monorepo this file contains path aliases that point `@hashbrownai/*`
imports at local source. In the standalone repo those packages come from
`node_modules`, so no path aliases are needed.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "importHelpers": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

---

## Step 4 — Client TypeScript config

`client/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "allowJs": false,
    "esModuleInterop": false,
    "allowSyntheticDefaultImports": true,
    "types": ["vite/client"]
  },
  "files": [],
  "include": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

`client/tsconfig.app.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../dist/out-tsc"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/**/*.spec.ts", "src/**/*.spec.tsx"]
}
```

---

## Step 5 — Client `vite.config.ts`

Remove the two Nx-specific plugins (`nxViteTsPaths`, `nxCopyAssetsPlugin`) and
replace with `vite-tsconfig-paths`. Update the output directory.

```typescript
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5200,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  preview: {
    port: 5300,
    host: '0.0.0.0',
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    reportCompressedSize: true,
  },
});
```

The `proxy` block routes `/api` requests to the local Express server during
development, which avoids CORS without changing the client code.

---

## Step 6 — Server TypeScript config

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "esModuleInterop": true
  },
  "files": [],
  "include": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

`server/tsconfig.app.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../dist/out-tsc"
  },
  "include": ["src/**/*.ts"]
}
```

---

## Step 7 — Update `server/src/main.ts`

The static file path in `main.ts` references `client-react` (the Nx output
folder name). In the standalone repo the Vite output goes to `dist/client`, so
the path should be adjusted in the Dockerfile copy step (see Step 9) — the
code itself does not need to change since it uses `__dirname` dynamically.

The `HOST` default of `localhost` must become `0.0.0.0` in production. This is
handled via the `HOST` environment variable in the Dockerfile/App Runner config;
no code change is needed.

---

## Step 8 — Environment files

`.env.example`:

```dotenv
# Required
OPENAI_API_KEY=sk-...

# Optional (defaults shown)
HOST=localhost
PORT=3000
```

`.gitignore` (additions):

```gitignore
dist/
node_modules/
.env
```

---

## Step 9 — Dockerfile

The updated Dockerfile for the new repo structure:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

FROM deps AS builder
COPY . .
RUN npm run build:client
RUN npm run build:server

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/dist/server ./
COPY --from=builder /app/dist/client  ./client-react
EXPOSE 3000
CMD ["node", "main.js"]
```

The client build output is copied into `client-react` next to `main.js`, which
is where `express.static(path.join(__dirname, 'client-react'))` in `main.ts`
expects to find it.

---

## Step 10 — GitHub Actions CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npm run typecheck

      - run: npm run lint

      - run: npm run build

  docker:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-2

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push
        run: |
          docker build -t ${{ secrets.ECR_REGISTRY }}/smart-home:latest .
          docker push ${{ secrets.ECR_REGISTRY }}/smart-home:latest
```

Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`ECR_REGISTRY` (the full ECR registry URI, e.g.
`123456789.dkr.ecr.ap-southeast-2.amazonaws.com`).

App Runner will pick up the new image automatically because `AutoDeploymentsEnabled`
is set to `true` (see `docs/deployments.md`).

---

## Step 11 — Verify locally

```bash
npm install

# In separate terminals:
npm run dev:client    # http://localhost:5200
npm run dev:server    # http://localhost:3000

# Or both at once:
npm run dev

# Production build smoke-test:
npm run build
docker build -t smart-home-test .
docker run --rm -p 3000:3000 --env-file .env smart-home-test
# Open http://localhost:3000
```

---

## Key differences from the monorepo

| Concern | Monorepo | Standalone repo |
|---------|----------|-----------------|
| `@hashbrownai/*` source | Local workspace paths via `tsconfig.base.json` | Published npm packages |
| Build orchestration | Nx (`nx build`, `nx serve`) | npm scripts + vite/esbuild directly |
| Vite plugins | `nxViteTsPaths`, `nxCopyAssetsPlugin` | `vite-tsconfig-paths` |
| Dev proxy | CORS + separate ports | Vite `proxy` to `localhost:3000` |
| Output paths | `dist/samples/smart-home/...` | `dist/client/`, `dist/server/` |
| CI | Nx affected | Plain `npm run build` |

---

## Open questions before starting

1. **`@hashbrownai/*` version** — confirm the packages are published at
   `0.4.1-alpha.1` on npm, or determine the correct version to pin.
2. **Auth** — if Cognito auth is added before the repo migration, the
   `auth.ts` middleware and env vars should be included in the copy step.
   See `docs/auth.md`.
3. **Storybook** — the monorepo has Storybook stories for several components.
   Decide whether to include Storybook in the new repo or drop the story files.
4. **ESLint config** — the monorepo uses a flat ESLint config with Nx-specific
   rules (`enforce-module-boundaries`). The standalone repo needs a simpler
   config; a basic `eslint.config.mjs` with TypeScript and React rules is
   sufficient.
