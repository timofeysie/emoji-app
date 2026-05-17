# CloudWatch usage (emoji-app on AWS staging)

Billing and quotas treat **metrics** and **logs** as separate products.
If AWS emails say **`Global-CW:MetricMonitorUsage`** or "**X of 10 Metrics**",
that line is **not** counting log bytes — it refers to **metric monitoring**
(see AWS [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)).

---

## What “10 free metrics” usually means on the alert

Exactly what increments **MetricMonitorUsage** varies by AWS account tier,
region rollup, and which features you enabled. In practice AWS Free Tier /
“always free” messaging often advertises roughly **ten metrics** monitored per
month at no charge **before metered billing** for additional metrics kicks in.

- **Important:** Passing **85% ~ 88% ~ 90%** of that allowance only means **you’re
  close to ending the free quota for that SKU** — logs are **still ingested**;
  you mostly risk **charges for extra metrics**, not automatic shutdown of ECS.
- **Verify your account:** Billing → **Cost Explorer** filtered by usage type
   **`METRIC`** / service **CloudWatch** (names change in the console; search
  for “Metric”).
- Canonical reference: **[CloudWatch pricing – Metrics](https://aws.amazon.com/cloudwatch/pricing/)**

Do **not** confuse this with CloudWatch Logs “first N GB free” (different line
items on the bill).

---

## What this Terraform stack uses

Configured under **`infra/terraform/modules/ecs-service/`** (staging wires the
module from **`envs/staging/`** unless you override variables).

### 1. CloudWatch Logs (not the “10 metrics” quota)

| Item | Detail |
| ---- | ------ |
| **Log group** | `/ecs/emoji-staging-task` (default `log_group_name`) |
| **How logs arrive** | ECS task `awslogs` driver → streams `ecs/<task-id>/...` |
| **Retention** | **`log_retention_days`** default **30** days |

Logs are billed as **ingestion + storage**, not usually as plain “metrics” in the
same way as **`MetricMonitorUsage`**. Tune cost with retention, less verbose
logging, and fewer replicas.

Terraform: `aws_cloudwatch_log_group.app` and `task-definition.tf` **`awslogs`**
block.

### 2. Service metrics AWS publishes automatically

You did not have to `PutMetricData` for these — they appear when resources exist:

| Namespace (typical) | Source | Rough purpose |
| ------------------- | ------ | ------------- |
| **`AWS/ApplicationELB`** | Application Load Balancer + target group | Request counts, latency, HTTP codes, healthy host count |
| **`AWS/ECS`** | ECS service / cluster basics | Running task count-style signals (coverage depends on ECS options) |

These help health checks / ops views; billing treatment still follows AWS
pricing (many **standard resolution** AWS service metrics are cheap or included
patterns — **trust your bill**, not this table, for pennies).

Terraform: **`module.alb`**, ECS service attaching to target group.

### 3. Container Insights (often the big metric multiplier)

Terraform default in our module:

- **`enable_container_insights`** default **`true`** on `aws_ecs_cluster.this`.

When **enabled**, Amazon collects **many more** ECS- and task-level aggregated
metrics (CPU, memory, network, lifecycle, etc.) for the console “Container
Insights” experience. That materially increases metric volume compared to “ECS
without Container Insights”. If you hover near AWS’s **published free-tier
metric cap**, this feature is usually the first knob to reconsider for staging.

Docs: **[Container Insights for Amazon ECS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-setup-for-ECS.html)**

Terraform: `cluster.tf` `setting { name = "containerInsights" ... }`; override
via module input **`enable_container_insights = false`** if you accept reduced
ECS observability in exchange for fewer metrics.

---

## Quick “where did my metrics come from?” checklist

In the AWS console:

1. **CloudWatch** → **Metrics** → browse namespaces **`ECS/ContainerInsights`**,
   **`AWS/ECS`**, **`AWS/ApplicationELB`**, **`AWS/ApplicationELBV2`** — see which
   resource names match staging (`emoji-load-balancer`, `emoji-staging-service`,
   etc.).
2. **Billing** → **Bills / Cost explorer** → filter **CloudWatch** / usage type
   containing **`Metric`** to reconcile the alert with real charges.

---

## Cost / quota levers (staging)

| Lever | Effect |
| ----- | ------ |
| **Disable Container Insights** | Fewer ECS metrics (`enable_container_insights`). |
| **Lower log retention** | Fewer billed log-storage GB-months (`log_retention_days`). |
| **Reduce desired task count / noisy logs** | Less log ingestion and duplicated series. |
| **Remove unused alarms / dashboards / custom metrics** | Outside this repo — check account-wide clutter. |

For production you usually **re-enable richer observability** once budget and
quota headroom justify it.

---

## Why the CloudWatch console can feel “empty”

CloudWatch is split into separate areas:

| Console area | What requires setup | Emoji-app staging |
| ------------ | ------------------- | ----------------- |
| **Logs → Log groups → streams** | A log group with recent events | `/ecs/emoji-staging-task` streams appear when tasks run |
| **Logs Insights** | You pick the log group and optionally write a query | Easiest place to search lines |
| **Metrics**, **dashboards**, **alarms** | Metrics collected or alarms defined | ECS/ALB/system metrics exist; dashboards are optional |

So **“empty pages”** usually means you opened **Metrics/Dashboards** expecting text logs, or opened a **log group stream** with **no filter** while most volume is in Insights. **Insights** is normal for ad-hoc digging.

---

## Many `POST /api/status` lines in ECS logs (often several per second)

Those lines are **your app’s HTTP request logger** (see
`server/src/request-logging.middleware.ts`). Each **`POST /api/status`** request
prints **three lines** in production by default:

1. The request line (`POST /api/status`).
2. The body summary (`Request body: (omitted, size=… chars)` — body not logged in production unless **`LOG_HTTP_BODIES`** is enabled).
3. The completion line with status and timing (`POST /api/status - 201 (…)`).

Endpoint implementation: **`server/src/badges.controller.ts`** —
**`POST /api/status`** ingests **Raspberry Pi / badge-controller BLE status**
(controller + badge IDs, connection state). It returns **`201`** on success and
updates in-memory badge state plus WebSockets (see ingestion section of
[**`docs/domains.md`**](../domains.md#post-apistatus)).

So the traffic is **expected** if a **Pi (or any client)** is configured to call
your **public staging URL** on a short interval. Bursts **multiple times in the
same second** usually mean one or more of:

- **Firmware / script polling** very aggressively (heartbeat faster than needed).
- **Multiple devices** calling the same URL.
- **BLE link flapping** (connected / disconnected), if the controller posts on
  every transition.
- A **developer test** pointing at staging.

Health checks from the load balancer use **`GET /api/badges`**, not `POST /api/status`, so **ALB health checks are not what you’re seeing here**.

To reduce log noise and ingestion cost:

- Lower the Pi’s POST rate (or only post on **real** BLE state changes).
- Add **auth** to ingestion routes when you’re ready (still open by design today;
  see [`docs/domains.md`](../domains.md#authentication-status)).
- Optionally relax server logging for that path (code change) if logs stay too chatty.

---

## Related repo paths

| File | Topic |
| ---- | ----- |
| `infra/terraform/modules/ecs-service/cluster.tf` | Container Insights toggle |
| `infra/terraform/modules/ecs-service/log-group.tf` | Log group + retention |
| `infra/terraform/modules/ecs-service/task-definition.tf` | `awslogs` driver |
| `infra/terraform/modules/ecs-service/variables.tf` | **`enable_container_insights`**, **`log_retention_days`** |
