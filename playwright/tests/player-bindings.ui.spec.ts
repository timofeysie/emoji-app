import type { Page } from '@playwright/test';
import type { Player } from '../fixtures/api';
import { expect, test } from '../fixtures/game';

/** The amber "Guesses without a player: …" warning in the Players panel. */
function missingWarning(page: Page) {
  return page.getByText('Guesses without a player:');
}

/** Pick `player` in one badge's Radix Select (trigger, then an option in the portal). */
async function assign(page: Page, badgeName: string, player: Player) {
  await page.getByTestId(`player-binding-${badgeName}`).getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(player.firstName) }).click();
  await expect(page.getByTestId(`player-binding-${badgeName}`).getByRole('combobox')).toContainText(
    player.firstName,
  );
}

test('a completed game with unbound guesses names the badges in the warning', async ({
  page,
  games,
}) => {
  const game = await games.completedGameWithGuesses({
    badges: ['red', 'blue'],
    answers: { red: 'A', blue: 'B' },
  });

  await page.goto(`/games/${game.gameId}`);

  await expect(missingWarning(page)).toBeVisible();
  await expect(missingWarning(page)).toContainText(`${game.badges['blue']}, ${game.badges['red']}`);
});

test('a player added in the panel appears in every badge picker with their label', async ({
  page,
  api,
  games,
}) => {
  const game = await games.completedGameWithGuesses({
    badges: ['red', 'blue'],
    answers: { red: 'A', blue: 'B' },
  });
  const firstName = games.name('Mia');
  await page.goto(`/games/${game.gameId}`);

  await page.getByLabel("New player's first name or nickname").fill(firstName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel("New player's first name or nickname")).toHaveValue('');

  const players = (await (await api.request.get('/api/players')).json()) as { players: Player[] };
  const mia = players.players.find((p) => p.firstName === firstName);
  expect(mia, 'the new player is saved').toBeDefined();

  for (const badge of Object.values(game.badges)) {
    await page.getByTestId(`player-binding-${badge}`).getByRole('combobox').click();
    const option = page.getByRole('option', { name: new RegExp(firstName) });
    await expect(option).toContainText(mia!.label);
    await page.keyboard.press('Escape');
    await expect(option).toBeHidden();
  }
});

test('assigning every badge clears the warning; unassigning after the guesses keeps it clear', async ({
  page,
  api,
  games,
}) => {
  const game = await games.completedGameWithGuesses({
    badges: ['red', 'blue'],
    answers: { red: 'A', blue: 'B' },
  });
  const red = game.badges['red'];
  const blue = game.badges['blue'];
  const mia = await api.createPlayer(games.name('Mia'));
  const leo = await api.createPlayer(games.name('Leo'));
  await page.goto(`/games/${game.gameId}`);
  await expect(missingWarning(page)).toBeVisible();

  await assign(page, red, mia);
  await expect(missingWarning(page)).toContainText(blue);
  await expect(missingWarning(page)).not.toContainText(red);

  await assign(page, blue, leo);
  await expect(missingWarning(page)).toBeHidden();

  // Unassigning ends the binding; red's guess is still covered by its first
  // binding (the first-binding rule), so the warning stays away…
  await page.getByRole('button', { name: `Unassign the player from ${red}` }).click();
  await expect(page.getByTestId(`player-binding-${red}`).getByRole('combobox')).toContainText(
    'Assign player…',
  );
  await expect(missingWarning(page)).toBeHidden();
});

test('unassigning a badge before its guess brings the warning back for that badge', async ({
  page,
  api,
  games,
}) => {
  const game = await games.active({ badges: ['red', 'blue'] });
  const red = game.badges['red'];
  const mia = await api.createPlayer(games.name('Mia'));
  const leo = await api.createPlayer(games.name('Leo'));
  await api.bindPlayer(game.gameId, red, mia.id);
  await api.bindPlayer(game.gameId, game.badges['blue'], leo.id);
  await page.goto(`/games/${game.gameId}`);
  await expect(page.getByTestId(`player-binding-${red}`).getByRole('combobox')).toContainText(
    mia.firstName,
  );

  await page.getByRole('button', { name: `Unassign the player from ${red}` }).click();
  await expect(page.getByTestId(`player-binding-${red}`).getByRole('combobox')).toContainText(
    'Assign player…',
  );

  // Red scans after losing its player: nobody covers that guess.
  await games.guessAll(game, 0, { red: 'A', blue: 'B' });
  await page.reload();
  await expect(missingWarning(page)).toBeVisible();
  await expect(missingWarning(page)).toContainText(red);
  await expect(missingWarning(page)).not.toContainText(game.badges['blue']);
});

test('a server error shows inline in the panel without crashing it', async ({
  page,
  api,
  games,
}) => {
  const game = await games.completedGameWithGuesses({ badges: ['red'], answers: { red: 'A' } });
  const red = game.badges['red'];
  const mia = await api.createPlayer(games.name('Mia'));
  await page.route(`**/api/games/${game.gameId}/player-bindings/*`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 404, json: { error: 'Player not found.' } });
  });
  await page.goto(`/games/${game.gameId}`);

  await page.getByTestId(`player-binding-${red}`).getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(mia.firstName) }).click();

  await expect(page.getByText('Player not found.')).toBeVisible();
  await expect(missingWarning(page)).toContainText(red);
  await expect(page.getByLabel("New player's first name or nickname")).toBeEnabled();
});
