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
- `scripts/create-vocab-game.mjs`: the class-game script, which stays as it is
- `server/src/games/generators/vocab-choice.ts`: the reading/writing question
  generator, reused here
- `server/src/xapi/statement-builder.ts`, `lrs-client.ts`: export code
- `server/src/players.controller.ts`,
  `client/src/app/views/components/PlayerBindingsPanel.tsx`: how the
  referee identifies players today

---

## Decisions

| # | Date | Decision |
| --- | --- | --- |
| L1 | 2026-10-16 | The book ID in learning-object IRIs is **`korean-language-book`**. |
| L2 | 2026-10-23 (revised) | A learning object is a **word in one meaning (sense)**. The same word with the same meaning in two chapters is **one** learning object. The same spelling with different meanings (`배` = pear / ship / stomach) is **separate** learning objects. The **source** where the student met the word (book, chapter, section) decides which meaning it is, so every encounter records its source. |
| L3 | 2026-10-16 | **A wrong answer drops the track one level** (L3 → L2, … L0 stays L0). |
| L4 | 2026-10-16 | Tracking is **per student**. A student's answers change only **that student's** levels. |
| L5 | 2026-10-16 | **Solo only for now.** A Leitner game is made for one student. Multi-player comes later. |
| L6 | 2026-10-16 | The **current class-style game generation keeps working as it is** (`create:vocab-game`, Play Again, manual export). |
| L7 | 2026-10-16 | The **referee identifies the student**, using the same `Player` records as game play. That choice decides the next 10 learning objects. |
| L8 | 2026-10-16 | Leitner games are **single-use**. They're made just before play and not kept for replay. |
| L9 | 2026-10-23 | IRIs use **percent-encoded** Hangul, the safest choice for interoperability. |
| L10 | 2026-10-23 | Exported Leitner games are **deleted right away** after a successful export. |
| L11 | 2026-10-23 | When starting a game, the referee chooses the **scope**: **this chapter only**, or **this chapter plus due words from earlier chapters**. |
| L12 | 2026-10-23 | **Speed doesn't matter for now.** A correct answer counts and promotes however long it took. |
| L13 | 2026-10-23 | A track at **L3 that passes a question is retired** and never appears in a future game. |
| L14 | 2026-10-23 | With review scope, earlier-chapter words **compete freely** with the current chapter by level and due date. There's no cap for now. |
| L15 | 2026-10-23 | **"Earlier chapters"** means **any other chapter of the book the student has already played**, whatever its number. Chapters can be played out of order. |

---

## Goal

For each student, track every **learning object** (a Korean vocabulary
word in one meaning to start with, and later grammar patterns or anything
else a game creator decides to test) separately for each **aspect**
(reading, writing, listening, speaking, …). Each `(student, learning
object, aspect)` gets a **proficiency level of 0–3**, plus **retired**
once it's been passed at L3, along with when and where it was last seen
and how often it was right or wrong.

When the referee picks a student, a chapter and a scope, the server works
out that student's next 10 due learning objects. It then builds a game for
them with the existing reading/writing multiple-choice generator. The game
is played, exported automatically, and deleted. The levels live in the
LRS as statements.

---

## Scope: solo Leitner games alongside class games

