import {
  CH27_OBJECTS,
  daysFrom,
  expect,
  findTrack,
  learningObjectId,
  test,
  trackKey,
  WORDS,
} from '../fixtures/leitner';

/**
 * Planning a solo Leitner game from a student's LRS evidence
 * (docs/xAPI/leitner-method.md → The Leitner rules, Choosing the next
 * learning objects, Acceptance 1 and 3–7). Evidence beyond one game is
 * seeded into the stub LRS with past timestamps, as earlier games would
 * have exported it.
 */

const HOUR_MS = 60 * 60 * 1000;

test.describe('a new student (Acceptance 1, L20)', () => {
  test('progress shows 28 new ch. 27 tracks and no evidence', async ({ leitner }) => {
    const student = await leitner.student();

    const progress = await leitner.progress(student.id);

    expect(progress.player).toEqual({ id: student.id, label: student.label });
    expect(progress.statementCount).toBe(0);
    expect(progress.summary).toEqual({
      new: CH27_OBJECTS * 2,
      active: { L0: 0, L1: 0, L2: 0, L3: 0 },
      retired: 0,
      due: CH27_OBJECTS * 2,
    });
    expect(progress.tracks).toHaveLength(CH27_OBJECTS * 2);
    expect(progress.tracks.every((track) => track.status === 'new' && track.inChapter)).toBe(true);
    expect(progress.pendingExport).toEqual([]);
  });

  test('the plan is 10 new ch. 27 words, alternating reading and writing, one aspect each', async ({
    leitner,
  }) => {
    const student = await leitner.student();

    const plan = await leitner.dryRun({ playerId: student.id });

    expect(plan.picks).toHaveLength(10);
    expect(plan.picks.every((pick) => pick.reason === 'new' && pick.chapter === '27')).toBe(true);
    expect(plan.picks.map((pick) => pick.aspect)).toEqual(
      Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? 'reading' : 'writing')),
    );
    // One aspect per learning object per game: a reading question gives away the writing one.
    expect(new Set(plan.picks.map((pick) => pick.learningObjectId)).size).toBe(10);
    expect(plan.report.picked).toMatchObject({ new: 10, overdue: 0, review: 0, practice: 0 });
    expect(plan.supersedes).toEqual([]);

    // One question per pick, each with exactly one correct option.
    expect(plan.questions).toHaveLength(10);
    expect(plan.questions.map(trackKeyOfQuestion).sort()).toEqual(plan.picks.map(trackKey).sort());
    for (const question of plan.questions) {
      expect(question.options.filter((option) => option.isCorrect)).toHaveLength(1);
    }
  });

  test('without fill, a new student gets only maxNew words; with nothing to ask, create is refused', async ({
    leitner,
  }) => {
    const student = await leitner.student();

    const short = await leitner.dryRun({ playerId: student.id, fill: false });
    expect(short.picks).toHaveLength(4);
    expect(short.report.short).toBe(true);

    // A dry run returns the empty plan; create refuses it (L19).
    const empty = await leitner.dryRun({ playerId: student.id, fill: false, maxNew: 0 });
    expect(empty.picks).toEqual([]);
    const refused = await leitner.planRaw({
      playerId: student.id,
      fill: false,
      maxNew: 0,
      createdByUserId: '000000000000000000000001',
    });
    expect(refused.status()).toBe(422);
    expect((await refused.json()).error).toMatch(/Nothing to ask/);
  });

  test('the same seed and now give the same game, and create re-plans to the dry run', async ({ leitner }) => {
    const student = await leitner.student();
    const first = await leitner.dryRun({ playerId: student.id });

    const again = await leitner.dryRun({ playerId: student.id, seed: first.seed, now: first.now });
    expect(again).toEqual(first);

    const created = await leitner.create({ playerId: student.id, seed: first.seed, now: first.now });
    expect(created.plan.picks).toEqual(first.picks);
    expect(created.plan.questions).toEqual(first.questions);
  });
});

