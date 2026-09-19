# Land Grab — AWS Monthly Cost Estimate

Cost model for hosting the **networked phases** of [`docs/land-grab/land-grab.md`](land-grab.md)
on AWS: the authoritative Node.js + `ws` game server, matchmaking, a leaderboard, and
serving the built Phaser/React client.

> **Numbers are approximate**, on-demand, single region (`us-east-1`), priced from
> published AWS rates as of mid-2026. Treat the totals as ±30%. Every figure below is
> "list price with no commitment"; the [Levers](#levers-to-cut-the-bill) section covers
> the discounts.

## Table of contents

- [What the backend actually needs](#what-the-backend-actually-needs)
- [Reference architecture on AWS](#reference-architecture-on-aws)
- [Cost scenarios at a glance](#cost-scenarios-at-a-glance)
- [Scenario A — always-on demo](#scenario-a--always-on-demo)
- [Scenario B — small live game](#scenario-b--small-live-game)
- [Scenario C — medium live game](#scenario-c--medium-live-game)
- [The egress problem](#the-egress-problem)
- [Options explicitly ruled out or flagged](#options-explicitly-ruled-out-or-flagged)
- [Levers to cut the bill](#levers-to-cut-the-bill)
- [Recommendation](#recommendation)
- [Assumptions](#assumptions)

## What the backend actually needs

From the plan, the minimum networked deployment is **one always-on Node process reachable
over WSS**:

| Plan element | AWS need |
| --- | --- |
| Node.js + `ws`, one process per match/room, 6 Hz tick loop | Long-lived container/VM compute |
| WebSocket transport, snapshot-on-join + delta-per-tick | TLS-terminating L4/L7 load balancer that supports WS |
| "Start with one fixed room", matchmaking later | Nothing at first; Redis/DynamoDB when rooms multiply |
| Leaderboard | DynamoDB (trivial spend) |
| Built Vite client | S3 + CloudFront |

The simulation itself is **CPU-cheap** — a 60×40 grid, ≤8 players/room, flood-fills only
on loop-closure events. You are not paying for compute cycles. You are paying for three
things: an always-on reservation, the load balancer's existence, and **outbound
bandwidth**. Cost per extra concurrent player is almost entirely bandwidth.

## Reference architecture on AWS

```
                 ┌── CloudFront ──> S3            (static client bundle)
 players ───┬────┤
            │    └── ALB (WSS/443) ──> ECS Fargate service   (game server tasks,
            │                             │                    one process hosts many rooms)
            │                             ├──> ElastiCache Redis   (lobby / matchmaking / presence)
            │                             └──> DynamoDB            (leaderboard, match history)
            │
        Route 53 (DNS)     ACM (TLS cert, free)     CloudWatch (logs/metrics)     ECR (image)
```

- **Compute:** ECS Fargate to start (no EC2 to patch); switch the service to EC2 launch
  type (Graviton `c7g`) once steady-state load makes reserved instances cheaper than
  per-second Fargate.
- **Load balancer:** ALB supports WebSockets and terminates TLS. NLB with a TLS listener
  is a cheaper alternative once throughput is high (see [egress](#the-egress-problem)).
- **Networking:** put Fargate tasks in **public subnets with public IPs** — a NAT Gateway
  is ~$33/mo + $0.045/GB and is pure waste here.
- **TLS:** ACM certificate, free.
- **Matchmaking state:** skip entirely for a single lobby. Add one small Redis node when
  you need cross-process room assignment and presence.

## Cost scenarios at a glance

| | **A — always-on demo** | **B — small live game** | **C — medium live game** |
| --- | --- | --- | --- |
| Peak concurrent players | ~10–20 | ~300 | ~1,500 |
| Avg concurrent players | ~2–5 | ~150–200 | ~800–1,000 |
| Compute | 1 Fargate task | 3–4 Fargate tasks | 3–4 × `c7g.large` EC2 |
| Redis | none | 1 × `t4g.micro` | 2 × `t4g.small` (HA) |
| Monthly egress | <100 GB (free) | ~1.5–2 TB | ~9–11 TB |
| **Estimated total / month** | **~$40** | **~$330–450** | **~$1,300–1,700** |
| Cheapest sane variant | **~$10–16** (Lightsail / 1 small VM) | ~$250 (NLB + Graviton + Savings Plan) | ~$1,000 (EC2 RIs, tuned protocol) |

## Scenario A — always-on demo

Peak ~10–20 players, average 2–5 concurrent. This is "the demo is live on the internet so
people can click it," which is the realistic next step for this repo.

| Item | Config | $/mo |
| --- | --- | --- |
| Fargate game server | 1 task, 0.5 vCPU / 1 GB, Graviton | ~$15 |
| Application Load Balancer | base + minimal LCU | ~$18 |
| Client hosting | S3 + CloudFront (within always-free tier) | ~$1 |
| Route 53 | 1 hosted zone | ~$1 |
| CloudWatch | basic log ingestion + a few metrics | ~$3 |
| ECR | 1 image (~300 MB) | ~$0 |
| DynamoDB | on-demand leaderboard | ~$0 |
| Data transfer out | <100 GB → free tier | ~$0 |
| **Total** | | **~$38–45/mo** |

One task means **no HA**: if it crashes, live matches drop until ECS restarts it
(~30–60 s). Fine for a demo.

**Cheaper variants of Scenario A:**

- **AWS Lightsail, $10 plan** (2 GB RAM, 2 vCPU, **3 TB transfer bundled**): run the Node
  server + Caddy (auto-TLS) on the instance. Flat **$10/mo**, bandwidth included, no ALB,
  no egress surprise. Best fit for the prototype.
- **Single EC2 `t4g.small` + Caddy**, no ALB: **~$12–16/mo** on-demand, **~$8–10/mo** with
  a 1-year Compute Savings Plan. Still no HA.
- Keeping the ALB (for a stable DNS target / health checks / future scale-out) is the
  reason Scenario A is ~$40 rather than ~$12 — the ALB's ~$18/mo floor is half the bill.

## Scenario B — small live game

Peak ~300, average 150–200 concurrent. Real multiplayer, multiple rooms, matchmaking.

| Item | Config | $/mo |
| --- | --- | --- |
| Fargate game servers | 3–4 tasks, 1 vCPU / 2 GB, Graviton, target-tracking autoscale | ~$110–160 |
| Application Load Balancer | base + ~5–8 LCU (byte-driven) | ~$45–65 |
| ElastiCache Redis | 1 × `cache.t4g.micro` (lobby / presence / matchmaking) | ~$12 |
| Client hosting | S3 + CloudFront | ~$2–5 |
| Data transfer out | ~1.5–2 TB (see [egress](#the-egress-problem)) | ~$140–180 |
| Route 53 / CloudWatch / ECR / DynamoDB | | ~$15–25 |
| **Total** | | **~$325–450/mo** |

**Data transfer ≈ compute** at this scale. The protocol is worth engineering before you
get here (binary deltas, `permessage-deflate`, don't broadcast unchanged state).

## Scenario C — medium live game

Peak ~1,500, average 800–1,000 concurrent. Included to show how the curve bends —
bandwidth, not compute, dominates.

| Item | Config | $/mo |
| --- | --- | --- |
| Compute | 3–4 × `c7g.large` EC2 (ECS EC2 launch type) + 1-yr Savings Plan | ~$250–400 |
| Load balancer | ALB base + LCU, byte-heavy (consider NLB here) | ~$120–200 |
| ElastiCache Redis | 2 × `cache.t4g.small`, Multi-AZ | ~$50 |
| Data transfer out | ~9–11 TB, tiered ($0.09 → $0.085/GB) | ~$800–950 |
| CloudFront / S3 / Route 53 / CloudWatch / DynamoDB | | ~$40–80 |
| **Total** | | **~$1,300–1,700/mo** |

## The egress problem

Outbound data transfer is the single number that decides the bill past Scenario A, and
it's the one most sensitive to how the delta protocol is written.

**Per-client downstream, back-of-envelope:**

- Room ≤ 8 players. Each tick a client needs every player's delta. Most ticks each player
  just moves one cell → ~1 changed cell + head position.
- Assume ~60 B/player/tick with framing (JSON-ish). Binary encoding gets this to ~15–25 B;
  naive `JSON.stringify` of a bigger patch every tick can be 3–5× worse.
- Per client per tick ≈ 8 × 60 B ≈ 0.5 KB. At 6 Hz → **~3 KB/s ≈ ~11 MB per player-hour.**

**Monthly egress = avg concurrent players × 730 h × ~11 MB:**

| Avg concurrent | Player-hours/mo | Egress/mo | Egress cost (after 100 GB free, ~$0.09/GB) |
| --- | --- | --- | --- |
| 5 | 3,650 | ~40 GB | **~$0** (free tier) |
| 50 | 36,500 | ~400 GB | ~$27 |
| 200 | 146,000 | ~1.6 TB | ~$140 |
| 1,000 | 730,000 | ~7.9 TB | ~$700 |

Caveats that move this a lot:

- **Capture events spike** — a big flood-fill can change hundreds of cells at once. If
  those aren't diffed/coalesced, tail payloads dominate.
- **Idle connections** still cost ALB active-connection LCUs even at ~0 bytes.
- **This is why the plan named Fly.io / Render / Railway.** Fly bundles ~100 GB/mo then
  ~$0.02/GB; Lightsail bundles TB-scale transfer per instance. AWS's $0.09/GB is roughly
  4–5× those. At Scenario B/C volumes the hosting-provider choice is a low-hundreds to
  ~$700/mo line item on its own.

**Levers on egress specifically:** binary protocol; `permessage-deflate`; broadcast only
changed cells; drop broadcast rate to 3–4 Hz for spectators / distant players; interest
management (only send cells near the viewport); consider CloudFront in front of the WS
origin only helps for the static bundle, not the socket.

## Options explicitly ruled out or flagged

- **API Gateway WebSocket API + Lambda** — priced per message (~$1.00/million) +
  connection-minutes (~$0.25/million). At 6 Hz broadcast, 200 concurrent players is
  `200 × 6 × 2.6M s/mo ≈ 3.1 billion` outbound messages → **thousands of dollars/month**
  in message charges alone, before Lambda invocations. The tick loop also doesn't fit
  Lambda's execution model. **Do not use for a high-tick authoritative sim.** (It's fine
  for turn-based or chat-rate games.)
- **AWS App Runner** — no real support for stateful long-lived WebSocket workloads with
  per-room in-memory state; scaling model fights the architecture.
- **EKS** — the control plane alone is ~$73/mo before any nodes; unjustified until far
  past Scenario C.
- **Fargate Spot** — ~60–70% cheaper, but a 2-minute reclaim notice kills every
  in-progress match on that task. Only viable with match-drain / migration logic; not
  worth it early.
- **NAT Gateway** — ~$33/mo + $0.045/GB. Avoidable entirely (public subnets); don't let
  the default VPC wizard add one.
- **Multi-region** — multiplies the fixed costs (ALB + minimum tasks per region) and adds
  cross-region transfer. Defer until latency complaints justify it.

## Levers to cut the bill

| Lever | Saving | Note |
| --- | --- | --- |
| Graviton (arm64) for Fargate/EC2 | ~15–20% compute | Node runs on arm64 unmodified |
| Compute Savings Plan, 1-yr no-upfront | ~28% compute | Safe once you have a steady floor of tasks |
| EC2 Reserved / Savings Plan at Scenario C | ~30–40% compute | Switch off Fargate once load is predictable |
| NLB instead of ALB at high throughput | LCU math often cheaper for raw WS bytes | Lose L7 routing / header inspection |
| Lightsail instead of EC2+ALB (Scenario A) | ~$40 → ~$10 | Bundled transfer removes egress risk |
| Binary + compressed deltas | 2–5× on egress | Biggest single win past Scenario A |
| Interest management / lower spectator tick rate | 2–10× on egress | More engineering |
| CloudFront free tier for the client bundle | ~$1–5 | Already assumed above |
| Scale game-server tasks to zero off-peak | compute only | Bandwidth is the cost, so limited upside; also breaks "always joinable" |

## Recommendation

- **Now (Phase 2 deploy of the demo):** don't build the diagram. Run the Node server on a
  **single Lightsail instance ($10/mo, 2 GB, 3 TB transfer)** or a **`t4g.small` EC2 with
  Caddy (~$12–16/mo)**. Static client on **S3 + CloudFront (free tier)**. Leaderboard on
  **DynamoDB on-demand (~$0)**. **All-in ≈ $10–20/month.** This matches the plan's own
  "Fly.io/Render/Railway" instinct — same class of cost.
- **If it gets real traction (Scenario B):** move to **ECS Fargate (Graviton) behind an
  ALB across 2 AZs**, add **one small Redis node** for matchmaking, put a **Compute
  Savings Plan** under the steady task count. Budget **~$350–450/month**, of which
  **~$150 is bandwidth** — spend engineering time on the delta protocol before you spend
  it on infra.
- **Past ~1,000 concurrent (Scenario C):** the bill is **~$1,300–1,700/month and is
  ~55–65% outbound data transfer.** At that point seriously price a host with cheaper
  bundled egress (Fly, Hetzner, bare-metal + Cloudflare) against AWS — the compute is a
  minority of the spend.

## Assumptions

- `us-east-1`, on-demand list prices, mid-2026. Other regions run ~5–20% higher.
- Fargate ≈ $0.04048/vCPU-hr + $0.004445/GB-hr (x86); Graviton ~15–20% lower. 730 h/month.
- ALB ≈ $16.43/mo base + $0.008/LCU-hr; 1 LCU = 3,000 active connections **or** 1 GB/hr
  processed bytes (whichever is highest across dimensions).
- Data transfer out to internet ≈ $0.09/GB for the first 10 TB after a 100 GB/mo free
  allowance; in-region traffic to S3/DynamoDB/ECR treated as free.
- `cache.t4g.micro` ≈ $0.016/hr; `c7g.large` ≈ $0.0725/hr on-demand.
- Client bundle is small and served via CloudFront's always-free tier (1 TB out,
  10M requests/mo).
- Per-player WS downstream modeled at ~11 MB/player-hour (≈0.5 KB/tick, 6 Hz, room ≤ 8).
  Halve it with a binary protocol; double or triple it with naive per-tick JSON and
  un-coalesced capture events.
- No CDN/WAF, no multi-region, no dedicated observability stack (Datadog etc.), no data
  egress for backups.
