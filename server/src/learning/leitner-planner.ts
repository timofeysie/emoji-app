import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { clozeItem, type BookPattern } from '../games/generators/pattern-cloze';
import { createRng, shuffle } from '../games/generators/seeded-random';
import {
  canBuildItem,
  vocabItem,
  type LeitnerAspect,
  type VocabChoiceItem,
  type VocabSkill,
  type VocabTerm,
} from '../games/generators/vocab-choice';
import { GameDataRepository, type LeitnerGameStatus } from '../persistence/game-data.repository';
import type { PlayerSummary } from '../persistence/player.repository';
import { loadLrsConfigFromEnv, LrsRequestError, type LrsConfig } from '../xapi/lrs-client';
import {
  chapterLearningObjects,
  chapterPatternObjects,
  patternEntriesOf,
  UnknownBookError,
  UnknownChapterError,
  UnregisteredSensesError,
  type BookContent,
  type LearningObject,
} from './book-content';
import { BookContentService } from './book-content.service';
import { foldTracks, type TrackState } from './leitner';
import { chapterOfSourceRef, parseQualifiedSourceRef, USAGE_ASPECT } from './learning-object';
import { LrsNotConfiguredError, type PendingExport } from './learning-progress.service';
import { planNextGame, seedFrom, type PlanObject, type PlanPick, type PlanReport } from './planner';
import { fetchStudentEvidence } from './student-evidence';

