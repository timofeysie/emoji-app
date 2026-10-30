import { Body, Controller, Get, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import type { AuthedRequest } from './auth';
import { AuthGuard } from './auth.guard';
import { LearnerService } from './learner.service';
import { PlayerRepository } from './persistence/player.repository';
import { PlayerAlreadyLinkedError, UserRepository } from './persistence/user.repository';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

/** Link to an existing player, unlink (`null`), or create a player and link it. */
const setPlayerSchema = z.union([
  z.object({ playerId: objectIdSchema.nullable() }).strict(),
  z.object({ create: z.object({ firstName: z.string().trim().min(1).max(40) }).strict() }).strict(),
]);

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.') || 'root', message: issue.message }));
}

/**
 * The signed-in user (docs/yalla/implementation-plan.md §4). Prototype rule
 * (security.md D14): a user may link themselves to any player that no
 * other user practises as.
 */
@Controller('api/me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly learnerService: LearnerService,
    private readonly userRepository: UserRepository,
    private readonly playerRepository: PlayerRepository,
  ) {}

  @Get()
  async getMe(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const { me } = await this.learnerService.me(req);
    res.status(200).json(me);
  }

  @Put('player')
  async setPlayer(@Req() req: AuthedRequest, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = setPlayerSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }

    const { user } = await this.learnerService.me(req);
    let playerId: string | null;
    if ('create' in parsed.data) {
      playerId = (await this.playerRepository.createPlayer({ firstName: parsed.data.create.firstName })).id;
    } else {
      playerId = parsed.data.playerId;
      if (playerId && !(await this.playerRepository.getPlayer(playerId))) {
        res.status(404).json({ error: 'Player not found' });
        return;
      }
    }

    try {
      await this.userRepository.setPlayer(user.id, playerId);
    } catch (error) {
      if (error instanceof PlayerAlreadyLinkedError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
    const { me } = await this.learnerService.me(req);
    res.status(200).json(me);
  }
}