test.describe('the Leitner rules, from seeded evidence', () => {
  test('correct → L1 due tomorrow; wrong → L0 due now; L2 answered wrong → L1 due now (Acceptance 3, 4)', async ({
    leitner,
    stubLrs,
  }) => {
    const student = await leitner.student();
    const now = new Date();
    await stubLrs.seedAssessed(student.externalId, [
      { word: WORDS.test, aspect: 'reading', success: true, at: new Date(now.getTime() - HOUR_MS) },
      { word: WORDS.level, aspect: 'reading', success: false, at: new Date(now.getTime() - HOUR_MS) },
      // L0 → L1 (due a day later) → L2 on that due day → wrong: L1, due now.
      { word: WORDS.lesson, aspect: 'reading', success: true, at: daysFrom(now, -10) },
      { word: WORDS.lesson, aspect: 'reading', success: true, at: daysFrom(now, -9) },
      { word: WORDS.lesson, aspect: 'reading', success: false, at: new Date(now.getTime() - HOUR_MS) },
    ]);

    const progress = await leitner.progress(student.id);

    expect(progress.statementCount).toBe(5);
    const test = findTrack(progress, WORDS.test, 'reading');
    expect(test).toMatchObject({ status: 'active', level: 1, due: false, lastResult: 'correct' });
    expect(Date.parse(test!.dueAt!)).toBeGreaterThan(daysFrom(now, 1).getTime() - 2 * HOUR_MS);
    expect(findTrack(progress, WORDS.level, 'reading')).toMatchObject({
      status: 'active',
      level: 0,
      due: true,
      lastResult: 'incorrect',
    });
    expect(findTrack(progress, WORDS.lesson, 'reading')).toMatchObject({
      status: 'active',
      level: 1,
      due: true,
      lastResult: 'incorrect',
      correctCount: 2,
      incorrectCount: 1,
    });
    // Aspects are independent: nothing moved for writing.
    expect(findTrack(progress, WORDS.test, 'writing')).toMatchObject({ status: 'new' });
    expect(progress.summary.active).toEqual({ L0: 1, L1: 2, L2: 0, L3: 0 });

    // Today: the two due tracks first, shakiest first.
    const today = await leitner.dryRun({ playerId: student.id });
    expect(today.picks.slice(0, 2).map((pick) => [trackKey(pick), pick.reason, pick.level])).toEqual([
      [`${learningObjectId(WORDS.level)} · reading`, 'overdue', 0],
      [`${learningObjectId(WORDS.lesson)} · reading`, 'overdue', 1],
    ]);
    expect(today.picks.slice(2).every((pick) => pick.reason !== 'overdue')).toBe(true);

    // Tomorrow, yesterday's L1 is due too: L0 first, then L1 by oldest due date.
    const tomorrow = await leitner.dryRun({ playerId: student.id, now: daysFrom(now, 1).toISOString() });
    expect(tomorrow.picks.slice(0, 3).map((pick) => [trackKey(pick), pick.reason])).toEqual([
      [`${learningObjectId(WORDS.level)} · reading`, 'overdue'],
      [`${learningObjectId(WORDS.lesson)} · reading`, 'overdue'],
      [`${learningObjectId(WORDS.test)} · reading`, 'overdue'],
    ]);
  });

  test('extra practice before a track is due changes nothing (no cramming)', async ({ leitner, stubLrs }) => {
    const student = await leitner.student();
    const now = new Date();
    await stubLrs.seedAssessed(student.externalId, [
      { word: WORDS.test, aspect: 'reading', success: true, at: new Date(now.getTime() - 3 * HOUR_MS) },
      { word: WORDS.test, aspect: 'reading', success: true, at: new Date(now.getTime() - 2 * HOUR_MS) },
      { word: WORDS.test, aspect: 'reading', success: true, at: new Date(now.getTime() - HOUR_MS) },
    ]);

    const progress = await leitner.progress(student.id);

    expect(findTrack(progress, WORDS.test, 'reading')).toMatchObject({
      level: 1,
      due: false,
      seenCount: 3,
      correctCount: 3,
    });
  });

  test('passing a due L3 track retires it; it is never picked again in either scope (Acceptance 5)', async ({
    leitner,
    stubLrs,
  }) => {
    const student = await leitner.student();
    const now = new Date();
    // L1 → L2 → L3 on each due day; the 7-day L3 review is due now.
    await stubLrs.seedAssessed(student.externalId, [
      { word: WORDS.test, aspect: 'reading', success: true, at: daysFrom(now, -20) },
      { word: WORDS.test, aspect: 'reading', success: true, at: daysFrom(now, -19) },
      { word: WORDS.test, aspect: 'reading', success: true, at: daysFrom(now, -16) },
    ]);
    expect(findTrack(await leitner.progress(student.id), WORDS.test, 'reading')).toMatchObject({
      status: 'active',
      level: 3,
      due: true,
    });

    const game = await leitner.newGame(student);
    expect(game.plan.picks[0]).toMatchObject({
      learningObjectId: learningObjectId(WORDS.test),
      aspect: 'reading',
      reason: 'overdue',
      level: 3,
    });
    await leitner.play(game, () => true);
    const result = await leitner.end(game);

    expect(result.exported).toBe(true);
    if (!result.exported) return;
    expect(
      result.summary.changes?.find((change) => trackKey(change) === `${learningObjectId(WORDS.test)} · reading`),
    ).toMatchObject({ change: 'retired', from: { level: 3, status: 'active' }, to: { level: 3, status: 'retired' } });

    const progress = await leitner.progress(student.id);
    const retired = findTrack(progress, WORDS.test, 'reading');
    expect(retired).toMatchObject({ status: 'retired', due: false, dueAt: null });
    expect(retired?.retiredAt).not.toBeNull();
    expect(progress.summary.retired).toBe(1);

    // A month on, with as many picks as the chapter allows, in both scopes.
    const later = daysFrom(now, 30).toISOString();
    for (const scope of ['chapter', 'review'] as const) {
      const plan = await leitner.dryRun({ playerId: student.id, scope, now: later, count: 20 });
      expect(plan.picks.map(trackKey)).not.toContain(`${learningObjectId(WORDS.test)} · reading`);
    }
  });

  test('an L3 track that is not due is never used for practice', async ({ leitner, stubLrs }) => {
    const student = await leitner.student();
    const now = new Date();
    // Reaches L3 two days ago: next due in five days.
    await stubLrs.seedAssessed(student.externalId, [
      { word: WORDS.level, aspect: 'reading', success: true, at: daysFrom(now, -6) },
      { word: WORDS.level, aspect: 'reading', success: true, at: daysFrom(now, -5) },
      { word: WORDS.level, aspect: 'reading', success: true, at: daysFrom(now, -2) },
    ]);

    const plan = await leitner.dryRun({ playerId: student.id, count: 20 });

    expect(findTrack(await leitner.progress(student.id), WORDS.level, 'reading')).toMatchObject({
      level: 3,
      due: false,
    });
    expect(plan.picks.map(trackKey)).not.toContain(`${learningObjectId(WORDS.level)} · reading`);
  });
});

