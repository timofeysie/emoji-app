import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import {
  BadgeStateService,
  emojiBodySchema,
  statusBodySchema,
} from './badge-state.service';

function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

@Controller('api')
export class BadgesController {
  constructor(private readonly badgeStateService: BadgeStateService) {}

  @Post('status')
  postStatus(@Body() body: unknown, @Res() res: Response): void {
    const result = statusBodySchema.safeParse(body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: getValidationErrors(result.error),
      });
      return;
    }

    this.badgeStateService.recordStatus(result.data);
    res.status(201).json({ ok: true });
  }

  @Post('emoji')
  postEmoji(@Body() body: unknown, @Res() res: Response): void {
    const result = emojiBodySchema.safeParse(body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: getValidationErrors(result.error),
      });
      return;
    }

    this.badgeStateService.recordEmoji(result.data);
    res.status(201).json({ ok: true });
  }

  @Get('badges')
  getBadges(): { badges: ReturnType<BadgeStateService['getBadges']> } {
    return {
      badges: this.badgeStateService.getBadges(),
    };
  }
}
