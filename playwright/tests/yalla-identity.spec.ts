import { expect, test } from '@playwright/test';
import { API_URL } from '../fixtures/api';

/**
 * YALLA milestone Y2 (docs/yalla/implementation-plan.md §4): linking the
 * signed-in user to a player. E2E runs with auth disabled, so the user is
 * the fixed local-dev identity.
 */
test.afterEach(async ({ request }) => {
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: null } });
});

test('a user creates a player on the Profile page and YALLA shows who they practise as', async ({ page }) => {
  const name = `Yalla ${Date.now().toString(36)}`;

  await page.goto('/profile');
  await page.getByLabel('Or create a new player').fill(name);
  await page.getByRole('button', { name: 'Create and link' }).click();
  await expect(page.getByTestId('practise-as-current')).toContainText(`Practising as ${name}`);

  await page.goto('/yalla');
  await expect(page.getByTestId('practising-as')).toContainText(`Practising as ${name}`);

  await page.goto('/profile');
  await page.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByTestId('practise-as-current')).toContainText('Not linked to a player yet.');
});

test('a user links an existing player, and the link survives a reload', async ({ page, request }) => {
  const name = `Existing ${Date.now().toString(36)}`;
  const created = await request.post(`${API_URL}/api/players`, { data: { firstName: name } });
  expect(created.status()).toBe(201);

  await page.goto('/profile');
  await page.getByRole('combobox', { name: 'Player' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.getByTestId('practise-as-current')).toContainText(`Practising as ${name}`);

  await page.reload();
  await expect(page.getByTestId('practise-as-current')).toContainText(`Practising as ${name}`);
});

test('the /api/me routes validate the link', async ({ request }) => {
  const me = await request.get(`${API_URL}/api/me`);
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ user: { displayName: 'local-dev' } });

  const unknown = await request.put(`${API_URL}/api/me/player`, { data: { playerId: '0123456789abcdef01234567' } });
  expect(unknown.status()).toBe(404);

  const invalid = await request.put(`${API_URL}/api/me/player`, { data: { playerId: 'not-an-id' } });
  expect(invalid.status()).toBe(400);
});
