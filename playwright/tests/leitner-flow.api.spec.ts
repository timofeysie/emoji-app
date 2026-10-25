import { expect, test, type Leitner, type LeitnerGame } from '../fixtures/leitner';
import type { Api } from '../fixtures/api';

/**
 * Continuous flow (docs/xAPI/leitner-method.md → Continuous flow, L21):
 * rounds open by themselves, 5 s after Start Game / Resume and 5 s after a
 * round closes. These tests wait the real countdowns.
 */

const COUNTDOWN_MS = 5_000;

type PlayView = {
  state: string;
  countdown: { reason: 'start' | 'next'; opensAt: string; opensInMs: number } | null;
  currentQuestion: { id: string; sequence: number } | null;
};

async function playView(api: Api, gameId: string): Promise<PlayView> {
  const response = await api.request.get(`/api/games/${gameId}/play`);
  expect(response.status()).toBe(200);
  return (await response.json()) as PlayView;
}

/** Waits for round `sequence` to open by itself; returns how long it took. */
async function waitForRound(api: Api, game: LeitnerGame, sequence: number): Promise<number> {
  const started = Date.now();
  await expect
    .poll(async () => (await playView(api, game.gameId)).currentQuestion?.sequence ?? null, {
      timeout: COUNTDOWN_MS + 5_000,
      intervals: [250],
      message: `round ${sequence} should open by itself`,
    })
    .toBe(sequence);
  return Date.now() - started;
}

async function closedRound(api: Api, leitner: Leitner, game: LeitnerGame, sequence: number): Promise<void> {
  await leitner.answer(game, sequence, true);
  // The last (only) joined badge answered: the round closes by itself.
  await expect
    .poll(async () => (await api.getGame(game.gameId)).questions.find((q) => q.sequence === sequence)?.state)
    .toBe('closed');
}

test.describe('continuous flow (L21)', () => {
  test.setTimeout(90_000);

  test('Start counts down into round 1; each close counts down into the next; not after the last', async ({
    api,
    leitner,
  }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student, { count: 2 });
    expect(game.plan.questions).toHaveLength(2);

    await leitner.start(game);
    const atStart = await playView(api, game.gameId);
    expect(atStart.currentQuestion).toBeNull();
    expect(atStart.countdown?.reason).toBe('start');
    expect(atStart.countdown!.opensInMs).toBeGreaterThan(0);
    expect(atStart.countdown!.opensInMs).toBeLessThanOrEqual(COUNTDOWN_MS);

    const firstWait = await waitForRound(api, game, 1);
    expect(firstWait).toBeGreaterThan(COUNTDOWN_MS - 1_500);
    expect((await playView(api, game.gameId)).countdown).toBeNull();

    // Only one round may be open: a second open is refused.
    const round2 = (await api.getGame(game.gameId)).questions.find((q) => q.sequence === 2)!;
    const second = await api.request.post(`/api/questions/${round2.id}/state`, {
      data: { gameId: game.gameId, state: 'open' },
    });
    expect(second.status()).toBe(409);

    await closedRound(api, leitner, game, 1);
    expect((await playView(api, game.gameId)).countdown?.reason).toBe('next');
    const nextWait = await waitForRound(api, game, 2);
    expect(nextWait).toBeGreaterThan(COUNTDOWN_MS - 1_500);

    // The final round: nothing more opens; after the reveal the game ends
    // itself, exports and is deleted.
    await closedRound(api, leitner, game, 2);
    expect((await playView(api, game.gameId)).countdown).toBeNull();
    await expect
      .poll(() => leitner.gameOrNull(game.gameId), { timeout: COUNTDOWN_MS + 5_000 })
      .toBeNull();
  });

  test('End Game during the final reveal ends it at once', async ({ api, leitner }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student, { count: 1 });

    await leitner.start(game);
    await waitForRound(api, game, 1);
    await closedRound(api, leitner, game, 1);
    const result = await leitner.end(game);
    expect(result).toMatchObject({ exported: true, deleted: true });
  });

  test('Pause cancels the countdown; Resume counts down into the next round', async ({ api, leitner }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student, { count: 3 });

    await leitner.start(game);
    await leitner.openRound(game, 1); // By hand: cancels the start countdown.
    expect((await playView(api, game.gameId)).countdown).toBeNull();
    await closedRound(api, leitner, game, 1);
    await api.setGameState(game.gameId, 'paused');
    expect((await playView(api, game.gameId)).countdown).toBeNull();

    // Longer than the countdown: still nothing open.
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 1_500));
    const paused = await api.getGame(game.gameId);
    expect(paused.questions.filter((q) => q.state === 'open')).toEqual([]);

    await api.setGameState(game.gameId, 'active');
    expect((await playView(api, game.gameId)).countdown?.reason).toBe('start');
    await waitForRound(api, game, 2);
  });

  test('End Game during a countdown stops it', async ({ api, leitner }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student, { count: 2 });

    await leitner.start(game);
    const result = await leitner.end(game);

    expect(result).toMatchObject({ exported: true, deleted: true, statementsSent: 0 });
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_MS + 1_000));
    expect(await leitner.gameOrNull(game.gameId)).toBeNull();
  });
});
