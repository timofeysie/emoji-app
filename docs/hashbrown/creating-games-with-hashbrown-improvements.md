# Creating games with Hashbrown: improvements

Follow-ups to [`creating-games-with-hashbrown.md`](creating-games-with-hashbrown.md)
(H0–H4 built). The decisions there (G1–G15) still apply. This doc only adds
what each improvement needs.

**Status:** planned 2026-11-23. I1a built 2026-11-28, see [I1a: what was built](#i1a-what-was-built). I1b not started.

---

## Improvement 1: a new chapter from the book page

### What we want

On a book's YALLA page (for example `/yalla/books/public-announcements-97f7`),
the owner can add a new chapter to **that** book in two ways:

1. **The chat:** *"Let's make a new chapter for this book using this
   content: …"*. The AI makes the chapter draft for the book the user is
   looking at, without asking which book.
2. **A Create chapter button** on the page. It opens an empty chapter draft
   in the Draft Game page, with this book already chosen. The user pastes
   the passage, generates, decides the senses and patterns, and clicks
   **Publish**. The chapter then appears as the book's next chapter.

Either way the result is an ordinary chapter draft (G1). Nothing changes
about checking, confirming new senses and patterns (G7, GP5) or publishing.

### Where we are today

Most of the pieces already exist. What's missing is the link between the
page and the draft.

| Piece | Today |
| --- | --- |
| Draft for a given book | A chapter draft's `payload.bookSlug` names the book it publishes into. `POST /api/content/drafts` with `{ type: 'chapter', payload }` creates one, and `ChapterDraftsService.problems()` already refuses a book that isn't the user's (*"Chapters can only be added to your own books"*). |
| Draft page | `ChapterDraftView` shows the passage box, Generate, the book picker (`books` from the draft view) and Publish. `fromModel` keeps the book choice when the chapter is generated. After Publish it navigates to the new chapter (`yallaChapterPath`). |
| Chapter number | The server gives a published chapter the book's next number. Nothing to do. |
| Chat | `proposeChapter` takes a `book` slug. The model finds it with `getBooks`, so it can already add to a named book. But **the chat doesn't know which page the user is on**, so "this book" means nothing to it. |
| Book page | `YallaBookView` lists the chapters and knows the book's `owner` (`'mine'` for the user's own books). It has no actions. Chapter pages have `ChapterLibraryActions` (Remix, Edit, Archive). |
| Language | **Gap:** nothing checks that a draft's `payload.language.target` matches the existing book's language. A Japanese chapter could be published into a Korean book. |

The route `/yalla/books/:book` is the **book** page. The chapter pages are
`/yalla/books/:book/chapters/:chapter`. This plan puts the button on the
book page, and a smaller one on the owner's chapter pages (see C3).

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| C1 | **Only the book's owner sees Create chapter**, on books with `owner === 'mine'`. On a built-in book or another referee's book there is no button. In the chat, the AI says it can only add chapters to the user's own books, and offers a new book of their own or a remix of one of this book's chapters. | Same rule as the server already enforces. Showing a button that always fails is worse than no button. |
| C2 | **The button creates the draft straight away**, with `payload.bookSlug` set and everything else empty, then opens `/games/drafts/:draftId`. No dialog first. | Same as Remix and Edit in `ChapterLibraryActions`. The draft page already has the passage box, so a dialog would repeat it. |
| C3 | **The book stays changeable in the draft.** The book picker shows this book selected, and the user can still pick another of their books or a new one. | It's just a default. Locking it would add a new draft state for little gain. |
| C4 | **The chat learns the current page from a tool, `getCurrentPage`**, not from the system prompt. It returns the route and, on a YALLA book or chapter page, the book's slug, title, owner and language. The prompt says: when the user says "this book" or "this chapter", call `getCurrentPage`. | The system prompt stays the same as the user moves around, so it isn't re-sent with a different page in it on every navigation. The tool is read only when it matters, and is useful to other areas later (a quiz on "this chapter"). |
| C5 | **A chapter's target language must match its book's.** `ChapterDraftsService.problems()` adds a problem when `payload.bookSlug` names a book in another language, and the button and the chat set `payload.language` from the book. | Closes the gap above. A book's sense and pattern registries are per language, so a mixed book would break the Leitner planner and the cloze generator. |
| C6 | **After Publish, the open book page shows the new chapter** without a reload, whether Publish was clicked on the Draft Game page or on the chat's `<ChapterDraft>` card. | The card publishes while the user may still be on the book page. `YallaBookView` only fetches when it mounts today. |

