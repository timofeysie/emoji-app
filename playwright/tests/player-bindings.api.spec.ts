import { expect, test } from '../fixtures/game';

const NO_SUCH_ID = '0000000000000000000000ff';

test.describe('missing badges and binding reasons', () => {
  test('guesses with no bindings → both badges are missing', async ({ api, games }) => {
    const game = await games.completedGameWithGuesses({
      badges: ['red', 'blue'],
      answers: { red: 'A', blue: 'B' },
    });

    const result = await api.getPlayerBindings(game.gameId);

    expect(result.badgeNames).toEqual([game.badges['blue'], game.badges['red']]);
    expect(result.missingBadges).toEqual([game.badges['blue'], game.badges['red']]);
    expect(result.bindings).toEqual([]);
  });

  test('binding both badges clears them; first bindings are `initial`', async ({ api, games }) => {
    const game = await games.completedGameWithGuesses({
      badges: ['red', 'blue'],
      answers: { red: 'A', blue: 'B' },
    });
    const mia = await api.createPlayer(games.name('Mia'));
    const leo = await api.createPlayer(games.name('Leo'));

    await api.bindPlayer(game.gameId, game.badges['red'], mia.id);
    await api.bindPlayer(game.gameId, game.badges['blue'], leo.id);
    const result = await api.getPlayerBindings(game.gameId);

    expect(result.missingBadges).toEqual([]);
    expect(
      result.bindings.map((b) => ({
        badgeName: b.badgeName,
        playerId: b.player.id,
        label: b.player.label,
        reason: b.reason,
        unassignedAt: b.unassignedAt,
      })),
    ).toEqual([
      { badgeName: game.badges['red'], playerId: mia.id, label: mia.label, reason: 'initial', unassignedAt: null },
      { badgeName: game.badges['blue'], playerId: leo.id, label: leo.label, reason: 'initial', unassignedAt: null },
    ]);
  });

  test('swap: binding red to the player holding blue unbinds blue', async ({ api, games }) => {
    const game = await games.completedGameWithGuesses({
      badges: ['red', 'blue'],
      answers: { red: 'A', blue: 'B' },
    });
    const red = game.badges['red'];
    const blue = game.badges['blue'];
    const mia = await api.createPlayer(games.name('Mia'));
    const leo = await api.createPlayer(games.name('Leo'));
    await api.bindPlayer(game.gameId, red, mia.id);
    await api.bindPlayer(game.gameId, blue, leo.id);

    const swapped = await api.bindPlayer(game.gameId, red, leo.id);
    const result = await api.getPlayerBindings(game.gameId);

    expect(swapped.reason).toBe('swap');
    const active = result.bindings.filter((b) => b.unassignedAt === null);
    expect(active.map((b) => [b.badgeName, b.player.id])).toEqual([[red, leo.id]]);
    // Leo holds one active badge; Mia's red and Leo's blue rows are ended, not deleted.
    const ended = result.bindings.filter((b) => b.unassignedAt !== null);
    expect(ended.map((b) => [b.badgeName, b.player.id]).sort()).toEqual(
      [
        [blue, leo.id],
        [red, mia.id],
      ].sort(),
    );
    // Both guesses happened before the swap, so the first bindings still cover them.
    expect(result.missingBadges).toEqual([]);
  });

  test('time range: a guess after unbinding is not covered', async ({ api, games }) => {
    const game = await games.active({ badges: ['red'], rounds: 2 });
    const red = game.badges['red'];
    const mia = await api.createPlayer(games.name('Mia'));

    await api.bindPlayer(game.gameId, red, mia.id);
    await games.guessAll(game, 0, { red: 'A' });
    await api.unbindPlayer(game.gameId, red);
    expect((await api.getPlayerBindings(game.gameId)).missingBadges).toEqual([]);

    await api.setRoundState(game.gameId, game.roundIds[0], 'closed');
    await api.setRoundState(game.gameId, game.roundIds[1], 'open');
    await games.guessAll(game, 1, { red: 'B' });

    expect((await api.getPlayerBindings(game.gameId)).missingBadges).toEqual([red]);
  });

  test('binding after the game ends covers the earlier guesses', async ({ api, games }) => {
    const game = await games.completedGameWithGuesses({ badges: ['red'], answers: { red: 'A' } });
    const red = game.badges['red'];
    expect((await api.getPlayerBindings(game.gameId)).missingBadges).toEqual([red]);

    const mia = await api.createPlayer(games.name('Mia'));
    await api.bindPlayer(game.gameId, red, mia.id);

    expect((await api.getPlayerBindings(game.gameId)).missingBadges).toEqual([]);
  });
});

test.describe('errors', () => {
  test('unknown badge → 404', async ({ api, games }) => {
    const game = await games.completedGameWithGuesses({ badges: ['red'], answers: { red: 'A' } });
    const mia = await api.createPlayer(games.name('Mia'));

    const response = await api.request.put(
      `/api/games/${game.gameId}/player-bindings/${games.name('green')}`,
      { data: { playerId: mia.id } },
    );

    expect(response.status()).toBe(404);
  });

  test('unknown player → 404', async ({ api, games }) => {
    const game = await games.completedGameWithGuesses({ badges: ['red'], answers: { red: 'A' } });

    const response = await api.request.put(
      `/api/games/${game.gameId}/player-bindings/${game.badges['red']}`,
      { data: { playerId: NO_SUCH_ID } },
    );

    expect(response.status()).toBe(404);
  });

  test('unbinding a badge with no player → 404', async ({ api, games }) => {
    const game = await games.completedGameWithGuesses({ badges: ['red'], answers: { red: 'A' } });

    const response = await api.request.delete(
      `/api/games/${game.gameId}/player-bindings/${game.badges['red']}`,
    );

    expect(response.status()).toBe(404);
  });
});

test('Play Again clears the guesses but keeps the player bindings', async ({ api, games }) => {
  const game = await games.completedGameWithGuesses({
    badges: ['red', 'blue'],
    answers: { red: 'A', blue: 'B' },
  });
  const mia = await api.createPlayer(games.name('Mia'));
  await api.bindPlayer(game.gameId, game.badges['red'], mia.id);
  expect((await api.getPlayerBindings(game.gameId)).missingBadges).toEqual([game.badges['blue']]);

  await api.setGameState(game.gameId, 'ready');
  const result = await api.getPlayerBindings(game.gameId);

  // Pins today's behaviour (docs/db/mongo.md "Before Step 1c"): the guesses
  // and station bindings are gone, so nothing is missing and no badge is
  // listed, but Mia's binding survives. Step 1c decides whether it should.
  expect(result.missingBadges).toEqual([]);
  expect(result.badgeNames).toEqual([]);
  expect(result.bindings.map((b) => [b.badgeName, b.player.id, b.unassignedAt])).toEqual([
    [game.badges['red'], mia.id, null],
  ]);
});
