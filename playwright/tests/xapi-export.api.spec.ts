import { expect, test } from '../fixtures/game';

test.describe('xAPI export (Step 1c)', () => {
  test('export is blocked while any badge with a guess has no player, naming it', async ({
    api,
    games,
  }) => {
    const game = await games.completedGameWithGuesses({
      badges: ['red', 'blue'],
      answers: { red: 'A', blue: 'B' },
    });
    // Only bind one of the two badges that guessed.
    const mia = await api.createPlayer(games.name('Mia'));
    await api.bindPlayer(game.gameId, game.badges['red'], mia.id);

    const response = await api.exportGameRaw(game.gameId);

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.missingBadges).toEqual([game.badges['blue']]);
  });

  test('export sends one answered statement per guess and one scored per player, with no name/email leak', async ({
    api,
    games,
    stubLrs,
  }) => {
    const game = await games.completedGameWithGuesses({
      badges: ['red', 'blue'],
      answers: { red: 'A', blue: 'B' }, // A is correct: red right, blue wrong.
    });
    const mia = await api.createPlayer(games.name('Mia'));
    const leo = await api.createPlayer(games.name('Leo'));
    await api.bindPlayer(game.gameId, game.badges['red'], mia.id);
    await api.bindPlayer(game.gameId, game.badges['blue'], leo.id);

    const result = await api.exportGame(game.gameId);
    expect(result).toEqual({ ok: true, statementsSent: 4 }); // 2 guesses + 2 players.

    const statements = await stubLrs.statementsForGame(game.gameId);
    expect(statements).toHaveLength(4);

    const answered = statements.filter(
      (s) => s.verb.id === 'http://adlnet.gov/expapi/verbs/answered',
    );
    const scored = statements.filter((s) => s.verb.id === 'http://adlnet.gov/expapi/verbs/scored');
    expect(answered).toHaveLength(2);
    expect(scored).toHaveLength(2);

    // Actors are only `account` + externalId (security.md D3): never a name or email anywhere.
    for (const statement of statements) {
      const json = JSON.stringify(statement);
      expect(json).not.toContain(games.name('Mia'));
      expect(json).not.toContain(games.name('Leo'));
      expect(json).not.toMatch(/mbox|email/i);
      expect(statement.actor.account.homePage).toBe('https://kogs.link');
    }

    const redAnswered = answered.find((s) => s.actor.account.name === mia.externalId);
    expect(redAnswered?.result?.success).toBe(true);
    const blueAnswered = answered.find((s) => s.actor.account.name === leo.externalId);
    expect(blueAnswered?.result?.success).toBe(false);

    const miaScored = scored.find((s) => s.actor.account.name === mia.externalId);
    expect(miaScored?.result?.score).toEqual({ raw: 1, min: 0, max: 1, scaled: 1 });
    const leoScored = scored.find((s) => s.actor.account.name === leo.externalId);
    expect(leoScored?.result?.score).toEqual({ raw: 0, min: 0, max: 1, scaled: 0 });
  });

  test('re-exporting an unchanged game is idempotent: same statement ids, no duplicates', async ({
    api,
    games,
    stubLrs,
  }) => {
    const game = await games.completedGameWithGuesses({
      badges: ['red'],
      answers: { red: 'A' },
    });
    const mia = await api.createPlayer(games.name('Mia'));
    await api.bindPlayer(game.gameId, game.badges['red'], mia.id);

    const first = await api.exportGame(game.gameId);
    const firstIds = (await stubLrs.statementsForGame(game.gameId)).map((s) => s.id).sort();

    const second = await api.exportGame(game.gameId);
    const secondIds = (await stubLrs.statementsForGame(game.gameId)).map((s) => s.id).sort();

    expect(second).toEqual(first);
    expect(secondIds).toEqual(firstIds);
    expect(secondIds).toHaveLength(2); // 1 answered + 1 scored; re-export didn't add more.
  });
});
