import {
  answeredStatementId,
  buildActor,
  buildAnsweredStatement,
  buildGameStatements,
  buildScoredStatement,
  gameActivityId,
  gameRegistration,
  questionActivityId,
  scoredStatementId,
  UnattributedBadgeError,
  XAPI_BASE_IRI,
  XAPI_HOMEPAGE,
  type BuildGameStatementsInput,
} from './statement-builder';
import { playerLabel } from '../persistence/player.repository';

const GAME_ID = '6650f00000000000000000f0';
const QUESTION_ID = '6650a00000000000000000a0';
const GUESS_ID = '6650b00000000000000000b0';
const PLAYER_ID = '6650c00000000000000000c0';
const EXTERNAL_ID = '7f3a2c1e-5b8d-4e6a-9c0f-1d2e3f4a5b6c';

function iso(value: string): Date {
  return new Date(value);
}

describe('identifiers', () => {
  it('builds activity ids from the locked base IRI', () => {
    expect(gameActivityId(GAME_ID)).toBe(`${XAPI_BASE_IRI}/games/${GAME_ID}`);
    expect(questionActivityId(GAME_ID, QUESTION_ID)).toBe(
      `${XAPI_BASE_IRI}/games/${GAME_ID}/questions/${QUESTION_ID}`,
    );
  });

  it('derives stable UUID v5s, so re-generating for the same ids is idempotent', () => {
    expect(gameRegistration(GAME_ID)).toBe(gameRegistration(GAME_ID));
    expect(answeredStatementId(GAME_ID, GUESS_ID)).toBe(answeredStatementId(GAME_ID, GUESS_ID));
    expect(scoredStatementId(GAME_ID, PLAYER_ID)).toBe(scoredStatementId(GAME_ID, PLAYER_ID));
  });

  it('gives different guesses in the same game different statement ids', () => {
    expect(answeredStatementId(GAME_ID, GUESS_ID)).not.toBe(answeredStatementId(GAME_ID, 'other'));
  });

  it('looks like a UUID', () => {
    expect(gameRegistration(GAME_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('buildActor', () => {
  it('identifies the player only by account + externalId, with a non-identifying label', () => {
    expect(buildActor(EXTERNAL_ID)).toEqual({
      objectType: 'Agent',
      name: playerLabel(EXTERNAL_ID),
      account: { homePage: XAPI_HOMEPAGE, name: EXTERNAL_ID },
    });
  });

  it('never includes a first name or email', () => {
    const actor = buildActor(EXTERNAL_ID);
    expect(JSON.stringify(actor)).not.toMatch(/mia|mbox|email/i);
  });
});

describe('buildAnsweredStatement', () => {
  const question = {
    id: QUESTION_ID,
    text: '사과 is what?',
    openedAt: iso('2026-10-05T09:14:00.000Z'),
    answerOptions: [
      { slotLabel: 'A', text: 'Banana', isCorrect: false },
      { slotLabel: 'B', text: 'Apple', isCorrect: true },
      { slotLabel: 'C', text: 'Pear', isCorrect: false },
    ],
  };

  it('matches the LRS.md worked example shape for a wrong guess', () => {
    const guess = {
      id: GUESS_ID,
      questionId: QUESTION_ID,
      badgeName: 'badge-red',
      stationName: 'station-1',
      slotLabel: 'A',
      createdAt: iso('2026-10-05T09:14:03.120Z'),
    };

    const statement = buildAnsweredStatement({
      gameId: GAME_ID,
      guess,
      question,
      externalId: EXTERNAL_ID,
    });

    expect(statement).toEqual({
      id: answeredStatementId(GAME_ID, GUESS_ID),
      actor: buildActor(EXTERNAL_ID),
      verb: { id: 'http://adlnet.gov/expapi/verbs/answered', display: { 'en-US': 'answered' } },
      object: {
        objectType: 'Activity',
        id: questionActivityId(GAME_ID, QUESTION_ID),
        definition: {
          type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
          name: { 'en-US': '사과 is what?' },
          interactionType: 'choice',
          correctResponsesPattern: ['B'],
          choices: [
            { id: 'A', description: { 'en-US': 'Banana' } },
            { id: 'B', description: { 'en-US': 'Apple' } },
            { id: 'C', description: { 'en-US': 'Pear' } },
          ],
        },
      },
      result: { response: 'A', success: false, duration: 'PT3.1S' },
      timestamp: '2026-10-05T09:14:03.120Z',
      context: {
        registration: gameRegistration(GAME_ID),
        contextActivities: { parent: [{ id: gameActivityId(GAME_ID) }] },
        extensions: {
          [`${XAPI_BASE_IRI}/ext/game-id`]: GAME_ID,
          [`${XAPI_BASE_IRI}/ext/station-name`]: 'station-1',
          [`${XAPI_BASE_IRI}/ext/badge-name`]: 'badge-red',
        },
      },
    });
  });

  it('marks success true for the correct slot', () => {
    const guess = {
      id: GUESS_ID,
      questionId: QUESTION_ID,
      badgeName: 'badge-red',
      slotLabel: 'B',
      createdAt: iso('2026-10-05T09:14:03.120Z'),
    };
    const statement = buildAnsweredStatement({ gameId: GAME_ID, guess, question, externalId: EXTERNAL_ID });
    expect(statement.result.success).toBe(true);
  });

  it('omits result.duration when the question has no openedAt', () => {
    const guess = {
      id: GUESS_ID,
      questionId: QUESTION_ID,
      badgeName: 'badge-red',
      slotLabel: 'B',
      createdAt: iso('2026-10-05T09:14:03.120Z'),
    };
    const statement = buildAnsweredStatement({
      gameId: GAME_ID,
      guess,
      question: { ...question, openedAt: null },
      externalId: EXTERNAL_ID,
    });
    expect(statement.result.duration).toBeUndefined();
  });

  it('falls back station-name extension to the badge name when no station is recorded', () => {
    const guess = {
      id: GUESS_ID,
      questionId: QUESTION_ID,
      badgeName: 'pair-1',
      slotLabel: 'B',
      createdAt: iso('2026-10-05T09:14:03.120Z'),
    };
    const statement = buildAnsweredStatement({ gameId: GAME_ID, guess, question, externalId: EXTERNAL_ID });
    expect(statement.context.extensions[`${XAPI_BASE_IRI}/ext/station-name`]).toBe('pair-1');
  });

  it('throws if the guess chose a slot the question has no option for', () => {
    const guess = {
      id: GUESS_ID,
      questionId: QUESTION_ID,
      badgeName: 'badge-red',
      slotLabel: 'Z',
      createdAt: iso('2026-10-05T09:14:03.120Z'),
    };
    expect(() =>
      buildAnsweredStatement({ gameId: GAME_ID, guess, question, externalId: EXTERNAL_ID }),
    ).toThrow(/no answer option/);
  });
});

describe('buildScoredStatement', () => {
  it('matches the LRS.md field table', () => {
    const statement = buildScoredStatement({
      gameId: GAME_ID,
      gameTitle: 'Korean Vocab Night',
      score: { badgeName: 'badge-red', correct: 7, total: 10 },
      playerId: PLAYER_ID,
      externalId: EXTERNAL_ID,
      startedAt: iso('2026-10-05T09:00:00.000Z'),
      endedAt: iso('2026-10-05T09:20:00.000Z'),
    });

    expect(statement).toEqual({
      id: scoredStatementId(GAME_ID, PLAYER_ID),
      actor: buildActor(EXTERNAL_ID),
      verb: { id: 'http://adlnet.gov/expapi/verbs/scored', display: { 'en-US': 'scored' } },
      object: {
        objectType: 'Activity',
        id: gameActivityId(GAME_ID),
        definition: {
          type: 'http://adlnet.gov/expapi/activities/assessment',
          name: { 'en-US': 'Korean Vocab Night' },
        },
      },
      result: {
        score: { raw: 7, min: 0, max: 10, scaled: 0.7 },
        duration: 'PT1200S',
      },
      timestamp: '2026-10-05T09:20:00.000Z',
      context: { registration: gameRegistration(GAME_ID) },
    });
  });

  it('scales to 0 rather than dividing by zero when there are no questions', () => {
    const statement = buildScoredStatement({
      gameId: GAME_ID,
      gameTitle: 'Empty Game',
      score: { badgeName: 'badge-red', correct: 0, total: 0 },
      playerId: PLAYER_ID,
      externalId: EXTERNAL_ID,
      startedAt: iso('2026-10-05T09:00:00.000Z'),
      endedAt: iso('2026-10-05T09:00:05.000Z'),
    });
    expect(statement.result.score.scaled).toBe(0);
  });
});

describe('buildGameStatements', () => {
  const baseInput: BuildGameStatementsInput = {
    game: {
      id: GAME_ID,
      title: 'Korean Vocab Night',
      startedAt: iso('2026-10-05T09:00:00.000Z'),
      endedAt: iso('2026-10-05T09:20:00.000Z'),
    },
    questions: [
      {
        id: QUESTION_ID,
        text: '사과 is what?',
        openedAt: iso('2026-10-05T09:14:00.000Z'),
        answerOptions: [
          { slotLabel: 'A', text: 'Banana', isCorrect: false },
          { slotLabel: 'B', text: 'Apple', isCorrect: true },
        ],
      },
    ],
    guesses: [
      {
        id: GUESS_ID,
        questionId: QUESTION_ID,
        badgeName: 'badge-red',
        stationName: 'station-1',
        slotLabel: 'B',
        createdAt: iso('2026-10-05T09:14:03.000Z'),
      },
    ],
    scores: [{ badgeName: 'badge-red', correct: 1, total: 1 }],
    playerBindings: [
      {
        badgeName: 'badge-red',
        playerId: PLAYER_ID,
        assignedAt: iso('2026-10-05T08:55:00.000Z'),
        unassignedAt: null,
      },
    ],
    players: [{ id: PLAYER_ID, externalId: EXTERNAL_ID }],
  };

  it('builds one answered statement per guess, then one scored statement per score row', () => {
    const statements = buildGameStatements(baseInput);
    expect(statements.map((s) => s.verb.id)).toEqual([
      'http://adlnet.gov/expapi/verbs/answered',
      'http://adlnet.gov/expapi/verbs/scored',
    ]);
    expect(statements[0].actor.account.name).toBe(EXTERNAL_ID);
    expect(statements[1].actor.account.name).toBe(EXTERNAL_ID);
  });

  it('is idempotent: building the same input twice gives byte-identical statements', () => {
    expect(buildGameStatements(baseInput)).toEqual(buildGameStatements(baseInput));
  });

  it('attributes a guess to whoever held the badge at the time it was made, across a swap', () => {
    const playerTwoId = '6650c00000000000000000c1';
    const externalIdTwo = 'aaaaaaaa-5b8d-4e6a-9c0f-1d2e3f4a5b6c';
    const input: BuildGameStatementsInput = {
      ...baseInput,
      guesses: [
        { ...baseInput.guesses[0], createdAt: iso('2026-10-05T09:05:00.000Z') },
      ],
      playerBindings: [
        {
          badgeName: 'badge-red',
          playerId: PLAYER_ID,
          assignedAt: iso('2026-10-05T08:55:00.000Z'),
          unassignedAt: iso('2026-10-05T09:10:00.000Z'),
        },
        {
          badgeName: 'badge-red',
          playerId: playerTwoId,
          assignedAt: iso('2026-10-05T09:10:00.000Z'),
          unassignedAt: null,
        },
      ],
      players: [
        { id: PLAYER_ID, externalId: EXTERNAL_ID },
        { id: playerTwoId, externalId: externalIdTwo },
      ],
    };

    const [answered, scored] = buildGameStatements(input);
    // Guess made at 09:05, before the swap at 09:10 — belongs to player one.
    expect(answered.actor.account.name).toBe(EXTERNAL_ID);
    // Score aggregates the whole game and is attributed as of game end — player two.
    expect(scored.actor.account.name).toBe(externalIdTwo);
  });

  it('throws UnattributedBadgeError for a guess whose badge has no covering binding', () => {
    const input: BuildGameStatementsInput = { ...baseInput, playerBindings: [] };
    expect(() => buildGameStatements(input)).toThrow(UnattributedBadgeError);
  });

  it('throws UnattributedBadgeError for a score row whose badge has no covering binding', () => {
    const input: BuildGameStatementsInput = {
      ...baseInput,
      guesses: [],
      playerBindings: [],
    };
    expect(() => buildGameStatements(input)).toThrow(UnattributedBadgeError);
  });
});
