import { randomBytes } from 'crypto';
import { z } from 'zod';
import { PatternSpellingError, patternForm } from '../learning/grammar-pattern';
import {
  GRAMMAR_PATTERN,
  KOREAN_BOOK,
  learningObjectId,
  parseLearningObjectId,
  vocabularyKindValues,
  type VocabularyKind,
} from '../learning/learning-object';
import { patternId } from '../learning/pattern-registry';
import { normaliseWord } from '../learning/sense-registry';
import type { DraftProblem } from './game-draft';
import { languagePairSchema } from './game-draft';
import type { KogsChapterV1 } from './kogs-chapter';

/**
 * Library chapter drafts (docs/hashbrown/creating-games-with-hashbrown.md →
 * Feature 2). A draft holds a `kogs.chapter.v1` chapter plus what publishing
 * needs: the book it goes in, a sense decision per vocabulary entry (G7:
 * reuse an existing sense, or a new one the user confirms) and the
 * grammar-pattern entries each book pattern teaches (H4c, GP5: the same
 * reuse-or-new choice). The client's
 * `library/chapter-limits.ts` repeats `CHAPTER_DRAFT_LIMITS`; a spec keeps
 * them equal.
 */
export const CHAPTER_DRAFT_LIMITS = {
  /** Leitner distractors come from the same chapter. */
  minVocabulary: 6,
  maxVocabulary: 30,
  maxPatterns: 5,
  /** Registry entries one book pattern teaches (`-아/어지다` + `-네`). */
  maxPatternEntries: 3,
  maxDialogLines: 100,
  maxTitleLength: 100,
  maxWordLength: 40,
  maxGlossLength: 120,
  maxSenseSlugLength: 40,
  maxBookSlugLength: 48,
  maxPatternHeadwordLength: 60,
  maxPatternGlossLength: 120,
} as const;

/** A user book's slug can't take a built-in book's. */
export const RESERVED_BOOK_SLUGS: readonly string[] = [KOREAN_BOOK];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

export const senseDecisionValues = ['undecided', 'reuse', 'new'] as const;

/** Flat, so the model and the editor fill the same fields. */
export const senseDecisionSchema = z
  .object({
    decision: z.enum(senseDecisionValues),
    /** `reuse`: an existing learning-object id, e.g. `ko/lexeme/시험/test`. */
    reuseId: z.string().max(200).default(''),
    /** `new`: the ASCII slug, e.g. `rabbit`. */
    newSense: z.string().max(100).default(''),
    kind: z.enum(vocabularyKindValues).default('lexeme'),
    /** `new`: the sense's gloss; the entry's first meaning when empty. */
    newGloss: z.string().max(300).default(''),
    /** `new`: the user has checked it (G7). Publishing needs it. */
    confirmed: z.boolean().default(false),
  })
  .strict();

export type SenseDecision = z.infer<typeof senseDecisionSchema>;

export const patternDecisionValues = ['reuse', 'new'] as const;

/**
 * One registry entry a book pattern teaches (docs/yalla/grammar-learning-objects.md,
 * GP5). Flat, like the sense decision. A new entry's id comes from its
 * headword and meaning (GP3), never typed.
 */
export const patternDecisionSchema = z
  .object({
    decision: z.enum(patternDecisionValues),
    /** `reuse`: an existing entry, e.g. `ko/grammar-pattern/a-eo-jida/become`. */
    reuseId: z.string().max(200).default(''),
    /** `new`: the smallest teachable pattern, default style `-아/어/여지다`. */
    headword: z.string().max(100).default(''),
    /** `new`: the English meaning slug, e.g. `become`. */
    meaning: z.string().max(100).default(''),
    /** `new`: what it means, e.g. `gets to be, becomes`. */
    gloss: z.string().max(300).default(''),
    /** `new`: the user has checked it. Publishing needs it. */
    confirmed: z.boolean().default(false),
  })
  .strict();

export type PatternDecision = z.infer<typeof patternDecisionSchema>;

const field = (max: number) => z.string().max(max).default('');

