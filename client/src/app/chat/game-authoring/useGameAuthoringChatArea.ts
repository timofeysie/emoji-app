import { s } from '@hashbrownai/core';
import { exposeComponent, useTool } from '@hashbrownai/react';
import {
  createDraft,
  DraftRequestError,
  getDraft,
  listDrafts,
  notifyDraftChanged,
  updateDraft,
  type DraftSettings,
  type DraftView,
  type GameDraftContent,
} from '../../game-authoring/drafts-api';
import { gameRecipe, mixPresetsText } from '../../game-authoring/game-authoring.prompt';
import { gameDraftQuestionSchema, gameDraftSchema } from '../../game-authoring/game-draft.schema';
import { GAME_LIMITS, SLOT_LABELS } from '../../game-authoring/game-limits';
import { QUESTION_MIXES } from '../../game-authoring/question-mixes';
import { shuffleOptions } from '../../game-authoring/useGameGeneration';
import type { ChatArea } from '../chat-area';
import { section } from '../prompt-sections';
import { applyRevision, findPassage, mixMismatch, type DraftRevision } from './game-draft-tools';
import { GameDraftCard, OpenDraftTrigger, OpenGameTrigger } from './GameDraftCard';

const mixIds = [...QUESTION_MIXES.map((mix) => mix.id), 'custom'] as const;
const presetCounts = QUESTION_MIXES.map(
  (mix) => `${mix.id} = ${mix.counts.vocabulary} vocabulary + ${mix.counts.grammar} grammar + ${mix.counts.comprehension} comprehension`,
).join('; ');

