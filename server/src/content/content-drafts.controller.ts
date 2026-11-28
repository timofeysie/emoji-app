import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';
import { ContentDraftRepository, type ContentDraftRecord } from '../persistence/content-draft.repository';
import { GameDataRepository } from '../persistence/game-data.repository';
import { RefereeGuard, refereeUserIdOf, type RefereeRequest } from '../referee.guard';
import { chapterDraftPayloadSchema, type ChapterDraftPayload } from './chapter-draft';
import { ChapterDraftError, ChapterDraftsService } from './chapter-drafts.service';
import {
  DEFAULT_LANGUAGE,
  draftSettingsSchema,
  GAME_DRAFT_LIMITS,
  gameDraftPayloadSchema,
  gameDraftProblems,
  gameDraftQuestions,
  sourceInputSchema,
  type GameDraftPayload,
} from './game-draft';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char hex ObjectId');

const createDraftSchema = z
  .object({
    type: z.literal('game'),
    source: sourceInputSchema.optional(),
    settings: draftSettingsSchema.default({}),
    payload: gameDraftPayloadSchema.optional(),
    /** Duplicate (or remix) this game into a new draft. */
    fromGameId: objectIdSchema.optional(),
  })
  .strict()
  .refine((body) => !(body.fromGameId && (body.source || body.payload)), {
    message: 'fromGameId copies the game: send no source or payload with it',
  });

const chapterRefSchema = z
  .object({
    book: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    chapter: z.string().regex(/^\d+$/),
  })
  .strict();

/** A library chapter draft (H2): from a paste, a game's kept source (Save as library chapter), a remix or an edit. */
const createChapterDraftSchema = z
  .object({
    type: z.literal('chapter'),
    source: sourceInputSchema.optional(),
    payload: chapterDraftPayloadSchema.optional(),
    /** Save as library chapter: reuse this game's kept source (G13). */
    fromGameId: objectIdSchema.optional(),
    /** Remix this chapter into a book of the caller's (G12). */
    fromChapter: chapterRefSchema.optional(),
    /** Edit this published chapter of the caller's (G8). */
    editChapter: chapterRefSchema.optional(),
  })
  .strict()
  .refine((body) => [body.source, body.fromGameId, body.fromChapter, body.editChapter].filter(Boolean).length <= 1, {
    message: 'Send at most one of source, fromGameId, fromChapter and editChapter',
  })
  .refine((body) => !(body.payload && (body.fromChapter || body.editChapter)), {
    message: 'fromChapter and editChapter copy the chapter: send no payload with them',
  });

const updateDraftSchema = z
  .object({
    revision: z.number().int().positive(),
    source: sourceInputSchema.optional(),
    settings: draftSettingsSchema.optional(),
    /** Checked against the draft's type. */
    payload: z.unknown().optional(),
  })
  .strict();

const shareDraftSchema = z.object({ shared: z.boolean() }).strict();
const acceptDraftSchema = z.object({ revision: z.number().int().positive() }).strict();

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

function titleOf(payload: GameDraftPayload | null | undefined): string {
  return payload?.title.trim().slice(0, GAME_DRAFT_LIMITS.maxTitleLength) ?? '';
}

const CHAPTER_SETTINGS = draftSettingsSchema.parse({});

/**
 * Drafts for AI game creation (docs/hashbrown/creating-games-with-hashbrown.md
 * → Server). Referees only. A draft is private to its owner until shared;
 * anyone signed in can read and edit a shared one, but only the owner can
 * share, delete or accept it (G14). Every edit carries the `revision` it was
 * made against, and an older one gets 409 with the current draft.
 */
@Controller('api/content/drafts')
@UseGuards(RefereeGuard)
export class ContentDraftsController {
  constructor(
    private readonly drafts: ContentDraftRepository,
    private readonly games: GameDataRepository,
    private readonly chapters: ChapterDraftsService,
  ) {}

