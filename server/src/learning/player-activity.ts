import { ANSWERED_VERB_ID, XAPI_BASE_IRI } from '../xapi/iris';
import type { BookContent } from './book-content';
import { DEFAULT_LEITNER_CONFIG, foldTracks, isDue, observationsFromStatements, type Level, type TrackState } from './leitner';
import { chapterOfSourceRef, EXT_ASPECT, EXT_GAME_KIND, EXT_SOURCE_REF, parseQualifiedSourceRef } from './learning-object';

/**
 * A student's activity from their own statements in the LRS (Players page):
 * games played, recent answers, and Leitner tracks across every chapter.
 * Pure, like the fold: the controller fetches, this summarises.
 */

const SCORED_VERB_ID = 'http://adlnet.gov/expapi/verbs/scored';
const EXT_GAME_ID = `${XAPI_BASE_IRI}/ext/game-id`;
const GAME_PREFIX = `${XAPI_BASE_IRI}/games/`;

/** Recent answers returned, newest first. */
export const RECENT_ANSWER_LIMIT = 50;

export type ActivitySession = {
  gameId: string;
  /** From the `scored` statement; null when the LRS has no score for this game. */
  title: string | null;
  /** `ext/game-kind` on its answers; untagged (class) games have none. */
  kind: string;
  firstAnswerAt: string | null;
  lastAnswerAt: string | null;
  answered: number;
  correct: number;
  score: { raw: number; max: number } | null;
  /** Chapter numbers its tagged answers came from. */
  chapters: string[];
};

export type ActivityAnswer = {
  statementId: string;
  timestamp: string;
  gameId: string | null;
  kind: string;
  question: string;
  response: string | null;
  correctAnswer: string | null;
  success: boolean;
  aspect: string | null;
  chapter: string | null;
  durationSeconds: number | null;
};

export type ActivityTrack = TrackState & {
  due: boolean;
  word: string | null;
  gloss: string | null;
  kind: string | null;
};

export type PlayerActivity = {
  statementCount: number;
  summary: {
    games: number;
    answered: number;
    correct: number;
    firstActivityAt: string | null;
    lastActivityAt: string | null;
    /** Distinct learning objects; `tracks` counts each aspect separately. */
    words: number;
    tracks: number;
    active: Record<`L${Level}`, number>;
    retired: number;
    due: number;
  };
  sessions: ActivitySession[];
  recentAnswers: ActivityAnswer[];
  tracks: ActivityTrack[];
};

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null;
}

