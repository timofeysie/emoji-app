import chapter26 from '../games/content/chapter26Data.json';
import chapter27 from '../games/content/chapter27Data.json';
import chapter28 from '../games/content/chapter28Data.json';
import chapter29 from '../games/content/chapter29Data.json';
import chapter30 from '../games/content/chapter30Data.json';
import koreanSenses from '../games/content/ko-senses.json';
import {
  KOREAN_BOOK,
  learningObjectId,
  LearningObjectKey,
  parseQualifiedSourceRef,
} from './learning-object';
import { chapterVocabulary, ChapterVocabulary, SenseRegistry } from './sense-registry';

/**
 * Runtime content registry (docs/xAPI/leitner-method.md → Content on the
 * server): `(book, chapter) → vocabulary` and `sourceRef → learning object`.
 * Learning objects are language-scoped (learning-objects.md → A1); the
 * book only says where they were taught.
 * Chapter files are imported as modules so `tsc` ships them in dist/server
 * (the Docker image copies only that). Add a chapter here after running
 * `npm run content:senses`.
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
};

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
  return { book, language: registry.language, chapters, senseBySourceRef, senseById };
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

const loaders = new Map<string, () => BookContent>([
  [
    KOREAN_BOOK,
    () =>
      buildBookContent(KOREAN_BOOK, koreanSenses as SenseRegistry, [chapter26, chapter27, chapter28, chapter29, chapter30]),
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
