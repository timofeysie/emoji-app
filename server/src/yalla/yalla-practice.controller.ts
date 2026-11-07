import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../auth';
import { AuthGuard } from '../auth.guard';
import { firstSense, QUIZ_SLOT_LABELS, vocabSkillValues, type VocabSkill } from '../games/generators/vocab-choice';
import { LearnerService } from '../learner.service';
import { isTypedCorrect, typedItem } from '../learning/answer-check';
import { getBookContent, UnknownBookError } from '../learning/book-content';
import { LrsNotConfiguredError } from '../learning/learning-progress.service';
import { KOREAN_BOOK } from '../learning/learning-object';
import { LeitnerPlanner, sendPlanError, termsOf } from '../learning/leitner-planner';
import { getValidationErrors } from '../learning/progress.controller';
import { loadLrsConfigFromEnv, LrsConflictError, LrsRequestError, sendStatements } from '../xapi/lrs-client';
import {
  buildYallaAttemptStatements,
  type XApiAnsweredStatement,
  type XApiAssessedStatement,
  type XApiStatement,
} from '../xapi/statement-builder';

const BOOK = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const SLOT = z.enum(QUIZ_SLOT_LABELS);

const sessionSchema = z
  .object({
    book: BOOK.default(KOREAN_BOOK),
    chapter: z
      .union([z.string().regex(/^\d+$/, 'must be a chapter number'), z.number().int().positive()])
      .transform(String),
    scope: z.enum(['chapter', 'review']).default('chapter'),
    aspects: z
      .array(z.enum(vocabSkillValues))
      .min(1)
      .default(['reading', 'writing'])
      .transform((aspects) => [...new Set(aspects)]),
    count: z.number().int().min(1).max(20).default(10),
    maxNew: z.number().int().min(0).max(20).default(4),
    /** Testing only: pretend it's this time. */
    now: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/** A batch the outbox sends: ≤ 20 attempts, so one LRS request (docs/yalla/implementation-plan.md §6). */
export const MAX_ATTEMPTS_PER_POST = 20;

const attemptBase = {
  attemptId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  itemId: z.string().regex(/^\d{1,3}$/),
  book: BOOK,
  sourceRef: z.string().regex(/^ch\d+\/vocabulary\/\d+$/),
  learningObjectId: z.string().min(1).max(300),
  aspect: z.enum(vocabSkillValues),
  answeredAt: z.string().datetime({ offset: true }),
  openedAt: z.string().datetime({ offset: true }).optional(),
  /** The client's own verdict, for its feedback. Ignored: the server re-checks. */
  correct: z.boolean().optional(),
};

const attemptSchema = z.discriminatedUnion('channel', [
  z
    .object({
      ...attemptBase,
      channel: z.literal('onscreen-choice'),
      options: z
        .array(z.object({ slotLabel: SLOT, text: z.string().min(1).max(200) }).strict())
        .length(QUIZ_SLOT_LABELS.length),
      response: SLOT,
    })
    .strict(),
  z
    .object({
      ...attemptBase,
      channel: z.literal('keyboard'),
      /** As typed; `''` is "Don't know". */
      response: z.string().max(200),
    })
    .strict(),
]);

const resultsSchema = z
  .object({
    sessionId: z.string().uuid(),
    attempts: z.array(attemptSchema).min(1).max(MAX_ATTEMPTS_PER_POST),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.attempts.map((attempt) => attempt.attemptId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ path: ['attempts'], code: z.ZodIssueCode.custom, message: 'attemptId must be unique' });
    }
  });

type Attempt = z.infer<typeof attemptSchema>;

/** Answers older than this aren't accepted: an outbox entry this old is lost, not late. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Allowed clock skew for a client's `answeredAt`. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/** A choice item's prompt and correct option text, from the content (what the generator asks). */
function expected(aspect: VocabSkill, term: { target: string; native: string }): { prompt: string; answer: string } {
  return aspect === 'reading'
    ? { prompt: term.target, answer: firstSense(term.native) }
    : { prompt: firstSense(term.native), answer: term.target };
}

