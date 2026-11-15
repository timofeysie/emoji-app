import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { PlayerRepository } from '../persistence/player.repository';
import { GameDataRepository } from '../persistence/game-data.repository';
import { loadLrsConfigFromEnv, LrsRequestError, type LrsConfig } from '../xapi/lrs-client';
import { getBookContent, UnknownBookError } from './book-content';
import { LearningProgressService, sendProgressError } from './learning-progress.service';
import { fetchStudentStatements } from './student-evidence';
import { summarizePlayerActivity } from './player-activity';
import { KOREAN_BOOK } from './learning-object';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Shared with YALLA's `/api/yalla/me/progress` (same query, learner from the token). */
export const progressQuerySchema = z
  .object({
    book: slugSchema.default(KOREAN_BOOK),
    chapter: z.string().regex(/^\d+$/, 'must be a chapter number'),
    scope: z.enum(['chapter', 'review']).default('chapter'),
    aspects: z
      .string()
      .default('reading,writing')
      .transform((value) => [...new Set(value.split(',').map((aspect) => aspect.trim()).filter(Boolean))])
      .pipe(z.array(slugSchema).min(1)),
    /** Pretend it's this time (testing the schedule). */
    now: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const activityQuerySchema = z
  .object({
    book: slugSchema.default(KOREAN_BOOK),
    now: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/**
 * A student's Leitner progress for one chapter, derived from their
 * `assessed` statements in the LRS (docs/xAPI/leitner-method.md → API).
 * The server reads the LRS so each environment uses its own (staging →
 * pilot). Referee-only once Step 0 auth lands.
 */
@Controller('api')
export class LearningProgressController {
  constructor(
    private readonly playerRepository: PlayerRepository,
    private readonly gameDataRepository: GameDataRepository,
    private readonly progressService: LearningProgressService,
  ) {}

  /** The chapters a Leitner game can be planned from (the referee's chapter picker). */
  @Get('books/:book/chapters')
  getChapters(@Param('book') book: string, @Res() res: Response): void {
    if (!slugSchema.safeParse(book).success) {
      res.status(400).json({ error: 'Invalid book' });
      return;
    }
    try {
      const content = getBookContent(book);
      const chapters = [...content.chapters.values()]
        .map((vocabulary) => ({ chapter: vocabulary.chapter, entryCount: vocabulary.entries.length }))
        .sort((a, b) => Number(a.chapter) - Number(b.chapter));
      res.status(200).json({ book: content.book, language: content.language, chapters });
    } catch (error) {
      if (error instanceof UnknownBookError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  }

  @Get('players/:playerId/progress')
  async getProgress(
    @Param('playerId') playerId: string,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const idResult = objectIdSchema.safeParse(playerId);
    const queryResult = progressQuerySchema.safeParse(query);
    if (!idResult.success || !queryResult.success) {
      const details = [
        ...(!idResult.success ? getValidationErrors(idResult.error) : []),
        ...(!queryResult.success ? getValidationErrors(queryResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }
    const { book, chapter, scope, aspects, now: nowParam } = queryResult.data;

    try {
      const player = await this.playerRepository.getPlayer(playerId);
      if (!player) {
        res.status(404).json({ error: 'Player not found' });
        return;
      }
      const progress = await this.progressService.forChapter(player, {
        book,
        chapter,
        scope,
        aspects,
        now: nowParam ? new Date(nowParam) : new Date(),
      });
      res.status(200).json({ player: { id: player.id, label: player.label }, ...progress });
    } catch (error) {
      sendProgressError(res, error);
    }
  }

  /**
   * Everything the LRS has for one student (Players → detail): games,
   * recent answers and Leitner tracks across every chapter of the book's
   * language, plus their Leitner games still in our database.
   */
  @Get('players/:playerId/activity')
  async getActivity(
    @Param('playerId') playerId: string,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const idResult = objectIdSchema.safeParse(playerId);
    const queryResult = activityQuerySchema.safeParse(query);
    if (!idResult.success || !queryResult.success) {
      const details = [
        ...(!idResult.success ? getValidationErrors(idResult.error) : []),
        ...(!queryResult.success ? getValidationErrors(queryResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }
    const { book, now: nowParam } = queryResult.data;

    let content;
    try {
      content = getBookContent(book);
    } catch (error) {
      if (error instanceof UnknownBookError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }

    try {
      const player = await this.playerRepository.getPlayer(playerId);
      if (!player) {
        res.status(404).json({ error: 'Player not found' });
        return;
      }
      // Our own games come first: they don't need the LRS, so they show even when it's down.
      const leitnerGames = (await this.gameDataRepository.listLeitnerGamesForPlayer(playerId)).map((game) => ({
        gameId: game.id,
        state: game.state,
        endedAt: game.endedAt,
        guessCount: game.guessCount,
        exportError: game.exportError,
      }));

      let config: LrsConfig;
      try {
        config = loadLrsConfigFromEnv();
      } catch (error) {
        res.status(503).json({ error: error instanceof Error ? error.message : String(error), leitnerGames });
        return;
      }

      const now = nowParam ? new Date(nowParam) : new Date();
      const statements = await fetchStudentStatements(config, player.externalId);
      res.status(200).json({
        player: { id: player.id, label: player.label },
        book,
        language: content.language,
        asOf: now.toISOString(),
        leitnerGames,
        ...summarizePlayerActivity({ statements, content, now }),
      });
    } catch (error) {
      if (error instanceof LrsRequestError) {
        res.status(502).json({ error: 'The LRS request failed', status: error.status });
        return;
      }
      res.status(500).json({ error: 'Failed to load activity', message: String(error) });
    }
  }
}
