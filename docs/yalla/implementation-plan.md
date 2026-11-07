# YALLA — solo study and practice: implementation plan

**YALLA** = *Yet Another Language Learning App*. A solo study and practice
feature inside the emoji-app, modelled on `../../../language-learning-app/`.

Status: **draft / proposal** (2026-10-30). Nothing here is built yet.
Revision 2 (same day): added the header link and route guard, the sidebar and
pages, user ↔ LRS identity, and the pill counts. These are based on reading
the existing code (`server/src/learning/`, `server/src/xapi/`,
`server/src/auth.ts`, `client/src/app/components/AppHeader.tsx`).
Revision 3 (same day): Phase 0 decisions recorded, Phase 1 split into
milestones Y1–Y6, and game formats / input channels added (keyboard or A–D
per aspect, with defaults).

Related:

- [`../xAPI/xAPI.md`](../xAPI/xAPI.md) — Korean-vocabulary pilot scenario
- [`../xAPI/LRS.md`](../xAPI/LRS.md) — LRS choice (Veracity), statement design
- [`../xAPI/leitner-method.md`](../xAPI/leitner-method.md) — Leitner rules, tracks, aspects, L1–L19 decisions
- [`../xAPI/learning-objects.md`](../xAPI/learning-objects.md) — learning-object identity (`ko/lexeme/시험/test`)
- [`../xAPI/security.md`](../xAPI/security.md) — identity model (D2–D4): why only `Player.externalId` reaches the LRS
- `../../../language-learning-app/` — the original local-storage demo the content came from

---

## The request, restated

1. A **solo** study and practice feature that uses the same book, chapter and
   learning-object data as the emoji badge games
   (`server/src/games/content/`, indexed by `server/src/learning/book-content.ts`).
