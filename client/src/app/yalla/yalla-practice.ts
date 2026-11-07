import { postYalla, YallaRequestError } from './yalla-api';
import type { Level, TrackStatus } from './yalla-progress';

/**
 * YALLA solo Leitner practice (docs/yalla/implementation-plan.md §6,
 * milestone Y4): plan a session, answer on screen, and send the answers
 * through an outbox that survives a refresh or a dropped connection.
 */

export type PracticeAspect = 'reading' | 'writing';
export type SlotLabel = 'A' | 'B' | 'C' | 'D';

/** How an answer arrives. Only `onscreen-choice` is offered until Y5 adds typing. */
export type InputChannel = 'onscreen-choice' | 'keyboard';

/** The learner's game format: an input channel per aspect. */
export type GameFormat = Record<PracticeAspect, InputChannel>;

/** Writing = type the Korean, reading = choose the meaning (§6 → YALLA's formats). */
export const DEFAULT_FORMAT: GameFormat = { reading: 'onscreen-choice', writing: 'keyboard' };

export const OFFERED_CHANNELS: readonly InputChannel[] = ['onscreen-choice'];

/** The channel a session uses for `aspect`: the format's, unless that isn't offered yet. */
export function channelFor(format: GameFormat, aspect: PracticeAspect): InputChannel {
  return OFFERED_CHANNELS.includes(format[aspect]) ? format[aspect] : 'onscreen-choice';
}

export type PracticeItem = {
  itemId: string;
  aspect: PracticeAspect;
  learningObjectId: string;
  sourceRef: string;
  word: string;
  gloss: string;
  reason: 'overdue' | 'new' | 'practice' | 'review';
  level: Level;
  status: TrackStatus;
  prompt: string;
  options: Array<{ slotLabel: SlotLabel; text: string }>;
  answer: SlotLabel;
};

/** `POST /api/yalla/me/sessions` */
export type PracticeSession = {
  sessionId: string;
  player: { id: string; label: string };
  book: string;
  chapter: string;
  scope: 'chapter' | 'review';
  aspects: PracticeAspect[];
  plannedAt: string;
  items: PracticeItem[];
};

export type SessionRequest = {
  book: string;
  chapter: string;
  scope: 'chapter' | 'review';
  aspects: PracticeAspect[];
  count: number;
};

/** One answer as `POST /api/yalla/me/results` takes it. */
export type Attempt = {
  attemptId: string;
  itemId: string;
  book: string;
  sourceRef: string;
  learningObjectId: string;
  aspect: PracticeAspect;
  channel: InputChannel;
  options: Array<{ slotLabel: SlotLabel; text: string }>;
  response: SlotLabel;
  answeredAt: string;
  openedAt?: string;
  correct: boolean;
};

type OutboxEntry = { playerId: string; sessionId: string; attempt: Attempt };

/** The server's batch limit: one LRS request per POST. */
const BATCH = 20;
const OUTBOX_KEY = 'yalla.outbox.v1';
const SESSION_KEY = 'yalla.session.v1';
const FORMAT_KEY = 'yalla.format.v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the answer is still in memory for this page.
  }
}

/** In memory too, so answers survive when storage is blocked (private windows). */
let outbox: OutboxEntry[] = readJson<OutboxEntry[]>(OUTBOX_KEY, []);

function saveOutbox(): void {
  writeJson(OUTBOX_KEY, outbox);
  for (const listener of listeners) listener();
}

const listeners = new Set<() => void>();

/** Called whenever the outbox changes (for "N answers waiting"). */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Answers not yet in the LRS, for `playerId` (or everyone). */
export function pendingCount(playerId?: string): number {
  return outbox.filter((entry) => !playerId || entry.playerId === playerId).length;
}

export function enqueueAttempt(playerId: string, sessionId: string, attempt: Attempt): void {
  outbox = [...outbox.filter((entry) => entry.attempt.attemptId !== attempt.attemptId), { playerId, sessionId, attempt }];
  saveOutbox();
}

let flushing: Promise<void> | null = null;

/**
 * Sends queued answers for `playerId`, ≤ 20 per request. An entry leaves
 * the outbox only after a 2xx (the server has put it in the LRS), or when
 * the server says it can never be accepted (400/409/422). Only the linked
 * player's answers are sent: the server records them for whoever is linked
 * now. Throws if anything is still waiting.
 */
export function flushOutbox(playerId: string): Promise<void> {
  if (!flushing) {
    flushing = sendAll(playerId).finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function sendAll(playerId: string): Promise<void> {
  const sessions = new Map<string, OutboxEntry[]>();
  for (const entry of outbox) {
    if (entry.playerId !== playerId) continue;
    sessions.set(entry.sessionId, [...(sessions.get(entry.sessionId) ?? []), entry]);
  }
  for (const [sessionId, entries] of sessions) {
    for (let start = 0; start < entries.length; start += BATCH) {
      const batch = entries.slice(start, start + BATCH);
      try {
        await postYalla('/me/results', { sessionId, attempts: batch.map((entry) => entry.attempt) });
      } catch (error) {
        const permanent = error instanceof YallaRequestError && [400, 409, 422].includes(error.status);
        if (!permanent) throw error;
        console.warn('YALLA dropped answers the server refused', error);
      }
      const sent = new Set(batch.map((entry) => entry.attempt.attemptId));
      outbox = outbox.filter((entry) => !sent.has(entry.attempt.attemptId));
      saveOutbox();
    }
  }
}

export function startSession(request: SessionRequest): Promise<PracticeSession> {
  return postYalla<PracticeSession>('/me/sessions', request);
}

/** A session in progress, kept so a refresh carries on where it stopped. */
export type SavedSession = {
  session: PracticeSession;
  /** Answers so far, by itemId. */
  answers: Record<string, { response: SlotLabel; correct: boolean }>;
  startedAt: string;
  /** Set when the learner leaves the last answer's feedback for the summary. */
  finished?: boolean;
};

export function loadSavedSession(playerId: string, book: string, chapter: string): SavedSession | null {
  const saved = readJson<SavedSession | null>(SESSION_KEY, null);
  const session = saved?.session;
  return session && session.player.id === playerId && session.book === book && session.chapter === chapter
    ? saved
    : null;
}

export function saveSession(saved: SavedSession | null): void {
  writeJson(SESSION_KEY, saved);
}

export function loadFormat(): GameFormat {
  return { ...DEFAULT_FORMAT, ...readJson<Partial<GameFormat>>(FORMAT_KEY, {}) };
}

export function saveFormat(format: GameFormat): void {
  writeJson(FORMAT_KEY, format);
}

/** A unique attempt id (the server derives statement ids from it). */
export function newAttemptId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID needs a secure context; a phone on the LAN over http has none.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
