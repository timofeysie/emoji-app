import type { Response } from 'express';
import type { ContentDraftRecord, ContentDraftRepository } from '../persistence/content-draft.repository';
import type { GameDataRepository } from '../persistence/game-data.repository';
import type { RefereeRequest } from '../referee.guard';
import { ContentDraftsController } from './content-drafts.controller';
import type { GameDraftPayload } from './game-draft';

// The real guard loads `auth.ts` (ESM-only `jose`); handlers are called directly here.
jest.mock('../referee.guard', () => ({
  RefereeGuard: class {},
  refereeUserIdOf: (req: { refereeUserId?: string }) => req.refereeUserId,
}));

type ResponseMock = Pick<Response, 'status' | 'json'> & { status: jest.Mock; json: jest.Mock };

function createResponseMock(): ResponseMock {
  const response = { status: jest.fn(), json: jest.fn() } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

const OWNER = '000000000000000000000001';
const OTHER = '000000000000000000000002';
const DRAFT_ID = '6650f00000000000000000d1';
const SOURCE_ID = '6650f00000000000000000a1';
const GAME_ID = '6650f00000000000000000f0';

const payload: GameDraftPayload = {
  title: 'Story quiz: 토끼와 거북이',
  language: { target: 'ko', native: 'en' },
  questions: [
    {
      text: 'What does 토끼 mean?',
      focus: 'vocabulary',
      options: [
        { text: 'rabbit', isCorrect: true },
        { text: 'turtle', isCorrect: false },
        { text: 'race', isCorrect: false },
        { text: 'hill', isCorrect: false },
      ],
      sourceExcerpt: '토끼와 거북이가 경주를 했어요.',
    },
  ],
};

function draftRecord(overrides: Partial<ContentDraftRecord> = {}): ContentDraftRecord {
  return {
    id: DRAFT_ID,
    ownerUserId: OWNER,
    type: 'game',
    sourceId: SOURCE_ID,
    title: payload.title,
    payload,
    settings: { mix: 'vocabulary', questionCount: 10, optionsPerQuestion: 4 },
    problems: [],
    status: 'draft',
    shared: false,
    lastEditedByUserId: OWNER,
    resultGameId: null,
    remixedFromGameId: null,
    revision: 3,
    createdAt: '2026-11-21T09:00:00.000Z',
    updatedAt: '2026-11-21T09:00:00.000Z',
    ...overrides,
  };
}

describe('ContentDraftsController', () => {
  const drafts: jest.Mocked<
    Pick<ContentDraftRepository, 'ensureSource' | 'getSource' | 'createDraft' | 'getDraft' | 'listDrafts' | 'updateDraft' | 'deleteDraft'>
  > = {
    ensureSource: jest.fn(),
    getSource: jest.fn(),
    createDraft: jest.fn(),
    getDraft: jest.fn(),
    listDrafts: jest.fn(),
    updateDraft: jest.fn(),
    deleteDraft: jest.fn(),
  };
  const games: jest.Mocked<Pick<GameDataRepository, 'createGameWithQuestions' | 'getGameForDraft' | 'deleteGame'>> = {
    createGameWithQuestions: jest.fn(),
    getGameForDraft: jest.fn(),
    deleteGame: jest.fn(),
  };
  const controller = new ContentDraftsController(
    drafts as unknown as ContentDraftRepository,
    games as unknown as GameDataRepository,
  );

  const as = (userId: string) => ({ refereeUserId: userId }) as RefereeRequest;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON bodies, checked by the assertions
  async function call(fn: (res: Response) => Promise<void>): Promise<{ status: number; body: any }> {
    const res = createResponseMock();
    await fn(res as unknown as Response);
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    drafts.getDraft.mockResolvedValue(draftRecord());
    drafts.getSource.mockResolvedValue({
      id: SOURCE_ID,
      ownerUserId: OWNER,
      language: { target: 'ko', native: 'en' },
      title: '',
      raw: '옛날 옛적에 토끼와 거북이가 살았어요.',
      createdAt: '2026-11-21T09:00:00.000Z',
    });
    drafts.ensureSource.mockResolvedValue(SOURCE_ID);
    drafts.createDraft.mockImplementation(async (input) =>
      draftRecord({ ...input, revision: 1, sourceId: input.sourceId, remixedFromGameId: input.remixedFromGameId ?? null }),
    );
    drafts.updateDraft.mockImplementation(async ({ revision, changes }) =>
      draftRecord({ ...changes, revision: revision + 1 } as Partial<ContentDraftRecord>),
    );
    games.createGameWithQuestions.mockResolvedValue(GAME_ID);
  });

  describe('create', () => {
    it('keeps the pasted text as a source and starts an empty draft with the default settings', async () => {
      const { status, body } = await call((res) =>
        controller.createDraft({ type: 'game', source: { text: '  옛날 옛적에 …  ' } }, res, as(OWNER)),
      );
      expect(status).toBe(201);
      expect(drafts.ensureSource).toHaveBeenCalledWith({
        ownerUserId: OWNER,
        raw: '옛날 옛적에 …',
        language: { target: 'ko', native: 'en' },
      });
      expect(drafts.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: OWNER,
          sourceId: SOURCE_ID,
          payload: null,
          settings: { mix: 'vocabulary', questionCount: 10, optionsPerQuestion: 4 },
          problems: [{ path: 'questions', message: 'No questions yet' }],
        }),
      );
      expect(body.draft.revision).toBe(1);
    });

    it('refuses pasted text over 8,000 characters and chapter drafts (H2)', async () => {
      expect((await call((res) => controller.createDraft({ type: 'game', source: { text: 'x'.repeat(8001) } }, res, as(OWNER)))).status).toBe(400);
      expect((await call((res) => controller.createDraft({ type: 'chapter' }, res, as(OWNER)))).status).toBe(400);
    });

    it('duplicates any class game into a draft of the caller’s own, keeping its source', async () => {
      games.getGameForDraft.mockResolvedValue({
        id: GAME_ID,
        title: 'Story quiz',
        kind: 'class',
        contentSourceId: SOURCE_ID,
        questions: payload.questions.map(({ text, options }) => ({ text, options })),
      });
      const { status } = await call((res) => controller.createDraft({ type: 'game', fromGameId: GAME_ID }, res, as(OTHER)));
      expect(status).toBe(201);
      expect(drafts.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: OTHER,
          sourceId: SOURCE_ID,
          title: 'Story quiz (copy)',
          remixedFromGameId: GAME_ID,
          settings: { mix: 'vocabulary', questionCount: 1, optionsPerQuestion: 4 },
        }),
      );
    });

    it('won’t duplicate a Leitner game', async () => {
      games.getGameForDraft.mockResolvedValue({ id: GAME_ID, title: 'L', kind: 'leitner-solo', contentSourceId: null, questions: [] });
      const { status } = await call((res) => controller.createDraft({ type: 'game', fromGameId: GAME_ID }, res, as(OWNER)));
      expect(status).toBe(400);
      expect(drafts.createDraft).not.toHaveBeenCalled();
    });
  });

  describe('access', () => {
    it('hides a private draft from everyone but its owner', async () => {
      expect((await call((res) => controller.getDraft(DRAFT_ID, res, as(OTHER)))).status).toBe(404);
      const { status, body } = await call((res) => controller.getDraft(DRAFT_ID, res, as(OWNER)));
      expect(status).toBe(200);
      expect(body.draft.mine).toBe(true);
      expect(body.source).toEqual({ text: '옛날 옛적에 토끼와 거북이가 살았어요.', language: { target: 'ko', native: 'en' } });
    });

    it('lets anyone open and edit a shared draft, but only the owner share, delete or accept it', async () => {
      drafts.getDraft.mockResolvedValue(draftRecord({ shared: true }));
      expect((await call((res) => controller.getDraft(DRAFT_ID, res, as(OTHER)))).body.draft.mine).toBe(false);
      expect((await call((res) => controller.updateDraft(DRAFT_ID, { revision: 3, payload }, res, as(OTHER)))).status).toBe(200);
      expect(drafts.updateDraft).toHaveBeenCalledWith(expect.objectContaining({ editorUserId: OTHER }));
      expect((await call((res) => controller.shareDraft(DRAFT_ID, { shared: false }, res, as(OTHER)))).status).toBe(403);
      expect((await call((res) => controller.deleteDraft(DRAFT_ID, res, as(OTHER)))).status).toBe(403);
      expect((await call((res) => controller.acceptDraft(DRAFT_ID, { revision: 3 }, res, as(OTHER)))).status).toBe(403);
      expect(drafts.deleteDraft).not.toHaveBeenCalled();
      expect(games.createGameWithQuestions).not.toHaveBeenCalled();
    });

    it('treats a malformed id as not found', async () => {
      expect((await call((res) => controller.getDraft('nope', res, as(OWNER)))).status).toBe(404);
      expect(drafts.getDraft).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('saves the payload with its title and problems, against the revision it was made from', async () => {
      const broken = { ...payload, questions: [{ ...payload.questions[0], options: payload.questions[0].options.map((o) => ({ ...o, isCorrect: true })) }] };
      const { status } = await call((res) => controller.updateDraft(DRAFT_ID, { revision: 3, payload: broken }, res, as(OWNER)));
      expect(status).toBe(200);
      expect(drafts.updateDraft).toHaveBeenCalledWith({
        draftId: DRAFT_ID,
        revision: 3,
        editorUserId: OWNER,
        changes: {
          payload: broken,
          title: payload.title,
          problems: [{ path: 'questions.0.options', message: 'Question 1 has 4 correct options (exactly 1 needed)' }],
        },
      });
    });

    it('refuses an edit made against an old revision, and sends the current draft', async () => {
      drafts.updateDraft.mockResolvedValue(null);
      const { status, body } = await call((res) => controller.updateDraft(DRAFT_ID, { revision: 2, payload }, res, as(OWNER)));
      expect(status).toBe(409);
      expect(body.draft.revision).toBe(3);
    });

    it('won’t change an accepted draft', async () => {
      drafts.getDraft.mockResolvedValue(draftRecord({ status: 'accepted', resultGameId: GAME_ID }));
      expect((await call((res) => controller.updateDraft(DRAFT_ID, { revision: 3, payload }, res, as(OWNER)))).status).toBe(409);
      expect(drafts.updateDraft).not.toHaveBeenCalled();
    });

    it('refuses a payload of the wrong shape', async () => {
      const { status } = await call((res) =>
        controller.updateDraft(DRAFT_ID, { revision: 3, payload: { title: 'x', questions: 'ten' } }, res, as(OWNER)),
      );
      expect(status).toBe(400);
    });
  });

  describe('accept', () => {
    it('creates the class game with its questions and marks the draft accepted', async () => {
      const { status, body } = await call((res) => controller.acceptDraft(DRAFT_ID, { revision: 3 }, res, as(OWNER)));
      expect(status).toBe(201);
      expect(body.gameId).toBe(GAME_ID);
      expect(games.createGameWithQuestions).toHaveBeenCalledWith({
        title: payload.title,
        createdByUserId: OWNER,
        origin: { kind: 'ai-draft', contentSourceId: SOURCE_ID, draftId: DRAFT_ID, remixedFromGameId: null },
        questions: [
          {
            text: 'What does 토끼 mean?',
            sequence: 1,
            mode: 'standard',
            answerOptions: [
              { text: 'rabbit', sequence: 1, slotLabel: 'A', isCorrect: true },
              { text: 'turtle', sequence: 2, slotLabel: 'B', isCorrect: false },
              { text: 'race', sequence: 3, slotLabel: 'C', isCorrect: false },
              { text: 'hill', sequence: 4, slotLabel: 'D', isCorrect: false },
            ],
          },
        ],
      });
      expect(drafts.updateDraft).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 3, changes: { status: 'accepted', resultGameId: GAME_ID, shared: false } }),
      );
    });

    it('refuses a draft with problems, whatever the client checked', async () => {
      const twoCorrect = { ...payload, questions: [{ ...payload.questions[0], options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] }] };
      drafts.getDraft.mockResolvedValue(draftRecord({ payload: twoCorrect, problems: [] }));
      const { status, body } = await call((res) => controller.acceptDraft(DRAFT_ID, { revision: 3 }, res, as(OWNER)));
      expect(status).toBe(400);
      expect(body.problems).toEqual([{ path: 'questions.0.options', message: 'Question 1 has 2 correct options (exactly 1 needed)' }]);
      expect(games.createGameWithQuestions).not.toHaveBeenCalled();
    });

    it('refuses an old revision, and removes the game when the draft changed while it was made', async () => {
      expect((await call((res) => controller.acceptDraft(DRAFT_ID, { revision: 2 }, res, as(OWNER)))).status).toBe(409);
      expect(games.createGameWithQuestions).not.toHaveBeenCalled();

      drafts.updateDraft.mockResolvedValue(null);
      expect((await call((res) => controller.acceptDraft(DRAFT_ID, { revision: 3 }, res, as(OWNER)))).status).toBe(409);
      expect(games.deleteGame).toHaveBeenCalledWith(GAME_ID);
    });

    it('records the game a duplicate came from', async () => {
      drafts.getDraft.mockResolvedValue(draftRecord({ remixedFromGameId: '6650f00000000000000000f9' }));
      await call((res) => controller.acceptDraft(DRAFT_ID, { revision: 3 }, res, as(OWNER)));
      expect(games.createGameWithQuestions).toHaveBeenCalledWith(
        expect.objectContaining({ origin: expect.objectContaining({ remixedFromGameId: '6650f00000000000000000f9' }) }),
      );
    });
  });

  it('lists the caller’s drafts, or the ones others shared', async () => {
    drafts.listDrafts.mockResolvedValue([]);
    await call((res) => controller.listDrafts(undefined, res, as(OWNER)));
    await call((res) => controller.listDrafts('true', res, as(OWNER)));
    expect(drafts.listDrafts.mock.calls).toEqual([[{ userId: OWNER, shared: false }], [{ userId: OWNER, shared: true }]]);
  });
});
