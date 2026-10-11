import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/game';

function exportButton(page: Page) {
  return page.getByRole('button', { name: 'Export to LRS' });
}

test('the Export to LRS button only shows on a completed game', async ({ page, games }) => {
  const game = await games.active({ badges: ['red'] });
  await page.goto(`/games/${game.gameId}`);
  await expect(exportButton(page)).toBeHidden();
});

test('Export to LRS is disabled while a guessed badge has no player, and explains why', async ({
  page,
  games,
}) => {
  const game = await games.completedGameWithGuesses({
    badges: ['red', 'blue'],
    answers: { red: 'A', blue: 'B' },
  });
  await page.goto(`/games/${game.gameId}`);

  await expect(exportButton(page)).toBeVisible();
  await expect(exportButton(page)).toBeDisabled();
  await expect(exportButton(page)).toHaveAttribute(
    'title',
    'Assign a player to every badge before exporting',
  );
});

test('exporting a fully-bound completed game shows the statement count', async ({
  page,
  api,
  games,
}) => {
  const game = await games.completedGameWithGuesses({
    badges: ['red', 'blue'],
    answers: { red: 'A', blue: 'B' },
  });
  const mia = await api.createPlayer(games.name('Mia'));
  const leo = await api.createPlayer(games.name('Leo'));
  await api.bindPlayer(game.gameId, game.badges['red'], mia.id);
  await api.bindPlayer(game.gameId, game.badges['blue'], leo.id);
  await page.goto(`/games/${game.gameId}`);

  await expect(exportButton(page)).toBeEnabled();
  await exportButton(page).click();

  await expect(page.getByText('Exported 4 statements to the LRS.')).toBeVisible();

  // Re-exporting the unchanged game is safe (idempotent) and shows the same count.
  await exportButton(page).click();
  await expect(page.getByText('Exported 4 statements to the LRS.')).toBeVisible();
});