  @Post()
  async createDraft(@Body() body: unknown, @Res() res: Response, @Req() req: RefereeRequest): Promise<void> {
    if ((body as { type?: unknown } | null)?.type === 'chapter') {
      await this.createChapterDraft(body, res, req);
      return;
    }
    const parsed = createDraftSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const userId = refereeUserIdOf(req);
    const { source, settings, payload, fromGameId } = parsed.data;
    try {
      if (fromGameId) {
        const game = await this.games.getGameForDraft(fromGameId);
        if (!game) {
          res.status(404).json({ error: 'Game not found' });
          return;
        }
        if (game.kind !== 'class') {
          res.status(400).json({ error: 'Only class games can be duplicated: a Leitner game is planned for one student.' });
          return;
        }
        const copied: GameDraftPayload = {
          title: `${game.title} (copy)`.slice(0, GAME_DRAFT_LIMITS.maxTitleLength),
          questions: game.questions.slice(0, GAME_DRAFT_LIMITS.maxQuestions),
        };
        const widest = Math.max(0, ...copied.questions.map((question) => question.options.length));
        const draft = await this.drafts.createDraft({
          ownerUserId: userId,
          type: 'game',
          // The source stays with the game it made (G13): open once that game was accepted (G12).
          sourceId: game.contentSourceId,
          title: copied.title,
          payload: copied,
          settings: {
            ...settings,
            questionCount: Math.max(1, copied.questions.length),
            optionsPerQuestion: Math.min(GAME_DRAFT_LIMITS.maxOptions, Math.max(GAME_DRAFT_LIMITS.minOptions, widest)),
          },
          problems: gameDraftProblems(copied),
          remixedFromGameId: game.id,
        });
        res.status(201).json({ draft });
        return;
      }

      const sourceId = source
        ? await this.drafts.ensureSource({ ownerUserId: userId, raw: source.text, language: source.language })
        : null;
      const draft = await this.drafts.createDraft({
        ownerUserId: userId,
        type: 'game',
        sourceId,
        title: titleOf(payload),
        payload: payload ?? null,
        settings,
        problems: gameDraftProblems(payload ?? null),
      });
      res.status(201).json({ draft });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create draft', message: String(error) });
    }
  }

  @Get()
  async listDrafts(@Query('shared') shared: string | undefined, @Res() res: Response, @Req() req: RefereeRequest): Promise<void> {
    try {
      const drafts = await this.drafts.listDrafts({ userId: refereeUserIdOf(req), shared: shared === 'true' });
      res.status(200).json({ drafts });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list drafts', message: String(error) });
    }
  }

  @Get(':draftId')
  async getDraft(@Param('draftId') draftId: string, @Res() res: Response, @Req() req: RefereeRequest): Promise<void> {
    try {
      const draft = await this.loadDraft(draftId, req, res, 'edit');
      if (!draft) return;
      res.status(200).json(await this.draftView(draft, refereeUserIdOf(req)));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch draft', message: String(error) });
    }
  }

  @Patch(':draftId')
  async updateDraft(
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Res() res: Response,
    @Req() req: RefereeRequest,
  ): Promise<void> {
    const parsed = updateDraftSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const userId = refereeUserIdOf(req);
    const { revision, source, settings } = parsed.data;
    try {
      const draft = await this.loadDraft(draftId, req, res, 'edit');
      if (!draft) return;
      if (draft.status !== 'draft') {
        res.status(409).json({
          error:
            draft.type === 'chapter'
              ? 'This draft was published and can no longer change. Edit the chapter instead.'
              : 'This draft was accepted and can no longer change. Duplicate its game instead.',
        });
        return;
      }
      const payloadSchema = draft.type === 'chapter' ? chapterDraftPayloadSchema : gameDraftPayloadSchema;
      const payloadParsed = parsed.data.payload === undefined ? null : payloadSchema.safeParse(parsed.data.payload);
      if (payloadParsed && !payloadParsed.success) {
        res.status(400).json({ error: 'Validation failed', details: getValidationErrors(payloadParsed.error) });
        return;
      }
      const payloadChanges = payloadParsed?.success
        ? draft.type === 'chapter'
          ? {
              payload: payloadParsed.data,
              title: await this.chapters.draftTitle(payloadParsed.data as ChapterDraftPayload),
              problems: await this.chapters.problems(payloadParsed.data as ChapterDraftPayload, draft),
            }
          : {
              payload: payloadParsed.data,
              title: titleOf(payloadParsed.data as GameDraftPayload),
              problems: gameDraftProblems(payloadParsed.data as GameDraftPayload),
            }
        : {};
      const sourceId = source
        ? // A changed paste is a new source, owned by whoever pasted it.
          await this.drafts.ensureSource({ ownerUserId: userId, raw: source.text, language: source.language })
        : undefined;
      const updated = await this.drafts.updateDraft({
        draftId,
        revision,
        editorUserId: userId,
        changes: {
          ...(sourceId !== undefined ? { sourceId } : {}),
          ...(settings ? { settings } : {}),
          ...payloadChanges,
        },
      });
      if (!updated) {
        await this.sendConflict(draftId, userId, res);
        return;
      }
      res.status(200).json(await this.draftView(updated, userId));
    } catch (error) {
      res.status(500).json({ error: 'Failed to update draft', message: String(error) });
    }
  }