test.describe('scope: this chapter, or this chapter + review (Acceptance 6, L11, L14, L15)', () => {
  test('review brings back due words from other played chapters, in any order; chapter scope does not', async ({
    leitner,
    stubLrs,
  }) => {
    const student = await leitner.student();
    const now = new Date();
    await stubLrs.seedAssessed(student.externalId, [
      // ch. 26, due now.
      { word: WORDS.flu, aspect: 'reading', success: true, at: daysFrom(now, -2) },
      // ch. 26, not due until tomorrow.
      { word: WORDS.fever, aspect: 'reading', success: true, at: new Date(now.getTime() - HOUR_MS) },
      // ch. 29, played before ch. 27 (L15), due now.
      { word: WORDS.direction, aspect: 'reading', success: true, at: daysFrom(now, -2) },
      // Met in ch. 26 but in ch. 27 too: one learning object (L2), due now.
      { word: WORDS.toShow, aspect: 'reading', success: true, at: daysFrom(now, -2) },
    ]);
    const flu = `${learningObjectId(WORDS.flu)} · reading`;
    const fever = `${learningObjectId(WORDS.fever)} · reading`;
    const direction = `${learningObjectId(WORDS.direction)} · reading`;
    const toShow = `${learningObjectId(WORDS.toShow)} · reading`;

    const chapterPlan = await leitner.dryRun({ playerId: student.id, scope: 'chapter' });
    const chapterKeys = chapterPlan.picks.map(trackKey);
    expect(chapterKeys).not.toContain(flu);
    expect(chapterKeys).not.toContain(direction);
    // The shared word keeps the level it earned in ch. 26 and is this chapter's.
    expect(chapterPlan.picks.find((pick) => trackKey(pick) === toShow)).toMatchObject({
      reason: 'overdue',
      level: 1,
      chapter: '27',
    });

    const reviewPlan = await leitner.dryRun({ playerId: student.id, scope: 'review' });
    expect(reviewPlan.picks.find((pick) => trackKey(pick) === flu)).toMatchObject({
      reason: 'review',
      chapter: '26',
    });
    expect(reviewPlan.picks.find((pick) => trackKey(pick) === direction)).toMatchObject({
      reason: 'review',
      chapter: '29',
    });
    expect(reviewPlan.picks.find((pick) => trackKey(pick) === toShow)).toMatchObject({ reason: 'overdue' });
    // Review only brings back due work.
    expect(reviewPlan.picks.map(trackKey)).not.toContain(fever);
    // Review questions draw distractors from the word's own chapter: the question exists and is answerable.
    const fluQuestion = reviewPlan.questions.find((q) => trackKeyOfQuestion(q) === flu);
    expect(fluQuestion?.options.filter((option) => option.isCorrect)).toHaveLength(1);

    // Progress follows the scope: review adds the other chapters' tracks, not in this chapter.
    const chapterProgress = await leitner.progress(student.id, { scope: 'chapter' });
    expect(findTrack(chapterProgress, WORDS.flu, 'reading')).toBeUndefined();
    expect(findTrack(chapterProgress, WORDS.toShow, 'reading')).toMatchObject({ inChapter: true, level: 1 });
    const reviewProgress = await leitner.progress(student.id, { scope: 'review' });
    expect(findTrack(reviewProgress, WORDS.flu, 'reading')).toMatchObject({ inChapter: false, due: true });
    expect(findTrack(reviewProgress, WORDS.direction, 'reading')).toMatchObject({ inChapter: false });
  });
});