/** What a chapter draft may hold while it's edited: the shape, with loose size caps. */
export const chapterDraftPayloadSchema = z
  .object({
    /** An existing book of the user's, or empty for `newBook`. */
    bookSlug: field(100),
    newBook: z.object({ title: field(300), slug: field(100) }).strict().default({ title: '', slug: '' }),
    language: languagePairSchema.optional(),
    titleTarget: field(500),
    titleNative: field(500),
    dialog: z
      .array(
        z
          .object({
            speakerNameTarget: field(100),
            speakerNameNative: field(100),
            speechTarget: field(2000),
            speechNative: field(2000),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    vocabulary: z
      .array(
        z
          .object({
            targetLanguageText: field(200),
            nativeLanguageText: field(500),
            sense: senseDecisionSchema.default({ decision: 'undecided' }),
          })
          .strict(),
      )
      .max(60)
      .default([]),
    patterns: z
      .array(
        z
          .object({
            patternTarget: field(300),
            patternNative: field(500),
            type: field(50),
            exampleSentenceTarget: field(500),
            exampleSentenceNative: field(500),
            sampleSentences: z
              .array(z.object({ targetText: field(500), nativeText: field(500) }).strict())
              .max(10)
              .default([]),
            exercises: z
              .array(z.object({ exercise: field(500), answerKey: field(500) }).strict())
              .max(10)
              .default([]),
            /** The registry entries it teaches (H4c). */
            entries: z.array(patternDecisionSchema).max(10).default([]),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();

export type ChapterDraftPayload = z.infer<typeof chapterDraftPayloadSchema>;
export type ChapterDraftInput = z.input<typeof chapterDraftPayloadSchema>;

/** The chapter a draft edits or was remixed from. */
export type ChapterRef = { book: string; chapter: string };

/** Its vocabulary at the last publish: entries can be appended, never reordered or removed (G8). */
export type FrozenChapter = ChapterRef & {
  words: string[];
  senseIds: string[];
  patternCount: number;
  /** Each published pattern's entries: they stay, others can be added. */
  patternIds: string[][];
};

/** What the sense registry (JSON plus the DB layer) knows, for the checks that need it. */
export type SenseLookup = {
  /** Every registered id. */
  has(id: string): boolean;
};

export function emptyChapterPayload(): ChapterDraftPayload {
  return chapterDraftPayloadSchema.parse({});
}

/** `The Rabbit and the Turtle` → `the-rabbit-and-the-turtle-3f9a` (G9). Hangul-only titles become `book-3f9a`. */
export function suggestBookSlug(title: string, hex: string = randomBytes(2).toString('hex')): string {
  const base = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CHAPTER_DRAFT_LIMITS.maxBookSlugLength - 5)
    .replace(/-+$/, '');
  return `${base || 'book'}-${hex}`;
}

/** The entry's learning-object id, or null while undecided or invalid. */
export function resolvedSenseId(
  entry: ChapterDraftPayload['vocabulary'][number],
  language: string,
): string | null {
  const word = normaliseWord(entry.targetLanguageText);
  const { sense } = entry;
  if (sense.decision === 'reuse') {
    const key = parseLearningObjectId(sense.reuseId.trim());
    return key && key.language === language && key.word === word ? sense.reuseId.trim() : null;
  }
  if (sense.decision === 'new') {
    try {
      return learningObjectId({ language, kind: sense.kind, word, sense: sense.newSense.trim() });
    } catch {
      return null;
    }
  }
  return null;
}

/** The entry's learning-object id, or null while invalid. */
export function resolvedPatternId(decision: PatternDecision, language: string): string | null {
  if (decision.decision === 'reuse') {
    const id = decision.reuseId.trim();
    const key = parseLearningObjectId(id);
    return key && key.language === language && key.kind === GRAMMAR_PATTERN ? id : null;
  }
  try {
    return patternId(language, decision.headword.trim(), decision.meaning.trim());
  } catch {
    return null;
  }
}

/** Each book pattern's resolved entry ids, unresolved ones left out. */
export function resolvedPatternIds(payload: ChapterDraftPayload): string[][] {
  const language = targetLanguageOf(payload);
  return payload.patterns.map((pattern) => [
    ...new Set(pattern.entries.flatMap((decision) => resolvedPatternId(decision, language) ?? [])),
  ]);
}

export function targetLanguageOf(payload: ChapterDraftPayload): string {
  return payload.language?.target ?? 'ko';
}

/**
 * Everything that stops a chapter draft being published, without the
 * registry: empty is publishable as far as the draft itself goes.
 * `frozen` is the published chapter an edit draft changes.
 */
export function chapterDraftProblems(payload: ChapterDraftPayload | null, frozen?: FrozenChapter | null): DraftProblem[] {
  if (!payload) {
    return [{ path: 'vocabulary', message: 'No chapter yet' }];
  }
  const L = CHAPTER_DRAFT_LIMITS;
  const language = targetLanguageOf(payload);
  const problems: DraftProblem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });

  if (!frozen) {
    if (!payload.bookSlug.trim()) {
      const title = payload.newBook.title.trim();
      const slug = payload.newBook.slug.trim();
      if (!title) add('newBook.title', 'Choose a book, or give the new book a title');
      else if (title.length > L.maxTitleLength) add('newBook.title', `The book title is longer than ${L.maxTitleLength} characters`);
      if (!SLUG.test(slug)) {
        add('newBook.slug', 'The book’s link name must be lower-case letters, digits and hyphens, e.g. rabbit-stories-3f9a');
      } else if (slug.length > L.maxBookSlugLength) {
        add('newBook.slug', `The book’s link name is longer than ${L.maxBookSlugLength} characters`);
      } else if (RESERVED_BOOK_SLUGS.includes(slug)) {
        add('newBook.slug', 'That link name belongs to a built-in book');
      }
    } else if (!SLUG.test(payload.bookSlug.trim())) {
      add('bookSlug', 'Unknown book');
    }
  }

  for (const key of ['titleTarget', 'titleNative'] as const) {
    const title = payload[key].trim();
    const which = key === 'titleTarget' ? 'The chapter title' : 'The translated chapter title';
    if (!title) add(key, `${which} is empty`);
    else if (title.length > L.maxTitleLength) add(key, `${which} is longer than ${L.maxTitleLength} characters`);
  }

  if (payload.dialog.length === 0) add('dialog', 'The passage has no lines');
  if (payload.dialog.length > L.maxDialogLines) add('dialog', `More than ${L.maxDialogLines} passage lines`);
  payload.dialog.forEach((line, i) => {
    if (!line.speechTarget.trim()) add(`dialog.${i}.speechTarget`, `Line ${i + 1} is empty`);
  });

  const count = payload.vocabulary.length;
  if (count < L.minVocabulary) add('vocabulary', `${count} vocabulary entries: at least ${L.minVocabulary} are needed`);
  if (count > L.maxVocabulary) add('vocabulary', `More than ${L.maxVocabulary} vocabulary entries`);
  const seen = new Map<string, number>();
  payload.vocabulary.forEach((entry, i) => {
    const at = `vocabulary.${i}`;
    const word = normaliseWord(entry.targetLanguageText);
    const label = word ? `“${word}”` : `Word ${i + 1}`;
    if (!word) add(`${at}.targetLanguageText`, `Word ${i + 1} is empty`);
    else if (word.length > L.maxWordLength) add(`${at}.targetLanguageText`, `${label} is longer than ${L.maxWordLength} characters`);
    else if (word.includes('/')) add(`${at}.targetLanguageText`, `${label} can’t contain “/”`);
    else if (language === 'ko' && !HANGUL.test(word)) add(`${at}.targetLanguageText`, `${label} has no Korean in it`);
    const gloss = entry.nativeLanguageText.trim();
    if (!gloss) add(`${at}.nativeLanguageText`, `${label} has no meaning`);
    else if (gloss.length > L.maxGlossLength) add(`${at}.nativeLanguageText`, `${label}’s meaning is longer than ${L.maxGlossLength} characters`);

    const { sense } = entry;
    if (sense.decision === 'undecided') {
      add(`${at}.sense`, `${label}: reuse an existing sense or add a new one`);
    } else if (sense.decision === 'reuse') {
      if (word && !resolvedSenseId(entry, language)) {
        add(`${at}.sense`, `${label}: “${sense.reuseId}” isn’t a sense of this word`);
      }
    } else {
      const slug = sense.newSense.trim();
      if (!SLUG.test(slug)) add(`${at}.sense`, `${label}: the new sense name must be lower-case ASCII letters, digits and hyphens, e.g. rabbit`);
      else if (slug.length > L.maxSenseSlugLength) add(`${at}.sense`, `${label}: the new sense name is longer than ${L.maxSenseSlugLength} characters`);
      else if (!sense.confirmed) add(`${at}.sense`, `${label}: confirm the new sense “${slug}”`);
    }

    const id = resolvedSenseId(entry, language);
    if (id) {
      const first = seen.get(id);
      if (first !== undefined) add(at, `${label} repeats word ${first + 1} in the same sense`);
      else seen.set(id, i);
    }
  });

  if (payload.patterns.length > L.maxPatterns) add('patterns', `More than ${L.maxPatterns} patterns`);
  payload.patterns.forEach((pattern, i) => {
    if (!pattern.patternTarget.trim()) add(`patterns.${i}.patternTarget`, `Pattern ${i + 1} is empty`);
    problems.push(...patternEntryProblems(pattern, i, language));
  });

  if (frozen) problems.push(...frozenChapterProblems(payload, frozen));
  return problems;
}

/** A book pattern's entries (GP5): at least one, each a valid reuse or a confirmed new entry. */
function patternEntryProblems(pattern: ChapterDraftPayload['patterns'][number], i: number, language: string): DraftProblem[] {
  const L = CHAPTER_DRAFT_LIMITS;
  const problems: DraftProblem[] = [];
  const label = pattern.patternTarget.trim() ? `Pattern ${i + 1} (“${pattern.patternTarget.trim()}”)` : `Pattern ${i + 1}`;
  const at = `patterns.${i}.entries`;
  if (pattern.entries.length === 0) {
    problems.push({ path: at, message: `${label}: link it to the grammar it teaches: reuse an entry or add a new one` });
  }
  if (pattern.entries.length > L.maxPatternEntries) {
    problems.push({ path: at, message: `${label} teaches more than ${L.maxPatternEntries} entries` });
  }
  const seen = new Set<string>();
  pattern.entries.forEach((decision, j) => {
    const add = (message: string) => problems.push({ path: `${at}.${j}`, message: `${label}: ${message}` });
    if (decision.decision === 'reuse') {
      if (!resolvedPatternId(decision, language)) add(`“${decision.reuseId}” isn’t a grammar pattern of this language`);
    } else {
      const headword = decision.headword.trim();
      const meaning = decision.meaning.trim();
      if (!headword) {
        add('the new entry has no headword, e.g. -아/어/여지다');
        return;
      }
      if (headword.length > L.maxPatternHeadwordLength) add(`the headword is longer than ${L.maxPatternHeadwordLength} characters`);
      try {
        patternForm(headword);
      } catch (error) {
        add(error instanceof PatternSpellingError ? error.message : `can’t read the headword “${headword}”`);
        return;
      }
      if (!SLUG.test(meaning)) add('the new entry’s meaning must be lower-case ASCII letters, digits and hyphens, e.g. become');
      else if (meaning.length > L.maxSenseSlugLength) add(`the new entry’s meaning is longer than ${L.maxSenseSlugLength} characters`);
      const gloss = decision.gloss.trim();
      if (!gloss) add(`the new entry “${headword}” has no gloss`);
      else if (gloss.length > L.maxPatternGlossLength) add(`the gloss is longer than ${L.maxPatternGlossLength} characters`);
      if (SLUG.test(meaning) && gloss && !decision.confirmed) add(`confirm the new pattern “${headword}” (${meaning})`);
    }
    const id = resolvedPatternId(decision, language);
    if (id && seen.has(id)) add(`it links ${id} twice`);
    if (id) seen.add(id);
  });
  return problems;
}

/** G8: a published chapter's vocabulary keeps its entries in order, each in its sense. Patterns stay too. */
export function frozenChapterProblems(payload: ChapterDraftPayload, frozen: FrozenChapter): DraftProblem[] {
  const language = targetLanguageOf(payload);
  const problems: DraftProblem[] = [];
  if (payload.vocabulary.length < frozen.words.length) {
    problems.push({
      path: 'vocabulary',
      message: `The published chapter has ${frozen.words.length} words: they can be corrected or added to, never removed`,
    });
  }
  frozen.words.forEach((word, i) => {
    const entry = payload.vocabulary[i];
    if (!entry) return;
    if (normaliseWord(entry.targetLanguageText) !== word || resolvedSenseId(entry, language) !== frozen.senseIds[i]) {
      problems.push({
        path: `vocabulary.${i}`,
        message: `Word ${i + 1} was published as “${word}” (${frozen.senseIds[i]}): published words keep their place and sense`,
      });
    }
  });
  if (payload.patterns.length < frozen.patternCount) {
    problems.push({ path: 'patterns', message: `The published chapter has ${frozen.patternCount} patterns: they can’t be removed` });
  }
  const linked = resolvedPatternIds(payload);
  frozen.patternIds.forEach((ids, i) => {
    const missing = ids.filter((id) => !(linked[i] ?? []).includes(id));
    if (i < payload.patterns.length && missing.length > 0) {
      problems.push({
        path: `patterns.${i}.entries`,
        message: `Pattern ${i + 1} was published teaching ${missing.join(', ')}: published links stay, others can be added`,
      });
    }
  });
  return problems;
}

/** Checks against the registry: reused senses exist, new ones don't yet. */
export function senseRegistryProblems(payload: ChapterDraftPayload, registry: SenseLookup): DraftProblem[] {
  const language = targetLanguageOf(payload);
  const problems: DraftProblem[] = [];
  payload.vocabulary.forEach((entry, i) => {
    const id = resolvedSenseId(entry, language);
    if (!id) return;
    const word = normaliseWord(entry.targetLanguageText);
    if (entry.sense.decision === 'reuse' && !registry.has(id)) {
      problems.push({ path: `vocabulary.${i}.sense`, message: `“${word}”: there is no sense ${id} to reuse` });
    }
    if (entry.sense.decision === 'new' && registry.has(id)) {
      problems.push({
        path: `vocabulary.${i}.sense`,
        message: `“${word}”: the sense ${id} already exists; reuse it instead of adding it`,
      });
    }
  });
  return problems;
}

/** Checks against the pattern registry: reused entries exist, new ones don't yet. */
export function patternRegistryProblems(payload: ChapterDraftPayload, registry: SenseLookup): DraftProblem[] {
  const language = targetLanguageOf(payload);
  const problems: DraftProblem[] = [];
  payload.patterns.forEach((pattern, i) => {
    pattern.entries.forEach((decision, j) => {
      const id = resolvedPatternId(decision, language);
      if (!id) return;
      const path = `patterns.${i}.entries.${j}`;
      if (decision.decision === 'reuse' && !registry.has(id)) {
        problems.push({ path, message: `Pattern ${i + 1}: there is no grammar pattern ${id} to reuse` });
      }
      if (decision.decision === 'new' && registry.has(id)) {
        problems.push({ path, message: `Pattern ${i + 1}: ${id} already exists; reuse it instead of adding it` });
      }
    });
  });
  return problems;
}

export type NewPattern = { language: string; form: string; meaning: string; headword: string; gloss: string; id: string };

export type NewSense = { language: string; kind: VocabularyKind; word: string; sense: string; gloss: string; id: string };

export type BuiltChapter = {
  content: KogsChapterV1;
  senseIds: string[];
  newSenses: NewSense[];
  /** Book pattern i's entries. */
  patternIds: string[][];
  /** Each new entry once, the first pattern's wording if two add it. */
  newPatterns: NewPattern[];
};

/** A publishable draft as stored: the chapter, each entry's sense and pattern, and the ones to add. */
export function publishedChapter(payload: ChapterDraftPayload, chapter: string): BuiltChapter {
  const language = targetLanguageOf(payload);
  const senseIds: string[] = [];
  const newSenses: NewSense[] = [];
  const content: KogsChapterV1 = {
    chapter,
    titleTarget: payload.titleTarget.trim(),
    titleNative: payload.titleNative.trim(),
    dialog: payload.dialog.map((line) => ({
      speakerNameTarget: line.speakerNameTarget.trim(),
      speakerNameNative: line.speakerNameNative.trim(),
      speechTarget: line.speechTarget.trim(),
      speechNative: line.speechNative.trim(),
    })),
    vocabulary: payload.vocabulary.map((entry, id) => {
      const word = normaliseWord(entry.targetLanguageText);
      const senseId = resolvedSenseId(entry, language);
      if (!senseId) throw new Error(`Word ${id + 1} has no sense`);
      senseIds.push(senseId);
      if (entry.sense.decision === 'new') {
        newSenses.push({
          language,
          kind: entry.sense.kind,
          word,
          sense: entry.sense.newSense.trim(),
          gloss: entry.sense.newGloss.trim() || entry.nativeLanguageText.split(',')[0].trim(),
          id: senseId,
        });
      }
      return { id, targetLanguageText: word, nativeLanguageText: entry.nativeLanguageText.trim() };
    }),
    patterns: payload.patterns.map((pattern) => ({
      patternTarget: pattern.patternTarget.trim(),
      patternNative: pattern.patternNative.trim(),
      ...(pattern.type.trim() ? { type: pattern.type.trim() } : {}),
      exampleSentenceNativeTitle: pattern.exampleSentenceTarget.trim() ? 'Sentence Used in the Passage' : '',
      exampleSentenceTarget: pattern.exampleSentenceTarget.trim(),
      exampleSentenceNative: pattern.exampleSentenceNative.trim(),
      sampleSentences: pattern.sampleSentences
        .filter((sample) => sample.targetText.trim())
        .map((sample) => ({ targetText: sample.targetText.trim(), nativeText: sample.nativeText.trim() })),
      exercises: pattern.exercises
        .filter((exercise) => exercise.exercise.trim())
        .map((exercise) => ({ exercise: exercise.exercise.trim(), answerKey: exercise.answerKey.trim() })),
      appliedPatterns: [],
    })),
  };
  const patternIds = resolvedPatternIds(payload);
  const newPatterns = new Map<string, NewPattern>();
  payload.patterns.forEach((pattern, i) => {
    if (patternIds[i].length !== pattern.entries.length) throw new Error(`Pattern ${i + 1} has an unresolved entry`);
    for (const decision of pattern.entries) {
      if (decision.decision !== 'new') continue;
      const id = resolvedPatternId(decision, language)!;
      if (newPatterns.has(id)) continue;
      const headword = decision.headword.trim();
      newPatterns.set(id, {
        language,
        form: patternForm(headword),
        meaning: decision.meaning.trim(),
        headword,
        gloss: decision.gloss.trim(),
        id,
      });
    }
  });
  return { content, senseIds, newSenses, patternIds, newPatterns: [...newPatterns.values()] };
}

/** A published chapter back as a draft payload: for an edit (G8) or a remix (G12), keeping every sense. */
export function chapterAsDraft(
  content: KogsChapterV1,
  /** The registry's reading of the vocabulary (swapped fields fixed), with each entry's sense. */
  vocabulary: ReadonlyArray<{ word: string; gloss: string; senseId: string | null }>,
  book: { bookSlug: string; language: { target: string; native: string } },
  /** Book pattern i's entries, reused as they are. */
  patternIds: ReadonlyArray<readonly string[]> = [],
): ChapterDraftPayload {
  return chapterDraftPayloadSchema.parse({
    bookSlug: book.bookSlug,
    language: book.language,
    titleTarget: content.titleTarget,
    titleNative: content.titleNative,
    dialog: content.dialog,
    vocabulary: vocabulary.map((entry) => ({
      targetLanguageText: entry.word,
      nativeLanguageText: entry.gloss,
      sense: entry.senseId ? { decision: 'reuse', reuseId: entry.senseId } : { decision: 'undecided' },
    })),
    patterns: content.patterns.map((pattern, i) => ({
      patternTarget: pattern.patternTarget,
      patternNative: pattern.patternNative,
      type: pattern.type ?? '',
      exampleSentenceTarget: pattern.exampleSentenceTarget,
      exampleSentenceNative: pattern.exampleSentenceNative,
      sampleSentences: pattern.sampleSentences.slice(0, 10),
      exercises: pattern.exercises.slice(0, 10),
      entries: (patternIds[i] ?? []).map((id) => ({ decision: 'reuse', reuseId: id })),
    })),
  });
}

export function chapterDraftTitle(payload: ChapterDraftPayload | null): string {
  if (!payload) return '';
  const title = payload.titleNative.trim() || payload.titleTarget.trim();
  return title.slice(0, CHAPTER_DRAFT_LIMITS.maxTitleLength);
}
