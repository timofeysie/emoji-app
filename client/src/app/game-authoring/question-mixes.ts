/**
 * Question mixes for a game drafted from a passage
 * (docs/hashbrown/creating-games-with-hashbrown.md → Question mixes).
 * Counts are for 10 questions; `scaleMix` fits them to another total.
 */

export const questionFocusValues = ['comprehension', 'vocabulary', 'grammar'] as const;
export type QuestionFocus = (typeof questionFocusValues)[number];

export type MixCounts = Record<QuestionFocus, number>;

export type QuestionMix = {
  id: string;
  label: string;
  /** For the preset picker and the prompt. */
  description: string;
  counts: MixCounts;
};

export const QUESTION_MIXES = [
  {
    id: 'vocabulary',
    label: 'Vocabulary',
    description: 'Learning the words in a new passage',
    counts: { comprehension: 2, vocabulary: 6, grammar: 2 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'A general check after studying the passage',
    counts: { comprehension: 4, vocabulary: 3, grammar: 3 },
  },
  {
    id: 'comprehension',
    label: 'Comprehension',
    description: 'Checking that the story was understood',
    counts: { comprehension: 6, vocabulary: 2, grammar: 2 },
  },
  {
    id: 'grammar',
    label: 'Grammar',
    description: "Practising the passage's patterns",
    counts: { comprehension: 2, vocabulary: 2, grammar: 6 },
  },
] as const satisfies readonly QuestionMix[];

export type QuestionMixId = (typeof QUESTION_MIXES)[number]['id'];

export const DEFAULT_MIX_ID: QuestionMixId = 'vocabulary';

export function findMix(id: string): QuestionMix | undefined {
  return QUESTION_MIXES.find((mix) => mix.id === id);
}

/**
 * The mix's counts for `total` questions, by largest remainder, so they always
 * add up to `total`. A tie goes to the focus with the bigger share in the mix.
 */
export function scaleMix(counts: MixCounts, total: number): MixCounts {
  const sum = questionFocusValues.reduce((acc, focus) => acc + counts[focus], 0);
  if (sum === 0 || total <= 0) {
    return { comprehension: 0, vocabulary: 0, grammar: 0 };
  }
  const exact = questionFocusValues.map((focus) => ({ focus, value: (counts[focus] * total) / sum }));
  const scaled = Object.fromEntries(exact.map(({ focus, value }) => [focus, Math.floor(value)])) as MixCounts;
  let left = total - questionFocusValues.reduce((acc, focus) => acc + scaled[focus], 0);
  const byRemainder = [...exact].sort(
    (a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)) || counts[b.focus] - counts[a.focus],
  );
  for (const { focus } of byRemainder) {
    if (left === 0) break;
    scaled[focus] += 1;
    left -= 1;
  }
  return scaled;
}
