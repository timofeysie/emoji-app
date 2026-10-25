import { GameDataRepository, type GameExportData } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import { assessedStatement } from '../test/leitner-statements';
import { GameExportService } from './game-export.service';

const GAME_ID = '6650f00000000000000000f0';
const PLAYER_ID = '6650c00000000000000000c0';
const EXTERNAL_ID = '7f3a2c1e-0000-4000-8000-000000000000';
const player = { id: PLAYER_ID, firstName: 'Mia', externalId: EXTERNAL_ID, label: 'Player 7F3A' };

function leitnerGame(overrides: Partial<GameExportData> = {}): GameExportData {
  return {
    id: GAME_ID,
    title: 'Leitner: Player 7F3A · ch. 27',
    kind: 'leitner-solo',
    leitner: { playerId: PLAYER_ID, book: 'korean-language-book', chapter: '27' },
    state: 'completed',
    startedAt: '2026-10-23T09:00:00.000Z',
    endedAt: '2026-10-23T09:10:00.000Z',
    questions: [
      {
        id: 'q1',
        text: '시험',
        openedAt: '2026-10-23T09:01:00.000Z',
        answerOptions: [
          { slotLabel: 'A', text: 'test', isCorrect: true },
          { slotLabel: 'B', text: 'class', isCorrect: false },
        ],
        learning: {
          learningObjectId: 'ko/lexeme/시험/test',
          book: 'korean-language-book',
          sourceRef: 'ch27/vocabulary/1',
          aspect: 'reading',
          target: '시험',
          native: 'test, exam',
        },
      },
    ],
    guesses: [
      { id: 'g1', questionId: 'q1', badgeName: 'red', stationName: 's1', slotLabel: 'A', createdAt: '2026-10-23T09:01:05.000Z' },
    ],
    ...overrides,
  };
}

describe('GameExportService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const games = {
    getGameExportData: jest.fn(),
    getGameScores: jest.fn(),
    deleteGame: jest.fn(),
    recordExportFailure: jest.fn(),
  };
  const players = { getGamePlayerBindings: jest.fn(), getPlayer: jest.fn(), attributeLeitnerGuesses: jest.fn() };
  const service = new GameExportService(games as unknown as GameDataRepository, players as unknown as PlayerRepository);

  /** GET → the student's earlier statements; POST → `postStatus`. */
  function lrs(prior: unknown[], postStatus = 200): jest.Mock {
    const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? { ok: postStatus < 300, status: postStatus, json: async () => [], text: async () => 'nope' }
        : { ok: true, status: 200, json: async () => ({ statements: prior, more: '' }) },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['XAPI_LRS_ENDPOINT'] = 'https://emojiapp-dev.lrs.io/xapi/';
    process.env['XAPI_LRS_KEY'] = 'key';
    process.env['XAPI_LRS_SECRET'] = 'secret';
    games.getGameExportData.mockResolvedValue(leitnerGame());
    games.getGameScores.mockResolvedValue({ gameId: GAME_ID, scores: [{ badgeName: 'red', correct: 1, total: 1 }] });
    players.getGamePlayerBindings.mockResolvedValue({
      missingBadges: [],
      bindings: [{ badgeName: 'red', player, assignedAt: '2026-10-23T08:59:00.000Z', unassignedAt: null }],
    });
    players.getPlayer.mockResolvedValue(player);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("binds the student to a Leitner game's unassigned badge before exporting, but never for class games", async () => {
    lrs([]);
    await service.exportGame(GAME_ID);
    expect(players.attributeLeitnerGuesses).toHaveBeenCalledWith(GAME_ID);
    expect(players.attributeLeitnerGuesses.mock.invocationCallOrder[0]).toBeLessThan(
      players.getGamePlayerBindings.mock.invocationCallOrder[0],
    );

    players.attributeLeitnerGuesses.mockClear();
    games.getGameExportData.mockResolvedValue(leitnerGame({ kind: 'class', leitner: null }));
    await service.exportGame(GAME_ID);
    expect(players.attributeLeitnerGuesses).not.toHaveBeenCalled();
  });

  it('exports a Leitner game, deletes it, and summarises what moved (L10)', async () => {
    const fetchMock = lrs([
      assessedStatement({ id: 'old', word: '시험', sense: 'test', success: false, timestamp: '2026-10-20T18:00:00Z' }),
    ]);

    const outcome = await service.exportGame(GAME_ID);

    expect(outcome).toEqual({
      ok: true,
      statementsSent: 3,
      deleted: true,
      summary: {
        score: { correct: 1, total: 1 },
        changes: [
          {
            learningObjectId: 'ko/lexeme/시험/test',
            aspect: 'reading',
            change: 'promoted',
            from: { level: 0, status: 'active' },
            to: { level: 1, status: 'active' },
          },
        ],
      },
    });
    expect(games.deleteGame).toHaveBeenCalledWith(GAME_ID);
    // Remembered for the student view's end screen.
    expect(service.getFinished(GAME_ID)).toMatchObject({
      gameId: GAME_ID,
      statementsSent: 3,
      summary: { score: { correct: 1, total: 1 } },
    });
    expect(service.getFinished(GAME_ID, Date.now() + 13 * 60 * 60 * 1000)).toBeNull();
    const posted = JSON.parse(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')[1].body);
    expect(posted.map((s: { verb: { id: string } }) => s.verb.id.split('/').pop())).toEqual(['answered', 'assessed', 'scored']);
  });

  it('still exports and deletes when the earlier evidence cannot be read (no change list)', async () => {
    global.fetch = jest.fn().mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? { ok: true, status: 200, json: async () => [] }
        : { ok: false, status: 500, text: async () => 'down' },
    ) as unknown as typeof fetch;

    const outcome = await service.exportGame(GAME_ID);

    expect(outcome).toMatchObject({ ok: true, deleted: true, summary: { score: { correct: 1, total: 1 }, changes: null } });
  });

  it('keeps a Leitner game as pending export when the LRS rejects it', async () => {
    lrs([], 400);

    const outcome = await service.exportGame(GAME_ID);

    expect(outcome).toMatchObject({ ok: false, status: 502 });
    expect(games.deleteGame).not.toHaveBeenCalled();
    expect(games.recordExportFailure).toHaveBeenCalledWith(GAME_ID, 'LRS rejected the export');
  });

  it('never deletes a class game', async () => {
    games.getGameExportData.mockResolvedValue(leitnerGame({ kind: 'class', leitner: null }));
    const fetchMock = lrs([]);

    const outcome = await service.exportGame(GAME_ID);

    expect(outcome).toEqual({ ok: true, statementsSent: 3, deleted: false, summary: null });
    expect(games.deleteGame).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === 'POST')).toBe(true);
  });

  it('refuses a game that is not completed', async () => {
    games.getGameExportData.mockResolvedValue(leitnerGame({ state: 'active' }));
    expect(await service.exportGame(GAME_ID)).toMatchObject({ ok: false, status: 400 });
  });
});