|                    | Class game (today, unchanged)                     | Solo Leitner game (new)                                                               |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Created by         | `create:vocab-game` script                        | Referee in the app ("New Leitner game"), or the `create:leitner-game` script          |
| For                | Whoever joins                                     | **One `Player`**, chosen by the referee                                               |
| Questions          | Random terms from a chapter (seeded)              | That student's next 10 due learning objects, from this chapter or this chapter + review |
| Players            | Many badges, bound to players by the referee      | **One badge**, which can only be bound to that player (a swap for a broken badge is allowed) |
| Play Again/Restart | Yes                                               | **No.** Single-use. The next session gets a new game.                                 |
| xAPI export        | Manual (Milestone 1)                              | **Automatic** when the game completes                                                 |
| Kept afterwards    | Yes                                               | **No.** Deleted as soon as the export succeeds (L10).                                 |
| Statement tagging  | None (statements identical to today)              | Learning object, source, aspect, game kind                                            |
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
| Know which **learning object** a guess was about, across games and chapters | ❌ Question activity IDs are per game (`…/games/{gameId}/questions/{questionId}`) | Add the learning object's activity to `context.contextActivities.grouping` on each `answered` statement ([Statement changes](#statement-changes)). This is the fix `LRS.md` → "Open point" already proposes. |
| Know the **source** and the **aspect** | ❌ Not recorded | Chapter grouping plus the `…/ext/source-ref` and `…/ext/aspect` extensions |
| **Read** statements back | ❌ `lrs-client.ts` only `POST`s | Add a standard `GET /statements` query with paging ([Reading from the LRS](#reading-from-the-lrs)) |
| Per-student separation | ✅ `actor.account.name` = `Player.externalId`, and the query filters by `agent` | None. This is what makes L4 hold. |
| Correct/incorrect, and when | ✅ `result.success`, `timestamp` (guess time) | None |
| Volume and API limits | ✅ Hundreds to a few thousand statements per student, against Veracity's 10k calls/day | None |
| Portability | ✅ Standard xAPI resources only, never Veracity's `/aggregate` | None |

**Why the levels are derived from statements and not stored.** Leitner
state, retirement included, is a pure function of one student's
`answered` statements. That means we can change the rules and recompute
history without a migration. Voided statements drop out automatically. It
also means **Leitner games can be deleted right after export (L10)**,
because nothing in our database is needed to work out the next game.

| Option | Verdict |
| --- | --- |
| Derive on demand from `GET /statements` | **Chosen** |
| xAPI **State** or **Agent Profile** resource holding a box document per student | It's standard, but it's mutable state duplicating the statements. Kept as a cache option if queries get slow. |
| A Mongo collection of levels | Splits the truth between two systems |
| Compute from Mongo `Guess` rows | Can't work once Leitner games are deleted (L10) |

**Constraint: the LRS only knows about exported games.** For Leitner
games, the export is therefore automatic and is a precondition for
planning the next game ([Game lifecycle](#leitner-game-lifecycle)).

---

## Terms

| Term | Meaning | Pilot example |
| --- | --- | --- |
| **Learning object** | One thing being learned. For vocabulary, a **word in one sense**. | `시험` meaning "test", whichever chapter it's in |
| **Sense** | One meaning of a word, with a short permanent slug | `배` → `pear`, `ship`, `stomach` |
| **Source** | Where the student met it: book, chapter, section and entry, written as a `sourceRef` | `ch27/vocabulary/1` in `korean-language-book` |
| **Aspect** | The skill or angle tested. It's an open string, chosen by the game creator. | `reading` (Korean → pick meaning), `writing` (English → pick spelling) |
| **Track** | One `(student, learning object, aspect)`. Each track has its own level and schedule. | Player 7F3A × `시험/test` × `reading` |
| **Level** | Proficiency 0–3 on a track. It is the Leitner box. | — |
| **Retired** | The final state after passing at L3. A retired track is never asked again (L13). | — |
| **Due** | The track's next review time has passed | — |

### Aspects

Aspects are independent: knowing `시험` for reading says nothing about
writing it. A word can be retired for reading and still active for
writing.

| Aspect | Kind | Generator today? | Notes |
| --- | --- | --- | --- |
| `reading` | scored | ✅ `readingItem` | |
| `writing` | scored | ✅ `writingItem` (spelling recognition) | |
| `listening` | scored | ❌ | Deferred until audio exists (`game-planning.md`) |
| `speaking` | scored | ❌ | Deferred until the referee can judge answers |
| `confidence` | **rated** | ❌ | Self-rating, not right or wrong. See [Confidence](#confidence-and-other-rated-aspects). |

**Grammar** fits better as a *kind of learning object* (chapter
`patterns`, `sourceRef` `ch27/patterns/0`), with its own aspects, than as
an aspect of a word. The model doesn't force this, though.

---

## The Leitner rules (0–3, then retired)

| Level | Meaning | After a correct answer lands on this level, next due in |
| --- | --- | --- |
| **0** | New, or not yet answered correctly | Now (next game) |
| **1** | Correct once | 1 day |
| **2** | Correct twice, at spaced times | 3 days |
| **3** | Proficient | 7 days |
| **Retired** | Passed a due question at L3 | Never (L13) |

The fold applies each answer on a track, oldest first:

1. **Correct and due, at L0–L2** → level goes up 1.
   `dueAt = answeredAt + interval[newLevel]`.
2. **Correct and due, at L3** → **retired** (`retiredAt = answeredAt`).
   The track is never picked again.
3. **Correct but not yet due** (extra practice) → no level or schedule
   change. Only the counts are updated. This stops a student reaching L3,
   or retiring a word, by cramming in one evening. The planner doesn't use
   L3 tracks for practice fill, so an L3 word's next question is always
   its due review.
4. **Incorrect** → **level goes down 1** (L0 stays L0) **(L3)**, and the
   track is **due now**, so it comes back next game. For example, an L3
   word answered wrong becomes L2, due now. A correct answer next game
   makes it L3 again, due in 7 days, and passing that review retires it.
5. A track with no statements is L0 and due, but listed as **new**, not
   overdue.
6. **Retired is final in v1.** Evidence after retirement (there won't be
   any from Leitner games) is counted but doesn't change the state.
   Bringing a word back is in [Later](#later).

**Speed (L12):** `result.duration` is recorded but ignored by the rules.
A slow correct answer promotes and retires like a fast one.

**Grace window:** a track counts as due if `now >= dueAt - 4h`, so a
student who plays every evening, at slightly different times, still gets
yesterday's L1 words.

**Guessing:** with four options, a student who knows nothing is right 25%
of the time. Retiring a word takes four correct answers on four separate
due dates, so the chance of retiring one by luck is about 0.4%. Because a
wrong answer only drops one level, a word close to retirement can slip
through on a lucky guess. If pilot data shows words being retired too
easily, the fix is a config change (for example, requiring two passes at
L3), and history is simply recomputed.

All intervals, the grace window, `onIncorrect: 'demote'` and the
retirement rule are in one `LeitnerConfig`.

### Track state

```ts
type TrackState = {
  learningObjectId: string; // 'korean-language-book/vocabulary/시험/test'
  aspect: string;           // 'reading'
  status: 'new' | 'active' | 'retired';
  level: 0 | 1 | 2 | 3;     // stays 3 when retired
  dueAt: string | null;     // null when new or retired
  retiredAt: string | null;
  lastSeenAt: string | null;
  lastResult: 'correct' | 'incorrect' | null;
  seenCount: number;
  correctCount: number;
  incorrectCount: number;
  sources: string[];        // where it was asked: ['ch26/vocabulary/6', 'ch27/vocabulary/5']
};
```

---

## Learning-object identity: word, sense and source (L1, L2, L9)

A vocabulary learning object is **one word in one sense**. The **source**
entry (`sourceRef`) decides which sense, using a checked-in **sense
registry** for the book.

```
learningObjectId = korean-language-book/vocabulary/{word}/{sense}
IRI = {base}/content/korean-language-book/vocabulary/{enc(word)}/{sense}

시험 "test, exam"  → …/vocabulary/%EC%8B%9C%ED%97%98/test
배   "pear"        → …/vocabulary/%EB%B0%B0/pear
배   "ship"        → …/vocabulary/%EB%B0%B0/ship
배   "stomach"     → …/vocabulary/%EB%B0%B0/stomach
```

- `word` is `NFC(target).trim()`, with internal spaces collapsed to one.
  `enc` is `encodeURIComponent` on the UTF-8 form (**L9**), so `보여 주다`
  becomes `%EB%B3%B4%EC%97%AC%20%EC%A3%BC%EB%8B%A4`.
- `sense` is an ASCII slug (`[a-z0-9-]`) chosen when the sense is first
  registered, from its first English gloss (`to show` → `to-show`). Every
  word has a sense segment, including words with one meaning, so the IRI
  shape never changes when a second meaning shows up later.
- These IRIs are **permanent once pilot statements exist**, like the base
  IRI.

### The sense registry

`server/src/games/content/korean-language-book-senses.json`, next to the
chapter files and committed to git. Code: `server/src/learning/sense-registry.ts`.

```json
{
  "book": "korean-language-book",
  "words": {
    "시험": [{ "sense": "test", "gloss": "test, exam", "sources": ["ch27/vocabulary/1"] }],
    "보여 주다": [{ "sense": "to-show", "gloss": "to show", "sources": ["ch26/vocabulary/6", "ch27/vocabulary/5"] }],
    "배": [
      { "sense": "pear", "gloss": "pear", "sources": ["ch12/vocabulary/4"] },
      { "sense": "ship", "gloss": "ship", "sources": ["ch19/vocabulary/7"] }
    ]
  }
}
```

(The `배` sources are illustrative. Chapters 26–30 contain no homographs.)

`npm run content:senses` reads every `chapterNNData.json` in the content
folder, in chapter order, and looks at each vocabulary entry not yet
listed by `sourceRef`. `--check` changes nothing and exits 1 if the
registry is out of date, and a spec runs the same check, so a chapter
added without updating the registry fails the tests. Entries are matched
like this:

| Case | Action |
| --- | --- |
| Word not in the registry | Add a new sense automatically, with the slug from the first gloss |
| Word known, and the entry's glosses share a gloss with **exactly one** existing sense (`test, exam` vs `test`) | Add the `sourceRef` to that sense automatically |
| Word known, but **no** gloss overlap, or overlap with several senses | **Stop and ask.** The script prints the candidates and writes nothing. A person edits the registry file, either adding the `sourceRef` to an existing sense's `sources` ("belly" = "stomach") or adding a new sense ("ship"), then runs it again. |
| The same word listed twice in one chapter with the same gloss | Both `sourceRef`s go to one sense (ch. 29 has six such repeats, e.g. `지하철` at entries 14 and 23) |

At runtime, planning and statement building **only look up**
`sourceRef → (word, sense)`. A chapter with any unregistered entry is
refused with a clear error, so a learning object's ID never depends on a
guess made at play time.

Generated for chapters 26–30 (2026-10-23): 155 entries → **146 words,
146 senses**, with no conflicts. Nine entries attached to an existing
sense:
- `보여 주다` and `괜찮다` appear in both ch. 26 and ch. 27 (L2 in practice).
- `타다` appears in ch. 28 ("to ride") and ch. 29 ("to take, to ride").
- Six words are repeated within ch. 29.

There are no same-spelling, different-meaning cases yet.

**Source-data fixes (2026-10-23).** The language-learning-app's ch. 28
had its vocabulary `targetLanguageText` / `nativeLanguageText` swapped
(English as the target) and entry `id`s 346–375. emoji-app's copy is
fixed: Korean is the target and the IDs are 0–29, like every other
chapter. `create:vocab-game` works with ch. 28 now. The
language-learning-app's own file is unchanged. As a guard,
`chapterVocabulary` still detects a swapped entry from where the Hangul
is, reads it the right way round, and the script reports it.

Still open in the source data: ch. 28's `patterns` are an exact copy of
ch. 27's (about getting sick, not taxis). Nothing uses patterns yet, so
fix them before grammar becomes a learning-object kind.

When the content library (`game-planning.md` Phase 1) lands, the registry
becomes `ContentItem` data with the same keys, so the IRIs don't change.

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
        "id": "https://kogs.link/xapi/emoji-app/content/korean-language-book/vocabulary/%EC%8B%9C%ED%97%98/test",
        "definition": {
          "type": "https://kogs.link/xapi/emoji-app/activity-types/vocabulary-sense",
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
    "https://kogs.link/xapi/emoji-app/ext/source-ref": "ch27/vocabulary/1",
    "https://kogs.link/xapi/emoji-app/ext/aspect": "reading",
    "https://kogs.link/xapi/emoji-app/ext/game-kind": "leitner-solo"
  }
}
```

- **Learning object (word + sense)**: what's tracked.
- **Chapter** grouping and the **`source-ref`** extension record where the
  student met it (L2), down to section and entry. `TrackState.sources` is
  built from these.
- **Book**: lets the progress query pull **all** of a student's evidence
  for the book in one filter. This is needed for cross-chapter learning
  objects and review scope, because xAPI's `activity` filter matches exact
  IDs only.
- **`aspect`** is an extension, not part of the activity ID, so the LRS
  sees one activity per learning object.
- **`game-kind`** marks where evidence came from (`leitner-solo` now, and
  later `class` / `leitner-group`). The fold filters on it locally, which
  leaves the multi-player phase free to decide whether class evidence
  counts.
- The `scored` statement is unchanged. A Leitner game's title uses the
  player's **label** ("Player 7F3A"), never the first name, because
  `Game.title` reaches the LRS.

### Plumbing

| Layer | Change |
| --- | --- |
| `Game` model | `kind: 'class' \| 'leitner-solo'` (default `class`, so existing games are unaffected). For Leitner games, `leitner: { playerId, book, chapter, scope, aspects, seed, plannedAt, picks[] }`. |
| `Question` model | Optional `learningObjectId`, `sourceRef`, `aspect`, `learningObjectName: { target, native }` (all immutable) |
| `vocab-choice.ts` | Items carry these fields, and `toQuestionInput` passes them through. Untagged output is unchanged, so `create:vocab-game` is unaffected. |
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
  student's statements are read.
- The whole book comes back in one query, so **both scopes (L11) use the
  same data**. Scope only changes which tracks the planner considers.
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

1. **Games → New Leitner game.** The referee picks:
   - the **student**, from the same player list as the bindings panel
     (first name and label);
   - the **chapter** (ch. 27 for the pilot);
   - the **scope (L11)**:
     - **This chapter only**: only this chapter's learning objects.
     - **This chapter + review**: this chapter, plus due tracks the
       student met in **any other chapter they've already played**
       (L15);
   - optionally the aspects (default reading + writing).
2. The app shows the **plan**: the student's progress table (including
   retired counts) and the 10 picks, each with its reason (`overdue` /
   `new` / `practice` / `review`) and source chapter. This is
   `POST /api/leitner-games` with `dryRun: true`.
3. **Create** sends the same request without `dryRun`. The server re-plans
   with the seed from the dry run, so the result is the same, then creates
   the game and opens it in edit mode as usual.
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
GET  /api/players/:playerId/progress?book=korean-language-book&chapter=27&scope=chapter|review
→ { player: { id, label }, asOf, statementCount,
    tracks: TrackState[],               // in scope; new tracks for this chapter included
    summary: { new, active: { L0, L1, L2, L3 }, retired },
    pendingExport: [{ gameId, endedAt, error? }] }

POST /api/leitner-games
  { playerId, book: 'korean-language-book', chapter: 27,
    scope?: 'chapter' | 'review',       // default 'chapter'
    aspects?: ['reading','writing'], count?: 10, maxNew?: 4, fill?: true,
    seed?, now?, dryRun? }
→ 200 (dryRun) { plan: { picks[], report, seed } }
→ 201          { gameId, plan }
→ 409          { error: 'Previous Leitner game not exported yet', pendingExport }
→ 422          { error: 'Chapter has unregistered vocabulary senses', sourceRefs }
```

Both are referee-only once Step 0 auth lands, like the other player
routes. Because the server reads the LRS, each environment uses its own
LRS: staging reads `emojiapp-pilot`, local reads `emojiapp-dev`.

### Content on the server

Planning runs on the server, and review scope can reach any chapter the
student has played,
so the server needs **every chapter of the book we use** at runtime.
Chapters 26–30 are in `server/src/games/content/`, next to
`korean-language-book-senses.json` (emoji-app owns its copy;
`game-planning.md` → Storage decision). Make
sure the build ships them: either import them as modules with
`resolveJsonModule`, or add a copy step to `build:server` and the Docker
build. A small `content/index.ts` registry maps `(book, chapter) → file`
and `sourceRef → (word, sense)`.

---

## Leitner game lifecycle (L8, L10)

```
planned ──create──▶ lobby/ready/playing ──complete──▶ auto-export ──ok──▶ deleted
   │                                                      │
   └─superseded by a new plan (no guesses)─▶ deleted      └─fails──▶ pending export (Retry; blocks next plan)
```

- **Single-use.** Play Again / Restart are hidden in the UI and rejected
  by the server (`setGameState` → 400 for a `leitner-solo` game going back
  to `lobby`).
- **Auto-export on completion.** The completion handler calls the same
  code as `POST /games/:id/xapi-export`, only for `leitner-solo` games.
  Class games keep manual export (Milestone 1).
- **Delete right away on success (L10).** When the LRS accepts every
  batch (2xx), the server deletes the game, its questions, answer options,
  guesses and bindings in one go. The referee sees a short summary first
  (score, and words promoted, demoted and retired, computed from the
  in-memory statements) so nothing is lost from the session.
- **Export failure keeps the game.** It stays as **pending export**, the
  app shows **Retry export**, and `POST /api/leitner-games` returns 409 for
  that student until it succeeds. Planning on stale levels would re-ask
  words the student just answered. Re-sending is safe because statement IDs
  are stable (`LRS.md` → Idempotency).
- **A game abandoned mid-way**: the referee **ends** it, which completes
  it, exports the guesses made so far, and deletes it. Unanswered words
  come back in the next plan.
- **A crash between export and delete** leaves an exported game that
  wasn't deleted. Retry is harmless (identical re-send → 204), and its
  success then deletes the game.
- Deleting local rows doesn't touch the LRS. That's still covered by the
  per-actor deletion questions in `LRS.md` and `security.md`.

---

## Choosing the next learning objects

Pure functions in `server/src/learning/leitner.ts`: `foldTracks`
(statements → `TrackState[]`) and `planNextGame`.

```ts
planNextGame({
  chapterObjects: LearningObject[],  // this chapter's senses, de-duplicated
  reviewObjects: LearningObject[],   // scope 'review': senses met in other played chapters; else []
  aspects: ['reading', 'writing'],
  tracks: TrackState[],              // this student's, whole book
  now, count: 10, maxNew: 4, fill: true, seed, config: LeitnerConfig,
}) → { picks: { learningObjectId, aspect, sourceRef, reason }[], report }
```

**Candidates** are learning objects × aspects, **excluding retired
tracks**:

- **This chapter only:** this chapter's learning objects. A learning
  object shared with another chapter (`보여 주다`) keeps the level it
  earned there (L2).
- **This chapter + review:** the above, plus **due** tracks for learning
  objects whose sources include **any other chapter the student has
  played** (L15). "Played" comes from the `source-ref` of the student's
  own statements, so it works for chapters played out of order (ch. 29
  before ch. 27). Review only brings back due work. New words always come
  from the current chapter, and other chapters' words aren't used for
  practice fill.

Pick in this order:

1. **Overdue** (this chapter and, with review scope, other played
   chapters): level ascending (shakiest first), then oldest `dueAt`.
   Review words **compete freely** with this chapter's words, with no cap
   (L14). Picks from other chapters are labelled `review`.
2. **New**, up to `maxNew`, from this chapter in chapter order, so the
   student meets words the way the book introduces them.
3. **Practice** fill, if still short of `count`: this chapter's
   not-yet-due tracks at **L0–L2**, lowest level first, then soonest
   `dueAt`. L3 tracks are never used for practice, so their next question
   is the due review that can retire them. With `fill: false` the game is
   shorter instead.

Constraints:

- **One aspect per learning object per game.** A reading question for
  `시험` shows `test` as an option, which gives away a writing question for
  `test`.
- **No other sense of the same word as a distractor.** A reading question
  for `배` (pear) must not offer `ship`.
- **Distractors come from the pick's source chapter** (`sourceRef`), so
  review questions use the vocabulary the student met with that word.
- **Skip a pick that can't be built** (e.g. `writingItem` can't make three
  misspellings) and take the next candidate. Report it.
- **Deterministic**: the same tracks, `now`, scope and seed give the same
  game. The default seed comes from `playerId` + date, and it's returned
  and stored on `game.leitner.seed`.
- **Nothing left to ask**: when every track in scope is retired or not
  due and fill is off or exhausted, the plan comes back short or empty.
  The app then suggests the review scope or the next chapter.

Question building uses a new `generateVocabQuizForPicks({ picks,
termsByChapter, seed })` in `vocab-choice.ts`, which calls the existing
`readingItem` / `writingItem`. The question order is shuffled with the
seed so aspects interleave.

With ch. 27's 14 words × 2 aspects = 28 tracks, a new student gets 4 new
words per game, plus practice. A track needs at least four games over
about 11 days (0 → 1 → 2 → 3 → retired, due after 1, 3 and 7 days) to
retire, so a chapter is worked through in a few weeks of daily play, and
review scope keeps other chapters' due words coming back until they
retire too.

---

## The `create:leitner-game` script

Building on the existing script workflow, `scripts/create-leitner-game.mjs`
is a thin client of the same endpoint, so the app and the script always
make the same game. There's also a `content:senses` script for the sense
registry (see [above](#the-sense-registry)).

```
npm run create:leitner-game -- --player <playerId|externalId> [options]

--chapter <n>      default 27
--book <key>       default korean-language-book
--scope <s>        chapter (default) | review
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

Example `--dry-run --scope review` output:

```
Player 7F3A · korean-language-book ch. 27 · scope: chapter + review · as of 2026-10-23 09:00
                       reading             writing
정도 level             ●●○ L2 due 10-25    ●○○ L1 due today
시험 test              ★ retired           ●●○ L2 due now ✗
보여 주다 to show       ●●● L3 due 10-24    new            (also ch. 26)
수업 class             new                 new
…
ch. 27: 3 new · 20 active · 5 retired     review (ch. 26): 4 due
Picked 10: 3 overdue, 2 review, 4 new, 1 practice   (seed 20261023)
```

---

## Confidence and other rated aspects

This is deferred until after v1. Confidence isn't right or wrong:

- Ask it **with the existing hardware**: "How sure are you about 시험?",
  cards A–D = 0–3.
- Record it as an `answered` statement with `aspect: 'confidence'` and
  the rating in `result.score.raw`, with no `result.success`. It's still
  `choice` on the wire; the authored `likert` type goes in an extension.
- The track's level is the **latest rating**, with no schedule and no
  retirement. The planner uses it as a tie-breaker (at equal level, ask
  low-confidence words first).

Aspects are registered as `{ name, kind: 'scored' | 'rated' }`. Unknown
aspects default to `scored`.

---

## Steps

### Step 1: Content, identity and tagging (no behaviour change for class games)

- [x] Chapters 26–30 in `server/src/games/content/` (identical to the
      language-learning-app copies).
- [ ] Content registry (`(book, chapter) → file`, `sourceRef → (word,
      sense)`), and make sure the build and Docker image ship the JSON.
- [x] `content:senses` script, `sense-registry.ts` and
      `korean-language-book-senses.json` for ch. 26–30. Specs cover new
      word, matching gloss, homograph conflict, hand-resolved homographs,
      in-chapter repeats, the ch. 28 swap, stale entries, and that the
      committed registry is up to date.
- [ ] Learning-object ID/IRI helpers (percent-encode, build the ID/IRI
      from word + sense). `normaliseWord` and `senseSlug` already exist in
      `sense-registry.ts`.
- [ ] `Game.kind` (default `class`) and `Game.leitner`; `Question`
      learning-object fields.
- [ ] `statement-builder.ts`: `grouping` (sense, chapter, book) and the
      `source-ref` / `aspect` / `game-kind` extensions, only when tagged.
      Specs prove untagged output is unchanged.
- [ ] Manual: a tagged test game exported to `emojiapp-dev` with Strict
      API Mode on is accepted, and the percent-encoded IRIs show in the
      viewer.

### Step 2: Read path and progress

- [ ] `fetchStatements` with `more` paging (mocked-`fetch` spec).
- [ ] `foldTracks` + `LeitnerConfig`, with specs for each rule: promote
      when due, no promotion when not due, **demote one and due now**, L0
      floor, **retire on a due pass at L3**, retired is final, no
      retirement from a not-due pass, slow answers count (L12), grace
      window, out-of-order input, other `game-kind`s ignored, one sense
      from two chapters folds into one track, two senses of one word stay
      separate.
- [ ] `GET /api/players/:playerId/progress` with both scopes.

### Step 3: Planner, game creation, lifecycle

- [ ] `planNextGame` specs: priority order, `maxNew`, both scopes (review
      brings only due tracks from other played chapters, including a
      higher-numbered chapter played first, with no cap), retired never picked, L3
      never practice, one aspect per learning object, no same-word
      distractor, skip-and-replace, fill/no-fill, determinism, empty plan.
- [ ] `generateVocabQuizForPicks` with per-source-chapter distractors.
- [ ] `POST /api/leitner-games` (dry run, create, 409 when an export is
      pending, 422 for unregistered senses, superseding unplayed games).
- [ ] Binding guard for `leitner-solo` games; reject Play Again / Restart.
- [ ] Auto-export on completion, an end-of-game summary, **delete on
      success**, pending export with Retry on failure.
- [ ] `scripts/create-leitner-game.mjs` + npm script.

### Step 4: Referee UI

- [ ] "New Leitner game": student picker (reuses the player list),
      chapter, **scope**, plan preview, Create.
- [ ] Game detail for `leitner-solo`: student shown, Play Again hidden,
      export status / Retry export, end-of-game summary (promoted, demoted,
      retired).

### Acceptance

On `emojiapp-dev` with one test student:

1. The plan for a new student (ch. 27, chapter scope) shows 28 new tracks
   and picks 4 new words plus 6 practice.
2. Play the game with a few wrong answers. It **auto-exports and is
   deleted**, and the summary shows what moved.
3. The next plan shows correct tracks at L1 (due tomorrow) and wrong ones
   still at L0, due now. With `now` = tomorrow, it plans the L0/L1 tracks
   first.
4. A track at L2 answered wrong shows **L1, due now**.
5. Driving a track to L3 and passing its due review shows it **retired**.
   It's never picked again in either scope.
6. Words met in a ch. 26 Leitner game appear with **review** scope when
   due, and don't appear with **chapter** scope (except shared words like
   `보여 주다`, which belong to ch. 27 too). The same holds for ch. 29
   words when ch. 29 was played before ch. 27 (L15).
7. A second test student's plan is unaffected (L4).
8. `create:vocab-game` and a class game with Play Again and manual export
   still behave exactly as before, and their exported statements are
   unchanged (L6).

### Later

- **Multi-player Leitner** (L5): one game for a small group. Each guess
  still updates only its own student's tracks, because statements are per
  actor. The planner picks the learning objects most due across the group,
  and each badge is bound to one of the group's students. Decide then
  whether class-game evidence (`game-kind: class`, once class games are
  tagged) counts toward levels.
- **Un-retire**: let the referee bring a retired word back (for example
  after a long break). This needs a statement the fold understands, such
  as a custom `…/verbs/reset` statement for the track, so the state stays
  derived from the LRS.
- Write a `mastered` statement (ADL verb) when a track retires, so
  retirement shows on Veracity dashboards. It would use an idempotent
  UUID v5 ID seeded from the triggering statement.
- Confidence (above), then listening and speaking when their generators
  exist.
- Grammar: chapter `patterns` as learning objects, using
  `pattern.cloze.ending` from `game-planning.md`.
- Speed: revisit L12 with pilot data (`result.duration` is already
  recorded, so any rule can be applied to history).

---

## Open questions

- **Sense registry ownership.** Who answers the "stop and ask" cases when
  a new chapter adds a homograph: the developer importing it, or a teacher
  in a future UI? Undecided. Until then, the developer running
  `content:senses` resolves them by hand.

Resolved: review mix (L14) and what "earlier chapters" means (L15).
