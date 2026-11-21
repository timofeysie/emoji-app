/**
 * Limits for AI-drafted games (docs/hashbrown/creating-games-with-hashbrown.md).
 * The server's Zod schemas (H1) enforce the same numbers; the prompt only asks.
 */
export const GAME_LIMITS = {
  defaultQuestions: 10,
  maxQuestions: 20,
  /** A–D, as the vocabulary generator's QUIZ_SLOT_LABELS. */
  defaultOptions: 4,
  minOptions: 2,
  /** A–E: needs a card group with an E card. */
  maxOptions: 5,
  /**
   * Characters, so text fits the screens that show it. Set by the smallest
   * screen: see "Text length and screens" in docs/hashbrown/creating-games-with-hashbrown.md
   * before changing them.
   */
  maxPromptLength: 120,
  /** 40 until 2026-11-21: models went over it often, and the student view wraps options. */
  maxOptionLength: 60,
  /** Characters of pasted text sent to the model. */
  maxSourceLength: 8000,
  maxTitleLength: 100,
} as const;

export const SLOT_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;
