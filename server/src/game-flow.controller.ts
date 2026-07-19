import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { GameDataRepository } from './persistence/game-data.repository';
import { BadgeStateService } from './badge-state.service';
import { NfcCardService } from './nfc-card.service';
import type { SlotLabel } from './persistence/domain-types';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');
const slotLabelSchema = z.enum(['A', 'B', 'C', 'D', 'E']);
const playModeSchema = z.enum(['standard', 'cut-throat']);
const participantRoleSchema = z.enum(['player', 'referee', 'spectator']);
const questionModeSchema = z.enum(['standard', 'cut-throat', 'mixed']);
const questionStateSchema = z.enum(['open', 'closed']);
const gameLifecycleStateSchema = z.enum(['ready', 'lobby', 'active', 'paused', 'completed', 'cancelled']);

const createGameSchema = z.object({
  title: z.string().min(1),
  createdByUserId: objectIdSchema,
});

const addParticipantSchema = z
  .object({
    userId: objectIdSchema,
    role: participantRoleSchema,
    playMode: playModeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'player' && !value.playMode) {
      ctx.addIssue({
        path: ['playMode'],
        code: z.ZodIssueCode.custom,
        message: 'playMode is required when role is player',
      });
    }
  });

const createNfcCardGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  cards: z
    .array(
      z.object({
        cardUid: z.string().min(1),
        slotLabel: slotLabelSchema,
        displayName: z.string().min(1),
      }),
    )
    .min(1),
});

const attachNfcCardGroupSchema = z.object({
  assignedByUserId: objectIdSchema.optional(),
});

const createQuestionSchema = z.object({
  gameId: objectIdSchema,
  createdByUserId: objectIdSchema,
  text: z.string().min(1),
  sequence: z.number().int().positive(),
  mode: questionModeSchema,
  answerOptions: z
    .array(
      z.object({
        text: z.string().min(1),
        sequence: z.number().int().positive(),
        slotLabel: slotLabelSchema,
        isCorrect: z.boolean(),
      }),
    )
    .min(2),
});

const setQuestionStateSchema = z.object({
  gameId: objectIdSchema,
  state: questionStateSchema,
});

const setGameStateSchema = z.object({
  state: gameLifecycleStateSchema,
});

const submitGuessSchema = z.object({
  gameId: objectIdSchema,
  questionId: objectIdSchema,
  guesserUserId: objectIdSchema.optional(),
  pairName: z.string().min(1).optional(),
  badgeId: objectIdSchema.optional(),
  cardUid: z.string().min(1),
  slotLabel: slotLabelSchema.optional(),
});

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/** Maps a new game state to the event name sent to bound controllers. */
const controllerEventForState: Partial<Record<string, string>> = {
  ready: 'game.ready',
  lobby: 'game.opened',
  active: 'game.started',
  completed: 'game.ended',
  cancelled: 'game.ended',
};

