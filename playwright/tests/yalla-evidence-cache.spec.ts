import { API_URL } from '../fixtures/api';
import { daysFrom, expect, test, WORDS } from '../fixtures/leitner';

/**
 * YALLA milestone Y6 (docs/yalla/implementation-plan.md §5 → Keeping
 * Leitner levels accurate): after the first read a progress view costs one
 * short LRS request, late exports are still picked up, and the cached
 * levels match a full read.
 */
const progressPath = `${API_URL}/api/yalla/me/progress?chapter=27`;

test.afterEach(async ({ request }) => {
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: null } });
});

test('progress reads the LRS incrementally, and matches a full read', async ({ request, leitner, stubLrs }) => {
  const student = await leitner.student('Cached');
  const now = new Date();
  await stubLrs.seedAssessed(student.externalId, [
    { word: WORDS.test, aspect: 'reading', success: true, at: daysFrom(now, -3) },
    { word: WORDS.lesson, aspect: 'writing', success: false, at: daysFrom(now, -2) },
  ]);
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: student.id } });

  // First view: the full history.
  await stubLrs.clearRequestLog();
  const first = await (await request.get(progressPath)).json();
  const firstReads = await stubLrs.statementReads();
  expect(firstReads).toHaveLength(1);
  expect(firstReads[0].has('since')).toBe(false);

  // Second view: one request, only for what's new.
  await stubLrs.clearRequestLog();
  const second = await (await request.get(progressPath)).json();
  const secondReads = await stubLrs.statementReads();
  expect(secondReads).toHaveLength(1);
  expect(secondReads[0].get('since')).toBeTruthy();
  expect(second.tracks).toEqual(first.tracks);

  // A badge game exported late (answered 10 days ago, stored now) still counts.
  await stubLrs.seedAssessed(student.externalId, [
    { word: WORDS.level, aspect: 'reading', success: true, at: daysFrom(now, -10) },
  ]);
  const cached = await (await request.get(progressPath)).json();
  const level = cached.tracks.find(
    (track: { learningObjectId: string; aspect: string }) =>
      track.learningObjectId === 'ko/lexeme/정도/level' && track.aspect === 'reading',
  );
  expect(level).toMatchObject({ seenCount: 1, lastResult: 'correct' });

  // "Recompute levels": the next view reads everything again, and agrees with the cache.
  expect((await request.post(`${API_URL}/api/yalla/me/recompute`)).status()).toBe(204);
  await stubLrs.clearRequestLog();
  const rebuilt = await (await request.get(progressPath)).json();
  expect((await stubLrs.statementReads())[0].has('since')).toBe(false);
  expect(rebuilt.tracks).toEqual(cached.tracks);

  // Players → detail reads through the same cache and agrees too.
  expect((await leitner.progress(student.id)).tracks).toEqual(rebuilt.tracks);
});

test('Recompute levels on the Profile page', async ({ page, request, leitner }) => {
  const student = await leitner.student('Recompute');
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: student.id } });

  await page.goto('/profile');
  await page.getByTestId('recompute-levels').click();
  await expect(page.getByTestId('recompute-status')).toContainText('Done');
});
