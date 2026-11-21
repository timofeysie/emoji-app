import { s } from '@hashbrownai/core';
import { exposeComponent, useTool } from '@hashbrownai/react';
import { LEITNER_ASPECTS } from '../../views/leitner';
import type { ChatArea } from '../chat-area';
import { section } from '../prompt-sections';
import { LeitnerRefusedError, listPlayers, planLeitnerGame } from './leitner-chat-api';
import { LeitnerPlanCard } from './LeitnerPlanCard';

/** Players whose first name or label starts with `name` (all of them for ""). */
export function matchPlayers<P extends { firstName: string; label: string }>(players: readonly P[], name: string): P[] {
  const query = name.trim().toLocaleLowerCase();
  if (!query) return [...players];
  return players.filter(
    (player) =>
      player.firstName.toLocaleLowerCase().startsWith(query) || player.label.toLocaleLowerCase().includes(query),
  );
}

/**
 * Leitner games in the chat (docs/hashbrown/creating-games-with-hashbrown.md →
 * `createLeitnerGame`, H3). The AI finds the student (`getPlayers`), plans a
 * dry run for a built-in or library chapter (`createLeitnerGame`) and shows
 * `<LeitnerPlan>`; only the referee's Create click makes the game (G1).
 * First names never go to the model: `getPlayers` matches them here and
 * returns labels.
 */
export function useLeitnerChatArea(): ChatArea {
  const getPlayers = useTool({
    name: 'getPlayers',
    description:
      'Find students for a Leitner game. Pass the name the user gave (or "" for every student). Returns each match\'s ' +
      'playerId and label (e.g. "Player 7F3A"); names are never returned.',
    schema: s.object('Who to find', { name: s.string('The student\'s name as the user wrote it, or ""') }),
    handler: async (input) => {
      const players = matchPlayers(await listPlayers(), input.name);
      return players.map((player) => ({ playerId: player.id, label: player.label }));
    },
    deps: [],
  });

  const createLeitnerGame = useTool({
    name: 'createLeitnerGame',
    description:
      'Plan a solo Leitner game for one student from a book chapter (built-in or a library book from getBooks). ' +
      'This is a dry run: nothing is created. Returns the plan\'s words, seed and now. Then show <LeitnerPlan> with the ' +
      'same values so the user can click Create.',
    schema: s.object('The game to plan', {
      playerId: s.string('From getPlayers'),
      book: s.string('The book slug from getBooks, e.g. "korean-language-book"'),
      chapter: s.string('The chapter number, e.g. "27" or "1"'),
      scope: s.enumeration('"chapter" for its words only, "review" to add due words from other chapters', ['chapter', 'review']),
      aspects: s.array('Which skills to ask', s.enumeration('A skill', [...LEITNER_ASPECTS])),
    }),
    handler: async (input) => {
      const aspects = input.aspects.length ? [...new Set(input.aspects)] : [...LEITNER_ASPECTS];
      try {
        const { plan, setup } = await planLeitnerGame({
          playerId: input.playerId,
          book: input.book,
          chapter: input.chapter,
          scope: input.scope,
          aspects,
        });
        return {
          book: plan.book,
          chapter: plan.chapter,
          scope: plan.scope,
          aspects: plan.aspects.join(','),
          seed: plan.seed,
          now: plan.now,
          questions: plan.picks.length,
          words: plan.picks.map((pick) => ({ word: pick.word, aspect: pick.aspect, reason: pick.reason })),
          nothingToAsk: plan.picks.length === 0,
          replacesUnplayedGames: plan.supersedes.length,
          setupNotes: setup?.notes ?? [],
        };
      } catch (error) {
        // A refusal the user must act on: explain it, don't retry.
        if (error instanceof LeitnerRefusedError) return { refused: error.message, status: error.status };
        throw error;
      }
    },
    deps: [],
  });

  return {
    tools: [getPlayers, createLeitnerGame],
    components: [
      exposeComponent(LeitnerPlanCard, {
        name: 'LeitnerPlan',
        description:
          'Show a planned Leitner game: the student, the words it will ask, and a Create button for the user. ' +
          'Copy every prop from the createLeitnerGame result.',
        props: {
          playerId: s.string('The playerId you planned for'),
          book: s.string('book from createLeitnerGame'),
          chapter: s.string('chapter from createLeitnerGame'),
          scope: s.string('scope from createLeitnerGame'),
          aspects: s.string('aspects from createLeitnerGame, e.g. "reading,writing"'),
          seed: s.number('seed from createLeitnerGame'),
          now: s.string('now from createLeitnerGame'),
        },
      }),
    ],
    prompt: section`
      ## Leitner games
      A Leitner game is a single-use badge game of one student's next due
      words from a book chapter: a built-in book or a library book (see
      getBooks). Their progress is shared: a word reused from another book is
      the same track.

      Steps:
      1. Call getPlayers with the name the user gave. If several match, ask
         which (by label). If none, say so. Refer to students by the label
         getPlayers returns, or the name the user wrote.
      2. If you don't know the book's slug or chapters, call getBooks.
      3. Call createLeitnerGame. Default scope "review" and both aspects
         unless the user says otherwise. It only plans.
      4. If it returns refused, tell the user why in one sentence (and what to
         do) and stop. If nothingToAsk, say so and suggest another chapter.
      5. Otherwise show <LeitnerPlan> with every value from the result, and say
         how many questions it has and that the user clicks Create game. Never
         say the game was created.

      ### EXAMPLES

      <user>Make a Leitner game for Mia from chapter 1 of my rabbit stories</user>
      <assistant>
        <tool-call>getPlayers</tool-call>
      </assistant>
      <assistant>
        <tool-call>getBooks</tool-call>
      </assistant>
      <assistant>
        <tool-call>createLeitnerGame</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Markdown>Here's Mia's next Leitner game from Rabbit stories, chapter 1: 10 questions, 6 of them new words. Click Create game to make it.</Markdown>
          <LeitnerPlan playerId="from getPlayers" book="from createLeitnerGame" chapter=${'1'} scope="review" aspects="reading,writing" seed=${12345} now="from createLeitnerGame" />
        </ui>
      </assistant>
    `,
  };
}
