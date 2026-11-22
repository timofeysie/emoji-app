# Grammar learning objects

Status: **decided** (2026-11-22). **H4a and H4b built** (2026-11-22). H4c (library chapters and the chat) is next.
This is milestone **H4** of
[`creating-games-with-hashbrown.md`](../hashbrown/creating-games-with-hashbrown.md#milestones).
It builds on decision **A4** in
[`learning-objects.md`](../xAPI/learning-objects.md#decisions): grammar
patterns are learning objects, identified through a pattern registry at the
smallest teachable pattern.

> ⚠️ **Pattern ids are permanent once a grammar statement reaches the pilot
> LRS**, just like `ko/lexeme/시험/test`. The matching key and id rules below
> must be final before that. Trial statements on `emojiapp-dev` can be
> cleared.

Related:

- [`../xAPI/learning-objects.md`](../xAPI/learning-objects.md): A1–A4, the
  kinds table (§1), per-kind learner models (§5), grammar items (§6),
  "AI-suggested, human-confirmed" authoring (§7)
- [`../xAPI/leitner-method.md`](../xAPI/leitner-method.md): tracks, aspects,
  the sense registry this one is modelled on
- [`../hashbrown/creating-games-with-hashbrown.md`](../hashbrown/creating-games-with-hashbrown.md):
  library chapters, the `senses` collection, the A4 option discussion
- [`implementation-plan.md`](./implementation-plan.md): YALLA practice, where
  pattern tracks will show

---

## The problem in short

A word has one written form and a meaning, and the sense registry pairs
them. A grammar pattern doesn't have one written form. Books write the same
grammar in different ways, and a book "pattern" is often several patterns
used together:

| Source | Written as |
| --- | --- |
| A learner reference grammar | `-어(아, 여) 지다` |
| Many textbooks | `-아/어/여지다`, `-아/어지다` |
| Books that mark what it attaches to | `A-아/어지다` |
| Dictionaries and linguistics | `-어지다` |
| `korean-language-book` ch. 27 | `계속 더 ADJECTIVE + -아/어/여지네` (with `-네` and the adverbs `계속 더`) |

There is no single standard notation. So the app doesn't pick one book's
style as identity. It **normalises every spelling to a matching key**, and
derives the id from the key.

---

## Decisions

| # | Date | Decision | Why |
| --- | --- | --- | --- |
| GP1 | 2026-11-21 | **A pattern registry per language, at the smallest teachable pattern** (A4). `-아/어지다`, `-네` and `-았/었더니` are entries. A book pattern lists the entries it teaches. | One track per grammar point, whichever book or remix teaches it (A1). |
| GP2 | 2026-11-22 | **Patterns are matched by a normalised spelling key** ([Matching key](#the-matching-key)). Two spellings with the same key are the same pattern. | Books never agree on notation, but they mostly differ in ways a fixed rule can remove. |
| GP3 | 2026-11-22 | **The id is derived from the key by a fixed rule, never typed.** `ko/grammar-pattern/<romanised key>/<meaning slug>`. | The same spelling can never produce two ids. |
| GP4 | 2026-11-22 | **The headword and the spellings books use are data, not identity.** Each entry has a display headword (default style `-아/어/여지다`) and every spelling seen in a book, e.g. `-어(아, 여) 지다`. | The headword can change without touching a statement. Recording each book's spelling lets a new book match automatically. |
| GP5 | 2026-11-22 | **Linking a book pattern to its entries is AI-suggested and human-confirmed**, like word senses (G7). The key only matches spellings. It can't split `계속 더 … -아/어/여지네` into `-아/어지다` and `-네`. | Splitting a combination needs grammatical judgement. A wrong link becomes a wrong track. |
| GP6 | 2026-11-22 | **The key is romanised with Revised Romanisation, one syllable at a time, finals as heard** (`ㅆ`/`ㅅ` → `t`), with no sound changes between syllables: `at-eot-deoni`. | Readable and deterministic. Strict transliteration (`ass-eoss-deoni`) was the alternative. |
| GP7 | 2026-11-22 | **Pattern tracks use the aspect `usage`**: can the student pick the right form in a sentence. | Names the skill, not the question type. Recognition or production can become other aspects later. |
| GP8 | 2026-11-22 | **The built-in book's registry and links are drafted (by Claude) for review**, not hand-authored from scratch. | Same "AI-suggested, human-confirmed" rule. Reviewed before any pilot statement. |
| GP9 | 2026-11-22 | **Build H4a, then H4b, for the built-in book.** H4c (library chapters and the chat) follows. | Gets pattern tracks working end to end on reviewed data before users can add patterns. |

---

## The matching key

A spelling is reduced to a key in these steps, in this order. The key
is in Hangul. The id is the key romanised (next section).

1. **Unicode NFC**, and full-width punctuation to ASCII (`（，）` → `(,)`).
2. **Drop what the pattern attaches to:** `A-`, `V-`, `N-`, `AV-`, Latin
   placeholders (`VERB`, `ADJECTIVE`, `NOUN`, `SUBJECT`), `+`, `~`, and
   sentence punctuation (`.`, `?`, `!`).
3. **Read vowel alternatives as one group,** in either notation:
   - slashes: `아/어/여`, `았/었/였`
   - brackets: `어(아, 여)`, `었(았, 였)`

   Each becomes the set of its variants.
4. **`여` is implied.** Drop the `여` variant (`여`, `였`) from a group that
   has `아`/`어` (`았`/`었`), because `하다 + 여 → 해` is regular. A group
   is written in a fixed order: the `ㅏ` variant, then the `ㅓ` variant
   (`아/어`, `았/었`). So `-어(아, 여) 지다` and `-아/어/여지다` both give
   `아/어` + `지다`.
5. **Keep optional `(으)`** as its own token, and keep a lone jamo ending
   (`ㄹ`, `ㄴ`, `ㅂ`) as a token: `-(으)ㄹ 것 같다` → `(으)` `ㄹ` `것같다`.
6. **Remove spaces and the leading hyphen.** Spacing differs between books
   (`-아/어 지다`, `-아/어지다`), so it isn't part of the key.

Examples:

| Spellings | Key |
| --- | --- |
| `-어(아, 여) 지다`, `-아/어/여지다`, `-아/어지다`, `A-아/어지다`, `~아/어 지다` | `아/어·지다` |
| `-았/었/였더니`, `-었(았, 였)더니`, `V-았/었더니` | `았/었·더니` |
| `-(으)면`, `V-(으)면` | `(으)·면` |
| `-(으)ㄹ 것 같다`, `V-(으)ㄹ 것 같다` | `(으)·ㄹ·것같다` |
| `-네` | `네` |

The key is stored with one space between tokens (`아/어 지다`,
`(으) ㄹ 것같다`). The `·` above only makes the tokens easier to read.

What the key **doesn't** do, on purpose:

- **Conjugated forms stay different.** `-아/어지네` and `-아/어지다` have
  different keys. A book pattern with a conjugated ending is linked to its
  entries (GP5). Its own spelling is still recorded, so the next book that
  writes it the same way matches.
- **Base-form-only spellings stay different.** `-어지다`, the dictionary
  style, is one variant, not the group, so it doesn't match `아/어·지다`
  by key. It's added to the entry's spellings when it's first linked.
- **No meaning.** Two patterns with the same spelling and different
  meanings (rare) are told apart by the meaning slug (GP3). Matching
  offers both, and the user picks one, as with senses.

## The id

`{language}/grammar-pattern/{romanised key}/{meaning slug}`, for example
`ko/grammar-pattern/a-eo-jida/become`.

- **Kind** `grammar-pattern`, a third kind next to `lexeme` and `expression`
  (A3). Activity type `{base}/activity-types/grammar-pattern`. IRI
  `{base}/lo/ko/grammar-pattern/a-eo-jida/become`. The form is ASCII, so it
  needs no percent-encoding.
- **Romanised key:** each token romanised and joined with hyphens. Inside a
  group, variants are joined with hyphens too. `(으)` is `eu`. A lone jamo
  takes its final value (`ㄹ` → `l`, `ㅂ` → `p`). Syllables use Revised
  Romanisation with finals as heard (GP6):

  | Key | Form |
  | --- | --- |
  | `아/어·지다` | `a-eo-jida` |
  | `았/었·더니` | `at-eot-deoni` |
  | `(으)·면` | `eu-myeon` |
  | `(으)·ㄹ·것같다` | `eu-l-geotgatda` |
  | `네` | `ne` |

- **Meaning slug:** same rule as sense slugs: the first English meaning,
  lower-case ASCII with hyphens, at most 40 characters (`become`,
  `and-then-found`). Suggested by the AI, confirmed by the user. Two
  entries with the same key need different slugs.

## The pattern registry

Like the sense registry (`ko-senses.json` plus the `senses` collection):

| Layer | Holds |
| --- | --- |
| `server/src/games/content/ko-patterns.json` (committed) | Entries for the built-in book: `key`, `form` (romanised key), `meaning` (slug), `headword`, `gloss`, `spellings[]`, `sources[]` (book-qualified pattern refs, `korean-language-book/ch27/patterns/0`) |
| `patterns` collection (Mongo) | Entries users add when they publish a library chapter. The file wins on a clash. |

**Book pattern links.** Each book pattern stores the entries it teaches,
like a chapter's `senseIds`: `ch27/patterns/0` →
`[ko/grammar-pattern/a-eo-jida/become, ko/grammar-pattern/ne/noticing]`.
For the built-in book they're in the registry's `sources`. For user books
they're on the `Chapter` (`patternIds[i]`), so a remix keeps them.

**Matching at authoring time.** For each book pattern, the editor or the AI
offers:

1. entries whose key equals the book pattern's key (an exact match, reuse
   by default, shown in orange as reused, like senses), then
2. entries whose key appears inside it (`계속 더 … -아/어/여지네` contains
   `아/어·지` …), as suggestions only, then
3. a new entry, which the user confirms.

## Questions, evidence and tracks

As built in H4b (2026-11-22):

- **Item:** a cloze (learning-objects §6) on one of the book pattern's
  sentences (its example, sample sentences or exercise answer keys). The
  **pattern's own ending** is blanked, not the whole word, so the verb
  stays visible and the question is about the grammar:
  `계속 더 심해___. (It's getting worse and worse.)`. The translation
  follows in brackets, with the exercises' word hints (`(to be curious =
  궁금하다)`) dropped to keep it short.
- **Where the blank is:** from the book pattern's text. The ending starts
  at its first `+` and runs to the next placeholder (`-(으)면 안 돼`). The
  part written the same after any verb (`지네`, `면`, `더니`) is found at
  the end of a word in the sentence, and the blank runs to the end of the
  ending's last word (`빠지[면 안 돼]`). When the ending fuses with the
  stem (`-(으)ㄹ`, `-아/어/여`), the blank starts at the next word
  (`쓰러질 [것 같아]`, `먹어 [보는 거예요]`). This finds the blank in all
  67 sentences of the built-in book (a spec checks every one).
- **Distractors:** other book patterns' endings, from this chapter first,
  never one teaching the same grammar (ch. 27 and 28 share theirs) and
  never the same text. Data only, with no conjugation engine. So it's
  "which ending fits", not yet "right verb, wrong pattern" (that needs
  conjugated forms, for example AI-written and person-checked in H4c).
- **Evidence:** `assessed` on the **picked entry** only, `aspect: usage`,
  `role: whole`, `strength: direct`, `scorer: choice-whole@1` (the same
  scorer as word choices). A book pattern that teaches two entries
  (`-아/어/여지다` and `-네`) gives evidence to the one the planner picked.
  Both would need `Question.learning` to become `targets[]` (learning-objects
  → Can wait). No word evidence yet.
- **Tracks:** `(student, pattern, usage)`, plain Leitner for now.
  `aspectAppliesTo` keeps `usage` for patterns and `reading`/`writing` for
  words, in the planner and in progress. `source-ref` is the book pattern
  (`korean-language-book/ch27/patterns/0`). The sentence is in the
  `answered` statement's question text, so the §5 rule (promotion needs
  different sentences) can be added later from statements already sent.

## Build order (GP9)

| Step | What |
| --- | --- |
| H4a | The matching key and id (pure functions and specs), the `grammar-pattern` kind in `learning-object.ts`, the registry file and loader, links for the built-in book. No statements. |
| H4b | The cloze generator, pattern tracks in the Leitner planner, badge games and YALLA practice, for the built-in book. |
| H4c | Pattern decisions in the library chapter editor, `proposeChapter` and the chat card, the `patterns` collection and `Chapter.patternIds`, so user books get pattern tracks too. |

## H4a: what was built

Built 2026-11-22. No questions or statements use patterns yet.

- **Key and form** (`server/src/learning/grammar-pattern.ts`):
  `patternKey(spelling)` and `patternForm(spelling)`, following the steps
  above. A spelling it can't read (no Korean, an unclosed bracket, a `/`
  not between syllables, a bracket that is neither `(으)` nor vowel
  alternatives) throws `PatternSpellingError`, so a bad spelling never
  becomes an id.
- **Kind** (`learning-object.ts`): `grammar-pattern` is in
  `learningObjectKindValues` and `LEARNING_OBJECT_TYPES`. A grammar
  pattern's `word` must be an ASCII slug (its form). `vocabularyKindValues`
  stays words only, so senses and chapter drafts can't pick it.
- **Registry** (`server/src/games/content/ko-patterns.json`,
  `learning/pattern-registry.ts`): entries with `headword`, `meaning`,
  `gloss`, `spellings` and `sources`, and `reviewed: false` until checked
  (GP8). `filePatterns('ko')` indexes them by id, by the key of every
  spelling, and by book pattern. `matchPatterns(index, spelling)` gives the
  entries a spelling matches.
- **Specs:** 23 for the key and form (every notation of `-아/어지다`,
  `-았/었더니`, `-(으)면`, `-(으)ㄹ 것 같다`, the things the key keeps apart,
  the refusals), 4 for the registry (ids, every one of the 15 built-in
  book patterns linked and no link to a pattern that doesn't exist,
  matching, duplicate ids). All 517 server tests pass.

### The drafted registry (to review)

| Id | Headword | Gloss | Taught by (`korean-language-book`) |
| --- | --- | --- | --- |
| `ko/grammar-pattern/at-eot-deoni/did-and-then` | `-았/었/였더니` | did … and then (found, or as a result) | ch26/0 |
| `ko/grammar-pattern/eu-myeon/if` | `-(으)면` | if, when | ch26/1, ch30/2 |
| `ko/grammar-pattern/eu-l-geoyeyo/will` | `-(으)ㄹ 거예요` | will (a plan or a guess about the future) | ch26/1 |
| `ko/grammar-pattern/a-eo-yadoeda/have-to` | `-아/어/여야 되다` | have to, need to | ch26/2, ch29/0 |
| `ko/grammar-pattern/a-eo-jida/become` | `-아/어/여지다` | gets to be, becomes | ch27/0, ch28/0 |
| `ko/grammar-pattern/ne/noticing` | `-네` | noticing or realising something just now | ch27/0, ch28/0 |
| `ko/grammar-pattern/eu-myeonandoeda/must-not` | `-(으)면 안 되다` | must not, should not | ch27/1, ch28/1 |
| `ko/grammar-pattern/eu-l-geotgatda/seems` | `-(으)ㄹ 것 같다` | it seems, it looks like (it will) | ch27/2, ch28/2 |
| `ko/grammar-pattern/eu-ryeomyeon/if-you-want-to` | `-(으)려면` | if you want to, in order to | ch29/0 |
| `ko/grammar-pattern/neungeot/nominaliser` | `-는 것` | (doing): turns a verb into a noun | ch29/1, ch30/0 |
| `ko/grammar-pattern/nayo/soft-question` | `-나요` | a soft polite question | ch29/1 |
| `ko/grammar-pattern/jimalgo/instead-of` | `-지 말고` | don't … and (do something else) instead | ch29/2 |
| `ko/grammar-pattern/a-eo-boda/try` | `-아/어/여 보다` | try doing, do for the first time | ch30/0, ch30/2 |
| `ko/grammar-pattern/a-eo-beorida/end-up` | `-아/어/여 버리다` | end up doing, do completely | ch30/1 |

Judgement calls to check:

- **Where a combination stops.** `-(으)면 안 되다` is one entry, not
  `-(으)면` + `안 되다`, because books teach it as a unit. `-(으)ㄹ 거예요`
  is written in the polite form books teach (`-(으)ㄹ 것이다` is a
  spelling), so its form is `eu-l-geoyeyo`.
- **What's left out.** Ch. 29/0's `-죠` in `해야 되죠?`, ch. 29/2's
  final `-아/어` and the adverbs (`계속 더`, `금방`, `처음`, `막상`) aren't
  linked: they're the frame of the example, not what the pattern teaches.
- **Two meanings of one form.** None yet. `-는 것` covers the noun-making
  use only.

## H4b: what was built

Built 2026-11-22, for the built-in book.

- **Cloze generator** (`server/src/games/generators/pattern-cloze.ts`):
  `bookPatternsOf` (a chapter's patterns and sentences), `clozeOf` (where
  the blank is), `clozeItem` (four options, shuffled by the seed, or a
  given sentence for YALLA's re-check).
- **Content** (`book-content.ts`): `BookContent` has each chapter's book
  patterns and the language's pattern registry. `chapterPatternObjects`
  gives a chapter's grammar-pattern learning objects.
  `describeLearningObject` names any track (a word, or a pattern's
  headword and gloss) for progress and player activity.
- **Planner:** words and patterns plan together. `aspectAppliesTo`
  (`learning-object.ts`) decides which tracks exist. A chapter's patterns
  are spread through its words, so a new student meets one in their first
  games. Pattern picks become cloze questions tagged
  `{ learningObjectId: ko/grammar-pattern/…, sourceRef: ch27/patterns/0,
  aspect: usage, target: headword, native: gloss }`. Review scope finds
  patterns from other chapters too. Plans with only `reading`/`writing`
  are unchanged, question for question.
- **Badge games:** `POST /api/leitner-games` takes `aspects: ['usage']`.
  The questions are ordinary four-option questions, so play and export
  need no change.
- **YALLA:** sessions take `usage`, and items carry `sentence`.
  `POST /api/yalla/me/results` rebuilds the cloze from the book pattern and
  sentence and checks the options against it. A typed `usage` answer is
  refused (multiple choice only).
- **Client:**
  - The Leitner dialog and the chat's `createLeitnerGame` offer `usage`,
    and the chat's default is every aspect.
  - YALLA has a **Grammar** pill, which links to the Patterns tab.
    Exercises has a Grammar skill that is always multiple choice, shows the
    sentence smaller than a word, and says "new pattern".
- **Specs:** 12 for the cloze (every built-in sentence, distractors, hints,
  the same sentence again), 5 end to end (a usage badge game tagged with
  the entry, words and patterns mixed with the right aspects, progress
  naming, a YALLA cloze answer sent as `assessed` on
  `…/lo/ko/grammar-pattern/a-eo-jida/become` and folded, refusals). All
  534 server tests pass. Lint and the build are clean, and the client
  typecheck shows the same 4 errors as before.

**Not checked yet:**
- **On screen:** the Grammar pill, the Exercises cloze and the dialog's
  Usage box.
- **A badge game on a real station:** whether cloze prompts fit the
  student and referee views (G15). The longest built-in prompt is about
  110 characters.
- **Export to `emojiapp-dev`.**
- **Pattern levels on the Patterns tab:** not shown yet. It has no
  learning-object ids per pattern.

## Open questions

None yet. The first draft's four questions were answered 2026-11-22 (GP6–GP9).
