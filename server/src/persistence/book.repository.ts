import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import type { NewSense } from '../content/chapter-draft';
import type { KogsChapterV1 } from '../content/kogs-chapter';
import type { VocabularyKind } from '../learning/learning-object';
import type { ChapterRefRecord, LanguagePair } from './content-draft.repository';
import { asObjectId } from './models';
import { MongoService } from './mongo.service';

export type BookRecord = {
  slug: string;
  title: string;
  language: LanguagePair;
  ownerUserId: string;
  visibility: 'open';
  archivedAt: string | null;
  createdAt: string;
};

export type ChapterRecord = {
  bookSlug: string;
  chapter: string;
  content: KogsChapterV1;
  senseIds: string[];
  sourceId: string | null;
  remixedFrom: ChapterRefRecord | null;
  publishedAt: string;
  revision: number;
  archivedAt: string | null;
};

export type SenseRecord = {
  language: string;
  word: string;
  sense: string;
  kind: VocabularyKind;
  gloss: string;
  sources: string[];
};

/** A new `(language, word, sense)` was added by someone else meanwhile. */
export class SenseTakenError extends Error {
  constructor(public readonly senseId: string) {
    super(`The sense ${senseId} was added meanwhile: reuse it.`);
  }
}

/** The new book's slug is taken (G9). */
export class BookSlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`A book called '${slug}' already exists: choose another link name.`);
  }
}

/** The chapter changed since the edit draft was opened. */
export class ChapterChangedError extends Error {}

type LeanBook = {
  slug: string;
  title: string;
  language: LanguagePair;
  ownerUserId: Types.ObjectId;
  visibility: string;
  archivedAt?: Date | null;
  createdAt: Date;
};

type LeanChapter = {
  bookSlug: string;
  chapter: string;
  content: KogsChapterV1;
  senseIds: string[];
  sourceId?: Types.ObjectId | null;
  remixedFrom?: ChapterRefRecord | null;
  publishedAt: Date;
  revision: number;
  archivedAt?: Date | null;
};

function toBook(book: LeanBook): BookRecord {
  return {
    slug: book.slug,
    title: book.title,
    language: { target: book.language.target, native: book.language.native },
    ownerUserId: book.ownerUserId.toString(),
    visibility: 'open',
    archivedAt: book.archivedAt ? book.archivedAt.toISOString() : null,
    createdAt: book.createdAt.toISOString(),
  };
}

function toChapter(chapter: LeanChapter): ChapterRecord {
  return {
    bookSlug: chapter.bookSlug,
    chapter: chapter.chapter,
    content: chapter.content,
    senseIds: [...chapter.senseIds],
    sourceId: chapter.sourceId ? chapter.sourceId.toString() : null,
    remixedFrom: chapter.remixedFrom
      ? { book: chapter.remixedFrom.book, chapter: chapter.remixedFrom.chapter, revision: chapter.remixedFrom.revision ?? null }
      : null,
    publishedAt: chapter.publishedAt.toISOString(),
    revision: chapter.revision,
    archivedAt: chapter.archivedAt ? chapter.archivedAt.toISOString() : null,
  };
}

function isDuplicateKey(error: unknown): error is { code: number; keyValue?: Record<string, unknown> } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

/**
 * User books, their chapters and the senses users added
 * (docs/hashbrown/creating-games-with-hashbrown.md → Feature 2 → Server).
 * Access rules (owner, open) are the callers'; this only stores.
 */
@Injectable()
export class BookRepository {
  constructor(private readonly mongoService: MongoService) {}

  isAvailable(): boolean {
    return this.mongoService.isConnected();
  }

  /** Every user book, archived ones included (callers filter), oldest first. */
  async listBooks(): Promise<BookRecord[]> {
    const { Book } = this.mongoService.getModels();
    const books = await Book.find({}).sort({ createdAt: 1 }).limit(500).lean();
    return books.map((book) => toBook(book as unknown as LeanBook));
  }

  async getBook(slug: string): Promise<BookRecord | null> {
    const { Book } = this.mongoService.getModels();
    const book = await Book.findOne({ slug }).lean();
    return book ? toBook(book as unknown as LeanBook) : null;
  }

  /** The book's chapters in chapter order, archived ones included. */
  async listChapters(bookSlug: string): Promise<ChapterRecord[]> {
    const { Chapter } = this.mongoService.getModels();
    const chapters = await Chapter.find({ bookSlug }).lean();
    return chapters
      .map((chapter) => toChapter(chapter as unknown as LeanChapter))
      .sort((a, b) => Number(a.chapter) - Number(b.chapter));
  }

  async getChapter(bookSlug: string, chapter: string): Promise<ChapterRecord | null> {
    const { Chapter } = this.mongoService.getModels();
    const row = await Chapter.findOne({ bookSlug, chapter }).lean();
    return row ? toChapter(row as unknown as LeanChapter) : null;
  }

  async listSenses(language: string): Promise<SenseRecord[]> {
    const { Sense } = this.mongoService.getModels();
    const senses = await Sense.find({ language }).lean();
    return senses.map((sense) => ({
      language: sense.language,
      word: sense.word,
      sense: sense.sense,
      kind: sense.kind as VocabularyKind,
      gloss: sense.gloss,
      sources: [...(sense.sources ?? [])],
    }));
  }

