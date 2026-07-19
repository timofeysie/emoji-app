import type { Response } from 'express';
import { GameFlowController } from './game-flow.controller';
import { GameDataRepository } from './persistence/game-data.repository';
import { BadgeStateService } from './badge-state.service';

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
    assignNfcCardGroupToGame: jest.fn(),
    submitGuess: jest.fn(),
    bindPair: jest.fn(),
    getBinding: jest.fn(),
    markJoined: jest.fn(),
    getBindingsByGameId: jest.fn(),
    computeQuestionResult: jest.fn(),
    getGameScores: jest.fn(),
  } as unknown as jest.Mocked<GameDataRepository>;

  const badgeStateService: jest.Mocked<Pick<BadgeStateService, 'broadcastDashboard' | 'sendToPairNames'>> = {
    broadcastDashboard: jest.fn(),
    sendToPairNames: jest.fn(),
  };

  const controller = new GameFlowController(
    repository,
    badgeStateService as unknown as BadgeStateService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
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

    expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'question.closed' }),
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
    });

    await controller.submitGuess(
      {
        gameId: '507f1f77bcf86cd799439017',
        questionId: '507f1f77bcf86cd799439018',
        pairName: 'white',
        cardUid: 'CARD-UID-A-001',
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
      }),
    );
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

      await controller.setGameState(
        '507f1f77bcf86cd799439011',
        { state: 'active' },
        res as unknown as Response,
      );

      expect(badgeStateService.sendToPairNames).toHaveBeenCalledWith(
        ['white'],
        expect.objectContaining({ type: 'game.started' }),
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
