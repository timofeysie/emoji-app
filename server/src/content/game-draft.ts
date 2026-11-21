import { z } from 'zod';
import { slotLabelValues, type SlotLabel } from '../persistence/domain-types';

/**
 * Limits for drafted games (docs/hashbrown/creating-games-with-hashbrown.md,
 * G3). The same numbers as the client's `game-authoring/game-limits.ts`,
 * which only asks the model for them; `game-draft.spec.ts` keeps the two equal.
 */
export const GAME_DRAFT_LIMITS = {
  defaultQuestions: 10,
  maxQuestions: 20,
  defaultOptions: 4,
  minOptions: 2,
  maxOptions: 5,
  maxPromptLength: 120,
  maxOptionLength: 40,
  maxSourceLength: 8000,
  maxTitleLength: 100,
} as const;

export const questionFocusValues = ['comprehension', 'vocabulary', 'grammar'] as const;
/** The client's `QUESTION_MIXES` ids. */
export const questionMixValues = ['vocabulary', 'balanced', 'comprehension', 'grammar'] as const;

export const languagePairSchema = z
  .object({
    target: z.string().regex(/^[a-z]{2,3}$/, 'must be an ISO 639 code'),
    native: z.string().regex(/^[a-z]{2,3}$/, 'must be an ISO 639 code'),
  })
  .strict();

export const DEFAULT_LANGUAGE = { target: 'ko', native: 'en' } as const;

export const sourceInputSchema = z
  .object({
    text: z.string().trim().min(1).max(GAME_DRAFT_LIMITS.maxSourceLength),
    language: languagePairSchema.default(DEFAULT_LANGUAGE),
  })
  .strict();

export const draftSettingsSchema = z
  .object({
    mix: z.enum(questionMixValues).default('vocabulary'),
    questionCount: z.number().int().min(1).max(GAME_DRAFT_LIMITS.maxQuestions).default(GAME_DRAFT_LIMITS.defaultQuestions),
    optionsPerQuestion: z
      .number()
      .int()
      .min(GAME_DRAFT_LIMITS.minOptions)
      .max(GAME_DRAFT_LIMITS.maxOptions)
      .default(GAME_DRAFT_LIMITS.defaultOptions),
  })
  .strict();

export type DraftSettings = z.infer<typeof draftSettingsSchema>;

/**
 * What a game draft may hold while it's being edited: the shape of the
 * client's Skillet `gameDraftSchema`, with loose caps that only bound the
 * size. The rules that make it playable are `gameDraftProblems`.
 */
export const gameDraftPayloadSchema = z
  .object({
    title: z.string().max(500),
    language: languagePairSchema.optional(),
    questions: z
      .array(
        z
          .object({
            text: z.string().max(1000),
            focus: z.enum(questionFocusValues).optional(),
            options: z
              .array(z.object({ text: z.string().max(500), isCorrect: z.boolean() }).strict())
              .max(10),
            sourceExcerpt: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type GameDraftPayload = z.infer<typeof gameDraftPayloadSchema>;

export type DraftProblem = { path: string; message: string };

/** Everything that stops a game draft being accepted. Empty means it can be. */
export function gameDraftProblems(payload: GameDraftPayload | null): DraftProblem[] {
  if (!payload) {
    return [{ path: 'questions', message: 'No questions yet' }];
  }
  const L = GAME_DRAFT_LIMITS;
  const problems: DraftProblem[] = [];
  const title = payload.title.trim();
  if (!title) {
    problems.push({ path: 'title', message: 'Title is empty' });
  } else if (title.length > L.maxTitleLength) {
    problems.push({ path: 'title', message: `Title is longer than ${L.maxTitleLength} characters` });
  }
  if (payload.questions.length === 0) {
    problems.push({ path: 'questions', message: 'No questions yet' });
  } else if (payload.questions.length > L.maxQuestions) {
    problems.push({ path: 'questions', message: `More than ${L.maxQuestions} questions` });
  }
  payload.questions.forEach((question, q) => {
    const at = `questions.${q}`;
    const label = `Question ${q + 1}`;
    const text = question.text.trim();
    if (!text) {
      problems.push({ path: `${at}.text`, message: `${label} has no text` });
    } else if (text.length > L.maxPromptLength) {
      problems.push({ path: `${at}.text`, message: `${label} is longer than ${L.maxPromptLength} characters` });
    }
    if (question.options.length < L.minOptions || question.options.length > L.maxOptions) {
      problems.push({
        path: `${at}.options`,
        message: `${label} has ${question.options.length} options (${L.minOptions}–${L.maxOptions} allowed)`,
      });
    }
    const correct = question.options.filter((option) => option.isCorrect).length;
    if (correct !== 1) {
      problems.push({
        path: `${at}.options`,
        message: `${label} has ${correct} correct options (exactly 1 needed)`,
      });
    }
    const seen = new Set<string>();
    question.options.forEach((option, o) => {
      const optionAt = `${at}.options.${o}`;
      const slot = slotLabelValues[o] ?? String(o + 1);
      const optionText = option.text.trim();
      if (!optionText) {
        problems.push({ path: optionAt, message: `${label}, option ${slot} is empty` });
        return;
      }
      if (optionText.length > L.maxOptionLength) {
        problems.push({ path: optionAt, message: `${label}, option ${slot} is longer than ${L.maxOptionLength} characters` });
      }
      const key = optionText.toLowerCase();
      if (seen.has(key)) {
        problems.push({ path: optionAt, message: `${label}, option ${slot} repeats another option` });
      }
      seen.add(key);
    });
  });
  return problems;
}

/** A valid draft's questions as `createGameWithQuestions` takes them: options in slots A, B, C, … */
export function gameDraftQuestions(payload: GameDraftPayload): Array<{
  text: string;
  sequence: number;
  mode: 'standard';
  answerOptions: Array<{ text: string; sequence: number; slotLabel: SlotLabel; isCorrect: boolean }>;
}> {
  return payload.questions.map((question, q) => ({
    text: question.text.trim(),
    sequence: q + 1,
    mode: 'standard',
    answerOptions: question.options.map((option, o) => ({
      text: option.text.trim(),
      sequence: o + 1,
      slotLabel: slotLabelValues[o],
      isCorrect: option.isCorrect,
    })),
  }));
}
