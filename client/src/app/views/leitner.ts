/**
 * Client shapes for solo Leitner games (docs/xAPI/leitner-method.md → API).
 * The server owns the rules; these only describe what it returns.
 */

export const LEITNER_BOOK = 'korean-language-book';
export const LEITNER_ASPECTS = ['reading', 'writing'] as const;

export type GameKind = 'class' | 'leitner-solo';
export type LeitnerScope = 'chapter' | 'review';
export type PickReason = 'overdue' | 'new' | 'practice' | 'review';
export type TrackStatus = 'new' | 'active' | 'retired';
export type Level = 0 | 1 | 2 | 3;

/** Referee-made player record (security.md D4): first name stays in the app. */
export type Player = {
  id: string;
  firstName: string;
  externalId: string;
  label: string;
};

export type LeitnerGameInfo = {
  playerId: string;
  book: string;
  chapter: string;
  scope: LeitnerScope;
};

export type PendingExport = { gameId: string; endedAt: string | null; error: string | null };

export type ProgressTrack = {
  learningObjectId: string;
  aspect: string;
  status: TrackStatus;
  level: Level;
  dueAt: string | null;
  retiredAt: string | null;
  lastResult: 'correct' | 'incorrect' | null;
  sources: string[];
  due: boolean;
  inChapter: boolean;
  word: string | null;
  gloss: string | null;
};

export type Progress = {
  player: { id: string; label: string };
  chapter: string;
  scope: LeitnerScope;
  aspects: string[];
  asOf: string;
  pendingExport: PendingExport[];
  summary: {
    new: number;
    active: { L0: number; L1: number; L2: number; L3: number };
    retired: number;
    due: number;
  };
  tracks: ProgressTrack[];
};

export type PlanPick = {
  learningObjectId: string;
  aspect: string;
  sourceRef: string;
  reason: PickReason;
  level: Level;
  status: TrackStatus;
  dueAt: string | null;
  word: string;
  gloss: string;
  chapter: string | null;
};

export type Plan = {
  book: string;
  chapter: string;
  scope: LeitnerScope;
  aspects: string[];
  seed: number;
  now: string;
  picks: PlanPick[];
  report: {
    available: Record<PickReason, number>;
    picked: Record<PickReason, number>;
    skipped: Array<{ learningObjectId: string; aspect: string }>;
    short: boolean;
  };
  supersedes: string[];
};

export type TrackChange = {
  learningObjectId: string;
  aspect: string;
  change: 'promoted' | 'demoted' | 'retired' | 'unchanged';
  from: { level: Level; status: TrackStatus };
  to: { level: Level; status: TrackStatus };
};

export type LeitnerSummary = {
  score: { correct: number; total: number };
  /** Null when the student's earlier evidence couldn't be read. */
  changes: TrackChange[] | null;
};

/** `leitnerExport` in the completion response (`POST /api/games/:id/state`). */
export type LeitnerExportResult =
  | { exported: true; statementsSent: number; deleted: boolean; summary: LeitnerSummary | null }
  | { exported: false; status: number; error: { error?: string; message?: string } | null };

export const PICK_REASONS: PickReason[] = ['overdue', 'review', 'new', 'practice'];

export const REASON_STYLES: Record<PickReason, string> = {
  overdue: 'bg-red-100 text-red-800',
  review: 'bg-violet-100 text-violet-800',
  new: 'bg-sky-100 text-sky-800',
  practice: 'bg-slate-100 text-slate-700',
};

/** `ko/lexeme/시험/test` → `시험`. Ids are `{language}/{kind}/{word}/{sense}`. */
export function wordOf(learningObjectId: string): string {
  return learningObjectId.split('/')[2] ?? learningObjectId;
}

/** `ko/lexeme/시험/test` → `test`. */
export function senseOf(learningObjectId: string): string {
  return learningObjectId.split('/')[3] ?? '';
}

export function levelLabel(track: { level: Level; status: TrackStatus }): string {
  if (track.status === 'retired') return 'retired';
  if (track.status === 'new') return 'new';
  return `L${track.level}`;
}

export function scopeLabel(scope: LeitnerScope): string {
  return scope === 'review' ? 'this chapter + review' : 'this chapter only';
}

/** Short due text: "due now", "due 10-25", or nothing. */
export function dueLabel(track: { status: TrackStatus; dueAt: string | null; due?: boolean }): string {
  if (track.status === 'retired') return '';
  if (track.status === 'new') return '';
  if (track.due || !track.dueAt) return 'due now';
  const date = new Date(track.dueAt);
  return `due ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export async function errorBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function errorText(body: Record<string, unknown>, status: number): string {
  const error = typeof body['error'] === 'string' ? body['error'] : null;
  const message = typeof body['message'] === 'string' ? body['message'] : null;
  return error ?? message ?? `Server error ${status}`;
}
