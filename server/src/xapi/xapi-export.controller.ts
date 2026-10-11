import { Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import { buildGameStatements, UnattributedBadgeError, type XApiStatement } from './statement-builder';
import {
  loadLrsConfigFromEnv,
  LrsConflictError,
  LrsRequestError,
  sendStatements,
  type LrsConfig,
} from './lrs-client';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

/**
 * Manual export of one completed game's xAPI statements to the configured
 * LRS (docs/xAPI/xapi-export-plan.md Step 1c). Referee-only once Step 0
 * auth lands; until then the prototype guardrails apply.
 */
@Controller('api')
export class XapiExportController {
  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly playerRepository: PlayerRepository,
  ) {}

  @Post('games/:gameId/xapi-export')
  async exportGame(@Param('gameId') gameId: string, @Res() res: Response): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId' });
      return;
    }

    const game = await this.gameDataRepository.getGameExportData(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (game.state !== 'completed') {
      res.status(400).json({ error: `Game must be completed to export; current state is '${game.state}'.` });
      return;
    }
    if (!game.startedAt || !game.endedAt) {
      res.status(400).json({ error: 'Game has no startedAt/endedAt; cannot export.' });
      return;
    }

    const { missingBadges, bindings } = await this.playerRepository.getGamePlayerBindings(gameId);
    if (missingBadges.length > 0) {
      res.status(400).json({
        error: 'Every badge that recorded a guess must have an assigned player before export.',
        missingBadges,
      });
      return;
    }

    const { scores } = await this.gameDataRepository.getGameScores(gameId);
    const playersById = new Map(bindings.map((b) => [b.player.id, b.player]));

    let statements: XApiStatement[];
    try {
      statements = buildGameStatements({
        game: { id: game.id, title: game.title, startedAt: game.startedAt, endedAt: game.endedAt },
        questions: game.questions,
        guesses: game.guesses,
        scores,
        playerBindings: bindings.map((b) => ({
          badgeName: b.badgeName,
          playerId: b.player.id,
          assignedAt: b.assignedAt,
          unassignedAt: b.unassignedAt,
        })),
        players: [...playersById.values()].map((p) => ({ id: p.id, externalId: p.externalId })),
      });
    } catch (error) {
      if (error instanceof UnattributedBadgeError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }

    let lrsConfig: LrsConfig;
    try {
      lrsConfig = loadLrsConfigFromEnv();
    } catch (error) {
      res.status(500).json({ error: String((error as Error).message) });
      return;
    }

    try {
      const { sent } = await sendStatements(lrsConfig, statements);
      res.status(200).json({ ok: true, statementsSent: sent });
    } catch (error) {
      if (error instanceof LrsConflictError) {
        res.status(409).json({
          error:
            'This game was already exported with a different statement shape. Re-exporting with changed content is rejected by the LRS.',
          lrsMessage: error.body,
        });
        return;
      }
      if (error instanceof LrsRequestError) {
        res.status(502).json({ error: 'LRS rejected the export', status: error.status, lrsMessage: error.body });
        return;
      }
      res.status(502).json({ error: 'Failed to reach the LRS', message: String(error) });
    }
  }
}
