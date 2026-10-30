import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth.guard';
import { UnknownBookError, UnknownChapterError } from '../learning/book-content';
import { getBook, getStudyChapter, listBooks } from './yalla-content';

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const chapterSchema = z.string().regex(/^\d+$/);

/**
 * YALLA study content (docs/yalla/implementation-plan.md §3, milestone Y1).
 * Behind Cognito like the rest of YALLA, though nothing here is per user yet.
 */
@Controller('api/yalla')
@UseGuards(AuthGuard)
export class YallaContentController {
  @Get('books')
  getBooks(@Res() res: Response): void {
    res.status(200).json({ books: listBooks() });
  }

  @Get('books/:book')
  getBook(@Param('book') book: string, @Res() res: Response): void {
    if (!slugSchema.safeParse(book).success) {
      res.status(400).json({ error: 'Invalid book' });
      return;
    }
    try {
      res.status(200).json(getBook(book));
    } catch (error) {
      if (error instanceof UnknownBookError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  }

  @Get('books/:book/chapters/:chapter')
  getChapter(@Param('book') book: string, @Param('chapter') chapter: string, @Res() res: Response): void {
    if (!slugSchema.safeParse(book).success || !chapterSchema.safeParse(chapter).success) {
      res.status(400).json({ error: 'Invalid book or chapter' });
      return;
    }
    try {
      res.status(200).json(getStudyChapter(book, chapter));
    } catch (error) {
      if (error instanceof UnknownBookError || error instanceof UnknownChapterError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  }
}
