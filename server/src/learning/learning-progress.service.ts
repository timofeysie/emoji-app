import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { GameDataRepository } from '../persistence/game-data.repository';
import type { PlayerSummary } from '../persistence/player.repository';
import { loadLrsConfigFromEnv, LrsRequestError } from '../xapi/lrs-client';
import {
  chapterLearningObjects,
  getBookContent,
  UnknownBookError,
  UnknownChapterError,
  UnregisteredSensesError,
  type BookContent,
} from './book-content';
import {
  buildProgress,
  DEFAULT_LEITNER_CONFIG,
  foldTracks,
  type ProgressScope,
  type ProgressSummary,
  type ProgressTrack,
  type TrackState,
} from './leitner';
import { fetchStudentEvidence } from './student-evidence';

export class LrsNotConfiguredError extends Error {}

export type ProgressQuery = {
  book: string;
  chapter: string;
  scope: ProgressScope;
  aspects: readonly string[];
  now: Date;
};

/** One pill: the tracks for one aspect in scope. `open` = not retired yet (the old `onList`). */
export type AspectCounts = {
  total: number;
  open: number;
  due: number;
  new: number;
  retired: number;
};

export type PendingExport = { gameId: string; endedAt: string | null; error: string | null };

export type ChapterProgress = {
  book: string;
  chapter: string;
  scope: ProgressScope;
  aspects: readonly string[];
  asOf: string;
  statementCount: number;
  observationCount: number;
  /** Completed Leitner games whose evidence isn't in the LRS yet: levels may be stale. */
  pendingExport: PendingExport[];
  summary: ProgressSummary;
  byAspect: Record<string, AspectCounts>;
  tracks: Array<ProgressTrack & { kind: string | null; word: string | null; gloss: string | null }>;
};

export type BookProgress = {
  book: string;
  aspects: readonly string[];
  asOf: string;
  statementCount: number;
  pendingExport: PendingExport[];
  chapters: Array<{ chapter: string; summary: ProgressSummary; byAspect: Record<string, AspectCounts> }>;
};

/** Pill counts per aspect, in `aspects` order (aspects with no tracks get zeros). */
export function countByAspect(tracks: readonly ProgressTrack[], aspects: readonly string[]): Record<string, AspectCounts> {
  const counts: Record<string, AspectCounts> = {};
  for (const aspect of aspects) {
    counts[aspect] = { total: 0, open: 0, due: 0, new: 0, retired: 0 };
  }
  for (const track of tracks) {
    const count = counts[track.aspect];
    if (!count) continue;
    count.total++;
    if (track.status === 'retired') count.retired++;
    else count.open++;
    if (track.status === 'new') count.new++;
    if (track.due) count.due++;
  }
  return counts;
}

/**
 * A player's Leitner progress, derived from their `assessed` statements in
 * the LRS (docs/xAPI/leitner-method.md → API). Shared by Players → detail
 * (`/api/players/:id/progress`) and YALLA (`/api/yalla/me/progress`) so the
 * two can't diverge (docs/yalla/implementation-plan.md §5).
 */
@Injectable()
export class LearningProgressService {
  constructor(private readonly gameDataRepository: GameDataRepository) {}

  /**
   * @throws UnknownBookError, UnknownChapterError, UnregisteredSensesError,
   *   LrsNotConfiguredError, LrsRequestError (see `sendProgressError`)
   */
  async forChapter(player: PlayerSummary, query: ProgressQuery): Promise<ChapterProgress> {
    const content = getBookContent(query.book);
    const objects = chapterLearningObjects(content, query.chapter);
    const evidence = await this.evidence(player, content);

    const { tracks, summary } = buildProgress({
      chapterObjectIds: objects.map((object) => object.id),
      aspects: query.aspects,
      tracks: evidence.tracks,
      scope: query.scope,
      now: query.now,
    });

    const glossById = new Map(objects.map((object) => [object.id, object.gloss]));
    return {
      book: query.book,
      chapter: query.chapter,
      scope: query.scope,
      aspects: query.aspects,
      asOf: query.now.toISOString(),
      statementCount: evidence.statementCount,
      observationCount: evidence.observationCount,
      pendingExport: evidence.pendingExport,
      summary,
      byAspect: countByAspect(tracks, query.aspects),
      tracks: tracks.map((track) => {
        const sense = content.senseById.get(track.learningObjectId);
        return {
          ...track,
          kind: sense?.kind ?? null,
          word: sense?.word ?? null,
          gloss: glossById.get(track.learningObjectId) ?? sense?.gloss ?? null,
        };
      }),
    };
  }

  /**
   * Chapter-scope pills for every chapter of the book, from one LRS read.
   * @throws UnknownBookError, LrsNotConfiguredError, LrsRequestError
   */
  async forBook(player: PlayerSummary, query: Omit<ProgressQuery, 'chapter' | 'scope'>): Promise<BookProgress> {
    const content = getBookContent(query.book);
    const evidence = await this.evidence(player, content);

    const chapters: BookProgress['chapters'] = [];
    for (const chapter of [...content.chapters.keys()].sort((a, b) => Number(a) - Number(b))) {
      let objects;
      try {
        objects = chapterLearningObjects(content, chapter);
      } catch (error) {
        // A chapter that isn't fully registered has no progress yet; the others still do.
        if (error instanceof UnregisteredSensesError) continue;
        throw error;
      }
      const { tracks, summary } = buildProgress({
        chapterObjectIds: objects.map((object) => object.id),
        aspects: query.aspects,
        tracks: evidence.tracks,
        scope: 'chapter',
        now: query.now,
      });
      chapters.push({ chapter, summary, byAspect: countByAspect(tracks, query.aspects) });
    }

    return {
      book: query.book,
      aspects: query.aspects,
      asOf: query.now.toISOString(),
      statementCount: evidence.statementCount,
      pendingExport: evidence.pendingExport,
      chapters,
    };
  }

  private async evidence(
    player: PlayerSummary,
    content: BookContent,
  ): Promise<{ tracks: TrackState[]; statementCount: number; observationCount: number; pendingExport: PendingExport[] }> {
    let config;
    try {
      config = loadLrsConfigFromEnv();
    } catch (error) {
      throw new LrsNotConfiguredError(error instanceof Error ? error.message : String(error));
    }
    const { statements, observations } = await fetchStudentEvidence(config, player.externalId, content.language);
    const pendingExport = (await this.gameDataRepository.listLeitnerGamesForPlayer(player.id))
      .filter((game) => game.state === 'completed')
      .map((game) => ({ gameId: game.id, endedAt: game.endedAt, error: game.exportError }));
    return {
      tracks: foldTracks(observations, DEFAULT_LEITNER_CONFIG),
      statementCount: statements.length,
      observationCount: observations.length,
      pendingExport,
    };
  }
}

/** The HTTP answer for an error from `LearningProgressService`. */
export function sendProgressError(res: Response, error: unknown): void {
  if (error instanceof UnknownBookError || error instanceof UnknownChapterError) {
    res.status(404).json({ error: error.message });
  } else if (error instanceof UnregisteredSensesError) {
    res.status(422).json({ error: error.message, sourceRefs: error.sourceRefs });
  } else if (error instanceof LrsNotConfiguredError) {
    res.status(503).json({ error: error.message });
  } else if (error instanceof LrsRequestError) {
    res.status(502).json({ error: 'The LRS request failed', status: error.status });
  } else {
    res.status(500).json({ error: 'Failed to load progress', message: String(error) });
  }
}
