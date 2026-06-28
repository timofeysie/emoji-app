import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { GameDataRepository } from './persistence/game-data.repository';
import { BadgeStateService } from './badge-state.service';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

const bindPairSchema = z.object({
  pairName: z.string().min(1),
  controllerId: z.string().optional(),
});

const joinGameSchema = z.object({
  pairName: z.string().min(1),
  controllerId: z.string().optional(),
});

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

@Controller('api')
export class PairBindingsController {
  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly badgeStateService: BadgeStateService,
  ) {}

  @Post('games/:gameId/pairs')
  async bindPair(
    @Param('gameId') gameId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    const payloadResult = bindPairSchema.safeParse(body);
    if (!gameIdResult.success || !payloadResult.success) {
      const details = [
        ...(!gameIdResult.success ? getValidationErrors(gameIdResult.error) : []),
        ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      await this.gameDataRepository.bindPair({
        pairName: payloadResult.data.pairName,
        gameId,
        controllerId: payloadResult.data.controllerId,
      });
      res.status(201).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to bind pair', message: String(error) });
    }
  }

  @Get('pairs/:pairName')
  async getBinding(
    @Param('pairName') pairName: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!pairName || pairName.trim().length === 0) {
      res.status(400).json({ error: 'Validation failed', details: [{ path: 'pairName', message: 'must not be empty' }] });
      return;
    }

    try {
      const snapshot = await this.gameDataRepository.getBinding(pairName);
      if (!snapshot) {
        res.status(404).json({ error: 'Pair binding not found', pairName });
        return;
      }
      res.status(200).json(snapshot);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get pair binding', message: String(error) });
    }
  }

  @Post('games/:gameId/join')
  async joinGame(
    @Param('gameId') gameId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    const payloadResult = joinGameSchema.safeParse(body);
    if (!gameIdResult.success || !payloadResult.success) {
      const details = [
        ...(!gameIdResult.success ? getValidationErrors(gameIdResult.error) : []),
        ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      await this.gameDataRepository.markJoined(payloadResult.data.pairName);
      this.badgeStateService.broadcastDashboard({
        type: 'controller.joined',
        gameId,
        pairName: payloadResult.data.pairName,
        ...(payloadResult.data.controllerId ? { controllerId: payloadResult.data.controllerId } : {}),
        serverTime: new Date().toISOString(),
      });
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to join game', message: String(error) });
    }
  }
}
