import { useEffect } from 'react';
import { useMeStore } from './me.store';
import { useYallaResource, type Resource } from './yalla-api';

/** The aspects with evidence today; listening and speaking come later (§5). */
export const PRACTISED_ASPECTS = ['reading', 'writing'] as const;

export type Level = 0 | 1 | 2 | 3;
export type TrackStatus = 'new' | 'active' | 'retired';

/** One pill: tracks for one aspect. `open` = not retired yet. */
export type AspectCounts = { total: number; open: number; due: number; new: number; retired: number };

export type PendingExport = { gameId: string; endedAt: string | null; error: string | null };

export type ProgressTrack = {
  learningObjectId: string;
  aspect: string;
  status: TrackStatus;
  level: Level;
  due: boolean;
  dueAt: string | null;
  lastResult: 'correct' | 'incorrect' | null;
  inChapter: boolean;
  word: string | null;
  gloss: string | null;
};

/** `GET /api/yalla/me/progress` */
export type ChapterProgress = {
  player: { id: string; label: string };
  chapter: string;
  aspects: string[];
  asOf: string;
  pendingExport: PendingExport[];
  byAspect: Record<string, AspectCounts>;
  tracks: ProgressTrack[];
};

/** `GET /api/yalla/me/progress/book` */
export type BookProgress = {
  player: { id: string; label: string };
  aspects: string[];
  asOf: string;
  pendingExport: PendingExport[];
  chapters: Array<{ chapter: string; byAspect: Record<string, AspectCounts> }>;
};

export type LearnerProgress<T> = Resource<T> & {
  /** null while `/api/me` loads; false = no linked player, so no progress to load. */
  linked: boolean | null;
};

/**
 * Progress for the linked player at `path` (under `/api/yalla`). Not cached:
 * it changes as you practise. Reloads when you link a different player.
 */
export function useLearnerProgress<T>(path: string): LearnerProgress<T> {
  const { me, load } = useMeStore();
  useEffect(() => {
    void load();
  }, [load]);

  const playerId = me?.player?.id ?? null;
  const resource = useYallaResource<T>(playerId ? path : null, { cache: false, key: playerId });
  return { ...resource, linked: me ? playerId !== null : null };
}

export function chapterProgressPath(book: string, chapter: string): string {
  const query = new URLSearchParams({ book, chapter, aspects: PRACTISED_ASPECTS.join(',') });
  return `/me/progress?${query}`;
}

export function bookProgressPath(book: string): string {
  const query = new URLSearchParams({ book, aspects: PRACTISED_ASPECTS.join(',') });
  return `/me/progress/book?${query}`;
}