  @Put(':draftId/share')
  async shareDraft(
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Res() res: Response,
    @Req() req: RefereeRequest,
  ): Promise<void> {
    const parsed = shareDraftSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    try {
      const draft = await this.loadDraft(draftId, req, res, 'owner');
      if (!draft) return;
      if (draft.status !== 'draft') {
        res.status(409).json({ error: 'An accepted draft can no longer be shared or unshared.' });
        return;
      }
      // Sharing doesn't touch the content, so it doesn't need the editor's revision.
      const updated = await this.drafts.updateDraft({
        draftId,
        revision: draft.revision,
        editorUserId: refereeUserIdOf(req),
        changes: { shared: parsed.data.shared },
      });
      if (!updated) {
        await this.sendConflict(draftId, refereeUserIdOf(req), res);
        return;
      }
      res.status(200).json(await this.draftView(updated, refereeUserIdOf(req)));
    } catch (error) {
      res.status(500).json({ error: 'Failed to share draft', message: String(error) });
    }
  }

  @Delete(':draftId')
  async deleteDraft(@Param('draftId') draftId: string, @Res() res: Response, @Req() req: RefereeRequest): Promise<void> {
    try {
      const draft = await this.loadDraft(draftId, req, res, 'owner');
      if (!draft) return;
      // An accepted draft's game stays: only the draft goes.
      await this.drafts.deleteDraft(draftId);
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete draft', message: String(error) });
    }
  }

  /** Makes the game (G1): validated strictly here, whatever the client checked. */
  @Post(':draftId/accept')
  async acceptDraft(
    @Param('draftId') draftId: string,
    @Body() body: unknown,
    @Res() res: Response,
    @Req() req: RefereeRequest,
  ): Promise<void> {
    const parsed = acceptDraftSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const userId = refereeUserIdOf(req);
    try {
      const draft = await this.loadDraft(draftId, req, res, 'owner');
      if (!draft) return;
      if (draft.status !== 'draft') {
        res.status(409).json({ error: 'This draft was already accepted.', gameId: draft.resultGameId, chapter: draft.resultChapter });
        return;
      }
      if (draft.revision !== parsed.data.revision) {
        await this.sendConflict(draftId, userId, res);
        return;
      }
      if (draft.type === 'chapter') {
        await this.publishChapter(draft, userId, res);
        return;
      }
      const payload = gameDraftPayloadSchema.safeParse(draft.payload);
      const problems = payload.success ? gameDraftProblems(payload.data) : gameDraftProblems(null);
      if (!payload.success || problems.length > 0) {
        res.status(400).json({ error: 'The draft has problems to fix first', problems });
        return;
      }

      const gameId = await this.games.createGameWithQuestions({
        title: titleOf(payload.data),
        createdByUserId: userId,
        origin: {
          kind: 'ai-draft',
          contentSourceId: draft.sourceId,
          draftId,
          remixedFromGameId: draft.remixedFromGameId,
        },
        questions: gameDraftQuestions(payload.data),
      });
      const accepted = await this.drafts.updateDraft({
        draftId,
        revision: draft.revision,
        editorUserId: userId,
        changes: { status: 'accepted', resultGameId: gameId, shared: false },
      });
      if (!accepted) {
        // Edited (or accepted) while the game was being made: that game would be stale.
        await this.games.deleteGame(gameId);
        await this.sendConflict(draftId, userId, res);
        return;
      }
      res.status(201).json({ gameId, draft: accepted });
    } catch (error) {
      res.status(500).json({ error: 'Failed to accept draft', message: String(error) });
    }
  }

