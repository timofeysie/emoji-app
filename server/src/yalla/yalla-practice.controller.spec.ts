import { ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthedRequest } from '../auth';
import { LearnerService } from '../learner.service';
import { foldTracks, observationsFromStatements } from '../learning/leitner';
import { EXT_GAME_KIND, EXT_INPUT_CHANNEL } from '../learning/learning-object';
import { LeitnerPlanner } from '../learning/leitner-planner';
import { GameDataRepository } from '../persistence/game-data.repository';
import { YallaPracticeController } from './yalla-practice.controller';

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
const SESSION_ID = '2f1b6a2e-8c3d-4e5f-9a0b-1c2d3e4f5a6b';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON bodies, checked by the assertions
type Json = any;

describe('YallaPracticeController', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const games = { listLeitnerGamesForPlayer: jest.fn(), deleteGame: jest.fn(), createLeitnerGame: jest.fn() };
  const learner = { resolveLearner: jest.fn() };
  const controller = new YallaPracticeController(
    learner as unknown as LearnerService,
    new LeitnerPlanner(games as unknown as GameDataRepository),
  );
  /** Every statement POSTed to the LRS, in order. */
  let sent: Json[];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    process.env['XAPI_LRS_KEY'] = 'key';
    process.env['XAPI_LRS_SECRET'] = 'secret';
    games.listLeitnerGamesForPlayer.mockResolvedValue([]);
    learner.resolveLearner.mockResolvedValue({ user: USER, player: PLAYER });
    sent = [];
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        sent.push(...JSON.parse(String(init.body)));
        return { ok: true, status: 200, text: async () => '[]' };
      }
      return { ok: true, status: 200, json: async () => ({ statements: [], more: '' }) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  async function session(body: Record<string, unknown>): Promise<{ status: number; body: Json }> {
    const res = createResponseMock();
    await controller.createSession(req, body, res as unknown as Response);
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  async function results(body: Record<string, unknown>): Promise<{ status: number; body: Json }> {
    const res = createResponseMock();
    await controller.postResults(req, body, res as unknown as Response);
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  /** An attempt on a planned item, answering `slot` (default: the right one). */
  function attemptOn(item: Json, slot: string = item.answer, extra: Record<string, unknown> = {}) {
    return {
      attemptId: `a${item.itemId}`,
      itemId: item.itemId,
      book: 'korean-language-book',
      sourceRef: item.sourceRef,
      learningObjectId: item.learningObjectId,
      aspect: item.aspect,
      channel: 'onscreen-choice',
      options: item.options,
      response: slot,
      answeredAt: new Date().toISOString(),
      ...extra,
    };
  }

  function wrongSlot(item: Json): string {
    return item.options.find((option: Json) => option.slotLabel !== item.answer).slotLabel;
  }

  it('plans a session like a badge game, stores nothing, and gives each item its A–D options and answer', async () => {
    const { status, body } = await session({ chapter: 27 });

    expect(status).toBe(200);
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.items).toHaveLength(10);
    for (const item of body.items) {
      expect(item.options.map((option: Json) => option.slotLabel)).toEqual(['A', 'B', 'C', 'D']);
      expect(['A', 'B', 'C', 'D']).toContain(item.answer);
      expect(item.reason).toBe('new');
    }
    expect(new Set(body.items.map((item: Json) => item.learningObjectId)).size).toBe(10);
    expect(games.createLeitnerGame).not.toHaveBeenCalled();
    expect(games.deleteGame).not.toHaveBeenCalled();
  });

  it('refuses to plan while a badge game waits for export (409), and needs a linked player (403)', async () => {
    games.listLeitnerGamesForPlayer.mockResolvedValue([
      { id: '6650f00000000000000000f0', state: 'completed', endedAt: null, exportError: null },
    ]);
    const pending = await session({ chapter: 27 });
    expect(pending.status).toBe(409);
    expect(pending.body.pendingExport).toHaveLength(1);

    learner.resolveLearner.mockRejectedValue(new ForbiddenException({ error: 'No linked player' }));
    await expect(session({ chapter: 27 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records answers as yalla-solo evidence that the fold counts', async () => {
    const { body: planned } = await session({ chapter: 27, count: 2 });
    const [right, wrong] = planned.items;

    const { status, body } = await results({
      sessionId: SESSION_ID,
      attempts: [attemptOn(right), attemptOn(wrong, wrongSlot(wrong))],
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      sent: 4,
      results: [
        { attemptId: `a${right.itemId}`, correct: true },
        { attemptId: `a${wrong.itemId}`, correct: false },
      ],
    });
    expect(sent).toHaveLength(4);
    for (const statement of sent) {
      expect(statement.actor.account.name).toBe(PLAYER.externalId);
      expect(statement.context.registration).toBe(SESSION_ID);
      expect(statement.context.extensions[EXT_GAME_KIND]).toBe('yalla-solo');
      expect(statement.context.extensions[EXT_INPUT_CHANNEL]).toBe('onscreen-choice');
    }

    const tracks = foldTracks(observationsFromStatements(sent, 'ko'));
    const track = (item: Json) =>
      tracks.find((t) => t.learningObjectId === item.learningObjectId && t.aspect === item.aspect);
    expect(track(right)).toMatchObject({ status: 'active', level: 1, lastResult: 'correct' });
    expect(track(wrong)).toMatchObject({ status: 'active', level: 0, lastResult: 'incorrect' });
  });

  it('gives the same statement ids when the outbox re-posts, so the LRS keeps one copy', async () => {
    const { body: planned } = await session({ chapter: 27, count: 1 });
    const attempt = attemptOn(planned.items[0]);
    await results({ sessionId: SESSION_ID, attempts: [attempt] });
    await results({ sessionId: SESSION_ID, attempts: [attempt] });

    expect(sent).toHaveLength(4);
    expect(sent.slice(2)).toEqual(sent.slice(0, 2));
  });

  it('ignores a tampered correct flag and rejects options that do not match the content', async () => {
    const { body: planned } = await session({ chapter: 27, count: 1 });
    const [item] = planned.items;

    const tampered = await results({
      sessionId: SESSION_ID,
      attempts: [attemptOn(item, wrongSlot(item), { correct: true })],
    });
    expect(tampered.body.results[0].correct).toBe(false);
    expect(sent[0].result.success).toBe(false);
    expect(sent[1].result.success).toBe(false);

    sent = [];
    const answerText = item.options.find((option: Json) => option.slotLabel === item.answer).text;
    const allRight = item.options.map((option: Json) => ({ ...option, text: answerText }));
    expect((await results({ sessionId: SESSION_ID, attempts: [attemptOn(item, 'A', { options: allRight })] })).status).toBe(422);
    const noneRight = item.options.map((option: Json, index: number) => ({ ...option, text: `wrong ${index}` }));
    expect((await results({ sessionId: SESSION_ID, attempts: [attemptOn(item, 'A', { options: noneRight })] })).status).toBe(422);
    expect(
      (await results({ sessionId: SESSION_ID, attempts: [attemptOn(item, item.answer, { learningObjectId: 'ko/lexeme/독감/flu' })] }))
        .status,
    ).toBe(422);
    expect(sent).toHaveLength(0);
  });

  /** A typed attempt on a planned item. */
  function typedOn(item: Json, response: string, extra: Record<string, unknown> = {}) {
    const attempt: Record<string, unknown> = { ...attemptOn(item), channel: 'keyboard', response, ...extra };
    delete attempt['options'];
    return attempt;
  }

  it('checks typed answers on the server: writing wants the Korean, reading the whole gloss', async () => {
    const { body: planned } = await session({ chapter: 27, count: 4 });
    const writing = planned.items.filter((item: Json) => item.aspect === 'writing');
    const reading = planned.items.filter((item: Json) => item.aspect === 'reading');
    expect(writing.length).toBeGreaterThanOrEqual(1);
    expect(reading.length).toBeGreaterThanOrEqual(1);

    const attempts = [
      // Jamo one at a time (NFD) and stray spaces still match the composed word.
      typedOn(writing[0], ` ${writing[0].word.normalize('NFD')} `),
      // The gloss in full is right; the client's "correct" on a wrong answer is ignored.
      typedOn(reading[0], reading[0].gloss),
      { ...typedOn(reading[0], 'not it', { correct: true }), attemptId: 'r-wrong' },
      { ...typedOn(writing[0], ''), attemptId: 'w-dont-know' },
    ];
    const { status, body } = await results({ sessionId: SESSION_ID, attempts });

    expect(status).toBe(200);
    expect(body.results.map((result: Json) => result.correct)).toEqual([true, true, false, false]);

    const [writingAnswered] = sent;
    expect(writingAnswered.object.definition).toEqual({
      type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
      name: { 'en-US': writing[0].gloss },
      interactionType: 'fill-in',
      correctResponsesPattern: [writing[0].word],
    });
    // The response is kept as typed, for the activity view.
    expect(writingAnswered.result.response).toBe(` ${writing[0].word.normalize('NFD')} `);
    expect(sent.filter((_statement, index) => index % 2 === 1).map((assessed) => assessed.context.extensions[EXT_INPUT_CHANNEL])).toEqual([
      'keyboard',
      'keyboard',
      'keyboard',
      'keyboard',
    ]);
  });

  it.each([
    ['a time a month ago', { answeredAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }, 422],
    ['a time in the future', { answeredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, 422],
    ['a keyboard answer with options', { channel: 'keyboard' }, 400],
    ['a choice answer that is not a slot', { response: 'test' }, 400],
    ['an unknown field', { extra: 1 }, 400],
  ])('rejects an attempt with %s', async (_label, change, expectedStatus) => {
    const { body: planned } = await session({ chapter: 27, count: 1 });
    sent = [];
    const { status } = await results({ sessionId: SESSION_ID, attempts: [attemptOn(planned.items[0], undefined, change)] });
    expect(status).toBe(expectedStatus);
    expect(sent).toHaveLength(0);
  });

  it('returns 503 without an LRS and 502 when the LRS refuses', async () => {
    const { body: planned } = await session({ chapter: 27, count: 1 });
    const attempts = [attemptOn(planned.items[0])];

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'down' }) as unknown as typeof fetch;
    expect((await results({ sessionId: SESSION_ID, attempts })).status).toBe(502);

    delete process.env['XAPI_LRS_ENDPOINT'];
    expect((await results({ sessionId: SESSION_ID, attempts })).status).toBe(503);
    expect((await session({ chapter: 27 })).status).toBe(503);
  });
});
