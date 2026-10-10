import { test as base, request as playwrightRequest } from '@playwright/test';
import { API_URL, Api, uniqueId, type SlotLabel } from './api';

/** A game built through the API. Badge keys are the logical names a test uses. */
export type GameSetup = {
  gameId: string;
  title: string;
  station: string;
  /** Logical badge name (`red`) → the unique name in this test (`red-lq3x9a1b`). */
  badges: Record<string, string>;
  /** Round question ids, in sequence order. */
  roundIds: string[];
};

/** Builds games in a given state. Every name is unique to the test (see the plan's "State"). */
export class Games {
  constructor(
    private readonly api: Api,
    readonly id: string,
  ) {}

  /** A unique name for this test, e.g. `name('Mia')` → `Mia-lq3x9a1b`. */
  name(base: string): string {
    return `${base}-${this.id}`;
  }

  /** A `draft` game with `rounds` rounds (A correct) and one station holding `badges`. */
  async withStation(options: { badges: string[]; rounds?: number }): Promise<GameSetup> {
    const title = this.name('E2E game');
    const gameId = await this.api.createGame(title);
    const roundIds: string[] = [];
    for (let sequence = 1; sequence <= (options.rounds ?? 1); sequence += 1) {
      roundIds.push(await this.api.addRound(gameId, sequence));
    }
    const station = this.name('st');
    const badges = Object.fromEntries(options.badges.map((badge) => [badge, this.name(badge)]));
    await this.api.bindStation(gameId, station, Object.values(badges));
    return { gameId, title, station, badges, roundIds };
  }

  /** As `withStation`, then started with round 1 open. */
  async active(options: { badges: string[]; rounds?: number }): Promise<GameSetup> {
    const setup = await this.withStation(options);
    await this.api.startGame(setup.gameId);
    await this.api.setRoundState(setup.gameId, setup.roundIds[0], 'open');
    return setup;
  }

  /** Each badge in `answers` scans its card in the given round. */
  async guessAll(
    setup: GameSetup,
    roundIndex: number,
    answers: Record<string, SlotLabel>,
  ): Promise<void> {
    for (const [badge, slotLabel] of Object.entries(answers)) {
      await this.api.guess({
        gameId: setup.gameId,
        questionId: setup.roundIds[roundIndex],
        station: setup.station,
        badgeName: setup.badges[badge],
        slotLabel,
      });
    }
  }

  /** A `completed` one-round game where each badge in `answers` guessed (A is correct). */
  async completedGameWithGuesses(options: {
    badges: string[];
    answers: Record<string, SlotLabel>;
  }): Promise<GameSetup> {
    const setup = await this.active({ badges: options.badges });
    await this.guessAll(setup, 0, options.answers);
    await this.api.setGameState(setup.gameId, 'completed');
    return setup;
  }
}

export const test = base.extend<{ api: Api; games: Games }>({
  api: async ({}, use) => {
    const context = await playwrightRequest.newContext({ baseURL: API_URL });
    await use(new Api(context));
    await context.dispose();
  },
  games: async ({ api }, use) => {
    await use(new Games(api, uniqueId()));
  },
});

export { expect } from '@playwright/test';
