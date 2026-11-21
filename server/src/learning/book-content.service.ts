import { Injectable } from '@nestjs/common';
import { BookRepository, type BookRecord, type ChapterRecord } from '../persistence/book.repository';
import {
  buildUserBookContent,
  fileSenses,
  getBookContent,
  isBuiltInBook,
  UnknownBookError,
  type BookContent,
  type SenseEntry,
} from './book-content';
import { learningObjectId } from './learning-object';
import { normaliseWord } from './sense-registry';

export type FoundSense = { id: string; gloss: string; kind: string; from: 'registry' | 'library' };

/**
 * Book content for built-in and user books
 * (docs/hashbrown/creating-games-with-hashbrown.md → Content registry
 * changes). Built-in books load as before, synchronously, from the
 * committed JSON. User books load from `chapters`, against the registry
 * file merged with the `senses` collection (the file wins on a clash).
 * Publishing clears the book and the language's senses.
 *
 * Everything that reads a book by slug uses it: YALLA study pages, sense
 * lookups, the Leitner planner (badge games and YALLA practice), progress,
 * the practice re-check and export (H3).
 */
@Injectable()
export class BookContentService {
  private readonly books = new Map<string, Promise<BookContent>>();
  private readonly senses = new Map<string, Promise<ReadonlyMap<string, SenseEntry>>>();

  constructor(private readonly repository: BookRepository) {}

  /** The language's senses by id: the registry file, then the ones users added. */
  registry(language: string): Promise<ReadonlyMap<string, SenseEntry>> {
    let cached = this.senses.get(language);
    if (!cached) {
      cached = this.loadRegistry(language);
      this.senses.set(language, cached);
      cached.catch(() => this.senses.delete(language));
    }
    return cached;
  }

  /** Each word's existing senses (G7): the AI and the editor reuse one when the meaning matches. */
  async findSenses(language: string, words: readonly string[]): Promise<Array<{ word: string; senses: FoundSense[] }>> {
    const registry = await this.registry(language);
    const file = fileSenses(language);
    const byWord = new Map<string, FoundSense[]>();
    for (const entry of registry.values()) {
      const list = byWord.get(entry.word) ?? [];
      list.push({ id: entry.id, gloss: entry.gloss, kind: entry.kind, from: file.has(entry.id) ? 'registry' : 'library' });
      byWord.set(entry.word, list);
    }
    return words.map((raw) => {
      const word = normaliseWord(raw);
      return { word, senses: byWord.get(word) ?? [] };
    });
  }

  /** @throws UnknownBookError */
  getBookContent(book: string): Promise<BookContent> {
    if (isBuiltInBook(book)) {
      return Promise.resolve(getBookContent(book));
    }
    let cached = this.books.get(book);
    if (!cached) {
      cached = this.loadUserBook(book);
      this.books.set(book, cached);
      cached.catch(() => this.books.delete(book));
    }
    return cached;
  }

  /** After a publish or an edit: the next read loads the book and its language's senses again. */
  clear(book: string, language: string): void {
    this.books.delete(book);
    this.senses.delete(language);
  }

  /** A user book and its chapters, or null (also without Mongo). */
  async userBook(book: string): Promise<{ book: BookRecord; chapters: ChapterRecord[] } | null> {
    if (isBuiltInBook(book) || !this.repository.isAvailable()) return null;
    const record = await this.repository.getBook(book);
    if (!record) return null;
    return { book: record, chapters: await this.repository.listChapters(book) };
  }

  private async loadRegistry(language: string): Promise<ReadonlyMap<string, SenseEntry>> {
    const merged = new Map(fileSenses(language));
    if (!this.repository.isAvailable()) return merged;
    for (const sense of await this.repository.listSenses(language)) {
      const key = { language, kind: sense.kind, word: sense.word, sense: sense.sense };
      const id = learningObjectId(key);
      if (!merged.has(id)) merged.set(id, { ...key, id, gloss: sense.gloss });
    }
    return merged;
  }

  private async loadUserBook(book: string): Promise<BookContent> {
    const loaded = await this.userBook(book);
    if (!loaded) throw new UnknownBookError(book);
    const language = loaded.book.language.target;
    return buildUserBookContent(book, language, await this.registry(language), loaded.chapters);
  }
}
