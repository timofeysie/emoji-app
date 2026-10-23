import { foldTracks, LeitnerObservation, TrackState } from './leitner';
import { PlanInput, PlanObject, planNextGame, seedFrom } from './planner';

const NOW = new Date('2026-10-23T09:00:00Z');

/** Chapter 27-ish objects: w0 … w(n-1). */
function objects(n: number, chapter = '27'): PlanObject[] {
  return Array.from({ length: n }, (_, i) => ({ learningObjectId: `ko/lexeme/w${i}/s`, sourceRef: `ch${chapter}/vocabulary/${i}` }));
}

let seq = 0;
function obs(learningObjectId: string, aspect: string, success: boolean, timestamp: string): LeitnerObservation {
  seq++;
  return {
    statementId: `s${String(seq).padStart(4, '0')}`,
    learningObjectId,
    aspect,
    sourceRef: 'korean-language-book/ch27/vocabulary/0',
    success,
    timestamp,
  };
}

/** A track driven to `level` with correct answers spaced exactly by the intervals, last one at `lastAt`. */
function trackAt(learningObjectId: string, aspect: string, level: 1 | 2 | 3, lastAt: string): LeitnerObservation[] {
  const days = { 1: [0], 2: [-1, 0], 3: [-4, -3, 0] }[level];
  return days.map((d) => obs(learningObjectId, aspect, true, new Date(Date.parse(lastAt) + d * 86_400_000).toISOString()));
}

function plan(overrides: Partial<PlanInput> & { observations?: LeitnerObservation[] } = {}) {
  const { observations = [], ...rest } = overrides;
  const tracks: TrackState[] = foldTracks(observations);
  return planNextGame({
    chapterObjects: objects(14),
    reviewObjects: [],
    aspects: ['reading', 'writing'],
    tracks,
    now: NOW,
    count: 10,
    maxNew: 4,
    fill: true,
    canBuild: () => true,
    ...rest,
  });
}

const summary = (picks: ReturnType<typeof plan>['picks']) =>
  picks.map((pick) => `${pick.learningObjectId.split('/')[2]}:${pick.aspect}:${pick.reason}`);