export type PlanRequest = {
  book: string;
  chapter: string;
  scope: 'chapter' | 'review';
  aspects: readonly LeitnerAspect[];
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

/** Every book pattern in the book by sourceRef, and the ones teaching the same grammar as each. */
export function patternsOf(content: BookContent): {
  bySourceRef: Map<string, BookPattern>;
  all: BookPattern[];
  /** Book patterns sharing an entry with this one: never each other's distractors. */
  sameGrammar: (sourceRef: string) => Set<string>;
} {
  const all = [...content.patterns.values()].flat();
  const bySourceRef = new Map(all.map((pattern) => [pattern.sourceRef, pattern]));
  const entryIds = (sourceRef: string) => new Set(patternEntriesOf(content, sourceRef).map((entry) => entry.id));
  const sameGrammar = (sourceRef: string) => {
    const ids = entryIds(sourceRef);
    return new Set(all.filter((other) => [...entryIds(other.sourceRef)].some((id) => ids.has(id))).map((other) => other.sourceRef));
  };
  return { bySourceRef, all, sameGrammar };
}

/** Whether `sourceRef` (a vocabulary entry or a book pattern) teaches the learning object. */
function teaches(content: BookContent, sourceRef: string, learningObjectId: string): boolean {
  return (
    content.senseBySourceRef.get(sourceRef)?.id === learningObjectId ||
    patternEntriesOf(content, sourceRef).some((entry) => entry.id === learningObjectId)
  );
}

/**
 * Words first, with the chapter's patterns spread evenly through them, so
 * new patterns come up in a chapter's first games, not after every word.
 */
function interleave(words: readonly PlanObject[], patterns: readonly PlanObject[]): PlanObject[] {
  const result = [...words];
  patterns.forEach((pattern, i) => {
    const at = Math.round(((i + 1) * words.length) / (patterns.length + 1)) + i;
    result.splice(Math.min(at, result.length), 0, pattern);
  });
  return result;
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
          teaches(content, ref.sourceRef, track.learningObjectId),
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
  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly bookContent: BookContentService,
  ) {}

  /**
   * The book (built-in or a user book), chapter and LRS are checked before
   * `loadPlayer` runs.
   * @throws UnknownBookError, UnknownChapterError, UnregisteredSensesError,
   *   LrsNotConfiguredError, PlayerNotFoundError, PendingExportError,
   *   GameInPlayError, LrsRequestError
   */
  async plan(request: PlanRequest, loadPlayer: () => Promise<PlayerSummary | null>): Promise<LeitnerPlan> {
    const content = await this.bookContent.getBookContent(request.book);
    const chapterObjects: LearningObject[] = chapterLearningObjects(content, request.chapter);
    const patternObjects: LearningObject[] = chapterPatternObjects(content, request.chapter);

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
    const patterns = patternsOf(content);
    const patternFor = (object: PlanObject) => {
      const pattern = patterns.bySourceRef.get(object.sourceRef);
      if (!pattern) throw new Error(`No book pattern '${object.sourceRef}' in ${content.book}.`);
      return pattern;
    };
    const cloze = (object: PlanObject, rng = createRng(0)) => {
      const pattern = patternFor(object);
      return clozeItem(pattern, patterns.all, patterns.sameGrammar(pattern.sourceRef), rng);
    };
    const entryOf = (object: PlanObject) =>
      patternEntriesOf(content, object.sourceRef).find((entry) => entry.id === object.learningObjectId);
    const termFor = (object: PlanObject) => {
      const term = terms.bySourceRef.get(object.sourceRef);
      const chapter = chapterOfSourceRef(object.sourceRef);
      const pool = chapter ? terms.byChapter.get(chapter) : undefined;
      if (!term || !pool) throw new Error(`No vocabulary entry '${object.sourceRef}' in ${content.book}.`);
      return { term, pool };
    };

    const chapterIds = new Set([...chapterObjects, ...patternObjects].map((object) => object.id));
    const toPlan = (object: LearningObject) => ({ learningObjectId: object.id, sourceRef: object.sourceRefs[0] });
    const { picks, report } = planNextGame({
      chapterObjects: interleave(chapterObjects.map(toPlan), patternObjects.map(toPlan)),
      reviewObjects: request.scope === 'review' ? reviewObjects(tracks, content, request.chapter, chapterIds) : [],
      aspects: request.aspects,
      tracks,
      now,
      count: request.count,
      maxNew: request.maxNew,
      fill: request.fill,
      canBuild: (object, aspect) => {
        if (aspect === USAGE_ASPECT) return cloze(object) !== null;
        const { term, pool } = termFor(object);
        return canBuildItem(aspect as VocabSkill, term, pool);
      },
    });

    // One question per pick, shuffled by `seed` so aspects interleave. A
    // pattern's tag names the registry entry: its headword and gloss.
    const rng = createRng(seed);
    const built = picks.map((pick): VocabChoiceItem => {
      if (pick.aspect === USAGE_ASPECT) {
        const entry = entryOf(pick);
        const item = cloze(pick, rng);
        if (!entry || !item) throw new Error(`Cannot build a usage question for '${pick.sourceRef}'.`);
        return {
          skill: 'usage',
          termId: item.sourceRef,
          sentence: item.sentence,
          prompt: item.prompt,
          options: item.options,
          learning: { learningObjectId: pick.learningObjectId, book: content.book, sourceRef: pick.sourceRef, target: entry.headword, native: entry.gloss },
        };
      }
      const { term, pool } = termFor(pick);
      const item = vocabItem(pick.aspect as VocabSkill, term, pool, rng);
      if (!item) throw new Error(`Cannot build a ${pick.aspect} question for '${term.id}'.`);
      return {
        ...item,
        learning: { learningObjectId: pick.learningObjectId, book: content.book, sourceRef: pick.sourceRef, target: term.target, native: term.native },
      };
    });
    const items = shuffle(built, rng);

    return {
      player,
      content,
      request,
      seed,
      now,
      picks: picks.map((pick) => {
        const chapter = chapterOfSourceRef(pick.sourceRef);
        if (pick.aspect === USAGE_ASPECT) {
          const entry = entryOf(pick);
          return { ...pick, word: entry?.headword ?? pick.learningObjectId, gloss: entry?.gloss ?? '', chapter };
        }
        const { term } = termFor(pick);
        return { ...pick, word: term.target, gloss: term.native, chapter };
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
