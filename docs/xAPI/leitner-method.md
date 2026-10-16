# Leitner spaced repetition from LRS data

Status: **plan**, not implemented. Builds on the Milestone 1 export
(`xapi-export-plan.md`, `LRS.md`), the player/badge binding model
(`security.md` D2–D4) and the Phase 0 vocab generator
(`docs/games/game-planning.md` → Cheap generator).

Related:

- [`LRS.md`](./LRS.md): statement design, Veracity setup, and the "Open
  point" about cross-game tracking that this plan resolves
- [`xapi-export-plan.md`](./xapi-export-plan.md): Milestone 1 export
- [`security.md`](./security.md): actor = `Player.externalId`, no names in
  the LRS
- [`../games/game-planning.md`](../games/game-planning.md): content/item
  layers, skills, and the `grouping` idea under "xAPI implications"
- `scripts/create-vocab-game.mjs`: the class-game script; it stays as it is
- `server/src/games/generators/vocab-choice.ts`: reading/writing question
  generator, reused here
- `server/src/xapi/statement-builder.ts`, `lrs-client.ts`: export code
- `server/src/players.controller.ts`,
  `client/src/app/views/components/PlayerBindingsPanel.tsx`: how the
  referee identifies players today

---

## Decisions (2026-10-16)

| # | Decision |
| --- | --- |
| L1 | The book ID in learning-object IRIs is **`korean-language-book`**. |
| L2 | **The same word in two chapters is one learning object.** Learning objects are keyed by the word, not by where it appears in the book. |
| L3 | **A wrong answer drops the track one level** (L3 → L2, … L0 stays L0). |
| L4 | Tracking is **per student**. A student's answers change only **that student's** levels. |
| L5 | **Solo only for now.** A Leitner game is made for one student. Multi-player comes later. |
| L6 | The **current class-style game generation keeps working as it is** (`create:vocab-game`, Play Again, manual export). |
| L7 | The **referee identifies the student**, using the same `Player` records as game play. That choice decides the next 10 learning objects. |
| L8 | Leitner games are **single-use**. They're made just before play and not kept for replay. |

---

## Goal

For each student, track every **learning object** (a Korean vocabulary
word to start with, and later grammar patterns or anything else a game
creator decides to test) separately for each **aspect** (reading, writing,
listening, speaking, …). Each `(student, learning object, aspect)` gets a
**proficiency level of 0–3**, plus when it was last seen and how often it
was right or wrong.

When the referee picks a student and a chapter, the server works out that
student's next 10 due learning objects. It then builds a game for them
with the existing reading/writing multiple-choice generator. The game is
played, exported automatically, and thrown away. The levels themselves
live in the LRS as statements.

---

## Scope: solo Leitner games alongside class games

|                    | Class game (today, unchanged)                     | Solo Leitner game (new)                                                               |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Created by         | `create:vocab-game` script                        | Referee in the app ("New Leitner game"), or the `create:leitner-game` script          |
| For                | Whoever joins                                     | **One `Player`**, chosen by the referee                                               |
| Questions          | Random terms from a chapter (seeded)              | That student's next 10 due learning objects                                           |
| Players            | Many badges, bound to players by the referee      | **One badge**, which can only be bound to that player (a swap for a broken badge is allowed) |
| Play Again/Restart | Yes                                               | **No.** Single-use. The next session gets a new game.                                 |
| xAPI export        | Manual (Milestone 1)                              | **Automatic** when the game completes                                                 |
| Kept afterwards    | Yes                                               | **No.** Hidden after a successful export, then purged.                                |
| Statement tagging  | None (statements identical to today)              | Learning object, aspect, game kind                                                    |
| Affects Leitner levels | **No** (v1)                                   | Yes, for that student only                                                            |

