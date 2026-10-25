import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/leitner';
import type { Player } from '../fixtures/api';

/**
 * The referee's Leitner screens (docs/xAPI/leitner-method.md → Step 4,
 * Step 5): New Leitner Game, the game detail panel, the end-of-game
 * summary, pending export with Retry, and the student view's countdowns.
 */

function titleFor(player: Player): string {
  return `Leitner: ${player.label} · ch. 27`;
}

async function openNewLeitnerDialog(page: Page, player: Player) {
  await page.goto('/games');
  await page.getByRole('button', { name: 'New Leitner Game' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Student').click();
  await page.getByRole('option', { name: new RegExp(player.firstName) }).click();
  return dialog;
}

test('New Leitner Game: preview the plan, create, and open the game', async ({ page, api, leitner }) => {
  const student = await leitner.student('Mia');

  const dialog = await openNewLeitnerDialog(page, student);
  await expect(dialog.getByLabel('Chapter')).toContainText('Chapter 27');
  await expect(dialog.getByLabel('Scope')).toContainText('This chapter only');
  await dialog.getByRole('button', { name: 'Preview Plan' }).click();

  await expect(dialog).toContainText(`${student.label} · 28 tracks`);
  await expect(dialog).toContainText('Picked 10: 10 new');
  await expect(dialog.getByRole('listitem')).toHaveCount(10);
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/games\/[a-f0-9]{24}$/);
  const gameId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: titleFor(student) })).toBeVisible();
  await expect(page.getByText('Leitner Game', { exact: true })).toBeVisible();
  await expect(page.getByText(student.firstName, { exact: true })).toBeVisible();
  await expect(page.getByText('this chapter only')).toBeVisible();
  // Single-use, and its rounds are the plan.
  await expect(page.getByRole('button', { name: 'Add Round' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play Again' })).toHaveCount(0);

  const detail = await leitner.gameOrNull(gameId);
  expect(detail?.kind).toBe('leitner-solo');
  expect((await api.getGame(gameId)).questions).toHaveLength(10);
});

test('a played game: rounds open by themselves, End Game shows the summary, and the game is gone', async ({
  page,
  context,
  api,
  leitner,
}) => {
  test.setTimeout(60_000);
  const student = await leitner.student('Mia');
  const game = await leitner.newGame(student, { count: 3 });
  const [round1, round2] = game.plan.questions;

  await page.goto(`/games/${game.gameId}`);
  await page.getByRole('button', { name: 'Open for Joining' }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.getByRole('button', { name: 'End Game' })).toBeVisible();

  // The student view counts down into round 1; the referee doesn't open it.
  const studentView = await context.newPage();
  await studentView.goto(`/games/${game.gameId}/play`);
  await expect(studentView.getByText('The game is starting')).toBeVisible();
  await expect(studentView.getByRole('heading', { name: round1.prompt })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();

  await leitner.answer(game, round1.sequence, true);
  // A reloaded view picks up the pending countdown.
  await studentView.reload();
  await expect(studentView.getByText(/Next round in \d/)).toBeVisible();
  await expect(studentView.getByRole('heading', { name: round2.prompt })).toBeVisible({ timeout: 10_000 });
  await leitner.answer(game, round2.sequence, false);

  await page.getByRole('button', { name: 'End Game' }).click();
  await expect(page.getByText('Exported to the LRS and deleted (single-use).')).toContainText(student.firstName);
  await expect(page.getByText('1 / 3 correct')).toBeVisible();
  await expect(page.getByText('Promoted (1)')).toBeVisible();
  await expect(page.getByText('Unchanged (2)')).toBeVisible();
  expect(await leitner.gameOrNull(game.gameId)).toBeNull();

  // The student view shows the same results, with the badge's outcome, even after a reload.
  await expect(studentView.getByRole('heading', { name: `Well done, ${student.firstName}!` })).toBeVisible();
  await expect(studentView.getByRole('img', { name: 'Fireworks' })).toBeVisible();
  await expect(studentView.getByText('Promoted (1)')).toBeVisible();
  await studentView.reload();
  await expect(studentView.getByText('1 of 3 correct')).toBeVisible();
  await expect(studentView.getByText('sent to the LRS')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to games' }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByText(titleFor(student))).toHaveCount(0);
  expect((await api.request.get(`/api/games/${game.gameId}`)).status()).toBe(404);
});

test('planning while a game is being played links to that game', async ({ page, leitner }) => {
  const student = await leitner.student();
  const game = await leitner.newGame(student);
  await leitner.start(game);

  const dialog = await openNewLeitnerDialog(page, student);
  await dialog.getByRole('button', { name: 'Preview Plan' }).click();

  await expect(dialog).toContainText('A Leitner game for this student is being played. End it first.');
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Open game' }).click();
  await expect(page).toHaveURL(new RegExp(`/games/${game.gameId}$`));
});

test('a failed export shows as pending; Retry export sends it and shows the summary', async ({
  page,
  leitner,
  stubLrs,
}) => {
  const student = await leitner.student('Mia');
  const game = await leitner.newGame(student, { count: 2 });
  await leitner.start(game);
  await leitner.openRound(game, 1);
  await leitner.answer(game, 1, true);
  await stubLrs.fail('POST', 503);
  expect(await leitner.end(game)).toMatchObject({ exported: false });

  // The games list marks it, and the planner sends the referee to it.
  await page.goto('/games');
  const row = page.locator('div.rounded-lg.border', { hasText: titleFor(student) });
  await expect(row.getByText('export pending')).toBeVisible();
  const dialog = await openNewLeitnerDialog(page, student);
  await dialog.getByRole('button', { name: 'Preview Plan' }).click();
  await expect(dialog).toContainText("This student's last Leitner game hasn't reached the LRS yet.");
  await dialog.getByRole('button', { name: 'Open to retry export' }).click();
  await expect(page).toHaveURL(new RegExp(`/games/${game.gameId}$`));

  await expect(page.getByText('Export pending.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Again' })).toHaveCount(0);

  // Still failing: the error shows and the game stays.
  const retry = page.getByRole('button', { name: 'Retry export' });
  const exportResponse = () => page.waitForResponse((r) => r.url().endsWith(`/api/games/${game.gameId}/xapi-export`));
  const [failedRetry] = await Promise.all([exportResponse(), retry.click()]);
  expect(failedRetry.status()).toBe(502);
  await expect(page.locator('p.text-destructive', { hasText: 'LRS rejected the export' })).toBeVisible();
  expect(await leitner.gameOrNull(game.gameId)).not.toBeNull();

  await stubLrs.clearFailures();
  const [retried] = await Promise.all([exportResponse(), retry.click()]);
  expect(retried.status()).toBe(200);
  await expect(page.getByText('1 / 2 correct')).toBeVisible();
  await expect(page.getByText('Exported to the LRS and deleted (single-use).')).toBeVisible();
  expect(await leitner.gameOrNull(game.gameId)).toBeNull();
});
