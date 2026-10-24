import { expect, type APIResponse } from '@playwright/test';
import { REFEREE_ID, type Api, type Player, type SlotLabel } from './api';
import { test as gameTest, type Games } from './game';
import { learningObjectId, type StubLrs, type Word } from './stub-lrs';

/**
 * Solo Leitner games over the API (docs/xAPI/leitner-method.md → API):
 * plan, create, play one badge through the rounds, end, and read progress.
 */

/** A few chapter 26, 27 and 29 words (server/src/games/content/ko-senses.json). */
export const WORDS = {
  /** ch. 27 */
  level: { word: '정도', sense: 'level', kind: 'lexeme', sourceRef: 'korean-language-book/ch27/vocabulary/0' },
  test: { word: '시험', sense: 'test', kind: 'lexeme', sourceRef: 'korean-language-book/ch27/vocabulary/1' },
  lesson: { word: '수업', sense: 'class', kind: 'lexeme', sourceRef: 'korean-language-book/ch27/vocabulary/2' },
  /** ch. 26 only */
  flu: { word: '독감', sense: 'flu', kind: 'lexeme', sourceRef: 'korean-language-book/ch26/vocabulary/0' },
  fever: { word: '열', sense: 'fever', kind: 'lexeme', sourceRef: 'korean-language-book/ch26/vocabulary/4' },
  /** ch. 26 and ch. 27 (L2): one learning object, here met in ch. 26. */
  toShow: { word: '보여 주다', sense: 'to-show', kind: 'expression', sourceRef: 'korean-language-book/ch26/vocabulary/6' },
  /** ch. 29 only */
  direction: { word: '방향', sense: 'direction', kind: 'lexeme', sourceRef: 'korean-language-book/ch29/vocabulary/3' },
} as const satisfies Record<string, Word>;

/** Ch. 27: 14 entries, 14 learning objects (two shared with ch. 26). */
export const CH27_OBJECTS = 14;

export const DAY_MS = 24 * 60 * 60 * 1000;