Class games stay untagged in v1. Their statements don't change, they
can't touch anyone's levels, and re-exporting old games can't cause a 409.
Counting class-game evidence toward each student's levels is part of the
multi-player phase ([Later](#later)).

---

## Can our LRS setup support this?

**Yes, as the evidence store, with three changes.** An LRS stores and
returns statements. It doesn't schedule, so the Leitner logic is our code,
running over statements read back from the LRS.

| Need | Today | Change |
| --- | --- | --- |
| Know which **learning object** a guess was about, across games and chapters | ❌ Question activity IDs are per game (`…/games/{gameId}/questions/{questionId}`) | Add the word's activity to `context.contextActivities.grouping` on each `answered` statement ([Statement changes](#statement-changes)). This is the fix `LRS.md` → "Open point" already proposes. |
| Know which **aspect** was tested | ❌ Not recorded | Add the `…/ext/aspect` context extension |
| **Read** statements back | ❌ `lrs-client.ts` only `POST`s | Add a standard `GET /statements` query with paging ([Reading from the LRS](#reading-from-the-lrs)) |
| Per-student separation | ✅ `actor.account.name` = `Player.externalId`, and the query filters by `agent` | None. This is what makes L4 hold. |
| Correct/incorrect, and when | ✅ `result.success`, `timestamp` (guess time) | None |
| Volume and API limits | ✅ Hundreds to a few thousand statements per student, against Veracity's 10k calls/day | None |
| Portability | ✅ Standard xAPI resources only, never Veracity's `/aggregate` | None |

**Why the levels are derived from statements and not stored.** Leitner
state is a pure function of one student's `answered` statements. That
means we can change the rules (intervals, what a wrong answer does) and
recompute history without a migration. Voided statements drop out
automatically. It also means **Leitner games can be thrown away after
export (L8)**, because nothing in our database is needed to work out the
next game.

| Option | Verdict |
| --- | --- |
| Derive on demand from `GET /statements` | **Chosen** |
| xAPI **State** or **Agent Profile** resource holding a box document per student | It's standard, but it's mutable state duplicating the statements. Kept as a cache option if queries get slow. |
| A Mongo collection of levels | Splits the truth between two systems |
| Compute from Mongo `Guess` rows | Can't work once Leitner games are purged (L8) |

**Constraint: the LRS only knows about exported games.** For Leitner
games, the export is therefore automatic and is a precondition for
planning the next game ([Game lifecycle](#leitner-game-lifecycle)).

---

## Terms

| Term | Meaning | Pilot example |
| --- | --- | --- |
| **Learning object** | One thing being learned, keyed by its content, not by where it appears | The word `시험` ("test, exam"), whichever chapter it's in |
| **Aspect** | The skill or angle tested on a learning object. It's an open string, chosen by the game creator. | `reading` (Korean → pick meaning), `writing` (English → pick spelling) |
| **Track** | One `(student, learning object, aspect)`. Each track has its own level and schedule. | Player 7F3A × `시험` × `reading` |
| **Level** | Proficiency 0–3 on a track. It is the Leitner box. | — |
| **Due** | The track's next review time has passed | — |

### Aspects

Aspects are independent: knowing `시험` for reading says nothing about
writing it.

| Aspect | Kind | Generator today? | Notes |
| --- | --- | --- | --- |
| `reading` | scored | ✅ `readingItem` | |
| `writing` | scored | ✅ `writingItem` (spelling recognition) | |
| `listening` | scored | ❌ | Deferred until audio exists (`game-planning.md`) |
| `speaking` | scored | ❌ | Deferred until the referee can judge answers |
| `confidence` | **rated** | ❌ | Self-rating, not right or wrong. See [Confidence](#confidence-and-other-rated-aspects). |

**Grammar** fits better as a *kind of learning object* (chapter
`patterns`), with its own aspects such as `recognition` or `production`.
The model doesn't force this, though: a question tagged
`aspect: 'grammar'` gets a track like any other aspect.

---

## The Leitner rules (0–3)

| Level | Meaning | After a correct answer lands on this level, next due in |
| --- | --- | --- |
| **0** | New, or not yet answered correctly | Now (next game) |
| **1** | Correct once | 1 day |
| **2** | Correct twice, at spaced times | 3 days |
| **3** | Proficient | 7 days, then **14 days** per successful review |

The fold applies each answer on a track, oldest first:

1. **Correct and due** → level goes up 1 (it stays at 3 once there).
   `dueAt = answeredAt + interval[newLevel]`.
2. **Correct but not yet due** (extra practice) → no level or schedule
   change. Only the counts are updated. This stops a student reaching L3
   by cramming in one evening.
3. **Incorrect** → **level goes down 1** (L0 stays L0) **(L3)**, and the
   track is **due now**, so the word comes back in the next game whatever
   its new level is. For example, an L3 word answered wrong becomes L2, due
   now. Answering it right next game makes it L3 again, due in 7 days.
4. A track with no statements is L0 and due, but listed as **new**, not
   overdue.

**Grace window:** a track counts as due if `now >= dueAt - 4h`, so a
student who plays every evening, at slightly different times, still gets
yesterday's L1 words.

**Guessing:** with four options, a student who knows nothing is right 25%
of the time. Reaching L3 takes three correct answers on separate due
dates, so the chance of getting there by luck is under 2%. Because wrong
answers only drop one level, a lucky guess also lasts longer than it would
under a reset rule. If L2/L3 inflation shows up in pilot data, require a
fast correct answer to promote (`result.duration` is already recorded).

All intervals, the grace window and `onIncorrect: 'demote'` (the default
under L3; `'reset'` is kept as an option) are in one `LeitnerConfig`.

### Track state

```ts
type TrackState = {
  learningObjectId: string; // 'korean-language-book/vocabulary/시험'
  aspect: string;           // 'reading'
  level: 0 | 1 | 2 | 3;
  dueAt: string | null;     // null = new (never seen)
  lastSeenAt: string | null;
  lastResult: 'correct' | 'incorrect' | null;
  seenCount: number;
  correctCount: number;
  incorrectCount: number;
  chaptersSeen: string[];   // ['27', '29'], for the report only
};
```

---

## Learning-object identity (L1, L2)

A vocabulary learning object is **the word**, normalised:

```
key  = NFC(target).trim(), with internal whitespace collapsed to one space
id   = korean-language-book/vocabulary/{key}         // stored on Question
IRI  = {base}/content/korean-language-book/vocabulary/{encodeURIComponent(key)}
     = https://kogs.link/xapi/emoji-app/content/korean-language-book/vocabulary/%EC%8B%9C%ED%97%98
```

- `시험` in ch. 27 and in ch. 29 is the **same track**. Evidence from a
  ch. 29 game counts when planning a ch. 27 game.
- **Percent-encoded** so the IRI is also a valid plain URI. Some LRSs in
  strict mode reject raw non-ASCII. Step 1's manual test confirms what
  Veracity accepts. Whichever form we pick is **permanent once pilot
  statements exist**, like the base IRI.
- **Duplicates within a chapter** (the same word listed twice) are
  de-duplicated when building the chapter's learning-object list.
- **Homographs** (`배` = pear / ship / stomach) merge into one learning
  object under this rule. That's acceptable for the pilot. If it matters,
  a small override map in the content folder can split a word into
  `배#pear` / `배#ship` keys. This is an open question below.
- The English gloss can differ between chapters. The LRS keeps the latest
  activity `definition.name`, which is harmless, because the key is the
  Korean word.

---

## Statement changes

Only `answered` statements on **tagged questions** change, which in v1
means questions in Leitner games. Untagged questions (all class games,
past and future) produce exactly today's statements.

```json
"context": {
  "registration": "…unchanged…",
  "contextActivities": {
    "parent": [{ "id": "https://kogs.link/xapi/emoji-app/games/6650f…" }],
    "grouping": [
      {
        "id": "https://kogs.link/xapi/emoji-app/content/korean-language-book/vocabulary/%EC%8B%9C%ED%97%98",
        "definition": {
          "type": "https://kogs.link/xapi/emoji-app/activity-types/vocabulary-term",
          "name": { "ko": "시험", "en-US": "test, exam" }
        }
      },
      {
        "id": "https://kogs.link/xapi/emoji-app/content/korean-language-book/ch27",
        "definition": {
          "type": "https://kogs.link/xapi/emoji-app/activity-types/chapter",
          "name": { "ko": "그냥 몸이 좀 안 좋네.", "en-US": "I just don’t feel well." }
        }
      },
      {
        "id": "https://kogs.link/xapi/emoji-app/content/korean-language-book",
        "definition": { "type": "https://kogs.link/xapi/emoji-app/activity-types/book" }
      }
    ]
  },
  "extensions": {
    "…existing game-id / station-name / badge-name…": "…",
    "https://kogs.link/xapi/emoji-app/ext/aspect": "reading",
    "https://kogs.link/xapi/emoji-app/ext/game-kind": "leitner-solo"
  }
}
```

- **Word**: the tracked learning object.
- **Chapter**: the chapter the question came from. Used for reports such
  as "ch. 27 games" in the Veracity viewer.
- **Book**: lets the progress query pull **all** of a student's evidence
  for this book in one filter. Needed because a word is shared across
  chapters (L2), and xAPI's `activity` filter matches exact IDs only.
- **Aspect as an extension**, not part of the activity ID, so the LRS
  sees one activity per word.
- **`game-kind`** marks where evidence came from (`leitner-solo` now, and
  later `class` / `leitner-group`). Standard xAPI can't filter on
  extensions, so the fold filters on it locally. That lets the
  multi-player phase decide whether class evidence counts, without
  changing the statement shape again.
- The `scored` statement is unchanged. A Leitner game's title uses the
  player's **label** ("Player 7F3A"), never the first name, because
  `Game.title` reaches the LRS.

### Plumbing

| Layer | Change |
| --- | --- |
| `Game` model | `kind: 'class' \| 'leitner-solo'` (default `class`, so existing games are unaffected). For Leitner games, `leitner: { playerId, book, chapter, aspects, seed, plannedAt, picks[] }` and `xapiExportedAt`. |
| `Question` model | Optional `learningObjectId`, `aspect`, `learningObjectName: { target, native }`, `chapter` (all immutable) |
| `vocab-choice.ts` | `toQuestionInput` passes these through when an item carries them. Untagged output is unchanged, so `create:vocab-game` is unaffected. |
| `GameDataRepository.getGameExportData` | Returns the new question fields and `game.kind` |
| `statement-builder.ts` | Adds `grouping` and the extensions **only when `learningObjectId` is set**. Specs prove untagged output is byte-for-byte unchanged. |

---

## Reading from the LRS

Add `fetchStatements(config, query)` to `lrs-client.ts`:

```
GET {endpoint}/statements
  ?agent={"objectType":"Agent","account":{"homePage":"https://kogs.link","name":"<externalId>"}}
  &verb=http://adlnet.gov/expapi/verbs/answered
  &activity=https://kogs.link/xapi/emoji-app/content/korean-language-book
  &related_activities=true
  &limit=500
X-Experience-API-Version: 1.0.3
```

- **`agent` is what makes the tracks per student (L4).** Only that
  student's statements are read, so another player's answer can never
  move their levels.
- **Follow `more`** until it's empty. Then **sort locally** by
  `timestamp`, then `id`, because the LRS's default order is `stored`
  (export) time.
- The `emoji-app-server` key already has Read xAPI (`LRS.md` → Step 2).
- No caching in v1. Add `since=` plus a snapshot if it ever gets slow.

---

## Referee flow: identifying the student (L7)

The referee already identifies players in the app: `Player` records
(first name, shown only inside our app) are listed by `GET /api/players`
and bound to badges in `PlayerBindingsPanel`. The Leitner flow reuses
both:

1. **Games → New Leitner game.** The referee picks the **student** from
   the same player list (the same `Select` as the bindings panel, showing
   first name and label), picks the **chapter** (ch. 27 for the pilot),
   and optionally the aspects (default reading + writing).
2. The app shows the **plan**: the student's progress table and the 10
   picks with the reason for each (`overdue` / `new` / `practice`). This
   is `POST /api/leitner-games` with `dryRun: true`.
3. **Create** sends the same request without `dryRun`. The server re-plans
   (the result is the same, since the seed is fixed in the dry run's
   response), creates the game, and opens it in edit mode as usual.
4. **Join**: the student's badge joins, and the bindings panel offers only
   that student. The server rejects binding any other player
   (`PUT …/player-bindings/:badge` → 400 for a `leitner-solo` game whose
   `leitner.playerId` doesn't match) and allows only one active binding at
   a time. A `swap` to a new badge for the same student still works.
5. Play runs exactly as today.

Creating a new Leitner game for a student **supersedes** any of their
Leitner games that haven't been played yet (no guesses): those are
deleted, because their plan is stale.

### API

```
GET  /api/players/:playerId/progress?book=korean-language-book&chapter=27
→ { player: { id, label }, asOf, statementCount,
    tracks: TrackState[],              // the chapter's words × aspects, new ones included
    pendingExport: [{ gameId, endedAt, error? }] }

POST /api/leitner-games
  { playerId, book: 'korean-language-book', chapter: 27,
    aspects?: ['reading','writing'], count?: 10, maxNew?: 4, fill?: true,
    seed?, now?, dryRun? }
→ 200 (dryRun) { plan: { picks[], report, seed } }
→ 201          { gameId, plan }
→ 409          { error: 'Previous Leitner game not exported yet', pendingExport }
```

Both are referee-only once Step 0 auth lands, like the other player
routes. Because the server reads the LRS, each environment uses its own
LRS: staging reads `emojiapp-pilot`, local reads `emojiapp-dev`.

### Content on the server

Planning now runs on the server, so chapter files must be available at
runtime. Copy `language-learning-app/public/chapter27Data.json` to
`server/src/games/content/` (emoji-app owns its copy; `game-planning.md` →
Storage decision). Make sure the build ships it: either import it as a
module with `resolveJsonModule`, or add a copy step to `build:server` and
the Docker build. A small `content/index.ts` registry maps
`(book, chapter) → file`.

---

## Leitner game lifecycle (L8)

```
planned ──create──▶ lobby/ready/playing ──complete──▶ auto-export ──ok──▶ exported ──purge──▶ (gone)
   │                                                      │
   └─superseded by a new plan (no guesses)─▶ deleted      └─fails──▶ pending export (retry button; blocks next plan)
```

- **Single-use.** Play Again / Restart are hidden in the UI and rejected
  by the server (`setGameState` → 400 for a `leitner-solo` game going back
  to `lobby`). Replaying would mix one plan's questions into a later
  schedule.
- **Auto-export on completion.** The completion handler calls the same
  code as `POST /games/:id/xapi-export`, only for `leitner-solo` games.
  Class games keep manual export (Milestone 1). On success it sets
  `xapiExportedAt`.
- **Export blocks the next plan.** If a student's last Leitner game hasn't
  been exported, `POST /api/leitner-games` returns 409 and the app shows
  **Retry export**. Planning on stale levels would re-ask words the
  student just answered.
- **A game abandoned mid-way**: the referee **ends** it, which completes
  it, exports the guesses made so far, and lets the unanswered words come
  back in the next plan.
- **Purge after export.** Exported Leitner games are hidden from the game
  list right away and deleted (game, questions, options, guesses,
  bindings) by a cleanup after **7 days**, kept briefly for
  troubleshooting. The LRS holds the evidence, and Leitner state never
  needs the local copy.
- Deleting local rows doesn't touch the LRS. That's still covered by the
  per-actor deletion questions in `LRS.md` and `security.md`.

---

## Choosing the next learning objects

Pure functions in `server/src/learning/leitner.ts`: `foldTracks`
(statements → `TrackState[]`) and `planNextGame`.

```ts
planNextGame({
  objects: LearningObject[],   // the chapter's words, de-duplicated by key
  aspects: ['reading', 'writing'],
  tracks: TrackState[],        // this student's, from the LRS, all chapters
  now, count: 10, maxNew: 4, fill: true, seed, config: LeitnerConfig,
}) → { picks: { learningObjectId, aspect, reason: 'overdue' | 'new' | 'practice' }[], report }
```

Candidates are the chapter's words × aspects. A track with evidence from
another chapter keeps its level (L2). Pick in this order:

1. **Overdue**: level ascending (shakiest first), then oldest `dueAt`.
2. **New**, up to `maxNew`, in chapter order, so the student meets words
   the way the book introduces them.
3. **Practice** fill, if still short of `count`: not-yet-due tracks,
   lowest level first, then soonest `dueAt`. Correct answers here don't
   promote (rule 2). With `fill: false` the game is shorter instead.

Constraints:

- **One aspect per word per game.** A reading question for `시험` shows
  `test` as an option, which gives away a writing question for `test`.
- **Skip a pick that can't be built** (e.g. `writingItem` can't make three
  misspellings) and take the next candidate. Report it.
- **Deterministic**: the same tracks, `now` and seed give the same game.
  The default seed comes from `playerId` + date, and it's returned and
  stored on `game.leitner.seed`.

Question building uses a new `generateVocabQuizForPicks({ terms, picks,
seed })` in `vocab-choice.ts`, which calls the existing `readingItem` /
`writingItem`. Distractors still come from the whole chapter. The
question order is shuffled with the seed so aspects interleave.

With 14 words × 2 aspects = 28 tracks, a new student gets 4 new words per
game, plus practice. As levels rise, more of each game is review.

---

## The `create:leitner-game` script

Building on the existing script workflow, `scripts/create-leitner-game.mjs`
is a thin client of the same endpoint, so the app and the script always
make the same game:

```
npm run create:leitner-game -- --player <playerId|externalId> [options]

--chapter <n>      default 27
--book <key>       default korean-language-book
--aspects <list>   reading,writing (default)
--count <n>        default 10
--max-new <n>      default 4
--no-fill
--seed <n>         default: server-derived (printed)
--now <iso>        pretend it's this time (testing the schedule)
--server <url>     default http://localhost:3000
--report           progress table only
--dry-run          progress table + planned questions, create nothing
```

It takes a player ID, not a first name, to keep names out of shell
history. `create-vocab-game.mjs` is **not changed** (L6).

Example `--dry-run` output:

```
Player 7F3A · korean-language-book ch. 27 · as of 2026-10-16 09:00 · 84 statements
                 reading            writing
정도 level       ●●○ L2 due 10-18   ●○○ L1 due today
시험 test        ●●● L3 due 10-29   ●●○ L2 due now ✗ (also ch. 29)
수업 class       new                new
…
Picked 10: 3 overdue, 4 new, 3 practice   (seed 20261016)
```

---

## Confidence and other rated aspects

This is deferred until after v1. Confidence isn't right or wrong:

- Ask it **with the existing hardware**: "How sure are you about 시험?",
  cards A–D = 0–3.
- Record it as an `answered` statement with `aspect: 'confidence'` and
  the rating in `result.score.raw`, with no `result.success`. It's still
  `choice` on the wire; the authored `likert` type goes in an extension.
- The track's level is the **latest rating**, with no schedule. The
  planner uses it as a tie-breaker (at equal level, ask low-confidence
  words first).

Aspects are registered as `{ name, kind: 'scored' | 'rated' }`. Unknown
aspects default to `scored`.

---

## Steps

### Step 1: Tag Leitner questions (no behaviour change for class games)

- [ ] Copy `chapter27Data.json` into `server/src/games/content/`, add the
      content registry, and make sure the build and Docker image ship it.
- [ ] Learning-object key/IRI helpers (normalise, percent-encode), with
      specs including spaces and duplicates.
- [ ] `Game.kind` (default `class`) and `Game.leitner`; `Question`
      learning-object fields.
- [ ] `statement-builder.ts`: `grouping` (word, chapter, book) and the
      `aspect` / `game-kind` extensions, only when tagged. Specs prove
      untagged output is unchanged.
- [ ] Manual: a tagged test game exported to `emojiapp-dev` with Strict
      API Mode on is accepted, and the encoded IRIs show in the viewer.

### Step 2: Read path and progress

- [ ] `fetchStatements` with `more` paging (mocked-`fetch` spec).
- [ ] `foldTracks` + `LeitnerConfig`, with specs for each rule: promote
      when due, no promotion when not due, **demote one and due now**, L0
      floor, L3 reviews, grace window, out-of-order input, other
      `game-kind`s ignored, the same word from two chapters folds into one
      track.
- [ ] `GET /api/players/:playerId/progress`.

### Step 3: Planner, game creation, lifecycle

- [ ] `planNextGame` specs: priority order, `maxNew`, one aspect per word,
      skip-and-replace, fill/no-fill, determinism, cross-chapter levels.
- [ ] `generateVocabQuizForPicks`.
- [ ] `POST /api/leitner-games` (dry run, create, 409 when an export is
      pending, superseding unplayed games).
- [ ] Binding guard for `leitner-solo` games; reject Play Again / Restart.
- [ ] Auto-export on completion, `xapiExportedAt`, retry, hide and purge
      after 7 days.
- [ ] `scripts/create-leitner-game.mjs` + npm script.

### Step 4: Referee UI

- [ ] "New Leitner game": student picker (reuses the player list), chapter,
      plan preview, Create.
- [ ] Game detail for `leitner-solo`: student shown, Play Again hidden,
      export status / Retry export.

### Acceptance

On `emojiapp-dev` with one test student:

1. The plan for a new student shows 28 new tracks and picks 4 new words
   plus 6 practice.
2. Play the game with a few wrong answers. It **auto-exports** and drops
   out of the game list.
3. The next plan shows correct tracks at L1 (due tomorrow) and wrong ones
   still at L0, due now. With `now` = tomorrow, it plans the L0/L1 tracks
   first.
4. A track at L2 answered wrong shows **L1, due now**.
5. A second test student's plan is unaffected by step 2 (L4).
6. `create:vocab-game` and a class game with Play Again and manual export
   still behave exactly as before, and their exported statements are
   unchanged (L6).

### Later

- **Multi-player Leitner** (L5): one game for a small group. Each guess
  still updates only its own student's tracks, because statements are per
  actor. The planner picks the words most due across the group, and each
  badge is bound to one of the group's students. Decide then whether
  class-game evidence (`game-kind: class`, once class games are tagged)
  counts toward levels.
- Confidence (above), then listening and speaking when their generators
  exist.
- Grammar: chapter `patterns` as learning objects, using
  `pattern.cloze.ending` from `game-planning.md`.
- Optionally write level changes to the LRS (e.g. ADL `mastered` at L3)
  so proficiency shows on Veracity dashboards. These would use idempotent
  UUID v5 IDs seeded from the triggering statement.
- When the content library (`game-planning.md` Phase 1) lands, a vocab
  `ContentItem` gets the same word key, so the IRIs don't change.

---

## Open questions

- **Homographs.** Is merging `배` (pear/ship/stomach) into one learning
  object acceptable for the pilot, or do we need the override map from
  day one?
- **Raw or percent-encoded Hangul in IRIs.** The plan is percent-encoded.
  Confirm Veracity's strict mode accepts both and choose before pilot
  statements exist, because the choice is permanent.
- **Purge window.** Is 7 days right, or should exported Leitner games be
  deleted right away?
- **Chapter scope.** Should a ch. 27 game only ask ch. 27 words, or also
  pull due words from earlier chapters (e.g. a "review all due" option)?
  The tracks already support it; it's just a planner option.
- **Speed.** Should a correct but slow answer (> N s) count as "correct,
  not promoted"? `result.duration` is recorded, so this can be decided
  later and recomputed.
