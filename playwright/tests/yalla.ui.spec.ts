import { expect, test } from '@playwright/test';

/**
 * YALLA milestone Y1 (docs/yalla/implementation-plan.md): study pages for a
 * local-dev user. E2E runs with auth disabled, so the signed-out case (no
 * link, redirect, 401) is covered by server/src/auth.guard.spec.ts.
 */
test('the YALLA header link opens the books list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'YALLA' }).first().click();

  await expect(page).toHaveURL(/\/yalla$/);
  await expect(page.getByRole('link', { name: /Real-Life Korean Conversations: Intermediate/ })).toBeVisible();
});

test('every chapter opens with its dialog, vocabulary, patterns and exercises', async ({ page }) => {
  await page.goto('/yalla');
  await page.getByRole('link', { name: /Real-Life Korean Conversations: Intermediate/ }).click();

  for (const chapter of ['26', '27', '28', '29', '30']) {
    await page.goto(`/yalla/books/korean-language-book/chapters/${chapter}`);
    await expect(page).toHaveURL(new RegExp(`/chapters/${chapter}/dialog$`));
    await expect(page.getByRole('heading', { name: `Chapter ${chapter}`, level: 1 })).toBeVisible();

    const sidebar = page.getByRole('complementary', { name: 'YALLA' });
    for (const section of ['Dialog', 'Vocabulary', 'Pattern', 'Exercises']) {
      await sidebar.getByRole('link', { name: section, exact: true }).click();
      await expect(page.getByRole('region', { name: section === 'Pattern' ? 'Patterns' : section })).toBeVisible();
    }
  }
});

test('a vocabulary word shows its meaning when tapped', async ({ page }) => {
  await page.goto('/yalla/books/korean-language-book/chapters/27/vocabulary');

  const word = page.getByRole('button', { name: /정도/ });
  await expect(word).toHaveAttribute('aria-expanded', 'false');
  await word.click();
  await expect(word).toHaveAttribute('aria-expanded', 'true');
  await expect(word).toContainText('level, degree, approximately');
});

test('the YALLA API serves a chapter', async ({ request }) => {
  const response = await request.get('http://localhost:3100/api/yalla/books/korean-language-book/chapters/27');

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ chapter: '27', bookTitle: 'Real-Life Korean Conversations: Intermediate' });
});
