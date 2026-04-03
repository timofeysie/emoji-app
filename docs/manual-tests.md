# Manual API test checklist

## Prerequisites

- Start the app server from repo root:
  - `npm run dev`
- Confirm API base URL:
  - Local default: `http://localhost:3000`

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
