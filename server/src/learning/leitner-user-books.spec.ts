import type { Response } from 'express';
import type { AuthedRequest } from '../auth';
import { ChapterDraftsService } from '../content/chapter-drafts.service';
import type { LearnerService } from '../learner.service';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import type { RefereeRequest } from '../referee.guard';
import { draftOf, memoryBooks, OWNER, storyPayload } from '../test/library-fixtures';
import { assessedStatement } from '../test/leitner-statements';
import { EXT_SOURCE_REF } from './learning-object';
import { YallaPracticeController } from '../yalla/yalla-practice.controller';
import { BookContentService } from './book-content.service';
import { foldTracks, observationsFromStatements } from './leitner';
import { LeitnerGamesController } from './leitner-games.controller';
import { LeitnerPlanner } from './leitner-planner';
import { LearningProgressService } from './learning-progress.service';

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

const BOOK = 'rabbit-stories-1a2b';
const PLAYER = { id: '507f1f77bcf86cd7994390aa', firstName: 'Mia', externalId: '7f3a2c1e-0000-4000-8000-000000000000', label: 'Player 7F3A' };
const NOW = '2026-11-22T09:00:00Z';

/**
 * H3 (docs/hashbrown/creating-games-with-hashbrown.md → Leitner and YALLA on
 * user books): a published library chapter plans like a built-in one, its
 * questions carry the user book and the shared learning objects, and a
 * reused sense keeps one track whichever book taught it.
 */
