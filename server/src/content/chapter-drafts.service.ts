import { Injectable } from '@nestjs/common';
import { getBookContent, isBuiltInBook, type BookContent } from '../learning/book-content';
import { findCatalogueBook } from '../learning/book-catalogue';
import { BookContentService } from '../learning/book-content.service';
import {
  BookRepository,
  BookSlugTakenError,
  ChapterChangedError,
  SenseTakenError,
  type ChapterRecord,
} from '../persistence/book.repository';
import type { ChapterRefRecord, ContentDraftRecord } from '../persistence/content-draft.repository';
import {
  chapterAsDraft,
  chapterDraftPayloadSchema,
  chapterDraftProblems,
  publishedChapter,
  senseRegistryProblems,
  targetLanguageOf,
  type ChapterDraftPayload,
  type ChapterRef,
  type FrozenChapter,
} from './chapter-draft';
import { kogsChapterV1Schema } from './kogs-chapter';
import { DEFAULT_LANGUAGE, type DraftProblem } from './game-draft';

/** Why a chapter can't be copied or published, as the controller's status and message. */
export class ChapterDraftError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
    public readonly problems: DraftProblem[] = [],
  ) {
    super(message);
  }
}

/** The published chapter a draft edits, as the freeze check needs it (G8). */
function frozenOf(record: ChapterRecord): FrozenChapter {
  const content = kogsChapterV1Schema.parse(record.content);
  return {
    book: record.bookSlug,
    chapter: record.chapter,
    words: content.vocabulary.map((entry) => entry.targetLanguageText),
    senseIds: record.senseIds,
    patternCount: content.patterns.length,
  };
}

/**
 * Library chapter drafts (docs/hashbrown/creating-games-with-hashbrown.md →
 * Feature 2): starting one (from a paste, a game's kept source, a remix or
 * an edit of the owner's chapter), their problems, and Publish. The access
 * rules for the draft itself stay in `ContentDraftsController`.
 */
@Injectable()
export class ChapterDraftsService {
  constructor(
    private readonly books: BookRepository,
    private readonly content: BookContentService,
  ) {}

  /** A remix (G12) or an edit (G8) of a published chapter, as a new draft payload. */
  async copyChapter(
    ref: ChapterRef,
    userId: string,
    purpose: 'remix' | 'edit',
  ): Promise<{ payload: ChapterDraftPayload; ref: ChapterRefRecord; sourceId: string | null; frozen: FrozenChapter | null }> {
    let content: BookContent;
    let record: ChapterRecord | null = null;
    let language: { target: string; native: string } = DEFAULT_LANGUAGE;
    if (isBuiltInBook(ref.book)) {
      if (purpose === 'edit') throw new ChapterDraftError(403, 'Built-in chapters can’t be edited. Remix it instead.');
      content = getBookContent(ref.book);
      language = { target: content.language, native: 'en' };
    } else {
      const loaded = await this.content.userBook(ref.book);
      if (!loaded) throw new ChapterDraftError(404, 'Book not found');
      if (purpose === 'edit' && loaded.book.ownerUserId !== userId) {
        throw new ChapterDraftError(403, 'Only the book’s owner can edit its chapters. Remix it to make your own copy.');
      }
      record = loaded.chapters.find((candidate) => candidate.chapter === ref.chapter) ?? null;
      content = await this.content.getBookContent(ref.book);
      language = loaded.book.language;
    }
    const raw = record ? record.content : findCatalogueBook(ref.book)?.chapters.find((c) => String((c as { chapter?: unknown }).chapter) === ref.chapter);
    const vocabulary = content.chapters.get(ref.chapter);
    if (!raw || !vocabulary) throw new ChapterDraftError(404, 'Chapter not found');
    const parsed = kogsChapterV1Schema.parse(raw);
    const payload = chapterAsDraft(
      parsed,
      vocabulary.entries.map((entry) => {
        const sense = content.senseBySourceRef.get(entry.sourceRef);
        return { word: entry.word, gloss: entry.gloss, senseId: sense && sense.word === entry.word ? sense.id : null };
      }),
      // A remix goes into a book of the remixer's, chosen in the draft.
      { bookSlug: purpose === 'edit' ? ref.book : '', language },
    );
    return {
      payload,
      ref: { book: ref.book, chapter: ref.chapter, revision: record?.revision ?? null },
      sourceId: record?.sourceId ?? null,
      frozen: purpose === 'edit' && record ? frozenOf(record) : null,
    };
  }

  /** Everything that stops the draft being published, including the registry and the book. */
  async problems(payload: ChapterDraftPayload | null, draft: Pick<ContentDraftRecord, 'ownerUserId' | 'editsChapter'>): Promise<DraftProblem[]> {
    const frozen = await this.frozen(draft.editsChapter);
    const problems = chapterDraftProblems(payload, frozen);
    if (!payload) return problems;
    if (!frozen) problems.push(...(await this.bookProblems(payload, draft.ownerUserId)));
    if (this.books.isAvailable()) {
      problems.push(...senseRegistryProblems(payload, await this.content.registry(targetLanguageOf(payload))));
    }
    return problems;
  }

