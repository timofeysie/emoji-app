# Creating games with Hashbrown

Status: **H0 to H3 built** (H0–H2 2026-11-21, H3 2026-11-22): single game
creation on the Draft Game page and in the chat, library chapters in YALLA,
and Leitner games and YALLA Exercises on library chapters. H4 (grammar
learning objects) is next.

> ⚠️ **Text length is a standing design issue.** How long a question or an
> option can be depends on the smallest screen that shows it: student
> view, referee view, chat card and, maybe later, the badges' 128×128
> LCD. The limits are a guess that has only been checked against the code,
> not on real screens. Read [Text length and screens](#text-length-and-screens)
> before changing a limit, adding a screen, or showing game text somewhere
> new. Added 2026-11-20, revised
2026-11-21 with answers to the first round of open questions.

A signed-in user pastes content, for example a few paragraphs of a Korean
story, and the AI turns it into something playable. There are two features:

1. **Single game creation.** The pasted content becomes one ready-to-play
   game of ten multiple-choice questions. It plays and exports to the LRS
   like any class game today.
2. **Reusable content (library chapters).** If the user asks for it, the
   pasted content also becomes a chapter in the same shape as a YALLA
   library book chapter: the passage, vocabulary and grammar patterns. Its
   vocabulary becomes learning objects, so Leitner games and YALLA practice
   can track it across many games.

There are two ways in, both using Hashbrown and the server's
`OPENAI_API_KEY` through `POST /api/chat`:

- the **chat panel** (`RichChatPanel.tsx`), for quick requests
- a **Draft Game page**, opened from a **Draft Game** button next to New
  Game and New Leitner Game. It has more room for building a game
  interactively, and the user can keep several drafts on the go.

Neither changes the xAPI statement shape.

> **Revision (2026-11-21):** answers to the first open questions.
> - The default question mix is **vocabulary-heavy**, with presets and a
>   user guide for asking for other mixes.
> - Games have **4 options by default, up to 5** when the card group has
>   an E card.
> - Content is **open by default** so referees can remix and share it.
> - "Make a game" **doesn't** save a chapter unless asked, but **always
>   keeps the pasted text** as a content source.
> - The **Draft Game page** is added to H1.
> - Grammar-pattern identity is **decided** (option B, smallest teachable
>   patterns), recorded as A4 in `learning-objects.md`. See
>   [Decided: grammar-pattern identity](#decided-grammar-pattern-identity-a4).

Related:

- [`ruff-hashbrown/docs/hashbrown-examples.md`](../../../ruff-hashbrown/docs/hashbrown-examples.md):
  the components, tools and triggers patterns this plan uses
- [`../xAPI/xapi-export-plan.md`](../xAPI/xapi-export-plan.md): class-game
  export (Steps 1a–1c), player bindings, referee-only writes (`RefereeGuard`)
- [`../xAPI/leitner-method.md`](../xAPI/leitner-method.md): tracks, the sense
  registry, `Question.learning` tags, `assessed` statements (L16–L18, L23)
- [`../xAPI/learning-objects.md`](../xAPI/learning-objects.md): A1–A3, the
  `grammar-pattern` kind, "AI-suggested, human-confirmed" authoring (§7)
- [`../games/game-planning.md`](../games/game-planning.md): `ContentSource`,
  the `freeform-ai` importer, the teacher authoring flow with Hashbrown tools
- [`../yalla/implementation-plan.md`](../yalla/implementation-plan.md),
  [`../yalla/future-game-formats.md`](../yalla/future-game-formats.md): YALLA
  books and practice, the future single "create a game" flow
- [`../xAPI/security.md`](../xAPI/security.md): prototype guardrails (D12),
  organisations (D8)

---

## Where we are today

| Area | Today |
| --- | --- |
| Chat | `RichChatPanel.tsx` is still the smart-home sample: `getLights`, `controlLight`, `deleteScene`, the DOM tools, and a lights-only system prompt (`gpt-4.1`). It has no game tools. `POST /api/chat` requires sign-in, and guests don't see the panel. |
| Class games | `POST /api/games` (title only), then `POST /api/questions` one at a time (`createQuestionSchema`: text, mode, 2–5 options with slot labels A–E, optional `learning` tag). Questions can also come from `create:vocab-game`. Games show in a list everyone can see. |
| Leitner games | `POST /api/leitner-games` plans from the LRS and generates reading and writing questions with `vocab-choice.ts` (4 options, `QUIZ_SLOT_LABELS`). Takes a `book` (default `korean-language-book`) and a `chapter`. |
| Books | Static. `BOOK_CATALOGUE` imports `chapter26–30Data.json`, and `ko-senses.json` is a committed file written by `npm run content:senses`. `getBookContent()` caches one `BookContent` per book. |
| xAPI | Class games export `answered` plus `scored`. Tagged questions also export `assessed` on the learning object. Leitner games and YALLA (`leitner-solo`, `yalla-solo`) count toward tracks, and class games don't. |
| Hashbrown | 0.4.1. `@hashbrownai/react` exports `useUiChat`, `useTool`, `exposeComponent`, `useStructuredCompletion`, `useStructuredChat` and `useToolJavaScript`. |

The gap is mainly **content storage**. Books, chapters and senses only exist
as compiled JSON, so a user-made chapter has nowhere to live. Single games
need much less: their questions fit the existing `Question` and
`AnswerOption` models as they are.

---

## Decisions

G1–G15 are this plan's design locks. ⚠️ marks the ones that leave a
permanent mark in the LRS.

| # | Decision | Why |
| --- | --- | --- |
| G1 | **Nothing the AI makes is playable until a person accepts it.** The AI's output becomes a server-side **draft**, which the user edits and then accepts or discards. | Generated questions can be wrong, and LRS statements are permanent. Matches game-planning's "AI items with review" and learning-objects §7 ("AI-suggested, human-confirmed"). |
| G2 | **In the chat, the AI's structured output goes in a tool call's arguments, not in component props.** A `proposeGame` / `proposeChapter` tool takes the full Skillet schema. Its handler saves a draft and returns a `draftId`. The AI then renders `<GameDraft draftId=… />`. | Large payloads are validated once, survive the chat panel unmounting, and open in the Draft Game page. Components stay small. |
| G3 | **The server validates everything again with Zod** before a draft is saved or accepted. | Skillet describes shape, not limits (exactly one correct option, lengths, counts). The client-side schema is a hint to the model, not a guarantee. |
| G4 | **Single games are class games** (`kind: 'class'`) with **untagged** questions. They export `answered` plus `scored` and nothing else. | No change to export, bindings, Play Again or the statement builder. The pasted story has no learning objects yet, so `assessed` evidence would be invented. |
| G5 | **Library chapters use the `kogs.chapter.v1` shape** that `chapterNNData.json` uses (titles, `dialog`, `vocabulary`, `patterns`). The story's paragraphs become `dialog` lines with an empty speaker. | YALLA's study pages, `chapterVocabulary()`, the sense registry and the vocabulary generator already read this shape. No second format to support. |
| G6 | **User books live in MongoDB** (`ContentSource`, `Book`, `Chapter`), next to the built-in catalogue. `getBookContent()` reads both. | Matches game-planning's storage decision. The built-in JSON books keep working unchanged. |
| G7 | ⚠️ **New senses go into a DB layer on top of the language registry**, still language-scoped (A1). The AI must reuse an existing sense when the meaning matches, and the user confirms each new one. | One `배/pear` everywhere, whoever's book teaches it. A sense slug is part of the learning-object IRI once a statement uses it. |
| G8 | ⚠️ **A published chapter is frozen.** Glosses and titles can be corrected. Vocabulary can be appended, but entries can't be reordered or removed. | `sourceRef` is the entry's index (`ch1/vocabulary/3`) and goes to the LRS as `ext/source-ref`. |
| G9 | ⚠️ **The user book slug is `{title-slug}-{4 hex}`**, editable before the first publish and then fixed. The UI warns not to put names in it. | The slug is in the grouping IRI (`…/content/{book}/chN`) and in `source-ref`. |
| G10 | **Vocabulary first, grammar later.** Patterns are stored and shown in YALLA from H2, but they don't become learning objects until H4. Their identity is decided ([A4](#decided-grammar-pattern-identity-a4)), but the registry and a grammar generator come with H4. | Keeps H1–H3 to what already works (vocabulary). |
| G11 | **Pasted content goes to OpenAI, and published content is visible to every signed-in user.** The paste box says both. The prototype guardrails apply: no children's personal data, no names in content that reaches the LRS. | security.md D12. Game titles, question text and the book slug all reach the LRS. Content is open (G12). |
| G12 | **Content is open by default.** Every signed-in user can see and play published books, chapters and games, and can **remix** them into their own copy. Only the owner edits the original. Remixes credit the source by title only, never by the referee's name. Drafts are private by default, and the owner can **share** one (G14). | Referees remix and share each other's work. Organisations (security.md D8) can narrow this later with a `visibility` field that already exists. |
| G13 | **The pasted text is always kept as a `ContentSource`, but "make a game" doesn't save a chapter** unless the user asks. A game made from a source offers **Save as library chapter** later, which reuses the source. | Keeping the text costs little and means it never has to be pasted again. A chapter needs sense decisions, which is more work than a quick game should ask for. |
| G14 | **Drafts can be shared (for now).** The owner clicks **Share** on a draft, and it appears in every signed-in user's **Shared drafts** list. Anyone signed in can open and edit a shared draft, and the `revision` check stops two people overwriting each other. Only the owner can accept, unshare or delete it. Anyone can **Duplicate** it into a draft of their own. | Lets referees build a game or chapter together before it's published. Private by default because a fresh draft holds pasted text that nobody has reviewed yet. Narrow it with organisations later (D8). |
| G15 | **Length limits come from the smallest screen that shows the text.** One pair of numbers (`maxPromptLength`, `maxOptionLength`) is shared by the prompt, the editor and the server. Any new screen that shows question or option text must be checked against them, or get its own limits, before it ships. See [Text length and screens](#text-length-and-screens). | A question that doesn't fit is unplayable, or silently cut off. The AI only keeps to limits it's told, and the server is the only real guard (G3). |

---

## Feature 1 — Single game creation

### The user's flow (chat)

1. A signed-in user opens the chat and pastes a few paragraphs, for example:
   *"Make a game from this story: 옛날 옛적에 …"*
2. The AI reads the passage and calls `proposeGame` with a title and ten
   questions in the default **vocabulary** mix (see
   [Question mixes](#question-mixes)).
3. The chat shows `<GameDraft draftId=… />`: each question with its options
   and the correct one marked. The user can edit text, change the correct
   answer, delete a question, ask the AI to replace one (*"question 4 is too
   easy, make it about the grammar"*), or **Open in Draft Game** for more
   room.
4. **Create game** accepts the draft. The server creates the game and its
   questions in one go and returns the `gameId`. The card links to the
   referee view.
5. From there it's an ordinary class game: attach a card group, start, play,
   complete, bind players, **Export to LRS**.

### The user's flow (Draft Game page)

1. On **Games**, the user clicks **Draft Game**, next to **New Game** and
   **New Leitner Game**. It opens `/games/drafts`, the list of their drafts
   (title, question count, last edited, status).
2. **New draft** opens `/games/drafts/:draftId`, with two panes:
   - **Source** (left): the pasted text, a language pair (`ko → en`), a
     **mix** preset and an **options per question** picker (4, or 5).
   - **Questions** (right): empty until the user clicks **Generate**.
3. **Generate** runs `useStructuredCompletion` with the same game schema as
   the chat tool, through the same `/api/chat` endpoint. The questions
   stream in, and the draft is saved as they arrive.
4. The user works through the questions, using:
   - edit, reorder, delete, add a blank question
   - **Regenerate** one question (with an optional note: *"harder"*,
     *"about 았더니"*)
   - **Generate more** to add to the list
5. Drafts save as the user edits, so they can leave and come back, and keep
   several drafts at once. Drafts made in the chat show up in the same list.
   A second tab, **Shared drafts**, lists drafts other referees have
   shared (G14). **Share** on a draft puts it there.
6. **Create game** accepts the draft, as in the chat. The draft stays in the
   list as *accepted* with a link to its game, and **Duplicate** starts a new
   draft from it.

The editor is one component, `GameDraftEditor`. The page shows it full
size. The chat's `GameDraft` card shows a compact version with the main
actions and an **Open in Draft Game** link.

### Question mixes

The default is **vocabulary-heavy**, unless the user asks for something
else.

| Preset | Comprehension | Vocabulary | Grammar | When |
| --- | --- | --- | --- | --- |
| **Vocabulary** (default) | 2 | 6 | 2 | Learning the words in a new passage |
| **Balanced** | 4 | 3 | 3 | A general check after studying the passage |
| **Comprehension** | 6 | 2 | 2 | Checking that the story was understood |
| **Grammar** | 2 | 2 | 6 | Practising the passage's patterns |
| **Custom** | any | any | any | The user gives the counts or a total |

These are for 10 questions, and the AI scales them for other counts. Other
rules for every mix:

- **4 options by default** (A–D), exactly one correct. The user can ask
  for **5** (A–E). See [Options per question](#options-per-question).
- **Language:** the prompt in the learner's native language (English by
  default). Options in Korean where the question tests Korean, otherwise in
  English.
- **Distractors** must be plausible: the same part of speech, words from the
  same passage, or the right word in the wrong form.
- **Vocabulary questions** ask about words in the form the passage uses,
  and say what the dictionary form is in the explanation.
- **Short text,** so it fits the screens that show it: prompts ≤ 120
  characters, options ≤ 60 (40 until 2026-11-21). See
  [Text length and screens](#text-length-and-screens).
- **Each question cites its sentence** (`sourceExcerpt`), shown in the draft
  for review only. It isn't saved on the question and doesn't go to the
  LRS.

**User guide.** H1 adds `docs/hashbrown/asking-for-games.md`, a short guide
for users with example requests. The Draft Game page links to it, and the
chat's welcome message gives two of its examples. For instance:

| You want | Ask |
| --- | --- |
| The default | *"Make a game from this story: …"* |
| Comprehension-heavy | *"Make a comprehension game from this: …"* or *"Mostly questions about what happens in the story"* |
| Balanced | *"Make a balanced game: some vocab, some grammar, some comprehension"* |
| Exact counts | *"12 questions: 8 vocabulary and 4 grammar"* |
| Five options | *"Use five options per question"* (needs a card group with an E card) |
| A focus | *"Focus on verbs"*, *"Only the grammar pattern -았/었더니"* |
| A change afterwards | *"Make question 4 harder"*, *"Replace the last two with comprehension questions"* |

### Options per question

- **4 is the default.** It matches the vocabulary generator and the usual
  card groups.
- **5 is allowed** when the user asks for it or picks it in the Draft Game
  page. The server accepts 2–5 options (slots A–E, as `slotLabelValues`
  and `createQuestionSchema` already allow).
- **Cards have to match.** A game can only be played if its card group has
  a card for every slot its questions use. The referee panel warns when the
  attached group is missing a slot ("question 3 uses E, but this card group
  has A–D"), and **Start** is blocked until it's fixed. The draft page shows
  a note when 5 is picked: *"needs a card group with an E card"*.

### Text length and screens

**Why it matters.** Every question and option is shown on some screen, and
the smallest one decides what fits. The AI keeps to the limits it's told
only most of the time, so the server enforces them (G3, G15). A limit
that's too tight blocks good questions: models went over 40 characters for
an option about once a game. A limit that's too loose gives text that
wraps badly or is cut off on a small screen. A wrong answer the player
can't read makes the round worthless, and its `answered` statement still
goes to the LRS.

**Limits now** (`GAME_LIMITS` in `client/src/app/game-authoring/game-limits.ts`
and `GAME_DRAFT_LIMITS` in `server/src/content/game-draft.ts`, kept equal
by `game-draft.spec.ts`):

| Text | Limit | Notes |
| --- | --- | --- |
| Question prompt | 120 characters | |
| Answer option | 60 characters | 40 until 2026-11-21. Raised because models went over 40 often, and the student view wraps options. |
| Game title | 100 characters | Also goes to the LRS. |
| Pasted passage | 8,000 characters | Not shown to players. It bounds the cost and the context. |

**Where the text is shown**, and what's known about each screen:

| Screen | Shows | What happens to long text | Checked |
| --- | --- | --- | --- |
| Student view (`GamePlayView.tsx`), on a projector, laptop or phone | Prompt as an `xl` heading; options in a 2-column grid (1 column on phones), `text-sm` | Wraps onto more lines. Nothing is cut off. | Code only (2026-11-21). Not seen on a phone or projector with 60-character Korean options. |
| Student view, last round's result | Options with who picked them | Wraps. Player names are truncated. | Code only. |
| Referee view (`GameDetailView` questions, guess chart) | Prompt and options | Wraps. | Code only. |
| Draft Game page editor | Title, prompt and options in one-line fields | Ends in "…" with a ⌄. A click or tap expands the field to show and edit all of it, with a "52 / 120" count. ⌃, Enter, Escape or leaving the field collapses it (`shared/ExpandableTextField.tsx`). | Seen on screen: long questions used to be cut off with no way to read them (2026-11-21), which led to this rule. |
| Chat `GameDraft` card | Prompt and the correct option | Wraps. The chat panel is the narrowest place, about 3/7 of a laptop screen. | Code only. |
| Badges (Waveshare 1.44" LCD, 128×128 px, docs/hardware) | Today: no question or option text. `question.opened` sends only ids and the game title. | — | — |
| LRS / Veracity | Prompt and options in the `choice` interaction | No practical limit. | — |

**Character counts are a rough measure.** A Korean syllable is about twice
the width of a Latin letter, so 60 Korean characters take far more room
than 60 English ones. Emoji and combined characters count oddly too. If one
language's text keeps overflowing, the fix is a limit by display width or
by language, not a smaller number for everyone.

**Rule: game text is never hidden.** Every screen either wraps the text, or
cuts it off with an ellipsis that expands on click or tap
(`ExpandableTextField`). A reviewer has to see every word of a question and
its options before accepting them. Clipping text with no way to read it is
a bug.

**Before changing anything here:**
- Change both limit files together. The spec fails otherwise.
- Look at the student view on the smallest real screen in use, with the
  longest allowed text, in Korean and in English, at 4 and 5 options.
- **Showing game text on the badges** would need its own, much smaller
  limits. A 128×128 screen fits roughly 16–20 Latin characters a line at a
  readable size, and fewer Korean ones. Plan it as an option label or a
  short form (`shortText`), not by cutting text off.
- Any new screen for game text, such as a projector mode or a printed
  sheet, gets a row in the table above.
- **Existing games aren't re-checked.** Hand-made games
  (`createQuestionSchema`) have no length limit at all.

### Hashbrown pieces

Following `hashbrown-examples.md`:

| Kind | Name | What it does |
| --- | --- | --- |
| **Tool** | `proposeGame` | Schema: `title`, `language`, `mix`, `questions[]` of `{ text, options[] of { text, isCorrect }, focus: 'comprehension' \| 'vocabulary' \| 'grammar', sourceExcerpt }`. Handler: `POST /api/content/drafts` with `type: 'game'` and the pasted text as the source. Returns `{ draftId, problems[] }`. When `problems` is non-empty (for example two correct options), the AI fixes them and calls again. |
| **Tool** | `reviseGameDraft` | `draftId` plus a list of changes (replace question *n*, change the title). Lets the AI apply *"make question 4 harder"* without regenerating everything. |
| **Component** | `GameDraft` | Props: `draftId`. The compact `GameDraftEditor` with **Create game**, **Discard** and **Open in Draft Game**. Create calls `POST /api/content/drafts/:id/accept`. |
| **Tool** | `getMyDrafts` | The user's drafts and the shared ones, so the AI can answer *"continue my story game"* and revise the right one. |
| **Tool** | `getGames` | Read-only. Lets the AI answer *"open the game I just made"* or link to it. |
| **Trigger** | `OpenGame` | Props: `gameId`. Navigates to `/games/:gameId`, same pattern as `AddSceneDialogTrigger`. |
| **Trigger** | `OpenDraft` | Props: `draftId`. Navigates to `/games/drafts/:draftId`. |
| **Structured completion** (page) | `useStructuredCompletion` | The Draft Game page's **Generate**, **Regenerate** and **Generate more**. Same schema as `proposeGame`, with the source, mix and option count as input. No chat history. |

**Why a component for Create, when the guide says to use tools for
actions?** The guide's rule is about actions the user asked for directly
("delete the kitchen light"). Here the AI wrote the content, so a person
confirms it before it's playable (G1). The AI never calls `accept` itself.

### Server

- **`POST /api/content/drafts`** (`RefereeGuard`). Body:
  `{ type: 'game' | 'chapter', source: { text, language } | { sourceId }, payload? }`.
  - Saves a `ContentSource` the first time (raw text, `format: 'freeform-ai'`,
    checksum, owner from the token) and a `ContentDraft`. A draft can start
    empty (the Draft Game page's **New draft**).
  - Validates `payload` with the Zod schema for its type. Valid or not, it
    returns the `problems` list so the AI or the page can repair it.
  - Caps the pasted text (about 8,000 characters) and the payload size.
- **`GET /api/content/drafts`** (the user's drafts, newest first;
  `?shared=true` for drafts others have shared),
  **`GET /api/content/drafts/:id`** and **`PATCH /api/content/drafts/:id`**
  (edits, with a `revision` number so two tabs or two people don't
  overwrite each other): the owner, or anyone signed in when the draft is
  shared. **`PUT /api/content/drafts/:id/share`** (`{ shared: boolean }`),
  **`DELETE`** and **accept**: owner only. Each edit records
  `lastEditedByUserId`.
- **`POST /api/content/drafts/:id/accept`** for a game draft:
  - Validates strictly: 1–20 questions, 2–5 options, exactly one correct,
    unique option text, length limits.
  - Calls a new `GameDataRepository.createGameWithQuestions()` (the same
    shape `createLeitnerGame` already uses for its questions) so the game
    and its questions are created together.
  - Sets `Game.origin = { kind: 'ai-draft', contentSourceId, draftId }` and
    leaves `kind: 'class'`.
  - Marks the draft `accepted`. Returns `{ gameId }`.
- **`POST /api/content/drafts`** with `{ type: 'game', fromGameId }` starts
  a new draft from an existing game. That's how **Duplicate** and remixing
  someone else's game work. The new game records
  `origin.remixedFromGameId`.
- Starting a game (`POST /api/games/:id/state` → `active`) checks that the
  attached card group covers every slot the questions use.
- `/api/chat`: raise the `express.json()` limit for this route (the default
  is 100 kB, and a chat history holding a chapter-sized tool call can get
  near it).

### xAPI

Nothing changes in the statement builder.

- `answered` statements carry the question text and the options in the
  `choice` interaction definition, so the Veracity dashboard shows them.
  Five-option questions just have five choices.
- `scored` statements per player work as today.
- The game title goes to the LRS. Default it to something like
  *"Story quiz: 토끼와 거북이"* and never to anything with a person's name
  (G11).
- No `assessed` statements (G4), so single games don't move Leitner levels.
  To get tracked evidence from the same passage, save it as a library
  chapter (Feature 2). Because the source is kept (G13), the game's detail
  view and the accepted draft both offer **Save as library chapter**
  without pasting again.

### New models (shared with Feature 2)

| Model | Fields |
| --- | --- |
| `ContentSource` (`contentSources`) | `ownerUserId`, `format` (`freeform-ai`), `language` (`{ target: 'ko', native: 'en' }`), `title`, `raw`, `checksum`, `createdAt`. Visible to others once a draft using it is shared, or a game or chapter made from it is accepted or published (G12, G14). |
| `ContentDraft` (`contentDrafts`) | `ownerUserId`, `type` (`game` / `chapter`), `sourceId`, `title`, `payload`, `settings` (`mix`, `optionsPerQuestion`), `problems[]`, `status` (`draft` / `accepted` / `discarded`), `shared` (default `false`), `lastEditedByUserId`, `resultRef` (gameId or chapter), `revision`, `updatedAt`. Kept until the user deletes it. Discarded drafts are purged after 30 days. |
| `Game` (change) | Optional `origin: { kind: 'ai-draft', contentSourceId, draftId, remixedFromGameId? }`. Missing means hand-made, as now. |

---

## Feature 2 — Reusable content: library chapters

Only when the user asks (G13): *"add this to my library"*, **Save as
library chapter** on a game or draft, or **New chapter draft** on the
Draft Game page.

### The user's flow

1. The user pastes a story and asks: *"Add this to my library as a
   chapter."* (or saves an existing game's source). If they have no book yet,
   the AI asks for a book title and suggests one.
2. The AI calls `findSenses` for the words it plans to teach, then
   `proposeChapter` with:
   - the passage
   - about 10–15 vocabulary entries
   - 2–3 grammar patterns, each with sample sentences and exercises
   - a sense decision for each word
3. The chat shows `<ChapterDraft draftId=… />`, laid out like YALLA's
   chapter page (Dialog, Vocabulary, Patterns tabs), plus a **Senses**
   column: *reuses `시험/test`* or *new sense `토끼/rabbit` (lexeme)*. The
   user edits and confirms each new sense. The same draft opens full size in
   the Draft Game page.
4. **Publish** accepts the draft:
   - it creates or updates the user's `Book`
   - it adds the `Chapter` with the next chapter number
   - it registers the confirmed senses
   - it clears the `getBookContent` cache for that book
5. The chapter appears in YALLA for every signed-in user (G12). The **New
   Leitner game** dialog and YALLA Exercises can now pick it.

### Open content and remixing

- **Books and chapters are open** (`visibility: 'open'`, the default):
  every signed-in user sees them in YALLA, can play them, can make Leitner
  games and quick games from them, and can see the source text.
- **Remix** copies a chapter (or a whole book) into a book the remixer owns,
  as a new chapter draft they can then edit and publish. The copy records
  `remixedFrom: { book, chapter, revision }`, and YALLA shows "remixed from
  *Title*", with a link. No referee name is shown.
- **Remixing keeps the learning objects.** The copy's vocabulary keeps its
  sense decisions, so a word learned from the original and from the remix is
  one track (A1). Only the provenance (`book`, `sourceRef`) is new.
- **Owners can archive, not delete,** a published chapter. Archived chapters
  disappear from listings, but LRS statements still point at their
  `source-ref`, so the content stays readable by link.
- **Later:** `visibility: 'org'` and `'private'` once organisations exist
  (security.md D8), and a licence field (see [Risks](#risks)).

### What the AI produces (`kogs.chapter.v1`)

| Field | From the passage |
| --- | --- |
| `titleTarget` / `titleNative` | A short title in Korean and English |
| `dialog[]` | One line per sentence or short paragraph: `speechTarget` (as pasted), `speechNative` (translation), empty speaker fields (or the speaker, if the passage is a conversation) |
| `vocabulary[]` | `targetLanguageText` (dictionary form, e.g. `달리다` not `달렸더니`), `nativeLanguageText` (comma-separated glosses, first meaning first, which is what `firstSense()` and `glossParts()` expect) |
| `patterns[]` | `patternTarget`, `patternNative`, `type`, the passage sentence that uses it (`exampleSentenceTarget`/`Native`), 2 `sampleSentences`, 2 `exercises` with `answerKey` |
| `senses[]` (draft only) | For each vocabulary entry: `{ reuse: 'ko/lexeme/시험/test' }` or `{ new: { sense: 'rabbit', kind: 'lexeme', gloss: 'rabbit' } }` |

One Zod schema for this shape (`kogsChapterV1Schema`) replaces the two
partial copies in `yalla-content.ts` and `sense-registry.ts`. Drafts,
publishing and the existing JSON chapters all use it.

### Hashbrown pieces

| Kind | Name | What it does |
| --- | --- | --- |
| **Tool** | `getBooks` | Books and chapters: the user's own, other referees' open books, and the built-in catalogue. |
| **Tool** | `findSenses` | Input: a list of words. Returns the registry's existing senses for each (`{ word, senses: [{ id, gloss, kind }] }`), from the JSON registry and the DB layer. The system prompt says: reuse a sense when the meaning matches, never invent a near-duplicate slug. |
| **Tool** | `proposeChapter` | Schema as above, plus `book` (existing slug) or `newBook: { title }`, and an optional `sourceId` to reuse a kept source. Handler: `POST /api/content/drafts` with `type: 'chapter'`. Returns `{ draftId, problems[] }`. Problems include an unknown reused id, a slug that isn't ASCII, a duplicate word, or fewer than 6 vocabulary entries. |
| **Tool** | `reviseChapterDraft` | Targeted edits (add a word, change a gloss, replace a pattern). |
| **Tool** | `remixChapter` | `book`, `chapter`, target book. Starts a chapter draft from a copy. |
| **Component** | `ChapterDraft` | Props: `draftId`. Review, edit, confirm senses, **Publish**, **Open in Draft Game**. |
| **Trigger** | `OpenYallaChapter` | Props: `book`, `chapter`. Navigates to `/yalla/books/:book/chapters/:chapter`. |
| **Tool** | `createLeitnerGame` (H3) | Wraps `POST /api/leitner-games` with `dryRun: true` first. The AI shows the plan in a `LeitnerPlan` component, and the user clicks Create. Needs `getPlayers`. |

### Server

**Models**

| Model | Fields |
| --- | --- |
| `Book` (`books`) | `slug` (unique, immutable after first publish), `title`, `language`, `ownerUserId`, `visibility` (`open` default; `org`/`private` later), `remixedFrom`, `archivedAt` |
| `Chapter` (`chapters`) | `bookSlug`, `chapter` (string `"1"`, `"2"`, …, unique per book), `content` (`kogs.chapter.v1`), `sourceId`, `remixedFrom`, `publishedAt`, `revision`, `archivedAt` |
| `Sense` (`senses`) | `language`, `word` (normalised), `sense`, `kind`, `gloss`, `sources[]` (book-qualified refs), `createdByUserId`, `createdAt`. Unique on `(language, word, sense)`. |

**Content registry changes**

- `getBookContent(book)`: built-in books load as now. User books load from
  `chapters`. Both merge the JSON registry with the `senses` collection, so
  `senseBySourceRef` and `senseById` see everything. JSON wins on any clash,
  but there shouldn't be one because publishing checks the JSON slugs
  against the unique index.
- The cache becomes clearable per book (on publish). It stays synchronous for
  built-in books. User books need an async loader, so `getBookContent`
  callers (`LeitnerPlanner`, YALLA content, progress) move to an async
  `BookContentService`.
- `listBooks()` / `getBook()` / `getStudyChapter()` list the catalogue,
  then the caller's books, then other open books.
- `book-content.ts`'s `UnregisteredSensesError` stays: a chapter can't be
  published with an entry that has no sense.

**Endpoints**

- `POST /api/content/drafts/:id/accept` for a chapter draft (owner,
  `RefereeGuard`):
  - validates the chapter and the sense decisions
  - checks that reused ids exist
  - checks that new `(word, sense)` pairs don't exist yet (and if one was
    added meanwhile, returns a problem so the user can reuse it)
  - writes `Book`, `Chapter` and `Sense` rows in one transaction
- `POST /api/content/drafts` with `{ type: 'chapter', fromChapter: { book, chapter } }`:
  the remix.
- `POST /api/books/:book/chapters/:chapter/archive` (owner only).
- `GET /api/yalla/books` and friends: include open user books.
- `POST /api/leitner-games`: `book` already exists in the schema. Allow any
  open user book.

### Leitner and YALLA on user books

The planner and generator mostly work as they are once `getBookContent`
can load a user book. Questions get
`learning: { learningObjectId, book: '<user-slug>', sourceRef: 'ch1/vocabulary/3', aspect, target, native }`.
Statements then carry:

- `assessed` on the language-scoped learning object, so a word from a user
  book, its remixes and the same sense from `korean-language-book` share one
  track (A1)
- grouping `…/content/<user-slug>/ch1` and `ext/source-ref`
  `<user-slug>/ch1/vocabulary/3`

Limits to handle:

- **Distractors need enough words.** `readingItem`/`writingItem` draw
  distractors from the same chapter. Require at least 6 vocabulary entries
  per chapter at publish.
- **`writingItem` is Hangul-specific** (`hangul.ts` changes one syllable).
  User books are `ko` only until another language has a writing
  generator. Other languages could get reading-only later.
- **Review scope** (L15) already means "other chapters of this book the
  student has played", so it works per user book without change.
- **YALLA practice** (`yalla-solo`) goes through the same planner, so it
  works once the content service does.

### Grammar as learning objects (H4)

Patterns are in the chapter from the start and shown in YALLA, but nothing
tracks them yet. Doing that needs:

1. ~~The identity decision~~: done, A4 below.
2. The romanisation rule and meaning-slug rule for pattern ids (see A4).
3. A pattern registry, like the sense registry (AI suggests, user confirms
   reuse or new).
4. A cloze generator: the sentence with the pattern blanked, the correct
   form, and diagnostic distractors (right verb wrong pattern, right pattern
   wrong verb; learning-objects §6). It starts with `direct` evidence on the
   pattern only.
5. A Leitner aspect for patterns (`grammar`?) added to `vocabSkillValues` or
   a sibling list.

### Decided: grammar-pattern identity (A4)

**Decided 2026-11-21: option B, smallest teachable patterns.** Recorded
as A4 in [`learning-objects.md`](../xAPI/learning-objects.md#decisions).
The reasoning is kept below.

**What was decided.** When a student answers a grammar question, the
`assessed` statement names the pattern it was about, as an IRI. Whatever
that IRI is, it can't change once pilot statements use it (just like
`ko/lexeme/시험/test`). Two pattern entries need the same IRI when they
teach the same grammar, or the student gets two tracks for one pattern.
So the question is: **what makes two patterns "the same pattern"?**

**Why it's harder than words.** A word has a written form and a meaning,
and the sense registry pairs them. A grammar pattern doesn't have one
written form:

- **Books write patterns differently.** Ch. 27 has
  `계속 더 ADJECTIVE + -아/어/여지네`. Another book might write
  `-아/어지다`, `A-아/어지다` or `~어지다` for the same grammar.
- **Book patterns are often several patterns together.** `계속 더 … -아/어/여지네`
  is `-아/어지다` (become), plus the `-네` ending (noticing something),
  plus the adverbs `계속 더`.
- **The written form has slashes.** Today's id shape is
  `language/kind/word/sense`, and `word` can't contain `/`. So `-아/어/여지다`
  can't go into the id as written.

**The options.**

| Option | Id example | For | Against |
| --- | --- | --- | --- |
| **A. The book's text** | `ko/grammar-pattern/계속 더 ADJECTIVE + -아어여지네/getting-more` | Nothing to look up | The same grammar from two books never matches. Slashes have to be stripped. Long, messy IRIs. Not recommended. |
| **B. A pattern registry with concept slugs** | `ko/grammar-pattern/a-eo-jida/become` | One id per grammar point, whatever the book writes. Fits the sense-registry approach, the AI-suggest-and-confirm flow and A1. The book's text is kept as data. | Needs a registry, and someone (the AI, confirmed by the user) has to decide which entry a book pattern is. The slug needs a romanisation rule. |
| **C. Book-scoped** | `content/korean-language-book/ch27/patterns/0` | No registry, works today | The same grammar in two books, or in a remix, becomes two tracks, and that can't be merged later without voiding statements. Breaks A1. Not recommended. |

**Granularity:** an entry is **the smallest teachable pattern** (`-아/어지다`, `-네`, `-았/었더니`), and a
book pattern lists the one or more entries it teaches (the `partOf` idea in
learning-objects.md §1). A question then gives direct evidence on the main
pattern and, later, indirect evidence on the others.

**The decision:**

- Id `ko/grammar-pattern/<romanised-form>/<meaning-slug>`, e.g.
  `ko/grammar-pattern/a-eo-jida/become`. That keeps the existing four-part
  id shape (`language/kind/word/sense`), with an ASCII form in place of the
  word.
- IRI `{base}/lo/ko/grammar-pattern/<romanised-form>/<meaning-slug>`, and
  activity type `{base}/activity-types/grammar-pattern`. `grammar-pattern`
  becomes a third kind next to `lexeme` and `expression` (A3).
- A pattern registry per language, like the sense registry. Each entry keeps
  the forms books write it in (`-아/어지다`, `A-아/어지다`, `~어지다`) as
  data, not identity.
- A book pattern lists the one or more registry entries it teaches.

**Left for H4 (no permanent footprint until then):** the exact romanisation
rule for the form (for example Revised Romanisation, with endings joined by
hyphens and alternants merged, `-아/어/여` → `a-eo`) and the meaning-slug
rule. They have to be fixed before the first grammar statement goes to the
**pilot** LRS. Trial statements on `emojiapp-dev` can be cleared.

---

## Chat panel changes

`RichChatPanel.tsx` is one 660-line component with the smart-home tools
and prompt. Before adding games:

- Move tools into hooks by area: `useSmartHomeTools()`,
  `useGameAuthoringTools()`, `useLibraryTools()`, each returning its tools,
  components and prompt section. The panel combines them.
- Rewrite the system prompt as sections:
  - who the assistant is (the emoji games and learning app)
  - the smart-home demo, kept short
  - game authoring: the mixes table (vocabulary by default), 4 options
    unless asked, the draft flow, *"never accept a draft yourself"*
  - library chapters: only when asked, reuse senses through `findSenses`,
    the chapter format, the "dictionary form" rule
  - examples in the guide's `<user>` / `<assistant>` style for both flows
- Put the game schema, mix presets and prompt text in one shared module,
  so the chat tool and the Draft Game page's `useStructuredCompletion`
  can't drift apart.
- Keep `gpt-4.1` but put the model name in one constant, so it's easy to try
  another model for long Korean outputs.
- Error handling follows the guide: tool handlers return clear errors (*"fix
  these problems and call proposeGame again: …"*), and drafts carry the
  validation problems.
- The chat stays signed-in only, and the panel is unmounted for guests, so
  drafts are owned by a real user.

### Context indicator

The chat shows how much of the model's context the conversation uses, so
the user can see a long paste or a chapter-sized tool call filling it up.

**When it updates:** once per turn, when the AI has finished answering and
the chat is waiting for the user again. That's when `isSending`,
`isReceiving` and `isRunningToolCalls` all go from working to idle,
including after **Stop**. It doesn't update while the AI is answering. One
user message can make several requests (one per round of tool calls), and
the reading counts all of them.

**What it shows:** a thin bar and a label under the message box, for
example *Context ≈ 12.4k / 1.05M tokens (1%)*:
- **Colours:** neutral below 50%, amber from 50%, red from 80%.
- **The total** is the conversation as the next request will send it: the
  system prompt, the tool and component schemas, every message so far,
  tool calls and their results, and the last reply.
- **A tooltip** splits the total into system prompt and tools, messages,
  and the last reply. It also shows the request size against the 1 MB
  `/api/chat` body limit (H0). With `gpt-4.1`'s 1M-token window, the body
  limit is likely to be reached first, so the indicator goes amber or red
  on whichever of the two is closer.
- **Before the first answer,** it says *Context: counted after the first
  answer*. The compiled system prompt and tool schemas only exist inside
  Hashbrown's request, so there's nothing to count until one is sent. After
  the first answer, the tooltip's "System prompt and tools" line shows the
  starting cost.

**How it's counted:** Hashbrown doesn't pass OpenAI's token usage through.
`@hashbrownai/openai` reads the OpenAI stream itself and drops the final
usage chunk, so the server counts instead:
- **The request.** `ChatController` counts the OpenAI request exactly as
  the adapter builds it, through the adapter's `transformRequestOptions`
  hook, with `gpt-tokenizer`'s `o200k_base` encoding (`gpt-4.1`'s). This is
  the whole context, because Hashbrown sends the full history every time.
  - Messages are counted as text, plus OpenAI's 3 tokens per message and 3
    to prime the reply.
  - Tools are counted as OpenAI renders them for the model (a `namespace
    functions` of TypeScript-like types), not as JSON, which is up to twice
    as long.
  - The response schema is counted as its JSON without `additionalProperties`
    and `required`, plus 8 tokens.
  - It also records the request's byte size.
- **The reply.** The controller reads the frames it streams (Hashbrown's
  `[4-byte length][JSON]` format) and counts the `generation-chunk` text
  and tool-call arguments.
- **Storage.** It keeps `{ fixedTokens, messageTokens, replyTokens,
  requestBytes, model, at }` in memory, keyed by the signed-in user and a **chat session id**.
  The client makes the id when the panel mounts, and a Hashbrown provider
  middleware sends it as an `X-Chat-Session` header, next to
  `authFetchMiddleware`. A new panel (for example after signing in again)
  is a new session. Entries expire after a few hours.
- **The endpoint.** `GET /api/chat/context/:sessionId` (auth, own sessions
  only) returns the latest reading and the model's window. The client calls
  it on each idle transition. The windows come from a table on the server
  (`MODEL_CONTEXT_WINDOWS`), so only one side needs updating for a new
  model.
- **An estimate,** shown with *≈*. It should land within about 5% of
  OpenAI's own `prompt_tokens`, checked once by hand (see Testing).
- **The chat panel's own provider.** The panel gets its own
  `HashbrownProvider` (`ChatSessionProvider`), which adds the session
  header. The smart-home dialogs' structured completions stay on the app's
  provider, send no session id, and so don't overwrite the chat's
  reading.

**Where it lives:** a `useChatContextUsage(sessionId, isWorking)` hook and a
`ContextMeter` component in `client/src/app/chat/`. The panel renders it.
The Draft Game page's structured completions (H1) don't have a
conversation, so they don't need one.

**Later:**
- A **New chat** button, shown when the meter is amber or red, that clears
  the messages and starts a new session.
- Tokens **sent** this session (each request resends the history), which is
  what drives cost. That links to the per-user limit under Risks.

---

## Milestones

| # | Milestone | Depends on |
| --- | --- | --- |
| H0 ✅ | Decisions above confirmed. Chat panel split into tool hooks, new system prompt skeleton, shared game schema and mix presets, `/api/chat` body limit. No visible change. Built 2026-11-21, see [H0: what was built](#h0-what-was-built). | — |
| H0b ✅ | **Chat context indicator**: token counting in `ChatController`, `X-Chat-Session` middleware, `GET /api/chat/context/:sessionId`, `useChatContextUsage` and `ContextMeter`. See [Context indicator](#context-indicator). Before H1, so long pastes are visible from the start. Built 2026-11-21, see [H0b: what was built](#h0b-what-was-built). | H0 |
| H1 ✅ | **Single game creation**: `ContentSource`, `ContentDraft`, draft endpoints, `createGameWithQuestions`, the **Draft Game** button, drafts list and `GameDraftEditor` page (`useStructuredCompletion`), the card-slot check at Start, Duplicate and remix of games, and `asking-for-games.md`. Built 2026-11-21, see [H1: what was built](#h1-what-was-built). | H0 |
| H1b ✅ | **Single games from the chat**: `proposeGame` / `reviseGameDraft` / `getMyDrafts`, the `GameDraft` card, `OpenGame` / `OpenDraft`. Built 2026-11-21, see [H1b: what was built](#h1b-what-was-built). | H1 |
| H2 ✅ | **Library chapters (study only)**: `Book`, `Chapter`, the `Sense` collection, async `BookContentService`, shared `kogsChapterV1Schema`, `findSenses` / `proposeChapter` / `ChapterDraft` / `OpenYallaChapter`, open books in YALLA, **Save as library chapter**, remix and archive. Built 2026-11-21, see [H2: what was built](#h2-what-was-built). | H1 (drafts) |
| H3 ✅ | **Leitner on library chapters**: planner and generator on user books, book picker in `NewLeitnerGameDialog`, YALLA Exercises on user books, `createLeitnerGame` chat tool with dry-run plan. Built 2026-11-22, see [H3: what was built](#h3-what-was-built). | H2 |
| H4 | **Grammar learning objects**: the romanisation and slug rules, pattern registry, cloze generator, pattern tracks. | H3. Identity decided ([A4](#decided-grammar-pattern-identity-a4)). |
| Later | A quick game from a library chapter (questions tagged, so they could count if class games ever join `countedGameKinds`). `org`/`private` visibility with organisations. The single create flow in `future-game-formats.md`, where "from pasted text" becomes a content-source option. | — |

H1 builds the page before the chat because it's easier to test without the
chat, and the chat card reuses its editor.

### H0: what was built

Built 2026-11-21.

- **Chat areas** (`client/src/app/chat/`). `RichChatPanel.tsx` now only
  combines areas and renders the chat. Each area hook returns a `ChatArea`
  (`tools`, `runtimeFunctions`, `components`, `prompt`):
  - `useCoreChatArea`: who the assistant is (the Emoji app: badge games,
    YALLA, the smart-home demo), "use tools for actions", and the `Markdown`
    and `Card` components
  - `smart-home/useSmartHomeChatArea`: the light and scene tools,
    `createLight`, `LightChat`, `AddScene` and their prompt section,
    unchanged
  - `useDomChatArea`: `setFormInputValue`, `clickButtonByText`,
    `selectOptionByText`, unchanged
  
  H1b adds `useGameAuthoringChatArea` and H2 adds `useLibraryChatArea`.
- **Prompt sections** (`chat/prompt-sections.ts`). Hashbrown's `prompt` returns
  a compiled object, so sections can't be joined as strings. A `section`
  tag keeps each area's template parts, and `composePrompt` joins them into
  one `prompt` call, so `${…}` values in `<ui>` examples stay real values.
  Checked: the composed prompt has the same 7 examples as before, with
  array props intact and no diagnostics.
- **Model** in one constant, `CHAT_MODEL` (`chat/chat-config.ts`,
  `gpt-4.1`). The smart-home dialogs keep their smaller models.
- **Shared game authoring** (`client/src/app/game-authoring/`), not used yet:
  - `game-limits.ts`: 10 questions by default (max 20), 4 options by default
    (2–5, slots A–E), prompt ≤ 120 and option ≤ 40 characters (options
    raised to 60 after H1b, see [Text length and screens](#text-length-and-screens)),
    pasted text ≤ 8,000 characters
  - `question-mixes.ts`: the presets (vocabulary is the default) and
    `scaleMix()`, which fits a mix to any total by largest remainder
  - `game-draft.schema.ts`: the Skillet `gameDraftSchema` for `proposeGame`
    and the Draft Game page
  - `game-authoring.prompt.ts`: `gameRecipe()` and `mixPresetsText()`, the
    rules as prompt text
- **`/api/chat` body limit** raised to 1 MB (`server/src/main.ts`). Other
  routes keep the 100 kB default.

Not done in H0:
- The game-authoring prompt section isn't in the chat yet. Without its tools
  (H1b), it would promise things the chat can't do.
- Client-only limits: the server's Zod schemas (H1) repeat the numbers in
  `game-limits.ts`, and a server test should pin them.
- `npm run typecheck` already fails on `develop` for the client, with errors
  that came before H0: `AddScene`'s optional props against Hashbrown's prop
  schema (now in `useSmartHomeChatArea.ts`), `Message.tsx` importing `Chat`
  from `@hashbrownai/react`, and `RichMessage.tsx`'s `JsonValue` children.
  H0 adds no new errors.

### H0b: what was built

Built 2026-11-21.

- **Server** (`server/src/chat/`):
  - `chat-context.ts`: `countRequestTokens()` (pure), `FrameReader`,
    `ReplyTokenCounter`, `MODEL_CONTEXT_WINDOWS` and `CHAT_BODY_LIMIT_BYTES`
    (which `main.ts` now uses).
  - `chat-context.service.ts`: the latest reading per user and session, in
    memory, kept for 6 hours and at most 1,000 sessions.
  - `chat-context.controller.ts`: `GET /api/chat/context/:sessionId`
    (`AuthGuard`, 404 for no reading, someone else's session or a
    malformed id).
  - `chat.controller.ts`: counts through `transformRequestOptions` and the
    streamed frames, only for requests with an `X-Chat-Session` header.
  - Dependency: `gpt-tokenizer` 4.1.0.
- **Client** (`client/src/app/chat/`):
  - `ChatSessionProvider`: the panel's own `HashbrownProvider`, with a
    session id made on mount and sent as `X-Chat-Session`. Wraps
    `RichChatPanel` in `app.tsx`.
  - `useChatContextUsage`: fetches the reading on each working → idle
    change. A slow answer from an earlier turn can't replace a newer one.
  - `ContextMeter`: the bar, label and tooltip under Send.
- **Accuracy**, measured against `gpt-4.1` on 2026-11-21:
  - **Real-shaped request** (a 2.3k-token system prompt, four tools, a UI
    response schema, a tool call and its result): **within 0.3%** of
    OpenAI's `prompt_tokens`. Checked by replaying the exact request the
    server sent.
  - **Tools:** within 3%.
  - **Large response schemas:** within about 5%.
  - **Plain messages:** within 2 tokens.
  - **Counting tools and schemas as raw JSON**, the first version, was
    5–75% over.
- **Changed from the design:** before the first answer there's no reading
  (see above), instead of the system prompt and tools.
- **Not checked:** the meter on screen. It needs the dev server restarted
  with this build. The API side was checked end to end against a
  separately run server.

### H1: what was built

Built 2026-11-21.

- **Server, models** (`persistence/models.ts`): `ContentSource`
  (`contentSources`, one per owner and checksum, so pasting the same text
  again reuses it), `ContentDraft` (`contentDrafts`) and `Game.origin`
  (`kind: 'ai-draft'`, `contentSourceId`, `draftId`, `remixedFromGameId`).
- **Server, rules** (`content/game-draft.ts`): the Zod payload schema (the
  shape, with size caps), `gameDraftProblems()` (the playable rules, each
  with a path the editor points at) and `GAME_DRAFT_LIMITS`. A spec reads
  the client's `game-limits.ts` and `question-mixes.ts` and fails if the
  numbers or mix ids drift apart.
- **Server, API** (`content/content-drafts.controller.ts`,
  `persistence/content-draft.repository.ts`), all behind `RefereeGuard`:
  - `POST /api/content/drafts`: empty, with a source, or `fromGameId`
    (Duplicate). Only class games can be duplicated.
  - `GET /api/content/drafts` (`?shared=true` for others' shared drafts)
    and `GET /api/content/drafts/:id`, which returns the source text.
  - `PATCH /api/content/drafts/:id` with `revision`. Stale revisions and
    accepted drafts get 409, and the 409 carries the current draft.
  - `PUT …/share`, `DELETE` and `POST …/accept`: owner only (403 for
    someone else's shared draft, 404 for a private one).
  - Accept re-checks the rules, then calls `createGameWithQuestions()`. If
    the draft changed in the meantime, it deletes the new game and returns
    409.
- **Server, Start check:** `getCardSlotCheck()` and `cardSlotProblem()`.
  `POST /api/games/:id/state` → `active` gets 409 with *"Question 3 uses E,
  but this card group has A–D…"*. `GET /api/games/:id/nfc-card-group` also
  returns `slotProblem`, and the referee panel shows it and turns
  **Start Game** off.
- **Client** (`client/src/app/game-authoring/`, `views/`):
  - `drafts-api.ts`: the draft endpoints
  - `useGameGeneration.ts`: Generate, Regenerate (with a note) and Generate
    more, through `useStructuredCompletion` with `gameDraftSchema` and
    `CHAT_MODEL`
  - `GameDraftEditor.tsx`: the Source and Questions panes
  - `GameDraftsView` (`/games/drafts`, **My drafts** and **Shared
    drafts**) and `GameDraftView` (`/games/drafts/:id`). It autosaves 0.8 s
    after an edit and shows *Saved* / *Saving…*.
  - **Draft Game** button in Games, **Duplicate** on a class game's page,
    and *"Remixed from Title"* on a game made from a duplicate.
- **Prompt** (`game-authoring.prompt.ts`): `gameRecipe()` now takes the
  language names and a `free` mix (for a Regenerate note).
- **Guide:** [`asking-for-games.md`](asking-for-games.md). The page links
  to it on GitHub (`develop`).
- **Checked:**
  - **Specs:** 26 new (rules, access, revisions, accept, Duplicate) plus the
    Start check. All 453 server tests pass, and lint and the client build
    are clean.
  - **API, end to end:** against a separate database on a scratch server,
    every step from create to Start, including stale revisions, Duplicate
    keeping the source, and Start refused for an E question with the A–D
    demo group.
  - **AI output,** with the page's exact prompt and schema on `gpt-4.1` and
    a Korean story:
    - The vocabulary mix gave 6 / 2 / 2 with 4 options, with no problems.
    - Comprehension with 5 options gave 2 / 2 / 6. One option went over
      40 characters, and the editor flags it.
    - A Regenerate note asking for grammar gave a grammar question.
    - **Generate more** didn't repeat questions.

**Changed from the design:**

- **Options are shuffled when they arrive.** The first test run had the
  correct answer in A for 10 questions out of 10.
- **The first run wrote the questions in Korean.** The recipe now names the
  languages ("Write every question's text in English").
- **Questions are saved when a generation finishes,** not as they stream.
  The page shows how many have arrived so far.
- **The source is saved when the user leaves the paste box or generates,**
  not on every keystroke. A changed paste is a new source, because sources
  are never edited.
- **No `discarded` status:** **Delete** removes the draft. The chat card's
  **Discard** comes with H1b.
- **The field is `resultGameId`,** not `resultRef`. Accepting also unshares
  the draft.
- **When a save is refused** because the draft changed elsewhere, the page
  stops saving and offers **Load their version** or **Keep mine**.
- **The Start check only runs when a card group is attached.** Without one,
  there's nothing to check, as today.
- **Titles are capped at 100 characters** (`maxTitleLength`, in both
  limit files).

**Not checked:**
- **The pages on screen.** They need the dev server restarted.
- **Two real referees sharing a draft.** `DISABLE_AUTH` gives one
  identity. The specs cover it.
- **Playing at a badge station and exporting to the LRS.** The game is an
  ordinary untagged class game, as a hand-made one is.

Not done:
- **`docs/hashbrown/samples/`** and a `manual-tests.md` row for checking
  AI output by hand (Testing).
- **A Playwright test** for draft → accept → play → export.

### H1b: what was built

Built 2026-11-21.

- **Chat area** (`client/src/app/chat/game-authoring/`):
  `useGameAuthoringChatArea`, second in the panel after the core area.
  - Tools:
    - `proposeGame`: the game, the mix, the option count and the
      passage's first words
    - `reviseGameDraft`: replace or remove questions by number, add
      questions, retitle
    - `getMyDrafts`
    - `getGameDraft`
  - Components:
    - `GameDraft` (`GameDraftCard`)
    - `OpenGame` and `OpenDraft`, which open the page once when rendered
  - Prompt section: the mixes, the default recipe, the fix-problems rule,
    "only the user creates the game", and three examples.
- **Helpers** (`game-draft-tools.ts`):
  - `findPassage()` finds the pasted text in the user's messages.
  - `applyRevision()` applies a `reviseGameDraft` call.
  - `mixMismatch()` checks a draft against its preset.
- **Shared pieces:**
  - `gameDraftQuestionSchema`, split out of `gameDraftSchema`
  - `shuffleOptions()`, now generic
  - `notifyDraftChanged()` / `useDraftChanged()`: a chat edit reloads open
    `GameDraft` cards, and the Draft Game page if it has no unsaved edits
  - a `custom` mix on the server, in the page's mix picker and in Generate
    (which keeps the draft's proportions)
- **Checked** with the composed system prompt, the tools as strict
  functions and a UI response schema like Hashbrown's, on `gpt-4.1`. The
  tool results were played back from the real helpers and server rules.
  Three turns per run:
  - **Pasting a story** gave one `proposeGame` call in the vocabulary mix
    (6 / 2 / 2), 10 questions, 4 options, English text. The passage was
    found and kept whole every time. Then a `<GameDraft>` card.
  - **"Question 4 is too easy, make it about the grammar"** gave
    `getGameDraft`, then `reviseGameDraft` replacing only question 4. The
    other nine were unchanged.
  - **"Now make a comprehension game … with five options"** gave a new
    draft with 5 options and a note about the E card.
  - **When the server returned problems** (an option over 40 characters),
    the model fixed them with `reviseGameDraft` before showing the card.
  - **The composed prompt** has no Hashbrown diagnostics. It has 10
    examples, 12 tools and 7 components.
  - **Lint, build and tests:** lint, the client build and all 453 server
    tests pass. The client typecheck shows the same 4 errors as before.

**Changed from the design:**

- **`proposeGame` takes the passage's first words, not the passage.** The
  handler finds the passage in the user's messages and keeps it as the
  source. That keeps a long passage out of the tool call, and the text is
  exactly what was pasted.
- **The handlers check the mix.** In testing, "a comprehension game" came
  back as 8, 9 or 10 comprehension questions in most runs, even with the
  counts in the prompt and in the `mix` field. `proposeGame` now returns a
  `mixProblem` naming the questions to replace and their kinds. With that,
  3 runs out of 3 ended at 6 / 2 / 2. `reviseGameDraft` doesn't check the
  mix, because a change the user asks for wins.
- **The card doesn't edit.** The `GameDraft` card lists the questions and
  answers with **Create game**, **Discard** (which deletes the draft) and
  **Open in Draft Game**. Edits happen by asking the chat or on the page.
- **`getGameDraft` was added, and `getGames` wasn't.** `getMyDrafts`
  includes each accepted draft's `gameId`, which `OpenGame` needs.
- **Options are shuffled** in the tool handlers, as on the page.
- **No welcome message:** the panel doesn't have one. `asking-for-games.md`
  has the examples.

**Not checked:** the chat on screen: streaming, the card in the panel, and
the triggers opening pages. It needs the dev server restarted.

### H2: what was built

Built 2026-11-21.

- **Server, chapter shape** (`content/kogs-chapter.ts`): `kogsChapterV1Schema`
  replaces the partial copies in `yalla-content.ts` and
  `sense-registry.ts`. All five built-in chapters parse with it, and the
  YALLA and registry specs pass unchanged.
- **Server, chapter rules** (`content/chapter-draft.ts`):
  - the draft payload schema, `CHAPTER_DRAFT_LIMITS` (at least 6 and at
    most 30 words, 5 patterns, 100 passage lines), equal to the client's
    `library/chapter-limits.ts` (a spec compares them)
  - `chapterDraftProblems()`: book, titles, passage, words (Korean, no `/`,
    no word twice in one sense) and a sense decision per word. A new sense
    needs an ASCII slug and the user's confirmation.
  - `frozenChapterProblems()` (G8): an edit keeps every published word in
    its place and sense, and every pattern
  - `senseRegistryProblems()`: a reused sense must exist, a new one must not
  - `publishedChapter()`: vocabulary `id` = index, so `sourceRef` is
    `ch1/vocabulary/3`, plus `senseIds` and the new senses
- **Server, models** (`persistence/models.ts`, `book.repository.ts`):
  `Book` (`books`, unique slug, `visibility: 'open'`), `Chapter`
  (`chapters`, unique per book, `content`, `senseIds`, `remixedFrom`,
  `revision`, `archivedAt`) and `Sense` (`senses`, unique on language, word
  and sense, with book-qualified `sources`). Publish and edit each write in
  one transaction.
- **Server, content** (`learning/book-content.service.ts`):
  `BookContentService` loads user books asynchronously, against the
  registry file merged with the `senses` collection (the file wins), and is
  cleared on publish, edit and archive. `findSenses()` answers from both.
  Built-in books still load synchronously through `getBookContent()`.
- **Server, API:**
  - `/api/content/drafts` takes `type: 'chapter'`: empty, from a paste,
    `fromGameId` (Save as library chapter, reusing the kept source),
    `fromChapter` (remix) or `editChapter` (owner only). PATCH checks the
    payload against its type's schema. Accept publishes. The draft view
    adds the owner's books and, for an edit, the frozen words.
  - `GET /api/senses?words=…`, `GET /api/books/mine` and
    `POST /api/books/:book/chapters/:chapter/archive` (`{ archived }`,
    owner only), in `content/library.controller.ts`
  - `/api/yalla/books…` (`yalla/yalla-library.service.ts`): the catalogue,
    then the caller's books, then other open books, each with `owner`.
    Archived chapters are hidden from others and still open by link.
    Chapters carry `revision` and `remixedFrom` (titles only).
- **Client, page** (`library/`, `views/ChapterDraftView.tsx`):
  - **New chapter draft** on the drafts list, and chapter drafts open at
    the same `/games/drafts/:id`
  - `ChapterDraftEditor`: the book (one of yours, or a new one with a
    suggested link name and the G9 warning), the passage, **Generate**,
    and Passage / Vocabulary / Patterns tabs. Each word has a sense
    picker: reuse one of the senses `findSenses` returned, or a new sense
    with a slug, a kind and **Confirmed**. **Look up senses** fills in a
    guess for every undecided word: the one sense sharing a meaning, or a
    new unconfirmed sense for a word nobody teaches yet. *(Changed
    2026-11-22: a word the registry has now defaults to reuse (the sense
    sharing a meaning, else its first one), shown in orange as reused and
    changeable, so it never blocks Publish. The lookup also runs when a
    draft opens.)*
  - **Publish** opens the chapter in YALLA. An edit shows the published
    words locked.
  - **Save as library chapter** on a game made from a passage, and on its
    accepted draft
- **Client, YALLA:** the books page groups **Books**, **Your library** and
  **Shared by other referees**. A chapter page has **Remix**, and for the
  owner **Edit** and **Archive** / **Unarchive**, with *"Remixed from
  Title (Book)"*. Exercises on a library chapter say they're coming (H3).
- **Client, chat** (`chat/library/useLibraryChatArea.ts`, third in the
  panel): `getBooks`, `findSenses`, `proposeChapter`, `reviseChapterDraft`,
  `getChapterDraft` and `remixChapter`, the `ChapterDraft` card (with
  **Confirm N new senses**, **Publish**, **Open in Draft Game** and
  **Discard**) and `OpenYallaChapter`. `proposeChapter` takes the
  passage's first words, as `proposeGame` does, and returns
  `problemsToFix` and `forTheUser` (the confirmations the model must leave
  alone).
- **Checked:**
  - **Specs:** 30 new (chapter rules and freezing, the limits match, the
    chapter routes, and publish → YALLA → remix → edit → archive against an
    in-memory repository). All 483 server tests pass. Lint and the build
    are clean, and the client typecheck shows the same 4 errors as before.
  - **API, end to end** against a scratch database: a chapter with
    unconfirmed senses is refused, then publishes as chapter 1 of a new
    book, with `시험` reusing `ko/lexeme/시험/test` from the file. A second
    publish is chapter 2. Re-adding `토끼/rabbit` as new is refused
    ("reuse it"). A remix keeps all six ids and credits the source.
    Built-in ch. 28 remixes with its swapped fields fixed, and can't be
    edited. An edit refuses a reorder, then publishes a gloss fix and an
    appended word (`ch1/vocabulary/6`). An archived chapter is hidden but
    opens by link. Each sense's `sources` lists every chapter that uses it.

**Changed from the design:**

- **The sense decision is on each word** (`vocabulary[i].sense`), not a
  separate `senses[]`, so reordering words in the editor can't separate a
  word from its decision. It's flat (`decision`, `reuseId`, `newSense`,
  `kind`, `confirmed`) for Skillet.
- **A chapter stores its entries' learning objects** (`senseIds`). A
  reused sense from the registry file has no source in a user book, so the
  chapter is what maps `ch1/vocabulary/3` to its id. The `senses`
  collection holds only new senses, and records sources for the ones it
  has.
- **Editing a published chapter** is an edit draft (`editChapter`), with
  the G8 checks at save and at publish.
- **Remixing works for built-in chapters too.** A remix drops
  `appliedPatterns`, which the editor doesn't have.
- **The YALLA content controller** looks the caller up without creating
  a user, to mark their books. Book lists and chapter pages aren't cached
  in the client any more, because books change while the app is open.
- **The Leitner planner, progress, YALLA exercises and export** still call
  the synchronous `getBookContent()`, so they only know built-in books.
  Moving them to `BookContentService` is H3.

**Not checked:**
- **AI output.** The chapter recipe and `proposeChapter` haven't been run
  against `gpt-4.1` yet: dictionary forms, sense reuse through
  `findSenses`, and whether a long passage fits in one answer.
- **The pages and the chat card on screen.** They need the dev server
  restarted.
- **Two real referees.** `DISABLE_AUTH` gives one identity. The specs
  cover owner-only edits, archives and publishes.

### H3: what was built

Built 2026-11-22.

- **Server, content:** everything that reads a book by slug now goes
  through the async `BookContentService`: the `LeitnerPlanner` (badge games
  and YALLA practice), `LearningProgressService` (Players → detail and
  YALLA pills), `GET /api/books/:book/chapters`,
  `GET /api/players/:id/activity`, the YALLA practice re-check
  (`POST /api/yalla/me/results`) and the Leitner export's track changes.
  The synchronous `getBookContent()` is left for the built-in books inside
  `book-content.ts`, `yalla-content.ts` and the chapter-draft remix of a
  built-in chapter.
- **Server, Leitner games:** `POST /api/leitner-games` takes any user book
  (the slug was already in the schema). Questions are tagged
  `{ book: '<user-slug>', sourceRef: 'ch1/vocabulary/3', learningObjectId }`
  with the chapter's stored `senseIds`, so a reused sense keeps its id (one
  track, A1). A user book's game title is
  `Leitner: Player 7F3A · <slug> ch. 1` (the slug has no names, G9). The
  built-in book's title is unchanged.
- **Client, Games:** `NewLeitnerGameDialog` has a **Book** picker (from
  `/api/yalla/books`: built-in, *yours*, *shared*). Chapters come from
  `/api/books/:book/chapters`, titled from the library, without archived
  chapters. The default is still ch. 27 of the built-in book. The refusal
  messages moved to `leitnerRefusal()` in `views/leitner.ts`, shared with
  the chat card.
- **Client, YALLA:** Exercises on a library chapter are the normal practice
  (the "coming soon" note is gone).
- **Client, chat** (`chat/leitner/useLeitnerChatArea.ts`, fourth in the
  panel):
  - `getPlayers({ name })` matches the name in the browser and returns only
    `playerId` and `label`, so first names don't go to OpenAI from a tool
    result (the user may still type one).
  - `createLeitnerGame` is always a dry run. It returns the words, `seed`
    and `now`, or `refused` with the reason (pending export, game in play,
    no LRS).
  - `<LeitnerPlan>` takes the request plus `seed` and `now` as props
    (small, G2), plans again on mount and shows the words, the station
    preset and what it replaces. **Create game** replays the plan's seed
    and time, so the game is the one shown, then opens it. The created game
    id is remembered in `sessionStorage` so a re-rendered card doesn't offer
    Create again.
- **Checked:**
  - **Specs:** `leitner-user-books.spec.ts` (5) publishes a library chapter
    into the in-memory repository and then: creates a badge game whose
    questions carry the user book and `ko/lexeme/시험/test`; dry run and
    404 for an unknown chapter; a `시험` answer from the built-in book shows
    as the same track on the library chapter (progress and planner); YALLA
    practice on the library chapter sends `assessed` on the shared id with
    `source-ref` `<slug>/ch1/vocabulary/0`, and a mismatched id is refused.
    The library spec fixtures moved to `server/src/test/library-fixtures.ts`.
    All 489 server tests pass. Lint and the build are clean, and the client
    typecheck shows the same 4 errors as before.

**Not checked:**
- **Against a real LRS and Mongo.** The specs mock the LRS and use the
  in-memory book repository. A badge game from a library chapter hasn't
  been played and exported to `emojiapp-dev` yet.
- **AI output.** `getPlayers` → `getBooks` → `createLeitnerGame` →
  `<LeitnerPlan>` hasn't been run against `gpt-4.1`, in particular whether
  it copies `seed` and `now` into the props. (If it doesn't, the card still
  shows the plan it will create, from a fresh dry run.)
- **The dialog, the chat card and YALLA Exercises on screen.**

### Acceptance — H0b

- [ ] The context reading appears under the chat input. Before the first
      answer it says it's counted after the first answer. *(Built; check on
      screen.)*
- [ ] It changes only when the AI has finished answering and the chat is
      waiting for input (also after **Stop**), not during streaming or
      between tool-call rounds. *(Built; check on screen.)*
- [x] A turn with tool calls is counted in full: the tool calls, their
      results and the final reply.
- [ ] Pasting a long passage moves the reading visibly. The bar goes amber
      at 50% and red at 80% of whichever is closer, the model window or the
      1 MB body limit. *(Built; check on screen.)*
- [x] One user can't read another user's session (`404`), and a guest gets
      `401` (`AuthGuard`).
- [x] Checked once by hand against OpenAI's reported `prompt_tokens` for the
      same request: within about 5% (0.3%).

### Acceptance — H1

- [ ] **Draft Game** appears next to **New Game** and **New Leitner Game**
      for signed-in users, and opens the user's drafts list. *(Built; check
      on screen.)*
- [x] A user pastes a Korean passage, clicks **Generate** and gets 10
      questions in the vocabulary mix (6 / 2 / 2), with 4 options each and
      exactly one correct. Picking another preset or 5 options changes the
      result. *(Checked with the page's prompt and schema against
      `gpt-4.1`. Still to check on screen.)*
- [ ] The user can edit, reorder, delete, add and regenerate questions. The
      draft saves as they go, survives a reload, and several drafts can
      exist at once. *(Built, and the API checked; check on screen.)*
- [x] A shared draft shows in another referee's **Shared drafts**. They can
      edit it, and an edit made against an old revision is refused rather
      than overwriting. Only the owner can accept, unshare or delete it.
      *(Specs, plus stale revisions end to end.)*
- [x] **Create game** makes a `draft` class game with all its questions,
      `origin.kind: 'ai-draft'`, visible in Games. A guest can't call the
      draft or accept endpoints (401, `RefereeGuard`).
- [x] An invalid payload (two correct options, 6 options, empty text) is
      refused by the server with a problem list, whatever the client sent.
- [x] A game with 5-option questions can't be started with an A–D card
      group, and the referee panel says why. *(The 409 was checked end to
      end. Check the panel on screen.)*
- [ ] The game plays at a badge station like any class game, and after
      binding players, **Export to LRS** sends `answered` and `scored`
      statements to `emojiapp-dev`. They show the question text and options
      in Veracity. No `assessed` statements, no names.
- [x] **Duplicate** on any game (including another referee's) starts a new
      draft owned by the current user.
- [x] `asking-for-games.md` exists and the page links to it.

### Acceptance — H1b

- [x] Pasting a passage in the chat gives a `GameDraft` card for the same
      kind of draft, and *"make question 4 harder"* changes only question 4.
      *(Checked against `gpt-4.1` with the real prompt and tools; check on
      screen.)*
- [x] *"Make a comprehension game"* gives the comprehension mix. *(With
      the `mixProblem` check: 3 runs out of 3.)*
- [ ] **Open in Draft Game** opens the same draft in the page, and edits in
      either place show in the other after a reload. *(Built: the page also
      reloads by itself after a chat edit. Check on screen.)*

### Acceptance — H2

- [ ] Asking to save a passage to a new book (or **Save as library chapter**
      on a game) gives a `ChapterDraft` with the passage, vocabulary
      (dictionary forms), patterns, and a sense decision per word. Making a
      game alone saves no chapter. *(Built; check against `gpt-4.1` and on
      screen.)*
- [x] Words already in the registry are offered as reuse. A new sense needs
      the user's confirmation and gets an ASCII slug. *(Server rules end to
      end; the editor's guesses and the chat still to check on screen.)*
- [x] Publish creates the book, chapter 1 and the new senses. The chapter
      opens in YALLA for another signed-in user, with Dialog, Vocabulary
      and Patterns, and each vocabulary entry has its `learningObjectId`.
      *(API end to end, and "another user" in specs; check on screen.)*
- [x] Another referee can remix the chapter into their own book. The remix
      keeps the same learning-object ids and shows where it came from.
- [x] A published chapter's vocabulary can't be reordered or removed, and it
      can be archived but not deleted. A second publish to the same book
      becomes chapter 2.
- [x] The built-in Korean book and its existing tests are unchanged.

### Acceptance — H3

- [x] The referee creates a Leitner game for a player from a user-book
      chapter. Its questions are tagged with that book and the shared
      learning objects. *(Specs; the dialog and the chat card still to
      check on screen.)*
- [ ] After play and export, `assessed` statements for a reused sense
      update the same track the built-in book uses (one track per sense).
      *(The fold and the planner agree in specs. Play and export to
      `emojiapp-dev` still to do.)*
- [x] YALLA Exercises on a user chapter record `yalla-solo` evidence that
      moves the same tracks. *(Specs, with a mocked LRS; check on screen.)*

---

## Testing

- **Unit (Jest):**
  - the draft Zod schemas (one correct option, 2–5 options, limits, sense
    decisions)
  - the mix presets
  - `createGameWithQuestions` and the card-slot check
  - the registry merge (JSON plus the DB layer, clash detection)
  - `getBookContent` for a user book
  - chapter freezing and remix provenance
  - the minimum-vocabulary check
  - context counting: a fixed `completionParams` gives a known token count,
    reply frames are counted, sessions are per user and expire
- **API (Playwright, against Mongo and the stub LRS from
  `playwright-plan.md` Phase 4), with fixture payloads in place of AI
  output:**
  - draft → edit → accept → play → export for a single game
  - publish → remix → Leitner game → export for a chapter
- **Components:** `GameDraftEditor` and `ChapterDraft` rendered with
  fixture drafts, with no AI involved.
- **AI output:** not in CI. Keep a few real passages (the story from the
  request, a dialog, a news-style paragraph) under `docs/hashbrown/samples/`
  and check each preset by hand after prompt changes. Add a row to
  `manual-tests.md`.

---

## Risks

- **AI quality.** Wrong "correct" answers, ambiguous distractors, glosses
  that pick the wrong sense. The review step (G1) and the sense confirmation
  (G7) are the guard. Single games are lower risk because they don't touch
  tracks.
- **Permanent identifiers from user input.** Sense slugs and book slugs
  reach the LRS and can't change. Server validation plus human confirmation
  keep them clean, and the prototype LRS (`emojiapp-dev`) can be cleared
  before the pilot.
- **A shared registry fed by many users.** Near-duplicate senses (`배/ship`
  and `배/boat`) split one meaning into two tracks. Open content makes this
  more likely. `findSenses` plus the prompt rule reduce it. A later admin
  "merge senses" would need statement voiding, so prevention matters more
  than repair.
- **Copyright of open content.** Referees will paste textbook passages and
  published stories, and open content (G12) shows them to everyone signed
  in. For the prototype, the paste box asks the user to paste only text
  they may share. Before a wider pilot, add a licence or "shared with
  permission" field, and consider `private` visibility for copyrighted
  sources.
- **Cost and abuse.** `/api/chat` is an OpenAI proxy for any signed-in
  user, and the Draft Game page makes generating easy. Cap the paste size,
  and consider a per-user daily limit before sharing beyond the pilot.
- **Screen sizes and text length.** The limits (G15) are checked against
  the code, not real screens, and badges may one day show text. See
  [Text length and screens](#text-length-and-screens). Too tight and the AI's
  questions are blocked. Too loose and players can't read them.
- **Context growth.** Every chat request resends the whole conversation, so
  each turn costs more than the last. A long session with pasted passages
  and chapter-sized tool calls will reach the 1 MB body limit (H0) well
  before `gpt-4.1`'s token window. Until H0b, the user can't see it coming.
  The [context indicator](#context-indicator) shows the reading after
  every answer. **New chat** (later) lets the user start again, and the
  draft flow (G2) means starting again loses no work, because drafts live
  on the server, not in the conversation.
- **Privacy.** Pasted text goes to OpenAI, is stored in `contentSources`,
  and is visible to other signed-in users once published. Fine under the
  prototype guardrails. Before a school pilot, it needs the third-party
  review in security.md (OpenAI's data handling and location).
- **Hashbrown is pre-1.0.** 0.4.1 APIs may change. Keeping the AI to tools,
  components, `useStructuredCompletion` and plain fetch calls (no Hashbrown
  types in the server models) limits the impact of an upgrade.

---

## Open questions

Answered 2026-11-21 (now in Decisions and the sections above):

| # | Question | Answer |
| --- | --- | --- |
| 1 | Default mix | Vocabulary-heavy by default, with presets and a user guide for other mixes (`asking-for-games.md`). |
| 2 | Option count | 4 by default, 5 when asked and the card group has an E card. |
| 3 | Who owns content | Open by default: everyone signed in sees it and can remix it (G12). |
| 4 | One paste, both features | Make only the game unless asked. Always keep the pasted text as a source (G13). |
| 5 | Grammar id shape | Option B, smallest teachable patterns: [A4](#decided-grammar-pattern-identity-a4). The romanisation and slug rules come with H4. |
| 6 | Dedicated page | Yes: the **Draft Game** button and page, with saved drafts, in H1. |
| 7 | Remix credit | No referee name. A remix shows the source's title and a link (G12). |
| 8 | Draft sharing | Yes, for now: the owner can share a draft for others to edit (G14). |

Open:

| # | Question | Notes |
| --- | --- | --- |
| 9 | Are 120 / 60 characters right for every screen? | Look at the student view on a phone and a projector with long Korean text. Decide whether limits should depend on display width or language. Decide whether badges will ever show text. See [Text length and screens](#text-length-and-screens). |
