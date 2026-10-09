import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { PlayerNotFoundError, PlayerRepository } from './persistence/player.repository';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

/** Strict: a `Player` has no email or surname fields (security.md D4). */
const createPlayerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(40),
  })
  .strict();

const bindPlayerSchema = z
  .object({
    playerId: objectIdSchema,
    reason: z.enum(['initial', 'swap', 'replacement']).optional(),
  })
  .strict();

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/**
 * Referee-managed players and badge → player bindings (xAPI export Step 1a).
 * Referee-only once Step 0 auth lands; until then the prototype guardrails apply.
 */
@Controller('api')
export class PlayersController {
  constructor(private readonly playerRepository: PlayerRepository) {}

  @Get('players')
  async listPlayers(@Res() res: Response): Promise<void> {
    try {
      const players = await this.playerRepository.listPlayers();
      res.status(200).json({ players });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list players', message: String(error) });
    }
  }

  @Post('players')
  async createPlayer(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const payload = createPlayerSchema.safeParse(body);
    if (!payload.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(payload.error) });
      return;
    }
    try {
      const player = await this.playerRepository.createPlayer(payload.data);
      res.status(201).json({ player });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create player', message: String(error) });
    }
  }

  @Get('games/:gameId/player-bindings')
  async getPlayerBindings(@Param('gameId') gameId: string, @Res() res: Response): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId', details: getValidationErrors(gameIdResult.error) });
      return;
    }
    try {
      const result = await this.playerRepository.getGamePlayerBindings(gameId);
      res.status(200).json(result);
    } catch (error) {
      this.sendError(res, error, 'Failed to fetch player bindings');
    }
  }

  @Put('games/:gameId/player-bindings/:badgeName')
  async bindPlayer(
    @Param('gameId') gameId: string,
    @Param('badgeName') badgeName: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    const payload = bindPlayerSchema.safeParse(body);
    const badgeMissing = !badgeName || badgeName.trim().length === 0;
    if (!gameIdResult.success || !payload.success || badgeMissing) {
      const details = [
        ...(!gameIdResult.success ? getValidationErrors(gameIdResult.error) : []),
        ...(!payload.success ? getValidationErrors(payload.error) : []),
        ...(badgeMissing ? [{ path: 'badgeName', message: 'must not be empty' }] : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }
    try {
      const binding = await this.playerRepository.bindPlayer({
        gameId,
        badgeName,
        playerId: payload.data.playerId,
        reason: payload.data.reason,
      });
      res.status(200).json({ binding });
    } catch (error) {
      this.sendError(res, error, 'Failed to bind player');
    }
  }

  @Delete('games/:gameId/player-bindings/:badgeName')
  async unbindPlayer(
    @Param('gameId') gameId: string,
    @Param('badgeName') badgeName: string,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId', details: getValidationErrors(gameIdResult.error) });
      return;
    }
    try {
      const removed = await this.playerRepository.unbindPlayer({ gameId, badgeName });
      if (!removed) {
        res.status(404).json({ error: 'Badge has no player bound', badgeName });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      this.sendError(res, error, 'Failed to unbind player');
    }
  }

  private sendError(res: Response, error: unknown, fallback: string): void {
    if (error instanceof PlayerNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: fallback, message: String(error) });
  }
}
