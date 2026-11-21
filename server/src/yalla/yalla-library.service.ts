import { Injectable } from '@nestjs/common';
import { kogsChapterV1Schema } from '../content/kogs-chapter';
import { UnknownBookError, UnknownChapterError } from '../learning/book-content';
import { BookContentService } from '../learning/book-content.service';
import { findCatalogueBook } from '../learning/book-catalogue';
import type { BookRecord, ChapterRecord } from '../persistence/book.repository';
import { BookRepository } from '../persistence/book.repository';
import {
  getBook as getCatalogueBook,
  getStudyChapter as getCatalogueChapter,
  listBooks as listCatalogueBooks,
  studyChapterFrom,
  summarize,
  type BookSummary,
  type ChapterSummary,
  type StudyChapter,
} from './yalla-content';

/** Whose book: the built-in catalogue, the caller's, or another referee's open book (G12). */
export type LibraryOwner = 'built-in' | 'mine' | 'other';

export type LibraryChapterSummary = ChapterSummary & { archived?: boolean };

export type LibraryBookSummary = Omit<BookSummary, 'chapters'> & {
  owner: LibraryOwner;
  chapters: LibraryChapterSummary[];
};

export type RemixCredit = { book: string; chapter: string; bookTitle: string; chapterTitle: string };

export type LibraryStudyChapter = StudyChapter & {
  owner: LibraryOwner;
  archived: boolean;
  /** User chapters: bumped by each edit. Null for built-in chapters. */
  revision: number | null;
  /** Credited by title only, never by the referee (G12). */
  remixedFrom: RemixCredit | null;
};

/**
 * YALLA's books: the built-in catalogue, then the caller's books, then other
 * referees' open books (docs/hashbrown/creating-games-with-hashbrown.md →
 * Open content and remixing). Archived chapters are hidden from everyone
 * but their owner, and still open by link.
 */
@Injectable()
export class YallaLibraryService {
  constructor(
    private readonly books: BookRepository,
    private readonly content: BookContentService,
  ) {}

  async listBooks(userId: string | null): Promise<LibraryBookSummary[]> {
    const builtIn = listCatalogueBooks().map((book) => ({ ...book, owner: 'built-in' as const }));
    if (!this.books.isAvailable()) return builtIn;
    const records = (await this.books.listBooks()).filter((book) => !book.archivedAt);
    const user = await Promise.all(records.map((book) => this.userBookSummary(book, userId)));
    const visible = user.filter((book) => book.owner === 'mine' || book.chapters.length > 0);
    return [...builtIn, ...visible.filter((book) => book.owner === 'mine'), ...visible.filter((book) => book.owner === 'other')];
  }

  /** @throws UnknownBookError */
  async getBook(slug: string, userId: string | null): Promise<LibraryBookSummary> {
    if (findCatalogueBook(slug)) return { ...getCatalogueBook(slug), owner: 'built-in' };
    const record = this.books.isAvailable() ? await this.books.getBook(slug) : null;
    if (!record) throw new UnknownBookError(slug);
    return this.userBookSummary(record, userId);
  }

  /** @throws UnknownBookError, UnknownChapterError */
  async getStudyChapter(slug: string, chapter: string, userId: string | null): Promise<LibraryStudyChapter> {
    if (findCatalogueBook(slug)) {
      return { ...getCatalogueChapter(slug, chapter), owner: 'built-in', archived: false, revision: null, remixedFrom: null };
    }
    const loaded = await this.content.userBook(slug);
    if (!loaded) throw new UnknownBookError(slug);
    const record = loaded.chapters.find((candidate) => candidate.chapter === chapter);
    if (!record) throw new UnknownChapterError(slug, chapter);
    const content = await this.content.getBookContent(slug);
    const study = studyChapterFrom(kogsChapterV1Schema.parse(record.content), content, {
      book: slug,
      bookTitle: loaded.book.title,
    });
    return {
      ...study,
      owner: loaded.book.ownerUserId === userId ? 'mine' : 'other',
      archived: record.archivedAt !== null,
      revision: record.revision,
      remixedFrom: record.remixedFrom ? await this.credit(record.remixedFrom.book, record.remixedFrom.chapter) : null,
    };
  }

  /** The title of the chapter a remix came from, if it can still be found. */
  async credit(book: string, chapter: string): Promise<RemixCredit | null> {
    try {
      if (findCatalogueBook(book)) {
        const study = getCatalogueChapter(book, chapter);
        return { book, chapter, bookTitle: study.bookTitle, chapterTitle: study.titleNative || study.titleTarget };
      }
      const loaded = await this.content.userBook(book);
      const record = loaded?.chapters.find((candidate) => candidate.chapter === chapter);
      if (!loaded || !record) return null;
      const parsed = kogsChapterV1Schema.parse(record.content);
      return { book, chapter, bookTitle: loaded.book.title, chapterTitle: parsed.titleNative || parsed.titleTarget };
    } catch {
      return null;
    }
  }

  private async userBookSummary(book: BookRecord, userId: string | null): Promise<LibraryBookSummary> {
    const owner: LibraryOwner = book.ownerUserId === userId ? 'mine' : 'other';
    const chapters = await this.books.listChapters(book.slug);
    return {
      book: book.slug,
      title: book.title,
      language: book.language.target,
      owner,
      chapters: chapters
        .filter((chapter) => owner === 'mine' || !chapter.archivedAt)
        .map((chapter) => chapterSummary(chapter)),
    };
  }
}

function chapterSummary(record: ChapterRecord): LibraryChapterSummary {
  const summary = summarize(kogsChapterV1Schema.parse(record.content));
  return record.archivedAt ? { ...summary, archived: true } : summary;
}
