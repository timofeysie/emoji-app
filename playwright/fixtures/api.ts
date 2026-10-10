import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

/** The e2e API server (playwright.config.ts). Tests call it directly, not through Vite. */
export const API_URL = 'http://localhost:3100';

/** Demo referee id; there is no auth until Step 0. */
export const REFEREE_ID = '000000000000000000000001';

export type SlotLabel = 'A' | 'B' | 'C' | 'D' | 'E';
export type GameState = 'draft' | 'ready' | 'lobby' | 'active' | 'paused' | 'completed' | 'cancelled';

export type Player = { id: string; firstName: string; externalId: string; label: string };

export type PlayerBinding = {
  id: string;
  badgeName: string;
  player: Player;
  assignedAt: string;
  unassignedAt: string | null;
  reason: 'initial' | 'swap' | 'replacement';
};

export type GamePlayerBindings = {
  gameId: string;
  badgeNames: string[];
  bindings: PlayerBinding[];
  missingBadges: string[];
};

export type GameDetail = {
  id: string;
  title: string;
  state: GameState;
  questions: Array<{ id: string; sequence: number; state: string; text: string }>;
};

export type GameScores = {
  gameId: string;
  scores: Array<{ badgeName: string; stationName: string; correct: number; total: number }>;
};

/** Short unique suffix, so station, badge and player names never collide across tests. */
export function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function ok<T>(response: APIResponse, status = 200): Promise<T> {
  const text = await response.text();
  expect(response.status(), `${response.url()} → ${text}`).toBe(status);
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Typed helpers over the game API. Each one plays a referee or a station over
 * HTTP, as in docs/db/mongo.md's walkthrough, and asserts the expected status.
 */
export class Api {
  constructor(readonly request: APIRequestContext) {}

  async createGame(title: string): Promise<string> {
    const body = await ok<{ gameId: string }>(
      await this.request.post('/api/games', { data: { title, createdByUserId: REFEREE_ID } }),
      201,
    );
    return body.gameId;
  }

  /** A round with options A (`Hello`) and B (`Goodbye`); `correct` defaults to A. */
  async addRound(
    gameId: string,
    sequence: number,
    options: { text?: string; correct?: SlotLabel } = {},
  ): Promise<string> {
    const correct = options.correct ?? 'A';
    const body = await ok<{ questionId: string }>(
      await this.request.post('/api/questions', {
        data: {
          gameId,
          createdByUserId: REFEREE_ID,
          text: options.text ?? `Round ${sequence}?`,
          sequence,
          mode: 'standard',
          answerOptions: (['A', 'B'] as const).map((slotLabel, index) => ({
            text: slotLabel === 'A' ? 'Hello' : 'Goodbye',
            sequence: index + 1,
            slotLabel,
            isCorrect: slotLabel === correct,
          })),
        },
      }),
      201,
    );
    return body.questionId;
  }

  /** Bind a station and its roster badges to the game (`POST /pairs`). */
  async bindStation(gameId: string, station: string, badgeNames: string[]): Promise<void> {
    await ok(
      await this.request.post(`/api/games/${gameId}/pairs`, {
        data: { pairName: station, badgeNames },
      }),
      201,
    );
  }

  /**
   * Station heartbeat, so the station shows as live and its roster is known
   * to the server (the referee's "Bind" then binds every roster badge).
   */
  async stationHeartbeat(station: string, badgeNames: string[]): Promise<void> {
    for (const badgeName of badgeNames) {
      await ok(
        await this.request.post('/api/status', {
          data: {
            controllerId: `zero-${station}`,
            badgeId: `pico-${badgeName}`,
            bleStatus: 'connected',
            pairName: station,
            badgeName,
            badgeNames,
          },
        }),
        201,
      );
    }
  }

  async setGameState(gameId: string, state: GameState): Promise<void> {
    await ok(await this.request.post(`/api/games/${gameId}/state`, { data: { state } }));
  }

  /** draft → ready → lobby → active. Start Game doesn't open `draft` rounds. */
  async startGame(gameId: string): Promise<void> {
    for (const state of ['ready', 'lobby', 'active'] as const) {
      await this.setGameState(gameId, state);
    }
  }

  async setRoundState(gameId: string, questionId: string, state: 'open' | 'closed'): Promise<void> {
    await ok(
      await this.request.post(`/api/questions/${questionId}/state`, { data: { gameId, state } }),
    );
  }

  /** A station scan. With no NFC card group attached, the server trusts `slotLabel`. */
  async guess(input: {
    gameId: string;
    questionId: string;
    station: string;
    badgeName: string;
    slotLabel: SlotLabel;
  }): Promise<{ isCorrect: boolean; slotLabel: string }> {
    return ok(
      await this.request.post('/api/guesses', {
        data: {
          gameId: input.gameId,
          questionId: input.questionId,
          pairName: input.station,
          badgeName: input.badgeName,
          cardUid: `card-${input.badgeName}-${input.slotLabel}`,
          slotLabel: input.slotLabel,
        },
      }),
      201,
    );
  }

  async getGame(gameId: string): Promise<GameDetail> {
    return ok(await this.request.get(`/api/games/${gameId}`));
  }

  async getScores(gameId: string): Promise<GameScores> {
    return ok(await this.request.get(`/api/games/${gameId}/scores`));
  }

  async createPlayer(firstName: string): Promise<Player> {
    const body = await ok<{ player: Player }>(
      await this.request.post('/api/players', { data: { firstName } }),
      201,
    );
    return body.player;
  }

  async getPlayerBindings(gameId: string): Promise<GamePlayerBindings> {
    return ok(await this.request.get(`/api/games/${gameId}/player-bindings`));
  }

  async bindPlayer(gameId: string, badgeName: string, playerId: string): Promise<PlayerBinding> {
    const body = await ok<{ binding: PlayerBinding }>(
      await this.request.put(
        `/api/games/${gameId}/player-bindings/${encodeURIComponent(badgeName)}`,
        { data: { playerId } },
      ),
    );
    return body.binding;
  }

  async unbindPlayer(gameId: string, badgeName: string): Promise<void> {
    await ok(
      await this.request.delete(
        `/api/games/${gameId}/player-bindings/${encodeURIComponent(badgeName)}`,
      ),
    );
  }
}
