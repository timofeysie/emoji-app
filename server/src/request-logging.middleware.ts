import type { NextFunction, Request, Response } from 'express';

function isVerboseHttpLoggingEnabled(): boolean {
  return process.env['LOG_HTTP_BODIES'] === 'true' && process.env['NODE_ENV'] !== 'production';
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const verboseHttpLogs = isVerboseHttpLoggingEnabled();

  console.log(`[${timestamp}] ${req.method} ${req.path}`);

  if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
    if (verboseHttpLogs) {
      const bodyStr = JSON.stringify(req.body);
      const truncatedBody = bodyStr.length > 1000 ? `${bodyStr.substring(0, 1000)}... (truncated)` : bodyStr;
      console.log(`[${timestamp}] Request body:`, truncatedBody);
    } else {
      const bodySize = JSON.stringify(req.body).length;
      console.log(`[${timestamp}] Request body: (omitted, size=${bodySize} chars)`);
    }
  }

  const originalEnd = res.end.bind(res);
  res.end = function end(chunk?: any, encoding?: any, cb?: any): Response {
    const duration = Date.now() - startTime;
    const doneTimestamp = new Date().toISOString();
    console.log(`[${doneTimestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);

    if (chunk && res.getHeader('Content-Type') !== 'application/octet-stream' && verboseHttpLogs) {
      try {
        const responseStr = chunk?.toString() || '';
        const truncatedResponse = responseStr.length > 500
          ? `${responseStr.substring(0, 500)}... (truncated)`
          : responseStr;
        console.log(`[${doneTimestamp}] Response:`, truncatedResponse);
      } catch {
        // Ignore response logging failures.
      }
    }

    return originalEnd(chunk, encoding, cb);
  };

  next();
}
