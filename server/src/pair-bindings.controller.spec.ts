import type { Response } from 'express';
import { PairBindingsController } from './pair-bindings.controller';
import { GameDataRepository, PairBindingSnapshot } from './persistence/game-data.repository';
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

const GAME_ID = '507f1f77bcf86cd799439011';

function snapshot(overrides: Partial<PairBindingSnapshot> = {}): PairBindingSnapshot {
  return {
    pairName: 'white',
    stationName: 'white',
    controllerId: 'zero-1',
    gameId: GAME_ID,
    state: 'active',
    joined: true,
    readyForNextQuestion: null,
    openQuestionId: null,
    roundsComplete: false,
    players: [],
    ...overrides,
  };
}

describe('PairBindingsController', () => {
  const repository: jest.Mocked<
    Pick<
      GameDataRepository,
      'bindStation' | 'getBinding' | 'markJoined' | 'setPairReadyForNextQuestion'
    >
  > = {
    bindStation: jest.fn(),
    getBinding: jest.fn(),
    markJoined: jest.fn(),
    setPairReadyForNextQuestion: jest.fn(),
  };

  const badgeStateService: jest.Mocked<
    Pick<BadgeStateService, 'broadcastDashboard' | 'getStationRoster' | 'findRosterConflicts'>
  > = {
    broadcastDashboard: jest.fn(),
    getStationRoster: jest.fn(),
    findRosterConflicts: jest.fn(),
  };

  const controller = new PairBindingsController(
    repository as unknown as GameDataRepository,
    badgeStateService as unknown as BadgeStateService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    badgeStateService.getStationRoster.mockReturnValue(null);
    badgeStateService.findRosterConflicts.mockReturnValue([]);
  });

  describe('POST /api/games/:gameId/pairs', () => {
    it('returns 400 when gameId is not a valid ObjectId', async () => {
      const res = createResponseMock();

      await controller.bindPair('not-an-objectid', { pairName: 'white' }, res as unknown as Response);

      expect(repository.bindStation).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when pairName is missing', async () => {
      const res = createResponseMock();

      await controller.bindPair(GAME_ID, {}, res as unknown as Response);

      expect(repository.bindStation).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('binds a Mode 1 station as one player', async () => {
      const res = createResponseMock();
      repository.bindStation.mockResolvedValue(['white']);

      await controller.bindPair(GAME_ID, { pairName: 'white' }, res as unknown as Response);

      expect(repository.bindStation).toHaveBeenCalledWith({
        stationName: 'white',
        badgeNames: ['white'],
        gameId: GAME_ID,
        controllerId: undefined,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ ok: true, badgeNames: ['white'] });
    });

    it('binds one player per badge in the live station roster', async () => {
      const res = createResponseMock();
      const roster = ['white', 'white-2', 'white-3'];
      badgeStateService.getStationRoster.mockReturnValue(roster);
      repository.bindStation.mockResolvedValue(roster);

      await controller.bindPair(GAME_ID, { pairName: 'white' }, res as unknown as Response);

      expect(badgeStateService.getStationRoster).toHaveBeenCalledWith('white');
      expect(repository.bindStation).toHaveBeenCalledWith(
        expect.objectContaining({ stationName: 'white', badgeNames: roster }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('prefers badgeNames from the body over the live roster', async () => {
      const res = createResponseMock();
      badgeStateService.getStationRoster.mockReturnValue(['white', 'white-2', 'white-3']);
      repository.bindStation.mockResolvedValue(['white', 'white-2']);

      await controller.bindPair(
        GAME_ID,
        { pairName: 'white', badgeNames: ['white', 'white-2'] },
        res as unknown as Response,
      );

      expect(repository.bindStation).toHaveBeenCalledWith(
        expect.objectContaining({ badgeNames: ['white', 'white-2'] }),
      );
    });

    it('returns 409 when a roster name belongs to another station', async () => {
      const res = createResponseMock();
      badgeStateService.getStationRoster.mockReturnValue(['white', 'red-2']);
      badgeStateService.findRosterConflicts.mockReturnValue(['red-2']);

      await controller.bindPair(GAME_ID, { pairName: 'white' }, res as unknown as Response);

      expect(badgeStateService.findRosterConflicts).toHaveBeenCalledWith('white', [
        'white',
        'red-2',
      ]);
      expect(repository.bindStation).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ badgeNames: ['red-2'] }),
      );
    });
  });

  describe('GET /api/pairs/:pairName', () => {
    it('returns 404 when binding is not found', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue(null);

      await controller.getBinding('white', res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 200 with the station snapshot when found', async () => {
      const res = createResponseMock();
      const found = snapshot({
        state: 'lobby',
        joined: false,
        players: [
          {
            badgeName: 'white',
            joined: false,
            readyForNextQuestion: null,
            guessed: false,
            slotLabel: null,
            isCorrect: null,
          },
        ],
      });
      repository.getBinding.mockResolvedValue(found);

      await controller.getBinding('white', res as unknown as Response);

      expect(repository.getBinding).toHaveBeenCalledWith('white');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(found);
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

      await controller.joinGame(GAME_ID, {}, res as unknown as Response);

      expect(repository.markJoined).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('joins a Mode 1 station as its single player', async () => {
      const res = createResponseMock();
      repository.markJoined.mockResolvedValue(['white']);

      await controller.joinGame(GAME_ID, { pairName: 'white' }, res as unknown as Response);

      expect(repository.markJoined).toHaveBeenCalledWith({
        gameId: GAME_ID,
        stationName: 'white',
        badgeNames: ['white'],
      });
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledTimes(1);
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'controller.joined',
          gameId: GAME_ID,
          pairName: 'white',
          badgeName: 'white',
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true, joined: ['white'] });
    });

    it('joins only the listed badges and emits controller.joined per badge', async () => {
      const res = createResponseMock();
      repository.markJoined.mockResolvedValue(['white', 'white-2']);

      await controller.joinGame(
        GAME_ID,
        { pairName: 'white', controllerId: 'zero-1', badgeNames: ['white', 'white-2'] },
        res as unknown as Response,
      );

      expect(repository.markJoined).toHaveBeenCalledWith({
        gameId: GAME_ID,
        stationName: 'white',
        badgeNames: ['white', 'white-2'],
      });
      const joinedBadges = badgeStateService.broadcastDashboard.mock.calls.map(
        ([event]) => (event as Record<string, unknown>)['badgeName'],
      );
      expect(joinedBadges).toEqual(['white', 'white-2']);
      expect(res.json).toHaveBeenCalledWith({ ok: true, joined: ['white', 'white-2'] });
    });
  });

  describe('POST /api/games/:gameId/readiness', () => {
    it('records and broadcasts readiness between questions', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue(snapshot());
      repository.setPairReadyForNextQuestion.mockResolvedValue(['white']);

      await controller.setReadiness(
        GAME_ID,
        { pairName: 'white', controllerId: 'zero-1', ready: true },
        res as unknown as Response,
      );

      expect(repository.setPairReadyForNextQuestion).toHaveBeenCalledWith({
        gameId: GAME_ID,
        stationName: 'white',
        badgeNames: ['white'],
        ready: true,
      });
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'controller.readiness.changed',
          pairName: 'white',
          badgeName: 'white',
          ready: true,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true, ready: true, badgeNames: ['white'] });
    });

    it('records readiness per badge for a multi-badge station', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue(snapshot());
      repository.setPairReadyForNextQuestion.mockResolvedValue(['white', 'white-2']);

      await controller.setReadiness(
        GAME_ID,
        { pairName: 'white', ready: false, badgeNames: ['white', 'white-2', 'white-3'] },
        res as unknown as Response,
      );

      expect(repository.setPairReadyForNextQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ badgeNames: ['white', 'white-2', 'white-3'], ready: false }),
      );
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledTimes(2);
      expect(badgeStateService.broadcastDashboard).toHaveBeenCalledWith(
        expect.objectContaining({ badgeName: 'white-2', ready: false }),
      );
    });

    it('returns 409 when no listed badge is joined', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue(snapshot());
      repository.setPairReadyForNextQuestion.mockResolvedValue([]);

      await controller.setReadiness(
        GAME_ID,
        { pairName: 'white', ready: true },
        res as unknown as Response,
      );

      expect(badgeStateService.broadcastDashboard).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('rejects readiness while a question is open', async () => {
      const res = createResponseMock();
      repository.getBinding.mockResolvedValue(
        snapshot({ openQuestionId: '507f1f77bcf86cd799439012' }),
      );

      await controller.setReadiness(
        GAME_ID,
        { pairName: 'white', ready: false },
        res as unknown as Response,
      );

      expect(repository.setPairReadyForNextQuestion).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });
});
