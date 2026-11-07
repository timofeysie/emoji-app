import { Rng, shuffle } from './seeded-random';

/**
 * Hangul spelling distractors (docs/games/game-planning.md → Cheap
 * generator). A precomposed syllable is
 * `0xAC00 + (initial × 21 + vowel) × 28 + final`, so it can be split into its
 * parts, one part swapped for a similar one, and put back together without a
 * dictionary.
 */

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const VOWEL_COUNT = 21;
const FINAL_COUNT = 28;

export type SyllableParts = { initial: number; vowel: number; final: number };

// Initials: ㄱ0 ㄲ1 ㄴ2 ㄷ3 ㄸ4 ㄹ5 ㅁ6 ㅂ7 ㅃ8 ㅅ9 ㅆ10 ㅇ11 ㅈ12 ㅉ13 ㅊ14 ㅋ15 ㅌ16 ㅍ17 ㅎ18
const INITIAL_GROUPS = [
  [0, 1, 15], // ㄱ ㄲ ㅋ
  [3, 4, 16], // ㄷ ㄸ ㅌ
  [7, 8, 17], // ㅂ ㅃ ㅍ
  [12, 13, 14], // ㅈ ㅉ ㅊ
  [9, 10, 11], // ㅅ ㅆ ㅇ
  [2, 5, 6], // ㄴ ㄹ ㅁ
  [11, 18], // ㅇ ㅎ
];

// Vowels: ㅏ0 ㅐ1 ㅑ2 ㅒ3 ㅓ4 ㅔ5 ㅕ6 ㅖ7 ㅗ8 ㅘ9 ㅙ10 ㅚ11 ㅛ12 ㅜ13 ㅝ14 ㅞ15 ㅟ16 ㅠ17 ㅡ18 ㅢ19 ㅣ20
const VOWEL_GROUPS = [
  [0, 4, 8, 13, 18], // ㅏ ㅓ ㅗ ㅜ ㅡ
  [1, 5], // ㅐ ㅔ
  [3, 7], // ㅒ ㅖ
  [2, 6, 12, 17], // ㅑ ㅕ ㅛ ㅠ
  [9, 14], // ㅘ ㅝ
  [10, 11, 15, 16], // ㅙ ㅚ ㅞ ㅟ
  [18, 19, 20], // ㅡ ㅢ ㅣ
];

// Finals: none0 ㄱ1 ㄲ2 ㄴ4 ㄷ7 ㄹ8 ㅁ16 ㅂ17 ㅅ19 ㅆ20 ㅇ21 ㅈ22 ㅊ23 ㅋ24 ㅌ25 ㅍ26 ㅎ27
const FINAL_GROUPS = [
  [0, 4, 8, 16, 21], // none ㄴ ㄹ ㅁ ㅇ
  [1, 2, 24], // ㄱ ㄲ ㅋ
  [7, 19, 20, 22, 23, 25, 27], // ㄷ ㅅ ㅆ ㅈ ㅊ ㅌ ㅎ (all sound like ㄷ at the end)
  [17, 26], // ㅂ ㅍ
];

/** Dictionary-form verb/adjective ending; never changed (it gives the answer away). */
const DICTIONARY_ENDING = '다';

export function isHangulSyllable(char: string): boolean {
  const code = char.codePointAt(0);
  return char.length === 1 && code !== undefined && code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST;
}

export function decompose(syllable: string): SyllableParts {
  if (!isHangulSyllable(syllable)) {
    throw new Error(`'${syllable}' is not a precomposed Hangul syllable.`);
  }
  const offset = syllable.charCodeAt(0) - SYLLABLE_FIRST;
  return {
    initial: Math.floor(offset / (VOWEL_COUNT * FINAL_COUNT)),
    vowel: Math.floor((offset % (VOWEL_COUNT * FINAL_COUNT)) / FINAL_COUNT),
    final: offset % FINAL_COUNT,
  };
}

export function compose(parts: SyllableParts): string {
  return String.fromCharCode(
    SYLLABLE_FIRST + (parts.initial * VOWEL_COUNT + parts.vowel) * FINAL_COUNT + parts.final,
  );
}

/** Every part sharing a group with `index`, excluding `index` itself. */
function similarParts(index: number, groups: number[][]): number[] {
  const similar = new Set<number>();
  for (const group of groups) {
    if (group.includes(index)) {
      group.forEach((member) => similar.add(member));
    }
  }
  similar.delete(index);
  return [...similar].sort((a, b) => a - b);
}

/** Syllables that differ from `syllable` by one similar initial, vowel or final. */
export function syllableVariants(syllable: string): string[] {
  const parts = decompose(syllable);
  const variants = new Set<string>();
  for (const initial of similarParts(parts.initial, INITIAL_GROUPS)) {
    variants.add(compose({ ...parts, initial }));
  }
  for (const vowel of similarParts(parts.vowel, VOWEL_GROUPS)) {
    variants.add(compose({ ...parts, vowel }));
  }
  for (const final of similarParts(parts.final, FINAL_GROUPS)) {
    variants.add(compose({ ...parts, final }));
  }
  variants.delete(syllable);
  return [...variants];
}

/** Positions of the syllables in `word` that may be changed. */
function changeablePositions(word: string): number[] {
  const chars = [...word];
  const positions = chars.flatMap((char, index) => (isHangulSyllable(char) ? [index] : []));
  const last = positions[positions.length - 1];
  if (positions.length > 1 && chars[last] === DICTIONARY_ENDING && last === chars.length - 1) {
    positions.pop();
  }
  return positions;
}

/**
 * `count` misspellings of `word` that all change the **same** syllable, so the
 * correct answer can't be found by picking the majority syllable at each
 * position. Words in `exclude` (e.g. the chapter's other terms) are never
 * returned. Returns `[]` when no syllable has enough variants.
 */
export function misspellings(
  word: string,
  count: number,
  rng: Rng,
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const chars = [...word];
  const candidatesByPosition = changeablePositions(word)
    .map((position) =>
      syllableVariants(chars[position])
        .map((variant) => [...chars.slice(0, position), variant, ...chars.slice(position + 1)].join(''))
        .filter((candidate) => candidate !== word && !exclude.has(candidate)),
    )
    .filter((candidates) => candidates.length >= count);

  if (candidatesByPosition.length === 0) {
    return [];
  }
  const chosen = candidatesByPosition[Math.floor(rng() * candidatesByPosition.length)];
  return shuffle(chosen, rng).slice(0, count);
}
