import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { toQuestionInput, vocabSkillValues } from '../games/generators/vocab-choice';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import { KOREAN_BOOK } from './learning-object';
import { LeitnerPlanner, sendPlanError, type LeitnerPlan } from './leitner-planner';
import { LeitnerSetupService, previewSetup } from './leitner-setup.service';

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

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/**
 * Plans and creates a student's next solo Leitner game
 * (docs/xAPI/leitner-method.md → Referee flow, API). Referee-only once
 * Step 0 auth lands. Creating also presets the student's live station and
 * a card group (`setup`); the dry run says what it would preset.
 */
@Controller('api')
export class LeitnerGamesController {
  constructor(
    private readonly playerRepository: PlayerRepository,
    private readonly gameDataRepository: GameDataRepository,
    private readonly planner: LeitnerPlanner,
    private readonly leitnerSetup?: LeitnerSetupService,
  ) {}

  @Post('leitner-games')
  async createLeitnerGame(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = createLeitnerGameSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const input = parsed.data;

    let planned: LeitnerPlan;
    try {
      planned = await this.planner.plan(
        { ...input, now: input.now ? new Date(input.now) : undefined },
        () => this.playerRepository.getPlayer(input.playerId),
      );
    } catch (error) {
      sendPlanError(res, error, 'Failed to plan the Leitner game');
      return;
    }

    try {
      const { player, content, seed, now, picks, report, supersedes } = planned;
      const questions = planned.items.map((item, index) => toQuestionInput(item, index + 1));

      const plan = {
        book: content.book,
        chapter: input.chapter,
        scope: input.scope,
        aspects: input.aspects,
        seed,
        now: now.toISOString(),
        picks,
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

      const resolvedSetup = await this.leitnerSetup?.resolve(player, supersedes).catch(() => undefined);
      if (input.dryRun) {
        res.status(200).json({ plan, ...(resolvedSetup ? { setup: previewSetup(resolvedSetup) } : {}) });
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
      const setup = resolvedSetup ? await this.leitnerSetup!.apply(gameId, player, resolvedSetup) : undefined;
      res.status(201).json({ gameId, plan, ...(setup ? { setup } : {}) });
    } catch (error) {
      sendPlanError(res, error, 'Failed to plan the Leitner game');
    }
  }
}
