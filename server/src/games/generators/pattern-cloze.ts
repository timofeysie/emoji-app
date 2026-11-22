import { z } from 'zod';
import type { ChoiceOption } from './vocab-choice';
import { Rng, shuffle } from './seeded-random';

/**
 * Cloze questions on grammar patterns (docs/yalla/grammar-learning-objects.md
 * → Questions, evidence and tracks; H4b). A book sentence that uses the
 * pattern, with the pattern's own ending blanked: `계속 더 심해___.` The
 * options are endings of other patterns in the book, so the question tests
 * the grammar, not the verb. Pure: the same seed gives the same item.
 */

/** One sentence that uses a book pattern: `example`, `sample/0` or `exercise/1`. */
export type PatternSentence = { id: string; target: string; native: string };

export type BookPattern = {
  /** `ch27/patterns/0`. */
  sourceRef: string;
  /** As the book writes it: `계속 더 ADJECTIVE + -아/어/여지네`. */
  patternTarget: string;
  patternNative: string;
  sentences: PatternSentence[];
};

export type Cloze = { before: string; blank: string; after: string };

export type ClozeItem = {
  sourceRef: string;
  sentence: string;
  /** What players read: the sentence with the blank, then its translation. */
  prompt: string;
  /** Already shuffled; exactly one is correct. */
  options: ChoiceOption[];
};

const OPTION_COUNT = 4;

const rawPatternSchema = z
  .object({
    patternTarget: z.string(),
    patternNative: z.string().default(''),
    exampleSentenceTarget: z.string().optional(),
    exampleSentenceNative: z.string().optional(),
    sampleSentences: z.array(z.object({ targetText: z.string(), nativeText: z.string() })).default([]),
    exercises: z.array(z.object({ exercise: z.string(), answerKey: z.string() })).default([]),
  })
  .passthrough();

const rawChapterSchema = z.object({
  chapter: z.union([z.string(), z.number()]),
  patterns: z.array(z.unknown()).default([]),
});

/** A chapter file's patterns with their sentences (`kogs.chapter.v1`). */
export function bookPatternsOf(raw: unknown): BookPattern[] {
  const chapter = rawChapterSchema.parse(raw);
  return chapter.patterns.map((value, index) => {
    const pattern = rawPatternSchema.parse(value);
    const sentences: PatternSentence[] = [];
    if (pattern.exampleSentenceTarget?.trim()) {
      sentences.push({ id: 'example', target: pattern.exampleSentenceTarget, native: pattern.exampleSentenceNative ?? '' });
    }
    pattern.sampleSentences.forEach((sample, i) => sentences.push({ id: `sample/${i}`, target: sample.targetText, native: sample.nativeText }));
    pattern.exercises.forEach((exercise, i) => sentences.push({ id: `exercise/${i}`, target: exercise.answerKey, native: exercise.exercise }));
    return {
      sourceRef: `ch${String(chapter.chapter)}/patterns/${index}`,
      patternTarget: pattern.patternTarget,
      patternNative: pattern.patternNative,
      sentences: sentences.filter((sentence) => sentence.target.trim() && sentence.native.trim()),
    };
  });
}

const PLACEHOLDER = /^[A-Z]+$/;
const PUNCTUATION = /[.?!,…]+$/;

/** The words of the book pattern from its first `+` up to the next placeholder: `-(으)면 안 돼`. */
function endingWords(patternTarget: string): string[] {
  const words = patternTarget.split(/\s+/).filter(Boolean);
  const plus = words.indexOf('+');
  if (plus < 0) return [];
  const rest = words.slice(plus + 1);
  const next = rest.findIndex((word) => PLACEHOLDER.test(word));
  return (next < 0 ? rest : rest.slice(0, next)).map((word) => word.replace(PUNCTUATION, '')).filter(Boolean);
}

/**
 * The part of the ending's first word that is written the same after any
 * verb: `-아/어/여지네` → `지네`, `-(으)면` → `면`. Empty when the whole
 * ending fuses with the stem (`-(으)ㄹ`, `-아/어/여`).
 */
function fixedTail(word: string): string {
  return word
    .replace(/^[-~]/, '')
    .replace(/\(으\)/g, '')
    .replace(/[가-힣]\([가-힣](?:\s*,\s*[가-힣])*\)/g, '')
    .replace(/[가-힣](?:\/[가-힣])+/g, '')
    .replace(/[ㄱ-ㅎ]/g, '');
}

/**
 * Where the pattern's ending is in a sentence, or null when it can't be
 * found. The blank runs from the ending's fixed part to the end of the
 * pattern's last word: `오늘 수업 빠지[면 안 돼].`, `금방 쓰러질 [것 같아].`
 */
