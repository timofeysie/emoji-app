import { ANSWERED_VERB, ASSESSED_VERB, EXT } from '../fixtures/stub-lrs';
import {
  allCorrectExcept,
  CH27_OBJECTS,
  daysFrom,
  expect,
  test,
  trackKey,
} from '../fixtures/leitner';

/**
 * A solo Leitner game from creation to deletion
 * (docs/xAPI/leitner-method.md → Leitner game lifecycle, Referee flow,
 * Acceptance 2, 3 and 8).
 */

const SCORED_VERB = 'http://adlnet.gov/expapi/verbs/scored';

test.describe('play, auto-export, delete (Acceptance 2, 3, L10)', () => {
  test('a played game with wrong answers exports itself, is deleted, and the summary shows what moved', async ({
    api,
    leitner,
    stubLrs,
  }) => {
    const student = await leitner.student('Mia');
    const game = await leitner.newGame(student);
    expect(game.plan.picks).toHaveLength(10);
    const wrong = game.plan.questions.slice(0, 3).map((question) => question.learningObjectId!);

    await leitner.play(game, allCorrectExcept(wrong));
    const result = await leitner.end(game);

    // 10 answered + 10 assessed + 1 scored.
    expect(result).toMatchObject({ exported: true, deleted: true, statementsSent: 21 });
    if (!result.exported) return;
    expect(result.summary.score).toEqual({ correct: 7, total: 10 });
    const changes = result.summary.changes!;
    expect(changes).toHaveLength(10);
    for (const change of changes) {
      if (wrong.includes(change.learningObjectId)) {
        expect(change).toMatchObject({ change: 'unchanged', from: { status: 'new' }, to: { level: 0, status: 'active' } });
      } else {
        expect(change).toMatchObject({ change: 'promoted', from: { level: 0, status: 'new' }, to: { level: 1, status: 'active' } });
      }
    }

    // Single-use: gone from the database and the games list.
    expect(await leitner.gameOrNull(game.gameId)).toBeNull();
    const { games } = (await (await api.request.get('/api/games')).json()) as { games: Array<{ id: string }> };
    expect(games.map((g) => g.id)).not.toContain(game.gameId);

    // What reached the LRS.
    const statements = await stubLrs.statementsForGame(game.gameId);
    const answered = statements.filter((s) => s.verb.id === ANSWERED_VERB);
    const assessed = statements.filter((s) => s.verb.id === ASSESSED_VERB);
    expect(answered).toHaveLength(10);
    expect(assessed).toHaveLength(10);
    expect(statements.filter((s) => s.verb.id === SCORED_VERB)).toHaveLength(1);
    const answeredIds = new Set(answered.map((s) => s.id));
    for (const statement of assessed) {
      expect(statement.actor.account.name).toBe(student.externalId);
      expect(statement.object.id).toMatch(/^https:\/\/kogs\.link\/xapi\/emoji-app\/lo\/ko\/(lexeme|expression)\//);
      expect(statement.context.extensions).toMatchObject({
        [EXT.gameKind]: 'leitner-solo',
        [EXT.role]: 'whole',
        [EXT.strength]: 'direct',
        [EXT.scorer]: 'choice-whole@1',
      });
      expect(statement.context.extensions?.[EXT.sourceRef]).toMatch(/^korean-language-book\/ch27\/vocabulary\/\d+$/);
      expect(['reading', 'writing']).toContain(statement.context.extensions?.[EXT.aspect]);
      // Each observation points at the answered statement it was scored from.
      expect(answeredIds.has(statement.context.statement!.id)).toBe(true);
    }
    for (const statement of answered) {
      // The learning object is in grouping, so related-activity queries find every attempt.
      expect(statement.context.contextActivities?.grouping?.[0]?.id).toMatch(/\/lo\/ko\//);
      expect(statement.context.extensions?.[EXT.gameKind]).toBe('leitner-solo');
    }
    // The title reaches the LRS: the label, never the first name.
    for (const statement of statements) {
      expect(JSON.stringify(statement)).not.toContain(student.firstName);
    }

    // The next plan: correct tracks at L1 (due tomorrow), wrong ones L0 and due now.
    const progress = await leitner.progress(student.id);
    const played = progress.tracks.filter((track) => track.status !== 'new');
    expect(played).toHaveLength(10);
    const [shaky, learnt] = partition(played, (track) => wrong.includes(track.learningObjectId));
    expect(shaky.every((track) => track.level === 0 && track.due && track.lastResult === 'incorrect')).toBe(true);
    expect(learnt.every((track) => track.level === 1 && !track.due && track.lastResult === 'correct')).toBe(true);
    expect(progress.summary).toMatchObject({ new: CH27_OBJECTS * 2 - 10, active: { L0: 3, L1: 7, L2: 0, L3: 0 } });

    const today = await leitner.dryRun({ playerId: student.id });
    expect(today.picks.slice(0, 3).map((pick) => pick.reason)).toEqual(['overdue', 'overdue', 'overdue']);
    expect(today.picks.slice(0, 3).map((pick) => pick.learningObjectId).sort()).toEqual([...wrong].sort());

    // Tomorrow: L0 first, then the L1 tracks, all due.
    const tomorrow = await leitner.dryRun({ playerId: student.id, now: daysFrom(new Date(), 1).toISOString() });
    expect(tomorrow.picks.map((pick) => pick.reason)).toEqual(Array(10).fill('overdue'));
    expect(tomorrow.picks.map((pick) => pick.level)).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1]);
    expect(tomorrow.picks.map(trackKey).sort()).toEqual(played.map(trackKey).sort());
  });

  test('ending a game mid-way exports what was answered; unanswered words stay new', async ({ leitner }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student);
    const [first, ...rest] = game.plan.questions;

    await leitner.start(game);
    await leitner.openRound(game, first.sequence);
    await leitner.answer(game, first.sequence, true);
    const result = await leitner.end(game);

    expect(result).toMatchObject({ exported: true, deleted: true, statementsSent: 3 });
    if (!result.exported) return;
    // The score is out of every round in the game; unanswered tracks show as unchanged.
    expect(result.summary.score).toEqual({ correct: 1, total: 10 });
    expect(result.summary.changes?.filter((change) => change.change === 'promoted')).toHaveLength(1);
    expect(result.summary.changes?.filter((change) => change.change === 'unchanged')).toHaveLength(9);
    const progress = await leitner.progress(student.id);
    expect(progress.tracks.filter((track) => track.status !== 'new').map(trackKey)).toEqual([
      `${first.learningObjectId} · ${first.aspect}`,
    ]);
    for (const question of rest) {
      const track = progress.tracks.find((t) => trackKey(t) === `${question.learningObjectId} · ${question.aspect}`);
      expect(track).toMatchObject({ status: 'new', due: true });
    }
  });
});

