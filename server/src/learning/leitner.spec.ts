import { assessedStatement } from '../test/leitner-statements';
import { ANSWERED_VERB_ID } from '../xapi/iris';
import {
  applyObservation,
  buildProgress,
  DEFAULT_LEITNER_CONFIG,
  foldTracks,
  isDue,
  LeitnerObservation,
  newTrack,
  observationsFromStatements,
  TrackState,
} from './leitner';
import { KOREAN } from './learning-object';

const EXAM = 'ko/lexeme/시험/test';
const SHOW = 'ko/expression/보여 주다/to-show';

let seq = 0;
function answer(success: boolean, timestamp: string, overrides: Partial<LeitnerObservation> = {}): LeitnerObservation {
  seq++;
  return {
    statementId: `s${String(seq).padStart(4, '0')}`,
    learningObjectId: EXAM,
    aspect: 'reading',
    sourceRef: 'korean-language-book/ch27/vocabulary/1',
    success,
    timestamp: new Date(timestamp).toISOString(),
    ...overrides,
  };
}

function fold(...answers: LeitnerObservation[]): TrackState {
  const tracks = foldTracks(answers);
  expect(tracks).toHaveLength(1);
  return tracks[0];
}

describe('Leitner rules', () => {
  it('starts a track new, level 0, due', () => {
    const track = newTrack(EXAM, 'reading');
    expect(track).toMatchObject({ status: 'new', level: 0, dueAt: null });
    expect(isDue(track, new Date('2026-10-23T09:00:00Z'))).toBe(true);
  });

  it('promotes a correct answer when due, with the next interval (1 → 1 day, 2 → 3, 3 → 7)', () => {
    const l1 = fold(answer(true, '2026-10-01T18:00:00Z'));
    expect(l1).toMatchObject({ status: 'active', level: 1, dueAt: '2026-10-02T18:00:00.000Z' });

    const l3 = fold(
      answer(true, '2026-10-01T18:00:00Z'),
      answer(true, '2026-10-02T18:00:00Z'),
      answer(true, '2026-10-05T18:00:00Z'),
    );
    expect(l3).toMatchObject({ level: 3, dueAt: '2026-10-12T18:00:00.000Z', correctCount: 3 });
  });

  it('does not promote a correct answer before it is due (no cramming)', () => {
    const track = fold(
      answer(true, '2026-10-01T18:00:00Z'),
      answer(true, '2026-10-01T18:05:00Z'),
      answer(true, '2026-10-01T18:10:00Z'),
    );
    expect(track).toMatchObject({ level: 1, dueAt: '2026-10-02T18:00:00.000Z', correctCount: 3, seenCount: 3 });
  });

  it('counts a track as due inside the 4-hour grace window', () => {
    const track = fold(answer(true, '2026-10-01T20:00:00Z'));
    expect(isDue(track, new Date('2026-10-02T15:59:00Z'))).toBe(false);
    expect(isDue(track, new Date('2026-10-02T16:00:00Z'))).toBe(true);
    expect(fold(answer(true, '2026-10-01T20:00:00Z'), answer(true, '2026-10-02T17:00:00Z')).level).toBe(2);
  });

  it('drops one level on a wrong answer and makes it due now (L3)', () => {
    const track = fold(
      answer(true, '2026-10-01T18:00:00Z'),
      answer(true, '2026-10-02T18:00:00Z'),
      answer(false, '2026-10-05T18:00:00Z'),
    );
    expect(track).toMatchObject({ level: 1, dueAt: '2026-10-05T18:00:00.000Z', lastResult: 'incorrect' });
    expect(isDue(track, new Date('2026-10-05T18:01:00Z'))).toBe(true);
  });

  it('demotes even when the wrong answer comes before the track was due', () => {
    const track = fold(answer(true, '2026-10-01T18:00:00Z'), answer(false, '2026-10-01T18:05:00Z'));
    expect(track).toMatchObject({ level: 0, dueAt: '2026-10-01T18:05:00.000Z' });
  });

  it('keeps level 0 as the floor', () => {
    const track = fold(answer(false, '2026-10-01T18:00:00Z'), answer(false, '2026-10-02T18:00:00Z'));
    expect(track).toMatchObject({ status: 'active', level: 0, incorrectCount: 2 });
  });

  it('can reset to 0 instead, by config', () => {
    const l2 = fold(answer(true, '2026-10-01T18:00:00Z'), answer(true, '2026-10-02T18:00:00Z'));
    const reset = applyObservation(l2, answer(false, '2026-10-05T18:00:00Z'), {
      ...DEFAULT_LEITNER_CONFIG,
      onIncorrect: 'reset',
    });
    expect(reset.level).toBe(0);
  });

  it('comes back from a slip at L3: L2 due now, then L3, then retired', () => {
    const track = fold(
      answer(true, '2026-10-01T18:00:00Z'),
      answer(true, '2026-10-02T18:00:00Z'),
      answer(true, '2026-10-05T18:00:00Z'),
      answer(false, '2026-10-12T18:00:00Z'),
      answer(true, '2026-10-13T18:00:00Z'),
    );
    expect(track).toMatchObject({ level: 3, dueAt: '2026-10-20T18:00:00.000Z' });
  });

  it('retires a track that passes a due question at L3 (L13)', () => {
    const track = fold(
      answer(true, '2026-10-01T18:00:00Z'),
      answer(true, '2026-10-02T18:00:00Z'),
      answer(true, '2026-10-05T18:00:00Z'),
      answer(true, '2026-10-12T18:00:00Z'),
    );
    expect(track).toMatchObject({ status: 'retired', level: 3, dueAt: null, retiredAt: '2026-10-12T18:00:00.000Z' });
    expect(isDue(track, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('does not retire on a pass at L3 before it is due', () => {
    const track = fold(
      answer(true, '2026-10-01T18:00:00Z'),
      answer(true, '2026-10-02T18:00:00Z'),
      answer(true, '2026-10-05T18:00:00Z'),
      answer(true, '2026-10-06T18:00:00Z'),
    );
    expect(track).toMatchObject({ status: 'active', level: 3, dueAt: '2026-10-12T18:00:00.000Z' });
  });

  it('treats retired as final: later answers only count', () => {
    const retired = fold(
      answer(true, '2026-10-01T18:00:00Z'),
      answer(true, '2026-10-02T18:00:00Z'),
      answer(true, '2026-10-05T18:00:00Z'),
      answer(true, '2026-10-12T18:00:00Z'),
      answer(false, '2026-10-20T18:00:00Z'),
    );
    expect(retired).toMatchObject({ status: 'retired', level: 3, incorrectCount: 1, lastResult: 'incorrect' });
  });

  it('ignores speed: a slow correct answer still promotes (L12)', () => {
    // LeitnerObservation carries no duration at all; a statement's result.duration is never read.
    const statements = [
      { ...assessedStatement({ id: 'slow', word: '시험', sense: 'test', success: true, timestamp: '2026-10-01T18:00:00Z' }) },
    ];
    (statements[0]['result'] as Record<string, unknown>)['duration'] = 'PT95S';
    expect(foldTracks(observationsFromStatements(statements, KOREAN))[0].level).toBe(1);
  });

  it('folds out-of-order input oldest first', () => {
    const first = answer(true, '2026-10-01T18:00:00Z');
    const second = answer(true, '2026-10-02T18:00:00Z');
    const wrong = answer(false, '2026-10-03T18:00:00Z');
    expect(fold(wrong, second, first)).toEqual(fold(first, second, wrong));
    expect(fold(wrong, second, first).level).toBe(1);
  });

  it('keeps aspects and learning objects on separate tracks', () => {
    const tracks = foldTracks([
      answer(true, '2026-10-01T18:00:00Z'),
      answer(false, '2026-10-01T18:01:00Z', { aspect: 'writing' }),
      answer(true, '2026-10-01T18:02:00Z', { learningObjectId: SHOW }),
    ]);
    expect(tracks.map((track) => [track.learningObjectId, track.aspect, track.level])).toEqual([
      [EXAM, 'reading', 1],
      [EXAM, 'writing', 0],
      [SHOW, 'reading', 1],
    ]);
  });

  it('folds one sense met in two chapters into one track and records both sources (L2)', () => {
    const track = fold(
      answer(true, '2026-10-01T18:00:00Z', { learningObjectId: SHOW, sourceRef: 'korean-language-book/ch26/vocabulary/6' }),
      answer(true, '2026-10-02T18:00:00Z', { learningObjectId: SHOW, sourceRef: 'korean-language-book/ch27/vocabulary/5' }),
    );
    expect(track).toMatchObject({ level: 2, sources: ['korean-language-book/ch26/vocabulary/6', 'korean-language-book/ch27/vocabulary/5'] });
  });
});

describe('observationsFromStatements', () => {
  const base = { word: '시험', sense: 'test', success: true, timestamp: '2026-10-01T18:00:00Z' };

  it('reads a direct assessed statement', () => {
    expect(observationsFromStatements([assessedStatement({ id: 'a', ...base })], KOREAN)).toEqual([
      {
        statementId: 'a',
        learningObjectId: EXAM,
        aspect: 'reading',
        sourceRef: 'korean-language-book/ch27/vocabulary/1',
        success: true,
        timestamp: '2026-10-01T18:00:00.000Z',
      },
    ]);
  });

  it('keeps two senses of one word on separate tracks', () => {
    const tracks = foldTracks(
      observationsFromStatements(
        [
          assessedStatement({ id: 'a', ...base, word: '배', sense: 'pear' }),
          assessedStatement({ id: 'b', ...base, word: '배', sense: 'ship', success: false }),
        ],
        KOREAN,
      ),
    );
    expect(tracks.map((track) => [track.learningObjectId, track.level])).toEqual([
      ['ko/lexeme/배/pear', 1],
      ['ko/lexeme/배/ship', 0],
    ]);
  });

  it('folds evidence from two books into one track (A1)', () => {
    const tracks = foldTracks(
      observationsFromStatements(
        [
          assessedStatement({ id: 'a', ...base }),
          assessedStatement({ id: 'b', ...base, book: 'other-book', timestamp: '2026-10-02T18:00:00Z' }),
        ],
        KOREAN,
      ),
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      level: 2,
      sources: ['korean-language-book/ch27/vocabulary/1', 'other-book/ch27/vocabulary/1'],
    });
  });

  it('ignores class games and other game kinds (v1)', () => {
    expect(observationsFromStatements([assessedStatement({ id: 'a', ...base, gameKind: 'class' })], KOREAN)).toEqual([]);
  });

  it('ignores indirect observations until the strength policy exists', () => {
    expect(observationsFromStatements([assessedStatement({ id: 'a', ...base, strength: 'indirect' })], KOREAN)).toEqual([]);
  });

  it('ignores answered, malformed, rated and other-language statements', () => {
    const answered = { ...assessedStatement({ id: 'v', ...base }), verb: { id: ANSWERED_VERB_ID } };
    const notALearningObject = { ...assessedStatement({ id: 'o', ...base }), object: { id: 'https://kogs.link/xapi/emoji-app/games/g1' } };
    const noSuccess = assessedStatement({ id: 'n', ...base });
    noSuccess['result'] = {};
    const japanese = assessedStatement({ id: 'j', ...base, language: 'ja' });

    expect(observationsFromStatements([answered, notALearningObject, noSuccess, japanese, null, 'x'], KOREAN)).toEqual([]);
  });
});

describe('buildProgress', () => {
  const now = new Date('2026-10-23T09:00:00Z');
  const chapterObjectIds = [EXAM, SHOW];
  const tracks = foldTracks([
    answer(true, '2026-10-22T18:00:00Z'),
    answer(false, '2026-10-20T18:00:00Z', { learningObjectId: 'ko/lexeme/독감/flu' }),
    answer(true, '2026-10-20T18:00:00Z', { learningObjectId: 'ko/lexeme/간호사/nurse', aspect: 'listening' }),
  ]);

  it('lists the chapter × aspects, new ones included, for chapter scope', () => {
    const { tracks: result, summary } = buildProgress({
      chapterObjectIds,
      aspects: ['reading', 'writing'],
      tracks,
      scope: 'chapter',
      now,
    });
    expect(result.map((track) => [track.learningObjectId, track.aspect, track.status, track.due])).toEqual([
      [EXAM, 'reading', 'active', false],
      [EXAM, 'writing', 'new', true],
      [SHOW, 'reading', 'new', true],
      [SHOW, 'writing', 'new', true],
    ]);
    expect(summary).toEqual({ new: 3, active: { L0: 0, L1: 1, L2: 0, L3: 0 }, retired: 0, due: 3 });
  });

  it('adds tracks from other played chapters for review scope, in the requested aspects only', () => {
    const { tracks: result } = buildProgress({ chapterObjectIds, aspects: ['reading', 'writing'], tracks, scope: 'review', now });
    const review = result.filter((track) => !track.inChapter);
    expect(review.map((track) => [track.learningObjectId, track.level, track.due])).toEqual([
      ['ko/lexeme/독감/flu', 0, true],
    ]);
  });
});