@Controller('api')
export class GameFlowController {
  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly badgeStateService: BadgeStateService,
    private readonly nfcCardService: NfcCardService,
  ) {}

  @Get('games')
  async listGames(@Res() res: Response): Promise<void> {
    try {
      const games = await this.gameDataRepository.listGames();
      res.status(200).json({ games });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list games', message: String(error) });
    }
  }

  @Get('games/:gameId')
  async getGameDetail(
    @Param('gameId') gameId: string,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId', details: getValidationErrors(gameIdResult.error) });
      return;
    }
    try {
      const game = await this.gameDataRepository.getGameDetail(gameId);
      if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }
      res.status(200).json(game);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch game', message: String(error) });
    }
  }

  @Get('games/:gameId/nfc-card-group')
  async getActiveNfcCardGroup(
    @Param('gameId') gameId: string,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId', details: getValidationErrors(gameIdResult.error) });
      return;
    }
    try {
      const group = await this.gameDataRepository.getActiveNfcCardGroupForGame(gameId);
      res.status(200).json({ group });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch NFC card group', message: String(error) });
    }
  }

  @Get('games/:gameId/questions')
  async getGameQuestions(
    @Param('gameId') gameId: string,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId', details: getValidationErrors(gameIdResult.error) });
      return;
    }
    try {
      const questions = await this.gameDataRepository.getQuestionsByGameId(gameId);
      res.status(200).json({ questions });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch questions', message: String(error) });
    }
  }

  @Get('games/:gameId/scores')
  async getGameScores(
    @Param('gameId') gameId: string,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId', details: getValidationErrors(gameIdResult.error) });
      return;
    }
    try {
      const scores = await this.gameDataRepository.getGameScores(gameId);
      res.status(200).json(scores);
    } catch (error) {
      const message = String(error);
      if (message.includes('Game not found')) {
        res.status(404).json({ error: 'Game not found', message });
        return;
      }
      res.status(500).json({ error: 'Failed to fetch scores', message });
    }
  }

  @Post('games')
  async createGame(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const result = createGameSchema.safeParse(body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(result.error) });
      return;
    }

    try {
      const gameId = await this.gameDataRepository.createGame(result.data);
      res.status(201).json({ gameId });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create game', message: String(error) });
    }
  }

  @Post('games/:gameId/state')
  async setGameState(
    @Param('gameId') gameId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    const payloadResult = setGameStateSchema.safeParse(body);
    if (!gameIdResult.success || !payloadResult.success) {
      const details = [
        ...(!gameIdResult.success ? getValidationErrors(gameIdResult.error) : []),
        ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      const { state } = payloadResult.data;
      await this.gameDataRepository.setGameState({ gameId, state });

      const serverTime = new Date().toISOString();

      // Notify dashboard of the state change
      this.badgeStateService.broadcastDashboard({
        type: 'game.state.changed',
        gameId,
        state,
        serverTime,
      });

      const pairNames = await this.gameDataRepository.getBindingsByGameId(gameId);

      if (state === 'completed' && pairNames.length > 0) {
        // Enriched per-pair game.ended (rank / score / isWinner). Ties for
        // first place all get isWinner: true.
        const { scores } = await this.gameDataRepository.getGameScores(gameId);
        const topScore = scores.reduce((max, row) => Math.max(max, row.correct), 0);
        for (const row of scores) {
          const rank = scores.filter((other) => other.correct > row.correct).length + 1;
          const isWinner = row.correct === topScore;
          console.log(
            `[GAME] server | ${isWinner ? 'winner' : 'loser'} | ${
              isWinner ? 'Game winner' : 'Game loser'
            } | pair=${row.pairName} rank=${rank} score=${row.correct}`,
          );
          this.badgeStateService.sendToPairNames([row.pairName], {
            type: 'game.ended',
            gameId,
            pairName: row.pairName,
            isWinner,
            rank,
            score: row.correct,
            serverTime,
          });
        }
      } else {
        const controllerEvent = controllerEventForState[state];
        if (controllerEvent && pairNames.length > 0) {
          this.badgeStateService.sendToPairNames(pairNames, {
            type: controllerEvent,
            gameId,
            serverTime,
          });
        }
      }

      // Start Game → arm NFC: open the next closed question and notify controllers.
      // Without this, devices stay on green "active" and never poll for cards.
      let openedQuestionId: string | null = null;
      if (state === 'active') {
        openedQuestionId = await this.gameDataRepository.openNextQuestionForGame(gameId);
        if (openedQuestionId) {
          const questionEvent = {
            type: 'question.opened' as const,
            gameId,
            questionId: openedQuestionId,
            serverTime: new Date().toISOString(),
          };
          console.log(
            `[GAME] server | question_open | Question open | auto on Start Game questionId=${openedQuestionId}`,
          );
          this.badgeStateService.broadcastDashboard(questionEvent);
          if (pairNames.length > 0) {
            this.badgeStateService.sendToPairNames(pairNames, questionEvent);
          }
        }
      }

      res.status(200).json({
        ok: true,
        gameId,
        state,
        ...(openedQuestionId ? { openedQuestionId } : {}),
      });
    } catch (error) {
      res.status(400).json({ error: 'Failed to update game state', message: String(error) });
    }
  }

  @Post('games/:gameId/participants')
  async addParticipant(
    @Param('gameId') gameId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    const payloadResult = addParticipantSchema.safeParse(body);
    if (!gameIdResult.success || !payloadResult.success) {
      const details = [
        ...(!gameIdResult.success ? getValidationErrors(gameIdResult.error) : []),
        ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      await this.gameDataRepository.addParticipant({ gameId, ...payloadResult.data });
      res.status(201).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to add participant', message: String(error) });
    }
  }

  @Post('games/nfc-card-groups')
  async createNfcCardGroup(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const result = createNfcCardGroupSchema.safeParse(body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(result.error) });
      return;
    }

    try {
      // Idempotent: re-posting demo seed cards must not 500 on unique cardUid.
      const groupId = await this.gameDataRepository.ensureNfcCardGroup(result.data);
      res.status(201).json({ groupId });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create NFC card group', message: String(error) });
    }
  }

  /**
   * Ensure the hardcoded Demo Set (from NfcCardService seed) exists and attach
   * it to the game. Preferred referee path — avoids create-then-attach races.
   */
  @Post('games/:gameId/nfc-card-groups/demo')
  async assignDemoNfcCardGroup(
    @Param('gameId') gameId: string,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    if (!gameIdResult.success) {
      res.status(400).json({ error: 'Invalid gameId', details: getValidationErrors(gameIdResult.error) });
      return;
    }

    const seedCards = this.nfcCardService.getCards();
    const cards = seedCards
      .filter((card): card is typeof card & { slotLabel: SlotLabel } => Boolean(card.slotLabel))
      .map((card) => ({
        cardUid: card.id,
        slotLabel: card.slotLabel,
        displayName: card.name,
      }));
    if (cards.length === 0) {
      res.status(500).json({ error: 'Demo NFC seed has no cards with slotLabel' });
      return;
    }

    try {
      const groupId = await this.gameDataRepository.ensureNfcCardGroup({
        name: 'Demo Set',
        description: 'Hardcoded demo NFC cards (seed)',
        cards,
      });
      await this.gameDataRepository.assignNfcCardGroupToGame({ gameId, groupId });
      const group = await this.gameDataRepository.getActiveNfcCardGroupForGame(gameId);
      res.status(200).json({ group });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to assign demo NFC card group',
        message: String(error),
      });
    }
  }

  @Post('games/:gameId/nfc-card-groups/:groupId/attach')
  async attachNfcCardGroup(
    @Param('gameId') gameId: string,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const gameIdResult = objectIdSchema.safeParse(gameId);
    const groupIdResult = objectIdSchema.safeParse(groupId);
    const payloadResult = attachNfcCardGroupSchema.safeParse(body);
    if (!gameIdResult.success || !groupIdResult.success || !payloadResult.success) {
      const details = [
        ...(!gameIdResult.success ? getValidationErrors(gameIdResult.error) : []),
        ...(!groupIdResult.success ? getValidationErrors(groupIdResult.error) : []),
        ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      await this.gameDataRepository.assignNfcCardGroupToGame({
        gameId,
        groupId,
        assignedByUserId: payloadResult.data.assignedByUserId,
      });
      res.status(201).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to attach NFC card group', message: String(error) });
    }
  }

  @Post('questions')
  async createQuestion(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const result = createQuestionSchema.safeParse(body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(result.error) });
      return;
    }

    try {
      const questionId = await this.gameDataRepository.createQuestionWithOptions(result.data);
      res.status(201).json({ questionId });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create question', message: String(error) });
    }
  }

  @Post('questions/:questionId/state')
  async setQuestionState(
    @Param('questionId') questionId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const questionIdResult = objectIdSchema.safeParse(questionId);
    const payloadResult = setQuestionStateSchema.safeParse(body);
    if (!questionIdResult.success || !payloadResult.success) {
      const details = [
        ...(!questionIdResult.success ? getValidationErrors(questionIdResult.error) : []),
        ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      const { gameId, state } = payloadResult.data;
      await this.gameDataRepository.setQuestionState({
        gameId,
        questionId,
        state,
      });

      const serverTime = new Date().toISOString();
      const pairNames = await this.gameDataRepository.getBindingsByGameId(gameId);
      const questionEventType = state === 'open' ? 'question.opened' : 'question.closed';
      const questionEvent = {
        type: questionEventType,
        gameId,
        questionId,
        serverTime,
      };

      console.log(
        `[GAME] server | ${
          state === 'open' ? 'question_open' : 'question_closed'
        } | ${state === 'open' ? 'Question open' : 'Question closed'} | questionId=${questionId}`,
      );

      this.badgeStateService.broadcastDashboard(questionEvent);
      if (pairNames.length > 0) {
        this.badgeStateService.sendToPairNames(pairNames, questionEvent);
      }

      if (state === 'closed') {
        const result = await this.gameDataRepository.computeQuestionResult(gameId, questionId);
        const resultEvent = {
          type: 'question.result' as const,
          ...result,
          serverTime,
        };
        console.log(
          `[GAME] server | question_closed | Question closed | question.result pairs=${result.results.length} correctSlot=${result.correctSlotLabel}`,
        );
        this.badgeStateService.broadcastDashboard(resultEvent);
        if (pairNames.length > 0) {
          this.badgeStateService.sendToPairNames(pairNames, resultEvent);
        }
      }

      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update question state', message: String(error) });
    }
  }

  @Post('guesses')
  async submitGuess(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const result = submitGuessSchema.safeParse(body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(result.error) });
      return;
    }

    try {
      const outcome = await this.gameDataRepository.submitGuess(result.data);

      const { gameId, questionId, pairName, badgeId, cardUid } = result.data;
      this.badgeStateService.broadcastDashboard({
        type: 'nfc.tagged',
        gameId,
        questionId,
        ...(pairName ? { pairName } : {}),
        ...(badgeId ? { badgeId } : {}),
        ...(cardUid ? { cardUid } : {}),
        slotLabel: outcome.slotLabel ?? undefined,
        isCorrect: outcome.isCorrect,
        serverTime: new Date().toISOString(),
      });

      res.status(201).json(outcome);
    } catch (error) {
      res.status(400).json({ error: 'Failed to submit guess', message: String(error) });
    }
  }
}
