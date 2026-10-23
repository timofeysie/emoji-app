import { z } from 'zod';
import { ANSWERED_VERB_ID } from '../xapi/iris';
import {
  EXT_ASPECT,
  EXT_GAME_KIND,
  EXT_SOURCE_REF,
  learningObjectId,
  parseLearningObjectIri,
} from './learning-object';

/**
 * Leitner levels from a student's `answered` statements
 * (docs/xAPI/leitner-method.md → The Leitner rules). Pure: the same
 * statements and config always give the same tracks, so rules can change
 * and history is simply recomputed.
 */

export type Level = 0 | 1 | 2 | 3;

export type LeitnerConfig = {
  /** Days until due after a correct answer lands on this level. */
  intervalDays: Record<1 | 2 | 3, number>;
  /** A track is due this many hours before `dueAt` (evening players). */
  graceHours: number;
  /** L3: `demote` drops one level; `reset` goes back to 0. */
  onIncorrect: 'demote' | 'reset';
  /** `ext/game-kind` values whose answers count (class games don't, v1). */
  countedGameKinds: readonly string[];
};

export const DEFAULT_LEITNER_CONFIG: LeitnerConfig = {
  intervalDays: { 1: 1, 2: 3, 3: 7 },
  graceHours: 4,
  onIncorrect: 'demote',
  countedGameKinds: ['leitner-solo'],
};

/** One scored answer on one track, taken from an `answered` statement. */
export type LeitnerAnswer = {
  statementId: string;
  learningObjectId: string;
  aspect: string;
  sourceRef: string;
  success: boolean;
  /** ISO 8601, when the guess was made. */
  timestamp: string;
};

export type TrackStatus = 'new' | 'active' | 'retired';

