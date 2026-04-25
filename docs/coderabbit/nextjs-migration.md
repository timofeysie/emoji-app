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
