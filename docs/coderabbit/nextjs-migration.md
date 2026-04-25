# NestJS Migration Notes

## Privacy-safe logging follow-up

During the NestJS migration review, CodeRabbit flagged a privacy risk: chat payload content (including potential PII) could be written to stdout and then persisted in production log systems.

### Issues identified

- Chat message content was logged in `server/src/chat.controller.ts`.
- Tool call arguments were logged verbatim in chat request traces.
- Global HTTP middleware logged full POST request bodies in `server/src/request-logging.middleware.ts`.
- In production, those logs could be retained in CloudWatch or similar backends.

### Solution implemented

We changed server logging defaults to metadata-only and made detailed content logging explicit opt-in for non-production environments.

- `server/src/chat.controller.ts`
  - Default: omit message/tool content.
  - Keep safe metadata such as role, message index, and content length.
  - Add opt-in flag: `LOG_CHAT_CONTENT=true` (honored only when `NODE_ENV !== "production"`).

- `server/src/request-logging.middleware.ts`
  - Default: omit full request/response bodies.
  - Log body size metadata instead for POST requests.
  - Add opt-in flag: `LOG_HTTP_BODIES=true` (honored only when `NODE_ENV !== "production"`).

### Operational guidance

- Production:
  - Leave `LOG_CHAT_CONTENT` unset or `false`.
  - Leave `LOG_HTTP_BODIES` unset or `false`.
- Local debugging only:
  - Set `LOG_CHAT_CONTENT=true` and/or `LOG_HTTP_BODIES=true` temporarily.
  - Avoid using verbose flags in shared or persistent environments.

### Outcome

The migration now keeps useful observability (route, status, duration, message counts, payload sizes) while reducing accidental leakage of sensitive user content in logs.

## Safe error response follow-up

CodeRabbit also flagged that internal exception messages were being returned to clients from the chat endpoint, which can expose implementation details.

### Issue identified

- `server/src/chat.controller.ts` returned `error.message` in the `500` JSON response for `/api/chat`.
- Depending on upstream failures, this could leak internal configuration or runtime details to external clients.

### Solution implemented

- The client-facing `500` payload is now generic:
  - `error: "Internal server error"`
  - `message: "An unexpected error occurred"`
- Full exception details remain in server logs via `console.error(...)` for operational debugging.

### Outcome

The API now follows a safer pattern: detailed diagnostics stay server-side, while clients receive a stable, non-sensitive error contract.

## Auth wrapper race condition follow-up

CodeRabbit flagged a race condition risk in the `runAuth(...)` helper used by `server/src/chat.controller.ts`.

### Issue identified

- The previous wrapper checked `res.headersSent` immediately after calling `requireAuth(...)`.
- `requireAuth(...)` performs asynchronous token verification, so a synchronous `headersSent` check can run too early.
- Result: the wrapper could resolve before auth finished, causing non-deterministic behavior.

### Solution implemented

- Replaced the synchronous `headersSent` check with event-based completion logic.
- `runAuth(...)` now:
  - Resolves `true` when `requireAuth(...)` calls `next()`.
  - Resolves `false` when the response ends (`finish`) or closes (`close`) before `next()`.
  - Uses a `settled` guard to prevent double resolution.

### Why this approach

- It is a small, local fix that preserves existing middleware behavior.
- It is more reliable than `setImmediate(...)`, which still races with async JWT/JWKS work.
- Longer-term, a NestJS `Guard` remains the most idiomatic option, but was not required for this milestone.

### Outcome

Auth handling is now deterministic in the NestJS controller wrapper while keeping migration scope minimal.

## Request body redaction follow-up

CodeRabbit flagged that request body logging can expose sensitive values such as passwords, tokens, and secrets.

### Issue identified

- `server/src/request-logging.middleware.ts` logged POST request bodies.
- Even with truncation, logs can still include high-risk fields in plaintext.
- Sensitive auth-related endpoints should be excluded from body logging.

### Solution implemented

- Added endpoint-based exclusions for body logging on sensitive path prefixes:
  - `/auth`
  - `/oauth`
  - `/signin`
  - `/login`
  - `/logout`
  - `/token`
- Added recursive field redaction before verbose body logging.
- Redaction masks common sensitive key patterns (case-insensitive), including:
  - `password`, `passcode`, `token`, `secret`, `authorization`
  - `apiKey`, `api_key`, `cookie`, `session`, `jwt`
  - `client_secret`, `refresh_token`, `id_token`

### Logging behavior after change

- Sensitive endpoints:
  - Request body is omitted entirely.
- Non-sensitive endpoints with `LOG_HTTP_BODIES=true` (and non-production):
  - Request body is logged only after redaction.
- Default behavior:
  - Body content remains omitted and only body size metadata is logged.

### Outcome

The server keeps operational request logging while materially reducing risk of leaking credentials or authentication artifacts into persistent logs.
