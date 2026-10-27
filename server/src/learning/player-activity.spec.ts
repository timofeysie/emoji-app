import { buildGameStatements, type QuestionInput } from '../xapi/statement-builder';
import { getBookContent } from './book-content';
import { KOREAN_BOOK } from './learning-object';
import { summarizePlayerActivity } from './player-activity';

const EXTERNAL_ID = '7f3a2c1e-0000-4000-8000-000000000000';
const PLAYER_ID = '507f1f77bcf86cd7994390aa';

function question(id: string, aspect: string | null): QuestionInput {
  return {
    id,
    text: `시험 (${id})`,
    openedAt: '2026-10-22T18:00:00.000Z',
    answerOptions: [
      { slotLabel: 'A', text: 'test, exam', isCorrect: true },
      { slotLabel: 'B', text: 'class', isCorrect: false },
    ],
    learning: aspect
      ? {
          learningObjectId: 'ko/lexeme/시험/test',
          book: KOREAN_BOOK,
          sourceRef: 'ch27/vocabulary/1',
          aspect,
          target: '시험',
          native: 'test, exam',
        }
      : null,
  };
}

/** One game's statements from the real builder, so the summary reads the shapes we send. */
function game(input: {
  id: string;
  title: string;
  kind: 'class' | 'leitner-solo';
  guesses: Array<{ id: string; questionId: string; slotLabel: string; at: string }>;
  questions: QuestionInput[];
}): unknown[] {
  const correct = input.guesses.filter((guess) => guess.slotLabel === 'A').length;
  return buildGameStatements({
    game: {
      id: input.id,
      title: input.title,
      kind: input.kind,
      startedAt: '2026-10-22T17:59:00.000Z',
      endedAt: input.guesses.at(-1)!.at,
    },
    questions: input.questions,
    guesses: input.guesses.map((guess) => ({
      id: guess.id,
      questionId: guess.questionId,
      badgeName: 'Badge 1',
      stationName: 'Station 1',
      slotLabel: guess.slotLabel,
      createdAt: guess.at,
    })),
    scores: [{ badgeName: 'Badge 1', correct, total: input.guesses.length }],
    playerBindings: [{ badgeName: 'Badge 1', playerId: PLAYER_ID, assignedAt: '2026-10-22T17:00:00.000Z' }],
    players: [{ id: PLAYER_ID, externalId: EXTERNAL_ID }],
  });
}

describe('summarizePlayerActivity', () => {
  const content = getBookContent(KOREAN_BOOK);

  const leitner = game({
    id: 'leitner1',
    title: 'Leitner · Player 7F3A · ch. 27',
    kind: 'leitner-solo',
    questions: [question('q1', 'reading'), question('q2', 'writing')],
    guesses: [
      { id: 'g1', questionId: 'q1', slotLabel: 'A', at: '2026-10-22T18:00:04.000Z' },
      { id: 'g2', questionId: 'q2', slotLabel: 'B', at: '2026-10-22T18:01:00.000Z' },
    ],
  });
  const classGame = game({
    id: 'class1',
    title: 'Quiz night',
    kind: 'class',
    questions: [question('q9', null)],
    guesses: [{ id: 'g9', questionId: 'q9', slotLabel: 'A', at: '2026-10-24T10:00:00.000Z' }],
  });

  it('groups answers into games with their title and score, newest first', () => {
    const activity = summarizePlayerActivity({
      statements: [...leitner, ...classGame],
      content,
      now: new Date('2026-10-25T09:00:00Z'),
    });

    expect(activity.statementCount).toBe(leitner.length + classGame.length);
    expect(activity.sessions).toEqual([
      expect.objectContaining({ gameId: 'class1', title: 'Quiz night', kind: 'class', answered: 1, correct: 1, score: { raw: 1, max: 1 }, chapters: [] }),
      expect.objectContaining({
        gameId: 'leitner1',
        kind: 'leitner-solo',
        answered: 2,
        correct: 1,
        score: { raw: 1, max: 2 },
        chapters: ['27'],
        firstAnswerAt: '2026-10-22T18:00:04.000Z',
        lastAnswerAt: '2026-10-22T18:01:00.000Z',
      }),
    ]);
    expect(activity.summary).toMatchObject({
      games: 2,
      answered: 3,
      correct: 2,
      firstActivityAt: '2026-10-22T18:00:04.000Z',
      lastActivityAt: '2026-10-24T10:00:00.000Z',
    });
  });

  it('lists recent answers with the chosen and correct option text', () => {
    const { recentAnswers } = summarizePlayerActivity({ statements: leitner, content, now: new Date('2026-10-25T09:00:00Z') });
    expect(recentAnswers.map((answer) => answer.timestamp)).toEqual([
      '2026-10-22T18:01:00.000Z',
      '2026-10-22T18:00:04.000Z',
    ]);
    expect(recentAnswers[0]).toMatchObject({
      gameId: 'leitner1',
      question: '시험 (q2)',
      response: 'class',
      correctAnswer: 'test, exam',
      success: false,
      aspect: 'writing',
      chapter: '27',
    });
    expect(recentAnswers[1].durationSeconds).toBe(4);
  });

  it('folds Leitner tracks with word and gloss; class answers move no levels', () => {
    const activity = summarizePlayerActivity({
      statements: [...leitner, ...classGame],
      content,
      now: new Date('2026-10-22T19:00:00Z'),
    });
    expect(activity.tracks).toHaveLength(2);
    expect(activity.tracks.find((track) => track.aspect === 'reading')).toMatchObject({
      word: '시험',
      gloss: 'test, exam',
      kind: 'lexeme',
      level: 1,
      due: false,
    });
    expect(activity.tracks.find((track) => track.aspect === 'writing')).toMatchObject({ level: 0, due: true });
    expect(activity.summary).toMatchObject({ words: 1, tracks: 2, active: { L0: 1, L1: 1, L2: 0, L3: 0 }, retired: 0, due: 1 });
  });

  it('is empty for a student with no statements', () => {
    const activity = summarizePlayerActivity({ statements: [], content, now: new Date() });
    expect(activity.sessions).toEqual([]);
    expect(activity.summary).toMatchObject({ games: 0, answered: 0, tracks: 0, lastActivityAt: null });
  });
});
