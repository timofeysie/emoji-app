import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthedRequest } from '../auth';
import { AuthGuard } from '../auth.guard';
import { LearnerService } from '../learner.service';
import { LearningProgressService, sendProgressError } from '../learning/learning-progress.service';
import { getValidationErrors, progressQuerySchema } from '../learning/progress.controller';
import { invalidateStudentEvidence } from '../learning/student-evidence';
import { loadLrsConfigFromEnv } from '../xapi/lrs-client';

const bookQuerySchema = progressQuerySchema.omit({ chapter: true, scope: true });

/**
 * The signed-in learner's Leitner progress (docs/yalla/implementation-plan.md
 * §5, milestone Y3). Same service and query as `/api/players/:id/progress`,
 * but the player is the one linked to the token (403 without a link).
 */
@Controller('api/yalla/me')
@UseGuards(AuthGuard)
export class YallaProgressController {
  constructor(
    private readonly learnerService: LearnerService,
    private readonly progressService: LearningProgressService,
  ) {}

  @Get('progress')
  async getProgress(@Req() req: AuthedRequest, @Query() query: unknown, @Res() res: Response): Promise<void> {
    const parsed = progressQuerySchema.safeParse(query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const { player } = await this.learnerService.resolveLearner(req);
    const { now, ...rest } = parsed.data;
    try {
      const progress = await this.progressService.forChapter(player, { ...rest, now: now ? new Date(now) : new Date() });
      res.status(200).json({ player: { id: player.id, label: player.label }, ...progress });
    } catch (error) {
      sendProgressError(res, error);
    }
  }

  /** Pills for every chapter of a book (book detail page), from one LRS read. */
  @Get('progress/book')
  async getBookProgress(@Req() req: AuthedRequest, @Query() query: unknown, @Res() res: Response): Promise<void> {
    const parsed = bookQuerySchema.safeParse(query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const { player } = await this.learnerService.resolveLearner(req);
    const { now, ...rest } = parsed.data;
    try {
      const progress = await this.progressService.forBook(player, { ...rest, now: now ? new Date(now) : new Date() });
      res.status(200).json({ player: { id: player.id, label: player.label }, ...progress });
    } catch (error) {
      sendProgressError(res, error);
    }
  }

  /**
   * "Recompute levels" (Profile): the next progress read or plan rebuilds
   * the linked player's history from the LRS, dropping voided statements.
   */
  @Post('recompute')
  async recompute(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const { player } = await this.learnerService.resolveLearner(req);
    try {
      invalidateStudentEvidence(loadLrsConfigFromEnv(), player.externalId);
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    res.status(204).end();
  }
}