describe('planNextGame', () => {
  it('gives a new student maxNew new words in chapter order, alternating aspects, and no fill', () => {
    const { picks, report } = plan();
    expect(summary(picks)).toEqual(['w0:reading:new', 'w1:writing:new', 'w2:reading:new', 'w3:writing:new']);
    expect(report).toMatchObject({ available: { new: 28, overdue: 0, practice: 0, review: 0 }, short: true });
  });

  it('puts overdue first (lowest level, then oldest due), then new, then practice fill', () => {
    const observations = [
      // w0 reading L2, due 2026-10-23 (answered 10-20) → overdue
      ...trackAt('ko/lexeme/w0/s', 'reading', 2, '2026-10-20T08:00:00Z'),
      // w1 reading L1, due 10-22 → overdue, lower level → first
      ...trackAt('ko/lexeme/w1/s', 'reading', 1, '2026-10-21T08:00:00Z'),
      // w2 writing wrong → L0, due now → overdue, lowest
      obs('ko/lexeme/w2/s', 'writing', false, '2026-10-22T08:00:00Z'),
      // w3 reading and writing L1, answered today → not due → practice (one of them)
      ...trackAt('ko/lexeme/w3/s', 'reading', 1, '2026-10-23T08:00:00Z'),
      ...trackAt('ko/lexeme/w3/s', 'writing', 1, '2026-10-23T08:00:00Z'),
    ];
    const { picks } = plan({ observations });
    expect(summary(picks).slice(0, 3)).toEqual(['w2:writing:overdue', 'w1:reading:overdue', 'w0:reading:overdue']);
    expect(summary(picks).slice(3, 7)).toEqual(['w4:reading:new', 'w5:writing:new', 'w6:reading:new', 'w7:writing:new']);
    expect(summary(picks).slice(7)).toEqual(['w3:reading:practice']);
  });

  it('asks only one aspect per learning object per game', () => {
    const observations = [
      obs('ko/lexeme/w0/s', 'reading', false, '2026-10-22T08:00:00Z'),
      obs('ko/lexeme/w0/s', 'writing', false, '2026-10-22T09:00:00Z'),
    ];
    const ids = plan({ observations }).picks.map((pick) => pick.learningObjectId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never picks retired tracks, and never uses L3 for practice', () => {
    const retired = [...trackAt('ko/lexeme/w0/s', 'reading', 3, '2026-10-10T08:00:00Z'), obs('ko/lexeme/w0/s', 'reading', true, '2026-10-17T08:00:00Z')];
    const l3NotDue = trackAt('ko/lexeme/w1/s', 'reading', 3, '2026-10-22T08:00:00Z');
    const { picks } = plan({
      chapterObjects: objects(2),
      aspects: ['reading'],
      observations: [...retired, ...l3NotDue],
      maxNew: 0,
    });
    expect(picks).toEqual([]);
  });

  it('brings back an L3 track when its review is due', () => {
    const { picks } = plan({
      chapterObjects: objects(1),
      aspects: ['reading'],
      observations: trackAt('ko/lexeme/w0/s', 'reading', 3, '2026-10-16T08:00:00Z'),
    });
    expect(summary(picks)).toEqual(['w0:reading:overdue']);
    expect(picks[0]).toMatchObject({ level: 3, status: 'active' });
  });

  it('fills with practice, or comes back short with fill off', () => {
    const observations = objects(14).flatMap((o) => trackAt(o.learningObjectId, 'reading', 1, '2026-10-23T08:00:00Z'));
    const filled = plan({ observations, aspects: ['reading'] });
    expect(filled.picks).toHaveLength(10);
    expect(filled.picks.every((pick) => pick.reason === 'practice')).toBe(true);

    const unfilled = plan({ observations, aspects: ['reading'], fill: false });
    expect(unfilled.picks).toEqual([]);
    expect(unfilled.report.short).toBe(true);
  });

  describe('review scope', () => {
    const ch26 = objects(3, '26').map((o, i) => ({ ...o, learningObjectId: `ko/lexeme/r${i}/s` }));

    it('adds due tracks from other played chapters, competing freely with this chapter (L14)', () => {
      const observations = [
        obs('ko/lexeme/r0/s', 'reading', false, '2026-10-20T08:00:00Z'), // L0, due → review, first
        ...trackAt('ko/lexeme/r1/s', 'reading', 1, '2026-10-23T08:00:00Z'), // not due → never
        ...trackAt('ko/lexeme/w0/s', 'writing', 1, '2026-10-21T08:00:00Z'), // L1 due → overdue
      ];
      const { picks, report } = plan({ reviewObjects: ch26, observations });
      expect(summary(picks).slice(0, 2)).toEqual(['r0:reading:review', 'w0:writing:overdue']);
      expect(picks[0].sourceRef).toBe('ch26/vocabulary/0');
      expect(picks.some((pick) => pick.learningObjectId === 'ko/lexeme/r1/s')).toBe(false);
      expect(report.available.review).toBe(1);
    });

    it('never introduces new words or practice from other chapters', () => {
      const { picks } = plan({ reviewObjects: ch26, chapterObjects: [], observations: trackAt('ko/lexeme/r1/s', 'reading', 1, '2026-10-23T08:00:00Z') });
      expect(picks).toEqual([]);
    });

    it('treats a shared word as this chapter’s (L2)', () => {
      const shared = { learningObjectId: 'ko/lexeme/w0/s', sourceRef: 'ch26/vocabulary/9' };
      const { picks } = plan({
        reviewObjects: [shared],
        observations: [obs('ko/lexeme/w0/s', 'reading', false, '2026-10-20T08:00:00Z')],
      });
      expect(picks[0]).toMatchObject({ learningObjectId: 'ko/lexeme/w0/s', reason: 'overdue', sourceRef: 'ch27/vocabulary/0' });
    });
  });

  it('skips a pick that cannot be built, reports it, and takes the next candidate', () => {
    const { picks, report } = plan({ canBuild: (object, aspect) => !(object.learningObjectId === 'ko/lexeme/w1/s' && aspect === 'writing') });
    expect(summary(picks)).toEqual(['w0:reading:new', 'w1:reading:new', 'w2:reading:new', 'w3:writing:new']);
    expect(report.skipped).toEqual([{ learningObjectId: 'ko/lexeme/w1/s', sourceRef: 'ch27/vocabulary/1', aspect: 'writing', why: 'unbuildable' }]);
  });

  it('is deterministic', () => {
    const observations = [obs('ko/lexeme/w5/s', 'reading', false, '2026-10-20T08:00:00Z')];
    expect(plan({ observations })).toEqual(plan({ observations }));
  });

  it('respects count', () => {
    expect(plan({ count: 2 }).picks).toHaveLength(2);
  });
});

describe('seedFrom', () => {
  it('is stable, positive and differs per day', () => {
    expect(seedFrom('p1:2026-10-23')).toBe(seedFrom('p1:2026-10-23'));
    expect(seedFrom('p1:2026-10-23')).not.toBe(seedFrom('p1:2026-10-24'));
    expect(seedFrom('x')).toBeGreaterThanOrEqual(0);
  });
});