test.describe('one game per student at a time (L19)', () => {
  test('a new plan supersedes an unplayed game; a game being played blocks planning with 409', async ({
    api,
    leitner,
  }) => {
    const student = await leitner.student();
    const first = await leitner.newGame(student);

    const second = await leitner.newGame(student);
    expect(second.plan.supersedes).toEqual([first.gameId]);
    expect(await leitner.gameOrNull(first.gameId)).toBeNull();

    await leitner.start(second);
    for (const state of ['active', 'paused'] as const) {
      if (state === 'paused') await api.setGameState(second.gameId, 'paused');
      const blocked = await leitner.planRaw({ playerId: student.id, dryRun: true });
      expect(blocked.status()).toBe(409);
      expect(await blocked.json()).toMatchObject({ inPlay: [second.gameId] });
    }
  });

  test("a cancelled game can't be restarted, its answers are never exported, and the next plan replaces it", async ({
    api,
    leitner,
    stubLrs,
  }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student);
    await leitner.start(game);
    await leitner.openRound(game, 1);
    await leitner.answer(game, 1, true);
    await api.setGameState(game.gameId, 'paused');
    await api.setGameState(game.gameId, 'cancelled');

    const restart = await api.request.post(`/api/games/${game.gameId}/state`, { data: { state: 'ready' } });
    expect(restart.status()).toBe(400);
    expect(await restart.text()).toMatch(/single-use/);

    const next = await leitner.newGame(student);
    expect(next.plan.supersedes).toEqual([game.gameId]);
    expect(await leitner.gameOrNull(game.gameId)).toBeNull();
    expect(await stubLrs.statementsForGame(game.gameId)).toEqual([]);
    expect((await leitner.progress(student.id)).statementCount).toBe(0);
  });
});

