import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { GameDataRepository } from './persistence/game-data.repository';
import { BadgeStateService } from './badge-state.service';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

const badgeNamesSchema = z.array(z.string().min(1)).min(1).optional();

/** `pairName` is the controller station; each roster badge is bound as a player. */
const bindPairSchema = z.object({
  pairName: z.string().min(1),
  controllerId: z.string().optional(),
  badgeNames: badgeNamesSchema,
});

/** `badgeNames` lists the station badges that join; defaults to `[pairName]` (Mode 1). */
const joinGameSchema = z.object({
  pairName: z.string().min(1),
  controllerId: z.string().optional(),
  badgeNames: badgeNamesSchema,
});

const setReadinessSchema = z.object({
  pairName: z.string().min(1),
  controllerId: z.string().optional(),
  ready: z.boolean(),
  badgeNames: badgeNamesSchema,
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

    const { pairName, controllerId } = payloadResult.data;
    const roster =
      payloadResult.data.badgeNames ??
      this.badgeStateService.getStationRoster(pairName) ??
      [pairName];
    const conflicts = this.badgeStateService.findRosterConflicts(pairName, roster);
    if (conflicts.length > 0) {
      res.status(409).json({
        error: 'Badge names belong to another station',
        badgeNames: conflicts,
      });
      return;
    }

    try {
      const badgeNames = await this.gameDataRepository.bindStation({
        stationName: pairName,
        badgeNames: roster,
        gameId,
        controllerId,
      });
      res.status(201).json({ ok: true, badgeNames });
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
      const { pairName, controllerId } = payloadResult.data;
      const joined = await this.gameDataRepository.markJoined({
        gameId,
        stationName: pairName,
        badgeNames: payloadResult.data.badgeNames ?? [pairName],
      });
      const serverTime = new Date().toISOString();
      for (const badgeName of joined) {
        this.badgeStateService.broadcastDashboard({
          type: 'controller.joined',
          gameId,
          pairName,
          badgeName,
          ...(controllerId ? { controllerId } : {}),
          serverTime,
        });
      }
      res.status(200).json({ ok: true, joined });
    } catch (error) {
      res.status(500).json({ error: 'Failed to join game', message: String(error) });
    }
  }

  @Post('games/:gameId/readiness')
  async setReadiness(
    @Param('gameId') gameId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    const payloadResult = setReadinessSchema.safeParse(body);
    if (!gameIdResult.success || !payloadResult.success) {
      const details = [
        ...(!gameIdResult.success ? getValidationErrors(gameIdResult.error) : []),
        ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      const { pairName, controllerId, ready } = payloadResult.data;
      const binding = await this.gameDataRepository.getBinding(pairName);
      if (
        !binding ||
        binding.gameId !== gameId ||
        binding.state !== 'active' ||
        binding.openQuestionId !== null
      ) {
        res.status(409).json({
          error: 'Readiness is only accepted from joined pairs between questions',
        });
        return;
      }

      const updated = await this.gameDataRepository.setPairReadyForNextQuestion({
        gameId,
        stationName: pairName,
        badgeNames: payloadResult.data.badgeNames ?? [pairName],
        ready,
      });
      if (updated.length === 0) {
        res.status(409).json({ error: 'Pair is not joined to this game' });
        return;
      }

      const serverTime = new Date().toISOString();
      for (const badgeName of updated) {
        this.badgeStateService.broadcastDashboard({
          type: 'controller.readiness.changed',
          gameId,
          pairName,
          badgeName,
          ready,
          ...(controllerId ? { controllerId } : {}),
          serverTime,
        });
      }
      res.status(200).json({ ok: true, ready, badgeNames: updated });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update readiness', message: String(error) });
    }
  }
}
