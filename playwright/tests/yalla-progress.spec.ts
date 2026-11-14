import { API_URL } from '../fixtures/api';
import { CH27_OBJECTS, daysFrom, expect, test, WORDS } from '../fixtures/leitner';

/**
 * YALLA milestone Y3 (docs/yalla/implementation-plan.md §5): the pills and
 * levels come from the linked player's LRS evidence, the same tracks as
 * Players → detail. E2E runs with auth off, so the user is local-dev.
 */
const HOUR_MS = 60 * 60 * 1000;
const CHAPTER_27 = '/yalla/books/korean-language-book/chapters/27';

test.afterEach(async ({ request }) => {
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: null } });
});

test('without a linked player the pills show – and the page asks you to link one', async ({ page, request }) => {
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: null } });
  const noLink = await request.get(`${API_URL}/api/yalla/me/progress?chapter=27`);
  expect(noLink.status()).toBe(403);

  await page.goto(`${CHAPTER_27}/vocabulary`);
  await expect(page.getByTestId('pill-reading')).toContainText('–');
  await expect(page.getByTestId('practising-as')).toContainText('Link your profile to a player');
  await expect(page.getByTestId('level-reading')).toHaveCount(0);
});

test('the pills, word levels and filter come from the linked player’s evidence', async ({ page, request, leitner, stubLrs }) => {
  const student = await leitner.student('Yalla');
  const now = new Date();
  await stubLrs.seedAssessed(student.externalId, [
    // 시험 reading: correct an hour ago → L1, not due.
    { word: WORDS.test, aspect: 'reading', success: true, at: new Date(now.getTime() - HOUR_MS) },
    // 수업 reading: correct on each due day through L3 → retired.
    { word: WORDS.lesson, aspect: 'reading', success: true, at: daysFrom(now, -20) },
    { word: WORDS.lesson, aspect: 'reading', success: true, at: daysFrom(now, -19) },
    { word: WORDS.lesson, aspect: 'reading', success: true, at: daysFrom(now, -16) },
    { word: WORDS.lesson, aspect: 'reading', success: true, at: daysFrom(now, -9) },
  ]);
  const linked = await request.put(`${API_URL}/api/me/player`, { data: { playerId: student.id } });
  expect(linked.status()).toBe(200);

  // Same tracks as Players → detail for the same player.
  const yalla = await (await request.get(`${API_URL}/api/yalla/me/progress?chapter=27`)).json();
  const players = await leitner.progress(student.id);
  expect(yalla.tracks).toEqual(players.tracks);
  expect(yalla.byAspect.reading).toEqual({ total: CH27_OBJECTS, open: CH27_OBJECTS - 1, due: CH27_OBJECTS - 2, new: CH27_OBJECTS - 2, retired: 1 });

  await page.goto(`${CHAPTER_27}/vocabulary`);
  await expect(page.getByTestId('pill-reading')).toContainText(`${CH27_OBJECTS - 1} · ${CH27_OBJECTS - 2} due`);
  await expect(page.getByTestId('pill-writing')).toContainText(`${CH27_OBJECTS} · ${CH27_OBJECTS} due`);
  await expect(page.getByTestId('pill-listening')).toHaveCount(0);

  const testWord = page.getByRole('button', { name: new RegExp(WORDS.test.word) });
  await expect(testWord.getByTestId('level-reading')).toHaveAttribute('data-level', '1');
  const lessonWord = page.getByRole('button', { name: new RegExp(WORDS.lesson.word) });
  await expect(lessonWord.getByTestId('level-reading')).toHaveAttribute('data-level', 'retired');

  // The reading pill lists only the words still to learn for reading.
  await page.getByTestId('pill-reading').getByRole('link').click();
  await expect(page).toHaveURL(/vocabulary\?aspect=reading/);
  await expect(page.getByTestId('vocabulary-count')).toContainText(`${CH27_OBJECTS - 1} words still to learn for Reading`);
  await expect(page.getByRole('button', { name: new RegExp(WORDS.lesson.word) })).toHaveCount(0);

  // The book page shows the same pills for chapter 27 (from one LRS read).
  await page.goto('/yalla/books/korean-language-book');
  await expect(page.getByTestId('chapter-27').getByTestId('pill-reading')).toContainText(
    `${CH27_OBJECTS - 1} · ${CH27_OBJECTS - 2} due`,
  );
});