### The user's flow: the button

1. The owner opens `/yalla/books/public-announcements-97f7` and clicks
   **Create chapter**.
2. The app creates a chapter draft for that book and opens it in the Draft
   Game page. The book picker shows *Public announcements*.
3. The user pastes the passage and clicks **Generate**, decides each new
   sense and pattern, then clicks **Publish**.
4. The app opens the new chapter in YALLA (chapter N+1 of the book). The
   book page lists it.

### The user's flow: the chat

1. On the same page, the user types: *"Let's make a new chapter for this
   book using this content: 안내 말씀 드리겠습니다. …"*
2. The AI calls `getCurrentPage` and gets the book's slug, title, owner and
   language.
   - If the owner isn't `mine`, it says so (C1) and stops there.
3. It follows the usual library steps (`findSenses`, `findPatterns`,
   `proposeChapter`), with `book` set to the page's slug. It doesn't need
   `getBooks`.
4. It shows `<ChapterDraft>` and says the chapter goes into *Public
   announcements*. The user confirms new senses and patterns and clicks
   **Publish** on the card, and the book page updates (C6).

### Client changes

**`getCurrentPage` tool** (new, in `chat/useCoreChatArea.ts` or a small
`chat/usePageChatArea.ts`):

- `RichChatPanel` is rendered inside the router, so the area hook can call
  `useLocation()`.
- It matches the path with `matchPath` against `/yalla/books/:book` and
  `/yalla/books/:book/chapters/:chapter/*`.
- On a book or chapter page it fetches `/books/:book` with `fetchYalla` and
  returns `{ page: 'yalla-book' | 'yalla-chapter', book, title, owner,
  language, chapter?, chapterTitle?, nextChapter }`. `nextChapter` is the
  number Publish will give, so the AI can say "chapter 4".
- On any other page it returns `{ page: 'other', path }`.
- The handler reads the location from a ref, so the tool doesn't need new
  `deps` on every navigation.

**Library chat area** (`chat/library/useLibraryChatArea.ts`):

- Prompt step 1 becomes: *"If the user says this book or this chapter, call
  getCurrentPage and use its book when its owner is "mine". Otherwise, if you
  don't know the user's books, call getBooks."* It also covers the C1 reply.
- Add an example: the "new chapter for this book" message, with
  `getCurrentPage`, `findSenses`, `findPatterns`, `proposeChapter` and the
  card.
- `proposeChapter`'s handler sets `payload.language` from the book when
  `book` is set (C5). It already gets the books through `getBooks`; it can
  look the language up with the same `fetchYalla('/books/:book')`.

**Create chapter button** (new `library/CreateChapterButton.tsx`):

- Same shape as `SaveAsChapterButton`: busy state, error text, then
  `createChapterDraft({ payload: { ...emptyChapterContent(), bookSlug, language } })`
  and `navigate('/games/drafts/' + draft.id)`.
- `language` is `{ target: book.language, native: 'en' }` (C5).
- Shown in `YallaBookView` next to the title when `data.owner === 'mine'`.
- On the owner's chapter pages, `ChapterLibraryActions` gets a **New
  chapter** button that does the same for `chapter.book`.

**Refresh the book page** (C6):

- Add `notifyBookChanged(slug)` and `useBookChanged(slug, fn)` next to
  `notifyDraftChanged` / `useDraftChanged`.
- `publishChapterDraft` calls `notifyBookChanged(chapter.book)` after
  `clearYallaContentCache()`, so every place that publishes gets it.
- `YallaBookView` (and `YallaBooksView`, for chapter counts) re-fetch when it
  fires. This probably needs a `reload` from `useYallaResource`, as
  `YallaChapterView` already uses.

**Draft page** (`views/ChapterDraftView.tsx`): no change is needed for the
flow. Two small things are worth doing:

- An empty draft from the button has no title, so the drafts list shows it
  untitled. Show *"New chapter for {book title}"* until the chapter has a
  title.
- When a draft has a `bookSlug`, the passage box can say *"This chapter
  goes into {book title}."*

### Server changes

