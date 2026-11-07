import { Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { GameExportService } from './game-export.service';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

/**
 * Manual export of one completed game's xAPI statements to the configured
 * LRS (docs/xAPI/xapi-export-plan.md Step 1c). Also Retry export for a
 * Leitner game left pending: success deletes it (docs/xAPI/leitner-method.md
 * → lifecycle). Referee-only once Step 0 auth lands; until then the
 * prototype guardrails apply.
 */
@Controller('api')
export class XapiExportController {
  constructor(private readonly gameExportService: GameExportService) {}

  @Post('games/:gameId/xapi-export')
  async exportGame(@Param('gameId') gameId: string, @Res() res: Response): Promise<void> {
    if (!objectIdSchema.safeParse(gameId).success) {
      res.status(400).json({ error: 'Invalid gameId' });
      return;
    }
    try {
      const outcome = await this.gameExportService.exportGame(gameId);
      if (!outcome.ok) {
        res.status(outcome.status).json(outcome.body);
        return;
      }
      res.status(200).json({
        ok: true,
        statementsSent: outcome.statementsSent,
        ...(outcome.deleted ? { deleted: true, summary: outcome.summary } : {}),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to export game', message: String(error) });
    }
  }
}