export function daysFrom(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

export type PickReason = 'overdue' | 'new' | 'practice' | 'review';
export type TrackStatus = 'new' | 'active' | 'retired';
export type Level = 0 | 1 | 2 | 3;

export type PlanPick = {
  learningObjectId: string;
  aspect: string;
  sourceRef: string;
  reason: PickReason;
  level: Level;
  status: TrackStatus;
  dueAt: string | null;
  word: string;
  gloss: string;
  chapter: string | null;
};

export type PlanQuestion = {
  sequence: number;
  aspect: string | null;
  learningObjectId: string | null;
  prompt: string;
  options: Array<{ slotLabel: SlotLabel; text: string; isCorrect: boolean }>;
};

export type Plan = {
  book: string;
  chapter: string;
  scope: 'chapter' | 'review';
  aspects: string[];
  seed: number;
  now: string;
  picks: PlanPick[];
  report: {
    available: Record<PickReason, number>;
    picked: Record<PickReason, number>;
    skipped: Array<{ learningObjectId: string; aspect: string }>;
    short: boolean;
  };
  questions: PlanQuestion[];
  supersedes: string[];
};

export type ProgressTrack = {
  learningObjectId: string;
  aspect: string;
  status: TrackStatus;
  level: Level;
  dueAt: string | null;
  retiredAt: string | null;
  lastResult: 'correct' | 'incorrect' | null;
  seenCount: number;
  correctCount: number;
  incorrectCount: number;
  sources: string[];
  due: boolean;
  inChapter: boolean;
  kind: string | null;
  word: string | null;
  gloss: string | null;
};

export type Progress = {
  player: { id: string; label: string };
  chapter: string;
  scope: 'chapter' | 'review';
  aspects: string[];
  asOf: string;
  statementCount: number;
  observationCount: number;
  pendingExport: Array<{ gameId: string; endedAt: string | null; error: string | null }>;
  summary: {
    new: number;
    active: { L0: number; L1: number; L2: number; L3: number };
    retired: number;
    due: number;
  };
  tracks: ProgressTrack[];
};

export type TrackChange = {
  learningObjectId: string;
  aspect: string;
  change: 'promoted' | 'demoted' | 'retired' | 'unchanged';
  from: { level: Level; status: TrackStatus };
  to: { level: Level; status: TrackStatus };
};

export type LeitnerExport =
  | {
      exported: true;
      statementsSent: number;
      deleted: boolean;
      summary: { score: { correct: number; total: number }; changes: TrackChange[] | null };
    }
  | { exported: false; status: number; error: Record<string, unknown> };

export type PlanRequest = {
  playerId: string;
  chapter?: number | string;
  scope?: 'chapter' | 'review';
  aspects?: string[];
  count?: number;
  maxNew?: number;
  fill?: boolean;
  seed?: number;
  now?: string;
};

/** A created Leitner game with one station and one badge, ready to start. */
export type LeitnerGame = {
  gameId: string;
  plan: Plan;
  player: Player;
  station: string;
  badge: string;
};

async function json<T>(response: APIResponse, status: number): Promise<T> {
  const text = await response.text();
  expect(response.status(), `${response.url()} → ${text}`).toBe(status);
  return (text ? JSON.parse(text) : {}) as T;
}

/** A track's key, as `{learningObjectId, aspect}` pairs appear in picks, tracks and changes. */
export function trackKey(track: { learningObjectId: string; aspect: string }): string {
  return `${track.learningObjectId} · ${track.aspect}`;
}

export function findTrack(progress: Progress, word: Word, aspect: string): ProgressTrack | undefined {
  const id = learningObjectId(word);
  return progress.tracks.find((track) => track.learningObjectId === id && track.aspect === aspect);
}

export class Leitner {
  constructor(
    private readonly api: Api,
    private readonly games: Games,
  ) {}

  /** A student with a unique first name. */
  async student(base = 'Student'): Promise<Player> {
    return this.api.createPlayer(this.games.name(base));
  }

  /** Raw `POST /api/leitner-games`, so a test can assert a refusal. */
  async planRaw(input: PlanRequest & { dryRun?: boolean; createdByUserId?: string }): Promise<APIResponse> {
    return this.api.request.post('/api/leitner-games', { data: { chapter: 27, ...input } });
  }

  async dryRun(input: PlanRequest): Promise<Plan> {
    const body = await json<{ plan: Plan }>(await this.planRaw({ ...input, dryRun: true }), 200);
    return body.plan;
  }

  async create(input: PlanRequest): Promise<{ gameId: string; plan: Plan }> {
    return json(await this.planRaw({ ...input, createdByUserId: REFEREE_ID }), 201);
  }

  async progressRaw(
    playerId: string,
    query: { chapter?: number | string; scope?: string; aspects?: string; now?: string } = {},
  ): Promise<APIResponse> {
    const params = new URLSearchParams({ chapter: String(query.chapter ?? 27) });
    if (query.scope) params.set('scope', query.scope);
    if (query.aspects) params.set('aspects', query.aspects);
    if (query.now) params.set('now', query.now);
    return this.api.request.get(`/api/players/${playerId}/progress?${params.toString()}`);
  }

  async progress(
    playerId: string,
    query: { chapter?: number | string; scope?: string; aspects?: string; now?: string } = {},
  ): Promise<Progress> {
    return json(await this.progressRaw(playerId, query), 200);
  }

  /** Creates the student's game and binds a station holding one badge to it. */
  async newGame(player: Player, input: Omit<PlanRequest, 'playerId'> = {}): Promise<LeitnerGame> {
    const { gameId, plan } = await this.create({ playerId: player.id, ...input });
    const station = this.games.name(`st-${gameId.slice(-4)}`);
    const badge = this.games.name(`badge-${gameId.slice(-4)}`);
    await this.api.bindStation(gameId, station, [badge]);
    return { gameId, plan, player, station, badge };
  }

  /** draft → ready → lobby → active. Round 1 then opens after the start countdown. */
  async start(game: LeitnerGame): Promise<void> {
    await this.api.startGame(game.gameId);
  }

  /**
   * Opens round `sequence` by hand, which cancels any pending countdown,
   * once no other round is open. If the countdown got there first, that's fine.
   */
  async openRound(game: LeitnerGame, sequence: number): Promise<string> {
    const question = await this.question(game, sequence);
    await expect
      .poll(async () => (await this.api.getGame(game.gameId)).questions.some((q) => q.state === 'open' && q.id !== question.id), {
        message: `another round is still open before round ${sequence}`,
      })
      .toBe(false);
    const response = await this.api.request.post(`/api/questions/${question.id}/state`, {
      data: { gameId: game.gameId, state: 'open' },
    });
    if (response.status() === 409) {
      const open = (await this.api.getGame(game.gameId)).questions.find((q) => q.state === 'open');
      expect(open?.id, `round ${sequence} should be the open one`).toBe(question.id);
    } else {
      expect(response.status(), await response.text()).toBe(200);
    }
    return question.id;
  }

  /** The badge scans the right card, or a wrong one, in the open round `sequence`. */
  async answer(game: LeitnerGame, sequence: number, correct: boolean): Promise<void> {
    const question = await this.question(game, sequence);
    const planned = game.plan.questions.find((q) => q.sequence === sequence);
    const option = planned?.options.find((o) => o.isCorrect === correct);
    if (!option) throw new Error(`Round ${sequence} has no ${correct ? 'correct' : 'wrong'} option.`);
    const result = await this.api.guess({
      gameId: game.gameId,
      questionId: question.id,
      station: game.station,
      badgeName: game.badge,
      slotLabel: option.slotLabel,
    });
    expect(result.isCorrect).toBe(correct);
  }

  /** Starts the game and answers every round; `correct` decides each answer. */
  async play(game: LeitnerGame, correct: (question: PlanQuestion) => boolean): Promise<void> {
    await this.start(game);
    for (const question of game.plan.questions) {
      await this.openRound(game, question.sequence);
      await this.answer(game, question.sequence, correct(question));
    }
  }

  /** End Game: completes it, which auto-exports a Leitner game. */
  async end(game: LeitnerGame): Promise<LeitnerExport> {
    const body = await json<{ state: string; leitnerExport: LeitnerExport }>(
      await this.api.request.post(`/api/games/${game.gameId}/state`, { data: { state: 'completed' } }),
      200,
    );
    expect(body.state).toBe('completed');
    return body.leitnerExport;
  }

  /** The game, or null once it's deleted (404). */
  async gameOrNull(gameId: string): Promise<{ state: string; kind: string; exportError: string | null } | null> {
    const response = await this.api.request.get(`/api/games/${gameId}`);
    if (response.status() === 404) return null;
    return json(response, 200);
  }

  private async question(game: LeitnerGame, sequence: number) {
    const detail = await this.api.getGame(game.gameId);
    const question = detail.questions.find((q) => q.sequence === sequence);
    if (!question) throw new Error(`Game ${game.gameId} has no round ${sequence}.`);
    return question;
  }
}

/** Answer every question except those about `wrong` learning objects. */
export function allCorrectExcept(wrong: Iterable<string>): (question: PlanQuestion) => boolean {
  const set = new Set(wrong);
  return (question) => !set.has(question.learningObjectId ?? '');
}

export const test = gameTest.extend<{ leitner: Leitner; stubLrs: StubLrs }>({
  leitner: async ({ api, games }, use) => {
    await use(new Leitner(api, games));
  },
  // Injected failures must never leak into the next test.
  stubLrs: async ({ stubLrs }, use) => {
    await use(stubLrs);
    await stubLrs.clearFailures();
  },
});

export { expect } from '@playwright/test';
export { learningObjectId, type Word } from './stub-lrs';
