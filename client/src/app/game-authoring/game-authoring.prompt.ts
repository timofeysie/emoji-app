import { GAME_LIMITS, SLOT_LABELS } from './game-limits';
import { DEFAULT_MIX_ID, findMix, scaleMix, type MixCounts, QUESTION_MIXES } from './question-mixes';

export type GameRecipeOptions = {
  /** A preset id, exact counts for a custom mix, or `free`: whatever kind the teacher's note asks for. */
  mix?: string | MixCounts;
  total?: number;
  optionsPerQuestion?: number;
  /** Language names, e.g. Korean and English. Without them the rule says "the learner's language". */
  languages?: { target: string; native: string };
};

/**
 * The rules for drafting a game from a passage, as prompt text. The chat's
 * game-authoring section and the Draft Game page's completion both use it.
 */
export function gameRecipe({
  mix = DEFAULT_MIX_ID,
  total = GAME_LIMITS.defaultQuestions,
  optionsPerQuestion = GAME_LIMITS.defaultOptions,
  languages,
}: GameRecipeOptions = {}): string {
  const kinds =
    'vocabulary (what a word from the passage means), grammar (which form fits, or what a pattern means) or ' +
    'comprehension (who, what or why in the passage)';
  let mixLine: string;
  if (mix === 'free') {
    mixLine = `Each one is ${kinds}: whichever the teacher's note asks for. Set focus to match.`;
  } else {
    const counts = typeof mix === 'string' ? scaleMix((findMix(mix) ?? findMix(DEFAULT_MIX_ID)!).counts, total) : mix;
    mixLine =
      `${counts.vocabulary} vocabulary (what a word from the passage means), ` +
      `${counts.grammar} grammar (which form fits, or what a pattern means) and ` +
      `${counts.comprehension} comprehension (who, what or why in the passage).`;
  }
  const slots = SLOT_LABELS.slice(0, optionsPerQuestion).join(', ');
  const native = languages?.native ?? "the learner's language";
  const target = languages?.target ?? 'the target language';
  return [
    `Write ${total} multiple-choice question${total === 1 ? '' : 's'} about the passage:`,
    mixLine,
    `Each question has exactly ${optionsPerQuestion} options (${slots}) and exactly one is correct.`,
    `Write every question's text in ${native}, even when it quotes ${target} words. ` +
      `Write options in ${target} when the question tests ${target}, otherwise in ${native}.`,
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
