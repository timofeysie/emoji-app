# Manual API test checklist

## Prerequisites

- Start the app server from repo root:
  - `npm run dev`
- Confirm API base URL:
  - Local default: `http://localhost:3000`

### Timestamps (server authority)

- **`timestamp` in JSON bodies** is **optional**. If present, it must be a valid ISO-8601
  string; the server **does not** use it as the canonical event time. Python’s
  `datetime.now(timezone.utc).isoformat()` uses a **`+00:00`** suffix (not **`Z`**); the API
  accepts both.
- **Stored times, `GET /api/badges`, and WebSocket payloads** use **server UTC** at request
  time. When the client sent a `timestamp`, the response may include **`clientTimestamp`**
  for debugging.

## 1) Test `POST /api/status` success

Run in PowerShell:

```powershell
$statusBody = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  bleStatus = "connected"
  timestamp = "2026-03-25T10:00:00.000Z"
} | ConvertTo-Json

Invoke-WebRequest `
  -Method POST `
  -Uri "http://localhost:3000/api/status" `
  -ContentType "application/json" `
  -Body $statusBody
```

Expected:

- HTTP status: `201`
- JSON body includes `ok: true`

## 2) Test `POST /api/emoji` success

Run in PowerShell:

```powershell
$emojiBody = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  menu = 0
  pos = 1
  neg = 0
  label = "regular"
  timestamp = "2026-03-25T10:00:01.000Z"
} | ConvertTo-Json

Invoke-WebRequest `
  -Method POST `
  -Uri "http://localhost:3000/api/emoji" `
  -ContentType "application/json" `
  -Body $emojiBody
```

Expected:

- HTTP status: `201`
- JSON body includes `ok: true`

## 3) Test validation failures (`400`)

### 3a) Invalid `bleStatus`

```powershell
$badStatusBody = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  bleStatus = "bad-value"
  timestamp = "2026-03-25T10:00:00.000Z"
} | ConvertTo-Json

Invoke-WebRequest `
  -Method POST `
  -Uri "http://localhost:3000/api/status" `
  -ContentType "application/json" `
  -Body $badStatusBody
```

Expected:

- HTTP status: `400`
- Response has `error: "Validation failed"`
- `details` includes an error for `bleStatus`

### 3b) Missing emoji field

```powershell
$badEmojiBody = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  menu = 0
  pos = 1
  label = "regular"
  timestamp = "2026-03-25T10:00:01.000Z"
} | ConvertTo-Json

Invoke-WebRequest `
  -Method POST `
  -Uri "http://localhost:3000/api/emoji" `
  -ContentType "application/json" `
  -Body $badEmojiBody
```

Expected:

- HTTP status: `400`
- `details` includes a validation error for `neg`

## 4) Test WebSocket broadcast events

Open browser DevTools Console on any page served by the app and run:

```javascript
const ws = new WebSocket("ws://localhost:3000/ws");
ws.onopen = () => console.log("ws open");
ws.onmessage = (event) => console.log("ws message", JSON.parse(event.data));
ws.onerror = (event) => console.error("ws error", event);
ws.onclose = () => console.log("ws closed");
```

Then run the success requests from steps 1 and 2.

Expected WebSocket messages:

- One message with `type: "status.changed"` and matching payload
- One message with `type: "emoji.sent"` and matching payload

## 5) Test emoji history cap behavior

The server keeps only the last `N` emoji events in memory (`MAX_EMOJI_HISTORY` in
`server/src/main.ts`, currently `100`).

Manual check:

- Send more than 100 valid emoji requests (for example 110).
- Confirm server remains stable and continues returning `201`.
- If you temporarily add a debug log/inspection endpoint locally, verify only the
  last 100 events are retained.

## 6) Quick badge-view smoke test (terminal + UI)

Use this when testing the `Badges` page quickly.

### 6a) Set base URL in the same terminal

```powershell
$base = "http://localhost:3000"
```

### 6b) Create badge status event

```powershell
$body = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  bleStatus = "connected"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$base/api/status" -ContentType "application/json" -Body $body
```

