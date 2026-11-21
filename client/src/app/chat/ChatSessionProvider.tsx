import { HashbrownProvider } from '@hashbrownai/react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { authFetchMiddleware } from '../auth/authFetchMiddleware';

/** Header the server keys context readings by (server/src/chat/chat-session.ts). */
const CHAT_SESSION_HEADER = 'X-Chat-Session';

const ChatSessionContext = createContext<string | null>(null);

/**
 * Gives the chat panel its own Hashbrown provider, which tags its requests
 * with a session id for the context indicator. Other Hashbrown hooks (the
 * smart-home dialogs) stay on the app's provider and send none, so they
 * don't change the chat's reading. A new mount is a new session.
 */
export function ChatSessionProvider({ url, children }: { url: string; children: ReactNode }) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const middleware = useMemo(
    () => [
      authFetchMiddleware,
      (request: RequestInit): RequestInit => {
        const headers = new Headers(request.headers);
        headers.set(CHAT_SESSION_HEADER, sessionId);
        return { ...request, headers };
      },
    ],
    [sessionId],
  );

  return (
    <ChatSessionContext.Provider value={sessionId}>
      <HashbrownProvider url={url} middleware={middleware}>
        {children}
      </HashbrownProvider>
    </ChatSessionContext.Provider>
  );
}

export function useChatSessionId(): string {
  const sessionId = useContext(ChatSessionContext);
  if (!sessionId) {
    throw new Error('useChatSessionId needs a ChatSessionProvider');
  }
  return sessionId;
}
