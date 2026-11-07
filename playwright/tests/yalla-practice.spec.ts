import { API_URL } from '../fixtures/api';
import { CH27_OBJECTS, expect, test } from '../fixtures/leitner';
import { EXT, type StubStatement } from '../fixtures/stub-lrs';

/**
 * YALLA milestone Y4 (docs/yalla/implementation-plan.md §6): an on-screen
 * A–D session sends `yalla-solo` evidence, the pills move, and the next
 * badge-game plan sees it. E2E runs with auth off, so the user is local-dev.
 */
const CHAPTER_27 = '/yalla/books/korean-language-book/chapters/27';


type Item = {
  itemId: string;
  aspect: 'reading' | 'writing';
  learningObjectId: string;
  sourceRef: string;
  word: string;
  gloss: string;
  options: Array<{ slotLabel: string; text: string }>;
  answer: string;
};
type Session = { sessionId: string; items: Item[] };

test.afterEach(async ({ request }) => {
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: null } });
  await request.put(`${API_URL}/api/me/preferences`, { data: { yallaFormat: null } });
});

test('a practice session moves the pills and the next badge-game plan', async ({ page, request, leitner, stubLrs }) => {
  const student = await leitner.student('Practice');
  expect((await request.put(`${API_URL}/api/me/player`, { data: { playerId: student.id } })).status()).toBe(200);

  await page.goto(`${CHAPTER_27}/exercises`);
  await expect(page.getByTestId('pill-reading')).toContainText(`${CH27_OBJECTS} · ${CH27_OBJECTS} due`);
  // Writing defaults to typing (Y5); this session is all A–D.
  await expect(page.getByTestId('channel-writing-keyboard')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('channel-writing-onscreen-choice').click();
  await page.getByTestId('setup-count').selectOption('5');
  const planned = page.waitForResponse((response) => response.url().endsWith('/api/yalla/me/sessions'));
  await page.getByTestId('practice-start').click();
  const session = (await (await planned).json()) as Session;
  expect(session.items).toHaveLength(5);

  // Item 2 wrong, the rest right; item 1 by keyboard, the others by click.
  const wrongItem = session.items[1];
  for (const [index, item] of session.items.entries()) {
    await expect(page.getByTestId('practice-position')).toHaveText(`${index + 1} / 5`);
    const slot = item === wrongItem ? item.options.find((option) => option.slotLabel !== item.answer)!.slotLabel : item.answer;
    if (index === 0) await page.keyboard.press(slot.toLowerCase());
    else await page.getByTestId(`option-${slot}`).click();
    await expect(page.getByTestId(`option-${item.answer}`)).toHaveAttribute('data-correct', 'true');
    await page.getByTestId('practice-next').click();
  }

  await expect(page.getByTestId('practice-score')).toHaveText('4 / 5 correct');
  await expect(page.getByTestId('practice-outbox')).toContainText('All answers saved');

  // The LRS has an answered + assessed pair per answer, as yalla-solo / onscreen-choice.
  const statements = (await stubLrs.allStatements()).filter(
    (statement: StubStatement) => statement.context.registration === session.sessionId,
  );
  expect(statements).toHaveLength(10);
  for (const statement of statements) {
    expect(statement.context.extensions?.[EXT.gameKind]).toBe('yalla-solo');
    expect(statement.context.extensions?.[EXT.inputChannel]).toBe('onscreen-choice');
  }

  // The pills reloaded after saving: each right answer is no longer due.
  const progress = await (await request.get(`${API_URL}/api/yalla/me/progress?chapter=27`)).json();
  for (const aspect of ['reading', 'writing'] as const) {
    const right = session.items.filter((item) => item.aspect === aspect && item !== wrongItem).length;
    expect(progress.byAspect[aspect].due).toBe(CH27_OBJECTS - right);
    await expect(page.getByTestId(`pill-${aspect}`)).toContainText(
      `${CH27_OBJECTS} · ${CH27_OBJECTS - right} due`,
    );
  }
  const right = session.items.find((item) => item !== wrongItem)!;
  const track = progress.tracks.find(
    (t: { learningObjectId: string; aspect: string }) => t.learningObjectId === right.learningObjectId && t.aspect === right.aspect,
  );
  expect(track).toMatchObject({ status: 'active', level: 1, lastResult: 'correct' });

  // The next badge-game plan sees it: the missed word comes back as overdue, and no right answer is "new" again.
  const plan = await leitner.dryRun({ playerId: student.id });
  const missed = plan.picks.find((pick) => pick.learningObjectId === wrongItem.learningObjectId && pick.aspect === wrongItem.aspect);
  expect(missed?.reason).toBe('overdue');
  for (const item of session.items.filter((item) => item !== wrongItem)) {
    const pick = plan.picks.find((p) => p.learningObjectId === item.learningObjectId && p.aspect === item.aspect);
    expect(pick?.reason ?? 'not picked').not.toBe('new');
  }
});

test('results are idempotent, and the server decides what is correct', async ({ request, leitner, stubLrs }) => {
  const student = await leitner.student('Recheck');
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: student.id } });
  const session = (await (
    await request.post(`${API_URL}/api/yalla/me/sessions`, { data: { chapter: 27, count: 1 } })
  ).json()) as Session;
  const [item] = session.items;
  const wrong = item.options.find((option) => option.slotLabel !== item.answer)!.slotLabel;
  const attempt = {
    attemptId: 'attempt-1',
    itemId: item.itemId,
    book: 'korean-language-book',
    sourceRef: item.sourceRef,
    learningObjectId: item.learningObjectId,
    aspect: item.aspect,
    channel: 'onscreen-choice',
    options: item.options,
    response: wrong,
    answeredAt: new Date().toISOString(),
    // A tampered client claiming its wrong answer was right.
    correct: true,
  };
  const post = () => request.post(`${API_URL}/api/yalla/me/results`, { data: { sessionId: session.sessionId, attempts: [attempt] } });

  const first = await post();
  expect(first.status()).toBe(200);
  expect((await first.json()).results).toEqual([{ attemptId: 'attempt-1', correct: false }]);
  expect((await post()).status()).toBe(200);

  const sent = (await stubLrs.allStatements()).filter((statement) => statement.context.registration === session.sessionId);
  expect(sent).toHaveLength(2);
  expect(sent.every((statement) => statement.result?.success === false)).toBe(true);

  // Without a linked player there's nothing to record against.
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: null } });
  expect((await post()).status()).toBe(403);
});

