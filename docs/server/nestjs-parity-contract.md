# NestJS Milestone 1 parity contract

This document defines the externally observable behavior that must remain unchanged when moving the server runtime from Express to NestJS.

## Environment contract

- Required at startup:
  - `OPENAI_API_KEY`
- Optional with defaults:
  - `HOST` defaults to `localhost`
  - `PORT` defaults to `3000`
- Auth environment behavior:
  - `DISABLE_AUTH=true` is honored only when `NODE_ENV !== "production"`
  - Cognito settings are required unless auth is disabled:
    - `COGNITO_USER_POOL_ID`
    - `COGNITO_REGION` or `AWS_REGION`
    - `COGNITO_APP_CLIENT_ID`

## HTTP contract

- `POST /api/chat`
  - Requires Bearer access token unless auth disabled in non-production.
  - Request body shape is passthrough `Chat.Api.CompletionCreateParams`.
  - Response content type is `application/octet-stream`.
  - Response is streamed in chunks from `HashbrownOpenAI.stream.text(...)`.
  - Error contract:
    - `401` JSON for missing/invalid token states from auth middleware.
    - `500` JSON `{ "error": "Internal server error", "message": "<details>" }` if chat stream fails before headers are sent.

- `POST /api/status`
  - Request validation:
    - `controllerId`: non-empty string
    - `badgeId`: non-empty string
    - `bleStatus`: one of `startup|scanning|connecting|connected|disconnected`
    - `timestamp`: optional nullable ISO datetime with UTC offset allowed
  - On success: `201` with `{ "ok": true }`
  - On validation failure: `400` with
    - `error: "Validation failed"`
    - `details: [{ path, message }]`

- `POST /api/emoji`
  - Request validation:
    - `controllerId`, `badgeId`: non-empty string
    - `menu`, `pos`, `neg`: integers
    - `label`: non-empty string
    - `timestamp`: optional nullable ISO datetime with UTC offset allowed
  - On success: `201` with `{ "ok": true }`
  - On validation failure: same `400` envelope as `/api/status`.

- `GET /api/badges`
  - Returns `{ badges: BadgeState[] }`.
  - `BadgeState` keys:
    - `key`, `controllerId`, `badgeId`
    - `status` (`StatusDto | null`)
    - `emoji` (`EmojiDto | null`)

## WebSocket contract

- Server accepts websocket connections at `/ws`.
- Broadcast envelope is JSON:
  - `{ "type": "status.changed", "payload": StatusDto }`
  - `{ "type": "emoji.sent", "payload": EmojiDto }`
- Broadcast occurs on successful `POST /api/status` and `POST /api/emoji`.

## In-memory state contract

- `status` is latest event per `controllerId::badgeId`.
- `emoji` is latest event per `controllerId::badgeId`.
- Emoji history is capped to the last 100 entries.
- Server timestamp is authoritative (`new Date().toISOString()`).
- If client sends `timestamp`, response payload stores it as optional `clientTimestamp`.

## Static serving contract

- In production artifact layout, server serves SPA files from `client-react` located next to the server runtime bundle.
- Any non-API route falls back to `index.html` to support client-side routing.