export function clozeOf(patternTarget: string, sentence: string): Cloze | null {
  const ending = endingWords(patternTarget);
  if (ending.length === 0) return null;
  const words = sentence.trim().split(/\s+/);
  const bare = words.map((word) => word.replace(PUNCTUATION, ''));
  const startsLike = (index: number, word: string | undefined) => !word || (bare[index] ?? '').startsWith(word.slice(0, 1));

  const tail = fixedTail(ending[0]);
  // The blank's first word, and how many characters of it stay before the blank.
  let start = -1;
  let keep = 0;
  let span = ending.length;
  if (tail) {
    start = bare.findIndex(
      (word, i) => word.length > tail.length && word.endsWith(tail) && ending.slice(1).every((next, k) => startsLike(i + 1 + k, next)),
    );
    keep = start >= 0 ? bare[start].length - tail.length : 0;
  } else {
    span = ending.length - 1;
    if (span === 0) return null;
    start = bare.findIndex((_, i) => i > 0 && ending.slice(1).every((next, k) => startsLike(i + k, next)));
  }
  if (start < 0 || start + span > words.length) return null;

  const last = start + span - 1;
  const blankWords = bare.slice(start, last + 1);
  blankWords[0] = blankWords[0].slice(keep);
  const leading = words.slice(0, start).join(' ');
  const before = (leading ? `${leading} ` : '') + bare[start].slice(0, keep);
  const rest = words.slice(last + 1).join(' ');
  const after = words[last].slice(bare[last].length) + (rest ? ` ${rest}` : '');
  return { before, blank: blankWords.join(' '), after };
}

/** `(to be curious = 궁금하다)`-style hints are dropped from prompts to keep them short. */
export function promptNative(native: string): string {
  return native.replace(/\s*\([^()]*=[^()]*\)/g, '').trim();
}

export function clozePrompt(cloze: Cloze, native: string): string {
  return `${cloze.before}___${cloze.after} (${promptNative(native)})`;
}

/** The sentences of a book pattern a cloze can be built from. */
export function clozeSentences(pattern: BookPattern): Array<PatternSentence & { cloze: Cloze }> {
  return pattern.sentences.flatMap((sentence) => {
    const cloze = clozeOf(pattern.patternTarget, sentence.target);
    return cloze ? [{ ...sentence, cloze }] : [];
  });
}

/**
 * Distractors: the blanks of other book patterns, this chapter's first,
 * never one teaching the same grammar (`excluded`) or with the same text.
 */
function distractorsFor(
  pattern: BookPattern,
  answer: string,
  pool: readonly BookPattern[],
  excluded: ReadonlySet<string>,
  rng: Rng,
): string[] {
  const chapter = pattern.sourceRef.split('/')[0];
  const candidates = pool.filter((other) => other.sourceRef !== pattern.sourceRef && !excluded.has(other.sourceRef));
  const texts: string[] = [];
  for (const group of [candidates.filter((o) => o.sourceRef.startsWith(`${chapter}/`)), candidates.filter((o) => !o.sourceRef.startsWith(`${chapter}/`))]) {
    for (const other of shuffle(group, rng)) {
      const blank = clozeSentences(other)[0]?.cloze.blank;
      if (blank && blank !== answer && !texts.includes(blank)) texts.push(blank);
    }
  }
  return texts.slice(0, OPTION_COUNT - 1);
}

/**
 * A cloze on `pattern`, from `sentence` if given (YALLA's re-check) or one
 * picked by `rng`. Null when no sentence has a findable blank or the pool
 * has too few other endings.
 */
export function clozeItem(
  pattern: BookPattern,
  pool: readonly BookPattern[],
  excluded: ReadonlySet<string>,
  rng: Rng,
  sentenceId?: string,
): ClozeItem | null {
  const sentences = clozeSentences(pattern);
  const chosen = sentenceId ? sentences.find((s) => s.id === sentenceId) : shuffle(sentences, rng)[0];
  if (!chosen) return null;
  const distractors = distractorsFor(pattern, chosen.cloze.blank, pool, excluded, rng);
  if (distractors.length < OPTION_COUNT - 1) return null;
  return {
    sourceRef: pattern.sourceRef,
    sentence: chosen.id,
    prompt: clozePrompt(chosen.cloze, chosen.native),
    options: shuffle(
      [{ text: chosen.cloze.blank, isCorrect: true }, ...distractors.map((text) => ({ text, isCorrect: false }))],
      rng,
    ),
  };
}
