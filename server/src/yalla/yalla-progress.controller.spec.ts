import type { Response } from 'express';
import type { AuthedRequest } from '../auth';
import { LearnerService } from '../learner.service';
import { LearningProgressService } from '../learning/learning-progress.service';
import { LearningProgressController } from '../learning/progress.controller';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import { assessedStatement } from '../test/leitner-statements';
import { YallaProgressController } from './yalla-progress.controller';

// The guard is covered in auth.guard.spec.ts; importing the real one needs Cognito env.
jest.mock('../auth.guard', () => ({ AuthGuard: class {} }));

type ResponseMock = Pick<Response, 'status' | 'json'> & { status: jest.Mock; json: jest.Mock };

function createResponseMock(): ResponseMock {
  const response = { status: jest.fn(), json: jest.fn() } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

const PLAYER = {
  id: '507f1f77bcf86cd7994390aa',
  firstName: 'Mia',
  externalId: '7f3a2c1e-0000-4000-8000-000000000000',
  label: 'Player 7F3A',
};
const USER = { id: '507f1f77bcf86cd7994390cc', displayName: 'mia', playerId: PLAYER.id };
const req = { auth: { sub: 'sub-1', username: 'mia' } } as AuthedRequest;
const NOW = '2026-10-23T09:00:00Z';

describe('YallaProgressController', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const games = { listLeitnerGamesForPlayer: jest.fn() };
  const players = { getPlayer: jest.fn() };
  const learner = { resolveLearner: jest.fn() };
  const service = new LearningProgressService(games as unknown as GameDataRepository);
  const controller = new YallaProgressController(learner as unknown as LearnerService, service);

  beforeEach(() => {
    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    process.env['XAPI_LRS_KEY'] = 'key';
    process.env['XAPI_LRS_SECRET'] = 'secret';
    games.listLeitnerGamesForPlayer.mockResolvedValue([]);
    players.getPlayer.mockResolvedValue(PLAYER);
    learner.resolveLearner.mockResolvedValue({ user: USER, player: PLAYER });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function lrsReturns(statements: unknown[]): jest.Mock {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ statements, more: '' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  const evidence = [
    assessedStatement({ id: 'a', word: '시험', sense: 'test', success: true, timestamp: '2026-10-22T18:00:00Z' }),
    assessedStatement({
      id: 'b',
      word: '독감',
      sense: 'flu',
      success: false,
      chapter: '26',
      sourceRef: 'ch26/vocabulary/0',
      timestamp: '2026-10-20T18:00:00Z',
    }),
  ];

  it('returns the same tracks as Players → detail for the linked player', async () => {
    lrsReturns(evidence);
    const players$ = new LearningProgressController(
      players as unknown as PlayerRepository,
      games as unknown as GameDataRepository,
      service,
    );
    const query = { chapter: '27', aspects: 'reading,writing', now: NOW };

    const yalla = createResponseMock();
    await controller.getProgress(req, query, yalla as unknown as Response);
    const player = createResponseMock();
    await players$.getProgress(PLAYER.id, query, player as unknown as Response);

    expect(yalla.status).toHaveBeenCalledWith(200);
    expect(player.status).toHaveBeenCalledWith(200);
    expect(yalla.json.mock.calls[0][0]).toEqual(player.json.mock.calls[0][0]);
    expect(yalla.json.mock.calls[0][0].tracks).toHaveLength(28);
  });

  it('counts the pills per aspect: open = not retired, plus due', async () => {
    lrsReturns(evidence);
    const res = createResponseMock();
    await controller.getProgress(req, { chapter: '27', now: NOW }, res as unknown as Response);

    const body = res.json.mock.calls[0][0];
    expect(body.player).toEqual({ id: PLAYER.id, label: PLAYER.label });
    expect(body).not.toHaveProperty('player.externalId');
    // 14 learning objects; 시험 reading is L1, not due until tomorrow.
    expect(body.byAspect).toEqual({
      reading: { total: 14, open: 14, due: 13, new: 13, retired: 0 },
      writing: { total: 14, open: 14, due: 14, new: 14, retired: 0 },
    });
  });

  it('returns pills for every chapter of the book from one LRS read', async () => {
    const fetchMock = lrsReturns(evidence);
    const res = createResponseMock();
    await controller.getBookProgress(req, { now: NOW }, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.chapters.map((item: { chapter: string }) => item.chapter)).toEqual(['26', '27', '28', '29', '30']);
    const ch26 = body.chapters.find((item: { chapter: string }) => item.chapter === '26');
    const ch27 = body.chapters.find((item: { chapter: string }) => item.chapter === '27');
    expect(ch26.byAspect.reading.new).toBe(ch26.byAspect.reading.total - 1);
    expect(ch27.byAspect.reading).toMatchObject({ total: 14, new: 13, due: 13 });
  });

  it('passes on 403 when no player is linked, without reading the LRS', async () => {
    const fetchMock = lrsReturns([]);
    learner.resolveLearner.mockRejectedValue(new Error('No linked player'));
    await expect(controller.getProgress(req, { chapter: '27' }, createResponseMock() as unknown as Response)).rejects.toThrow(
      'No linked player',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a bad query (and never takes a player id)', async () => {
    const res = createResponseMock();
    await controller.getProgress(req, { chapter: '27', playerId: PLAYER.id }, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(learner.resolveLearner).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown chapter, 503 without an LRS and 502 when it fails', async () => {
    const chapter = createResponseMock();
    await controller.getProgress(req, { chapter: '99' }, chapter as unknown as Response);
    expect(chapter.status).toHaveBeenCalledWith(404);

    delete process.env['XAPI_LRS_ENDPOINT'];
    const missing = createResponseMock();
    await controller.getBookProgress(req, {}, missing as unknown as Response);
    expect(missing.status).toHaveBeenCalledWith(503);

    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'no' }) as unknown as typeof fetch;
    const failed = createResponseMock();
    await controller.getProgress(req, { chapter: '27' }, failed as unknown as Response);
    expect(failed.status).toHaveBeenCalledWith(502);
  });
});