test.describe('pending export and Retry', () => {
  test('a failed export keeps the game, blocks the next plan, and Retry exports and deletes it', async ({
    api,
    leitner,
    stubLrs,
  }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student);
    await leitner.start(game);
    await leitner.openRound(game, 1);
    await leitner.answer(game, 1, true);

    await stubLrs.fail('POST', 503);
    const failed = await leitner.end(game);

    // The state change still succeeds; the export is pending.
    expect(failed).toMatchObject({ exported: false, status: 502 });
    const pending = await leitner.gameOrNull(game.gameId);
    expect(pending).toMatchObject({ state: 'completed', kind: 'leitner-solo' });
    expect(pending?.exportError).toBeTruthy();
    const { games } = (await (await api.request.get('/api/games')).json()) as {
      games: Array<{ id: string; kind: string; state: string }>;
    };
    expect(games.find((g) => g.id === game.gameId)).toMatchObject({ kind: 'leitner-solo', state: 'completed' });

    // Planning on stale levels is refused until it's in the LRS.
    expect((await leitner.progress(student.id)).pendingExport).toEqual([
      expect.objectContaining({ gameId: game.gameId }),
    ]);
    const blocked = await leitner.planRaw({ playerId: student.id, dryRun: true });
    expect(blocked.status()).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: 'Previous Leitner game not exported yet',
      pendingExport: [expect.objectContaining({ gameId: game.gameId })],
    });
    // No Play Again for a Leitner game.
    expect((await api.request.post(`/api/games/${game.gameId}/state`, { data: { state: 'ready' } })).status()).toBe(400);

    // A Retry that fails again keeps it pending.
    expect((await api.exportGameRaw(game.gameId)).status()).toBe(502);
    expect(await leitner.gameOrNull(game.gameId)).not.toBeNull();

    await stubLrs.clearFailures();
    const retried = await api.exportGameRaw(game.gameId);
    expect(retried.status()).toBe(200);
    expect(await retried.json()).toMatchObject({
      ok: true,
      statementsSent: 3,
      deleted: true,
      summary: { score: { correct: 1, total: 10 }, changes: expect.arrayContaining([expect.objectContaining({ change: 'promoted' })]) },
    });
    expect(await leitner.gameOrNull(game.gameId)).toBeNull();

    const progress = await leitner.progress(student.id);
    expect(progress.pendingExport).toEqual([]);
    expect(progress.summary.active.L1).toBe(1);
    expect((await leitner.planRaw({ playerId: student.id, dryRun: true })).status()).toBe(200);
  });
});

test.describe('the badge belongs to the student (Referee flow step 4)', () => {
  test('binding another player is refused; the student can be bound, and moved to a spare badge', async ({
    api,
    games,
    leitner,
  }) => {
    const student = await leitner.student('Mia');
    const other = await leitner.student('Leo');
    const game = await leitner.newGame(student);

    const refused = await api.request.put(
      `/api/games/${game.gameId}/player-bindings/${encodeURIComponent(game.badge)}`,
      { data: { playerId: other.id } },
    );
    expect(refused.status()).toBe(400);

    const first = await api.bindPlayer(game.gameId, game.badge, student.id);
    expect(first.reason).toBe('initial');

    // A broken badge: the student moves to a spare one on another station.
    const spare = games.name('spare');
    await api.bindStation(game.gameId, games.name('st-spare'), [spare]);
    await api.bindPlayer(game.gameId, spare, student.id);
    const { bindings } = await api.getPlayerBindings(game.gameId);
    // One active binding at a time: the old badge's binding is ended, not deleted.
    expect(bindings.filter((b) => b.unassignedAt === null).map((b) => [b.badgeName, b.player.id])).toEqual([
      [spare, student.id],
    ]);
    expect(bindings.filter((b) => b.unassignedAt !== null).map((b) => [b.badgeName, b.player.id])).toEqual([
      [game.badge, student.id],
    ]);
  });

  test("a badge that answered without being bound is attributed to the student at export", async ({ leitner, stubLrs }) => {
    const student = await leitner.student();
    const game = await leitner.newGame(student);
    await leitner.start(game);
    await leitner.openRound(game, 1);
    await leitner.answer(game, 1, false);

    const result = await leitner.end(game);

    expect(result).toMatchObject({ exported: true });
    const statements = await stubLrs.statementsForGame(game.gameId);
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((s) => s.actor.account.name === student.externalId)).toBe(true);
  });
});

test.describe('class games are unchanged (Acceptance 8, L6)', () => {
  test('a class game exports untagged statements, is kept, can Play Again, and touches no levels', async ({
    api,
    games,
    leitner,
    stubLrs,
  }) => {
    const game = await games.completedGameWithGuesses({ badges: ['red'], answers: { red: 'A' } });
    const mia = await leitner.student('Mia');
    await api.bindPlayer(game.gameId, game.badges['red'], mia.id);

    expect(await api.exportGame(game.gameId)).toEqual({ ok: true, statementsSent: 2 });

    const statements = await stubLrs.statementsForGame(game.gameId);
    expect(statements.map((s) => s.verb.id).sort()).toEqual([ANSWERED_VERB, SCORED_VERB].sort());
    for (const statement of statements) {
      expect(statement.context.contextActivities?.grouping).toBeUndefined();
      expect(statement.context.extensions?.[EXT.gameKind]).toBeUndefined();
    }
    expect(await leitner.gameOrNull(game.gameId)).toMatchObject({ kind: 'class', state: 'completed' });
    await api.setGameState(game.gameId, 'ready');
    expect((await leitner.progress(mia.id)).statementCount).toBe(0);
  });
});

function partition<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  return [items.filter(predicate), items.filter((item) => !predicate(item))];
}