test('typed practice (Y5): writing typed by default, checked exactly, and it moves the levels', async ({
  page,
  request,
  leitner,
  stubLrs,
}) => {
  const student = await leitner.student('Typist');
  await request.put(`${API_URL}/api/me/player`, { data: { playerId: student.id } });

  await page.goto(`${CHAPTER_27}/exercises`);
  await page.getByTestId('setup-aspect-reading').uncheck();
  await page.getByTestId('setup-count').selectOption('5');
  const planned = page.waitForResponse((response) => response.url().endsWith('/api/yalla/me/sessions'));
  await page.getByTestId('practice-start').click();
  const session = (await (await planned).json()) as Session;
  expect(session.items.every((item) => item.aspect === 'writing')).toBe(true);
  const [first, second, third, ...rest] = session.items;

  // 1. Right, with stray spaces; Enter checks it and Enter again moves on.
  await expect(page.getByTestId('practice-prompt')).toHaveText(first.gloss);
  await expect(page.getByTestId('practice-input')).toHaveAttribute('lang', 'ko');
  await page.getByTestId('practice-input').fill(`  ${first.word} `);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('practice-feedback')).toContainText('Correct');
  await page.keyboard.press('Enter');

  // 2. Wrong: the difference is shown, and it's scored wrong.
  await expect(page.getByTestId('practice-position')).toHaveText('2 / 5');
  await page.getByTestId('practice-input').fill(`${second.word}요`);
  await page.getByTestId('practice-check').click();
  await expect(page.getByTestId('practice-feedback')).toContainText('Not quite');
  await expect(page.getByTestId('practice-diff')).toContainText(second.word);
  await page.getByTestId('practice-next').click();

  // 3. Switch this word to A–D (before answering), then back: it stays A–D, typing resumes on the next.
  await page.getByTestId('channel-writing-onscreen-choice').click();
  await expect(page.getByTestId(`option-${third.answer}`)).toBeVisible();
  await page.getByTestId('channel-writing-keyboard').click();
  await expect(page.getByTestId('practice-switch-note')).toBeVisible();
  await page.getByTestId(`option-${third.answer}`).click();
  await page.getByTestId('practice-next').click();

  // The rest: typed again; the last one is "Don't know".
  for (const [index, item] of rest.entries()) {
    await expect(page.getByTestId('practice-input')).toBeVisible();
    if (index === rest.length - 1) {
      await page.getByTestId('practice-dont-know').click();
    } else {
      await page.getByTestId('practice-input').fill(item.word);
      await page.getByTestId('practice-check').click();
    }
    await page.getByTestId('practice-next').click();
  }

  await expect(page.getByTestId('practice-score')).toHaveText('3 / 5 correct');
  await expect(page.getByTestId('practice-outbox')).toContainText('All answers saved');

  // fill-in for typed answers, choice for the switched one.
  const answered = (await stubLrs.allStatements()).filter(
    (statement) => statement.context.registration === session.sessionId && statement.verb.id.endsWith('/answered'),
  );
  const channels = Object.fromEntries(
    answered.map((statement) => [statement.object.id.split('/').pop(), statement.context.extensions?.[EXT.inputChannel]]),
  );
  expect(channels).toEqual({ '1': 'keyboard', '2': 'keyboard', '3': 'onscreen-choice', '4': 'keyboard', '5': 'keyboard' });

  const progress = await (await request.get(`${API_URL}/api/yalla/me/progress?chapter=27`)).json();
  const level = (item: Item) =>
    progress.tracks.find(
      (track: { learningObjectId: string; aspect: string }) =>
        track.learningObjectId === item.learningObjectId && track.aspect === item.aspect,
    );
  expect(level(first)).toMatchObject({ level: 1, lastResult: 'correct' });
  expect(level(second)).toMatchObject({ level: 0, lastResult: 'incorrect' });
  expect(level(rest[rest.length - 1])).toMatchObject({ level: 0, lastResult: 'incorrect' });

  // Switching saved the format on the user: writing is typed again (the last switch).
  const me = await (await request.get(`${API_URL}/api/me`)).json();
  expect(me.preferences.yallaFormat).toEqual({ reading: 'onscreen-choice', writing: 'keyboard' });
});
