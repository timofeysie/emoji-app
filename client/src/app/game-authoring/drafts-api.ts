import { authFetch } from '../auth/authFetch';
import type { QuestionFocus, QuestionMixId } from './question-mixes';

/**
 * The server's draft API (`/api/content/drafts`,
 * docs/hashbrown/creating-games-with-hashbrown.md → Server). The server
 * validates every write again (G3) and returns the draft's `problems`.
 */

/** The user guide for asking for games (docs/hashbrown/asking-for-games.md). */
export const ASKING_FOR_GAMES_URL =
  'https://github.com/timofeysie/emoji-app/blob/develop/docs/hashbrown/asking-for-games.md';

export type LanguagePair = { target: string; native: string };

export type DraftOption = { text: string; isCorrect: boolean };

export type DraftQuestion = {
  text: string;
  focus?: QuestionFocus;
  options: DraftOption[];
  sourceExcerpt?: string;
};

/** The server's `gameDraftPayloadSchema`: the Skillet `gameDraftSchema`, before it's playable. */
export type GameDraftContent = {
  title: string;
  language?: LanguagePair;
  questions: DraftQuestion[];
};

export type DraftSettings = {
  mix: QuestionMixId;
  questionCount: number;
  optionsPerQuestion: number;
};

export type DraftProblem = { path: string; message: string };

export type ContentDraft = {
  id: string;
  type: 'game' | 'chapter';
  title: string;
  payload: GameDraftContent | null;
  settings: DraftSettings;
  problems: DraftProblem[];
  status: 'draft' | 'accepted';
  shared: boolean;
  resultGameId: string | null;
  remixedFromGameId: string | null;
  revision: number;
  updatedAt: string;
  /** The caller owns it: only the owner shares, deletes or accepts (G14). */
  mine: boolean;
};

export type DraftView = {
  draft: ContentDraft;
  source: { text: string; language: LanguagePair } | null;
  language: LanguagePair;
};

export type DraftSummary = {
  id: string;
  type: 'game' | 'chapter';
  title: string;
  status: 'draft' | 'accepted';
  shared: boolean;
  resultGameId: string | null;
  revision: number;
  updatedAt: string;
  questionCount: number;
  problemCount: number;
  mine: boolean;
};

/** A refused request, with what the server said. A 409 carries the current draft. */
export class DraftRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; problems?: DraftProblem[]; details?: DraftProblem[] } & Partial<DraftView>,
  ) {
    super(body.error ?? `Server returned ${status}`);
  }
}

async function send<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(url, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new DraftRequestError(res.status, body);
  }
  return body;
}

export function listDrafts(shared: boolean): Promise<{ drafts: DraftSummary[] }> {
  return send(`/api/content/drafts${shared ? '?shared=true' : ''}`);
}

export function createDraft(
  body: { source?: { text: string; language: LanguagePair }; settings?: DraftSettings } | { fromGameId: string },
): Promise<{ draft: ContentDraft }> {
  return send('/api/content/drafts', { method: 'POST', body: JSON.stringify({ type: 'game', ...body }) });
}

export function getDraft(draftId: string): Promise<DraftView> {
  return send(`/api/content/drafts/${draftId}`);
}

export function updateDraft(
  draftId: string,
  body: {
    revision: number;
    source?: { text: string; language: LanguagePair };
    settings?: DraftSettings;
    payload?: GameDraftContent;
  },
): Promise<DraftView> {
  return send(`/api/content/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function shareDraft(draftId: string, shared: boolean): Promise<DraftView> {
  return send(`/api/content/drafts/${draftId}/share`, { method: 'PUT', body: JSON.stringify({ shared }) });
}

export function deleteDraft(draftId: string): Promise<{ ok: true }> {
  return send(`/api/content/drafts/${draftId}`, { method: 'DELETE' });
}

export function acceptDraft(draftId: string, revision: number): Promise<{ gameId: string; draft: ContentDraft }> {
  return send(`/api/content/drafts/${draftId}/accept`, { method: 'POST', body: JSON.stringify({ revision }) });
}
