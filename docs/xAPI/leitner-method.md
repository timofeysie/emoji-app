# Leitner spaced repetition from LRS data

Status: Steps 1–2 **built** (content, identity, tagging, read path,
progress), Steps 3–4 **planned**. Identity and statements follow
[`learning-objects.md`](./learning-objects.md) decisions A1–A3 (L16–L18).
Builds on the Milestone 1 export
(`xapi-export-plan.md`, `LRS.md`), the player/badge binding model
(`security.md` D2–D4) and the Phase 0 vocab generator
(`docs/games/game-planning.md` → Cheap generator).

Related:

- [`LRS.md`](./LRS.md): statement design, Veracity setup, and the "Open
  point" about cross-game tracking that this plan resolves
- [`xapi-export-plan.md`](./xapi-export-plan.md): Milestone 1 export
- [`learning-objects.md`](./learning-objects.md): parts and wholes
  (phrases, grammar, sentences, competencies). Its decisions A1–A3
  (language-scoped IRIs, `assessed` statements, kind in the IRI) are
  adopted here as L16–L18.
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
| L16 | 2026-10-23 | **Learning-object identity is language-scoped** (`learning-objects.md` A1): `ko/lexeme/시험/test`, IRI `{base}/lo/ko/lexeme/%EC%8B%9C%ED%97%98/test`. The book, chapter and entry are **provenance** only (grouping and `ext/source-ref`), so the same sense taught by two books is one track. The sense registry is per language (`ko-senses.json`). This narrows L1: the book ID names provenance, not learning objects. |
| L17 | 2026-10-23 | **Evidence is `assessed` statements** (`learning-objects.md` A2). Each tagged guess gives one `answered` statement (what happened) plus one `assessed` statement per observation (what it shows), about the learning object itself. The fold reads **only** `assessed`. Today's scorer, `choice-whole@1`, gives one direct observation on the whole. |
| L18 | 2026-10-23 | **The kind is part of the identity** (`learning-objects.md` A3): `lexeme` (one word in one sense, activity type `…/activity-types/lexeme-sense`) or `expression` (multi-word entry, `…/activity-types/expression`). The registry stores it per sense; new senses default to `expression` when the word contains a space. |

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
| Statement tagging  | None (statements identical to today)              | Learning object, source, aspect, game kind, plus an `assessed` statement per guess (L17) |
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
| Know which **learning object** a guess was about, across games, chapters and books | ❌ Question activity IDs are per game (`…/games/{gameId}/questions/{questionId}`) | Add the learning object's activity to `grouping` on each `answered` statement, and send an `assessed` statement whose **object is the learning object** ([Statement changes](#statement-changes)). This is the fix `LRS.md` → "Open point" already proposes. |
| Know the **source** and the **aspect** | ❌ Not recorded | Chapter grouping plus the `…/ext/source-ref` and `…/ext/aspect` extensions |
| **Read** statements back | ❌ `lrs-client.ts` only `POST`s | Add a standard `GET /statements` query with paging ([Reading from the LRS](#reading-from-the-lrs)) |
| Per-student separation | ✅ `actor.account.name` = `Player.externalId`, and the query filters by `agent` | None. This is what makes L4 hold. |
| Correct/incorrect, and when | ✅ `result.success`, `timestamp` (guess time) | None |
| Volume and API limits | ✅ Hundreds to a few thousand statements per student, against Veracity's 10k calls/day | None |
| Portability | ✅ Standard xAPI resources only, never Veracity's `/aggregate` | None |

**Why the levels are derived from statements and not stored.** Leitner
state, retirement included, is a pure function of one student's
`assessed` statements. That means we can change the rules and recompute
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
| **Learning object** | One thing being learned. For vocabulary, a **word in one sense**, of kind `lexeme` or `expression` (L18). | `ko/lexeme/시험/test`, whichever book or chapter teaches it |
| **Sense** | One meaning of a word, with a short permanent slug | `배` → `pear`, `ship`, `stomach` |
| **Source** | Where the student met it: book, chapter, section and entry. A `sourceRef` is per book; statements, tracks and the registry use the book-qualified form. | `ch27/vocabulary/1` in `korean-language-book` → `korean-language-book/ch27/vocabulary/1` |
| **Aspect** | The skill or angle tested. It's an open string, chosen by the game creator. | `reading` (Korean → pick meaning), `writing` (English → pick spelling) |
| **Track** | One `(student, learning object, aspect)`. Each track has its own level and schedule. | Player 7F3A × `ko/lexeme/시험/test` × `reading` |
| **Observation** | One piece of evidence about one learning object from one guess, sent as an `assessed` statement (L17) | `ko/lexeme/시험/test`, reading, success, direct |
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

**Grammar** is a *kind of learning object* (chapter `patterns`,
`sourceRef` `ch27/patterns/0`, id `ko/pattern/…`), with its own aspects,
not an aspect of a word. See `learning-objects.md`.

---

## The Leitner rules (0–3, then retired)

| Level | Meaning | After a correct answer lands on this level, next due in |
| --- | --- | --- |
| **0** | New, or not yet answered correctly | Now (next game) |
| **1** | Correct once | 1 day |
| **2** | Correct twice, at spaced times | 3 days |
| **3** | Proficient | 7 days |
| **Retired** | Passed a due question at L3 | Never (L13) |

The fold applies each observation on a track, oldest first. Today every
observation is a guess on that learning object, so "answer" below means
one direct observation:

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
  learningObjectId: string; // 'ko/lexeme/시험/test'
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
  sources: string[];        // where it was asked: ['korean-language-book/ch26/vocabulary/6', …]
};
```

---

## Learning-object identity: language, kind, word and sense (L2, L9, L16, L18)

A vocabulary learning object is **one word in one sense**, scoped to the
**language**, not the book (L16). The **source** entry (`sourceRef`)
decides which sense, using a checked-in **sense registry** for the
language.

```
learningObjectId = {language}/{kind}/{word}/{sense}
IRI = {base}/lo/{language}/{kind}/{enc(word)}/{sense}

시험 "test, exam"   → ko/lexeme/시험/test           …/lo/ko/lexeme/%EC%8B%9C%ED%97%98/test
보여 주다 "to show"  → ko/expression/보여 주다/to-show  …/lo/ko/expression/%EB%B3%B4%EC%97%AC%20%EC%A3%BC%EB%8B%A4/to-show
배 "pear" / "ship"  → ko/lexeme/배/pear, ko/lexeme/배/ship
```

- `language` is an ISO 639 code (`ko`).
- `kind` (L18) is `lexeme` (activity type `…/activity-types/lexeme-sense`)
  or `expression` (`…/activity-types/expression`). Grammar patterns,
  sentences and competencies get their own id shapes when they're built
  (`learning-objects.md` → Identity versus provenance).
- `word` is `NFC(target).trim()`, with internal spaces collapsed to one.
  `enc` is `encodeURIComponent` on the UTF-8 form (**L9**).
- `sense` is an ASCII slug (`[a-z0-9-]`) chosen when the sense is first
  registered, from its first English gloss (`to show` → `to-show`). Every
  word has a sense segment, including words with one meaning, so the IRI
  shape never changes when a second meaning shows up later.
- **No book in the IRI.** The book (`{base}/content/korean-language-book`)
  and chapter (`…/ch27`) stay as **provenance** activities in `grouping`,
  and the entry is the book-qualified `ext/source-ref`.
- These IRIs are **permanent once pilot statements exist**, like the base
  IRI. Code: `server/src/learning/learning-object.ts`.

### The sense registry

`server/src/games/content/ko-senses.json`, next to the chapter files and
committed to git: **one registry per language**, fed by every book (L16).
Code: `server/src/learning/sense-registry.ts`.

```json
{
  "language": "ko",
  "words": {
    "시험": [{ "sense": "test", "kind": "lexeme", "gloss": "test, exam",
               "sources": ["korean-language-book/ch27/vocabulary/1"] }],
    "보여 주다": [{ "sense": "to-show", "kind": "expression", "gloss": "to show",
                  "sources": ["korean-language-book/ch26/vocabulary/6", "korean-language-book/ch27/vocabulary/5"] }],
    "배": [
      { "sense": "pear", "kind": "lexeme", "gloss": "pear", "sources": ["korean-language-book/ch12/vocabulary/4"] },
      { "sense": "ship", "kind": "lexeme", "gloss": "ship", "sources": ["other-book/ch3/vocabulary/7"] }
    ]
  }
}
```

(The `배` sources are illustrative. Chapters 26–30 contain no homographs.)

Sources are **book-qualified**, so a second book attaches its entries to
the same senses, and its words get the same learning objects. `kind` is
set when a sense is first registered (`expression` if the word contains a
space, otherwise `lexeme`). A person may correct it in the file, but only
before any pilot statement uses that sense, because the kind is in the IRI.

`npm run content:senses [-- --book <id> --language ko]` reads every
`chapterNNData.json` in the content folder as chapters of `--book`
(default `korean-language-book`), in chapter order, and looks at each
vocabulary entry not yet listed by its qualified `sourceRef`. `--check` changes nothing and exits 1 if the
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
`(book, sourceRef) → learning object`. A chapter with any unregistered entry is
refused with a clear error, so a learning object's ID never depends on a
guess made at play time.

Generated for chapters 26–30 (2026-10-23): 155 entries → **146 words,
146 senses** (135 `lexeme`, 11 `expression`), with no conflicts. Nine entries attached to an existing
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
Its `partOf` decompositions (`learning-objects.md` → Composition) go here
too.

---

## Statement changes

Only **tagged questions** change, which in v1 means questions in Leitner
games. Untagged questions (all class games, past and future) produce
exactly today's statements, and no `assessed` statements.

**`answered` (what happened, L17).** Its context gains the learning object
and its provenance:

```json
"context": {
  "registration": "…unchanged…",
  "contextActivities": {
    "parent": [{ "id": "https://kogs.link/xapi/emoji-app/games/6650f…" }],
    "grouping": [
      {
        "id": "https://kogs.link/xapi/emoji-app/lo/ko/lexeme/%EC%8B%9C%ED%97%98/test",
        "definition": {
          "type": "https://kogs.link/xapi/emoji-app/activity-types/lexeme-sense",
          "name": { "ko": "시험", "en-US": "test, exam" }
        }
      },
      {
        "id": "https://kogs.link/xapi/emoji-app/content/korean-language-book/ch27",
        "definition": { "type": "https://kogs.link/xapi/emoji-app/activity-types/chapter" }
      },
      {
        "id": "https://kogs.link/xapi/emoji-app/content/korean-language-book",
        "definition": { "type": "https://kogs.link/xapi/emoji-app/activity-types/book" }
      }
    ]
  },
  "extensions": {
    "…existing game-id / station-name / badge-name…": "…",
    "https://kogs.link/xapi/emoji-app/ext/source-ref": "korean-language-book/ch27/vocabulary/1",
    "https://kogs.link/xapi/emoji-app/ext/aspect": "reading",
    "https://kogs.link/xapi/emoji-app/ext/game-kind": "leitner-solo"
  }
}
```

**`assessed` (what it shows, L17).** It comes straight after its `answered`
statement, one per observation:

```json
{
  "id": "<UUID v5 of gameId:guessId:assessed:<learning-object IRI>:<aspect>:<scorer>>",
  "actor": "…same as the answered statement…",
  "verb": { "id": "https://kogs.link/xapi/emoji-app/verbs/assessed", "display": { "en-US": "was assessed on" } },
  "object": {
    "objectType": "Activity",
    "id": "https://kogs.link/xapi/emoji-app/lo/ko/lexeme/%EC%8B%9C%ED%97%98/test",
    "definition": { "type": "…/activity-types/lexeme-sense", "name": { "ko": "시험", "en-US": "test, exam" } }
  },
  "result": { "success": true },
  "timestamp": "…same as the answered statement…",
  "context": {
    "registration": "…same…",
    "statement": { "objectType": "StatementRef", "id": "<the answered statement id>" },
    "contextActivities": {
      "parent": [{ "id": "…/games/{gameId}/questions/{questionId}" }],
      "grouping": ["…chapter…", "…book…"]
    },
    "extensions": {
      "…/ext/game-id": "6650f…",
      "…/ext/aspect": "reading",
      "…/ext/role": "whole",
      "…/ext/strength": "direct",
      "…/ext/source-ref": "korean-language-book/ch27/vocabulary/1",
      "…/ext/game-kind": "leitner-solo",
      "…/ext/scorer": "choice-whole@1"
    }
  }
}
```

- **Learning object** (language, kind, word, sense): what's tracked. It's
  the `assessed` object, and grouping on `answered`, so
  `activity={learning object}&related_activities=true` returns every
  attempt and every observation for it.
- **Chapter** and **book** grouping and the **`source-ref`** extension
  record where the student met it (L2), down to section and entry.
  `TrackState.sources` is built from `source-ref`.
- **`aspect`** is an extension, not part of the activity ID, so the LRS
  sees one activity per learning object.
- **`role`** (`whole` | `part`) and **`strength`** (`direct` | `indirect`)
  say how the observation relates to the item. Only `whole` / `direct`
  exists today. **`scorer`** names the versioned function that produced
  it; it's in the ID seed, so re-scoring with a new version never collides
  (`learning-objects.md` → Re-scoring).
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
| `Game` model | `kind: 'class' \| 'leitner-solo'` (default `class`, immutable). Games stored before it have no `kind` and read as `class`. For Leitner games, an immutable `leitner: { playerId, book, chapter, scope, aspects, seed, plannedAt, picks[] }`. Step 3 is what sets them. |
| `Question` model | Optional, immutable `learning: { learningObjectId, book, sourceRef, aspect, target, native }`, as **one sub-document**, so a question is either fully tagged or not at all. `learningTagSchema` (`learning/learning-object.ts`) validates it in `POST /api/questions`. |
| `vocab-choice.ts` | Items can carry `learning` (without `aspect`), and `toQuestionInput` adds `aspect = skill`. Untagged items give exactly the old output, so `create:vocab-game` is unaffected. |
| `GameDataRepository` | `createQuestionWithOptions` stores `learning`. `getGameExportData` returns it and `game.kind`. |
| `learning/observations.ts` | `Observation` and the `choice-whole@1` scorer (one direct observation on the tagged whole). Diagnostic scorers come later (`learning-objects.md`). |
| `statement-builder.ts` | Adds `grouping` and the extensions, and the `assessed` statements, **only when `learning` is set**. Specs prove untagged output is byte-for-byte unchanged, and that built statements are read back by the fold as the right track. The chapter grouping carries only its type, so the builder needs no content lookup. |

---

## Reading from the LRS

Add `fetchStatements(config, query)` to `lrs-client.ts`:

```
GET {endpoint}/statements
  ?agent={"objectType":"Agent","account":{"homePage":"https://kogs.link","name":"<externalId>"}}
  &verb=https://kogs.link/xapi/emoji-app/verbs/assessed
  &limit=500
X-Experience-API-Version: 1.0.3
```

- **`agent` is what makes the tracks per student (L4).** Only that
  student's statements are read.
- **`verb=assessed`** is the one evidence path (L17). There's **no
  activity filter**: learning objects are language-scoped (L16), so
  evidence from every book and chapter counts. The fold keeps the book's
  language (`ko`). If this ever returns too much, filter by the book or
  chapter grouping with `activity` + `related_activities=true`, which
  `assessed` statements carry.
- Everything comes back in one query, so **both scopes (L11) use the
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
GET  /api/players/:playerId/progress?chapter=27
       [&book=korean-language-book][&scope=chapter|review][&aspects=reading,writing][&now=<iso>]
→ 200 { player: { id, label }, book, chapter, scope, aspects, asOf,
        statementCount, observationCount,  // assessed statements fetched / counted for Leitner
        summary: { new, active: { L0, L1, L2, L3 }, retired, due },
        tracks: (TrackState & { due, inChapter, kind, word, gloss })[] }
        // chapter × aspects with new ones included; review adds other played chapters' tracks
→ 400 bad id/query · 404 unknown player, book or chapter · 422 unregistered senses
→ 503 LRS not configured · 502 LRS request failed
// Step 3 adds pendingExport: [{ gameId, endedAt, error? }] once Leitner games exist.

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
`ko-senses.json` (emoji-app owns its copy;
`game-planning.md` → Storage decision). Make
sure the build ships them: either import them as modules with
`resolveJsonModule`, or add a copy step to `build:server` and the Docker
build. `learning/book-content.ts` maps `(book, chapter) → vocabulary` and
`(book, sourceRef) → learning object` (built: modules via
`resolveJsonModule`).

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
  tracks: TrackState[],              // this student's, whole language (L16)
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
  the rating in `result.score.raw`, with no `result.success`, and an
  `assessed` statement carrying the same rating (a `rated@1` scorer). It's still
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
- [x] Content registry: `learning/book-content.ts` imports the chapter
      and registry JSON as modules (`resolveJsonModule`), so `tsc` ships
      them in `dist/server`, which is what the Docker image copies. Done
      with Step 2.
- [x] `content:senses` script, `sense-registry.ts` and
      `korean-language-book-senses.json` (now `ko-senses.json`, Step 2b) for ch. 26–30. Specs cover new
      word, matching gloss, homograph conflict, hand-resolved homographs,
      in-chapter repeats, the ch. 28 swap, stale entries, and that the
      committed registry is up to date.
- [x] Learning-object ID/IRI helpers: `learning/learning-object.ts`
      (ids, percent-encoded IRIs, parsing, extension and activity-type
      IRIs). The base IRI moved to `xapi/iris.ts` so this and
      `statement-builder.ts` don't import each other. Done with Step 2.
- [x] `Game.kind` (default `class`) and `Game.leitner`; `Question.learning`
      tag, accepted by `POST /api/questions` and stored and exported by the
      repository.
- [x] `statement-builder.ts`: `grouping` (sense, chapter, book) and the
      `source-ref` / `aspect` / `game-kind` extensions, only when tagged.
      Specs prove untagged output is unchanged.
- [x] Manual: tagged statements sent to `emojiapp-dev` with Strict API
      Mode on are accepted (2026-10-23, first shape, before L16–L18). These were 3 `answered` + 1 `scored`
      statements from the real builder for a throwaway actor
      (`leitner-smoke-…`), covering a plain word, a space (`보여 주다`),
      parentheses (`(돈을) 모으다`) and a wrong answer. Read back with the
      progress query:
      - book filter → 3, ch. 27 → 2, ch. 30 → 1;
      - percent-encoded IRIs, grouping names and all six extensions come
        back exactly as sent;
      - the fold over the returned statements gives L1 / L0 / L1 as
        expected.
      Superseded by the re-run under Step 2b (below).

### Step 2: Read path and progress

- [x] `fetchStatements` with `more` paging (mocked-`fetch` spec). It
      refuses a `more` link on another origin. Checked read-only against
      `emojiapp-dev` (2026-10-23): Veracity accepts the
      `activity` + `related_activities` query, and paging follows `more`.
- [x] `foldTracks` + `LeitnerConfig` (`learning/leitner.ts`), with specs for each rule: promote
      when due, no promotion when not due, **demote one and due now**, L0
      floor, **retire on a due pass at L3**, retired is final, no
      retirement from a not-due pass, slow answers count (L12), grace
      window, out-of-order input, other `game-kind`s ignored, one sense
      from two chapters folds into one track, two senses of one word stay
      separate.
- [x] `GET /api/players/:playerId/progress` with both scopes
      (`learning/progress.controller.ts`). `pendingExport` comes with
      Step 3.
- Reworked by Step 2b (below): `assessed` only, no book filter.

### Step 2b: Adopt `learning-objects.md` A1–A3 (L16–L18), before the pilot

- [x] Language-scoped ids and IRIs with the kind (`ko/lexeme/…`,
      `{base}/lo/ko/lexeme/…`), activity types `lexeme-sense` /
      `expression`, book-qualified source refs (`learning-object.ts`).
- [x] Registry moved to `ko-senses.json` (language, `kind` per sense,
      qualified sources), migrated mechanically: same 146 words and senses.
      `updateSenseRegistry` takes the book, and only checks that book's
      entries for staleness. `content:senses` gains `--language`.
- [x] `Question.learning` gains `book`; `learningTagSchema` rejects the old
      book-scoped ids.
- [x] `assessed` statements from the builder (`choice-whole@1`), right
      after each tagged `answered` statement; ID seeded with the scorer.
- [x] The fold reads only `assessed`, direct observations, in the book's
      language (`observationsFromStatements`). The progress query drops the
      book filter and returns `observationCount` and `kind`.
- [x] Manual, re-run (2026-10-23): the real builder sent 3 `answered` + 3
      `assessed` + 1 `scored` for a throwaway actor (`leitner-smoke-0a7b…`)
      to `emojiapp-dev`, Strict API Mode on. All accepted, including
      `context.statement` (StatementRef). Read back:
      - `verb=assessed` (the progress query) → 3; book grouping → 3;
        ch. 30 → 1;
      - `activity={보여 주다}` + related → its `answered` and `assessed`;
      - IRIs, StatementRefs, activity types and all seven extensions come
        back exactly as sent;
      - the fold gives L1 / L0 / L1 as expected.
      Clear `emojiapp-dev` before the pilot: it now holds two smoke-test
      actors (`leitner-smoke-c312…` with the old shape, `leitner-smoke-0a7b…`).

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
- Grammar: chapter `patterns` as learning objects (`ko/pattern/…`), using
  `pattern.cloze.ending` from `game-planning.md` and a diagnostic scorer
  (`learning-objects.md`).
- Speed: revisit L12 with pilot data (`result.duration` is already
  recorded, so any rule can be applied to history).

---

## Open questions

- **Sense registry ownership.** Who answers the "stop and ask" cases when
  a new chapter adds a homograph: the developer importing it, or a teacher
  in a future UI? Undecided. Until then, the developer running
  `content:senses` resolves them by hand.

Resolved: review mix (L14) and what "earlier chapters" means (L15).
