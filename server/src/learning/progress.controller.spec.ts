import type { Response } from 'express';
import { PlayerRepository } from '../persistence/player.repository';
import { taggedAnswer } from '../test/leitner-statements';
import { LearningProgressController } from './progress.controller';

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

const PLAYER_ID = '507f1f77bcf86cd7994390aa';
const EXTERNAL_ID = '7f3a2c1e-0000-4000-8000-000000000000';
const player = { id: PLAYER_ID, firstName: 'Mia', externalId: EXTERNAL_ID, label: 'Player 7F3A' };

describe('LearningProgressController', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const repository: jest.Mocked<Pick<PlayerRepository, 'getPlayer'>> = { getPlayer: jest.fn() };
  const controller = new LearningProgressController(repository as unknown as PlayerRepository);

  beforeEach(() => {
    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    process.env['XAPI_LRS_KEY'] = 'key';
    process.env['XAPI_LRS_SECRET'] = 'secret';
    repository.getPlayer.mockResolvedValue(player);
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

  it("returns the chapter's tracks from this student's statements", async () => {
    const fetchMock = lrsReturns([
      taggedAnswer({ id: 'a', word: '시험', sense: 'test', success: true, timestamp: '2026-10-22T18:00:00Z' }),
    ]);
    const res = createResponseMock();

    await controller.getProgress(
      PLAYER_ID,
      { chapter: '27', now: '2026-10-23T09:00:00Z' },
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.player).toEqual({ id: PLAYER_ID, label: 'Player 7F3A' });
    expect(body).not.toHaveProperty('player.firstName');
    expect(body.tracks).toHaveLength(28);
    expect(body.summary).toMatchObject({ new: 27, active: { L1: 1 } });
    expect(body.tracks.find((track: { word: string; aspect: string }) => track.word === '시험' && track.aspect === 'reading')).toMatchObject({
      level: 1,
      gloss: 'test, exam',
      due: false,
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(JSON.parse(url.searchParams.get('agent')!).account.name).toBe(EXTERNAL_ID);
    expect(url.searchParams.get('activity')).toBe('https://kogs.link/xapi/emoji-app/content/korean-language-book');
  });

  it('adds tracks from other played chapters for review scope', async () => {
    lrsReturns([
      taggedAnswer({
        id: 'a',
        word: '독감',
        sense: 'flu',
        success: false,
        chapter: '26',
        sourceRef: 'ch26/vocabulary/0',
        timestamp: '2026-10-20T18:00:00Z',
      }),
    ]);
    const res = createResponseMock();

    await controller.getProgress(PLAYER_ID, { chapter: '27', scope: 'review' }, res as unknown as Response);

    const review = res.json.mock.calls[0][0].tracks.filter((track: { inChapter: boolean }) => !track.inChapter);
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ word: '독감', gloss: 'flu', level: 0, due: true });
  });

  it('rejects a bad player id or query', async () => {
    const res = createResponseMock();
    await controller.getProgress('nope', { chapter: 'x', scope: 'all', extra: 1 }, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 for an unknown chapter or player', async () => {
    const chapterRes = createResponseMock();
    await controller.getProgress(PLAYER_ID, { chapter: '99' }, chapterRes as unknown as Response);
    expect(chapterRes.status).toHaveBeenCalledWith(404);

    lrsReturns([]);
    repository.getPlayer.mockResolvedValue(null);
    const playerRes = createResponseMock();
    await controller.getProgress(PLAYER_ID, { chapter: '27' }, playerRes as unknown as Response);
    expect(playerRes.status).toHaveBeenCalledWith(404);
  });

  it('returns 503 when the LRS is not configured, without failing the app', async () => {
    delete process.env['XAPI_LRS_ENDPOINT'];
    const res = createResponseMock();
    await controller.getProgress(PLAYER_ID, { chapter: '27' }, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 502 when the LRS request fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'no' }) as unknown as typeof fetch;
    const res = createResponseMock();
    await controller.getProgress(PLAYER_ID, { chapter: '27' }, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'The LRS request failed', status: 401 });
  });
});
