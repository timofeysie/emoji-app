import type { Response } from 'express';
import { GameFlowController } from './game-flow.controller';
import { GameDataRepository } from './persistence/game-data.repository';
import { BadgeStateService } from './badge-state.service';
import { NfcCardService } from './nfc-card.service';

type ResponseMock = Pick<Response, 'status' | 'json'> & {
  status: jest.Mock;
  json: jest.Mock;
};

function createResponseMock(): ResponseMock {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

describe('GameFlowController', () => {
  const repository: jest.Mocked<GameDataRepository> = {
    createGame: jest.fn(),
    addParticipant: jest.fn(),
    createQuestionWithOptions: jest.fn(),
    setQuestionState: jest.fn(),
    setGameState: jest.fn(),
    createNfcCardGroup: jest.fn(),
    ensureNfcCardGroup: jest.fn(),
    assignNfcCardGroupToGame: jest.fn(),
    getActiveNfcCardGroupForGame: jest.fn(),
    openNextQuestionForGame: jest.fn(),
    submitGuess: jest.fn(),
    bindPair: jest.fn(),
    getBinding: jest.fn(),
    markJoined: jest.fn(),
    setPairReadyForNextQuestion: jest.fn(),
    resetPairReadiness: jest.fn(),
    getBindingsByGameId: jest.fn(),
    computeQuestionResult: jest.fn(),
    getGameScores: jest.fn(),
    getGameDetail: jest.fn(),
    getGameGuessChart: jest.fn(),
    haveAllBoundPairsGuessed: jest.fn(),
  } as unknown as jest.Mocked<GameDataRepository>;

  const badgeStateService: jest.Mocked<Pick<BadgeStateService, 'broadcastDashboard' | 'sendToPairNames'>> = {
    broadcastDashboard: jest.fn(),
    sendToPairNames: jest.fn(),
  };

  const nfcCardService = new NfcCardService();

  const controller = new GameFlowController(
    repository,
    badgeStateService as unknown as BadgeStateService,
    nfcCardService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.getGameDetail.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      title: 'Demo Night',
      state: 'lobby',
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      questions: [],
      boundPairs: [],
    });
    repository.haveAllBoundPairsGuessed.mockResolvedValue(false);
  });

  it('returns 400 for invalid game creation payload', async () => {
    const res = createResponseMock();

    await controller.createGame({ title: '' }, res as unknown as Response);

    expect(repository.createGame).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 201 with gameId for valid game creation payload', async () => {
    const res = createResponseMock();
    repository.createGame.mockResolvedValue('507f1f77bcf86cd799439011');

    await controller.createGame(
      {
        title: 'Test Game',
        createdByUserId: '507f1f77bcf86cd799439012',
      },
      res as unknown as Response,
    );

    expect(repository.createGame).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ gameId: '507f1f77bcf86cd799439011' });
  });

  it('returns only the open question without correct-answer flags for student play', async () => {
    const res = createResponseMock();
    repository.getGameDetail.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      title: 'Demo Night',
      state: 'active',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      boundPairs: [],
      questions: [
        {
          id: '507f1f77bcf86cd799439015',
          text: 'Visible question',
          sequence: 1,
          mode: 'standard',
          state: 'open',
          guessCount: 0,
          answerOptions: [
            {
              id: '507f1f77bcf86cd799439016',
              slotLabel: 'A',
              text: 'Visible answer',
              isCorrect: true,
              sequence: 1,
            },
          ],
        },
        {
          id: '507f1f77bcf86cd799439017',
          text: 'Future question',
          sequence: 2,
          mode: 'standard',
          state: 'draft',
          guessCount: 0,
          answerOptions: [],
        },
      ],
    });

    await controller.getGamePlayView(
      '507f1f77bcf86cd799439011',
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      id: '507f1f77bcf86cd799439011',
      title: 'Demo Night',
      state: 'active',
      boundPairs: [],
      totalRounds: 2,
      nextRoundSequence: null,
      currentQuestion: {
        id: '507f1f77bcf86cd799439015',
        text: 'Visible question',
        sequence: 1,
        answerOptions: [
          {
            id: '507f1f77bcf86cd799439016',
            slotLabel: 'A',
            text: 'Visible answer',
            sequence: 1,
          },
        ],
      },
      previousResult: null,
    });
  });

  it('returns the latest completed-round tag scans for student play', async () => {
    const res = createResponseMock();
    repository.getGameDetail.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      title: 'Demo Night',
      state: 'active',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      boundPairs: [],
      questions: [
        {
          id: '507f1f77bcf86cd799439015',
          text: 'Completed question',
          sequence: 1,
          mode: 'standard',
          state: 'closed',
          guessCount: 1,
          answerOptions: [
            {
              id: '507f1f77bcf86cd799439016',
              slotLabel: 'A',
              text: 'Correct answer',
              isCorrect: true,
              sequence: 1,
            },
          ],
        },
        {
          id: '507f1f77bcf86cd799439017',
          text: 'Hidden next question',
          sequence: 2,
          mode: 'standard',
          state: 'closed',
          guessCount: 0,
          answerOptions: [],
        },
      ],
    });
    repository.getGameGuessChart.mockResolvedValue({
      gameId: '507f1f77bcf86cd799439011',
      title: 'Demo Night',
      pairs: ['green', 'white'],
      questions: [
        {
          questionId: '507f1f77bcf86cd799439015',
          sequence: 1,
          byPair: {
            green: {
              cardLabel: 'Monkey',
              slotLabel: 'A',
              isCorrect: true,
            },
            white: null,
          },
        },
      ],
    });

    await controller.getGamePlayView(
      '507f1f77bcf86cd799439011',
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuestion: null,
        nextRoundSequence: 2,
        previousResult: {
          questionId: '507f1f77bcf86cd799439015',
          text: 'Completed question',
          sequence: 1,
          scans: [
            {
              pairName: 'green',
              cardLabel: 'Monkey',
              slotLabel: 'A',
              isCorrect: true,
            },
            {
              pairName: 'white',
              cardLabel: null,
              slotLabel: null,
              isCorrect: false,
            },
          ],
        },
      }),
    );
  });

  it('marks the player view complete after the final round closes', async () => {
    const res = createResponseMock();
    repository.getGameDetail.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      title: 'Demo Night',
      state: 'active',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      boundPairs: [],
      questions: [
        {
          id: '507f1f77bcf86cd799439015',
          text: 'Final question',
          sequence: 1,
          mode: 'standard',
          state: 'closed',
          guessCount: 1,
          answerOptions: [],
        },
      ],
    });
    repository.getGameGuessChart.mockResolvedValue({
      gameId: '507f1f77bcf86cd799439011',
      title: 'Demo Night',
      pairs: [],
      questions: [],
    });

    await controller.getGamePlayView(
      '507f1f77bcf86cd799439011',
      res as unknown as Response,
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuestion: null,
        nextRoundSequence: null,
        totalRounds: 1,
      }),
    );
  });

  it('returns 400 when player participant is missing playMode', async () => {
    const res = createResponseMock();

    await controller.addParticipant(
      '507f1f77bcf86cd799439013',
      {
        userId: '507f1f77bcf86cd799439014',
        role: 'player',
      },
      res as unknown as Response,
    );

    expect(repository.addParticipant).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 for valid question state update and emits question.opened', async () => {
    const res = createResponseMock();
    repository.getBindingsByGameId.mockResolvedValue(['green']);

    await controller.setQuestionState(
      '507f1f77bcf86cd799439015',
      {
        gameId: '507f1f77bcf86cd799439016',
        state: 'open',
      },
      res as unknown as Response,
    );

    expect(repository.setQuestionState).toHaveBeenCalledWith({
      gameId: '507f1f77bcf86cd799439016',
      questionId: '507f1f77bcf86cd799439015',
      state: 'open',
    });
    expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'question.opened',
        questionId: '507f1f77bcf86cd799439015',
      }),
    );
    expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
      ['green'],
      expect.objectContaining({ type: 'question.opened' }),
    );
    expect(repository.computeQuestionResult).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('emits question.closed and question.result when a question is closed', async () => {
    const res = createResponseMock();
    repository.getBindingsByGameId.mockResolvedValue(['green', 'white']);
    repository.getGameDetail.mockResolvedValue({
      id: '507f1f77bcf86cd799439016',
      title: 'Demo Night',
      state: 'active',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      boundPairs: [],
      questions: [
        {
          id: '507f1f77bcf86cd799439015',
          text: 'Round 1',
          sequence: 1,
          mode: 'standard',
          state: 'closed',
          guessCount: 2,
          answerOptions: [],
        },
        {
          id: '507f1f77bcf86cd799439017',
          text: 'Round 2',
          sequence: 2,
          mode: 'standard',
          state: 'draft',
          guessCount: 0,
          answerOptions: [],
        },
      ],
    });
    repository.computeQuestionResult.mockResolvedValue({
      gameId: '507f1f77bcf86cd799439016',
      questionId: '507f1f77bcf86cd799439015',
      correctSlotLabel: 'B',
      results: [
        { pairName: 'green', slotLabel: 'B', isCorrect: true },
        { pairName: 'white', slotLabel: null, isCorrect: false },
      ],
    });

    await controller.setQuestionState(
      '507f1f77bcf86cd799439015',
      {
        gameId: '507f1f77bcf86cd799439016',
        state: 'closed',
      },
      res as unknown as Response,
    );

    expect(repository.resetPairReadiness).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439016',
    );
    expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'question.closed',
        isFinalRound: false,
      }),
    );
    expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'question.result',
        correctSlotLabel: 'B',
      }),
    );
    expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
      ['green', 'white'],
      expect.objectContaining({ type: 'question.result' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('maps repository submitGuess errors to 400', async () => {
    const res = createResponseMock();
    repository.submitGuess.mockRejectedValue(new Error('Question is not open for submissions.'));

    await controller.submitGuess(
      {
        gameId: '507f1f77bcf86cd799439017',
        questionId: '507f1f77bcf86cd799439018',
        guesserUserId: '507f1f77bcf86cd799439019',
        cardUid: 'CARD-UID-A-001',
      },
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(repository.submitGuess).toHaveBeenCalled();
  });

  it('accepts submitGuess without guesserUserId when pairName is provided', async () => {
    const res = createResponseMock();
    repository.submitGuess.mockResolvedValue({
      guessId: '507f1f77bcf86cd799439020',
      answerOptionId: '507f1f77bcf86cd799439021',
      slotLabel: 'A',
      isCorrect: true,
      cardLabel: 'a',
      gameTitle: 'Demo Night',
    });

    await controller.submitGuess(
      {
        gameId: '507f1f77bcf86cd799439017',
        questionId: '507f1f77bcf86cd799439018',
        pairName: 'white',
        cardUid: '5B:6F:B8:08',
      },
      res as unknown as Response,
    );

    expect(repository.submitGuess).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'nfc.tagged',
        pairName: 'white',
        isCorrect: true,
        cardLabel: 'monkey',
        gameTitle: 'Demo Night',
      }),
    );
    expect(repository.setQuestionState).not.toHaveBeenCalled();
  });

  it('auto-closes the question when the last bound pair answers', async () => {
    const res = createResponseMock();
    repository.submitGuess.mockResolvedValue({
      guessId: '507f1f77bcf86cd799439020',
      answerOptionId: '507f1f77bcf86cd799439021',
      slotLabel: 'A',
      isCorrect: true,
      cardLabel: 'monkey',
      gameTitle: 'Demo Night',
    });
    repository.haveAllBoundPairsGuessed.mockResolvedValue(true);
    repository.getBindingsByGameId.mockResolvedValue(['white']);
    repository.getGameDetail.mockResolvedValue({
      id: '507f1f77bcf86cd799439017',
      title: 'Demo Night',
      state: 'active',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      boundPairs: [],
      questions: [
        {
          id: '507f1f77bcf86cd799439018',
          text: 'Final round',
          sequence: 1,
          mode: 'standard',
          state: 'closed',
          guessCount: 1,
          answerOptions: [],
        },
      ],
    });
    repository.computeQuestionResult.mockResolvedValue({
      gameId: '507f1f77bcf86cd799439017',
      questionId: '507f1f77bcf86cd799439018',
      correctSlotLabel: 'A',
      results: [{ pairName: 'white', slotLabel: 'A', isCorrect: true }],
    });

    await controller.submitGuess(
      {
        gameId: '507f1f77bcf86cd799439017',
        questionId: '507f1f77bcf86cd799439018',
        pairName: 'white',
        cardUid: '5B:6F:B8:08',
      },
      res as unknown as Response,
    );

    expect(repository.setQuestionState).toHaveBeenCalledWith({
      gameId: '507f1f77bcf86cd799439017',
      questionId: '507f1f77bcf86cd799439018',
      state: 'closed',
    });
    expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'question.closed',
        isFinalRound: true,
      }),
    );
    expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'question.result' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  describe('POST /api/games/:gameId/state', () => {
    it('returns 400 when gameId is not a valid ObjectId', async () => {
      const res = createResponseMock();

      await controller.setGameState('bad-id', { state: 'lobby' }, res as unknown as Response);

      expect(repository.setGameState).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when state is not a valid lifecycle state', async () => {
      const res = createResponseMock();

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'bogus' },
        res as unknown as Response,
      );

      expect(repository.setGameState).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('transitions game to lobby and emits game.opened to controllers', async () => {
      const res = createResponseMock();
      repository.setGameState.mockResolvedValue({ gameId: '507f1f77bcf86cd799439011', state: 'lobby' });
      repository.getBindingsByGameId.mockResolvedValue(['white', 'red']);

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'lobby' },
        res as unknown as Response,
      );

      expect(repository.setGameState).toHaveBeenCalledWith({
        gameId: '507f1f77bcf86cd799439011',
        state: 'lobby',
      });
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'game.state.changed', state: 'lobby' }),
      );
      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['white', 'red'],
        expect.objectContaining({ type: 'game.opened' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('transitions game to active and emits game.started to controllers', async () => {
      const res = createResponseMock();
      repository.setGameState.mockResolvedValue({ gameId: '507f1f77bcf86cd799439011', state: 'active' });
      repository.getBindingsByGameId.mockResolvedValue(['white']);
      repository.openNextQuestionForGame.mockResolvedValue('507f1f77bcf86cd799439015');

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'active' },
        res as unknown as Response,
      );

      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['white'],
        expect.objectContaining({ type: 'game.started' }),
      );
      expect(repository.openNextQuestionForGame).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['white'],
        expect.objectContaining({
          type: 'question.opened',
          questionId: '507f1f77bcf86cd799439015',
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('emits enriched per-pair game.ended when game completes', async () => {
      const res = createResponseMock();
      repository.setGameState.mockResolvedValue({
        gameId: '507f1f77bcf86cd799439011',
        state: 'completed',
      });
      repository.getBindingsByGameId.mockResolvedValue(['green', 'white']);
      repository.getGameScores.mockResolvedValue({
        gameId: '507f1f77bcf86cd799439011',
        scores: [
          { pairName: 'green', correct: 3, total: 4 },
          { pairName: 'white', correct: 1, total: 4 },
        ],
      });

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'completed' },
        res as unknown as Response,
      );

      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['green'],
        expect.objectContaining({
          type: 'game.ended',
          pairName: 'green',
          isWinner: true,
          rank: 1,
          score: 3,
        }),
      );
      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['white'],
        expect.objectContaining({
          type: 'game.ended',
          pairName: 'white',
          isWinner: false,
          rank: 2,
          score: 1,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('emits isWinner false when all scores are zero', async () => {
      const res = createResponseMock();
      repository.setGameState.mockResolvedValue({
        gameId: '507f1f77bcf86cd799439011',
        state: 'completed',
      });
      repository.getBindingsByGameId.mockResolvedValue(['power-cable']);
      repository.getGameScores.mockResolvedValue({
        gameId: '507f1f77bcf86cd799439011',
        scores: [{ pairName: 'power-cable', correct: 0, total: 2 }],
      });

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'completed' },
        res as unknown as Response,
      );

      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['power-cable'],
        expect.objectContaining({
          type: 'game.ended',
          pairName: 'power-cable',
          isWinner: false,
          rank: 1,
          score: 0,
        }),
      );
    });

    it('emits game.ready to controllers when draft is opened to ready', async () => {
      const res = createResponseMock();
      repository.setGameState.mockResolvedValue({
        gameId: '507f1f77bcf86cd799439011',
        state: 'ready',
      });
      repository.getBindingsByGameId.mockResolvedValue(['green']);

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'ready' },
        res as unknown as Response,
      );

      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['green'],
        expect.objectContaining({ type: 'game.ready' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('emits game.ready to controllers on Play Again', async () => {
      const res = createResponseMock();
      repository.setGameState.mockResolvedValue({
        gameId: '507f1f77bcf86cd799439011',
        state: 'ready',
      });
      repository.getBindingsByGameId.mockResolvedValue(['green']);

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'ready' },
        res as unknown as Response,
      );

      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'game.state.changed', state: 'ready' }),
      );
      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['green'],
        expect.objectContaining({ type: 'game.ready' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('maps repository setGameState errors to 400', async () => {
      const res = createResponseMock();
      repository.setGameState.mockRejectedValue(new Error("Cannot transition game from 'lobby' to 'lobby'."));

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'lobby' },
        res as unknown as Response,
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
