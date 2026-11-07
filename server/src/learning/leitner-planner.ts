import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import {
  canBuildItem,
  generateVocabQuizForPicks,
  type VocabChoiceItem,
  type VocabSkill,
  type VocabTerm,
} from '../games/generators/vocab-choice';
import { GameDataRepository, type LeitnerGameStatus } from '../persistence/game-data.repository';
import type { PlayerSummary } from '../persistence/player.repository';
import { loadLrsConfigFromEnv, LrsRequestError, type LrsConfig } from '../xapi/lrs-client';
import {
  chapterLearningObjects,
  getBookContent,
  UnknownBookError,
  UnknownChapterError,
  UnregisteredSensesError,
  type BookContent,
  type LearningObject,
} from './book-content';
import { foldTracks, type TrackState } from './leitner';
import { chapterOfSourceRef, parseQualifiedSourceRef } from './learning-object';
import { LrsNotConfiguredError, type PendingExport } from './learning-progress.service';
import { planNextGame, seedFrom, type PlanObject, type PlanPick, type PlanReport } from './planner';
import { fetchStudentEvidence } from './student-evidence';

export type PlanRequest = {
  book: string;
  chapter: string;
  scope: 'chapter' | 'review';
  aspects: readonly VocabSkill[];
  count: number;
  maxNew: number;
  fill: boolean;
  seed?: number;
  /** Pretend it's this time (testing the schedule). */
  now?: Date;
};

export class PlayerNotFoundError extends Error {
  constructor() {
    super('Player not found');
  }
}

/** A completed Leitner game's evidence isn't in the LRS yet: planning now would use stale levels. */
export class PendingExportError extends Error {
  constructor(public readonly pendingExport: PendingExport[]) {
    super('Previous Leitner game not exported yet');
  }
}

/** A badge game for this student is being played: planning would race it. */
export class GameInPlayError extends Error {
  constructor(public readonly inPlay: string[]) {
    super('A Leitner game for this student is being played; end it first');
  }
}

export type PlannedPick = PlanPick & { word: string; gloss: string; chapter: string | null };

export type LeitnerPlan = {
  player: PlayerSummary;
  content: BookContent;
  request: PlanRequest;
  seed: number;
  now: Date;
  picks: PlannedPick[];
  report: PlanReport;
  /** One tagged multiple-choice item per pick, shuffled by `seed`. */
  items: VocabChoiceItem[];
  /** The student's unplayed or cancelled badge games: stale once a new plan exists. */
  supersedes: string[];
};

/** States in which a Leitner game is being played: planning would race it. */
const IN_PLAY = new Set(['active', 'paused']);

/** Each chapter's vocabulary as generator terms, keyed by chapter and by sourceRef. */
export function termsOf(content: BookContent): { byChapter: Map<string, VocabTerm[]>; bySourceRef: Map<string, VocabTerm> } {
  const byChapter = new Map<string, VocabTerm[]>();
  const bySourceRef = new Map<string, VocabTerm>();
  for (const [chapter, vocabulary] of content.chapters) {
    const terms = vocabulary.entries.map((entry) => ({ id: entry.sourceRef, target: entry.word, native: entry.gloss }));
    byChapter.set(chapter, terms);
    for (const term of terms) bySourceRef.set(term.id, term);
  }
  return { byChapter, bySourceRef };
}

/**
 * Review scope (L11, L15): learning objects outside this chapter that the
 * student has evidence for, built from their latest source in this book
 * that is in another chapter. Tracks met only in other books are left out:
 * their distractors would need that book's content.
 */
function reviewObjects(
  tracks: readonly TrackState[],
  content: BookContent,
  chapter: string,
  chapterIds: ReadonlySet<string>,
): PlanObject[] {
  const objects = new Map<string, PlanObject>();
  for (const track of tracks) {
    if (chapterIds.has(track.learningObjectId) || objects.has(track.learningObjectId)) continue;
    const sourceRef = [...track.sources]
      .reverse()
      .map(parseQualifiedSourceRef)
      .find(
        (ref) =>
          ref?.book === content.book &&
          chapterOfSourceRef(ref.sourceRef) !== chapter &&
          content.senseBySourceRef.get(ref.sourceRef)?.id === track.learningObjectId,
      )?.sourceRef;
    if (sourceRef) {
      objects.set(track.learningObjectId, { learningObjectId: track.learningObjectId, sourceRef });
    }
  }
  return [...objects.values()];
}

function pendingExport(games: LeitnerGameStatus[]): PendingExport[] {
  return games
    .filter((game) => game.state === 'completed')
    .map((game) => ({ gameId: game.id, endedAt: game.endedAt, error: game.exportError }));
}

/**
 * Plans a student's next Leitner questions (docs/xAPI/leitner-method.md →
 * Choosing the next learning objects). Shared by badge games
 * (`POST /api/leitner-games`) and YALLA practice (`POST /api/yalla/me/sessions`,
 * docs/yalla/implementation-plan.md §6), so both ask the same words.
 * Nothing is written: the caller creates the game or returns the session.
 */
