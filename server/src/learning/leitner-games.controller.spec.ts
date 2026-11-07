import type { Response } from 'express';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import { assessedStatement } from '../test/leitner-statements';
import chapter26 from '../games/content/chapter26Data.json';
import { firstSense, termsFromChapter } from '../games/generators/vocab-choice';
import { LeitnerGamesController } from './leitner-games.controller';

type ResponseMock = Pick<Response, 'status' | 'json'> & { status: jest.Mock; json: jest.Mock };

function createResponseMock(): ResponseMock {
  const response = { status: jest.fn(), json: jest.fn() } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

const PLAYER_ID = '507f1f77bcf86cd7994390aa';
const CREATOR_ID = '000000000000000000000001';
const player = { id: PLAYER_ID, firstName: 'Mia', externalId: '7f3a2c1e-0000-4000-8000-000000000000', label: 'Player 7F3A' };
const NOW = '2026-10-23T09:00:00Z';

describe('LeitnerGamesController', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const players: jest.Mocked<Pick<PlayerRepository, 'getPlayer'>> = { getPlayer: jest.fn() };
  const games: jest.Mocked<Pick<GameDataRepository, 'listLeitnerGamesForPlayer' | 'deleteGame' | 'createLeitnerGame'>> = {
    listLeitnerGamesForPlayer: jest.fn(),
    deleteGame: jest.fn(),
    createLeitnerGame: jest.fn(),
  };
  const controller = new LeitnerGamesController(
    players as unknown as PlayerRepository,
    games as unknown as GameDataRepository,
  );

  function lrsReturns(statements: unknown[]): jest.Mock {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ statements, more: '' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON bodies, checked by the assertions
  async function post(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const res = createResponseMock();
    await controller.createLeitnerGame(body, res as unknown as Response);
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    process.env['XAPI_LRS_KEY'] = 'key';
    process.env['XAPI_LRS_SECRET'] = 'secret';
    players.getPlayer.mockResolvedValue(player);
    games.listLeitnerGamesForPlayer.mockResolvedValue([]);
    games.createLeitnerGame.mockResolvedValue('6650f00000000000000000f0');
    lrsReturns([]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('plans a dry run for a new student: 10 new ch. 27 words, tagged, nothing created', async () => {
    const { status, body } = await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true, now: NOW });

    expect(status).toBe(200);
    const { plan } = body;
    expect(plan.picks.map((pick: { word: string; aspect: string; reason: string }) => [pick.word, pick.aspect, pick.reason])).toEqual([
      ['정도', 'reading', 'new'],
      ['시험', 'writing', 'new'],
      ['수업', 'reading', 'new'],
      ['빠지다', 'writing', 'new'],
      ['필기하다', 'reading', 'new'],
      ['보여 주다', 'writing', 'new'],
      ['양호실', 'reading', 'new'],
      ['쉬다', 'writing', 'new'],
      ['괜찮다', 'reading', 'new'],
      ['고맙다', 'writing', 'new'],
    ]);
    expect(plan.questions).toHaveLength(10);
    expect(plan.questions[0].options).toHaveLength(4);
    expect(plan.report).toMatchObject({ available: { new: 28 }, picked: { new: 10 }, short: false });
    expect(plan.supersedes).toEqual([]);
    expect(games.createLeitnerGame).not.toHaveBeenCalled();
  });

  it('creates the game with tagged questions and the plan, titled with the label, and supersedes unplayed games', async () => {
    games.listLeitnerGamesForPlayer.mockResolvedValue([
      { id: 'old-draft', state: 'draft', endedAt: null, guessCount: 0, exportError: null },
    ]);
    const { status, body } = await post({ playerId: PLAYER_ID, chapter: '27', createdByUserId: CREATOR_ID, now: NOW, seed: 5 });

    expect(status).toBe(201);
    expect(body.gameId).toBe('6650f00000000000000000f0');
    expect(games.deleteGame).toHaveBeenCalledWith('old-draft');
    const created = games.createLeitnerGame.mock.calls[0][0];
    expect(created.title).toBe('Leitner: Player 7F3A · ch. 27');
    expect(created.title).not.toContain('Mia');
    expect(created.leitner).toMatchObject({ playerId: PLAYER_ID, book: 'korean-language-book', chapter: '27', scope: 'chapter', seed: 5 });
    expect(created.leitner.picks).toHaveLength(10);
    expect(created.questions.map((q: { sequence: number }) => q.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const exam = created.questions.find((q) => q.learning?.learningObjectId === 'ko/lexeme/시험/test');
    expect(exam?.learning).toEqual({
      learningObjectId: 'ko/lexeme/시험/test',
      book: 'korean-language-book',
      sourceRef: 'ch27/vocabulary/1',
      aspect: 'writing',
      target: '시험',
      native: 'test, exam',
    });
  });

  it('is deterministic for the same seed and time', async () => {
    const first = await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true, now: NOW });
    const second = await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true, now: NOW });
    expect(second.body).toEqual(first.body);
  });

  it('puts overdue words first, from this student’s evidence', async () => {
    const fetchMock = lrsReturns([
      assessedStatement({ id: 'a', word: '시험', sense: 'test', aspect: 'reading', success: false, timestamp: '2026-10-22T18:00:00Z' }),
    ]);
    const { body } = await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true, now: NOW });

    expect(body.plan.picks[0]).toMatchObject({ learningObjectId: 'ko/lexeme/시험/test', aspect: 'reading', reason: 'overdue', level: 0 });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(JSON.parse(url.searchParams.get('agent')!).account.name).toBe(player.externalId);
  });

  it('brings due words from another played chapter for review scope, with that chapter’s distractors', async () => {
    lrsReturns([
      assessedStatement({
        id: 'a',
        word: '독감',
        sense: 'flu',
        success: false,
        chapter: '26',
        sourceRef: 'ch26/vocabulary/0',
        timestamp: '2026-10-20T18:00:00Z',
      }),
    ]);
    const chapterOnly = await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true, now: NOW });
    expect(chapterOnly.body.plan.picks.some((pick: { word: string }) => pick.word === '독감')).toBe(false);

    const { body } = await post({ playerId: PLAYER_ID, chapter: 27, scope: 'review', dryRun: true, now: NOW });
    expect(body.plan.picks[0]).toMatchObject({ word: '독감', reason: 'review', sourceRef: 'ch26/vocabulary/0', chapter: '26' });
    const question = body.plan.questions.find((q: { learningObjectId: string }) => q.learningObjectId === 'ko/lexeme/독감/flu');
    const ch26Glosses = new Set(termsFromChapter(chapter26).map((term) => firstSense(term.native)));
    expect(question.options.every((option: { text: string }) => ch26Glosses.has(option.text))).toBe(true);
  });

  it('refuses to plan while a game is waiting for export, or being played', async () => {
    games.listLeitnerGamesForPlayer.mockResolvedValue([
      { id: 'done', state: 'completed', endedAt: '2026-10-22T18:00:00.000Z', guessCount: 10, exportError: 'LRS rejected the export' },
    ]);
    const pending = await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true });
    expect(pending.status).toBe(409);
    expect(pending.body.pendingExport).toEqual([{ gameId: 'done', endedAt: '2026-10-22T18:00:00.000Z', error: 'LRS rejected the export' }]);

    games.listLeitnerGamesForPlayer.mockResolvedValue([{ id: 'live', state: 'active', endedAt: null, guessCount: 3, exportError: null }]);
    const inPlay = await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true });
    expect(inPlay.status).toBe(409);
    expect(inPlay.body.inPlay).toEqual(['live']);
  });

  it('returns 422 instead of creating an empty game', async () => {
    // No new words and no fill: a new student has nothing to ask.
    const dry = await post({ playerId: PLAYER_ID, chapter: 27, maxNew: 0, fill: false, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.plan.picks).toEqual([]);

    const created = await post({ playerId: PLAYER_ID, chapter: 27, maxNew: 0, fill: false, createdByUserId: CREATOR_ID });
    expect(created.status).toBe(422);
    expect(games.createLeitnerGame).not.toHaveBeenCalled();
  });

  it.each([
    ['an aspect the generator cannot build', { aspects: ['listening'], dryRun: true }],
    ['a create without createdByUserId', {}],
    ['an unknown field', { dryRun: true, extra: 1 }],
  ])('rejects %s', async (_label, change) => {
    expect((await post({ playerId: PLAYER_ID, chapter: 27, ...change })).status).toBe(400);
  });

  it('returns 404 for an unknown chapter or player, 503 without an LRS', async () => {
    expect((await post({ playerId: PLAYER_ID, chapter: 99, dryRun: true })).status).toBe(404);
    players.getPlayer.mockResolvedValue(null);
    expect((await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true })).status).toBe(404);
    delete process.env['XAPI_LRS_ENDPOINT'];
    expect((await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true })).status).toBe(503);
  });

  it('returns 502 when the LRS read fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'no' }) as unknown as typeof fetch;
    expect((await post({ playerId: PLAYER_ID, chapter: 27, dryRun: true })).status).toBe(502);
  });
});
