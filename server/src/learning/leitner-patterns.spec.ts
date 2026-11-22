import type { Response } from 'express';
import type { AuthedRequest } from '../auth';
import type { LearnerService } from '../learner.service';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import type { RefereeRequest } from '../referee.guard';
import { builtInBookContent } from '../test/book-content';
import { YallaPracticeController } from '../yalla/yalla-practice.controller';
import { foldTracks, observationsFromStatements } from './leitner';
import { LeitnerGamesController } from './leitner-games.controller';
import { LeitnerPlanner } from './leitner-planner';
import { LearningProgressService } from './learning-progress.service';
import { EXT_ASPECT, EXT_SOURCE_REF } from './learning-object';

jest.mock('../referee.guard', () => ({
  RefereeGuard: class {},
  refereeUserIdOf: (req: { refereeUserId?: string }) => req.refereeUserId,
}));
jest.mock('../auth.guard', () => ({ AuthGuard: class {} }));

type ResponseMock = Pick<Response, 'status' | 'json'> & { status: jest.Mock; json: jest.Mock };

function createResponseMock(): ResponseMock {
  const response = { status: jest.fn(), json: jest.fn() } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON bodies, checked by the assertions
type Json = any;

const PLAYER = { id: '507f1f77bcf86cd7994390aa', firstName: 'Mia', externalId: '7f3a2c1e-0000-4000-8000-000000000000', label: 'Player 7F3A' };
const REFEREE = '000000000000000000000001';
const NOW = '2026-11-22T09:00:00Z';
const CH27_PATTERNS = [
  'ko/grammar-pattern/a-eo-jida/become',
  'ko/grammar-pattern/ne/noticing',
  'ko/grammar-pattern/eu-myeonandoeda/must-not',
  'ko/grammar-pattern/eu-l-geotgatda/seems',
];
const req = { auth: { sub: 'sub-1', username: 'mia' } } as AuthedRequest;

/**
 * H4b (docs/yalla/grammar-learning-objects.md): grammar patterns as Leitner
 * tracks with the `usage` aspect, asked as cloze questions in badge games
 * and YALLA practice, for the built-in book.
 */
describe('Leitner on grammar patterns', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const games = { listLeitnerGamesForPlayer: jest.fn(), deleteGame: jest.fn(), createLeitnerGame: jest.fn() };
  const players = { getPlayer: jest.fn() };
  const learner = { resolveLearner: jest.fn() };
  const content = builtInBookContent();
  const planner = new LeitnerPlanner(games as unknown as GameDataRepository, content);
  const leitnerGames = new LeitnerGamesController(players as unknown as PlayerRepository, games as unknown as GameDataRepository, planner);
  const practice = new YallaPracticeController(learner as unknown as LearnerService, planner, content);
  const progress = new LearningProgressService(games as unknown as GameDataRepository, content);
  /** What the LRS returns; POSTed statements are added. */
  let lrs: Json[];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    process.env['XAPI_LRS_KEY'] = 'key';
    process.env['XAPI_LRS_SECRET'] = 'secret';
    games.listLeitnerGamesForPlayer.mockResolvedValue([]);
    games.createLeitnerGame.mockResolvedValue('6650f00000000000000000f0');
    players.getPlayer.mockResolvedValue(PLAYER);
    learner.resolveLearner.mockResolvedValue({ user: { id: REFEREE }, player: PLAYER });
    lrs = [];
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        lrs.push(...JSON.parse(String(init.body)));
        return { ok: true, status: 200, text: async () => '[]' };
      }
      return { ok: true, status: 200, json: async () => ({ statements: lrs, more: '' }) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  async function createGame(body: Record<string, unknown>): Promise<{ status: number; body: Json }> {
    const res = createResponseMock();
    await leitnerGames.createLeitnerGame(
      { playerId: PLAYER.id, chapter: '27', now: NOW, ...body },
      res as unknown as Response,
      { refereeUserId: REFEREE } as RefereeRequest,
    );
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  async function session(body: Record<string, unknown>): Promise<Json> {
    const res = createResponseMock();
    await practice.createSession(req, body, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(200);
    return res.json.mock.calls[0][0];
  }

  async function results(attempts: Json[]): Promise<{ status: number; body: Json }> {
    const res = createResponseMock();
    await practice.postResults(req, { sessionId: '2f1b6a2e-8c3d-4e5f-9a0b-1c2d3e4f5a6b', attempts }, res as unknown as Response);
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  it('asks a chapter’s patterns as usage cloze questions, tagged with the registry entry', async () => {
    const { status, body } = await createGame({ aspects: ['usage'], count: 10, seed: 4 });

    expect(status).toBe(201);
    expect(body.plan.picks.map((pick: Json) => [pick.learningObjectId, pick.aspect])).toEqual(
      CH27_PATTERNS.map((id) => [id, 'usage']),
    );
    const created = games.createLeitnerGame.mock.calls[0][0];
    const become = created.questions.find((q: Json) => q.learning.learningObjectId === CH27_PATTERNS[0]);
    expect(become.learning).toEqual({
      learningObjectId: 'ko/grammar-pattern/a-eo-jida/become',
      book: 'korean-language-book',
      sourceRef: 'ch27/patterns/0',
      aspect: 'usage',
      target: '-아/어/여지다',
      native: 'gets to be, becomes',
    });
    expect(become.text).toMatch(/^계속 더 .+___\. \(.+\)$/);
    expect(become.answerOptions.filter((o: Json) => o.isCorrect).map((o: Json) => o.text)).toEqual(['지네']);
    expect(become.answerOptions.map((o: Json) => o.slotLabel)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('mixes words and patterns, giving words only reading/writing and patterns only usage', async () => {
    const { body } = await createGame({ aspects: ['reading', 'writing', 'usage'], dryRun: true, count: 20, maxNew: 20 });
    const picks: Json[] = body.plan.picks;
    const patternPicks = picks.filter((pick) => pick.learningObjectId.includes('/grammar-pattern/'));
    expect(patternPicks.length).toBeGreaterThan(0);
    expect(patternPicks.every((pick) => pick.aspect === 'usage')).toBe(true);
    expect(picks.filter((pick) => !pick.learningObjectId.includes('/grammar-pattern/')).every((pick) => pick.aspect !== 'usage')).toBe(true);
    // A new student's chapter-only game (maxNew 4) still meets a pattern early.
    const { body: small } = await createGame({ aspects: ['reading', 'writing', 'usage'], dryRun: true, count: 10, maxNew: 4 });
    expect(small.plan.picks.some((pick: Json) => pick.aspect === 'usage')).toBe(true);
  });

  it('shows pattern tracks in progress with their headword, and no usage tracks for words', async () => {
    const chapter = await progress.forChapter(PLAYER, {
      book: 'korean-language-book',
      chapter: '27',
      scope: 'chapter',
      aspects: ['reading', 'usage'],
      now: new Date(NOW),
    });
    const usage = chapter.tracks.filter((track) => track.aspect === 'usage');
    expect(usage.map((track) => track.learningObjectId)).toEqual(CH27_PATTERNS);
    expect(usage[0]).toMatchObject({ kind: 'grammar-pattern', word: '-아/어/여지다', gloss: 'gets to be, becomes', status: 'new' });
    expect(chapter.tracks.filter((track) => track.aspect === 'reading').every((track) => !track.learningObjectId.includes('/grammar-pattern/'))).toBe(true);
    expect(chapter.byAspect['usage']).toMatchObject({ total: 4, new: 4 });
  });

  it('records a YALLA cloze answer as usage evidence on the pattern, re-checked against the sentence', async () => {
    const planned = await session({ chapter: 27, aspects: ['usage'], count: 4 });
    expect(planned.items).toHaveLength(4);
    const item = planned.items.find((candidate: Json) => candidate.learningObjectId === CH27_PATTERNS[0]);
    expect(item).toMatchObject({ aspect: 'usage', sourceRef: 'ch27/patterns/0', word: '-아/어/여지다' });
    expect(item.sentence).toMatch(/^(example|sample\/\d|exercise\/\d)$/);

    const attempt = {
      attemptId: 'a1',
      itemId: item.itemId,
      book: 'korean-language-book',
      sourceRef: item.sourceRef,
      learningObjectId: item.learningObjectId,
      aspect: 'usage',
      sentence: item.sentence,
      channel: 'onscreen-choice',
      options: item.options,
      response: item.answer,
      answeredAt: new Date().toISOString(),
    };
    const { status, body } = await results([attempt]);
    expect(status).toBe(200);
    expect(body.results).toEqual([{ attemptId: 'a1', correct: true }]);

    const assessed = lrs.find((statement) => statement.verb.id.endsWith('/assessed'));
    expect(assessed.object.id).toBe('https://kogs.link/xapi/emoji-app/lo/ko/grammar-pattern/a-eo-jida/become');
    expect(assessed.object.definition.type).toBe('https://kogs.link/xapi/emoji-app/activity-types/grammar-pattern');
    expect(assessed.context.extensions[EXT_ASPECT]).toBe('usage');
    expect(assessed.context.extensions[EXT_SOURCE_REF]).toBe('korean-language-book/ch27/patterns/0');
    expect(foldTracks(observationsFromStatements(lrs, 'ko'))).toEqual([
      expect.objectContaining({ learningObjectId: CH27_PATTERNS[0], aspect: 'usage', level: 1 }),
    ]);
  });

  it('refuses a cloze answer typed, on the wrong sentence, or tagged as a word', async () => {
    const planned = await session({ chapter: 27, aspects: ['usage'], count: 1 });
    const [item] = planned.items;
    const base = {
      attemptId: 'a1',
      itemId: item.itemId,
      book: 'korean-language-book',
      sourceRef: item.sourceRef,
      learningObjectId: item.learningObjectId,
      aspect: 'usage',
      sentence: item.sentence,
      answeredAt: new Date().toISOString(),
    };
    const choice = { channel: 'onscreen-choice', options: item.options, response: item.answer };

    expect((await results([{ ...base, channel: 'keyboard', response: '지네' }])).body.error).toMatch(/multiple choice only/);
    expect((await results([{ ...base, ...choice, sentence: 'sample/9' }])).body.error).toMatch(/sentence/);
    expect((await results([{ ...base, ...choice, aspect: 'reading' }])).status).toBe(422);
    expect(lrs).toEqual([]);
  });
});