/** A refused request as the model should read it: what to fix. */
function toolError(error: unknown): Error {
  if (error instanceof DraftRequestError) {
    const details = (error.body.details ?? error.body.problems ?? []).map((d) => `${d.path}: ${d.message}`);
    return new Error([error.message, ...details].join('\n'));
  }
  return error instanceof Error ? error : new Error(String(error));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** What the model sees of a draft: numbered questions, slots and problems. */
function draftForModel({ draft }: DraftView) {
  return {
    draftId: draft.id,
    title: draft.title,
    status: draft.status,
    mine: draft.mine,
    gameId: draft.resultGameId,
    problems: draft.problems.map((problem) => problem.message),
    questions: (draft.payload?.questions ?? []).map((question, i) => ({
      number: i + 1,
      text: question.text,
      focus: question.focus ?? null,
      options: question.options.map((option, o) => ({ slot: SLOT_LABELS[o] ?? '?', text: option.text, isCorrect: option.isCorrect })),
    })),
  };
}

/**
 * Making single games in the chat (docs/hashbrown/creating-games-with-hashbrown.md,
 * H1b). The AI's game goes into a server-side draft through `proposeGame`
 * (G2), the chat shows it with `<GameDraft>`, and only the user creates the
 * game from it (G1). `userTexts` returns what the user has typed, so the
 * pasted passage is kept as the source without the model copying it back.
 */
export function useGameAuthoringChatArea(userTexts: () => readonly string[]): ChatArea {
  const proposeGame = useTool({
    name: 'proposeGame',
    description:
      'Save a game you wrote from a passage the user pasted as a new draft. Returns the draftId and any problems ' +
      'that stop it being created (fix them with reviseGameDraft). It never creates the game: the user does that.',
    schema: s.object('A drafted game', {
      passageStart: s.string('The first 8 or so words of the passage, copied exactly from the user\'s message'),
      mix: s.enumeration(
        `The preset the questions follow, or custom for counts the user gave. Preset counts are exact (for 10): ${presetCounts}`,
        [...mixIds],
      ),
      optionsPerQuestion: s.number('Options per question: 4 unless the user asked for 5'),
      draft: gameDraftSchema,
    }),
    handler: async (input) => {
      const passage = findPassage(input.passageStart, userTexts());
      const content = shuffleOptions(input.draft) as GameDraftContent;
      const language = {
        target: input.draft.language.target.toLowerCase(),
        native: input.draft.language.native.toLowerCase(),
      };
      const settings: DraftSettings = {
        mix: input.mix,
        questionCount: clamp(content.questions.length || GAME_LIMITS.defaultQuestions, 1, GAME_LIMITS.maxQuestions),
        optionsPerQuestion: clamp(input.optionsPerQuestion, GAME_LIMITS.minOptions, GAME_LIMITS.maxOptions),
      };
      try {
        const { draft } = await createDraft({
          ...(passage.ok ? { source: { text: passage.text, language } } : {}),
          settings,
          payload: { ...content, language },
        });
        return {
          draftId: draft.id,
          problems: draft.problems.map((problem) => problem.message),
          mixProblem: mixMismatch(input.mix, content.questions),
          passageKept: passage.ok ? true : `no: ${passage.reason}`,
          note: 'The options were shuffled, so the correct answers are no longer all in the same slot.',
        };
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  const reviseGameDraft = useTool({
    name: 'reviseGameDraft',
    description:
      'Change a game draft: replace or remove questions by their number now (1-based), add questions at the end, ' +
      'or retitle it. Change only what the user asked for. Returns the problems still left.',
    schema: s.object('Changes to a game draft', {
      draftId: s.string('The draft to change'),
      title: s.string('A new title, or an empty string to keep the title'),
      replace: s.array(
        'Questions to replace',
        s.object('A replacement', {
          number: s.number('The number of the question to replace (1-based)'),
          question: gameDraftQuestionSchema,
        }),
      ),
      remove: s.array('The numbers of questions to remove (1-based)', s.number('A question number')),
      add: s.array('New questions to add at the end', gameDraftQuestionSchema),
    }),
    handler: async (input) => {
      const added = shuffleOptions({ questions: input.add }).questions;
      const replaced = shuffleOptions({ questions: input.replace.map((change) => change.question) }).questions;
      const changes: DraftRevision = {
        title: input.title,
        remove: input.remove,
        replace: input.replace.map((change, i) => ({ number: change.number, question: replaced[i] })),
        add: added,
      };
      // One retry: the draft may have been saved on the Draft Game page meanwhile.
      for (let attempt = 0; ; attempt++) {
        try {
          const current = await getDraft(input.draftId);
          if (current.draft.status !== 'draft') {
            throw new Error('This draft was already made into a game and can no longer change.');
          }
          const next = applyRevision(current.draft.payload ?? { title: '', questions: [] }, changes);
          const saved = await updateDraft(input.draftId, {
            revision: current.draft.revision,
            payload: next,
            settings: { ...current.draft.settings, questionCount: clamp(next.questions.length || 1, 1, GAME_LIMITS.maxQuestions) },
          });
          notifyDraftChanged(input.draftId);
          return {
            draftId: input.draftId,
            questionCount: next.questions.length,
            // No mix check here: a change the user asked for wins over the preset.
            problems: saved.draft.problems.map((problem) => problem.message),
          };
        } catch (error) {
          if (attempt === 0 && error instanceof DraftRequestError && error.status === 409 && error.body.draft?.status === 'draft') {
            continue;
          }
          throw toolError(error);
        }
      }
    },
    deps: [],
  });

  const getMyDrafts = useTool({
    name: 'getMyDrafts',
    description:
      'List the user\'s game drafts and the ones other referees shared, newest first: id, title, status ' +
      '(draft, or accepted with its gameId), question count and problem count.',
    handler: async () => {
      try {
        const [mine, shared] = await Promise.all([listDrafts(false), listDrafts(true)]);
        return [...mine.drafts, ...shared.drafts].slice(0, 30).map((draft) => ({
          draftId: draft.id,
          title: draft.title || 'Untitled draft',
          status: draft.status,
          gameId: draft.resultGameId,
          questionCount: draft.questionCount,
          problemCount: draft.problemCount,
          mine: draft.mine,
          shared: draft.shared,
          updatedAt: draft.updatedAt,
        }));
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  const getGameDraft = useTool({
    name: 'getGameDraft',
    description: 'Read one game draft as it is now: its numbered questions, options and problems.',
    schema: s.object('Which draft', { draftId: s.string('The draft id') }),
    handler: async (input) => {
      try {
        return draftForModel(await getDraft(input.draftId));
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  return {
    tools: [proposeGame, reviseGameDraft, getMyDrafts, getGameDraft],
    components: [
      exposeComponent(GameDraftCard, {
        name: 'GameDraft',
        description:
          'Show a game draft: its questions and answers, its problems, and buttons for the user to create the game, ' +
          'discard the draft or open it in the Draft Game page.',
        props: { draftId: s.string('The draftId from proposeGame or getMyDrafts') },
      }),
      exposeComponent(OpenGameTrigger, {
        name: 'OpenGame',
        description: 'Open a game\'s page when the user asks to see it.',
        props: { gameId: s.string('The game id, e.g. a draft\'s gameId from getMyDrafts') },
      }),
      exposeComponent(OpenDraftTrigger, {
        name: 'OpenDraft',
        description: 'Open a draft in the Draft Game page, where the user has more room to edit it.',
        props: { draftId: s.string('The draft id') },
      }),
    ],
    prompt: section`
      ## Making games from a passage
      A signed-in user can paste a passage (for example a few paragraphs of a
      Korean story) and ask for a quiz game. You write the questions, save them
      as a draft with proposeGame, and show the draft with <GameDraft>. Only the
      user can turn a draft into a game, with the Create game button: never say
      the game is created until they have done that.

      Question mixes (counts for 10 questions; scale them for other totals):
      ${mixPresetsText()}
      A preset's counts are exact: "a comprehension game" is 6 comprehension,
      2 vocabulary and 2 grammar questions, not 10 comprehension ones. Set each
      question's focus to match. Use the vocabulary mix unless the user asks for
      something else. Use custom
      when the user gives their own counts, e.g. "12 questions: 8 vocabulary and
      4 grammar". Use ${GAME_LIMITS.defaultOptions} options per question unless the user asks
      for 5; then tell them the game needs a card group with an E card.

      The default recipe:
      ${gameRecipe()}
      Write the questions in English unless the user says the learner speaks
      another language. Passages over ${GAME_LIMITS.maxSourceLength} characters can't be kept;
      ask the user for a shorter one.

      When proposeGame returns problems or a mixProblem, or reviseGameDraft
      returns problems, fix them with reviseGameDraft (replace the questions
      they name) before showing the draft. A change of kind the user asks for
      ("make question 4 about grammar") wins over the mix. When the user asks for a change ("make question 4 harder",
      "replace the last two with comprehension questions"), call getGameDraft
      if you aren't sure what the questions are now, then reviseGameDraft with
      only those changes, and show the draft again. When they ask to continue
      an earlier game, call getMyDrafts to find it.

      ### EXAMPLES

      <user>Make a game from this story: 옛날 옛적에 토끼와 거북이가 살았어요. …</user>
      <assistant>
        <tool-call>proposeGame</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Markdown>Here's a draft: 6 vocabulary, 2 grammar and 2 comprehension questions. Check the answers, then click Create game.</Markdown>
          <GameDraft draftId="draft id from proposeGame" />
        </ui>
      </assistant>

      <user>Question 4 is too easy, make it about the grammar</user>
      <assistant>
        <tool-call>getGameDraft</tool-call>
      </assistant>
      <assistant>
        <tool-call>reviseGameDraft</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Markdown>I replaced question 4 with a grammar question.</Markdown>
          <GameDraft draftId="the same draft id" />
        </ui>
      </assistant>

      <user>Open my story game</user>
      <assistant>
        <tool-call>getMyDrafts</tool-call>
      </assistant>
      <assistant>
        <ui>
          <OpenDraft draftId="the draft id from getMyDrafts" />
        </ui>
      </assistant>
    `,
  };
}
