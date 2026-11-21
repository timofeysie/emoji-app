import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../auth/authFetch';

/** `GET /api/chat/context/:sessionId` (server/src/chat/chat-context.service.ts). */
export type ChatContextReading = {
  fixedTokens: number;
  messageTokens: number;
  replyTokens: number;
  totalTokens: number;
  model: string;
  contextWindow: number | null;
  requestBytes: number;
  bodyLimitBytes: number;
  at: string;
};

/**
 * The chat's latest context reading. Fetched once per turn: when the chat goes
 * from working (sending, receiving, running tools) to idle, i.e. the AI has
 * finished answering and waits for the user. Also after Stop.
 */
export function useChatContextUsage(sessionId: string, isWorking: boolean): ChatContextReading | null {
  const [reading, setReading] = useState<ChatContextReading | null>(null);
  const wasWorking = useRef(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    const finished = wasWorking.current && !isWorking;
    wasWorking.current = isWorking;
    if (!finished) {
      return;
    }

    const request = ++latestRequest.current;
    void authFetch(`/api/chat/context/${sessionId}`)
      .then((res) => (res.ok ? (res.json() as Promise<ChatContextReading>) : null))
      .then((next) => {
        // A slow answer from an earlier turn mustn't replace a newer one.
        if (next && request === latestRequest.current) {
          setReading(next);
        }
      })
      .catch(() => undefined);
  }, [isWorking, sessionId]);

  return reading;
}
