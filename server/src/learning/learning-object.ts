import { z } from 'zod';
import { XAPI_BASE_IRI } from '../xapi/iris';

/**
 * Learning-object identity and IRIs (docs/xAPI/learning-objects.md →
 * Decisions A1–A3; docs/xAPI/leitner-method.md → Learning-object identity).
 *
 * Identity is language-scoped (A1): `ko/lexeme/시험/test` is the same
 * learning object whichever book or chapter teaches it. Book, chapter and
 * entry are provenance, carried as grouping and `ext/source-ref`. The kind
 * is part of the identity and the activity type (A3). Every IRI here is
 * permanent once pilot statements exist, like the base IRI.
 */

export const KOREAN_BOOK = 'korean-language-book';
export const KOREAN = 'ko';

export const EXT_SOURCE_REF = `${XAPI_BASE_IRI}/ext/source-ref`;
export const EXT_ASPECT = `${XAPI_BASE_IRI}/ext/aspect`;
export const EXT_GAME_KIND = `${XAPI_BASE_IRI}/ext/game-kind`;
export const EXT_ROLE = `${XAPI_BASE_IRI}/ext/role`;
export const EXT_STRENGTH = `${XAPI_BASE_IRI}/ext/strength`;
export const EXT_SCORER = `${XAPI_BASE_IRI}/ext/scorer`;

export const CHAPTER_TYPE = `${XAPI_BASE_IRI}/activity-types/chapter`;
export const BOOK_TYPE = `${XAPI_BASE_IRI}/activity-types/book`;

/**
 * Word-level kinds, as they appear in ids and IRIs. Patterns, sentences and
 * competencies get their own id shapes when they are built.
 */
export const vocabularyKindValues = ['lexeme', 'expression'] as const;
export type VocabularyKind = (typeof vocabularyKindValues)[number];

/** Activity type per kind: `lexeme` is one word in one sense. */
export const LEARNING_OBJECT_TYPES: Record<VocabularyKind, string> = {
  lexeme: `${XAPI_BASE_IRI}/activity-types/lexeme-sense`,
  expression: `${XAPI_BASE_IRI}/activity-types/expression`,
};

