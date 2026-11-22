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
import { KOREAN, KOREAN_BOOK, learningObjectId } from './learning-object';
import { filePatterns, findPatternMatches, mergePatterns, type GrammarPattern, type PatternIndex } from './pattern-registry';
import { normaliseWord } from './sense-registry';

export type FoundSense = { id: string; gloss: string; kind: string; from: 'registry' | 'library' };

export type FoundPattern = { id: string; headword: string; gloss: string; from: 'registry' | 'library' };

export type FoundPatterns = {
  spelling: string;
  /** The matching key, or null when the spelling can't be read (`problem` says why). */
  key: string | null;
  problem: string | null;
  exact: FoundPattern[];
  contained: FoundPattern[];
};

/**
 * Book content for built-in and user books
 * (docs/hashbrown/creating-games-with-hashbrown.md → Content registry
 * changes). Built-in books load as before, synchronously, from the
 * committed JSON. User books load from `chapters`, against the registry
 * file merged with the `senses` collection (the file wins on a clash).
 * Grammar patterns work the same way: the registry file merged with the
 * `patterns` collection (H4c). Publishing clears the book and the
 * language's senses and patterns.
 *
 * Everything that reads a book by slug uses it: YALLA study pages, sense
 * lookups, the Leitner planner (badge games and YALLA practice), progress,
 * the practice re-check and export (H3).
 */
@Injectable()
export class BookContentService {
  private readonly books = new Map<string, Promise<BookContent>>();
  private readonly senses = new Map<string, Promise<ReadonlyMap<string, SenseEntry>>>();
  private readonly patternIndexes = new Map<string, Promise<PatternIndex>>();

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

  /** The language's grammar patterns: the registry file, then the ones users added. */
  patterns(language: string): Promise<PatternIndex> {
    let cached = this.patternIndexes.get(language);
    if (!cached) {
      cached = this.loadPatterns(language);
      this.patternIndexes.set(language, cached);
      cached.catch(() => this.patternIndexes.delete(language));
    }
    return cached;
  }

  /** Each book pattern's matching entries (GP2, GP5): the AI and the editor reuse exact ones by default. */
  async findPatterns(language: string, spellings: readonly string[]): Promise<FoundPatterns[]> {
    const index = await this.patterns(language);
    const file = filePatterns(language);
    const found = (pattern: GrammarPattern): FoundPattern => ({
      id: pattern.id,
      headword: pattern.headword,
      gloss: pattern.gloss,
      from: file.byId.has(pattern.id) ? 'registry' : 'library',
    });
    return spellings.map((spelling) => {
      const matches = findPatternMatches(index, spelling);
      return {
        spelling,
        key: matches.key,
        problem: matches.problem,
        exact: matches.exact.map(found),
        contained: matches.contained.map(found),
      };
    });
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

  /** After a publish or an edit: the next read loads the book and its language's senses and patterns again. */
  clear(book: string, language: string): void {
    this.books.delete(book);
    this.senses.delete(language);
    this.patternIndexes.delete(language);
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

  private async loadPatterns(language: string): Promise<PatternIndex> {
    // The built-in book's own spellings, combinations included (`계속 더 … -아/어/여지네` → both entries).
    const builtIn = language === KOREAN ? getBookContent(KOREAN_BOOK) : null;
    const spellings = builtIn
      ? [...builtIn.patterns.values()].flat().flatMap((pattern) =>
          (builtIn.patternIndex.bySource.get(`${builtIn.book}/${pattern.sourceRef}`) ?? []).map((entry) => ({
            id: entry.id,
            spelling: pattern.patternTarget,
          })),
        )
      : [];
    const stored = this.repository.isAvailable() ? await this.repository.listPatterns(language) : [];
    return mergePatterns(filePatterns(language), stored, spellings);
  }

  private async loadUserBook(book: string): Promise<BookContent> {
    const loaded = await this.userBook(book);
    if (!loaded) throw new UnknownBookError(book);
    const language = loaded.book.language.target;
    return buildUserBookContent(book, language, await this.registry(language), loaded.chapters, await this.patterns(language));
  }
}