2. **No web sockets.**
3. **Keyboard input** as well as multiple choice, chosen per aspect by
   the learner. Writing (type the Korean) defaults to keyboard; reading
   (type the English exactly) defaults to multiple choice. Multiple choice
   uses on-screen A–D in place of the badge games' NFC cards. How a learner
   answers is a **game format** option, so other inputs (sensors, …) can
   be added later ([§6](#game-formats-and-input-channels)).
4. The **same Leitner behaviour** as the emoji-app Leitner games.
5. A **YALLA** link in the header. It and the `/yalla` routes are only
   visible when the user is **signed in with Cognito, or the app is
   running locally** with auth disabled.
6. Its own **left sidebar** with the same options as `language-learning-app`.
7. **Books → book detail → chapter detail** with dialog, vocabulary and
   pattern sections (plus exercises).
8. The signed-in user is **linked to an LRS identity**, the same identity a
   Leitner game uses for its student. The **reading / writing / speaking /
   listening pills** come from that identity's LRS evidence.
9. Usable on the **web and on mobile**, and **cheap**: staging is normally
   destroyed and only applied to test.

## Short answer

**Yes, and less is new than it seemed.** The emoji-app already does the hard
parts on the server:

- **Leitner levels are already derived from the LRS**, not stored.
  `fetchStudentEvidence()` reads one student's `assessed` statements and
  `foldTracks()` turns them into a level and due date per
  `(learning object, aspect)`. This "track" model (`leitner.ts`) is a pure
  function of the statements.
- **Progress per chapter already exists**: `GET /api/players/:id/progress`
  returns every track in a chapter with `status`, `level` and `due`.
- **Book content is already indexed** against the learning-object registry
  (`ko-senses.json`).

So YALLA is mostly client work, plus:

1. **Link a Cognito user to a `Player`** (that player's `externalId` is the
   LRS actor), so the server knows *whose* evidence to read and write.
2. **A few `/api/yalla/*` endpoints** that use the signed-in user's linked
   player: chapter content, my progress, post my practice results.
3. **Practice answers sent as `assessed` statements** with a new
   `game-kind`, which the Leitner fold counts. Then YALLA practice and badge
   games move the **same** Leitner tracks.

For hosting, follow **stage A now, B later, maybe C**
(see [Hosting](#hosting-options-when-staging-is-destroyed)).

---

## 1. Header link and route guard

### Who sees YALLA

| Situation | Header link | `/yalla/*` routes | API |
| --- | --- | --- | --- |
| Signed in (Cognito `accessToken` in `useAuthStore`) | ✅ | ✅ | `requireAuth` passes |
| Local dev, `VITE_DISABLE_AUTH=true` (client) and `DISABLE_AUTH=true` (server, ignored in production) | ✅ | ✅ | `requireAuth` passes through |
| Not signed in, auth enabled | ❌ hidden | redirect to `/` (or start sign-in) | 401 |

Client:

- `AppHeader.tsx` already hides `/profile` when there's no `accessToken`.
  Add `{ to: '/yalla', label: 'YALLA' }` to `NAV_LINKS` and filter it with
  the same rule, extended to `accessToken || authDisabledClient`. Put that
  rule in one helper, e.g. `canUseYalla()` in `auth/`, so the header and
  the route guard can't disagree.
- Add `viewTitleForPathname` entries (`/yalla` → `YALLA`).
- Wrap the YALLA routes in a `<RequireYalla>` guard that uses the same
  helper.

Server:

> **Hiding the link is cosmetic. The API is the real gate.** Today only
> `/api/chat` uses `requireAuth`. Every other `/api` route is open. All
> new `/api/yalla/*` routes **must** use `requireAuth`, and they must take
> the learner from the **token**, never from a `playerId` in the request.
> Otherwise anyone could read someone else's progress or write statements
> as them.

`requireAuth` currently checks the token but throws away its claims. Change
it to attach `req.auth = { sub, username }`. With `DISABLE_AUTH`, attach a
fixed dev identity, e.g. `{ sub: 'local-dev' }`.

### Routes

```
/yalla                                   Books (list; one book today)
/yalla/books/:book                       Book detail: title, chapters, per-chapter pills
/yalla/books/:book/chapters/:chapter     Chapter detail → redirects to …/dialog
  …/dialog
  …/vocabulary
  …/patterns
  …/exercises
```

Use path segments for the chapter sections, not tab state as in
`language-learning-app`. Deep links, the back button and a refresh then work,
and the sidebar can be plain `NavLink`s.

---

## 2. Layout: the YALLA sidebar

Same options as `language-learning-app/src/components/pages/ChapterPage.tsx`:

| Sidebar item | Icon (lucide, the emoji-app uses `lucide-react`) | Route |
| --- | --- | --- |
| Home | `DoorOpen` | `/yalla` |
| Dialog | `MessagesSquare` | `…/dialog` |
| Vocabulary | `List` | `…/vocabulary` |
| Pattern | `LayoutTemplate` | `…/patterns` |
| Exercises | `Dumbbell` | `…/exercises` |

- **Desktop (≥ `lg`)**: a vertical left sidebar with icon + label, inside the
  emoji-app's content column. Hide the chat panel on `/yalla/*` by default,
  or leave it closed, to give YALLA the room.
- **Mobile**: an icon-only tab bar, as `language-learning-app` has. Put it at
  the **bottom** rather than the top so it's reachable with a thumb and not
  hidden by the on-screen keyboard during typed practice.
- On `/yalla` and the book detail page (no chapter yet), the sidebar shows
  only Home plus a chapter list.

Build with the emoji-app's Radix + Tailwind components (`client/src/app/shared/`),
not MUI.

---

## 3. Pages

### Books (`/yalla`)

A list of books from `GET /api/yalla/books`. There's one today:
`korean-language-book`, *Real-Life Korean Conversations: Intermediate*.

The server's `loaders` map in `book-content.ts` only knows a book's slug and
language, not its **title**. Add a small book catalogue next to it:
`{ book, title, language, chapters: [{ chapter, titleTarget, titleNative }] }`,
built from the chapter JSON files, so the client never hard-codes titles as
`language-learning-app`'s `chapterMapping.ts` does.

### Book detail (`/yalla/books/:book`)

The title, then one row per chapter: `Chapter 27 · <titleTarget> · <titleNative>`,
with that chapter's **pill counts** (see [§5](#5-the-pill-counts)) as a
summary. Each row links to the chapter.

### Chapter detail (`/yalla/books/:book/chapters/:chapter/*`)

The header is `Chapter N`, `titleTarget` and `titleNative`. Content comes from
`GET /api/yalla/books/:book/chapters/:chapter`, which returns the **whole
chapter JSON** (dialog, vocabulary, patterns), not just the vocabulary that
`book-content.ts` indexes today. For vocabulary, it adds each entry's
`learningObjectId`, `sourceRef` and `kind` from the sense registry.

| Section | Port of | Notes |
| --- | --- | --- |
| Dialog | `features/Dialog/DialogComponent.tsx` | Read-only. Speaker lines, target + native (tap to reveal native). |
| Vocabulary | `features/Vocabulary/VocabularyComponent.tsx` | Word list, tap to reveal the gloss. **Pill bar** at the top filters the list to words with work to do for that aspect ("All" shows every word). Each word can show a small level dot per aspect. |
| Pattern | `features/Patterns/*`, `features/AppliedPatterns/*` | Read-only: pattern, explanation, example and sample sentences. |
| Exercises | `features/Exercises/*` | Leitner practice session (see [§6](#6-exercises-solo-leitner-practice)). |

**Scope for v1:** only **vocabulary** has learning objects (`ko-senses.json`),
so only vocabulary is scored and has pills. Dialog and patterns are for
study only. `language-learning-app` also put dialog lines and pattern
sentences on its study lists. They come back when patterns get learning
objects (`leitner-method.md`: grammar is its own kind, `ko/pattern/…`).

---

## 4. Linking the user to an LRS identity

### What exists

| Model | Who | Identity | Reaches the LRS? |
| --- | --- | --- | --- |
| `User` (`models.ts`) | Someone who logs in (Cognito) | `authProviderId` (Cognito `sub`) | No |
| `Player` (`models.ts`) | A student the referee plays with. "Never logs in; no email" (security.md D4) | `externalId`, a random UUID | **Yes**: the xAPI actor is `{ account: { homePage: XAPI_HOMEPAGE, name: externalId } }` |

A Leitner game is created **for a `Player`** (`POST /api/leitner-games
{ playerId }`), and its statements use that player's `externalId`.
`fetchStudentEvidence(config, player.externalId, language)` reads them back.
There is **no link from a `User` to a `Player`**. The client also sends a
hard-coded `DEMO_CREATOR_ID` as `createdByUserId`, and nothing creates a
`User` row from a Cognito sign-in.

### What to add

The same `Player` must be both the **student in badge games** and the
**learner in YALLA**, so that both modes read and write one set of Leitner
tracks. So **link a `User` to an existing `Player`**. Don't give the user a
second LRS identity.

1. **`User` upsert on sign-in.** `GET /api/me` (behind `requireAuth`)
   finds or creates the `User` by `authProviderId = sub`
   (`displayName` from the token's `username`). In local dev the fixed
   `local-dev` sub gets a local `User`.
2. **Link field.** Add `User.playerId: ObjectId | null` (ref `Player`,
   unique when set). The link points from user to player, so `Player`
   doesn't change and stays a no-login record (D4).
3. **Linking UI**, on the existing **Profile** page (`UserProfileView.tsx`):
   *"Practise as: [pick a player ▾] / [Create a new player]"*.
   - Picking an existing player sets `User.playerId`
     (`PUT /api/me/player { playerId }`). Their history from badge games
     then appears in YALLA straight away, because it's the same
     `externalId`.
   - "Create" makes a `Player` (`firstName` = a nickname the user enters,
     new UUID `externalId`) and links it.
   - Unlinking sets it back to `null`. LRS history stays with the player.
   - **Decided (D14, 2026-10-30):** for the prototype, users link
     themselves to **any** player. Later, only a referee/admin can link, or
     a player gets a one-time link code. Record this in `security.md`
     alongside D2–D4.
   - **User ids stay stable across `terraform destroy`/`apply`.** The
     Cognito user pool is **not managed by Terraform**:
     `infra/terraform/AWS-ARCHITECTURE.md` lists Cognito and MongoDB
     Atlas as "Not managed here", and `envs/staging` only passes in the
     existing pool id (`cognito_user_pool_id` in `terraform.tfvars`) as task
     env. There are no `aws_cognito_*` resources. So the Cognito `sub`,
     the `User.authProviderId` rows and the `User.playerId` links in Atlas
     all survive a destroy. Don't delete or recreate the pool by hand, and
     don't bring it under Terraform in the destroyable `envs/staging`
     state. If it's ever imported, put it in a separate, never-destroyed
     state with `prevent_destroy`.
   - **Local dev identity.** With `DISABLE_AUTH`, the server uses the fixed
     `local-dev` sub, which is a different `User` from your staging login.
     Link it to the same player, or run locally with real Cognito
     (`VITE_COGNITO_*` set and `http://localhost:5200/auth/callback` in the
     app client's callback URLs) so the `sub` is the same as on staging.
     This only matters if local and staging share an Atlas database.
4. **YALLA without a link.** The pages still work for **study** (dialog,
   vocabulary, patterns), but the pills show "–" and Exercises shows
   *"Link your profile to a player to track progress"* with a link to the
   Profile page.
5. **Server-side use.** Every `/api/yalla/me/*` handler does
   `sub → User → playerId → Player.externalId`. One helper
   (`resolveLearner(req)`) returns `{ user, player }`, or 403
   `{ error: 'No linked player' }`.

`GET /api/me` returns `{ user: { id, displayName }, player: { id, label } | null }`.
The client keeps it in a small `useMeStore` (or adds it to `auth.store.ts`),
and it can replace `DEMO_CREATOR_ID` for `createdByUserId` too.

---

## 5. The pill counts

### What they meant in `language-learning-app`

Each study item had a `StudyRecord` per skill:
`{ onList, count, lastDate }`. A correct answer set `onList = false`, and a
wrong one did `count += 1`. The pill badge was the **number of items still on
the list** for that skill (`useChapterStatus.ts`). Everything was stored in
`localStorage`, one browser, no user.

### What they mean in YALLA

The Leitner **track** (`learning object × aspect`) takes the place of
`StudyRecord`, and it's derived from the LRS. Map the pills to the
`language-learning-app` skills like this:

| Pill | Aspect | Has evidence today? |
| --- | --- | --- |
| Reading | `reading` (Korean → meaning) | ✅ badge games, YALLA |
| Writing | `writing` (meaning → Korean) | ✅ badge games (multiple choice), YALLA typed |
| Listening | `listening` | ❌ deferred until audio exists (`leitner-method.md`) |
| Speaking | `speaking` | ❌ deferred |

**Count = tracks in this chapter for this aspect that still need work**,
i.e. `status !== 'retired'`. That's the closest match to the old
`onList`: a word leaves the list when it's retired (passed at L3), not after
one correct answer. Show a second, smaller number for **due now**
(`track.due`), because that's what the next practice session will ask.
For example, `Reading 12 · 4 due`.

Listening and speaking pills show `–` and are disabled (with the tooltip
"Coming later") until a generator and evidence exist. The client keeps the
four-pill layout, so nothing moves around when they arrive.

### How they're computed (the same way a Leitner game plans)

Planning a Leitner game does this (`LeitnerGamesController`):

```
player → fetchStudentEvidence(lrs, player.externalId, language)   // assessed statements → observations
       → foldTracks(observations)                                 // tracks with level / due / retired
       → planNextGame(…)                                          // picks
```

`GET /api/players/:id/progress` already does the first two steps and
`buildProgress()` for one chapter. YALLA reuses it as:

```
GET /api/yalla/me/progress?book=korean-language-book&chapter=27&aspects=reading,writing,listening,speaking
  requireAuth → resolveLearner → (same body as getProgress, with player = the linked player)
  → { summary, tracks[], pendingExport[] }
```

The client groups `tracks` by `aspect` for the pills and by
`learningObjectId` for per-word level dots. Factor the body of
`getProgress` into a service (`LearningProgressService.forPlayer(player, query)`)
so the two endpoints can't diverge.

For the **book detail** page (pills per chapter), add
`GET /api/yalla/me/progress/book?book=…`. It does **one** LRS read and folds
once, then runs `buildProgress` per chapter, so it doesn't make one LRS call
per chapter.

**Freshness.** Badge-game statements reach the LRS only when the game is
exported, so `pendingExport` from the response means "levels may be stale".
Show it as a small banner. YALLA statements are sent at once (through the
outbox), so YALLA practice shows up on the next progress read.

### Keeping Leitner levels accurate as history grows

**Paging is already correct (checked 2026-10-30).** `fetchStatements` in
`server/src/xapi/lrs-client.ts` follows the LRS `more` link until it's
empty, with 500 statements per page (`PAGE_SIZE`). It refuses `more`
links to another origin and is tested in `lrs-client.spec.ts`
("follows `more` until it is empty"). Revision 2 warned that levels would
be silently wrong after 500 statements. **That was wrong: every page is
read.** The only limit is `MAX_PAGES = 100` (50,000 `assessed`
statements per learner). Past it, the read **throws** rather than
returning partial data, so planning and progress fail visibly instead of
using wrong levels.

What can still make levels wrong or slow, and the plan for each:

| Risk | Effect | Plan |
| --- | --- | --- |
| **Read cost grows with history.** Every progress view and every session plan re-reads **all** of a learner's `assessed` statements. At ~100 answers/day that's ~70 pages after a year: seconds of latency, and ~70 of Veracity's 10k API calls/day per view. | Slow, then rate-limited | **Per-player evidence cache with incremental reads** (below). |
| **YALLA outbox not flushed yet** | Plans and pills miss the latest answers | Client flushes the outbox **before** requesting progress or a new session. The server also returns `409 { pendingOutbox }`-style guidance if a plan request carries `outboxPending: n > 0`, the same way `pendingExport` works for badge games. |
| **Badge game not exported yet** | Same | Already handled: `pendingExport` → 409 for planning, banner for progress. |
| **Voided statements** | A voided answer still counts | The incremental read uses a `verb=assessed` filter, so it doesn't see `voided` statements. Do a **full rebuild** when the cache is created (server start, which includes every `apply`), at most every 24 h, and on demand ("Recompute levels" on the Profile page). Voiding is rare (manual data fixes), so this is enough. |
| **`MAX_PAGES` cap** | Read throws past 50k statements | With the cache, only a full rebuild pages through everything. Raise `MAX_PAGES` (e.g. 1,000) or drop it for rebuilds, keeping it as a guard for one-off reads. At 100/day, 50k is ~16 months away. |
| **Different LRS stores** | Local dev and staging show different levels | Levels are per LRS store (`XAPI_LRS_ENDPOINT`). For one history, point local and staging at the **same** store (e.g. `dev` for now). `LRS.md` keeps `pilot` separate on purpose. |

**The evidence cache.** It holds a copy of LRS data and can always be
rebuilt, so it doesn't break the "levels are derived, not stored" rule
(`leitner-method.md` → *Why the levels are derived from statements*).

```
cache[externalId] = { observations: LeitnerObservation[] (by statementId), lastStored: ISO, builtAt: ISO }

read(player):
  if no entry, or builtAt older than 24 h  → full read (all pages), rebuild entry
  else → fetchStatements({ agent, verb: assessed, since: lastStored − 5 s })   // usually 1 page, often empty
         merge by statementId (the 5 s overlap + dedupe covers statements stored in the same instant)
  foldTracks(observations)   // fast: in-memory, a few thousand items

POST /api/yalla/me/results succeeded:
  append the observations just sent (the server built them) → the next read sees them without an LRS call
```

- `since` filters on the LRS **`stored`** time, not `timestamp`. That's
  correct here: a badge game exported days after it was played still has
  a new `stored` time, so it's picked up. Track `lastStored` from each
  statement's `stored` field, so `LeitnerObservation` needs `stored` added
  next to `timestamp`.
- **In memory** is enough for the prototype. Every `apply` starts a fresh
  task, which means a full rebuild on the first read: one slow read per
  deploy. If that gets annoying, persist the cache in a Mongo collection
  (`leitnerEvidenceCache`, safe to delete at any time).
- The badge-game planner (`POST /api/leitner-games`) and
  `GET /api/players/:id/progress` should use the same cache through
  `fetchStudentEvidence`, so all three readers agree.

Tests: incremental merge dedupes the overlap. A badge-game export with an
old `timestamp` but new `stored` is picked up. A rebuild drops a voided
statement. Posted results show up without an LRS read. The fold gives the
same tracks from cache as from a full read.

---

## 6. Exercises: solo Leitner practice

### Planning a session

Reuse the planner rather than writing a second one:

```
POST /api/yalla/me/sessions   { book, chapter, scope: 'chapter'|'review', aspects, count, format }
  → same planning as POST /api/leitner-games (fetchStudentEvidence → foldTracks → planNextGame → generateVocabQuizForPicks)
  → returns { sessionId, format, items[] } — NOT stored as a Game; no stations, badges or card groups
```

Every item comes back with **both** its A–D options and what a typed
answer is checked against. So the learner can switch input on any item
without asking the server again (see [Game formats](#game-formats-and-input-channels)).

Factor the planning part of `LeitnerGamesController.createLeitnerGame`
(everything before `createLeitnerGame` / `leitnerSetup.apply`) into
`LeitnerPlanner.plan(player, input)`. The badge game and YALLA then share it.
The badge-game-only checks (pending export → 409, game in play → 409) still
apply, so YALLA doesn't plan on levels that are about to change. YALLA shows
these as a message, not an error page.

`sessionId` is a UUID v4 made by the server. It becomes
`context.registration`, and nothing is saved in Mongo. The session lives in
the client (and `localStorage`, so a refresh keeps it).

### Game formats and input channels

The badge games fix how an answer gets in: the student taps an **NFC card**
(A–D) at their **badge** station. YALLA is the first game that answers
another way. Rather than hard-coding "YALLA = typing", treat **how the
learner answers** as an option of a **game format**. A format can later
add other inputs (other sensors, voice, handwriting) without changing the
Leitner rules or the statements' meaning.

**Terms**

| Term | Meaning | Values today |
| --- | --- | --- |
| **Aspect** | What is tested (unchanged, `leitner-method.md`) | `reading`, `writing` (`listening`, `speaking` later) |
| **Response format** | The shape of the answer, i.e. the xAPI `interactionType` | `choice` (A–D), `fill-in` (typed text) |
| **Input channel** | The device or control the answer arrives through | `nfc-card` (badge games), `onscreen-choice` (tap/click A–D, or press A–D on a keyboard), `keyboard` (typed text) |
| **Game format** | Per aspect: which input channel to use, plus the learner's defaults | see below |

A response format can come through several channels. `choice` comes
through `nfc-card` in the badge games and through `onscreen-choice` in
YALLA, with the **same A–D slot labels** (`QUIZ_SLOT_LABELS`) and the same
generator, so a YALLA multiple-choice item looks like a badge-game
question. Future channels just add rows. For example, a button box or
sensor station sending `choice`, or a speech recogniser sending `fill-in`.

**YALLA's formats (v1)**

| Aspect | Prompt | Input options | **Default** | Typed answer is checked against |
| --- | --- | --- | --- | --- |
| **writing** | English gloss | `keyboard` (type the Korean) **or** `onscreen-choice` (A–D Korean spellings, as in badge Leitner games) | **`keyboard`** | the learning object's Korean `word` |
| **reading** | Korean word | `onscreen-choice` (A–D meanings, as in badge Leitner games) **or** `keyboard` (type the English) | **`onscreen-choice`** | the learning object's English answer (the gloss), **exactly** |

- **Choosing and switching:**
  - The **session setup** screen shows the input per aspect, preset to the
    learner's defaults.
  - The **practice card** has a toggle (`⌨ Type` / `A–D Choose`) that
    switches input for the current item and the rest of the session.
  - Toggling is allowed **before** answering an item, not after seeing
    the options, so it can't be used to peek.
- **Saved preferences:** the learner's choice is saved as their format
  (`localStorage` in Phase 1; `User.preferences.yallaFormat` when Y2's
  `User` exists, so it follows them across devices). "Reset to defaults"
  restores writing = keyboard, reading = choice.
- **Keyboard shortcuts for choice:** `A`/`B`/`C`/`D` (and `1`–`4`) select
  an option; `Enter` submits typed answers. These are for the web app;
  on mobile, the options are large tap targets.

**Checking typed answers.** This is a shared module, so the client gives
instant feedback and the server re-checks.

- **writing** (Korean): Unicode **NFC**, then trim and collapse inner
  whitespace. Otherwise the text must equal the learning object's `word`.
  Accept-lists (`acceptedAnswers` in the sense registry) can be added
  later for real variants.
- **reading** (English): **exact** match to the learning object's English
  answer, as you specified. Only invisible differences are ignored: trim,
  collapse whitespace, NFC. Case and punctuation inside the answer must
  match. Glosses such as `test, exam` must then be typed in full, so this
  is strict on purpose. If it turns out too strict, an accepted-answers
  list can be added per sense without changing the format.
- **"Don't know / reveal"** counts as **incorrect** in both.
- **Inputs:** `autocapitalize="off" autocorrect="off" spellcheck="false"`;
  `lang="ko"` for writing so mobile keyboards switch to Korean, and
  `lang="en"` for reading.
- **Feedback:** after a wrong typed answer, show the expected answer with
  the differences highlighted, so an "almost" is easy to see. It's still
  scored as wrong.

**Evidence weight.** Both channels give `direct` evidence of equal weight
in v1 (open question 2). The statements record the channel, so the fold
can weight `keyboard` above `onscreen-choice` later and recompute history.

**The server decides correctness.** The client sends the raw response, and
`POST /api/yalla/me/results` re-checks it against the content before it
writes `result.success`. A tampered client can't mark its own answers
correct.

### Recording results: statements

Practice answers must look like Leitner-game evidence, or `foldTracks` will
skip them. `observationsFromStatements()` keeps an `assessed` statement only
if it has an LO IRI object, `ext/aspect`, `ext/source-ref`,
`ext/strength = direct` and an `ext/game-kind` in `countedGameKinds`.

So, per answer, YALLA sends (via `statement-builder.ts`):

- an **`answered`** statement: question detail, `result.response` = the raw
  typed text or the chosen slot (`A`–`D`), `interactionType` `fill-in`
  (keyboard) or `choice` (on-screen A–D), with `choices` and
  `correctResponsesPattern` as the badge games send them;
- an **`assessed`** statement: object = the learning-object IRI, the same
  extensions as the badge games, with **`ext/game-kind = 'yalla-solo'`**
  and a new **`ext/input-channel = 'keyboard' | 'onscreen-choice'`**.
  Badge-game statements should start sending `ext/input-channel = 'nfc-card'`
  too, so every answer records how it was given. Older statements without
  it read as `nfc-card`.
- one **`completed`** statement per session (optional, for LRS dashboards).

Actor = the linked `Player.externalId` (`buildActor`). Registration =
`sessionId`. Statement IDs = UUID v5 of `{sessionId}:{attemptId}:answered|assessed`,
so outbox retries are idempotent.

**Decided (L23, 2026-10-30):** add `'yalla-solo'` to
`DEFAULT_LEITNER_CONFIG.countedGameKinds`, so one learner gets one Leitner
schedule across badge games and YALLA. Record it in `leitner-method.md`'s
decision table. Still open: a **typed** correct answer is stronger evidence
than a multiple-choice one. Count both as `direct` for v1. If it matters
later, use `input-channel` in the fold. History is recomputed, so this can
change freely.

### The outbox (unchanged from revision 1)

```
answer → outbox (localStorage/IndexedDB) → POST /api/yalla/me/results → statements → LRS
```

An entry leaves the outbox only after a 2xx response. The server sends to
the LRS **synchronously** in that request (a batch of ≤ 20 attempts), so
2xx means the evidence is in the LRS.

### What changes from revision 1

- ~~Leitner state in IndexedDB, rules moved into a shared package~~: the
  server already derives Leitner state from the LRS. The client doesn't keep
  its own copy (except as an offline cache in stage B), and the rules stay
  in `server/src/learning/leitner.ts`.
- ~~`object.id = {base}/learning-objects/{loId}`~~: use the existing
  learning-object IRI, `{base}/lo/{language}/{kind}/{enc(word)}/{sense}`
  (`learning-object.ts`).
- Open question 1 (shared Leitner state between games and practice) is
  answered by L23 above: shared, through the LRS.

---

## 7. API summary (new)

All behind `requireAuth`. All `me` routes resolve the learner from the token.

| Method & path | Purpose | Reuses |
| --- | --- | --- |
| `GET /api/me` | Upsert `User` from `sub`; return user + linked player | — |
| `PUT /api/me/player` | Link/unlink a player `{ playerId }` or create `{ create: { firstName } }` | `PlayerRepository` |
| `GET /api/yalla/books` | Book catalogue (slug, title, language, chapter titles) | new catalogue next to `book-content.ts` |
| `GET /api/yalla/books/:book/chapters/:chapter` | Full chapter JSON + LO ids on vocabulary | chapter JSON imports |
| `GET /api/yalla/me/progress` | Tracks + summary for one chapter | `fetchStudentEvidence`, `foldTracks`, `buildProgress` |
| `GET /api/yalla/me/progress/book` | Per-chapter summaries, one LRS read | same |
| `POST /api/yalla/me/sessions` | Plan a practice session | `planNextGame`, `generateVocabQuizForPicks` (factored out) |
| `POST /api/yalla/me/results` | Re-check answers, build + send statements | `statement-builder.ts`, `lrs-client.ts` |

Book and chapter content endpoints could be public, but keep them behind
auth too. It's simpler, and the content comes from a commercial book.

---

## Hosting options when staging is destroyed

Unchanged from revision 1, briefly:

| Option | Works when staging is destroyed? | Monthly cost | When |
| --- | --- | --- | --- |
| **A.** Practise only when staging is up, or locally (phone on the LAN via Vite `--host`, or Tailscale) | No | Same as today | **Now** |
| **B.** Offline-first PWA: cached app shell, chapter content and last-known tracks, plus the outbox | Partly: practise cached content, sync on next `apply` | Same as today | Later |
| **C.** Persistent tier kept out of the destroyable stack: S3 + CloudFront client, Cognito, Lambda for the `/api/yalla/me/*` routes, SSM secret | Yes | ~$0–2 | Maybe |

Revision 2 notes for B and C:

- **B:** with Leitner state on the server, offline practice can't plan
  new sessions. Plan **ahead while online**: cache one or two sessions per
  chapter, plus the last progress response, and answer them offline. A
  cached session goes stale once its words are answered elsewhere. That's
  acceptable: the next plan corrects it.
- **C:** the Lambda needs the same pieces as the Express routes:
  user ↔ player link (Mongo), content and the LRS. If Atlas is an
  always-on M0, the Lambda can reuse the same repository code. If not, the
  user ↔ player link is a few rows: move them to DynamoDB (on-demand,
  effectively free). Cognito and Atlas are already outside Terraform
  (see §4), so they need no move. Only the client hosting and the Lambda
  would be new persistent pieces.

---

## Phased plan

### Phase 0: decisions and checks

- [x] **L23**: count `yalla-solo` in `countedGameKinds`. **Yes**
      (2026-10-30). Recorded in `leitner-method.md`. (L20–L22 were
      already taken, so revision 3's "L20" is now L23.)
- [x] **D14** (security.md): users link themselves to any player for
      the prototype. **Yes** (2026-10-30). Recorded in `security.md`,
      worded so it doesn't contradict D1 ("players never log in"): the
      person who logs in is a `User` practising *as* a player. It has to be
      revisited before children use YALLA.
- [x] Does `terraform destroy` delete the Cognito user pool? **No.** The
      pool isn't managed by Terraform (§4), so `sub`s stay stable.
- [x] Does `fetchStatements` follow LRS `more` links past 500? **Yes**,
      up to 50k statements, then it throws. Accuracy and speed plan:
      [§5 → Keeping Leitner levels accurate](#keeping-leitner-levels-accurate-as-history-grows).
- [x] Is Atlas destroyed with the stack? **No.** It's outside Terraform, so
      the `User` ↔ `Player` links survive. (Whether it's an always-on M0
      only matters for stage C.)
- [x] Which LRS store do local dev and staging share? **The same store
      (`dev`) for now** (2026-10-30), so there is one Leitner history.

### Phase 1 (stage A): YALLA in the emoji-app, as milestones

Phase 1 is split into six milestones. Each one is a separate piece of work
that leaves the app working, can be tested locally with `npm run dev`,
and gives something you can try before the next one starts. Each depends
only on the ones before it. Y6 is the exception: it can move earlier if
reads get slow.

| # | Milestone | Touches the LRS? | You can… |
| --- | --- | --- | --- |
| Y1 | Shell and study pages | No | browse books, chapters, dialog, vocabulary, patterns |
| Y2 | Identity | No | link your login to a player on the Profile page |
| Y3 | Progress and pills | Read | see your badge-game levels as pills |
| Y4 | Practice: on-screen multiple choice | Read + write | practise reading and writing with A–D, and see pills (and the next badge game) change |
| Y5 | Practice: keyboard input and switching | Read + write | type Korean (writing default) or English (reading option), and switch between typing and A–D |
| Y6 | Evidence cache | Read | same as before, but fast with long histories |

#### Y1: shell and study pages (no identity, no LRS) ✅ built 2026-10-30

- [x] `requireAuth` attaches `req.auth` (`sub`); fixed `local-dev` identity
      when `DISABLE_AUTH`. All `/api/yalla/*` routes use it, through the new
      Nest `AuthGuard` (`server/src/auth.guard.ts`; both share
      `authenticate()` in `auth.ts`).
- [x] Book catalogue (`server/src/learning/book-catalogue.ts`, which
      `book-content.ts` now uses too, so there's one chapter list) +
      `GET /api/yalla/books`, `GET /api/yalla/books/:book`,
      `GET /api/yalla/books/:book/chapters/:chapter` (full chapter JSON +
      LO ids on vocabulary) in `server/src/yalla/`.
- [x] `canUseYalla()`; YALLA header link (desktop nav + mobile menu);
      `<RequireYalla>` guard; view titles.
- [x] YALLA layout: left sidebar (desktop), bottom tab bar (mobile).
- [x] Books → book detail → chapter → dialog / vocabulary / patterns,
      ported from `language-learning-app` to Radix/Tailwind
      (`client/src/app/yalla/`). Exercises is a placeholder. Pills are not
      shown yet.
- [x] Specs: 401 without a token, wrong app client, `DISABLE_AUTH`
      ignored in production (`auth.guard.spec.ts`); content and controller
      specs (`server/src/yalla/*.spec.ts`). Playwright
      (`playwright/tests/yalla.ui.spec.ts`): header link, all five
      chapters × four sections, tap to reveal, API. The signed-out
      redirect isn't covered by e2e, because e2e always runs with auth
      disabled. Check it by hand on staging after Y2.

**Done when** you can study every chapter on desktop and phone, and
YALLA is invisible when signed out.

Known limitation (existing app behaviour): the Cognito access token is
only kept in memory, so reloading a `/yalla` page while signed in sends
you back to `/`. Fix this in Y2 together with the user record, e.g. by
keeping the token in `sessionStorage`.

#### Y2: identity (user ↔ player) ✅ built 2026-10-30

- [x] `User` upsert from `sub` (`server/src/persistence/user.repository.ts`);
      `GET /api/me`; `User.playerId` (unique per player, partial index
      `uniq_user_per_player`); `PUT /api/me/player` (link `{ playerId }`,
      unlink `{ playerId: null }`, create `{ create: { firstName } }`;
      400 / 404 / 409) in `server/src/me.controller.ts`;
      `LearnerService.resolveLearner(req)` (403 `No linked player`) in
      `server/src/learner.service.ts`. `/api/me` never returns the
      `externalId`.
- [x] Profile page: "Practise as" card (pick, create, unlink). The Profile
      link now also shows in local dev (auth off), where you're the
      `local-dev` user. YALLA home shows "Practising as …" or "Link your
      profile to a player".
- [x] D14 recorded in `security.md` (done in Phase 0).
- [x] Specs: learner always from the token, never the body (extra body
      keys are rejected); 409 when another user has the player; dangling
      link reads as unlinked (`learner.service.spec.ts`,
      `me.controller.spec.ts`, `user.repository.spec.ts`). Playwright
      `yalla-identity.spec.ts`: create + link, link existing + reload, API
      validation.
- [x] Reload fix: the access token is kept in `sessionStorage` for the tab
      (dropped once expired), so reloading `/yalla` or `/profile` no
      longer signs you out (`client/src/app/auth/auth.store.ts`).
- [ ] *(Optional, not done)* replace `DEMO_CREATOR_ID` with the signed-in
      user's id. Games still record the demo referee as creator.

**Done when** the link survives signing out and back in. First
`terraform apply`: check this with your real Cognito login on staging.
Also check by hand that YALLA and Profile are hidden when signed out, and
that a reload keeps you signed in (e2e runs with auth off, so it can't).

#### Y3: progress and pills (read-only LRS)

- [ ] Factor `LearningProgressService` out of `getProgress`;
      `GET /api/yalla/me/progress` and `/book` (one LRS read for the
      whole book).
- [ ] Pills (`TypeBadges` port): not-retired + due per aspect;
      listening/speaking disabled; "–" without a link. Pill filter on the
      vocabulary list; level dots per word; `pendingExport` banner.
- [ ] Book detail shows per-chapter pills.
- [ ] Specs: the YALLA progress endpoint and the existing player
      progress endpoint return the same tracks for the same player.

**Done when** the pills for your linked player match Players → detail
for the same player (evidence from existing badge games).

#### Y4: practice, on-screen multiple choice (first LRS writes)

- [ ] Add `yalla-solo` to
      `countedGameKinds`.
- [ ] Factor `LeitnerPlanner.plan` out of `createLeitnerGame`;
      `POST /api/yalla/me/sessions`.
- [ ] `POST /api/yalla/me/results`: server re-checks answers; `answered`
      + `assessed` (+ `completed`) with `game-kind = yalla-solo`,
      `input-channel = onscreen-choice`; UUID v5 statement ids. Add
      `input-channel = nfc-card` to badge-game statements.
- [ ] Client: session setup (chapter/review, aspects), practice card with
      A–D options for **both** reading and writing (same slot labels as
      the badge games; tap, click or press A–D/1–4), summary; outbox
      (localStorage); flush before progress reads and plans.
- [ ] Game format model in place (`{ reading: channel, writing: channel }`),
      but only `onscreen-choice` is offered. Writing's `keyboard` default
      takes effect in Y5.
- [ ] Specs: idempotent statement ids (re-post = no duplicates), the fold
      counts `yalla-solo`, a tampered `correct` flag is ignored.

**Done when** answering in YALLA moves your pills, and the next badge-game
plan for the same player reflects it. Check this on staging too.

#### Y5: practice, keyboard input and switching

- [ ] Shared answer checker: writing = NFC + whitespace, equal to the
      `word`; reading = **exact** gloss (trim, whitespace, NFC only).
      Unit tests with real Hangul IME input and with glosses that contain
      commas.
- [ ] `keyboard` channel for **writing (default)** and **reading
      (option)**; `fill-in` interactions; `input-channel = keyboard`;
      `lang="ko"` / `lang="en"` inputs, no autocorrect/autocapitalize;
      differences shown after a wrong answer.
- [ ] Defaults: writing = keyboard, reading = onscreen-choice. Session
      setup per-aspect picker, in-session `Type` / `Choose` toggle
      (before answering only), saved preference (`localStorage`, then
      `User.preferences.yallaFormat`), "Reset to defaults".
- [ ] Mobile pass: the keyboard doesn't cover the prompt; Enter submits.
- [ ] Playwright: typed practice moves a track's level.

**Done when** you can do a full typed session on your phone (LAN or
staging).

#### Y6: evidence cache

- [ ] Per-player cache in `fetchStudentEvidence`: incremental `since`
      reads, rebuild on start / every 24 h / "Recompute levels"; append on
      posted results; `stored` on `LeitnerObservation`; raise `MAX_PAGES`
      for rebuilds.
- [ ] Specs as listed in §5 → *Keeping Leitner levels accurate*.

**Done when** progress views make ~1 LRS request, and results from the
cache match a full read. History is small today, so Y6 can wait until
after Y5. Move it earlier if progress views get slow.

### Phase 2 (stage B): installable, offline

- [ ] `vite-plugin-pwa`; cache app shell, chapter content, last progress
      and pre-planned sessions.
- [ ] Offline practice with an expired token; sign in again only to sync.
- [ ] "N answers waiting to sync" indicator.

### Phase 3 (stage C, only if needed): always available

- [ ] Split Terraform into `persistent/` and `staging/`; Cognito,
      S3 + CloudFront, Lambda for `/api/yalla/me/*`, SSM secret.
- [ ] User ↔ player links in an always-on store (M0 or DynamoDB).

---

## Open questions

1. ~~Should typed reading be offered?~~ **Decided (2026-10-30):** yes, as
   an option. Reading defaults to multiple choice, and a typed answer
   must match the English answer exactly. Still open: is exact matching
   too strict for glosses like `test, exam`? Revisit after using Y5.
2. Should typed answers count as **stronger evidence** than multiple choice
   (e.g. a correct typed answer skips a level)? v1 says no.
3. Should a user be able to link to a player that a **referee** also uses in
   badge games? That's the point of sharing tracks, but it means the user
   sees that player's history. That's fine for a pilot of one, but not for a
   class.
4. Do dialog lines and pattern sentences need learning objects (and pills)
   soon, or is vocabulary enough for the pilot?
5. ~~Game formats beyond YALLA~~ **Decided (2026-10-30):** yes, as a
   future improvement after Phase 1. Badge games become a format
   (`nfc-card`), and one "create a game" flow picks the input per aspect.
   See [`future-game-formats.md`](./future-game-formats.md). It's on the
   roadmap in `../server/milestones.md` → *Feature roadmap: learning*.
