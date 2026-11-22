import koreanSenses from '../games/content/ko-senses.json';
import { bookPatternsOf, type BookPattern } from '../games/generators/pattern-cloze';
import { findCatalogueBook } from './book-catalogue';
import {
  GRAMMAR_PATTERN,
  KOREAN,
  KOREAN_BOOK,
  learningObjectId,
  LearningObjectKey,
  parseQualifiedSourceRef,
} from './learning-object';
import { filePatterns, type GrammarPattern, type PatternIndex } from './pattern-registry';
import { chapterVocabulary, ChapterVocabulary, SenseRegistry } from './sense-registry';

/**
 * Runtime content registry (docs/xAPI/leitner-method.md → Content on the
 * server): `(book, chapter) → vocabulary` and `sourceRef → learning object`.
 * Learning objects are language-scoped (learning-objects.md → A1); the
 * book only says where they were taught.
 * Chapter files are imported as modules (`book-catalogue.ts`) so `tsc` ships
 * them in dist/server (the Docker image copies only that).
 */

export type LearningObject = LearningObjectKey & {
  /** `learningObjectId(key)`. */
  id: string;
  /** The book this chapter is in. */
  book: string;
  /** English as this chapter gives it. */
  gloss: string;
  /** Entries in this chapter that teach it (ch. 29 lists some words twice), unqualified. */
  sourceRefs: string[];
};

export type SenseEntry = LearningObjectKey & { id: string; gloss: string };

export type BookContent = {
  book: string;
  language: string;
  chapters: ReadonlyMap<string, ChapterVocabulary>;
  /** This book's registered sourceRefs (unqualified), whichever chapter they are in. */
  senseBySourceRef: ReadonlyMap<string, SenseEntry>;
  /** Every sense in the language registry, from any book (review tracks). */
  senseById: ReadonlyMap<string, SenseEntry>;
  /** Each chapter's grammar patterns with their sentences (cloze questions, H4b). */
  patterns: ReadonlyMap<string, BookPattern[]>;
  /** The language's pattern registry: which entries each book pattern teaches. */
  patternIndex: PatternIndex;
  /**
   * Other books' patterns, book-qualified (`korean-language-book/ch27/patterns/0`),
   * as cloze distractors after the book's own: a user book with a few
   * patterns has too few endings of its own.
   */
  distractorPatterns: readonly BookPattern[];
};

function patternsByChapter(rawChapters: readonly unknown[]): Map<string, BookPattern[]> {
  const patterns = new Map<string, BookPattern[]>();
  for (const raw of rawChapters) {
    const bookPatterns = bookPatternsOf(raw);
    const chapter = chapterVocabulary(raw).chapter;
    patterns.set(chapter, bookPatterns);
  }
  return patterns;
}

export class UnknownBookError extends Error {
  constructor(public readonly book: string) {
    super(`Unknown book '${book}'.`);
  }
}

export class UnknownChapterError extends Error {
  constructor(
    public readonly book: string,
    public readonly chapter: string,
  ) {
    super(`Book '${book}' has no chapter '${chapter}'.`);
  }
}

/** A chapter entry with no sense in the registry; run `npm run content:senses`. */
export class UnregisteredSensesError extends Error {
  constructor(public readonly sourceRefs: string[]) {
    super(`Chapter has vocabulary with no registered sense: ${sourceRefs.join(', ')}. Run npm run content:senses.`);
  }
}

/** Pure: index one book's chapters against the language registry. */
export function buildBookContent(
  book: string,
  registry: SenseRegistry,
  rawChapters: readonly unknown[],
): BookContent {
  const chapters = new Map<string, ChapterVocabulary>();
  for (const raw of rawChapters) {
    const vocabulary = chapterVocabulary(raw);
    chapters.set(vocabulary.chapter, vocabulary);
  }

  const senseBySourceRef = new Map<string, SenseEntry>();
  const senseById = new Map<string, SenseEntry>();
  for (const [word, senses] of Object.entries(registry.words)) {
    for (const sense of senses) {
      const key = { language: registry.language, kind: sense.kind, word, sense: sense.sense };
      const entry: SenseEntry = { ...key, id: learningObjectId(key), gloss: sense.gloss };
      senseById.set(entry.id, entry);
      for (const ref of sense.sources) {
        const parsed = parseQualifiedSourceRef(ref);
        if (parsed?.book === book) {
          senseBySourceRef.set(parsed.sourceRef, entry);
        }
      }
    }
  }
  return {
    book,
    language: registry.language,
    chapters,
    senseBySourceRef,
    senseById,
    patterns: patternsByChapter(rawChapters),
    patternIndex: filePatterns(registry.language),
    distractorPatterns: [],
  };
}

/** A learning object's display name for progress: a word and its gloss, or a pattern's headword and gloss. */
export function describeLearningObject(
  content: BookContent,
  learningObjectId: string,
): { word: string; gloss: string; kind: string } | null {
  const sense = content.senseById.get(learningObjectId);
  if (sense) return { word: sense.word, gloss: sense.gloss, kind: sense.kind };
  const pattern = content.patternIndex.byId.get(learningObjectId);
  return pattern ? { word: pattern.headword, gloss: pattern.gloss, kind: GRAMMAR_PATTERN } : null;
}

/**
 * The registry entries a book pattern teaches, in registry order (a user
 * book: in the order the chapter links them). `sourceRef` is this book's
 * (`ch27/patterns/0`) or book-qualified (a distractor from another book).
 */
export function patternEntriesOf(content: BookContent, sourceRef: string): readonly GrammarPattern[] {
  const qualified = parseQualifiedSourceRef(sourceRef) ? sourceRef : `${content.book}/${sourceRef}`;
  return content.patternIndex.bySource.get(qualified) ?? [];
}

