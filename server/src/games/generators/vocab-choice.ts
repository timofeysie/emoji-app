import { z } from 'zod';
import type { LearningTag } from '../../learning/learning-object';
import { misspellings } from './hangul';
import { createRng, Rng, shuffle } from './seeded-random';

/**
 * Rule-based multiple-choice questions from a vocabulary list
 * (docs/games/game-planning.md → Cheap generator, Phase 0). Pure: no database
 * or network, and the same seed always gives the same quiz.
 */

export const vocabSkillValues = ['reading', 'writing'] as const;
export type VocabSkill = (typeof vocabSkillValues)[number];

/** Answer cards for the Phase 0 demo; one option per card. */
export const QUIZ_SLOT_LABELS = ['A', 'B', 'C', 'D'] as const;
const DISTRACTOR_COUNT = QUIZ_SLOT_LABELS.length - 1;

export type VocabTerm = {
  /** Stable source path, e.g. `ch26/vocabulary/13`. */
  id: string;
  /** Korean, e.g. `간호사`. */
  target: string;
  /** English, e.g. `nurse`. */
  native: string;
};

export type ChoiceOption = { text: string; isCorrect: boolean };

export type VocabChoiceItem = {
  skill: VocabSkill;
  termId: string;
  /** What players read on the view-mode screen. */
  prompt: string;
  /** Already shuffled; exactly one is correct. */
  options: ChoiceOption[];
  /**
   * Leitner tag without the aspect (that's `skill`). Set for Leitner games
   * only; class-game items leave it out (docs/xAPI/leitner-method.md L6).
   */
  learning?: Omit<LearningTag, 'aspect'>;
};

const chapterSchema = z.object({
  chapter: z.union([z.string(), z.number()]),
  vocabulary: z.array(
    z.object({
      targetLanguageText: z.string().min(1),
      nativeLanguageText: z.string().min(1),
    }),
  ),
});

/** Vocabulary terms from a language-learning-app `chapterNNData.json`. */
export function termsFromChapter(raw: unknown): VocabTerm[] {
  const chapter = chapterSchema.parse(raw);
  return chapter.vocabulary.map((entry, index) => ({
    id: `ch${String(chapter.chapter)}/vocabulary/${index}`,
    target: entry.targetLanguageText.trim(),
    native: entry.nativeLanguageText.trim(),
  }));
}

/** `to swell up, to become swollen` → `to swell up`. Keeps options short. */
export function firstSense(native: string): string {
  return native.split(',')[0].trim();
}

function isVerbSense(sense: string): boolean {
  return /^to\s/i.test(sense);
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function choiceItem(
  skill: VocabSkill,
  term: VocabTerm,
  prompt: string,
  answer: string,
  distractors: string[],
  rng: Rng,
): VocabChoiceItem {
  return {
    skill,
    termId: term.id,
    prompt,
    options: shuffle(
      [
        { text: answer, isCorrect: true },
        ...distractors.map((text) => ({ text, isCorrect: false })),
      ],
      rng,
    ),
  };
}

/**
 * Reading: Korean prompt, pick the English meaning. Distractors are other
 * meanings from the same list: verbs for a verb, non-verbs otherwise, then
 * anything else if there aren't enough.
 */
export function readingItem(term: VocabTerm, terms: readonly VocabTerm[], rng: Rng): VocabChoiceItem | null {
  const answer = firstSense(term.native);
  const otherSenses: string[] = [];
  for (const other of terms) {
    const sense = firstSense(other.native);
    if (other.id !== term.id && !sameText(sense, answer) && !otherSenses.some((s) => sameText(s, sense))) {
      otherSenses.push(sense);
    }
  }

  const sameKind = otherSenses.filter((sense) => isVerbSense(sense) === isVerbSense(answer));
  const otherKind = otherSenses.filter((sense) => isVerbSense(sense) !== isVerbSense(answer));
  const distractors = [...shuffle(sameKind, rng), ...shuffle(otherKind, rng)].slice(0, DISTRACTOR_COUNT);
  if (distractors.length < DISTRACTOR_COUNT) {
    return null;
  }
  return choiceItem('reading', term, term.target, answer, distractors, rng);
}

/**
 * Writing: English prompt, pick the correct Korean spelling. Distractors
 * change one syllable of the answer (the same syllable in each) and are never
 * another term from the list.
 */
export function writingItem(term: VocabTerm, terms: readonly VocabTerm[], rng: Rng): VocabChoiceItem | null {
  const realWords = new Set(terms.map((t) => t.target));
  const distractors = misspellings(term.target, DISTRACTOR_COUNT, rng, realWords);
  if (distractors.length < DISTRACTOR_COUNT) {
    return null;
  }
  return choiceItem('writing', term, firstSense(term.native), term.target, distractors, rng);
}

const itemBuilders: Record<VocabSkill, typeof readingItem> = {
  reading: readingItem,
  writing: writingItem,
};

export type VocabQuizOptions = {
  terms: readonly VocabTerm[];
  /** Questions cycle through these in order, e.g. reading, writing, reading… */
  skills: readonly VocabSkill[];
  count: number;
  seed: number;
};

/**
 * Up to `count` questions, each on a different term chosen at random. Terms
 * that can't make a question for their skill are skipped, so fewer than
 * `count` can come back from a short list.
 */
export function generateVocabQuiz(options: VocabQuizOptions): VocabChoiceItem[] {
  const { terms, skills, count, seed } = options;
  if (skills.length === 0) {
    throw new Error('At least one skill is required.');
  }
  const rng = createRng(seed);
  const items: VocabChoiceItem[] = [];
  for (const term of shuffle(terms, rng)) {
    if (items.length >= count) break;
    const item = itemBuilders[skills[items.length % skills.length]](term, terms, rng);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

/** Body fields for `POST /api/questions` (gameId and createdByUserId added by the caller). */
export function toQuestionInput(item: VocabChoiceItem, sequence: number) {
  if (item.options.length > QUIZ_SLOT_LABELS.length) {
    throw new Error(`Item '${item.termId}' has more options than answer cards.`);
  }
  return {
    text: item.prompt,
    sequence,
    mode: 'standard' as const,
    answerOptions: item.options.map((option, index) => ({
      text: option.text,
      sequence: index + 1,
      slotLabel: QUIZ_SLOT_LABELS[index],
      isCorrect: option.isCorrect,
    })),
    ...(item.learning ? { learning: { ...item.learning, aspect: item.skill } } : {}),
  };
}