- `ChapterDraftsService.problems()`: when `payload.bookSlug` names an
  existing book and `payload.language.target` differs from
  `book.language.target`, add a problem at `language` (C5). For example:
  *"This book is in Korean: a chapter for it must be too"*. Publish then
  refuses it like any other problem.
- No new endpoints. `POST /api/content/drafts` with a payload already
  creates a draft for a book.

### Tests

- **Server** (`chapter-drafts.service.spec.ts`):
  - a draft created with only `bookSlug` (and language) publishes as the
    book's next chapter, after the content is filled in;
  - a draft for another user's book has the "your own books" problem (this
    exists already: keep it covered);
  - a draft whose language doesn't match its book has the new problem, and
    Publish refuses it.
- **Client:**
  - `getCurrentPage` returns the book on `/yalla/books/:book` and on a
    chapter page, and `other` elsewhere (a unit test with a `MemoryRouter`);
  - `CreateChapterButton` creates a draft with the book's slug and language
    and opens it;
  - `YallaBookView` shows the button only for `owner: 'mine'`.
- **By hand, with a real model:**
  - *"Make a new chapter for this book with this: …"* on a user book;
  - the same on the built-in book (the AI declines and offers a new book);
  - publish from the chat card and check that the book page updates.

### Milestones

| # | Milestone | Depends on |
| --- | --- | --- |
| I1a ✅ | **Create chapter button**: `CreateChapterButton` on the book page and New chapter on the owner's chapter pages, the language check (C5), the book-page refresh after Publish (C6), and the "New chapter for …" draft title. | H4c |
| I1b | **"This book" in the chat**: `getCurrentPage`, prompt step 1 and the example, and `proposeChapter` setting the book's language. | I1a (C5, C6) |

I1a comes first because it can be tested without a model, and the chat path
relies on its language check and refresh.

### I1a: what was built

- **`library/CreateChapterButton.tsx`**: creates a chapter draft with
  `payload.bookSlug` and `payload.language` (`{ target: book.language,
  native: 'en' }`) and opens `/games/drafts/:draftId`.
  - `YallaBookView` shows it as **Create chapter** next to the title when
    `owner === 'mine'`.
  - `ChapterLibraryActions` shows it as **New chapter** on the owner's
    chapter pages, next to Edit and Archive.
- **Language check (C5)**: `ChapterDraftsService.bookProblems()` adds a
  problem at `language` when the chapter's target language isn't the
  existing book's (*"“Rabbit stories” is a book in “ko”: a chapter for it
  must be too, not “ja”"*).
- **Draft title**: new `ChapterDraftsService.draftTitle()`, used by the
  controller on create, copy and update. Until the chapter has a title, a
  draft for an existing book is called *"New chapter for {book title}"*, so
  the drafts list doesn't show it as untitled.
- **Refresh (C6)**: `notifyBookChanged(book)` and `useBookChanged(book |
  null, fn)` in `yalla/yalla-api.ts`. `publishChapterDraft` and
  `setChapterArchived` call it. `YallaBookView` reloads for its book and
  `YallaBooksView` for any book.
- **Specs** (`chapter-drafts.service.spec.ts`): an empty draft for a book
  has no book or language problem and is titled after the book, then
  publishes, filled in, as chapter 2. A Japanese chapter for a Korean book
  gets the language problem. The controller spec mocks `draftTitle`.

Changed from the plan:

- No *"This chapter goes into {book title}"* line by the passage box: the
  draft page's Book section already shows the book in its **Add to**
  picker.
- No client unit tests: the client has no unit test runner (only the
  Playwright e2e suite, which has no library flows yet).

Not checked yet: the buttons on screen, and the refresh after publishing
from the chat card, by hand in the browser.

### Open questions

- **Should the chat see the page on every message?** C4 makes the model
  ask. If it often forgets to call `getCurrentPage`, a short line added to
  each user message (*"(on the page: Public announcements, your book)"*)
  would be more reliable, but every message would then carry it.
- **Drafts for this book on the book page?** A list of the book's
  unpublished drafts on its page would help the owner find an unfinished one.
  It needs a `GET /api/content/drafts?book=` filter. Left for later.
- **Built-in book:** C1 hides the button. Should the built-in book instead
  offer *Create a chapter in a new book of mine*? Probably not: the button
  would then mean different things on different books.
