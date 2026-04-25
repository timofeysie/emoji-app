import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Chat } from '@hashbrownai/core';
import { HashbrownOpenAI } from '@hashbrownai/openai';
import { requireAuth } from './auth';

function runAuth(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    requireAuth(req, res, () => resolve(true));
    if (res.headersSent) {
      resolve(false);
    }
  });
}

function isVerboseChatLoggingEnabled(): boolean {
  return process.env['LOG_CHAT_CONTENT'] === 'true' && process.env['NODE_ENV'] !== 'production';
}

function messageContentSize(content: unknown): number {
  if (typeof content === 'string') {
    return content.length;
  }
  return JSON.stringify(content ?? '').length;
}

@Controller('api')
export class ChatController {
  @Post('chat')
  async chat(
    @Body() completionParams: Chat.Api.CompletionCreateParams,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const isAuthed = await runAuth(req, res);
    if (!isAuthed) {
      return;
    }

    const timestamp = new Date().toISOString();
    const verboseChatLogs = isVerboseChatLoggingEnabled();

    console.log(`[${timestamp}] Operation: ${completionParams.operation || 'generate'}`);

    if (completionParams.messages && completionParams.messages.length > 0) {
      console.log(`[${timestamp}] Messages (${completionParams.messages.length} total):`);

      completionParams.messages.forEach((msg, index) => {
        const msgTimestamp = new Date().toISOString();
        const role = msg.role.toUpperCase();

        if (msg.role === 'user') {
          if (verboseChatLogs) {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            console.log(
              `[${msgTimestamp}]   [${index + 1}] ${role}: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`,
            );
          } else {
            console.log(
              `[${msgTimestamp}]   [${index + 1}] ${role}: (content omitted, size=${messageContentSize(msg.content)} chars)`,
            );
          }
        } else if (msg.role === 'assistant') {
          const hasContent = !!msg.content;
          const hasToolCalls = !!(msg.toolCalls && msg.toolCalls.length > 0);
          const contentPreview = hasContent && verboseChatLogs
            ? (typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content)
              ).substring(0, 200)
            : '';

          if (hasToolCalls && msg.toolCalls) {
            const toolCalls = msg.toolCalls;
            console.log(
              `[${msgTimestamp}]   [${index + 1}] ${role} TURN (with ${toolCalls.length} tool call(s)):`,
            );
            toolCalls.forEach((toolCall, tcIndex) => {
              if (verboseChatLogs) {
                console.log(
                  `[${msgTimestamp}]     Tool Call ${tcIndex + 1}: ${toolCall.function.name}(${toolCall.function.arguments.substring(0, 100)}${toolCall.function.arguments.length > 100 ? '...' : ''})`,
                );
              } else {
                console.log(
                  `[${msgTimestamp}]     Tool Call ${tcIndex + 1}: ${toolCall.function.name}(arguments omitted, size=${toolCall.function.arguments.length} chars)`,
                );
              }
            });
          } else if (hasContent) {
            if (verboseChatLogs) {
              console.log(
                `[${msgTimestamp}]   [${index + 1}] ${role} COMPLETION: ${contentPreview}${contentPreview.length > 200 ? '...' : ''}`,
              );
            } else {
              console.log(
                `[${msgTimestamp}]   [${index + 1}] ${role} COMPLETION: (content omitted, size=${messageContentSize(msg.content)} chars)`,
              );
            }
          } else {
            console.log(`[${msgTimestamp}]   [${index + 1}] ${role}: (empty)`);
          }
        } else if (msg.role === 'tool') {
          if (verboseChatLogs) {
            const toolContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            console.log(
              `[${msgTimestamp}]   [${index + 1}] ${role} (${msg.toolName || 'unknown'}): ${toolContent.substring(0, 200)}${toolContent.length > 200 ? '...' : ''}`,
            );
          } else {
            console.log(
              `[${msgTimestamp}]   [${index + 1}] ${role} (${msg.toolName || 'unknown'}): (content omitted, size=${messageContentSize(msg.content)} chars)`,
            );
          }
        } else {
          if (verboseChatLogs) {
            console.log(
              `[${msgTimestamp}]   [${index + 1}] ${role}: ${JSON.stringify(msg).substring(0, 200)}`,
            );
          } else {
            console.log(`[${msgTimestamp}]   [${index + 1}] ${role}: (content omitted)`);
          }
        }
      });
    }

    console.log(`[${timestamp}] Starting chat stream (completion)...`);

    try {
      const openAiApiKey = process.env['OPENAI_API_KEY'];
      if (!openAiApiKey) {
        throw new Error('OPENAI_API_KEY is not set');
      }

      const response = HashbrownOpenAI.stream.text({
        apiKey: openAiApiKey,
        request: completionParams,
      });

      res.header('Content-Type', 'application/octet-stream');

      let chunkCount = 0;
      for await (const chunk of response) {
        res.write(chunk);
        chunkCount += 1;
      }

      const endTimestamp = new Date().toISOString();
      console.log(`[${endTimestamp}] ✅ COMPLETION finished (${chunkCount} chunks streamed)`);
      res.end();
    } catch (error) {
      const errorTimestamp = new Date().toISOString();
      console.error(`[${errorTimestamp}] Chat stream error:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: 'An unexpected error occurred',
        });
      }
    }
  }
}
