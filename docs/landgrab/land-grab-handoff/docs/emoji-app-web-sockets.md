# Live badge updates: transports and deployment

This app broadcasts badge updates from the server using **WebSockets** (`/ws`) and falls back to
**polling `GET /api/badges`** when the browser cannot connect (for example on **AWS App Runner**,
where HTTP `Upgrade` for WebSockets is often unreliable).

Below are platforms that typically support **WebSockets** or **Server-Sent Events (SSE)** well, so
you can rely on push instead of aggressive polling.

---

## AWS (fits a stack already on AWS)

### ECS on Fargate or EC2 + Application Load Balancer (ALB)

ALB supports **HTTP `Upgrade` for WebSockets** and long-lived HTTP connections used for **SSE**.
The same Node/Express process can keep an existing `ws` server behind the ALB. Tune **idle timeout**
on the load balancer and target group so long-lived connections are not dropped too early.

### Elastic Beanstalk (with ALB)

Same pattern: a load balancer in front of the app. WebSockets and SSE generally work if idle
timeouts and health checks are configured appropriately.

### API Gateway WebSocket API

A **managed WebSocket front door**; Lambdas or HTTP integrations handle connect, disconnect, and
messages. More architecture than a single Express binary, but scales and operates as a known
WebSocket product.

### EC2 + nginx (or Caddy)

Full control: terminate TLS and reverse-proxy WebSocket or SSE to Node. You own tuning and
operations.

### App Runner (current limitation)

**App Runner** is oriented toward request/response HTTP. In practice, **WebSocket upgrades often
fail**, which is why this repo uses **polling** on the Badges view when `wss://` is unavailable.

---

## Other hosted platforms

These are commonly used for apps that need long-lived connections; check current docs and tiers:

- **Google Cloud Run** — WebSockets with appropriate service and concurrency settings.
- **Railway, Render, Fly.io** — Often workable for WebSockets; limits vary by plan.

**Kubernetes** (EKS, GKE, AKS, etc.) with an ingress controller that supports WebSocket (most do)
is also a standard pattern.

---

## SSE vs WebSockets

| Aspect | **SSE** (`text/event-stream`) | **WebSockets** |
| --- | --- | --- |
| **Direction** | Server → client (one way) | Bidirectional |
| **Transport** | Normal HTTPS, long-lived response | HTTP upgrade, then framed messages |
| **Typical use** | Live logs, notifications, badge feeds | Chat, games, duplex tooling |

For **badge status flowing only from server to dashboard**, **SSE can be enough** and sometimes
passes through proxies and load balancers more predictably than WebSockets-but it is not
bidirectional.

This codebase currently uses **WebSockets** for broadcast plus **REST snapshot + polling** as a
fallback.

---

## Hashbrown (LLM) streaming vs badge updates

This app uses **Hashbrown** (`@hashbrownai/core`, `@hashbrownai/openai`, `@hashbrownai/react`) so the
chat UI can show **streaming LLM output** as tokens arrive, instead of waiting for a full reply. On
the server, `POST /api/chat` returns **`application/octet-stream`** and writes incremental chunks
from `HashbrownOpenAI.stream.text()` to the response; the React client consumes that stream through
`HashbrownProvider` and related hooks. That pipeline is built for **chat completions and tool
calls**, not for hardware telemetry.

**Badge data** follows a different path. A Raspberry Pi (or similar) sends discrete events with
**HTTP `POST /api/status`** (and related endpoints); the server stores state and **broadcasts** to
dashboard clients over **`/ws`**, with **`GET /api/badges`** plus polling as a fallback. The Python
script on a **Raspberry Pi Zero 2 W** does not need Hashbrown or a streaming client library: short
**request/response** posts are a good fit for intermittent BLE/status updates, constrained CPU, and
variable networks.

### Hashbrown-style streaming and Pi-to-server updates

**Not as a drop-in replacement for the current badge pipeline.** Reasons:

- **Protocol and purpose**: Hashbrown's stream encodes the **chat completion** contract (model
  tokens, tool orchestration). Reusing it for badge events would mix unrelated semantics and break
  the chat client, which expects that binary stream format.
- **Direction**: Streaming chat is **browser ↔ server ↔ LLM**. Badge ingestion is **device →
  server → many browsers**; the device side is already solved with **REST** and server-side fan-out
  (WebSocket or, if you added it, SSE).
- **Operational fit**: For a Pi Zero 2 W, **POST a JSON body when something changes** is simple,
  idempotent-friendly, and works through proxies and TLS the same way as any API. A long-lived
  upload stream from the Pi to Node would add reconnection logic and backpressure without clear
  benefit over periodic or event-driven POSTs.

If you later need **lower latency or higher volume** from many devices, you would typically add a
**message bus**, **MQTT**, or similar-not the LLM streaming stack.

### If you only mean "streaming to the dashboard"

You can still expose **server → browser** updates as a **chunked HTTP response** or **SSE** (see the
table above). That is conceptually similar to "streaming" for the UI, but it is **separate** from
Hashbrown and targets the **Badges** view, not `/api/chat`.

---

## Practical recommendation

- To stay on **AWS** with minimal conceptual change from a single Node server: **ECS + ALB** (or
  **Elastic Beanstalk + ALB**) is the usual step up from App Runner for **long-lived connections**.
- For a **managed WebSocket edge** on AWS: **API Gateway WebSocket APIs**.
- If **App Runner** remains the target, keep treating **polling + `GET /api/badges`** as the
  reliable path for production badge UI updates.

See also [manual-tests.md](./manual-tests.md) (deployed App Runner section) for behavior of polling
when WebSocket is unavailable.