describe('Leitner on a library chapter', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const games = { listLeitnerGamesForPlayer: jest.fn(), deleteGame: jest.fn(), createLeitnerGame: jest.fn() };
  const players = { getPlayer: jest.fn() };
  const learner = { resolveLearner: jest.fn() };
  let content: BookContentService;
  let leitnerGames: LeitnerGamesController;
  let practice: YallaPracticeController;
  let progress: LearningProgressService;
  /** What the LRS returns for the student; POSTed statements are added. */
  let lrs: unknown[];

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    process.env['XAPI_LRS_KEY'] = 'key';
    process.env['XAPI_LRS_SECRET'] = 'secret';
    games.listLeitnerGamesForPlayer.mockResolvedValue([]);
    games.createLeitnerGame.mockResolvedValue('6650f00000000000000000f0');
    players.getPlayer.mockResolvedValue(PLAYER);
    learner.resolveLearner.mockResolvedValue({ user: { id: OWNER }, player: PLAYER });
    lrs = [];
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        lrs.push(...JSON.parse(String(init.body)));
        return { ok: true, status: 200, text: async () => '[]' };
      }
      return { ok: true, status: 200, json: async () => ({ statements: lrs, more: '' }) };
    }) as unknown as typeof fetch;

    const memory = memoryBooks();
    content = new BookContentService(memory.repo);
    await new ChapterDraftsService(memory.repo, content).publish(
      draftOf(storyPayload({ newBook: { title: 'Rabbit stories', slug: BOOK } })),
      OWNER,
    );
    const planner = new LeitnerPlanner(games as unknown as GameDataRepository, content);
    leitnerGames = new LeitnerGamesController(players as unknown as PlayerRepository, games as unknown as GameDataRepository, planner);
    practice = new YallaPracticeController(learner as unknown as LearnerService, planner, content);
    progress = new LearningProgressService(games as unknown as GameDataRepository, content);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  async function createGame(body: Record<string, unknown>): Promise<{ status: number; body: Json }> {
    const res = createResponseMock();
    await leitnerGames.createLeitnerGame(
      { playerId: PLAYER.id, book: BOOK, chapter: '1', now: NOW, ...body },
      res as unknown as Response,
      { refereeUserId: OWNER } as RefereeRequest,
    );
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  it('creates a badge game whose questions are tagged with the user book and the shared learning objects', async () => {
    const { status } = await createGame({ maxNew: 6, count: 12, seed: 3 });

    expect(status).toBe(201);
    const created = games.createLeitnerGame.mock.calls[0][0];
    expect(created.title).toBe(`Leitner: Player 7F3A · ${BOOK} ch. 1`);
    expect(created.leitner).toMatchObject({ book: BOOK, chapter: '1' });
    const tags = created.questions.map((question: Json) => question.learning);
    expect(new Set(tags.map((tag: Json) => tag.book))).toEqual(new Set([BOOK]));
    // The reused sense keeps the registry's id; the new ones are language-scoped too.
    expect(tags.find((tag: Json) => tag.target === '시험')).toMatchObject({
      learningObjectId: 'ko/lexeme/시험/test',
      sourceRef: 'ch1/vocabulary/0',
    });
    expect(tags.find((tag: Json) => tag.target === '토끼')?.learningObjectId).toBe('ko/lexeme/토끼/rabbit');
  });

  it('a dry run is a plan only, and an unknown chapter of the book is a 404', async () => {
    const { status, body } = await createGame({ dryRun: true });
    expect(status).toBe(200);
    expect(body.plan.book).toBe(BOOK);
    expect(body.plan.questions.length).toBeGreaterThan(0);
    expect(games.createLeitnerGame).not.toHaveBeenCalled();

    expect((await createGame({ chapter: '9', dryRun: true })).status).toBe(404);
  });

  it('a reused sense answered in the built-in book is the same track on the library chapter', async () => {
    lrs.push(
      assessedStatement({ id: 'a1', word: '시험', sense: 'test', aspect: 'reading', success: true, timestamp: '2026-11-22T06:00:00Z' }),
    );

    const chapter = await progress.forChapter(PLAYER, { book: BOOK, chapter: '1', scope: 'chapter', aspects: ['reading'], now: new Date(NOW) });
    const exam = chapter.tracks.find((track) => track.learningObjectId === 'ko/lexeme/시험/test');
    expect(exam).toMatchObject({ level: 1, status: 'active', due: false, word: '시험' });
    expect(chapter.tracks.filter((track) => track.status === 'new')).toHaveLength(5);

    // The planner sees the same track: 시험 is not new here, and isn't asked while it isn't due.
    const { body } = await createGame({ dryRun: true, aspects: ['reading'], maxNew: 6, fill: false });
    expect(body.plan.picks.map((pick: Json) => pick.word)).toEqual(['토끼', '거북이', '경주', '언덕', '낮잠']);
    const filled = await createGame({ dryRun: true, aspects: ['reading'], maxNew: 6 });
    expect(filled.body.plan.picks.find((pick: Json) => pick.word === '시험')).toMatchObject({ level: 1, status: 'active' });
  });

  it('YALLA practice on the library chapter records yalla-solo evidence on the same tracks', async () => {
    const req = { auth: { sub: 'sub-1', username: 'mia' } } as AuthedRequest;
    const sessionRes = createResponseMock();
    await practice.createSession(req, { book: BOOK, chapter: 1, count: 12, maxNew: 6, aspects: ['reading'] }, sessionRes as unknown as Response);
    expect(sessionRes.status).toHaveBeenCalledWith(200);
    const session: Json = sessionRes.json.mock.calls[0][0];
    expect(session.book).toBe(BOOK);
    const exam = session.items.find((item: Json) => item.word === '시험');

    const resultsRes = createResponseMock();
    await practice.postResults(
      req,
      {
        sessionId: '2f1b6a2e-8c3d-4e5f-9a0b-1c2d3e4f5a6b',
        attempts: [
          {
            attemptId: 'a1',
            itemId: exam.itemId,
            book: BOOK,
            sourceRef: exam.sourceRef,
            learningObjectId: exam.learningObjectId,
            aspect: exam.aspect,
            channel: 'onscreen-choice',
            options: exam.options,
            response: exam.answer,
            answeredAt: new Date().toISOString(),
          },
        ],
      },
      resultsRes as unknown as Response,
    );
    expect(resultsRes.status).toHaveBeenCalledWith(200);

    const assessed = lrs.find((statement: Json) => statement.verb.id.endsWith('/assessed')) as Json;
    expect(assessed.object.id).toMatch(/\/ko\/lexeme\/%EC%8B%9C%ED%97%98\/test$|\/ko\/lexeme\/시험\/test$/);
    expect(assessed.context.extensions[EXT_SOURCE_REF]).toBe(`${BOOK}/ch1/vocabulary/0`);
    const tracks = foldTracks(observationsFromStatements(lrs, 'ko'));
    expect(tracks.find((track) => track.learningObjectId === 'ko/lexeme/시험/test')).toMatchObject({ aspect: 'reading', level: 1 });
  });

  it('asks the library chapter’s patterns as usage clozes on their linked entries (H4c)', async () => {
    const { status } = await createGame({ aspects: ['usage'], count: 10, seed: 2 });

    expect(status).toBe(201);
    const questions = games.createLeitnerGame.mock.calls[0][0].questions;
    expect(questions.map((question: Json) => [question.learning.learningObjectId, question.learning.sourceRef])).toEqual([
      ['ko/grammar-pattern/at-eot-eoyo/did-polite', 'ch1/patterns/0'],
      ['ko/grammar-pattern/eu-myeon/if', 'ch1/patterns/1'],
    ]);
    const ifWhen = questions[1];
    expect(ifWhen.learning).toMatchObject({ book: BOOK, aspect: 'usage', target: '-(으)면', native: 'if, when' });
    expect(ifWhen.text).toBe('토끼가 자___ 거북이가 이겨요. (If the rabbit sleeps, the turtle wins.)');
    // Two patterns of its own aren't enough endings: the built-in book lends the rest, never another -(으)면.
    const options = ifWhen.answerOptions.map((option: Json) => option.text);
    expect(options).toHaveLength(4);
    expect(ifWhen.answerOptions.filter((option: Json) => option.isCorrect).map((option: Json) => option.text)).toEqual(['면']);
    expect(options.filter((text: string) => text === '면')).toHaveLength(1);

    const chapter = await progress.forChapter(PLAYER, { book: BOOK, chapter: '1', scope: 'chapter', aspects: ['usage'], now: new Date(NOW) });
    expect(chapter.tracks.map((track) => [track.learningObjectId, track.word])).toEqual([
      ['ko/grammar-pattern/at-eot-eoyo/did-polite', '-았/었어요'],
      ['ko/grammar-pattern/eu-myeon/if', '-(으)면'],
    ]);
  });

  it('a wrong learning object for the user book’s sourceRef is refused', async () => {
    const req = { auth: { sub: 'sub-1', username: 'mia' } } as AuthedRequest;
    const res = createResponseMock();
    await practice.postResults(
      req,
      {
        sessionId: '2f1b6a2e-8c3d-4e5f-9a0b-1c2d3e4f5a6b',
        attempts: [
          {
            attemptId: 'a1',
            itemId: '1',
            book: BOOK,
            sourceRef: 'ch1/vocabulary/0',
            learningObjectId: 'ko/lexeme/토끼/rabbit',
            aspect: 'reading',
            channel: 'keyboard',
            response: 'test',
            answeredAt: new Date().toISOString(),
          },
        ],
      },
      res as unknown as Response,
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
