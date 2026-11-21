import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../auth';
import { AuthGuard } from '../auth.guard';
import { UnknownBookError, UnknownChapterError } from '../learning/book-content';
import { UserRepository } from '../persistence/user.repository';
import { YallaLibraryService } from './yalla-library.service';

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const chapterSchema = z.string().regex(/^\d+$/);

/**
 * YALLA study content (docs/yalla/implementation-plan.md §3, milestone Y1):
 * the built-in books and, from H2, every open user book
 * (docs/hashbrown/creating-games-with-hashbrown.md, G12). Behind Cognito
 * like the rest of YALLA; the caller only decides which books are "mine".
 */
@Controller('api/yalla')
@UseGuards(AuthGuard)
export class YallaContentController {
  constructor(
    private readonly library: YallaLibraryService,
    private readonly users: UserRepository,
  ) {}

  @Get('books')
  async getBooks(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    res.status(200).json({ books: await this.library.listBooks(await this.userIdOf(req)) });
  }

  @Get('books/:book')
  async getBook(@Param('book') book: string, @Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    if (!slugSchema.safeParse(book).success) {
      res.status(400).json({ error: 'Invalid book' });
      return;
    }
    try {
      res.status(200).json(await this.library.getBook(book, await this.userIdOf(req)));
    } catch (error) {
      if (error instanceof UnknownBookError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  }

  @Get('books/:book/chapters/:chapter')
  async getChapter(
    @Param('book') book: string,
    @Param('chapter') chapter: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!slugSchema.safeParse(book).success || !chapterSchema.safeParse(chapter).success) {
      res.status(400).json({ error: 'Invalid book or chapter' });
      return;
    }
    try {
      res.status(200).json(await this.library.getStudyChapter(book, chapter, await this.userIdOf(req)));
    } catch (error) {
      if (error instanceof UnknownBookError || error instanceof UnknownChapterError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  }

  /** The caller's user id, to mark their own books; null without Mongo or before their first referee request. */
  private async userIdOf(req: AuthedRequest): Promise<string | null> {
    if (!req.auth) return null;
    try {
      return await this.users.findIdByAuthProviderId(req.auth.sub);
    } catch {
      return null;
    }
  }
}