### 6c) Update same badge to disconnected

```powershell
$body = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  bleStatus = "disconnected"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$base/api/status" -ContentType "application/json" -Body $body
```

### 6d) Send emoji event for same badge

```powershell
$emoji = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  menu = 3
  pos = 2
  neg = 0
  label = "regular"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$base/api/emoji" -ContentType "application/json" -Body $emoji
```

Expected result:

- Each request returns `{ "ok": true }`.
- In the UI at `/badges`, `badge-kitchen` appears/updates with:
  - current BLE status
  - latest emoji fields (`label`, `menu`, `pos`, `neg`)
  - updated timestamps

## 7) Deployed App Runner (production URL)

Use the **same** REST endpoints as locally, but with the deployed **origin** (HTTPS, no port):

- Badges UI:  
  `https://4jvum6svrd.ap-southeast-2.awsapprunner.com/badges`
- API base (for `Invoke-RestMethod` / `curl`):  
  `https://4jvum6svrd.ap-southeast-2.awsapprunner.com`

Paths on that host include `/api/status`, `/api/emoji`, and **`GET /api/badges`** (snapshot of
in-memory badge state for the dashboard).

**Why the UI can look empty after a POST:** the Badges page updates from **WebSocket** events
and from **`GET /api/badges` on load**. If you POST from a terminal **before** opening `/badges`,
that broadcast may have happened when **no browser was connected**, so there was nothing to
receive. **Refresh the page** after deploying this fix: the client loads snapshot data from
`GET /api/badges`. With **multiple App Runner instances**, REST and WebSocket can land on
different replicas (in-memory state is not shared); use a single instance or shared state if
you need guaranteed consistency.

### 7a) Set base URL (PowerShell)

```powershell
$base = "https://4jvum6svrd.ap-southeast-2.awsapprunner.com"
```

### 7b) Add or update BLE status (creates/updates the badge row in `/badges`)

`POST /api/status` — body includes `controllerId`, `badgeId`, `bleStatus` (`connected` or `disconnected`), and ISO `timestamp`.

```powershell
$body = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  bleStatus = "connected"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$base/api/status" -ContentType "application/json" -Body $body
```

Update status (example: disconnected):

```powershell
$body = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  bleStatus = "disconnected"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$base/api/status" -ContentType "application/json" -Body $body
```

### 7c) Send an emoji event (last emoji + label for the badge)

`POST /api/emoji` — body includes `controllerId`, `badgeId`, `menu`, `pos`, `neg`, `label`, `timestamp`.

```powershell
$emoji = @{
  controllerId = "zero-living-room"
  badgeId = "badge-kitchen"
  menu = 0
  pos = 1
  neg = 0
  label = "regular"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$base/api/emoji" -ContentType "application/json" -Body $emoji
```

### 7d) Verify in the browser

1. Open or **refresh**  
   `https://4jvum6svrd.ap-southeast-2.awsapprunner.com/badges`
2. The page calls **`GET /api/badges`** on load so existing server state appears after refresh.
3. With the page already open, each successful POST should push **WebSocket** events; the list
   should show:
   - link status from `/api/status`
   - last emoji from `/api/emoji`

The WebSocket URL on production is **`wss://`**same host**`/ws`** (the app uses the page origin in production).

**Note:** [AWS App Runner](https://docs.aws.amazon.com/apprunner/latest/dg/what-is-apprunner.html) often **does not support WebSocket upgrades**, so the browser may show a failed `wss://…/ws` connection. The Badges page **falls back to polling `GET /api/badges`** about every **10 seconds** when WebSocket is unavailable (polling **pauses while the tab is hidden**), so the UI still updates without WebSockets.

### 7d2) Optional: inspect snapshot (PowerShell)

```powershell
Invoke-RestMethod -Method GET -Uri "$base/api/badges"
```

You should see a `badges` array with any keys that have status and/or emoji on **that** server
instance.

### 7e) Expected HTTP responses

- Success: status `201` and JSON like `{ "ok": true }`
- Validation error: status `400` and `error` / `details` from the server
