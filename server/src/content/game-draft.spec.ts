import { readFileSync } from 'fs';
import path from 'path';
import { cardSlotProblem } from '../persistence/game-data.repository';
import {
  GAME_DRAFT_LIMITS,
  draftSettingsSchema,
  gameDraftPayloadSchema,
  gameDraftProblems,
  gameDraftQuestions,
  questionMixValues,
  type GameDraftPayload,
} from './game-draft';

// Read as text: the server build can't import client files.
const authoring = (file: string) =>
  readFileSync(path.join(__dirname, '../../../client/src/app/game-authoring', file), 'utf8');

function question(text: string, correct = 0, options = ['배', '사과', '포도', '귤']): GameDraftPayload['questions'][number] {
  return {
    text,
    focus: 'vocabulary',
    options: options.map((option, i) => ({ text: option, isCorrect: i === correct })),
    sourceExcerpt: '배가 고파요.',
  };
}

function draft(questions = [question('What does 배 mean here?')]): GameDraftPayload {
  return { title: 'Story quiz: 토끼와 거북이', language: { target: 'ko', native: 'en' }, questions };
}

describe('game draft rules', () => {
  it('uses the same limits and mixes as the client prompt (game-authoring/)', () => {
    const limits = authoring('game-limits.ts').match(/GAME_LIMITS = \{([\s\S]*?)\} as const/)?.[1] ?? '';
    const clientLimits = Object.fromEntries(
      [...limits.matchAll(/^\s*(\w+): (\d+),/gm)].map(([, name, value]) => [name, Number(value)]),
    );
    expect(clientLimits).toEqual(GAME_DRAFT_LIMITS);
    const mixIds = [...authoring('question-mixes.ts').matchAll(/^\s*id: '([a-z]+)',/gm)].map(([, id]) => id);
    expect(mixIds).toEqual([...questionMixValues]);
  });

  it('accepts a playable draft', () => {
    expect(gameDraftProblems(draft())).toEqual([]);
  });

  it('lists every problem with a path the editor can point at', () => {
    const twoCorrect = question('Which is a fruit?');
    twoCorrect.options[1].isCorrect = true;
    const problems = gameDraftProblems(
      draft([
        twoCorrect,
        question('', 0, ['배', '배', '', 'x'.repeat(41)]),
        question('Six options?', 0, ['a', 'b', 'c', 'd', 'e', 'f']),
        question('No correct one', -1),
      ]),
    );
    expect(problems).toEqual([
      { path: 'questions.0.options', message: 'Question 1 has 2 correct options (exactly 1 needed)' },
      { path: 'questions.1.text', message: 'Question 2 has no text' },
      { path: 'questions.1.options.1', message: 'Question 2, option B repeats another option' },
      { path: 'questions.1.options.2', message: 'Question 2, option C is empty' },
      { path: 'questions.1.options.3', message: 'Question 2, option D is longer than 40 characters' },
      { path: 'questions.2.options', message: 'Question 3 has 6 options (2–5 allowed)' },
      { path: 'questions.3.options', message: 'Question 4 has 0 correct options (exactly 1 needed)' },
    ]);
  });

  it('needs a title and 1–20 questions', () => {
    expect(gameDraftProblems({ title: ' ', questions: [] })).toEqual([
      { path: 'title', message: 'Title is empty' },
      { path: 'questions', message: 'No questions yet' },
    ]);
    const tooMany = Array.from({ length: 21 }, (_, i) => question(`Q${i + 1}`));
    expect(gameDraftProblems(draft(tooMany))).toEqual([{ path: 'questions', message: 'More than 20 questions' }]);
    expect(gameDraftProblems(null)).toEqual([{ path: 'questions', message: 'No questions yet' }]);
  });

  it('flags prompts over 120 characters', () => {
    expect(gameDraftProblems(draft([question('q'.repeat(121))]))).toEqual([
      { path: 'questions.0.text', message: 'Question 1 is longer than 120 characters' },
    ]);
  });

  it('stores an unplayable draft but refuses a payload of the wrong shape', () => {
    expect(gameDraftPayloadSchema.safeParse(draft([question('', 0, [])])).success).toBe(true);
    expect(gameDraftPayloadSchema.safeParse({ title: 'x', questions: [{ text: 'q', options: 'A' }] }).success).toBe(false);
    expect(gameDraftPayloadSchema.safeParse({ ...draft(), extra: true }).success).toBe(false);
  });

  it('defaults the settings to the vocabulary mix, 10 questions and 4 options', () => {
    expect(draftSettingsSchema.parse({})).toEqual({ mix: 'vocabulary', questionCount: 10, optionsPerQuestion: 4 });
    expect(draftSettingsSchema.safeParse({ optionsPerQuestion: 6 }).success).toBe(false);
  });

  it('turns options into slots A, B, C, … in order, trimmed', () => {
    const [first] = gameDraftQuestions(draft([question(' What does 배 mean? ', 2, ['pear', 'ship ', 'belly', 'boat', 'pot'])]));
    expect(first).toEqual({
      text: 'What does 배 mean?',
      sequence: 1,
      mode: 'standard',
      answerOptions: [
        { text: 'pear', sequence: 1, slotLabel: 'A', isCorrect: false },
        { text: 'ship', sequence: 2, slotLabel: 'B', isCorrect: false },
        { text: 'belly', sequence: 3, slotLabel: 'C', isCorrect: true },
        { text: 'boat', sequence: 4, slotLabel: 'D', isCorrect: false },
        { text: 'pot', sequence: 5, slotLabel: 'E', isCorrect: false },
      ],
    });
  });
});

describe('cardSlotProblem', () => {
  it('says which questions use a slot the card group lacks', () => {
    expect(
      cardSlotProblem({
        groupSlots: ['A', 'B', 'C', 'D'],
        missing: [{ slotLabel: 'E', questionSequences: [3, 7] }],
      }),
    ).toBe('Questions 3, 7 use E, but this card group has A–D. Attach a group with a card for every slot.');
  });

  it('is null with no group attached or nothing missing', () => {
    expect(cardSlotProblem({ groupSlots: null, missing: [] })).toBeNull();
    expect(cardSlotProblem({ groupSlots: ['A', 'B'], missing: [] })).toBeNull();
  });
});