  private async createChapterDraft(body: unknown, res: Response, req: RefereeRequest): Promise<void> {
    const parsed = createChapterDraftSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: getValidationErrors(parsed.error) });
      return;
    }
    const userId = refereeUserIdOf(req);
    const { source, payload, fromGameId, fromChapter, editChapter } = parsed.data;
    try {
      if (fromChapter || editChapter) {
        const copy = await this.chapters.copyChapter((fromChapter ?? editChapter)!, userId, editChapter ? 'edit' : 'remix');
        const links = editChapter ? { editsChapter: copy.ref } : { remixedFromChapter: copy.ref };
        const draft = await this.drafts.createDraft({
          ownerUserId: userId,
          type: 'chapter',
          sourceId: copy.sourceId,
          title: await this.chapters.draftTitle(copy.payload),
          payload: copy.payload,
          settings: CHAPTER_SETTINGS,
          problems: await this.chapters.problems(copy.payload, { ownerUserId: userId, editsChapter: links.editsChapter ?? null }),
          ...links,
        });
        res.status(201).json({ draft });
        return;
      }

      let sourceId: string | null = null;
      if (fromGameId) {
        const game = await this.games.getGameForDraft(fromGameId);
        if (!game) {
          res.status(404).json({ error: 'Game not found' });
          return;
        }
        if (!game.contentSourceId) {
          res.status(400).json({ error: 'This game wasn’t made from a pasted passage, so there is no text to make a chapter from.' });
          return;
        }
        sourceId = game.contentSourceId;
      } else if (source) {
        sourceId = await this.drafts.ensureSource({ ownerUserId: userId, raw: source.text, language: source.language });
      }
      const content = payload ?? null;
      const draft = await this.drafts.createDraft({
        ownerUserId: userId,
        type: 'chapter',
        sourceId,
        title: await this.chapters.draftTitle(content),
        payload: content,
        settings: CHAPTER_SETTINGS,
        problems: await this.chapters.problems(content, { ownerUserId: userId, editsChapter: null }),
      });
      res.status(201).json({ draft });
    } catch (error) {
      if (error instanceof ChapterDraftError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to create draft', message: String(error) });
    }
  }

  /** Publishes a chapter draft (G1: only its owner, after the problems are fixed). */
  private async publishChapter(draft: ContentDraftRecord, userId: string, res: Response): Promise<void> {
    try {
      const chapter = await this.chapters.publish(draft, userId);
      const resultChapter = { book: chapter.bookSlug, chapter: chapter.chapter, revision: chapter.revision };
      const accepted = await this.drafts.updateDraft({
        draftId: draft.id,
        revision: draft.revision,
        editorUserId: userId,
        changes: { status: 'accepted', resultChapter, shared: false },
      });
      // A chapter can't be taken back like a game: if the draft moved on meanwhile, it stays a draft.
      res.status(201).json({ chapter: resultChapter, draft: accepted });
    } catch (error) {
      if (error instanceof ChapterDraftError) {
        res.status(error.status).json({ error: error.message, problems: error.problems });
        return;
      }
      throw error;
    }
  }

  /**
   * The draft if the caller may use it, else the error response is sent and
   * null returned: 404 for a private draft that isn't theirs (no hint it
   * exists), 403 for an owner-only action on someone else's shared draft.
   */
  private async loadDraft(
    draftId: string,
    req: RefereeRequest,
    res: Response,
    need: 'edit' | 'owner',
  ): Promise<ContentDraftRecord | null> {
    if (!objectIdSchema.safeParse(draftId).success) {
      res.status(404).json({ error: 'Draft not found' });
      return null;
    }
    const draft = await this.drafts.getDraft(draftId);
    const userId = refereeUserIdOf(req);
    const mine = draft?.ownerUserId === userId;
    if (!draft || (!mine && !draft.shared)) {
      res.status(404).json({ error: 'Draft not found' });
      return null;
    }
    if (need === 'owner' && !mine) {
      res.status(403).json({ error: 'Only the draft’s owner can do that. Duplicate it to make your own copy.' });
      return null;
    }
    return draft;
  }

  /**
   * The draft's problems under today's rules. Stored problems date from the
   * last save, so a changed limit (options went from 40 to 60 characters)
   * or a sense added meanwhile would otherwise stay until the next edit.
   */
  private async currentProblems(draft: ContentDraftRecord): Promise<ContentDraftRecord['problems']> {
    if (draft.status !== 'draft') return draft.problems;
    if (draft.type === 'chapter') {
      const payload = chapterDraftPayloadSchema.safeParse(draft.payload);
      return this.chapters.problems(payload.success ? payload.data : null, draft);
    }
    if (draft.payload === null) return gameDraftProblems(null);
    const payload = gameDraftPayloadSchema.safeParse(draft.payload);
    return payload.success ? gameDraftProblems(payload.data) : draft.problems;
  }

  private async draftView(stored: ContentDraftRecord, userId: string) {
    const draft = { ...stored, problems: await this.currentProblems(stored) };
    const source = draft.sourceId ? await this.drafts.getSource(draft.sourceId) : null;
    const chapter =
      draft.type === 'chapter'
        ? {
            /** The owner's books: where Publish can put the chapter. */
            books: await this.chapters.myBooks(draft.ownerUserId),
            /** Edits: the published words and patterns that must stay (G8). */
            frozen: await this.chapters.frozen(draft.editsChapter),
          }
        : undefined;
    return {
      draft: { ...draft, mine: draft.ownerUserId === userId },
      source: source ? { text: source.raw, language: source.language } : null,
      language: source?.language ?? DEFAULT_LANGUAGE,
      ...(chapter ? { chapter } : {}),
    };
  }

  private async sendConflict(draftId: string, userId: string, res: Response): Promise<void> {
    const current = await this.drafts.getDraft(draftId);
    res.status(409).json({
      error: 'This draft changed since you loaded it (another tab or another referee). Reload to see the latest version.',
      ...(current ? await this.draftView(current, userId) : {}),
    });
  }
}
