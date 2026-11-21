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
  /** Characters, so questions fit the student view. Check against GamePlayView. */
  maxPromptLength: 120,
  maxOptionLength: 40,
  /** Characters of pasted text sent to the model. */
  maxSourceLength: 8000,
  maxTitleLength: 100,
} as const;

export const SLOT_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;
