import { z } from 'zod';
import { XAPI_BASE_IRI } from '../xapi/iris';

/**
 * Learning-object identity and IRIs (docs/xAPI/leitner-method.md →
 * Learning-object identity, Statement changes). A vocabulary learning object
 * is one word in one sense. Every IRI here is permanent once pilot
 * statements exist, like the base IRI.
 */

export const KOREAN_BOOK = 'korean-language-book';

export const EXT_SOURCE_REF = `${XAPI_BASE_IRI}/ext/source-ref`;
export const EXT_ASPECT = `${XAPI_BASE_IRI}/ext/aspect`;
export const EXT_GAME_KIND = `${XAPI_BASE_IRI}/ext/game-kind`;

export const VOCABULARY_SENSE_TYPE = `${XAPI_BASE_IRI}/activity-types/vocabulary-sense`;
export const CHAPTER_TYPE = `${XAPI_BASE_IRI}/activity-types/chapter`;
export const BOOK_TYPE = `${XAPI_BASE_IRI}/activity-types/book`;

export type LearningObjectKey = {
  book: string;
  /** Normalised Korean, e.g. `보여 주다`. */
  word: string;
  /** Sense slug from the registry, e.g. `to-show`. */
  sense: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTENT_PREFIX = `${XAPI_BASE_IRI}/content/`;

function assertSlug(kind: string, value: string): void {
  if (!SLUG.test(value)) {
    throw new Error(`Invalid ${kind} '${value}': use lower-case ASCII letters, digits and hyphens.`);
  }
}

function assertWord(word: string): void {
  if (word.length === 0 || word.includes('/')) {
    throw new Error(`Invalid word '${word}': must be non-empty and contain no '/'.`);
  }
}

/** Readable id stored on questions: `korean-language-book/vocabulary/시험/test`. */
export function learningObjectId(key: LearningObjectKey): string {
  assertSlug('book', key.book);
  assertWord(key.word);
  assertSlug('sense', key.sense);
  return `${key.book}/vocabulary/${key.word}/${key.sense}`;
}

/** Inverse of `learningObjectId`; null for anything else. */
export function parseLearningObjectId(id: string): LearningObjectKey | null {
  const match = /^([^/]+)\/vocabulary\/([^/]+)\/([^/]+)$/.exec(id);
  if (!match || !SLUG.test(match[1]) || !SLUG.test(match[3])) {
    return null;
  }
  return { book: match[1], word: match[2], sense: match[3] };
}

export function bookIri(book: string): string {
  assertSlug('book', book);
  return `${CONTENT_PREFIX}${book}`;
}

export function chapterIri(book: string, chapter: string): string {
  assertSlug('chapter', chapter);
  return `${bookIri(book)}/ch${chapter}`;
}

/** Percent-encoded Hangul (L9): `…/content/korean-language-book/vocabulary/%EC%8B%9C%ED%97%98/test`. */
export function learningObjectIri(key: LearningObjectKey): string {
  learningObjectId(key);
  return `${bookIri(key.book)}/vocabulary/${encodeURIComponent(key.word)}/${key.sense}`;
}

/** Inverse of `learningObjectIri`; null for game, chapter, book or foreign IRIs. */
export function parseLearningObjectIri(iri: string): LearningObjectKey | null {
  if (!iri.startsWith(CONTENT_PREFIX)) {
    return null;
  }
  const match = /^([^/]+)\/vocabulary\/([^/]+)\/([^/]+)$/.exec(iri.slice(CONTENT_PREFIX.length));
  if (!match || !SLUG.test(match[1]) || !SLUG.test(match[3])) {
    return null;
  }
  let word: string;
  try {
    word = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  return word.length > 0 && !word.includes('/') ? { book: match[1], word, sense: match[3] } : null;
}

/** `ch27/vocabulary/1` → `27`; null if it isn't a chapter source. */
export function chapterOfSourceRef(sourceRef: string): string | null {
  return /^ch(\d+)\/[a-z]+\/\d+$/.exec(sourceRef)?.[1] ?? null;
}

/**
 * What a question tests (stored as `Question.learning`). Validated wherever
 * it enters, so a stored tag always builds valid IRIs.
 */
export const learningTagSchema = z
  .object({
    learningObjectId: z
      .string()
      .refine((id) => parseLearningObjectId(id) !== null, 'must be book/vocabulary/word/sense'),
    sourceRef: z.string().refine((ref) => chapterOfSourceRef(ref) !== null, 'must look like ch27/vocabulary/1'),
    aspect: z.string().regex(SLUG, 'must be a lower-case slug, e.g. reading'),
    target: z.string().trim().min(1).max(200),
    native: z.string().trim().min(1).max(200),
  })
  .strict();

export type LearningTag = z.infer<typeof learningTagSchema>;