export type TrackState = {
  learningObjectId: string;
  aspect: string;
  status: TrackStatus;
  /** Stays 3 once retired. */
  level: Level;
  /** Null when new (due now) or retired (never). */
  dueAt: string | null;
  retiredAt: string | null;
  lastSeenAt: string | null;
  lastResult: 'correct' | 'incorrect' | null;
  seenCount: number;
  correctCount: number;
  incorrectCount: number;
  /** Where it was asked, first seen first: `['ch26/vocabulary/6', 'ch27/vocabulary/5']`. */
  sources: string[];
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const answeredStatementSchema = z.object({
  id: z.string().min(1),
  verb: z.object({ id: z.literal(ANSWERED_VERB_ID) }),
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  result: z.object({ success: z.boolean() }),
  context: z.object({
    contextActivities: z.object({ grouping: z.array(z.object({ id: z.string() })) }),
    extensions: z.record(z.string(), z.unknown()),
  }),
});

/**
 * The `answered` statements that count for Leitner in `book`: tagged with
 * one learning object of that book, an aspect, a source and a counted game
 * kind. Anything else (class games, scored statements, untagged or
 * malformed statements, rated aspects with no `success`) is skipped.
 */
export function answersFromStatements(
  statements: readonly unknown[],
  book: string,
  config: LeitnerConfig = DEFAULT_LEITNER_CONFIG,
): LeitnerAnswer[] {
  const answers: LeitnerAnswer[] = [];
  for (const raw of statements) {
    const parsed = answeredStatementSchema.safeParse(raw);
    if (!parsed.success) continue;
    const statement = parsed.data;
    const extensions = statement.context.extensions;

    const gameKind = extensions[EXT_GAME_KIND];
    const aspect = extensions[EXT_ASPECT];
    const sourceRef = extensions[EXT_SOURCE_REF];
    if (typeof gameKind !== 'string' || !config.countedGameKinds.includes(gameKind)) continue;
    if (typeof aspect !== 'string' || aspect.length === 0) continue;
    if (typeof sourceRef !== 'string' || sourceRef.length === 0) continue;

    const objects = statement.context.contextActivities.grouping
      .map((activity) => parseLearningObjectIri(activity.id))
      .filter((key) => key !== null && key.book === book);
    if (objects.length !== 1 || !objects[0]) continue;

    answers.push({
      statementId: statement.id,
      learningObjectId: learningObjectId(objects[0]),
      aspect,
      sourceRef,
      success: statement.result.success,
      timestamp: new Date(statement.timestamp).toISOString(),
    });
  }
  return answers;
}

export function newTrack(learningObjectId: string, aspect: string): TrackState {
  return {
    learningObjectId,
    aspect,
    status: 'new',
    level: 0,
    dueAt: null,
    retiredAt: null,
    lastSeenAt: null,
    lastResult: null,
    seenCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    sources: [],
  };
}

/** New tracks are due; retired ones never are; otherwise `at >= dueAt - grace`. */
export function isDue(track: TrackState, at: Date, config: LeitnerConfig = DEFAULT_LEITNER_CONFIG): boolean {
  if (track.status === 'retired') return false;
  if (track.dueAt === null) return true;
  return at.getTime() >= Date.parse(track.dueAt) - config.graceHours * HOUR_MS;
}

/**
 * One answer, by the rules:
 * 1. correct and due at L0–L2 → up one level, due after its interval;
 * 2. correct and due at L3 → retired (L13);
 * 3. correct but not due → counts only (no cramming);
 * 4. incorrect → down one level (L3; L0 floor) and due now;
 * 5. retired is final: counts only.
 * Speed is ignored (L12).
 */
export function applyAnswer(
  track: TrackState,
  answer: LeitnerAnswer,
  config: LeitnerConfig = DEFAULT_LEITNER_CONFIG,
): TrackState {
  const at = new Date(answer.timestamp);
  const next: TrackState = {
    ...track,
    lastSeenAt: answer.timestamp,
    lastResult: answer.success ? 'correct' : 'incorrect',
    seenCount: track.seenCount + 1,
    correctCount: track.correctCount + (answer.success ? 1 : 0),
    incorrectCount: track.incorrectCount + (answer.success ? 0 : 1),
    sources: track.sources.includes(answer.sourceRef) ? track.sources : [...track.sources, answer.sourceRef],
  };
  if (track.status === 'retired') {
    return next;
  }
  next.status = 'active';

  if (!answer.success) {
    next.level = config.onIncorrect === 'reset' ? 0 : (Math.max(0, track.level - 1) as Level);
    next.dueAt = answer.timestamp;
    return next;
  }
  if (!isDue(track, at, config)) {
    return next;
  }
  if (track.level === 3) {
    next.status = 'retired';
    next.dueAt = null;
    next.retiredAt = answer.timestamp;
    return next;
  }
  const level = (track.level + 1) as 1 | 2 | 3;
  next.level = level;
  next.dueAt = new Date(at.getTime() + config.intervalDays[level] * DAY_MS).toISOString();
  return next;
}

function trackKey(learningObjectId: string, aspect: string): string {
  return JSON.stringify([learningObjectId, aspect]);
}

/** Every track with evidence, folded oldest answer first (ties by statement id). */
export function foldTracks(
  answers: readonly LeitnerAnswer[],
  config: LeitnerConfig = DEFAULT_LEITNER_CONFIG,
): TrackState[] {
  const ordered = [...answers].sort(
    (a, b) =>
      Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
      (a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0),
  );
  const tracks = new Map<string, TrackState>();
  for (const answer of ordered) {
    const key = trackKey(answer.learningObjectId, answer.aspect);
    const track = tracks.get(key) ?? newTrack(answer.learningObjectId, answer.aspect);
    tracks.set(key, applyAnswer(track, answer, config));
  }
  return [...tracks.values()];
}

export type ProgressScope = 'chapter' | 'review';

export type ProgressTrack = TrackState & {
  due: boolean;
  /** False for review tracks: learning objects met only in other chapters. */
  inChapter: boolean;
};

export type ProgressSummary = {
  new: number;
  active: Record<`L${Level}`, number>;
  retired: number;
  due: number;
};

/**
 * Tracks in scope (L11): the chapter's learning objects × aspects (new ones
 * included), plus, for `review`, every other track the student has evidence
 * for — evidence means its chapter was played (L15). Shared words keep the
 * level earned in any chapter (L2).
 */
export function buildProgress(input: {
  chapterObjectIds: readonly string[];
  aspects: readonly string[];
  tracks: readonly TrackState[];
  scope: ProgressScope;
  now: Date;
  config?: LeitnerConfig;
}): { tracks: ProgressTrack[]; summary: ProgressSummary } {
  const config = input.config ?? DEFAULT_LEITNER_CONFIG;
  const byKey = new Map(input.tracks.map((track) => [trackKey(track.learningObjectId, track.aspect), track]));
  const result: ProgressTrack[] = [];
  const included = new Set<string>();

  for (const id of input.chapterObjectIds) {
    for (const aspect of input.aspects) {
      const key = trackKey(id, aspect);
      if (included.has(key)) continue;
      included.add(key);
      const track = byKey.get(key) ?? newTrack(id, aspect);
      result.push({ ...track, due: isDue(track, input.now, config), inChapter: true });
    }
  }
  if (input.scope === 'review') {
    const chapterIds = new Set(input.chapterObjectIds);
    for (const track of input.tracks) {
      if (chapterIds.has(track.learningObjectId) || !input.aspects.includes(track.aspect)) continue;
      result.push({ ...track, due: isDue(track, input.now, config), inChapter: false });
    }
  }

  const summary: ProgressSummary = { new: 0, active: { L0: 0, L1: 0, L2: 0, L3: 0 }, retired: 0, due: 0 };
  for (const track of result) {
    if (track.status === 'new') summary.new++;
    else if (track.status === 'retired') summary.retired++;
    else summary.active[`L${track.level}`]++;
    if (track.due) summary.due++;
  }
  return { tracks: result, summary };
}
