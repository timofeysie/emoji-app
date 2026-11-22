/**
 * Limits for library chapter drafts (docs/hashbrown/creating-games-with-hashbrown.md
 * → Feature 2). The server's `CHAPTER_DRAFT_LIMITS` (content/chapter-draft.ts)
 * enforces the same numbers; `chapter-draft.spec.ts` keeps them equal.
 */
export const CHAPTER_LIMITS = {
  /** Leitner games draw distractors from the same chapter. */
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

/** What the AI is asked for: about 10–15 words and 2–3 patterns. */
export const CHAPTER_DEFAULTS = {
  vocabulary: 12,
  patterns: 2,
} as const;
