import { ClientSession } from 'mongoose';
import { GameDataRepository } from './game-data.repository';
import { MongoService } from './mongo.service';

type LeanQuery<T> = { lean: jest.Mock<Promise<T>, []> };

function createLeanQuery<T>(value: T): LeanQuery<T> {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function createSession(): ClientSession {
  return {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  } as unknown as ClientSession;
}

describe('GameDataRepository', () => {
  const session = createSession();
  const models = {
    Game: {
      create: jest.fn(),
      db: {
        startSession: jest.fn().mockResolvedValue(session),
      },
    },
    GameParticipant: {
      updateOne: jest.fn(),
    },
    Question: {
      create: jest.fn(),
      findOne: jest.fn(),
    },
    AnswerOption: {
      insertMany: jest.fn(),
      findOne: jest.fn(),
    },
    Guess: {
      create: jest.fn(),
    },
    GameNfcCardGroupAssignment: {
      findOne: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    NfcCard: {
      findOne: jest.fn(),
      insertMany: jest.fn(),
    },
    NfcCardGroup: {
      create: jest.fn(),
    },
  };
  const mongoService = {
    getModels: jest.fn().mockReturnValue(models),
  } as unknown as MongoService;
  const repository = new GameDataRepository(mongoService);

  beforeEach(() => {
    jest.clearAllMocks();
    (mongoService.getModels as jest.Mock).mockReturnValue(models);
    models.Game.db.startSession.mockResolvedValue(session);
  });

  it('creates a game and returns its id', async () => {
    models.Game.create.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439020' } });

    const gameId = await repository.createGame({
      title: 'Game from test',
      createdByUserId: '507f1f77bcf86cd799439021',
    });

    expect(models.Game.create).toHaveBeenCalled();
    expect(gameId).toBe('507f1f77bcf86cd799439020');
  });

  it('submits guess in happy path', async () => {
    models.Question.findOne.mockReturnValue(
      createLeanQuery({ _id: 'q1', state: 'open', gameId: 'g1' }),
    );
    models.GameNfcCardGroupAssignment.findOne.mockReturnValue(
      createLeanQuery({ _id: 'a1', groupId: 'grp1' }),
    );
    models.NfcCard.findOne.mockReturnValue(
      createLeanQuery({ _id: 'c1', slotLabel: 'A', status: 'active' }),
    );
    models.AnswerOption.findOne.mockReturnValue(
      createLeanQuery({ _id: { toString: () => '507f1f77bcf86cd799439022' }, slotLabel: 'A' }),
    );
    models.Guess.create.mockResolvedValue([
      { _id: { toString: () => '507f1f77bcf86cd799439023' } },
    ]);

    const result = await repository.submitGuess({
      gameId: '507f1f77bcf86cd799439024',
      questionId: '507f1f77bcf86cd799439025',
      guesserUserId: '507f1f77bcf86cd799439026',
      cardUid: 'CARD-UID-A-001',
    });

    expect(result).toEqual({
      guessId: '507f1f77bcf86cd799439023',
      answerOptionId: '507f1f77bcf86cd799439022',
    });
    expect((session.commitTransaction as jest.Mock)).toHaveBeenCalled();
  });

  it('throws when question is not open', async () => {
    models.Question.findOne.mockReturnValue(
      createLeanQuery({ _id: 'q1', state: 'closed', gameId: 'g1' }),
    );

    await expect(
      repository.submitGuess({
        gameId: '507f1f77bcf86cd799439024',
        questionId: '507f1f77bcf86cd799439025',
        guesserUserId: '507f1f77bcf86cd799439026',
        cardUid: 'CARD-UID-A-001',
      }),
    ).rejects.toThrow('Question is not open for submissions.');

    expect((session.abortTransaction as jest.Mock)).toHaveBeenCalled();
  });

  it('throws when active NFC card group assignment is missing', async () => {
    models.Question.findOne.mockReturnValue(
      createLeanQuery({ _id: 'q1', state: 'open', gameId: 'g1' }),
    );
    models.GameNfcCardGroupAssignment.findOne.mockReturnValue(createLeanQuery(null));

    await expect(
      repository.submitGuess({
        gameId: '507f1f77bcf86cd799439024',
        questionId: '507f1f77bcf86cd799439025',
        guesserUserId: '507f1f77bcf86cd799439026',
        cardUid: 'CARD-UID-A-001',
      }),
    ).rejects.toThrow('No active NFC card group is assigned to this game.');
  });
});
