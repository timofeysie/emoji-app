import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth.guard';
import type { AuthedRequest } from '../auth';
import { ChatContextService, type ChatContextReading } from './chat-context.service';
import { CHAT_SESSION_ID } from './chat-session';

/** The chat panel's context indicator reads this once the AI has answered. */
@Controller('api')
export class ChatContextController {
  constructor(private readonly chatContext: ChatContextService) {}

  @Get('chat/context/:sessionId')
  @UseGuards(AuthGuard)
  getContext(@Param('sessionId') sessionId: string, @Req() req: AuthedRequest): ChatContextReading {
    const reading =
      CHAT_SESSION_ID.test(sessionId) && req.auth ? this.chatContext.get(req.auth.sub, sessionId) : undefined;
    if (!reading) {
      throw new NotFoundException({ error: 'No context reading for this chat session yet' });
    }
    return reading;
  }
}
