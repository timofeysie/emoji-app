import type { LeitnerPickReason } from '../persistence/domain-types';
import { DEFAULT_LEITNER_CONFIG, isDue, LeitnerConfig, newTrack, TrackState } from './leitner';

/**
 * Picks a student's next learning objects × aspects
 * (docs/xAPI/leitner-method.md → Choosing the next learning objects).
 * Pure and deterministic: the same input always gives the same plan.
 */

export type PlanObject = {
  learningObjectId: string;
  /** Entry to build the question from, in the game's book: `ch27/vocabulary/1`. */
  sourceRef: string;
};

export type PlanPick = PlanObject & {
  aspect: string;
  reason: LeitnerPickReason;
  /** The track as it was when planned. */
  level: TrackState['level'];
  status: TrackState['status'];
  dueAt: string | null;
};

export type PlanSkip = PlanObject & { aspect: string; why: 'unbuildable' };

export type PlanReport = {
  /** Candidates per kind, before the count was applied. */
  available: Record<LeitnerPickReason, number>;
  picked: Record<LeitnerPickReason, number>;
  /** Picks that couldn't be made into a question; the next candidate was taken. */
  skipped: PlanSkip[];
  /** Fewer picks than `count`. */
  short: boolean;
};

export type PlanInput = {
  /** This chapter's learning objects, de-duplicated, in chapter order. */
  chapterObjects: readonly PlanObject[];
  /**
   * Scope `review`: learning objects outside this chapter that the student
   * has evidence for, with an entry in the book to build from. Empty for
   * scope `chapter`.
   */
  reviewObjects: readonly PlanObject[];
  aspects: readonly string[];
  /** The student's tracks, whole language. */
  tracks: readonly TrackState[];
  now: Date;
  count: number;
  maxNew: number;
  fill: boolean;
  /** False when no question can be built for this pick (e.g. no misspellings). */
  canBuild: (object: PlanObject, aspect: string) => boolean;
  config?: LeitnerConfig;
};

type Candidate = PlanObject & { aspect: string; track: TrackState; order: number };

function trackKey(learningObjectId: string, aspect: string): string {
  return JSON.stringify([learningObjectId, aspect]);
}

/** Lowest level first, then soonest due, then chapter order. */
function byLevelThenDue(a: Candidate, b: Candidate): number {
  return (
    a.track.level - b.track.level ||
    Date.parse(a.track.dueAt ?? '') - Date.parse(b.track.dueAt ?? '') ||
    a.order - b.order
  );
}

/**
 * Priority (L11, L14):
 * 1. overdue (this chapter) and review (other chapters, scope `review`),
 *    competing freely: lowest level first, then oldest `dueAt`;
 * 2. new, up to `maxNew`, from this chapter in chapter order, alternating
 *    aspects;
 * 3. practice fill (when `fill`): this chapter's not-due tracks at L0–L2.
 * Never retired tracks, never L3 for practice, one aspect per learning
 * object per game, and unbuildable picks are skipped and reported.
 */
export function planNextGame(input: PlanInput): { picks: PlanPick[]; report: PlanReport } {
  const config = input.config ?? DEFAULT_LEITNER_CONFIG;
  const byKey = new Map(input.tracks.map((track) => [trackKey(track.learningObjectId, track.aspect), track]));
  const trackFor = (id: string, aspect: string) => byKey.get(trackKey(id, aspect)) ?? newTrack(id, aspect);

  const chapter: Candidate[] = [];
  input.chapterObjects.forEach((object, index) => {
    input.aspects.forEach((aspect, aspectIndex) => {
      const track = trackFor(object.learningObjectId, aspect);
      if (track.status !== 'retired') {
        chapter.push({ ...object, aspect, track, order: index * input.aspects.length + aspectIndex });
      }
    });
  });
  const chapterIds = new Set(input.chapterObjects.map((object) => object.learningObjectId));
  const review: Candidate[] = [];
  input.reviewObjects.forEach((object, index) => {
    if (chapterIds.has(object.learningObjectId)) return;
    input.aspects.forEach((aspect, aspectIndex) => {
      const track = byKey.get(trackKey(object.learningObjectId, aspect));
      if (track && track.status === 'active' && isDue(track, input.now, config)) {
        review.push({ ...object, aspect, track, order: chapter.length + index * input.aspects.length + aspectIndex });
      }
    });
  });

  const overdue = chapter.filter((c) => c.track.status === 'active' && isDue(c.track, input.now, config));
  const fresh = chapter.filter((c) => c.track.status === 'new');
  const practice = chapter.filter(
    (c) => c.track.status === 'active' && !isDue(c.track, input.now, config) && c.track.level < 3,
  );

  const picks: PlanPick[] = [];
  const skipped: PlanSkip[] = [];
  const usedObjects = new Set<string>();
  const picked: Record<LeitnerPickReason, number> = { overdue: 0, review: 0, new: 0, practice: 0 };

  const tryPick = (candidate: Candidate, reason: LeitnerPickReason): boolean => {
    if (picks.length >= input.count || usedObjects.has(candidate.learningObjectId)) return false;
    const object = { learningObjectId: candidate.learningObjectId, sourceRef: candidate.sourceRef };
    if (!input.canBuild(object, candidate.aspect)) {
      skipped.push({ ...object, aspect: candidate.aspect, why: 'unbuildable' });
      return false;
    }
    usedObjects.add(candidate.learningObjectId);
    picked[reason]++;
    picks.push({
      ...object,
      aspect: candidate.aspect,
      reason,
      level: candidate.track.level,
      status: candidate.track.status,
      dueAt: candidate.track.dueAt,
    });
    return true;
  };

  // 1. Overdue and review compete freely (L14).
  const reviewKeys = new Set(review.map((c) => trackKey(c.learningObjectId, c.aspect)));
  for (const candidate of [...overdue, ...review].sort(byLevelThenDue)) {
    tryPick(candidate, reviewKeys.has(trackKey(candidate.learningObjectId, candidate.aspect)) ? 'review' : 'overdue');
  }

  // 2. New, chapter order. The n-th new pick prefers aspects[n % aspects.length],
  // so one game introduces words for every aspect.
  let newCount = 0;
  const freshByObject = new Map<string, Candidate[]>();
  for (const candidate of fresh) {
    freshByObject.set(candidate.learningObjectId, [...(freshByObject.get(candidate.learningObjectId) ?? []), candidate]);
  }
  for (const candidates of freshByObject.values()) {
    if (newCount >= input.maxNew) break;
    const preferred = input.aspects[newCount % input.aspects.length];
    const ordered = [...candidates].sort((a, b) => Number(b.aspect === preferred) - Number(a.aspect === preferred));
    for (const candidate of ordered) {
      if (tryPick(candidate, 'new')) {
        newCount++;
        break;
      }
    }
  }

  // 3. Practice fill: L0–L2 only, so an L3 word's next question is its due review.
  if (input.fill) {
    for (const candidate of [...practice].sort(byLevelThenDue)) {
      tryPick(candidate, 'practice');
    }
  }

  return {
    picks,
    report: {
      available: { overdue: overdue.length, review: review.length, new: fresh.length, practice: practice.length },
      picked,
      skipped,
      short: picks.length < input.count,
    },
  };
}

/** A stable 31-bit seed from text, e.g. `${playerId}:${YYYY-MM-DD}` (FNV-1a). */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7fffffff;
}
