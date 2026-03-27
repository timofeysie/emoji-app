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