function get(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function enUs(value: unknown): string | null {
  return str(get(value, 'en-US'));
}

/** `PT4.2S` → 4.2; anything else → null. Only seconds are ever written (statement-builder). */
function durationSeconds(value: unknown): number | null {
  const match = typeof value === 'string' ? /^PT(\d+(?:\.\d+)?)S$/.exec(value) : null;
  return match ? Number(match[1]) : null;
}

function chapterOf(qualifiedRef: unknown): string | null {
  const parsed = typeof qualifiedRef === 'string' ? parseQualifiedSourceRef(qualifiedRef) : null;
  return parsed ? chapterOfSourceRef(parsed.sourceRef) : null;
}

function choiceText(definition: unknown, id: string): string | null {
  const choices = get(definition, 'choices');
  if (!Array.isArray(choices)) return null;
  const choice = choices.find((c) => get(c, 'id') === id);
  return choice ? enUs(get(choice, 'description')) : null;
}

function latest(a: string | null, b: string): string {
  return a === null || Date.parse(b) > Date.parse(a) ? b : a;
}

function earliest(a: string | null, b: string): string {
  return a === null || Date.parse(b) < Date.parse(a) ? b : a;
}

/** Sort key for an optional ISO time; missing times sort as oldest. */
function timeKey(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

export function summarizePlayerActivity(input: {
  statements: readonly unknown[];
  content: BookContent;
  now: Date;
}): PlayerActivity {
  const { statements, content, now } = input;
  const sessions = new Map<string, ActivitySession>();
  const session = (gameId: string): ActivitySession => {
    let found = sessions.get(gameId);
    if (!found) {
      found = {
        gameId,
        title: null,
        kind: 'class',
        firstAnswerAt: null,
        lastAnswerAt: null,
        answered: 0,
        correct: 0,
        score: null,
        chapters: [],
      };
      sessions.set(gameId, found);
    }
    return found;
  };

  const answers: ActivityAnswer[] = [];
  let firstActivityAt: string | null = null;
  let lastActivityAt: string | null = null;

  for (const statement of statements) {
    const verb = get(statement, 'verb', 'id');
    const timestamp = str(get(statement, 'timestamp'));
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) continue;

    if (verb === ANSWERED_VERB_ID) {
      const extensions = get(statement, 'context', 'extensions');
      const gameId = str(get(extensions, EXT_GAME_ID));
      const kind = str(get(extensions, EXT_GAME_KIND)) ?? 'class';
      const success = get(statement, 'result', 'success') === true;
      const definition = get(statement, 'object', 'definition');
      const responseId = str(get(statement, 'result', 'response'));
      const correctPattern = get(definition, 'correctResponsesPattern');
      const correctId = Array.isArray(correctPattern) ? str(correctPattern[0]) : null;
      const chapter = chapterOf(get(extensions, EXT_SOURCE_REF));

      answers.push({
        statementId: String(get(statement, 'id') ?? ''),
        timestamp,
        gameId,
        kind,
        question: enUs(get(definition, 'name')) ?? '',
        response: responseId ? (choiceText(definition, responseId) ?? responseId) : null,
        correctAnswer: correctId ? (choiceText(definition, correctId) ?? correctId) : null,
        success,
        aspect: str(get(extensions, EXT_ASPECT)),
        chapter,
        durationSeconds: durationSeconds(get(statement, 'result', 'duration')),
      });
      firstActivityAt = earliest(firstActivityAt, timestamp);
      lastActivityAt = latest(lastActivityAt, timestamp);

      if (gameId) {
        const row = session(gameId);
        row.kind = kind;
        row.answered++;
        if (success) row.correct++;
        row.firstAnswerAt = earliest(row.firstAnswerAt, timestamp);
        row.lastAnswerAt = latest(row.lastAnswerAt, timestamp);
        if (chapter && !row.chapters.includes(chapter)) row.chapters.push(chapter);
      }
    } else if (verb === SCORED_VERB_ID) {
      const objectId = str(get(statement, 'object', 'id'));
      if (!objectId?.startsWith(GAME_PREFIX)) continue;
      const row = session(objectId.slice(GAME_PREFIX.length));
      row.title = enUs(get(statement, 'object', 'definition', 'name'));
      const raw = get(statement, 'result', 'score', 'raw');
      const max = get(statement, 'result', 'score', 'max');
      if (typeof raw === 'number' && typeof max === 'number') row.score = { raw, max };
      firstActivityAt = earliest(firstActivityAt, timestamp);
      lastActivityAt = latest(lastActivityAt, timestamp);
    }
  }

  const tracks: ActivityTrack[] = foldTracks(
    observationsFromStatements(statements, content.language, DEFAULT_LEITNER_CONFIG),
    DEFAULT_LEITNER_CONFIG,
  )
    .map((track) => {
      const sense = content.senseById.get(track.learningObjectId);
      return {
        ...track,
        due: isDue(track, now, DEFAULT_LEITNER_CONFIG),
        word: sense?.word ?? null,
        gloss: sense?.gloss ?? null,
        kind: sense?.kind ?? null,
      };
    })
    .sort(
      (a, b) =>
        timeKey(b.lastSeenAt) - timeKey(a.lastSeenAt) ||
        a.learningObjectId.localeCompare(b.learningObjectId) ||
        a.aspect.localeCompare(b.aspect),
    );

  const active: Record<`L${Level}`, number> = { L0: 0, L1: 0, L2: 0, L3: 0 };
  let retired = 0;
  let due = 0;
  for (const track of tracks) {
    if (track.status === 'retired') retired++;
    else active[`L${track.level}`]++;
    if (track.due) due++;
  }

  answers.sort((a, b) => timeKey(b.timestamp) - timeKey(a.timestamp));
  const sessionRows = [...sessions.values()].sort((a, b) => timeKey(b.lastAnswerAt) - timeKey(a.lastAnswerAt));

  return {
    statementCount: statements.length,
    summary: {
      games: sessionRows.length,
      answered: answers.length,
      correct: answers.filter((answer) => answer.success).length,
      firstActivityAt,
      lastActivityAt,
      words: new Set(tracks.map((track) => track.learningObjectId)).size,
      tracks: tracks.length,
      active,
      retired,
      due,
    },
    sessions: sessionRows,
    recentAnswers: answers.slice(0, RECENT_ANSWER_LIMIT),
    tracks,
  };
}
