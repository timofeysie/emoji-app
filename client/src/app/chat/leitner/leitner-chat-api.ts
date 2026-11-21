import { authFetch } from '../../auth/authFetch';
import {
  errorBody,
  leitnerRefusal,
  type LeitnerRefusal,
  type LeitnerScope,
  type LeitnerSetup,
  type Plan,
  type Player,
} from '../../views/leitner';

/** What the chat asks `POST /api/leitner-games` for (docs/hashbrown, H3). */
export type LeitnerGameRequest = {
  playerId: string;
  book: string;
  chapter: string;
  scope: LeitnerScope;
  aspects: string[];
  /** A dry run's seed and time: the server plans the same game again. */
  seed?: number;
  now?: string;
};

export class LeitnerRefusedError extends Error {
  constructor(
    public readonly status: number,
    public readonly refusal: LeitnerRefusal,
    /** A 422 "nothing to ask" carries the plan, so the card can show why. */
    public readonly plan: Plan | null,
  ) {
    super(refusal.message);
  }
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await authFetch('/api/leitner-games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const error = await errorBody(res);
    throw new LeitnerRefusedError(res.status, leitnerRefusal(res.status, error), (error['plan'] as Plan | undefined) ?? null);
  }
  return (await res.json()) as T;
}

/** The plan only: nothing is created or deleted. */
export function planLeitnerGame(request: LeitnerGameRequest): Promise<{ plan: Plan; setup?: LeitnerSetup }> {
  return post({ ...request, dryRun: true });
}

/** Creates the game (superseding the student's unplayed ones) and presets their station. */
export function createLeitnerGame(request: LeitnerGameRequest): Promise<{ gameId: string; plan: Plan; setup?: LeitnerSetup }> {
  return post({ ...request });
}

export async function listPlayers(): Promise<Player[]> {
  const res = await authFetch('/api/players', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load the players (${res.status}).`);
  return ((await res.json()) as { players: Player[] }).players;
}