  /**
   * Publishes a new chapter in one transaction: the book (when new), the
   * chapter with the next number, the new senses, and each sense's source.
   * @throws BookSlugTakenError, SenseTakenError
   */
  async publishChapter(input: {
    book: { slug: string; isNew: boolean; title: string; language: LanguagePair };
    ownerUserId: string;
    /** Called with the chapter number, which is only known inside the transaction. */
    build: (chapter: string) => { content: KogsChapterV1; senseIds: string[]; newSenses: NewSense[] };
    sourceId: string | null;
    remixedFrom: ChapterRefRecord | null;
  }): Promise<ChapterRecord> {
    const { Book, Chapter } = this.mongoService.getModels();
    return this.withTransaction(async (session) => {
      if (input.book.isNew) {
        try {
          await Book.create(
            [
              {
                slug: input.book.slug,
                title: input.book.title,
                language: input.book.language,
                ownerUserId: asObjectId(input.ownerUserId),
              },
            ],
            { session },
          );
        } catch (error) {
          if (isDuplicateKey(error)) throw new BookSlugTakenError(input.book.slug);
          throw error;
        }
      }
      const last = await Chapter.find({ bookSlug: input.book.slug }, { chapter: 1 }).session(session).lean();
      const chapter = String(Math.max(0, ...last.map((row) => Number(row.chapter))) + 1);
      const built = input.build(chapter);
      const [created] = await Chapter.create(
        [
          {
            bookSlug: input.book.slug,
            chapter,
            content: built.content,
            senseIds: built.senseIds,
            sourceId: input.sourceId ? asObjectId(input.sourceId) : null,
            remixedFrom: input.remixedFrom,
            publishedAt: new Date(),
            publishedByUserId: asObjectId(input.ownerUserId),
          },
        ],
        { session },
      );
      await this.writeSenses(input.book.slug, chapter, built, input.ownerUserId, 0, session);
      return toChapter(created.toObject() as unknown as LeanChapter);
    });
  }

  /**
   * Replaces a published chapter's content with an edit (G8: the caller has
   * checked that its vocabulary only grew). Senses for the appended entries
   * are added in the same transaction.
   * @throws ChapterChangedError, SenseTakenError
   */
  async updateChapter(input: {
    bookSlug: string;
    chapter: string;
    revision: number;
    ownerUserId: string;
    built: { content: KogsChapterV1; senseIds: string[]; newSenses: NewSense[] };
  }): Promise<ChapterRecord> {
    const { Chapter } = this.mongoService.getModels();
    return this.withTransaction(async (session) => {
      const current = await Chapter.findOne({ bookSlug: input.bookSlug, chapter: input.chapter }).session(session).lean();
      if (!current || current.revision !== input.revision) throw new ChapterChangedError();
      const published = current.senseIds.length;
      const updated = await Chapter.findOneAndUpdate(
        { bookSlug: input.bookSlug, chapter: input.chapter, revision: input.revision },
        { $set: { content: input.built.content, senseIds: input.built.senseIds, publishedAt: new Date() }, $inc: { revision: 1 } },
        { returnDocument: 'after', session },
      ).lean();
      if (!updated) throw new ChapterChangedError();
      await this.writeSenses(input.bookSlug, input.chapter, input.built, input.ownerUserId, published, session);
      return toChapter(updated as unknown as LeanChapter);
    });
  }

  async setChapterArchived(bookSlug: string, chapter: string, archived: boolean): Promise<ChapterRecord | null> {
    const { Chapter } = this.mongoService.getModels();
    const row = await Chapter.findOneAndUpdate(
      { bookSlug, chapter },
      { $set: { archivedAt: archived ? new Date() : null } },
      { returnDocument: 'after' },
    ).lean();
    return row ? toChapter(row as unknown as LeanChapter) : null;
  }

  /** New senses, then each entry from `from` on as a source of its DB sense (JSON senses keep their file). */
  private async writeSenses(
    bookSlug: string,
    chapter: string,
    built: { senseIds: string[]; newSenses: NewSense[] },
    ownerUserId: string,
    from: number,
    session: ClientSession,
  ): Promise<void> {
    const { Sense } = this.mongoService.getModels();
    for (const sense of built.newSenses) {
      try {
        await Sense.create(
          [
            {
              language: sense.language,
              word: sense.word,
              sense: sense.sense,
              kind: sense.kind,
              gloss: sense.gloss,
              createdByUserId: asObjectId(ownerUserId),
            },
          ],
          { session },
        );
      } catch (error) {
        if (isDuplicateKey(error)) throw new SenseTakenError(sense.id);
        throw error;
      }
    }
    for (let i = from; i < built.senseIds.length; i++) {
      const [language, , word, sense] = built.senseIds[i].split('/');
      await Sense.updateOne(
        { language, word, sense },
        { $addToSet: { sources: `${bookSlug}/ch${chapter}/vocabulary/${i}` } },
        { session },
      );
    }
  }

  private async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const { Book } = this.mongoService.getModels();
    const session = await Book.db.startSession();
    try {
      session.startTransaction();
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
