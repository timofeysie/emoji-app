import type { BadgeStateService } from '../badge-state.service';
import type { GameDataRepository, GameDetail } from '../persistence/game-data.repository';
import { LEITNER_REVEAL_MS, LEITNER_START_COUNTDOWN_MS, LeitnerFlowService } from './leitner-flow.service';

const GAME_ID = '6650f00000000000000000f0';

function detail(overrides: Partial<GameDetail> = {}): GameDetail {
  return {
    id: GAME_ID,
    title: 'Leitner: Player 7F3A · ch. 27',
    state: 'active',
    kind: 'leitner-solo',
    leitner: { playerId: '507f1f77bcf86cd7994390aa', book: 'korean-language-book', chapter: '27', scope: 'chapter' },
    exportError: null,
    exportAttemptedAt: null,
    createdAt: '2026-10-24T09:00:00.000Z',
    startedAt: '2026-10-24T09:00:00.000Z',
    endedAt: null,
    questions: [],
    boundPairs: [],
    ...overrides,
  };
}

describe('LeitnerFlowService', () => {
  const repository = {
    getGameDetail: jest.fn(),
    openNextUnplayedQuestion: jest.fn(),
    getStationNamesByGameId: jest.fn(),
  };
  const badges = { broadcastDashboard: jest.fn(), sendToPairNames: jest.fn() };
  let flow: LeitnerFlowService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-24T09:00:00Z'));
    jest.resetAllMocks();
    repository.getGameDetail.mockResolvedValue(detail());
    repository.openNextUnplayedQuestion.mockResolvedValue('q1');
    repository.getStationNamesByGameId.mockResolvedValue(['green']);
    flow = new LeitnerFlowService(
      repository as unknown as GameDataRepository,
      badges as unknown as BadgeStateService,
    );
  });

  afterEach(() => {
    flow.onModuleDestroy();
    jest.useRealTimers();
  });

  const events = (type: string) =>
    badges.broadcastDashboard.mock.calls.map(([event]) => event).filter((event) => event.type === type);

  it('counts down into the first round when the game starts', async () => {
    flow.onGameState(detail(), 'active');

    expect(events('question.countdown')).toEqual([
      expect.objectContaining({ gameId: GAME_ID, reason: 'start', opensInMs: LEITNER_START_COUNTDOWN_MS }),
    ]);
    expect(flow.countdown(GAME_ID, Date.now() + 2_000)).toMatchObject({ reason: 'start', opensInMs: 3_000 });
    expect(repository.openNextUnplayedQuestion).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(LEITNER_START_COUNTDOWN_MS);

    expect(repository.openNextUnplayedQuestion).toHaveBeenCalledWith(GAME_ID);
    expect(events('question.opened')).toEqual([expect.objectContaining({ gameId: GAME_ID, questionId: 'q1' })]);
    expect(badges.sendToPairNames).toHaveBeenCalledWith(['green'], expect.objectContaining({ type: 'question.opened' }));
    expect(flow.countdown(GAME_ID)).toBeNull();
  });

  it('opens the next round when the reveal ends, but not after the final round', async () => {
    flow.onQuestionClosed(detail(), false);
    expect(flow.countdown(GAME_ID)).toMatchObject({ reason: 'next', opensInMs: LEITNER_REVEAL_MS });
    await jest.advanceTimersByTimeAsync(LEITNER_REVEAL_MS - 1);
    expect(repository.openNextUnplayedQuestion).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(repository.openNextUnplayedQuestion).toHaveBeenCalledTimes(1);

    flow.onQuestionClosed(detail(), true);
    expect(flow.countdown(GAME_ID)).toBeNull();
  });

  it('leaves class games to the referee', () => {
    flow.onGameState(detail({ kind: 'class', leitner: null }), 'active');
    flow.onQuestionClosed(detail({ kind: 'class', leitner: null }), false);
    expect(flow.countdown(GAME_ID)).toBeNull();
    expect(badges.broadcastDashboard).not.toHaveBeenCalled();
  });

  it('stops on pause, end or cancel, and does not count down over an open round', async () => {
    for (const state of ['paused', 'completed', 'cancelled']) {
      flow.onGameState(detail(), 'active');
      flow.onGameState(detail(), state);
      expect(flow.countdown(GAME_ID)).toBeNull();
    }
    await jest.advanceTimersByTimeAsync(LEITNER_START_COUNTDOWN_MS);
    expect(repository.openNextUnplayedQuestion).not.toHaveBeenCalled();

    const open = { id: 'q1', state: 'open' } as GameDetail['questions'][number];
    flow.onGameState(detail({ questions: [open] }), 'active');
    expect(flow.countdown(GAME_ID)).toBeNull();
  });

  it('does not open a round if the game left active before the timer fired', async () => {
    flow.onQuestionClosed(detail(), false);
    repository.getGameDetail.mockResolvedValue(detail({ state: 'paused' }));
    await jest.advanceTimersByTimeAsync(LEITNER_REVEAL_MS);
    expect(repository.openNextUnplayedQuestion).not.toHaveBeenCalled();
  });
});
