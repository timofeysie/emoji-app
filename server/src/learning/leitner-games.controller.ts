import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import {
  canBuildItem,
  generateVocabQuizForPicks,
  toQuestionInput,
  vocabSkillValues,
  type VocabSkill,
  type VocabTerm,
} from '../games/generators/vocab-choice';
import { GameDataRepository, type LeitnerGameStatus } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import { loadLrsConfigFromEnv, LrsRequestError, type LrsConfig } from '../xapi/lrs-client';
import {
  chapterLearningObjects,
  getBookContent,
  UnknownBookError,
  UnknownChapterError,
  UnregisteredSensesError,
  type BookContent,
} from './book-content';
import { foldTracks, type TrackState } from './leitner';
import { chapterOfSourceRef, KOREAN_BOOK, parseQualifiedSourceRef } from './learning-object';
import { planNextGame, seedFrom, type PlanObject } from './planner';
import { fetchStudentEvidence } from './student-evidence';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

const createLeitnerGameSchema = z
  .object({
    playerId: objectIdSchema,
    /** Required unless `dryRun`. */
    createdByUserId: objectIdSchema.optional(),
    book: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).default(KOREAN_BOOK),
    chapter: z
      .union([z.string().regex(/^\d+$/, 'must be a chapter number'), z.number().int().positive()])
      .transform(String),
    scope: z.enum(['chapter', 'review']).default('chapter'),
    /** The generator builds reading and writing questions only (for now). */
    aspects: z
      .array(z.enum(vocabSkillValues))
      .min(1)
      .default(['reading', 'writing'])
      .transform((aspects) => [...new Set(aspects)]),
    count: z.number().int().min(1).max(20).default(10),
    maxNew: z.number().int().min(0).max(20).default(4),
    fill: z.boolean().default(true),
    seed: z.number().int().min(0).max(0x7fffffff).optional(),
    /** Pretend it's this time (testing the schedule). */
    now: z.string().datetime({ offset: true }).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.dryRun && !value.createdByUserId) {
      ctx.addIssue({ path: ['createdByUserId'], code: z.ZodIssueCode.custom, message: 'required unless dryRun' });
    }
  });

/** States in which a Leitner game is being played: planning would race it. */
const IN_PLAY = new Set(['active', 'paused']);

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/** Each chapter's vocabulary as generator terms, keyed by chapter and by sourceRef. */
function termsOf(content: BookContent): { byChapter: Map<string, VocabTerm[]>; bySourceRef: Map<string, VocabTerm> } {
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

function pendingExport(games: LeitnerGameStatus[]) {
  return games
    .filter((game) => game.state === 'completed')
    .map((game) => ({ gameId: game.id, endedAt: game.endedAt, error: game.exportError }));
}

/**
 * Plans and creates a student's next solo Leitner game
 * (docs/xAPI/leitner-method.md → Referee flow, API). Referee-only once
 * Step 0 auth lands.
 */
@Controller('api')
export class LeitnerGamesController {
  constructor(
    private readonly playerRepository: PlayerRepository,
    private readonly gameDataRepository: GameDataRepository,
  ) {}

  @Post('leitner-games')
  async createLeitnerGame(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = createLeitnerGameSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const input = parsed.data;

    let content: BookContent;
    let chapterObjects;
    try {
      content = getBookContent(input.book);
      chapterObjects = chapterLearningObjects(content, input.chapter);
    } catch (error) {
      if (error instanceof UnknownBookError || error instanceof UnknownChapterError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof UnregisteredSensesError) {
        res.status(422).json({ error: 'Chapter has unregistered vocabulary senses', sourceRefs: error.sourceRefs });
        return;
      }
      throw error;
    }

    let config: LrsConfig;
    try {
      config = loadLrsConfigFromEnv();
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    try {
      const player = await this.playerRepository.getPlayer(input.playerId);
      if (!player) {
        res.status(404).json({ error: 'Player not found' });
        return;
      }

      // Planning on stale levels would re-ask words just answered.
      const games = await this.gameDataRepository.listLeitnerGamesForPlayer(player.id);
      const pending = pendingExport(games);
      if (pending.length > 0) {
        res.status(409).json({ error: 'Previous Leitner game not exported yet', pendingExport: pending });
        return;
      }
      const inPlay = games.filter((game) => IN_PLAY.has(game.state));
      if (inPlay.length > 0) {
        res.status(409).json({
          error: 'A Leitner game for this student is being played; end it first',
          inPlay: inPlay.map((game) => game.id),
        });
        return;
      }
      // Not started, or cancelled: their plans are stale (cancelling discards guesses).
      const supersedes = games.map((game) => game.id);

      const { observations } = await fetchStudentEvidence(config, player.externalId, content.language);
      const tracks = foldTracks(observations);
      const now = input.now ? new Date(input.now) : new Date();
      const seed = input.seed ?? seedFrom(`${player.id}:${now.toISOString().slice(0, 10)}`);

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
        reviewObjects: input.scope === 'review' ? reviewObjects(tracks, content, input.chapter, chapterIds) : [],
        aspects: input.aspects,
        tracks,
        now,
        count: input.count,
        maxNew: input.maxNew,
        fill: input.fill,
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
      const questions = items.map((item, index) => toQuestionInput(item, index + 1));

      const plan = {
        book: content.book,
        chapter: input.chapter,
        scope: input.scope,
        aspects: input.aspects,
        seed,
        now: now.toISOString(),
        picks: picks.map((pick) => {
          const { term } = termFor(pick);
          return { ...pick, word: term.target, gloss: term.native, chapter: chapterOfSourceRef(pick.sourceRef) };
        }),
        report,
        questions: questions.map((question) => ({
          sequence: question.sequence,
          aspect: question.learning?.aspect ?? null,
          learningObjectId: question.learning?.learningObjectId ?? null,
          prompt: question.text,
          options: question.answerOptions.map((option) => ({
            slotLabel: option.slotLabel,
            text: option.text,
            isCorrect: option.isCorrect,
          })),
        })),
        supersedes,
      };

      if (input.dryRun) {
        res.status(200).json({ plan });
        return;
      }
      if (picks.length === 0) {
        res.status(422).json({ error: 'Nothing to ask: every track in scope is retired or not due', plan });
        return;
      }

      for (const gameId of supersedes) {
        await this.gameDataRepository.deleteGame(gameId);
      }
      const gameId = await this.gameDataRepository.createLeitnerGame({
        // Game.title reaches the LRS: the label, never the first name.
        title: `Leitner: ${player.label} · ch. ${input.chapter}${input.scope === 'review' ? ' + review' : ''}`,
        createdByUserId: input.createdByUserId!,
        leitner: {
          playerId: player.id,
          book: content.book,
          chapter: input.chapter,
          scope: input.scope,
          aspects: input.aspects,
          seed,
          plannedAt: now,
          picks: picks.map(({ learningObjectId, aspect, sourceRef, reason }) => ({
            learningObjectId,
            aspect,
            sourceRef,
            reason,
          })),
        },
        questions,
      });
      res.status(201).json({ gameId, plan });
    } catch (error) {
      if (error instanceof LrsRequestError) {
        res.status(502).json({ error: 'The LRS request failed', status: error.status });
        return;
      }
      res.status(500).json({ error: 'Failed to plan the Leitner game', message: String(error) });
    }
  }
}