class InvalidAttemptError extends Error {
  constructor(
    public readonly attemptId: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Re-checks one attempt against the book content and builds its statements.
 * Choice: the client's options are accepted only if exactly one of them is
 * the right answer, and `success` is whether the chosen one is it. Typed:
 * `answer-check.ts` against the content (the same check the client ran).
 */
function recheck(
  attempt: Attempt,
  now: number,
  base: { sessionId: string; externalId: string },
): [XApiAnsweredStatement, XApiAssessedStatement] {
  const content = getBookContent(attempt.book);
  const sense = content.senseBySourceRef.get(attempt.sourceRef);
  const term = termsOf(content).bySourceRef.get(attempt.sourceRef);
  if (!sense || !term || sense.id !== attempt.learningObjectId) {
    throw new InvalidAttemptError(attempt.attemptId, 'learningObjectId does not match sourceRef');
  }

  const answeredAt = Date.parse(attempt.answeredAt);
  if (answeredAt > now + MAX_SKEW_MS || answeredAt < now - MAX_AGE_MS) {
    throw new InvalidAttemptError(attempt.attemptId, 'answeredAt is too far from now');
  }
  if (attempt.openedAt && Date.parse(attempt.openedAt) > answeredAt) {
    throw new InvalidAttemptError(attempt.attemptId, 'openedAt is after answeredAt');
  }

  const common = {
    ...base,
    attemptId: attempt.attemptId,
    itemId: attempt.itemId,
    answeredAt: attempt.answeredAt,
    openedAt: attempt.openedAt ?? null,
    learning: {
      learningObjectId: sense.id,
      book: content.book,
      sourceRef: attempt.sourceRef,
      aspect: attempt.aspect,
      target: term.target,
      native: term.native,
    },
  };

  if (attempt.channel === 'keyboard') {
    const { prompt, answer } = typedItem(attempt.aspect, term.target, term.native);
    return buildYallaAttemptStatements({
      ...common,
      inputChannel: 'keyboard',
      prompt,
      response: attempt.response,
      correctResponse: answer,
      success: isTypedCorrect(attempt.response, answer),
    });
  }

  const { prompt, answer } = expected(attempt.aspect, term);
  const slots = new Set(attempt.options.map((option) => option.slotLabel));
  const texts = new Set(attempt.options.map((option) => option.text));
  const correctOptions = attempt.options.filter((option) => option.text === answer);
  if (slots.size !== attempt.options.length || texts.size !== attempt.options.length || correctOptions.length !== 1) {
    throw new InvalidAttemptError(attempt.attemptId, 'options do not match the content');
  }
  return buildYallaAttemptStatements({
    ...common,
    inputChannel: 'onscreen-choice',
    prompt,
    answerOptions: attempt.options.map((option) => ({ ...option, isCorrect: option.text === answer })),
    response: attempt.response,
  });
}

/**
 * YALLA solo Leitner practice (docs/yalla/implementation-plan.md §6,
 * milestone Y4). Sessions are planned like a badge game but stored nowhere:
 * the client keeps the session and posts its answers, and the server
 * re-checks them and sends `yalla-solo` evidence to the LRS.
 */
@Controller('api/yalla/me')
@UseGuards(AuthGuard)
export class YallaPracticeController {
  constructor(
    private readonly learnerService: LearnerService,
    private readonly planner: LeitnerPlanner,
  ) {}

  /** Plans a session. 200 with no items when nothing is left to ask. */
  @Post('sessions')
  async createSession(@Req() req: AuthedRequest, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = sessionSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const { player } = await this.learnerService.resolveLearner(req);
    const input = parsed.data;
    try {
      const plan = await this.planner.plan(
        {
          ...input,
          fill: true,
          // A fresh option order every session; badge games keep their day seed.
          seed: randomInt(0, 0x7fffffff),
          now: input.now ? new Date(input.now) : undefined,
        },
        async () => player,
      );
      const pickById = new Map(plan.picks.map((pick) => [pick.learningObjectId, pick]));
      res.status(200).json({
        sessionId: randomUUID(),
        player: { id: player.id, label: player.label },
        book: plan.content.book,
        chapter: input.chapter,
        scope: input.scope,
        aspects: input.aspects,
        plannedAt: plan.now.toISOString(),
        report: plan.report,
        items: plan.items.map((item, index) => {
          const pick = pickById.get(item.learning!.learningObjectId)!;
          const options = item.options.map((option, slot) => ({ slotLabel: QUIZ_SLOT_LABELS[slot], text: option.text }));
          return {
            itemId: String(index + 1),
            aspect: item.skill,
            learningObjectId: pick.learningObjectId,
            sourceRef: pick.sourceRef,
            word: pick.word,
            gloss: pick.gloss,
            reason: pick.reason,
            level: pick.level,
            status: pick.status,
            prompt: item.prompt,
            options,
            // The client shows feedback at once; the server re-checks every answer anyway.
            answer: QUIZ_SLOT_LABELS[item.options.findIndex((option) => option.isCorrect)],
          };
        }),
      });
    } catch (error) {
      sendPlanError(res, error, 'Failed to plan the practice session');
    }
  }

  /**
   * Records answers: re-checks each, then sends `answered` + `assessed`
   * statements to the LRS before answering, so a 2xx means they're in.
   * Statement ids derive from session and attempt, so a retry is a no-op.
   */
  @Post('results')
  async postResults(@Req() req: AuthedRequest, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const parsed = resultsSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const { player } = await this.learnerService.resolveLearner(req);
    const { sessionId, attempts } = parsed.data;

    const now = Date.now();
    const statements: XApiStatement[] = [];
    const results: Array<{ attemptId: string; correct: boolean }> = [];
    try {
      for (const attempt of attempts) {
        const [answered, assessed] = recheck(attempt, now, { sessionId, externalId: player.externalId });
        statements.push(answered, assessed);
        results.push({ attemptId: attempt.attemptId, correct: answered.result.success });
      }
    } catch (error) {
      if (error instanceof InvalidAttemptError) {
        res.status(422).json({ error: error.message, attemptId: error.attemptId });
        return;
      }
      if (error instanceof UnknownBookError) {
        res.status(422).json({ error: error.message });
        return;
      }
      throw error;
    }

    try {
      let config;
      try {
        config = loadLrsConfigFromEnv();
      } catch (error) {
        throw new LrsNotConfiguredError(error instanceof Error ? error.message : String(error));
      }
      await sendStatements(config, statements);
      res.status(200).json({ sent: statements.length, results });
    } catch (error) {
      if (error instanceof LrsConflictError) {
        // Same ids, different content: the client changed an answer it already sent.
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof LrsNotConfiguredError) {
        res.status(503).json({ error: error.message });
        return;
      }
      if (error instanceof LrsRequestError) {
        res.status(502).json({ error: 'The LRS request failed', status: error.status });
        return;
      }
      res.status(500).json({ error: 'Failed to record the answers', message: String(error) });
    }
  }
}
