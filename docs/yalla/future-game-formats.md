# Game formats: one "create a game" flow for every input (future plan)

Status: **future improvement, not scheduled** (added 2026-10-30). Start it
after YALLA Phase 1 (milestones Y1–Y6 in
[`implementation-plan.md`](./implementation-plan.md)). It's on the roadmap
in [`../server/milestones.md`](../server/milestones.md#feature-roadmap-learning).

Related:

- [`implementation-plan.md` §6 → Game formats and input channels](./implementation-plan.md#game-formats-and-input-channels): the terms and the YALLA v1 formats this builds on
- [`../xAPI/leitner-method.md`](../xAPI/leitner-method.md): Leitner rules, aspects, L23 (`yalla-solo` counts, `ext/input-channel`)
- [`../xAPI/security.md`](../xAPI/security.md): D5 (device route prefix and credentials), D14 (users practising as a player)
- [`../games/game-planning.md`](../games/game-planning.md), [`../games/game-flow.md`](../games/game-flow.md): how badge games are planned and run today

---

## Idea

Today, **how a learner answers is fixed by the kind of game**:

| Game | Created from | How answers come in |
| --- | --- | --- |
| Class badge game | Games → New game (`POST /api/games`) | NFC cards at badge stations |
| Leitner badge game | New Leitner game dialog (`POST /api/leitner-games`) | NFC cards at the student's badge station |
| YALLA session | YALLA → Exercises (`POST /api/yalla/me/sessions`, Y4) | On-screen A–D or keyboard, chosen per aspect |

The future version has **one "create a game" flow** in which the input is
just another option. Badge games become **formats** too (`nfc-card` for
every aspect), alongside YALLA's `onscreen-choice` and `keyboard`. New
inputs (other sensors, voice, handwriting) are added as **input channels**
without a new kind of game each time.

## What a format is

A **game format** is a reusable recipe:

| Part | Choices (today → later) |
| --- | --- |
| **Who plays** | one learner (solo) · a class |
| **Where** | badge stations · the web/mobile app · mixed (later) |
| **What is asked** | content scope (book, chapter, review) and **aspects** (reading, writing → listening, speaking) |
| **How it's scheduled** | Leitner plan (`planNextGame`) · a fixed question list (class games) |
| **Input channel per aspect** | `nfc-card` · `onscreen-choice` · `keyboard` → new channels |

Saved formats are **templates**. Examples:

- "Badge Leitner": solo, stations, Leitner, `nfc-card` for reading and writing.
- "Typed writing drill": solo, app, Leitner, `keyboard` for writing.
- "YALLA default": solo, app, Leitner, `keyboard` for writing,
  `onscreen-choice` for reading.

## Input channels

A small registry says what each channel can do. The create flow only offers
channels that fit the chosen aspect and place.

| Channel | Response format (xAPI `interactionType`) | Runs on | Status |
| --- | --- | --- | --- |
| `nfc-card` | `choice` | badge station + NFC cards | ✅ badge games |
| `onscreen-choice` | `choice` | web/mobile app | YALLA Y4 |
| `keyboard` | `fill-in` | web/mobile app | YALLA Y5 |
| button box / other station sensors (tilt, buttons, motion) | `choice` | a station | idea |
| microphone + speech recognition | `fill-in` (and a future `speaking` aspect) | app or station | idea; needs a scoring decision |
| handwriting pad / stylus | `fill-in` (writing) | app (tablet) | idea |
| audio playback (prompt side, for `listening`) | — | app or station speaker | idea; needs audio content |

Each answer already records its channel in `ext/input-channel` (L23,
starting in YALLA Y4, with badge games sending `nfc-card`). So evidence
from new channels works with the Leitner fold from day one, and the fold
can weight channels differently later if that turns out to matter.

## The single create flow (sketch)

```
1. Learner(s)        pick a player (solo) or a class
2. Content           book → chapter → scope (chapter / review)
3. Aspects           reading, writing, …
4. Input per aspect  channel picker, filtered by aspect and by what's available
                     (live stations? signed-in learner on the app?)
5. Schedule          Leitner plan or fixed questions
6. Save as template? (optional)
→ creates either a badge Game (stations, bindings, card group, as today)
  or an app session (YALLA), or both for a mixed format
```

The **planner is shared** (YALLA Y4 factors `LeitnerPlanner.plan` out of
`createLeitnerGame`), so this is mostly a new front end over existing
planning, plus a "where does it run" step at the end.

## Prerequisites

- YALLA **Y4–Y5** done: `ext/input-channel` on all statements, the format
  model `{ aspect → channel }`, the shared planner.
- `Game` gets a `format` field next to `kind` (or `kind` is derived from the
  format). Existing games read as their current kind.
- **New station sensors need device credentials** (security.md D5,
  deferred with Step 0). A sensor channel that can submit answers must not
  be spoofable, for the same reason as today's devices.

## Open questions

1. **Mixed formats**: in one game, can some aspects come in by NFC at a
   station and others typed on a tablet beside it? That would need one game
   with two kinds of input arriving in real time (Milestone 6 room
   channel).
2. **Class games and Leitner**: should class games stay outside the
   Leitner count (`countedGameKinds`), or could a class format opt in per
   student?
3. **Speaking and listening**: which channel and which scoring rule (speech
   recogniser vs. referee judgement) make a `speaking` answer `direct`
   evidence?
4. **Templates**: who can create and share them: each user, the referee,
   or an organisation (security.md D8)?

## Rough milestones (to refine when scheduled)

| # | Milestone |
| --- | --- |
| F1 | Channel registry + `Game.format`; badge games described as formats (no visible change) |
| F2 | Single create flow for solo games (badge Leitner and YALLA from one dialog) |
| F3 | Saved templates |
| F4 | First new sensor channel at a station (with device credentials) |
| F5 | Class games through the same flow; mixed formats if question 1 says yes |
