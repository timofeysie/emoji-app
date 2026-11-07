# xAPI / LMS integration — exploratory notes

Status: **exploratory** — notes only, no implementation yet. Nothing here is
a locked decision.

Related:

- [`../real-time-game/multi-badge-plan.md`](../real-time-game/multi-badge-plan.md) —
  the game whose activity we'd be exporting
- [`../real-time-game/next-steps.md`](../real-time-game/next-steps.md) —
  overall feature roadmap this would eventually slot into
- [`xapi-export-plan.md`](./xapi-export-plan.md) — the concrete Milestone 1
  plan narrowed out of this doc
- [`LRS.md`](./LRS.md), [`moodle.md`](./moodle.md) — LRS requirements/options
  and why Moodle itself is deferred (see "Working direction" below)
- [`security.md`](./security.md) — privacy and security decisions (referee-only
  login, no emails to the LRS, public/device route split) for when school
  children play

---

## Vision

Use **xAPI** as the canonical event model inside the platform for gameplay
and learning analytics — more detailed than a simple score, and a better fit
for free-form game events than SCORM's run/pass/fail model.

The questions used in the games need to be designed so they can emit this
kind of event (i.e., question/answer/attempt data has to carry enough
structure to become a meaningful xAPI statement, not just a score delta).

From that internal xAPI representation, we could later derive simpler,
narrower outputs for specific integrations:

- LMS gradebook updates via **LTI**
- Assessment exports via **QTI**

We will probably need a mapping layer between our internal model and other
online-learning frameworks (Moodle in particular), and our data model needs
to carry enough detail up front to make that mapping possible later without
re-instrumenting the game.

---

## Standards landscape

Quick glossary of the standards under consideration, and why each would or
wouldn't fit:

| Standard | Role | Notes |
| --- | --- | --- |
| **xAPI** | Canonical internal event model | Detailed gameplay + learning-analytics tracking. Most flexible of the group. |
| **cmi5** | xAPI profile for modern LMS tracking | Gives LMS-standard launch/tracking semantics on top of xAPI. Normally assumes the LMS launches the activity (see constraint below). |
| **SCORM 1.2 / 2004** | Legacy LMS compatibility | For customers on older LMSs that don't support xAPI/cmi5. |
| **LTI 1.3** | LMS-launches-tool + grade passback | **Likely out of scope.** The game needs physical hardware (badges/controllers), so an instructor can't launch a session directly from an LMS the way LTI assumes. Flagged as an assumption, not confirmed. |
| **QTI** | Question/assessment import/export | Lets educators reuse existing question banks instead of re-authoring content. |
| **OneRoster** | Roster sync | Only relevant if targeting K–12, which needs roster sync with the school's SIS. |

### Why not just LTI 1.3 launch?

Since the game requires hardware badges and controllers, we're assuming we
cannot support "instructor launches the game directly from the LMS" the way
LTI 1.3 normally works. This needs confirming once we know more about real
deployment contexts, but for now it's a reason to prioritize xAPI (data
export) over LTI (launch integration).

---

## LMS landscape (2026 research notes)

Starting question: *what are some free LMS options in 2026?*

### Moodle

**Pros**

- Huge ecosystem, large community
- Self-hosted
- Mature REST APIs
- LTI support
- SCORM support
- Easy to customize

**Cons**

- Native xAPI support is limited compared to SCORM
- cmi5 generally requires plugins or external integrations rather than being
  a first-class built-in feature

**Good fit if:**

- Maximum adoption is the goal
- Target is universities or corporate training
- A plugin ecosystem matters

### Existing question content in Moodle

If a customer already uses an LMS like Moodle, they likely have question
banks stored as:

- Multiple choice
- True/False
- Matching
- Short answer
- Essay
- Cloze

These commonly export as **Moodle XML** or **GIFT**, which makes them
straightforward to import into our platform — a much lower-friction path
than asking teachers to author content from scratch.

---

## Canonical question model

Alongside the canonical **event** model (xAPI), we'd want a canonical
**question** model:

- Teachers author or import a question once (e.g., from Moodle XML/GIFT).
- Many different game/learning experiences can then be generated from the
  same underlying content, instead of re-authoring per game.

This pairs with the AI-assisted authoring idea below — questions could be
generated once and reused across multiple game formats.

---

## Use case walkthrough (first real scenario)

The concrete scenario motivating this, in order:

1. **Personal pilot**: learning Korean vocabulary.
2. Use the Hashbrown API to generate questions from source content
   (vocabulary lists, etc.).
3. The AI produces a batch of questions, organized into games.
4. Games get stored (need to confirm: do we already have storage for
   AI-generated games, or does this need building?).
5. Play the games, generating xAPI-shaped activity data.
6. Export that activity to a **Learning Record Store (LRS)**, and use the
   LRS's own dashboard to view the resulting activity statements / track
   progress over time. (Originally imagined as exporting to Moodle; see
   "Working direction" below — Moodle turned out not to be the right fit
   for this step.)

A hoped-for next step beyond the personal pilot: find a teacher willing to
let their class be an early real test.

---

## Open questions

- **Scope vs. timing** — this is a lot of standards work (xAPI + cmi5 +
  SCORM + QTI + OneRoster + a Moodle mapping). What's the minimum real slice,
  and on what timeline? There's no committed external user yet.
- **Unknown game shape** — we don't yet know what the eventual range of
  games will look like, so it's risky to over-build the mapping layer now
  against assumptions that may not hold.
- **Storage** — do we already have a place to store AI-generated games
  (batches of questions assembled by the AI), or is that still to be built?
- **Mapping granularity** — how much Moodle-specific mapping is needed on
  day one vs. deferred until there's a concrete second (non-personal) user?

---

## Working direction (near term)

> **Focus (2026-10-09):** the main goal right now is establishing the
> **rules and play flow of the new "learning sport"**. The xAPI export is
> a supporting slice for the prototype. Security and compliance heavy
> lifting (access-control build-out, parental consent, Australian
> hosting, deletion, ST4S, SOC 2) is deferred until the prototype is
> funded. See `security.md` → Phasing.

Given the open questions above, the plan is to **defer** most of this
(cmi5, SCORM, QTI, OneRoster, LTI, and — per `moodle.md` — Moodle itself)
until there's a real pilot beyond personal use.

The concrete near-term step: **export recorded game activity as xAPI
statements to a Learning Record Store (LRS)**, viewed through that LRS's
own dashboard — not Moodle. `moodle.md` found that a stock Moodle site
isn't itself an LRS (no endpoint accepts externally-generated statements)
and would need extra integration work (gradebook push, a custom plugin, or
a cmi5 launch) to show results at all; none of that is justified before a
real pilot exists. `LRS.md` picks the LRS (**Veracity**, `lrs.io` free
plan) and covers its setup and the statement-design detail; `xapi-export-plan.md` is the resulting Milestone 1 plan, validated
first against the personal Korean-vocabulary use case. Everything else in
this document is future scope, not a current commitment.
