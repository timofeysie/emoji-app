import { expect, test } from '../fixtures/game';

test('create a game in the UI and add a round', async ({ page, games }) => {
  const title = games.name('UI game');
  await page.goto('/games');

  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: `Edit ${title}` }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('0 Rounds')).toBeVisible();

  await page.getByRole('button', { name: 'Add Round' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Round', { exact: true }).fill('What does 안녕하세요 mean?');
  await dialog.getByPlaceholder('Option A').fill('Hello');
  await dialog.getByPlaceholder('Option B').fill('Goodbye');
  await dialog.getByRole('button', { name: 'Mark option A as correct' }).click();
  await dialog.getByRole('button', { name: 'Add Round' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('1 Round', { exact: true })).toBeVisible();
  await expect(page.getByText('What does 안녕하세요 mean?')).toBeVisible();
});

test('bind a two-badge station, open for joining, start, and open the round', async ({
  page,
  api,
  games,
}) => {
  const title = games.name('Flow game');
  const gameId = await api.createGame(title);
  await api.addRound(gameId, 1);
  const station = games.name('st');
  const red = games.name('red');
  const blue = games.name('blue');
  await api.stationHeartbeat(station, [red, blue]);
  await page.goto(`/games/${gameId}`);

  // Typing the station name binds its whole live roster.
  await page.getByPlaceholder('Or type pair name (e.g. green)').fill(station);
  await page.getByPlaceholder('Or type pair name (e.g. green)').press('Enter');
  await expect(page.getByRole('button', { name: `Remove ${station} from this game` })).toBeVisible();
  await expect(page.getByTestId(`player-binding-${red}`)).toBeVisible();
  await expect(page.getByTestId(`player-binding-${blue}`)).toBeVisible();

  await page.getByRole('button', { name: 'Open for Joining' }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.getByRole('button', { name: 'End Game' })).toBeVisible();

  // A new round is `draft`, and Start Game auto-opens only `closed` rounds,
  // so the referee opens round 1.
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  const detail = await api.getGame(gameId);
  expect(detail.state).toBe('active');
  expect(detail.questions[0]?.state).toBe('open');
});

test('two scans show in the result chart; End Game completes; scores match', async ({
  page,
  api,
  games,
}) => {
  const game = await games.active({ badges: ['red', 'blue'] });
  await page.goto(`/games/${game.gameId}`);
  await expect(page.getByRole('button', { name: 'End Game' })).toBeVisible();

  await games.guessAll(game, 0, { red: 'A', blue: 'B' });

  // The page refreshes the chart from the server's nfc.tagged WebSocket event.
  await expect(page.getByTitle('slot A · correct')).toHaveCount(1);
  await expect(page.getByTitle('slot B · wrong')).toHaveCount(1);
  await expect(page.getByRole('cell', { name: '1 / 1' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0 / 1' })).toBeVisible();

  await page.getByRole('button', { name: 'End Game' }).click();
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible();
  await expect(page.getByRole('heading', { name: game.title }).locator('xpath=..')).toContainText(
    'completed',
  );

  const { scores } = await api.getScores(game.gameId);
  expect(
    scores.map((row) => ({ badgeName: row.badgeName, correct: row.correct, total: row.total })),
  ).toEqual([
    { badgeName: game.badges['red'], correct: 1, total: 1 },
    { badgeName: game.badges['blue'], correct: 0, total: 1 },
  ]);
});
