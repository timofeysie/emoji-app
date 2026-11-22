import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { BookContentService } from '../learning/book-content.service';
import { RefereeGuard, refereeUserIdOf, type RefereeRequest } from '../referee.guard';
import { ChapterDraftError, ChapterDraftsService } from './chapter-drafts.service';

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const chapterSchema = z.string().regex(/^\d+$/);
const archiveSchema = z.object({ archived: z.boolean().default(true) }).strict();
const sensesQuerySchema = z.object({
  language: z.string().regex(/^[a-z]{2,3}$/).default('ko'),
  /** Comma-separated. */
  words: z
    .string()
    .max(4000)
    .transform((value) => [...new Set(value.split(',').map((word) => word.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(100)).min(1).max(60)),
});

const patternsQuerySchema = z.object({
  language: z.string().regex(/^[a-z]{2,3}$/).default('ko'),
  /** Repeated: `spelling=-아/어지다&spelling=-네`. Spellings contain commas, so not one list. */
  spelling: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => [...new Set((Array.isArray(value) ? value : [value]).map((spelling) => spelling.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(300)).min(1).max(10)),
});

/**
 * Library chapters (docs/hashbrown/creating-games-with-hashbrown.md →
 * Feature 2): the sense and grammar-pattern lookups the AI and the editor
 * use before deciding a word's sense (G7) or a pattern's entries (GP5), the
 * caller's books, and archiving. Reading books is
 * YALLA's (`/api/yalla/books`).
 */
@Controller('api')
@UseGuards(RefereeGuard)
export class LibraryController {
  constructor(
    private readonly content: BookContentService,
    private readonly chapters: ChapterDraftsService,
  ) {}

  /** `?words=토끼,시험`: each word's existing senses, from the registry file and the ones users added. */
  @Get('senses')
  async findSenses(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const parsed = sensesQuerySchema.safeParse(query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Send words=word1,word2 (1–60 words)' });
      return;
    }
    res.status(200).json({ words: await this.content.findSenses(parsed.data.language, parsed.data.words) });
  }

  /** `?spelling=-아/어지다&spelling=…`: each book pattern's matching registry entries (docs/yalla/grammar-learning-objects.md). */
  @Get('patterns')
  async findPatterns(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const parsed = patternsQuerySchema.safeParse(query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Send spelling=… once per pattern (1–10 patterns)' });
      return;
    }
    res.status(200).json({ patterns: await this.content.findPatterns(parsed.data.language, parsed.data.spelling) });
  }

  @Get('books/mine')
  async myBooks(@Req() req: RefereeRequest, @Res() res: Response): Promise<void> {
    res.status(200).json({ books: await this.chapters.myBooks(refereeUserIdOf(req)) });
  }

  /** `{ archived: false }` brings it back. Owner only; never a delete, because statements point at it. */
  @Post('books/:book/chapters/:chapter/archive')
  async archive(
    @Param('book') book: string,
    @Param('chapter') chapter: string,
    @Body() body: unknown,
    @Req() req: RefereeRequest,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = archiveSchema.safeParse(body ?? {});
    if (!slugSchema.safeParse(book).success || !chapterSchema.safeParse(chapter).success || !parsed.success) {
      res.status(400).json({ error: 'Invalid book, chapter or body' });
      return;
    }
    try {
      const updated = await this.chapters.setArchived({ book, chapter }, refereeUserIdOf(req), parsed.data.archived);
      res.status(200).json({ book, chapter, archived: updated.archivedAt !== null });
    } catch (error) {
      if (error instanceof ChapterDraftError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  }
}
