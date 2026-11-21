import { CHAPTER_DEFAULTS, CHAPTER_LIMITS } from './chapter-limits';

/**
 * The rules for turning a passage into a library chapter, as prompt text.
 * The chat's library section and the Draft Game page's chapter generation
 * both use it, so they can't drift apart.
 */
export function chapterRecipe(languages?: { target: string; native: string }): string {
  const native = languages?.native ?? "the learner's language";
  const target = languages?.target ?? 'the target language';
  return [
    `Make a study chapter from the passage, in the shape of a textbook chapter:`,
    `- titleTarget: a short title in ${target}; titleNative: the same in ${native}. Never a person's real name.`,
    `- dialog: the whole passage in order, one sentence (or one line of a conversation) per entry, copied exactly, ` +
      `each with its ${native} translation. Leave the speaker fields "" for a story; fill them for a conversation.`,
    `- vocabulary: about ${CHAPTER_DEFAULTS.vocabulary} words worth learning from the passage ` +
      `(at least ${CHAPTER_LIMITS.minVocabulary}, at most 15), in the order the passage uses them. ` +
      `Write each in its dictionary form (달리다, not 달렸더니; 토끼, not 토끼가), ` +
      `with ${native} glosses separated by commas, the meaning in this passage first. ` +
      `Words of ${CHAPTER_LIMITS.maxWordLength} characters at most; no particles or grammar endings on their own.`,
    `- patterns: ${CHAPTER_DEFAULTS.patterns} or 3 grammar patterns the passage uses, each the smallest teachable pattern ` +
      `(-았/었더니, -아/어지다, -네), with the passage sentence that uses it, 2 new sample sentences and 2 exercises with answers.`,
  ].join('\n');
}

/** How the chat decides each word's sense (G7), after `findSenses`. */
export const SENSE_RULES = [
  'For each word, call findSenses first and look at the senses it already has.',
  'Reuse a sense (decision reuse, its id as reuseId) when one has the meaning the passage uses, even if the gloss is worded differently.',
  'Only add a new sense (decision new) when none has that meaning. Its newSense is a short ASCII slug of the meaning: ' +
    'rabbit, to-run, to-get-sick. Never make a near-duplicate of an existing sense (ship next to boat).',
  'lexeme for one word, expression for words with a space (보여 주다).',
].join('\n');
