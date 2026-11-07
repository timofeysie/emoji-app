import { z } from 'zod';
import { BOOK_CATALOGUE, findCatalogueBook, type CatalogueBook } from '../learning/book-catalogue';
import { getBookContent, UnknownBookError, UnknownChapterError } from '../learning/book-content';

/**
 * Study content for YALLA (docs/yalla/implementation-plan.md §3): the whole
 * chapter (dialog, vocabulary, patterns), not just the vocabulary the
 * Leitner registry indexes. Vocabulary comes from the registry's
 * normalised entries (ch. 28's swapped fields fixed) with each entry's
 * learning object, so later milestones can join progress onto it.
 */

const text = z.string().transform((value) => value.replace(/\s+/g, ' ').trim());
const optionalText = text.optional().default('');

const chapterSchema = z.object({
  chapter: z.union([z.string(), z.number()]).transform(String),
  titleTarget: optionalText,
  titleNative: optionalText,
  dialog: z
    .array(
      z.object({
        speakerNameTarget: optionalText,
        speakerNameNative: optionalText,
        speechTarget: text,
        speechNative: optionalText,
      }),
    )
    .default([]),
  patterns: z
    .array(
      z.object({
        patternTarget: text,
        patternNative: optionalText,
        type: text.optional(),
        exampleSentenceNativeTitle: optionalText,
        exampleSentenceTarget: optionalText,
        exampleSentenceNative: optionalText,
        sampleSentences: z.array(z.object({ targetText: text, nativeText: optionalText })).default([]),
        exercises: z.array(z.object({ exercise: text, answerKey: optionalText })).default([]),
        appliedPatterns: z
          .array(
            z.object({
              pattern: optionalText,
              patternTargetText: text,
              patternNativeText: optionalText,
              patternNote: text.optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

type ParsedChapter = z.infer<typeof chapterSchema>;

export type ChapterSummary = { chapter: string; titleTarget: string; titleNative: string };

export type BookSummary = {
  book: string;
  title: string;
  language: string;
  chapters: ChapterSummary[];
};

export type StudyVocabularyEntry = {
  /** `ch27/vocabulary/3`. */
  sourceRef: string;
  /** Korean. */
  word: string;
  /** English. */
  gloss: string;
  /** Null when the entry has no registered sense yet (`npm run content:senses`). */
  learningObjectId: string | null;
  kind: string | null;
};

export type StudyChapter = ChapterSummary & {
  book: string;
  bookTitle: string;
  language: string;
  dialog: ParsedChapter['dialog'];
  vocabulary: StudyVocabularyEntry[];
  patterns: ParsedChapter['patterns'];
};

function parseChapters(entry: CatalogueBook): ParsedChapter[] {
  return entry.chapters
    .map((raw) => chapterSchema.parse(raw))
    .sort((a, b) => Number(a.chapter) - Number(b.chapter));
}

function summarize(chapter: ParsedChapter): ChapterSummary {
  return { chapter: chapter.chapter, titleTarget: chapter.titleTarget, titleNative: chapter.titleNative };
}

function bookSummary(entry: CatalogueBook): BookSummary {
  return {
    book: entry.book,
    title: entry.title,
    language: getBookContent(entry.book).language,
    chapters: parseChapters(entry).map(summarize),
  };
}

export function listBooks(): BookSummary[] {
  return BOOK_CATALOGUE.map(bookSummary);
}

/** @throws UnknownBookError */
export function getBook(book: string): BookSummary {
  const entry = findCatalogueBook(book);
  if (!entry) {
    throw new UnknownBookError(book);
  }
  return bookSummary(entry);
}

/** @throws UnknownBookError, UnknownChapterError */
export function getStudyChapter(book: string, chapter: string): StudyChapter {
  const entry = findCatalogueBook(book);
  if (!entry) {
    throw new UnknownBookError(book);
  }
  const parsed = parseChapters(entry).find((candidate) => candidate.chapter === chapter);
  const content = getBookContent(book);
  const vocabulary = content.chapters.get(chapter);
  if (!parsed || !vocabulary) {
    throw new UnknownChapterError(book, chapter);
  }

  return {
    ...summarize(parsed),
    book,
    bookTitle: entry.title,
    language: content.language,
    dialog: parsed.dialog,
    vocabulary: vocabulary.entries.map((vocab) => {
      const sense = content.senseBySourceRef.get(vocab.sourceRef);
      const registered = sense && sense.word === vocab.word ? sense : undefined;
      return {
        sourceRef: vocab.sourceRef,
        word: vocab.word,
        gloss: vocab.gloss,
        learningObjectId: registered?.id ?? null,
        kind: registered?.kind ?? null,
      };
    }),
    patterns: parsed.patterns,
  };
}
