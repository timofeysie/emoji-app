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
      findById: jest.fn(),
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
      countDocuments: jest.fn(),
    },
    AnswerOption: {
      insertMany: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    },
    Guess: {
      create: jest.fn(),
      find: jest.fn(),
    },
    PairBinding: {
      find: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
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
    models.Game.findById.mockReturnValue(
      createLeanQuery({ _id: 'g1', title: 'Demo Night' }),
    );
    models.Question.findOne.mockReturnValue(
      createLeanQuery({ _id: 'q1', state: 'open', gameId: 'g1' }),
    );
    models.GameNfcCardGroupAssignment.findOne.mockReturnValue(
      createLeanQuery({ _id: 'a1', groupId: 'grp1' }),
    );
    models.NfcCard.findOne.mockReturnValue(
      createLeanQuery({
        _id: 'c1',
        slotLabel: 'A',
        status: 'active',
        displayName: 'R12 - Monkey',
      }),
    );
    models.AnswerOption.findOne.mockReturnValue(
      createLeanQuery({
        _id: { toString: () => '507f1f77bcf86cd799439022' },
        slotLabel: 'A',
        isCorrect: true,
      }),
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
      slotLabel: 'A',
      isCorrect: true,
      cardLabel: 'monkey',
      gameTitle: 'Demo Night',
    });
    expect((session.commitTransaction as jest.Mock)).toHaveBeenCalled();
  });

  it('throws when question is not open', async () => {
    models.Game.findById.mockReturnValue(
      createLeanQuery({ _id: 'g1', title: 'Demo Night' }),
    );
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

  it('returns isCorrect false when no card group and no slotLabel (unknown card)', async () => {
    models.Game.findById.mockReturnValue(
      createLeanQuery({ _id: 'g1', title: 'Demo Night' }),
    );
    models.Question.findOne.mockReturnValue(
      createLeanQuery({ _id: 'q1', state: 'open', gameId: 'g1' }),
    );
    models.GameNfcCardGroupAssignment.findOne.mockReturnValue(createLeanQuery(null));

    const result = await repository.submitGuess({
      gameId: '507f1f77bcf86cd799439024',
      questionId: '507f1f77bcf86cd799439025',
      guesserUserId: '507f1f77bcf86cd799439026',
      cardUid: 'CARD-UID-A-001',
    });

    expect(result).toEqual({
      guessId: '',
      answerOptionId: '',
      slotLabel: '?',
      isCorrect: false,
      cardLabel: '?',
      gameTitle: 'Demo Night',
    });
  });

  it('computes question results for every bound pair', async () => {
    models.AnswerOption.findOne.mockReturnValue(
      createLeanQuery({ slotLabel: 'B', isCorrect: true }),
    );
    models.Guess.find.mockReturnValue(
      createLeanQuery([
        { pairName: 'green', slotLabel: 'B' },
        { pairName: 'white', slotLabel: 'A' },
      ]),
    );
    models.PairBinding.find.mockReturnValue(
      createLeanQuery([
        { pairName: 'green' },
        { pairName: 'white', stationName: 'white' },
        { pairName: 'white-2', stationName: 'white' },
      ]),
    );

    const result = await repository.computeQuestionResult(
      '507f1f77bcf86cd799439024',
      '507f1f77bcf86cd799439025',
    );

    expect(result).toEqual({
      gameId: '507f1f77bcf86cd799439024',
      questionId: '507f1f77bcf86cd799439025',
      correctSlotLabel: 'B',
      results: [
        { pairName: 'green', stationName: 'green', badgeName: 'green', slotLabel: 'B', isCorrect: true },
        { pairName: 'white', stationName: 'white', badgeName: 'white', slotLabel: 'A', isCorrect: false },
        { pairName: 'white-2', stationName: 'white', badgeName: 'white-2', slotLabel: null, isCorrect: false },
      ],
    });
  });

  it('stores the scanning badge as the player and the relay as the station', async () => {
    models.Game.findById.mockReturnValue(createLeanQuery({ _id: 'g1', title: 'Demo Night' }));
    models.PairBinding.findOne.mockReturnValue(
      createLeanQuery({ pairName: 'white-2', stationName: 'white' }),
    );
    models.Question.findOne.mockReturnValue(
      createLeanQuery({ _id: 'q1', state: 'open', gameId: 'g1' }),
    );
    models.GameNfcCardGroupAssignment.findOne.mockReturnValue(createLeanQuery(null));
    models.AnswerOption.findOne.mockReturnValue(
      createLeanQuery({
        _id: { toString: () => '507f1f77bcf86cd799439022' },
        slotLabel: 'B',
        isCorrect: true,
      }),
    );
    models.Guess.create.mockResolvedValue([
      { _id: { toString: () => '507f1f77bcf86cd799439023' } },
    ]);

    await repository.submitGuess({
      gameId: '507f1f77bcf86cd799439024',
      questionId: '507f1f77bcf86cd799439025',
      pairName: 'white',
      badgeName: 'white-2',
      cardUid: 'DB:93:B7:08',
      slotLabel: 'B',
    });

    expect(models.PairBinding.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ pairName: 'white-2', stationName: 'white' }),
      undefined,
      expect.anything(),
    );
    expect(models.Guess.create).toHaveBeenCalledWith(
      [expect.objectContaining({ pairName: 'white-2', stationName: 'white', badgeName: 'white-2' })],
      expect.anything(),
    );
  });

  it('rejects a guess from a badge that is not bound to the station', async () => {
    models.Game.findById.mockReturnValue(createLeanQuery({ _id: 'g1', title: 'Demo Night' }));
    models.PairBinding.findOne.mockReturnValue(createLeanQuery(null));

    await expect(
      repository.submitGuess({
        gameId: '507f1f77bcf86cd799439024',
        questionId: '507f1f77bcf86cd799439025',
        pairName: 'white',
        badgeName: 'red-2',
        cardUid: 'DB:93:B7:08',
        slotLabel: 'B',
      }),
    ).rejects.toThrow("Badge 'red-2' is not bound to station 'white'");
    expect(models.Guess.create).not.toHaveBeenCalled();
  });

  it('keys a Mode 1 guess by pairName without a binding lookup', async () => {
    models.Game.findById.mockReturnValue(createLeanQuery({ _id: 'g1', title: 'Demo Night' }));
    models.Question.findOne.mockReturnValue(
      createLeanQuery({ _id: 'q1', state: 'open', gameId: 'g1' }),
    );
    models.GameNfcCardGroupAssignment.findOne.mockReturnValue(createLeanQuery(null));
    models.AnswerOption.findOne.mockReturnValue(
      createLeanQuery({
        _id: { toString: () => '507f1f77bcf86cd799439022' },
        slotLabel: 'A',
        isCorrect: true,
      }),
    );
    models.Guess.create.mockResolvedValue([
      { _id: { toString: () => '507f1f77bcf86cd799439023' } },
    ]);

    await repository.submitGuess({
      gameId: '507f1f77bcf86cd799439024',
      questionId: '507f1f77bcf86cd799439025',
      pairName: 'white',
      cardUid: '5B:6F:B8:08',
      slotLabel: 'A',
    });

    expect(models.PairBinding.findOne).not.toHaveBeenCalled();
    expect(models.Guess.create).toHaveBeenCalledWith(
      [expect.objectContaining({ pairName: 'white', stationName: 'white' })],
      expect.anything(),
    );
  });

  it('binds one player per roster badge and drops badges that left the roster', async () => {
    models.PairBinding.deleteMany.mockResolvedValue({ deletedCount: 1 });
    models.PairBinding.updateOne.mockResolvedValue({ matchedCount: 1 });

    const bound = await repository.bindStation({
      stationName: 'white',
      badgeNames: ['white', 'white-2', 'white'],
      gameId: '507f1f77bcf86cd799439024',
    });

    expect(bound).toEqual(['white', 'white-2']);
    expect(models.PairBinding.deleteMany).toHaveBeenCalledWith({
      $or: [{ stationName: 'white' }, { stationName: null, pairName: 'white' }],
      pairName: { $nin: ['white', 'white-2'] },
    });
    expect(models.PairBinding.updateOne).toHaveBeenCalledTimes(2);
    expect(models.PairBinding.updateOne).toHaveBeenCalledWith(
      { pairName: 'white-2' },
      expect.objectContaining({
        $set: expect.objectContaining({ stationName: 'white', joined: false }),
      }),
      { upsert: true },
    );
  });

  it('marks only the listed station badges joined', async () => {
    models.PairBinding.find.mockReturnValue(createLeanQuery([{ pairName: 'white-2' }]));
    models.PairBinding.updateMany.mockResolvedValue({ matchedCount: 1 });

    const joined = await repository.markJoined({
      gameId: '507f1f77bcf86cd799439024',
      stationName: 'white',
      badgeNames: ['white-2'],
    });

    expect(joined).toEqual(['white-2']);
    expect(models.PairBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ pairName: { $in: ['white-2'] } }),
      { $set: expect.objectContaining({ joined: true }) },
    );
  });

  it('auto-closes only on joined players, ignoring bound badges that never joined', async () => {
    models.PairBinding.find.mockReturnValue(
      createLeanQuery([{ pairName: 'white' }, { pairName: 'white-2' }]),
    );
    models.Guess.find.mockReturnValue(
      createLeanQuery([{ pairName: 'white' }, { pairName: 'white-2' }]),
    );

    await expect(
      repository.haveAllJoinedPlayersGuessed(
        '507f1f77bcf86cd799439024',
        '507f1f77bcf86cd799439025',
      ),
    ).resolves.toBe(true);
    expect(models.PairBinding.find).toHaveBeenCalledWith(
      expect.objectContaining({ joined: true }),
      { pairName: 1 },
    );
  });

  it('waits while a joined badge has not guessed', async () => {
    models.PairBinding.find.mockReturnValue(
      createLeanQuery([{ pairName: 'white' }, { pairName: 'white-2' }]),
    );
    models.Guess.find.mockReturnValue(createLeanQuery([{ pairName: 'white' }]));

    await expect(
      repository.haveAllJoinedPlayersGuessed(
        '507f1f77bcf86cd799439024',
        '507f1f77bcf86cd799439025',
      ),
    ).resolves.toBe(false);
  });

  it('lists each station once, treating legacy bindings as their own station', async () => {
    models.PairBinding.find.mockReturnValue(
      createLeanQuery([
        { pairName: 'green' },
        { pairName: 'white', stationName: 'white' },
        { pairName: 'white-2', stationName: 'white' },
      ]),
    );

    await expect(
      repository.getStationNamesByGameId('507f1f77bcf86cd799439024'),
    ).resolves.toEqual(['green', 'white']);
  });

  it('returns game scores scoped to startedAt', async () => {
    const startedAt = new Date('2026-07-19T00:00:00.000Z');
    models.Game.findById.mockReturnValue(createLeanQuery({ startedAt }));
    models.Question.countDocuments.mockResolvedValue(4);
    models.Guess.find.mockReturnValue(
      createLeanQuery([
        {
          pairName: 'green',
          answerOptionId: { toString: () => '507f1f77bcf86cd799439030' },
        },
        {
          pairName: 'white',
          answerOptionId: { toString: () => '507f1f77bcf86cd799439031' },
        },
      ]),
    );
    models.AnswerOption.find.mockReturnValue(
      createLeanQuery([
        { _id: { toString: () => '507f1f77bcf86cd799439030' }, isCorrect: true },
        { _id: { toString: () => '507f1f77bcf86cd799439031' }, isCorrect: false },
      ]),
    );
    models.PairBinding.find.mockReturnValue(
      createLeanQuery([{ pairName: 'green' }, { pairName: 'white', stationName: 'black' }]),
    );

    const result = await repository.getGameScores('507f1f77bcf86cd799439024');

    expect(models.Guess.find).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: { $gte: startedAt },
      }),
    );
    expect(result).toEqual({
      gameId: '507f1f77bcf86cd799439024',
      scores: [
        { pairName: 'green', stationName: 'green', badgeName: 'green', correct: 1, total: 4 },
        { pairName: 'white', stationName: 'black', badgeName: 'white', correct: 0, total: 4 },
      ],
    });
  });
});
