import { GAME_LIMITS, SLOT_LABELS } from './game-limits';
import { DEFAULT_MIX_ID, findMix, scaleMix, type MixCounts, QUESTION_MIXES } from './question-mixes';

export type GameRecipeOptions = {
  /** A preset id, or exact counts for a custom mix. */
  mix?: string | MixCounts;
  total?: number;
  optionsPerQuestion?: number;
};

/**
 * The rules for drafting a game from a passage, as prompt text. The chat's
 * game-authoring section and the Draft Game page's completion both use it.
 */
export function gameRecipe({
  mix = DEFAULT_MIX_ID,
  total = GAME_LIMITS.defaultQuestions,
  optionsPerQuestion = GAME_LIMITS.defaultOptions,
}: GameRecipeOptions = {}): string {
  const counts = typeof mix === 'string' ? scaleMix((findMix(mix) ?? findMix(DEFAULT_MIX_ID)!).counts, total) : mix;
  const slots = SLOT_LABELS.slice(0, optionsPerQuestion).join(', ');
  return [
    `Write ${total} multiple-choice questions about the passage:`,
    `${counts.vocabulary} vocabulary (what a word from the passage means), ` +
      `${counts.grammar} grammar (which form fits, or what a pattern means) and ` +
      `${counts.comprehension} comprehension (who, what or why in the passage).`,
    `Each question has exactly ${optionsPerQuestion} options (${slots}) and exactly one is correct.`,
    'Write the prompt in the learner\'s language. Write options in the target language when the question tests ' +
      'the target language, otherwise in the learner\'s language.',
    'Distractors must be plausible: the same part of speech, other words from the passage, or the right word in the wrong form.',
    'Vocabulary questions use the form the passage uses.',
    `Keep prompts to ${GAME_LIMITS.maxPromptLength} characters and options to ${GAME_LIMITS.maxOptionLength}.`,
    'Give each question the sentence it is about as sourceExcerpt.',
    'Never put a person\'s real name in the title.',
  ].join('\n');
}

/** The presets as prompt text, so the model maps "a comprehension game" to counts. */
export function mixPresetsText(total: number = GAME_LIMITS.defaultQuestions): string {
  return QUESTION_MIXES.map((mix) => {
    const counts = scaleMix(mix.counts, total);
    return `- ${mix.id}${mix.id === DEFAULT_MIX_ID ? ' (default)' : ''}: ${counts.vocabulary} vocabulary, ` +
      `${counts.grammar} grammar, ${counts.comprehension} comprehension. ${mix.description}.`;
  }).join('\n');
}
