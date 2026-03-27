import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { Chat } from '@hashbrownai/core';
import { HashbrownOpenAI } from '@hashbrownai/openai';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}

const app = express();

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] ${req.method} ${req.path}`);

  // Log request body for POST requests (excluding streaming responses)
  if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
    // Truncate large bodies for readability
    const bodyStr = JSON.stringify(req.body);
    const truncatedBody =
      bodyStr.length > 1000
        ? bodyStr.substring(0, 1000) + '... (truncated)'
        : bodyStr;
    console.log(`[${timestamp}] Request body:`, truncatedBody);
  }

  // Log response when it finishes
  const originalEnd = res.end.bind(res);
  res.end = function (chunk?: any, encoding?: any, cb?: any): express.Response {
    const duration = Date.now() - startTime;
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
    );

    if (chunk && res.getHeader('Content-Type') !== 'application/octet-stream') {
      try {
        const responseStr = chunk?.toString() || '';
        const truncatedResponse =
          responseStr.length > 500
            ? responseStr.substring(0, 500) + '... (truncated)'
            : responseStr;
        console.log(`[${timestamp}] Response:`, truncatedResponse);
      } catch (e) {
        // Ignore errors when trying to log response
      }
    }

    return originalEnd(chunk, encoding, cb);
  };

  next();
});

app.post('/api/chat', async (req, res) => {
  const timestamp = new Date().toISOString();
  const completionParams = req.body as Chat.Api.CompletionCreateParams;

  // Log operation type
  console.log(
    `[${timestamp}] Operation: ${completionParams.operation || 'generate'}`,
  );

  // Log message structure and roles
  if (completionParams.messages && completionParams.messages.length > 0) {
    console.log(
      `[${timestamp}] Messages (${completionParams.messages.length} total):`,
    );

    completionParams.messages.forEach((msg, index) => {
      const msgTimestamp = new Date().toISOString();
      const role = msg.role.toUpperCase();

      if (msg.role === 'user') {
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
        console.log(
          `[${msgTimestamp}]   [${index + 1}] ${role}: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`,
        );
      } else if (msg.role === 'assistant') {
        const hasContent = !!msg.content;
        const hasToolCalls = !!(msg.toolCalls && msg.toolCalls.length > 0);
        const contentPreview = hasContent
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
            console.log(
              `[${msgTimestamp}]     Tool Call ${tcIndex + 1}: ${toolCall.function.name}(${toolCall.function.arguments.substring(0, 100)}${toolCall.function.arguments.length > 100 ? '...' : ''})`,
            );
          });
        } else if (hasContent) {
          console.log(
            `[${msgTimestamp}]   [${index + 1}] ${role} COMPLETION: ${contentPreview}${contentPreview.length > 200 ? '...' : ''}`,
          );
        } else {
          console.log(`[${msgTimestamp}]   [${index + 1}] ${role}: (empty)`);
        }
      } else if (msg.role === 'tool') {
        const toolContent =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
        console.log(
          `[${msgTimestamp}]   [${index + 1}] ${role} (${msg.toolName || 'unknown'}): ${toolContent.substring(0, 200)}${toolContent.length > 200 ? '...' : ''}`,
        );
      } else {
        console.log(
          `[${msgTimestamp}]   [${index + 1}] ${role}: ${JSON.stringify(msg).substring(0, 200)}`,
        );
      }
    });
  }

  console.log(`[${timestamp}] Starting chat stream (completion)...`);

  try {
    const response = HashbrownOpenAI.stream.text({
      apiKey: OPENAI_API_KEY,
      request: completionParams,
    });

    res.header('Content-Type', 'application/octet-stream');

    let chunkCount = 0;
    for await (const chunk of response) {
      res.write(chunk);
      chunkCount++;
    }

    const endTimestamp = new Date().toISOString();
    console.log(
      `[${endTimestamp}] ✅ COMPLETION finished (${chunkCount} chunks streamed)`,
    );
    res.end();
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] Chat stream error:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

// Serve the React SPA in production. The Dockerfile copies the Vite build
// output into a `client-react` subdirectory next to this bundle.
const staticPath = path.join(__dirname, 'client-react');
if (existsSync(staticPath)) {
  app.use(express.static(staticPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

app.listen(port, host, () => {
  console.log(`[ ready ] http://${host}:${port}`);
});