test.describe('evidence is per student, and only from Leitner games (Acceptance 7, L4, L17)', () => {
  test("one student's answers never change another student's levels", async ({ leitner, stubLrs }) => {
    const mia = await leitner.student('Mia');
    const leo = await leitner.student('Leo');
    await stubLrs.seedAssessed(mia.externalId, [
      { word: WORDS.test, aspect: 'reading', success: true, at: daysFrom(new Date(), -1) },
    ]);

    const miaProgress = await leitner.progress(mia.id);
    const leoProgress = await leitner.progress(leo.id);

    expect(findTrack(miaProgress, WORDS.test, 'reading')).toMatchObject({ level: 1 });
    expect(leoProgress.statementCount).toBe(0);
    expect(leoProgress.summary.new).toBe(CH27_OBJECTS * 2);
  });

  test('assessed statements from other game kinds do not count', async ({ leitner, stubLrs }) => {
    const student = await leitner.student();
    await stubLrs.seedAssessed(student.externalId, [
      { word: WORDS.test, aspect: 'reading', success: true, at: daysFrom(new Date(), -1), gameKind: 'class' },
    ]);

    const progress = await leitner.progress(student.id);

    expect(progress.statementCount).toBe(1);
    expect(progress.observationCount).toBe(0);
    expect(findTrack(progress, WORDS.test, 'reading')).toMatchObject({ status: 'new' });
  });
});

test.describe('refusals', () => {
  test('bad input → 400; unknown chapter or player → 404', async ({ leitner }) => {
    const student = await leitner.student();

    expect((await leitner.planRaw({ playerId: student.id, aspects: ['listening'], dryRun: true })).status()).toBe(400);
    expect((await leitner.planRaw({ playerId: student.id })).status()).toBe(400); // create needs createdByUserId
    expect((await leitner.planRaw({ playerId: student.id, chapter: 99, dryRun: true })).status()).toBe(404);
    expect((await leitner.planRaw({ playerId: '0000000000000000000000ff', dryRun: true })).status()).toBe(404);
    expect((await leitner.progressRaw(student.id, { chapter: 99 })).status()).toBe(404);
    expect((await leitner.progressRaw('not-an-id')).status()).toBe(400);
  });

  test('a failing LRS read → 502 for both the plan and the progress', async ({ leitner, stubLrs }) => {
    const student = await leitner.student();
    await stubLrs.fail('GET', 500);

    expect((await leitner.planRaw({ playerId: student.id, dryRun: true })).status()).toBe(502);
    expect((await leitner.progressRaw(student.id)).status()).toBe(502);
  });
});

function trackKeyOfQuestion(question: { learningObjectId: string | null; aspect: string | null }): string {
  return `${question.learningObjectId} · ${question.aspect}`;
}
