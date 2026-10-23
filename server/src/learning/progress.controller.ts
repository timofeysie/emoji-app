import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { PlayerRepository } from '../persistence/player.repository';
import { ANSWERED_VERB_ID, XAPI_HOMEPAGE } from '../xapi/iris';
import { fetchStatements, loadLrsConfigFromEnv, LrsRequestError, type LrsConfig } from '../xapi/lrs-client';
import {
  chapterLearningObjects,
  getBookContent,
  UnknownBookError,
  UnknownChapterError,
  UnregisteredSensesError,
} from './book-content';
import { answersFromStatements, buildProgress, DEFAULT_LEITNER_CONFIG, foldTracks } from './leitner';
import { bookIri, KOREAN_BOOK, parseLearningObjectId } from './learning-object';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const progressQuerySchema = z
  .object({
    book: slugSchema.default(KOREAN_BOOK),
    chapter: z.string().regex(/^\d+$/, 'must be a chapter number'),
    scope: z.enum(['chapter', 'review']).default('chapter'),
    aspects: z
      .string()
      .default('reading,writing')
      .transform((value) => [...new Set(value.split(',').map((aspect) => aspect.trim()).filter(Boolean))])
      .pipe(z.array(slugSchema).min(1)),
    /** Pretend it's this time (testing the schedule). */
    now: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/** Statements per LRS page; Veracity and most LRSs cap lower anyway. */
const PAGE_SIZE = 500;

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/**
 * A student's Leitner progress for one chapter, derived from their
 * `answered` statements in the LRS (docs/xAPI/leitner-method.md → API).
 * The server reads the LRS so each environment uses its own (staging →
 * pilot). Referee-only once Step 0 auth lands.
 */
@Controller('api')
export class LearningProgressController {
  constructor(private readonly playerRepository: PlayerRepository) {}

  @Get('players/:playerId/progress')
  async getProgress(
    @Param('playerId') playerId: string,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const idResult = objectIdSchema.safeParse(playerId);
    const queryResult = progressQuerySchema.safeParse(query);
    if (!idResult.success || !queryResult.success) {
      const details = [
        ...(!idResult.success ? getValidationErrors(idResult.error) : []),
        ...(!queryResult.success ? getValidationErrors(queryResult.error) : []),
      ];
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }
    const { book, chapter, scope, aspects, now: nowParam } = queryResult.data;

    let objects;
    let content;
    try {
      content = getBookContent(book);
      objects = chapterLearningObjects(content, chapter);
    } catch (error) {
      if (error instanceof UnknownBookError || error instanceof UnknownChapterError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof UnregisteredSensesError) {
        res.status(422).json({ error: error.message, sourceRefs: error.sourceRefs });
        return;
      }
      throw error;
    }

    let config: LrsConfig;
    try {
      config = loadLrsConfigFromEnv();
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    try {
      const player = await this.playerRepository.getPlayer(playerId);
      if (!player) {
        res.status(404).json({ error: 'Player not found' });
        return;
      }

      // `agent` keeps tracks per student (L4); the book activity pulls every
      // chapter's evidence in one query (shared words, review scope).
      const statements = await fetchStatements(config, {
        agent: { objectType: 'Agent', account: { homePage: XAPI_HOMEPAGE, name: player.externalId } },
        verb: ANSWERED_VERB_ID,
        activity: bookIri(book),
        relatedActivities: true,
        limit: PAGE_SIZE,
      });
      const answers = answersFromStatements(statements, book, DEFAULT_LEITNER_CONFIG);
      const now = nowParam ? new Date(nowParam) : new Date();
      const { tracks, summary } = buildProgress({
        chapterObjectIds: objects.map((object) => object.id),
        aspects,
        tracks: foldTracks(answers, DEFAULT_LEITNER_CONFIG),
        scope,
        now,
      });

      const glossById = new Map(objects.map((object) => [object.id, object.gloss]));
      const senseGloss = new Map(
        [...content.senseBySourceRef.values()].map((sense) => [`${sense.word}/${sense.sense}`, sense.gloss]),
      );
      res.status(200).json({
        player: { id: player.id, label: player.label },
        book,
        chapter,
        scope,
        aspects,
        asOf: now.toISOString(),
        statementCount: statements.length,
        answerCount: answers.length,
        summary,
        tracks: tracks.map((track) => {
          const key = parseLearningObjectId(track.learningObjectId);
          return {
            ...track,
            word: key?.word ?? null,
            gloss:
              glossById.get(track.learningObjectId) ?? (key ? senseGloss.get(`${key.word}/${key.sense}`) : null) ?? null,
          };
        }),
      });
    } catch (error) {
      if (error instanceof LrsRequestError) {
        res.status(502).json({ error: 'The LRS request failed', status: error.status });
        return;
      }
      res.status(500).json({ error: 'Failed to load progress', message: String(error) });
    }
  }
}
