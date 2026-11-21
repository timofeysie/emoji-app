import { Injectable } from '@nestjs/common';
import { CHAT_BODY_LIMIT_BYTES, MODEL_CONTEXT_WINDOWS, type RequestTokenCount } from './chat-context';

/** The latest reading for one chat session, as `GET /api/chat/context/:sessionId` returns it. */
export type ChatContextReading = RequestTokenCount & {
  replyTokens: number;
  /** The context the next request will send: this request plus its reply. */
  totalTokens: number;
  model: string;
  /** Null for a model not in `MODEL_CONTEXT_WINDOWS`. */
  contextWindow: number | null;
  requestBytes: number;
  bodyLimitBytes: number;
  at: string;
};

export type ChatContextRecord = RequestTokenCount & {
  replyTokens: number;
  model: string;
  requestBytes: number;
};

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SESSIONS = 1000;

/**
 * Latest context reading per user and chat session, in memory: it's a
 * display aid, so losing it on restart only means "no reading yet".
 */
@Injectable()
export class ChatContextService {
  private readonly readings = new Map<string, ChatContextReading>();

  record(userSub: string, sessionId: string, record: ChatContextRecord, now = new Date()): void {
    this.prune(now);
    const key = this.key(userSub, sessionId);
    this.readings.delete(key);
    this.readings.set(key, {
      ...record,
      totalTokens: record.fixedTokens + record.messageTokens + record.replyTokens,
      contextWindow: MODEL_CONTEXT_WINDOWS[record.model] ?? null,
      bodyLimitBytes: CHAT_BODY_LIMIT_BYTES,
      at: now.toISOString(),
    });
    while (this.readings.size > MAX_SESSIONS) {
      const oldest = this.readings.keys().next().value;
      if (oldest === undefined) break;
      this.readings.delete(oldest);
    }
  }

  get(userSub: string, sessionId: string, now = new Date()): ChatContextReading | undefined {
    this.prune(now);
    return this.readings.get(this.key(userSub, sessionId));
  }

  private key(userSub: string, sessionId: string): string {
    return `${userSub}\u0000${sessionId}`;
  }

  /** Readings are kept in write order, so expired ones are at the front. */
  private prune(now: Date): void {
    const cutoff = now.getTime() - SESSION_TTL_MS;
    for (const [key, reading] of this.readings) {
      if (Date.parse(reading.at) >= cutoff) break;
      this.readings.delete(key);
    }
  }
}
