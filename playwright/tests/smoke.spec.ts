import { expect, test } from '../fixtures/game';

test('the API server is up', async ({ api }) => {
  const response = await api.request.get('/api/version');
  expect(response.status()).toBe(200);
  expect(await response.json()).toHaveProperty('version');
});

test('a game created through the API appears on /games', async ({ page, api, games }) => {
  const title = games.name('Smoke game');
  await api.createGame(title);

  await page.goto('/games');

  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Edit ${title}` })).toBeVisible();
});
