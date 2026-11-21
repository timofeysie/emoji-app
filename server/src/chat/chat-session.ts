/** Header the chat panel sends with each `/api/chat` request. */
export const CHAT_SESSION_HEADER = 'x-chat-session';

/** A session id is a UUID the panel makes when it mounts. */
export const CHAT_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