  /**
   * Publishes the draft: a new chapter in the chosen book (made on the first
   * publish), or the edited chapter. Problems are checked again here.
   * @throws ChapterDraftError
   */
  async publish(draft: ContentDraftRecord, userId: string): Promise<ChapterRecord> {
    const parsed = chapterDraftPayloadSchema.safeParse(draft.payload);
    const payload = parsed.success ? parsed.data : null;
    const problems = await this.problems(payload, draft);
    if (!payload || problems.length > 0) {
      throw new ChapterDraftError(400, 'The draft has problems to fix first', problems);
    }
    const language = payload.language ?? DEFAULT_LANGUAGE;
    try {
      let published: ChapterRecord;
      if (draft.editsChapter) {
        published = await this.books.updateChapter({
          bookSlug: draft.editsChapter.book,
          chapter: draft.editsChapter.chapter,
          revision: draft.editsChapter.revision ?? 0,
          ownerUserId: userId,
          built: publishedChapter(payload, draft.editsChapter.chapter),
        });
      } else {
        const existing = payload.bookSlug.trim();
        const book = existing ? await this.books.getBook(existing) : null;
        published = await this.books.publishChapter({
          book: existing
            ? { slug: existing, isNew: false, title: book?.title ?? existing, language: book?.language ?? language }
            : { slug: payload.newBook.slug.trim(), isNew: true, title: payload.newBook.title.trim(), language },
          ownerUserId: userId,
          build: (chapter) => publishedChapter(payload, chapter),
          sourceId: draft.sourceId,
          remixedFrom: draft.remixedFromChapter,
        });
      }
      this.content.clear(published.bookSlug, language.target);
      return published;
    } catch (error) {
      if (error instanceof SenseTakenError) {
        // The registry is stale: the next check sees the sense that was added.
        this.content.clear(payload.bookSlug.trim() || payload.newBook.slug.trim(), language.target);
        throw new ChapterDraftError(409, error.message, [{ path: 'vocabulary', message: error.message }]);
      }
      if (error instanceof BookSlugTakenError) {
        throw new ChapterDraftError(409, error.message, [{ path: 'newBook.slug', message: error.message }]);
      }
      if (error instanceof ChapterChangedError) {
        throw new ChapterDraftError(409, 'The chapter was changed since this draft was opened. Start a new edit from the chapter.');
      }
      throw error;
    }
  }

  /** Archive (or bring back) a chapter of the caller's book. Not deleted: statements point at it (G12). */
  async setArchived(ref: ChapterRef, userId: string, archived: boolean): Promise<ChapterRecord> {
    const loaded = await this.content.userBook(ref.book);
    if (!loaded || !loaded.chapters.some((chapter) => chapter.chapter === ref.chapter)) {
      throw new ChapterDraftError(404, 'Chapter not found');
    }
    if (loaded.book.ownerUserId !== userId) {
      throw new ChapterDraftError(403, 'Only the book’s owner can archive its chapters.');
    }
    const updated = await this.books.setChapterArchived(ref.book, ref.chapter, archived);
    if (!updated) throw new ChapterDraftError(404, 'Chapter not found');
    this.content.clear(ref.book, loaded.book.language.target);
    return updated;
  }

  /** The caller's books, newest last: where a new chapter can go. */
  async myBooks(userId: string): Promise<Array<{ slug: string; title: string; chapterCount: number }>> {
    if (!this.books.isAvailable()) return [];
    const mine = (await this.books.listBooks()).filter((book) => book.ownerUserId === userId && !book.archivedAt);
    return Promise.all(
      mine.map(async (book) => ({ slug: book.slug, title: book.title, chapterCount: (await this.books.listChapters(book.slug)).length })),
    );
  }

  async frozen(ref: ChapterRefRecord | null): Promise<FrozenChapter | null> {
    if (!ref) return null;
    const record = this.books.isAvailable() ? await this.books.getChapter(ref.book, ref.chapter) : null;
    return record ? frozenOf(record) : null;
  }

  private async bookProblems(payload: ChapterDraftPayload, userId: string): Promise<DraftProblem[]> {
    if (!this.books.isAvailable()) return [];
    const existing = payload.bookSlug.trim();
    if (existing) {
      const book = await this.books.getBook(existing);
      if (!book || book.archivedAt) return [{ path: 'bookSlug', message: `There is no book “${existing}”` }];
      if (book.ownerUserId !== userId) return [{ path: 'bookSlug', message: 'Chapters can only be added to your own books' }];
      return [];
    }
    const slug = payload.newBook.slug.trim();
    if (slug && (await this.books.getBook(slug))) {
      return [{ path: 'newBook.slug', message: `A book called “${slug}” already exists: choose another link name` }];
    }
    return [];
  }
}
