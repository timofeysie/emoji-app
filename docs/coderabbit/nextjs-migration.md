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