/**
 * The chapter's grammar-pattern learning objects (docs/yalla/grammar-learning-objects.md),
 * one per registry entry, in pattern order. A book pattern with no linked
 * entry teaches nothing (a user chapter published before H4c).
 */
export function chapterPatternObjects(content: BookContent, chapter: string): LearningObject[] {
  const objects = new Map<string, LearningObject>();
  for (const pattern of content.patterns.get(chapter) ?? []) {
    for (const entry of patternEntriesOf(content, pattern.sourceRef)) {
      const existing = objects.get(entry.id);
      if (existing) {
        existing.sourceRefs.push(pattern.sourceRef);
      } else {
        objects.set(entry.id, {
          language: entry.language,
          kind: GRAMMAR_PATTERN,
          word: entry.form,
          sense: entry.meaning,
          id: entry.id,
          book: content.book,
          gloss: entry.gloss,
          sourceRefs: [pattern.sourceRef],
        });
      }
    }
  }
  return [...objects.values()];
}

/**
 * The chapter's learning objects in chapter order, one per sense. Refuses a
 * chapter with unregistered entries, so an id never depends on a guess.
 */
export function chapterLearningObjects(content: BookContent, chapter: string): LearningObject[] {
  const vocabulary = content.chapters.get(chapter);
  if (!vocabulary) {
    throw new UnknownChapterError(content.book, chapter);
  }

  const unregistered: string[] = [];
  const objects = new Map<string, LearningObject>();
  for (const entry of vocabulary.entries) {
    const sense = content.senseBySourceRef.get(entry.sourceRef);
    if (!sense || sense.word !== entry.word) {
      unregistered.push(entry.sourceRef);
      continue;
    }
    const existing = objects.get(sense.id);
    if (existing) {
      existing.sourceRefs.push(entry.sourceRef);
    } else {
      const { language, kind, word, sense: slug, id } = sense;
      objects.set(id, { language, kind, word, sense: slug, id, book: content.book, gloss: entry.gloss, sourceRefs: [entry.sourceRef] });
    }
  }
  if (unregistered.length > 0) {
    throw new UnregisteredSensesError(unregistered);
  }
  return [...objects.values()];
}

/**
 * A user book (docs/hashbrown/creating-games-with-hashbrown.md → Feature 2):
 * each published chapter stores its entries' learning objects
 * (`senseIds[i]` for entry i, `patternIds[i]` for book pattern i), so a
 * reused sense or pattern from any book or the registry file maps without a
 * source in the file. `senses` and `patternIndex` are the merged registries
 * (file plus DB layer).
 */
export function buildUserBookContent(
  book: string,
  language: string,
  senses: ReadonlyMap<string, SenseEntry>,
  chapters: ReadonlyArray<{ content: unknown; senseIds: readonly string[]; patternIds?: ReadonlyArray<readonly string[]> }>,
  patternIndex: PatternIndex = filePatterns(language),
): BookContent {
  const vocabularies = new Map<string, ChapterVocabulary>();
  const senseBySourceRef = new Map<string, SenseEntry>();
  const patterns = new Map<string, BookPattern[]>();
  const bySource = new Map(patternIndex.bySource);
  for (const { content, senseIds, patternIds = [] } of chapters) {
    const vocabulary = chapterVocabulary(content);
    vocabularies.set(vocabulary.chapter, vocabulary);
    const bookPatterns = bookPatternsOf(content);
    patterns.set(vocabulary.chapter, bookPatterns);
    vocabulary.entries.forEach((entry) => {
      const index = Number(entry.sourceRef.split('/').pop());
      const sense = senses.get(senseIds[index] ?? '');
      if (sense) senseBySourceRef.set(entry.sourceRef, sense);
    });
    bookPatterns.forEach((pattern, i) => {
      const entries = (patternIds[i] ?? []).flatMap((id) => patternIndex.byId.get(id) ?? []);
      bySource.set(`${book}/${pattern.sourceRef}`, entries);
    });
  }
  // The built-in book of the language lends its endings as distractors.
  const lender = language === KOREAN ? getBookContent(KOREAN_BOOK) : null;
  const distractorPatterns = lender
    ? [...lender.patterns.values()].flat().map((pattern) => ({ ...pattern, sourceRef: `${lender.book}/${pattern.sourceRef}` }))
    : [];
  return {
    book,
    language,
    chapters: vocabularies,
    senseBySourceRef,
    senseById: senses,
    patterns,
    patternIndex: { ...patternIndex, bySource },
    distractorPatterns,
  };
}

/** Every sense in a language's committed registry file, by id (empty for a language without one). */
export function fileSenses(language: string): ReadonlyMap<string, SenseEntry> {
  return language === KOREAN ? getBookContent(KOREAN_BOOK).senseById : new Map();
}

/** Built-in books (`book-catalogue.ts`). User books load through `BookContentService`. */
export function isBuiltInBook(book: string): boolean {
  return loaders.has(book);
}

const loaders = new Map<string, () => BookContent>([
  [
    KOREAN_BOOK,
    () =>
      buildBookContent(KOREAN_BOOK, koreanSenses as SenseRegistry, findCatalogueBook(KOREAN_BOOK)?.chapters ?? []),
  ],
]);
const cache = new Map<string, BookContent>();

export function getBookContent(book: string): BookContent {
  const cached = cache.get(book);
  if (cached) {
    return cached;
  }
  const load = loaders.get(book);
  if (!load) {
    throw new UnknownBookError(book);
  }
  const content = load();
  cache.set(book, content);
  return content;
}