@Injectable()
export class LeitnerPlanner {
  constructor(private readonly gameDataRepository: GameDataRepository) {}

  /**
   * The book, chapter and LRS are checked before `loadPlayer` runs.
   * @throws UnknownBookError, UnknownChapterError, UnregisteredSensesError,
   *   LrsNotConfiguredError, PlayerNotFoundError, PendingExportError,
   *   GameInPlayError, LrsRequestError
   */
  async plan(request: PlanRequest, loadPlayer: () => Promise<PlayerSummary | null>): Promise<LeitnerPlan> {
    const content = getBookContent(request.book);
    const chapterObjects: LearningObject[] = chapterLearningObjects(content, request.chapter);

    let config: LrsConfig;
    try {
      config = loadLrsConfigFromEnv();
    } catch (error) {
      throw new LrsNotConfiguredError(error instanceof Error ? error.message : String(error));
    }

    const player = await loadPlayer();
    if (!player) {
      throw new PlayerNotFoundError();
    }

    // Planning on stale levels would re-ask words just answered.
    const games = await this.gameDataRepository.listLeitnerGamesForPlayer(player.id);
    const pending = pendingExport(games);
    if (pending.length > 0) {
      throw new PendingExportError(pending);
    }
    const inPlay = games.filter((game) => IN_PLAY.has(game.state));
    if (inPlay.length > 0) {
      throw new GameInPlayError(inPlay.map((game) => game.id));
    }
    // Not started, or cancelled: their plans are stale (cancelling discards guesses).
    const supersedes = games.map((game) => game.id);

    const { observations } = await fetchStudentEvidence(config, player.externalId, content.language);
    const tracks = foldTracks(observations);
    const now = request.now ?? new Date();
    const seed = request.seed ?? seedFrom(`${player.id}:${now.toISOString().slice(0, 10)}`);

    const terms = termsOf(content);
    const termFor = (object: PlanObject) => {
      const term = terms.bySourceRef.get(object.sourceRef);
      const chapter = chapterOfSourceRef(object.sourceRef);
      const pool = chapter ? terms.byChapter.get(chapter) : undefined;
      if (!term || !pool) throw new Error(`No vocabulary entry '${object.sourceRef}' in ${content.book}.`);
      return { term, pool };
    };

    const chapterIds = new Set(chapterObjects.map((object) => object.id));
    const { picks, report } = planNextGame({
      chapterObjects: chapterObjects.map((object) => ({ learningObjectId: object.id, sourceRef: object.sourceRefs[0] })),
      reviewObjects: request.scope === 'review' ? reviewObjects(tracks, content, request.chapter, chapterIds) : [],
      aspects: request.aspects,
      tracks,
      now,
      count: request.count,
      maxNew: request.maxNew,
      fill: request.fill,
      canBuild: (object, aspect) => {
        const { term, pool } = termFor(object);
        return canBuildItem(aspect as VocabSkill, term, pool);
      },
    });

    const items = generateVocabQuizForPicks(
      picks.map((pick) => {
        const { term, pool } = termFor(pick);
        return {
          skill: pick.aspect as VocabSkill,
          term,
          pool,
          learning: {
            learningObjectId: pick.learningObjectId,
            book: content.book,
            sourceRef: pick.sourceRef,
            target: term.target,
            native: term.native,
          },
        };
      }),
      seed,
    );

    return {
      player,
      content,
      request,
      seed,
      now,
      picks: picks.map((pick) => {
        const { term } = termFor(pick);
        return { ...pick, word: term.target, gloss: term.native, chapter: chapterOfSourceRef(pick.sourceRef) };
      }),
      report,
      items,
      supersedes,
    };
  }
}

/** The HTTP answer for an error from `LeitnerPlanner.plan` (or anything after it). */
export function sendPlanError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof UnknownBookError || error instanceof UnknownChapterError) {
    res.status(404).json({ error: error.message });
  } else if (error instanceof UnregisteredSensesError) {
    res.status(422).json({ error: 'Chapter has unregistered vocabulary senses', sourceRefs: error.sourceRefs });
  } else if (error instanceof LrsNotConfiguredError) {
    res.status(503).json({ error: error.message });
  } else if (error instanceof PlayerNotFoundError) {
    res.status(404).json({ error: error.message });
  } else if (error instanceof PendingExportError) {
    res.status(409).json({ error: error.message, pendingExport: error.pendingExport });
  } else if (error instanceof GameInPlayError) {
    res.status(409).json({ error: error.message, inPlay: error.inPlay });
  } else if (error instanceof LrsRequestError) {
    res.status(502).json({ error: 'The LRS request failed', status: error.status });
  } else {
    res.status(500).json({ error: fallback, message: String(error) });
  }
}
