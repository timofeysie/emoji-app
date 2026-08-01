import type { Response } from 'express';
import { PairBindingsController } from './pair-bindings.controller';
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

describe('PairBindingsController', () => {
  const repository: jest.Mocked<
    Pick<
      GameDataRepository,
      'bindPair' | 'getBinding' | 'markJoined' | 'setPairReadyForNextQuestion'
    >
  > = {
    bindPair: jest.fn(),
    getBinding: jest.fn(),
    markJoined: jest.fn(),
    setPairReadyForNextQuestion: jest.fn(),
  };

  const badgeStateService: jest.Mocked<Pick<BadgeStateService, 'broadcastDashboard'>> = {
    broadcastDashboard: jest.fn(),
  };

  const controller = new PairBindingsController(
    repository as unknown as GameDataRepository,
    badgeStateService as unknown as BadgeStateService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/games/:gameId/pairs', () => {
    it('returns 400 when gameId is not a valid ObjectId', async () => {
      const res = createResponseMock();

      await controller.bindPair('not-an-objectid', { pairName: 'white' }, res as unknown as Response);

      expect(repository.bindPair).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when pairName is missing', async () => {
      const res = createResponseMock();

      await controller.bindPair('507f1f77bcf86cd799439011', {}, res as unknown as Response);

      expect(repository.bindPair).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 201 on successful bind', async () => {
      const res = createResponseMock();
      repository.bindPair.mockResolvedValue(undefined);

      await controller.bindPair(
        '507f1f77bcf86cd799439011',
        { pairName: 'white' },
        res as unknown as Response,
      );

      expect(repository.bindPair).toHaveBeenCalledWith({
        pairName: 'white',
        gameId: '507f1f77bcf86cd799439011',
        controllerId: undefined,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('GET /api/pairs/:pairName', () => {
    it('returns 404 when binding is not found', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue(null);

      await controller.getBinding('white', res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 200 with the binding snapshot when found', async () => {
      const res = createResponseMock();
      const snapshot = {
        pairName: 'white',
        controllerId: 'zero-1',
        gameId: '507f1f77bcf86cd799439011',
        state: 'lobby' as const,
        joined: false,
        readyForNextQuestion: null,
        openQuestionId: null,
        roundsComplete: false,
      };
      repository.getBinding.mockResolvedValue(snapshot);

      await controller.getBinding('white', res as unknown as Response);

      expect(repository.getBinding).toHaveBeenCalledWith('white');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(snapshot);
    });
  });

  describe('POST /api/games/:gameId/join', () => {
    it('returns 400 when gameId is not a valid ObjectId', async () => {
      const res = createResponseMock();

      await controller.joinGame('bad-id', { pairName: 'white' }, res as unknown as Response);

      expect(repository.markJoined).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when pairName is missing', async () => {
      const res = createResponseMock();

      await controller.joinGame('507f1f77bcf86cd799439011', {}, res as unknown as Response);

      expect(repository.markJoined).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('marks the pair as joined and broadcasts controller.joined', async () => {
      const res = createResponseMock();
      repository.markJoined.mockResolvedValue(undefined);

      await controller.joinGame(
        '507f1f77bcf86cd799439011',
        { pairName: 'white' },
        res as unknown as Response,
      );

      expect(repository.markJoined).toHaveBeenCalledWith('white');
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'controller.joined',
          gameId: '507f1f77bcf86cd799439011',
          pairName: 'white',
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('POST /api/games/:gameId/readiness', () => {
    it('records and broadcasts readiness between questions', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue({
        pairName: 'white',
        controllerId: 'zero-1',
        gameId: '507f1f77bcf86cd799439011',
        state: 'active',
        joined: true,
        readyForNextQuestion: null,
        openQuestionId: null,
        roundsComplete: false,
      });
      repository.setPairReadyForNextQuestion.mockResolvedValue(true);

      await controller.setReadiness(
        '507f1f77bcf86cd799439011',
        { pairName: 'white', controllerId: 'zero-1', ready: true },
        res as unknown as Response,
      );

      expect(repository.setPairReadyForNextQuestion).toHaveBeenCalledWith({
        gameId: '507f1f77bcf86cd799439011',
        pairName: 'white',
        ready: true,
      });
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'controller.readiness.changed',
          pairName: 'white',
          ready: true,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true, ready: true });
    });

    it('rejects readiness while a question is open', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue({
        pairName: 'white',
        controllerId: 'zero-1',
        gameId: '507f1f77bcf86cd799439011',
        state: 'active',
        joined: true,
        readyForNextQuestion: null,
        openQuestionId: '507f1f77bcf86cd799439012',
        roundsComplete: false,
      });

      await controller.setReadiness(
        '507f1f77bcf86cd799439011',
        { pairName: 'white', ready: false },
        res as unknown as Response,
      );

      expect(repository.setPairReadyForNextQuestion).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });
});
