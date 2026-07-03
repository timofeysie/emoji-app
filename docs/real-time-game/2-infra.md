# Step 2 — Infrastructure

Status: code changes implemented; staging deploy pending `terraform apply`.

This document covers the infrastructure changes needed to support the realtime
WebSocket connections between the server, the browser dashboard, and the Zero
controllers. Step 1 built the server-side WS registry; Step 2 makes the AWS
layer safe for long-lived connections.

## Goal

The ALB currently defaults to a **60 s idle timeout**, which drops any WebSocket
connection that has been quiet for a minute. Pi Zero controllers reconnect on
disconnect, but the churn wastes resources and interrupts game events. We need
the timeout raised and the `wss://` upgrade path verified end-to-end.

## Changes required

### 1. ALB idle timeout — `modules/alb/main.tf`

Add `idle_timeout` to `aws_lb.app`. The design calls for **300 s** (5 min). The
server sends a WebSocket ping every ~30 s, so connections never sit idle that
long in practice; 300 s gives headroom for slow clients and brief quiet periods.

**Current** (`infra/terraform/modules/alb/main.tf`, `aws_lb.app` block):

```hcl
resource "aws_lb" "app" {
  name               = "emoji-load-balancer"
  internal           = false
  load_balancer_type = "application"
  ip_address_type    = "ipv4"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.subnet_ids
}
```

**After** — add one line:

```hcl
resource "aws_lb" "app" {
  name               = "emoji-load-balancer"
  internal           = false
  load_balancer_type = "application"
  ip_address_type    = "ipv4"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.subnet_ids

  idle_timeout = 300
}
```

### 2. Expose `idle_timeout` as a module variable (optional but clean)

Add to `modules/alb/variables.tf` so the value can be tuned per environment
without touching `main.tf`:

```hcl
variable "alb_idle_timeout" {
  description = "ALB idle connection timeout in seconds. Raise above 60 for WebSocket support."
  type        = number
  default     = 300
}
```

Then in `main.tf` reference `var.alb_idle_timeout` instead of the hard-coded
value. The staging `main.tf` does not need to pass this variable (the default
applies automatically).

### 3. Server-side WebSocket heartbeat

The server must send periodic pings so the ALB never sees a fully idle
connection. This is a **server-side code change** (not Terraform), but it is
gated on this infra step.

Add to `badge-state.service.ts` inside `setWebSocketServer`, after the
`connection` handler:

```typescript
// Ping every 30 s to keep connections alive through the ALB idle timeout
const heartbeatInterval = setInterval(() => {
  for (const client of this.wsServer!.clients) {
    if (client.readyState === client.OPEN) {
      client.ping();
    }
  }
}, 30_000);

wsServer.on('close', () => clearInterval(heartbeatInterval));
```

Clients (browsers and the Zero `websockets` library) respond to pings with
automatic pongs — no client-side code required.

## End-to-end WSS verification

After deploying the Terraform change, verify the upgrade path manually:

1. Open browser DevTools → Network → WS filter.
2. Load `https://emoji-staging.kogs.link` and confirm a `101 Switching
   Protocols` response on `/ws`.
3. Leave the tab open for > 60 s (the old timeout). Confirm the WS connection
   stays `OPEN` in DevTools.
4. Optionally use `wscat` from a terminal to connect as a controller:

   ```bash
   npx wscat -c "wss://emoji-staging.kogs.link/ws"
   # send:
   {"type":"controller.hello","pairName":"test","token":null}
   # expect back:
   {"type":"controller.welcome","pairName":"test", ...}
   ```

5. Wait > 60 s with no traffic. Confirm the connection is not dropped.

## Acceptance criteria

- `terraform plan` shows only the `idle_timeout` attribute changing on
  `aws_lb.app` (no resource replacement).
- `terraform apply` succeeds without resource recreation.
- A WebSocket connection to `wss://emoji-staging.kogs.link/ws` stays open for
  > 5 minutes without explicit traffic (relies on server ping heartbeat).
- `controller.hello` → `controller.welcome` round-trip works through the ALB
  (confirms the HTTP Upgrade header is forwarded correctly).
- Health check on `GET /api/badges` is unaffected.

## Files to change

| File | Change |
| --- | --- |
| `infra/terraform/modules/alb/main.tf` | Add `idle_timeout = 300` (or `var.alb_idle_timeout`) to `aws_lb.app` |
| `infra/terraform/modules/alb/variables.tf` | Add `alb_idle_timeout` variable with default 300 |
| `server/src/badge-state.service.ts` | Add 30 s ping heartbeat in `setWebSocketServer` |

## Notes

- The ALB forwards the `Upgrade: websocket` header automatically — no listener
  rule changes are required.
- Health check stays on `GET /api/badges` (HTTP, port 3000 — unaffected).
- No new public endpoints are introduced.
- Raising `idle_timeout` is a live ALB attribute change; AWS performs it
  in-place with no downtime and no new resource creation.

## Confirmation on local machine

This  confirms the Vite proxy fix is working:

- Request URL ws://localhost:3000/ws
- Request Method GET
- Status Code 101 Switching Protocols
- Response Body

```json
{
    "type": "status.changed",
    "controllerId": "zero-living-room",
    "badgeId": "badge-88-a2-9e-4c-8c-7f",
    "bleStatus": "connected",
    "timestamp": "2026-07-03T03:36:21.886Z",
    "clientTimestamp": "2026-07-03T03:36:21.435660+00:00",
    "pairName": "power-cable",
    "controllerVersion": "0.5.11",
    "picoVersion": "0.3.3"
}
```
