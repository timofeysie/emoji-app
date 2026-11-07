# Moodle / LRS options for the xAPI prototype

Status: **options for consideration** — nothing here is a locked decision.
Pricing and plan details were checked in October 2026 and will drift; confirm
them again before paying for anything.

Related:

- [`xAPI.md`](./xAPI.md) — background, standards landscape, Korean-vocabulary
  pilot scenario
- [`xapi-export-plan.md`](./xapi-export-plan.md) — Milestone 1: emit xAPI
  statements for completed games and deliver them to an LRS (Step 1c is
  where this doc's choice gets made)

---

## TL;DR

- **Moodle is not an LRS.** You can't `POST` xAPI statements from an
  external app to a stock Moodle site and have them show up. Moodle's core
  xAPI library only handles statements from plugins running *inside*
  Moodle (in practice, the core H5P activity). The popular Moodle xAPI
  plugins (Logstore xAPI, TRAX Logs) work in the **opposite direction**:
  they turn Moodle's own logs into xAPI and send them **out** to an LRS.
- So the game should send statements to a **Learning Record Store (LRS)**,
  and Moodle (if we still want it) sits next to that LRS rather than in
  front of it.
- **MoodleCloud** (the official hosted Moodle) costs about $170/yr at the
  cheapest tier, and **you can't install custom plugins on any tier**. That
  rules out every xAPI plugin route, so it's a poor fit for this prototype.
- **Recommended prototype path:** start with a **free hosted LRS** (Veracity
  `lrs.io` free tier or SCORM Cloud's LRS). That needs no setup, and it
  validates Step 1c end to end. Add a **self-hosted Moodle in Docker** only
  if we specifically need to see results inside Moodle.

---

## What "sending xAPI to an LMS" actually requires

xAPI splits responsibilities differently from SCORM:

| Piece | Role | Who provides it |
| --- | --- | --- |
| **Activity provider** | Generates statements | Our game server (`POST /api/games/:gameId/xapi-export`) |
| **LRS** | Stores statements, exposes the standard xAPI REST API (`/statements`, Basic Auth) | Standalone product, or built into some LMSs |
| **LMS** | Courses, enrolments, gradebook, learner-facing UI | Moodle (optional for our pilot) |
| **Reporting** | Dashboards over statements | Usually the LRS's own UI, or a BI tool over it |

Our Milestone 1 delivery client only talks to an **LRS**. The open question
is whether Moodle also needs to show the results, and if so, how.

### Moodle's xAPI support in 2026 (current Moodle is 5.x)

| Mechanism | Direction | Useful to us? |
| --- | --- | --- |
| Core xAPI subsystem (`core_xapi`, since 3.9; xAPI *state* added in 4.2) | Statements from in-Moodle plugins → Moodle events | **Not directly.** It isn't a public LRS endpoint. It could be used by a custom Moodle plugin we write (see Option D). |
| [Logstore xAPI](https://github.com/xAPI-vle/moodle-logstore_xapi) plugin | Moodle logs → external LRS | No. Wrong direction. |
| [TRAX Logs](https://moodle.org/plugins/logstore_trax) / TRAX xAPI Agent | Moodle logs → external LRS | No. Wrong direction. Useful later if we want Moodle activity and game activity in the **same** LRS. |
| [ADL cmi5 launch plugin](https://github.com/adlnet/Moodle-mod_cmi5launch) (`mod_cmi5launch`, Moodle 4.0+) | Moodle launches a cmi5 package; statements go to an external LRS; results feed the Moodle gradebook | Possibly later. It assumes a Moodle *launch*, which conflicts with our hardware-badge constraint (same reasoning as LTI in `xAPI.md`). It also needs a separate cmi5 player service. |
| Moodle web services (REST) | External app → Moodle (users, courses, grades) | Possibly. Pushing a **score** into the gradebook is a different integration from xAPI and needs a self-hosted site with web services enabled. See Option C. |

---

## Options

### Option A — Hosted LRS only (no Moodle yet) ⭐ recommended first step

Point the export at a free hosted LRS and use its built-in statement viewer
and reports. This proves the statement shape and the delivery client
(Step 1c) with essentially zero ops.

| Service | Free tier | Notes |
| --- | --- | --- |
| **[Veracity Learning / lrs.io](https://lrs.io/home/)** | Up to 3 LRSs per account; 100 MB storage (~100k statements); 10k transactions/day | Hosted SaaS. Whether the free tier has dashboards or only a statement viewer is disputed; see [`LRS.md`](./LRS.md). A self-hosted "Learning Lite" edition is also free. |
| **[SCORM Cloud](https://rusticisoftware.com/products/scorm-cloud/pricing/)** (Rustici) | Free trial plan. The LRS for externally generated statements is free and has no statement-volume worry. Content limits (3 courses, 10 registrations) don't affect pure LRS use. | Made by the people behind xAPI. Its statement viewer is a good **conformance check** for our JSON. |

Pros: no servers, minutes to set up, standard endpoint + Basic Auth exactly
as `xapi-export-plan.md` assumes.
Cons: not Moodle, and the data lives with a third party. Fine for a
personal pilot. Statements carry only pseudonymous player IDs, never names
or emails (see `security.md`).

### Option B — Self-hosted open-source LRS

Run our own LRS next to the game server (Docker), still without Moodle.

| LRS | License | Notes |
| --- | --- | --- |
| **[Yet Analytics SQL LRS](https://github.com/yetanalytics/lrsql)** | Apache 2.0 | Lightweight, one container, SQLite/Postgres/MySQL. Has a basic admin UI. Probably the easiest self-hosted choice. |
| **[Learning Locker](https://github.com/LearningLocker/learninglocker)** | GPL 3.0 | Long-standing and still maintained, but a heavier stack (Mongo, Redis, several services). |
| **[TRAX LRS](https://github.com/trax-project)** | Open source (Laravel/PHP) | Pairs naturally with the TRAX Moodle plugins if we later go Moodle-centric. |

Pros: free, data stays with us, and it's easy to reset during development.
Cons: we run it, and the reporting UIs are basic unless we add a BI tool.

### Option C — Self-hosted Moodle + LRS (Moodle shows grades)

Statements still go to an LRS (A or B). Separately, the export **also**
pushes each player's game score into a Moodle course gradebook via Moodle
web services, matching players to Moodle users via a referee-maintained
mapping (players have no email; see `security.md`).

- Hosting choices for Moodle:
  - **[moodle-docker](https://github.com/moodlehq/moodle-docker)**: the
    official MoodleHQ Docker setup. It's aimed at developers, but it's the
    quickest way to get a local Moodle 5.x for a prototype. It needs about
    4 GB RAM (8 GB recommended).
  - A small VPS (DigitalOcean, Lightsail, Hetzner, etc., ~$6–12/month) with
    Docker or a 1-click Moodle image, if others need to reach it.
  - Moodle 5.x needs PHP 8.2–8.4 plus a database (Postgres/MySQL/MariaDB).
- Work on our side: a second delivery client (Moodle REST), a per-game
  mapping to a Moodle course and grade item, and Moodle user accounts for
  each `Player`.

Pros: the teacher or learner sees results where they already work, and
there's no plugin to write.
Cons: we lose detail, because Moodle only sees a score while the LRS keeps
the full statements. It also adds a second integration, which is beyond
Milestone 1's scope. **Verify hands-on** which web-service function can
write grades for an *external* grade item. The obvious one
(`core_grades_update_grades`) is designed around module components and
may need a thin local plugin.

### Option D — Self-hosted Moodle + custom plugin using `core_xapi`

Write a small Moodle plugin that registers an xAPI handler. Our game sends
statements to that plugin's endpoint, and Moodle turns them into events and
grades.

Pros: statements go "into Moodle" directly, with no separate LRS.
Cons: real Moodle plugin development (PHP, Moodle APIs, upgrades). Moodle
still wouldn't be a full LRS: no general statement querying or reporting.
**Not recommended for the prototype.**

### Option E — Moodle + LRS with cmi5 launch

Package each game as a cmi5 course in Moodle (`mod_cmi5launch`). Moodle
launches it, statements flow to the LRS, and results land in the gradebook.

The cmi5 standard is the proper way to tie xAPI to an LMS, but it assumes
the learner launches from the LMS. That conflicts with our referee and
hardware-badge flow, and it needs a cmi5 player service too. **Deferred**,
same as cmi5 in `xapi-export-plan.md`.

### Option F — MoodleCloud (hosted Moodle)

| Plan | Price (approx., USD/yr) | Users | Storage |
| --- | --- | --- | --- |
| Starter | ~$170 | 50 | 1 GB |
| Mini | ~$270 | 100 | 2.5 GB |
| Medium | ~$1,210 | 500 | 20 GB |
| Standard | ~$2,120 | 750 | 50 GB |

The old free MoodleCloud plan no longer exists. **You can't install custom
plugins on any tier**, only a curated pre-installed set, so Options D/E
(and plugin-based reporting) are impossible. Option C might work if web
services are allowed. Good for a "what does a teacher see in Moodle" demo
with manually entered grades. Not useful for xAPI. See
[MoodleCloud product specs](https://www.moodlecloud.com/product-specifications/).

Other managed Moodle hosts (Moodle Partners and third-party hosts) usually
do allow plugins, but they're paid and sized for institutions. They're
overkill for a personal pilot.

**Free demo:** the public Moodle sandbox (`sandbox.moodledemo.net`) resets
regularly and gives no admin control over plugins or web services. It's
only good for clicking around to refresh your Moodle knowledge.

---

## Comparison

| Option | Cost | Setup effort | Moodle visible? | Full xAPI detail kept? | Fits Milestone 1? |
| --- | --- | --- | --- | --- | --- |
| A. Hosted LRS | Free | Minutes | No | Yes | ✅ Yes, exactly |
| B. Self-hosted LRS | Free (+ hosting) | ~1 hour | No | Yes | ✅ Yes |
| C. Moodle + LRS + grade push | Free local / ~$10/mo VPS | Half-day + extra client | Score only | Yes (in LRS) | ⚠️ Extra scope |
| D. Moodle + custom xAPI plugin | Free + dev time | Days | Yes | Partially | ❌ No |
| E. Moodle + cmi5 launch | Free + cmi5 player | Days | Yes | Yes | ❌ Deferred (launch model) |
| F. MoodleCloud | ~$170+/yr | Minutes | Manual grades only | No | ❌ No plugins |

---

## Suggested path

1. **Milestone 1, Step 1c:** deliver to a **free hosted LRS** (Option A).
   **Chosen: Veracity (`lrs.io`).** See [`LRS.md`](./LRS.md) for the
   comparison and the Veracity setup steps. Keep the endpoint and
   credentials in env config so switching LRS is just a config change.
2. **If data ownership or resets matter:** swap in **SQL LRS** in Docker
   (Option B). No code change if Step 1c sticks to the standard xAPI REST
   API.
3. **Only when a teacher pilot needs to see results in Moodle:** stand up
   Moodle via `moodle-docker` or a small VPS and add a gradebook push
   (Option C). Revisit cmi5 (Option E) only if the "LMS launches the game"
   assumption changes.

### Requirements this implies for the game side

- Statements must conform to **xAPI 1.0.3**. Most LRSs also accept xAPI 2.0
  (IEEE 9274.1.1), but 1.0.3 is the safe common denominator. Send the
  `X-Experience-API-Version` header.
- Delivery: `POST {endpoint}/statements` with a JSON array, or `PUT` with a
  statement `id`. **Generating stable statement UUIDs** (e.g. derived from
  `gameId` + `guessId`) makes re-exports safe: the LRS rejects or ignores
  duplicates instead of storing them twice. That would turn the
  "re-running is safe" acceptance criterion into real idempotency for
  little extra work.
- Actor: an `account` with the player's random `externalId`. There's no
  email or name (decided in `security.md` because children may play). If
  we later push grades to Moodle (Option C), email can't be the join key.
  The referee would need to map each player to a Moodle user inside our
  app.
- Activity IDs must be **IRIs** that are stable and globally unique, e.g.
  `https://kogs.link/xapi/emoji-app/games/<gameId>/questions/<questionId>`
  (base IRI decided in `LRS.md`). It's hard to change after statements exist.
- Config: `XAPI_LRS_ENDPOINT`, `XAPI_LRS_KEY`, `XAPI_LRS_SECRET`.

---

## Open questions

- Is seeing results **inside Moodle** a real requirement for the personal
  pilot, or is an LRS dashboard enough until a teacher is involved?
- Is it acceptable for pilot data (pseudonymous player IDs; no names or
  emails, per `security.md`) to live in a
  third-party hosted LRS?
- If a teacher pilot happens, will the school have **its own Moodle**? If
  so, its admins decide which plugins and web services are allowed, which
  could rule out Options C–E regardless of what we build.

---

## Sources (checked October 2026)

- [Moodle developer docs: xAPI subsystem](https://moodledev.io/docs/4.5/apis/subsystems/xapi)
- [Moodle forum: "LRS built into moodle?"](https://moodle.org/mod/forum/discuss.php?d=431169)
- [MoodleCloud product specifications](https://www.moodlecloud.com/product-specifications/) ·
  [MoodleCloud standard plans](https://www.moodlecloud.com/standard-plans/) ·
  [Moodle hosting guide 2026 (cubite.io)](https://cubite.io/blogs/moodle-hosting)
- [TRAX Logs plugin](https://moodle.org/plugins/logstore_trax) ·
  [ADL cmi5 launch plugin](https://github.com/adlnet/Moodle-mod_cmi5launch)
- [Veracity LRS free tier](https://veracity.it/veracity_learning_lite_free_xapi_learning_record_store_lrs) ·
  [lrs.io](https://lrs.io/home/) ·
  [SCORM Cloud pricing FAQ](https://rusticisoftware.com/products/scorm-cloud/pricing/)
- [Yet Analytics SQL LRS](https://github.com/yetanalytics/lrsql) ·
  [Learning Locker](https://github.com/LearningLocker/learninglocker)
- [moodle-docker](https://github.com/moodlehq/moodle-docker) ·
  [Moodle 5.0 requirements](https://moodledev.io/docs/5.0/gettingstarted/requirements)