export type LearningObjectKey = {
  /** ISO 639 code, e.g. `ko`. */
  language: string;
  kind: VocabularyKind;
  /** Normalised text, e.g. `보여 주다`. */
  word: string;
  /** Sense slug from the registry, e.g. `to-show`. */
  sense: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE = /^[a-z]{2,3}$/;
const LO_PREFIX = `${XAPI_BASE_IRI}/lo/`;
const CONTENT_PREFIX = `${XAPI_BASE_IRI}/content/`;
const ID_PATTERN = /^([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/;

function isKind(value: string): value is VocabularyKind {
  return (vocabularyKindValues as readonly string[]).includes(value);
}

function assertSlug(kind: string, value: string): void {
  if (!SLUG.test(value)) {
    throw new Error(`Invalid ${kind} '${value}': use lower-case ASCII letters, digits and hyphens.`);
  }
}

function assertKey(key: LearningObjectKey): void {
  if (!LANGUAGE.test(key.language)) {
    throw new Error(`Invalid language '${key.language}': use a lower-case ISO 639 code, e.g. ko.`);
  }
  if (!isKind(key.kind)) {
    throw new Error(`Invalid kind '${String(key.kind)}': use ${vocabularyKindValues.join(' or ')}.`);
  }
  if (key.word.length === 0 || key.word.includes('/')) {
    throw new Error(`Invalid word '${key.word}': must be non-empty and contain no '/'.`);
  }
  assertSlug('sense', key.sense);
}

function keyFromParts(language: string, kind: string, word: string, sense: string): LearningObjectKey | null {
  if (!LANGUAGE.test(language) || !isKind(kind) || !SLUG.test(sense)) return null;
  if (word.length === 0 || word.includes('/')) return null;
  return { language, kind, word, sense };
}

/** Readable id stored on questions: `ko/lexeme/시험/test`. */
export function learningObjectId(key: LearningObjectKey): string {
  assertKey(key);
  return `${key.language}/${key.kind}/${key.word}/${key.sense}`;
}

/** Inverse of `learningObjectId`; null for anything else. */
export function parseLearningObjectId(id: string): LearningObjectKey | null {
  const match = ID_PATTERN.exec(id);
  return match ? keyFromParts(match[1], match[2], match[3], match[4]) : null;
}

/** Percent-encoded Hangul (L9): `…/lo/ko/lexeme/%EC%8B%9C%ED%97%98/test`. */
export function learningObjectIri(key: LearningObjectKey): string {
  assertKey(key);
  return `${LO_PREFIX}${key.language}/${key.kind}/${encodeURIComponent(key.word)}/${key.sense}`;
}

/** Inverse of `learningObjectIri`; null for game, chapter, book or foreign IRIs. */
export function parseLearningObjectIri(iri: string): LearningObjectKey | null {
  if (!iri.startsWith(LO_PREFIX)) {
    return null;
  }
  const match = ID_PATTERN.exec(iri.slice(LO_PREFIX.length));
  if (!match) {
    return null;
  }
  let word: string;
  try {
    word = decodeURIComponent(match[3]);
  } catch {
    return null;
  }
  return keyFromParts(match[1], match[2], word, match[4]);
}

/** `시험` → lexeme; anything with a space (`보여 주다`, `(돈을) 모으다`) → expression. */
export function defaultKind(word: string): VocabularyKind {
  return /\s/.test(word) ? 'expression' : 'lexeme';
}

export function bookIri(book: string): string {
  assertSlug('book', book);
  return `${CONTENT_PREFIX}${book}`;
}

export function chapterIri(book: string, chapter: string): string {
  assertSlug('chapter', chapter);
  return `${bookIri(book)}/ch${chapter}`;
}

/** `ch27/vocabulary/1` → `27`; null if it isn't a chapter source. */
export function chapterOfSourceRef(sourceRef: string): string | null {
  return /^ch(\d+)\/[a-z]+\/\d+$/.exec(sourceRef)?.[1] ?? null;
}

/**
 * Source refs are per book; statements, tracks and the registry use the
 * book-qualified form so sources from two books never collide:
 * `korean-language-book/ch27/vocabulary/1`.
 */
export function qualifiedSourceRef(book: string, sourceRef: string): string {
  assertSlug('book', book);
  if (chapterOfSourceRef(sourceRef) === null) {
    throw new Error(`Invalid sourceRef '${sourceRef}': must look like ch27/vocabulary/1.`);
  }
  return `${book}/${sourceRef}`;
}

/** Inverse of `qualifiedSourceRef`; null for anything else. */
export function parseQualifiedSourceRef(ref: string): { book: string; sourceRef: string } | null {
  const slash = ref.indexOf('/');
  const book = ref.slice(0, slash);
  const sourceRef = ref.slice(slash + 1);
  return slash > 0 && SLUG.test(book) && chapterOfSourceRef(sourceRef) !== null ? { book, sourceRef } : null;
}

/**
 * What a question tests (stored as `Question.learning`). Validated wherever
 * it enters, so a stored tag always builds valid IRIs.
 */
export const learningTagSchema = z
  .object({
    learningObjectId: z
      .string()
      .refine((id) => parseLearningObjectId(id) !== null, 'must be language/kind/word/sense, e.g. ko/lexeme/시험/test'),
    /** Where it was taught: the book and its entry. */
    book: z.string().regex(SLUG, 'must be a lower-case slug, e.g. korean-language-book'),
    sourceRef: z.string().refine((ref) => chapterOfSourceRef(ref) !== null, 'must look like ch27/vocabulary/1'),
    aspect: z.string().regex(SLUG, 'must be a lower-case slug, e.g. reading'),
    target: z.string().trim().min(1).max(200),
    native: z.string().trim().min(1).max(200),
  })
  .strict();

export type LearningTag = z.infer<typeof learningTagSchema>;
