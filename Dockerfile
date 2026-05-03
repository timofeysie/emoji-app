# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

FROM deps AS builder
COPY . .
# Vite embeds VITE_* at build time — pass when building for production Cognito
ARG VITE_COGNITO_DOMAIN=
ARG VITE_COGNITO_CLIENT_ID=
ARG VITE_COGNITO_SCOPES=
ARG VITE_DISABLE_AUTH=
ENV VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN \
    VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID \
    VITE_COGNITO_SCOPES=$VITE_COGNITO_SCOPES \
    VITE_DISABLE_AUTH=$VITE_DISABLE_AUTH
RUN npm run build:client
RUN npm run build:server

# Separate prod-only deps stage so the runner image carries the tiny set of
# packages that tsc-output JavaScript actually requires at runtime (notably
# tslib, which TypeScript emits a `require("tslib")` for whenever
# importHelpers=true). Keeping this distinct from the dev-deps `deps` stage
# means the final image stays small and free of build-time toolchains.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/dist/server  ./
COPY --from=builder   /app/dist/client   ./client-react
EXPOSE 3000
CMD ["node", "main.js"]
