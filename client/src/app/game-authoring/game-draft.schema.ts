import { s } from '@hashbrownai/core';
import { questionFocusValues } from './question-mixes';

/**
 * What the model writes for a game draft. Shared by the chat's `proposeGame`
 * tool and the Draft Game page's structured completion, so they can't drift.
 * Skillet describes the shape only: limits (one correct option, lengths) are
 * in the prompt and checked again by the server.
 */
export const gameDraftSchema = s.object('A multiple-choice game drafted from a passage', {
  title: s.string('Short game title, e.g. "Story quiz: 토끼와 거북이". Never a person\'s name.'),
  language: s.object('Languages of the game', {
    target: s.string('ISO 639 code of the language being learned, e.g. "ko"'),
    native: s.string('ISO 639 code of the learner\'s language, e.g. "en"'),
  }),
  questions: s.array(
    'The questions, in play order',
    s.object('One question', {
      text: s.string('The prompt, in the learner\'s language'),
      focus: s.enumeration('What the question tests', [...questionFocusValues]),
      options: s.array(
        'The answer options, in slot order (A, B, C, …). Exactly one is correct.',
        s.object('One answer option', {
          text: s.string('The option text'),
          isCorrect: s.boolean('True for the one correct option'),
        }),
      ),
      sourceExcerpt: s.string('The sentence from the passage the question is about, for review'),
    }),
  ),
});

export type GameDraftPayload = s.Infer<typeof gameDraftSchema>;
