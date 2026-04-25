import type { NextFunction, Request, Response } from 'express';

function isVerboseHttpLoggingEnabled(): boolean {
  return process.env['LOG_HTTP_BODIES'] === 'true' && process.env['NODE_ENV'] !== 'production';
}

const REDACTED = '[REDACTED]';
const SENSITIVE_FIELD_PATTERN = /(password|passcode|token|secret|authorization|api[-_]?key|cookie|session|jwt|client_secret|refresh_token|id_token)/i;
const SENSITIVE_PATH_PREFIXES = ['/auth', '/oauth', '/signin', '/login', '/logout', '/token'];

function shouldSkipBodyLogging(req: Request): boolean {
  if (req.method !== 'POST') {
    return true;
  }
  return SENSITIVE_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix));
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }

  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(input)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = redactSensitiveValues(nestedValue);
      }
    }
    return output;
  }

  return value;
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const verboseHttpLogs = isVerboseHttpLoggingEnabled();

  console.log(`[${timestamp}] ${req.method} ${req.path}`);

  if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
    if (shouldSkipBodyLogging(req)) {
      console.log(`[${timestamp}] Request body: (omitted for sensitive endpoint)`);
    } else if (verboseHttpLogs) {
      const redactedBody = redactSensitiveValues(req.body);
      const bodyStr = JSON.stringify(redactedBody);
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
