import type { YallaFormat } from './me.store';
import { postYalla, YallaRequestError } from './yalla-api';
import type { Level, TrackStatus } from './yalla-progress';

/**
 * YALLA solo Leitner practice (docs/yalla/implementation-plan.md §6,
 * milestone Y4): plan a session, answer on screen, and send the answers
 * through an outbox that survives a refresh or a dropped connection.
 */

export type PracticeAspect = 'reading' | 'writing';
export type SlotLabel = 'A' | 'B' | 'C' | 'D';

/** How an answer arrives: tap/click/press A–D, or type it. */
export type InputChannel = 'onscreen-choice' | 'keyboard';

/** The learner's game format: an input channel per aspect. */
export type GameFormat = YallaFormat;

/** Writing = type the Korean, reading = choose the meaning (§6 → YALLA's formats). */
export const DEFAULT_FORMAT: GameFormat = { reading: 'onscreen-choice', writing: 'keyboard' };

export const OFFERED_CHANNELS: readonly InputChannel[] = ['onscreen-choice', 'keyboard'];

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

type AttemptBase = {
  attemptId: string;
  itemId: string;
  book: string;
  sourceRef: string;
  learningObjectId: string;
  aspect: PracticeAspect;
  answeredAt: string;
  openedAt?: string;
  correct: boolean;
};

/** One answer as `POST /api/yalla/me/results` takes it. */
export type Attempt =
  | (AttemptBase & { channel: 'onscreen-choice'; options: Array<{ slotLabel: SlotLabel; text: string }>; response: SlotLabel })
  /** `response` as typed; `''` is "Don't know". */
  | (AttemptBase & { channel: 'keyboard'; response: string });

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
  /** Answers so far, by itemId: the slot chosen, or the text typed. */
  answers: Record<string, { channel: InputChannel; response: string; correct: boolean }>;
  /** This session's input per aspect (the setup choice, then the in-card toggle). */
  format: GameFormat;
  /** Items whose A–D options were shown: they can't switch to typing (no peeking). */
  choiceShown: string[];
  startedAt: string;
  /** Set when the learner leaves the last answer's feedback for the summary. */
  finished?: boolean;
};

export function loadSavedSession(playerId: string, book: string, chapter: string): SavedSession | null {
  const saved = readJson<Partial<SavedSession> | null>(SESSION_KEY, null);
  const session = saved?.session;
  if (!saved || !session || session.player.id !== playerId || session.book !== book || session.chapter !== chapter) {
    return null;
  }
  // Sessions saved before Y5 were all A–D, and their answers had no channel.
  const answers: SavedSession['answers'] = {};
  for (const [itemId, answer] of Object.entries(saved.answers ?? {})) {
    answers[itemId] = { ...answer, channel: answer.channel ?? 'onscreen-choice' };
  }
  return {
    session,
    answers,
    startedAt: saved.startedAt ?? new Date().toISOString(),
    finished: saved.finished,
    format: saved.format ?? { reading: 'onscreen-choice', writing: 'onscreen-choice' },
    choiceShown: saved.choiceShown ?? [],
  };
}

export function saveSession(saved: SavedSession | null): void {
  writeJson(SESSION_KEY, saved);
}

function isChannel(value: unknown): value is InputChannel {
  return value === 'onscreen-choice' || value === 'keyboard';
}

/**
 * The learner's format: the one saved on their user (follows them across
 * devices), else this browser's copy, else the defaults.
 */
export function loadFormat(saved: GameFormat | null | undefined): GameFormat {
  const local = readJson<Partial<GameFormat>>(FORMAT_KEY, {});
  const source = saved ?? local;
  return {
    reading: isChannel(source.reading) ? source.reading : DEFAULT_FORMAT.reading,
    writing: isChannel(source.writing) ? source.writing : DEFAULT_FORMAT.writing,
  };
}

/** This browser's copy, so the format works offline and before `/api/me` loads; null clears it. */
export function saveLocalFormat(format: GameFormat | null): void {
  writeJson(FORMAT_KEY, format);
}

export function sameFormat(a: GameFormat, b: GameFormat): boolean {
  return a.reading === b.reading && a.writing === b.writing;
}

/** A unique attempt id (the server derives statement ids from it). */
export function newAttemptId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID needs a secure context; a phone on the LAN over http has none.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
