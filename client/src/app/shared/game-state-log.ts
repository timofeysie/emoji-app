/**
 * Shared game-state logging — Platform icon / display reference
 * (rainbow-connection/.../multiplayer-mode.md).
 *
 * Format: [GAME] react | <state_id> | <label> | <detail>
 */

export const GAME_STATE_LABELS = {
  draft: 'Draft — setup',
  ready: 'Ready — standby (G)',
  lobby: 'Lobby — not yet joined',
  lobby_joined: 'Lobby — joined, waiting',
  active: 'Game started / active',
  question_open: 'Question open',
  card_scanned: 'Card scanned',
  correct: 'Correct answer',
  wrong: 'Wrong answer',
  question_closed: 'Question closed',
  game_ended: 'Game ended',
  winner: 'Game winner',
  loser: 'Game loser',
} as const;

export type GameVisualStateId = keyof typeof GAME_STATE_LABELS;

/** `game="Title" gameId=…` for console detail strings. */
export function gameLogRef(game: {
  id?: string | null;
  title?: string | null;
}): string {
  const id = game.id?.trim();
  const title = game.title?.trim();
  if (title && id) {
    return `game="${title}" gameId=${id}`;
  }
  if (title) {
    return `game="${title}"`;
  }
  if (id) {
    return `gameId=${id}`;
  }
  return 'game=?';
}

export function logGameState(
  stateId: GameVisualStateId | string,
  detail?: string,
): void {
  const label =
    stateId in GAME_STATE_LABELS
      ? GAME_STATE_LABELS[stateId as GameVisualStateId]
      : stateId;
  const line = detail
    ? `[GAME] react | ${stateId} | ${label} | ${detail}`
    : `[GAME] react | ${stateId} | ${label}`;
  console.log(line);
}

/** Map server game.state values to Platform icon state ids where possible. */
export function logFromServerGameState(
  serverState: string,
  detail?: string,
): void {
  const map: Record<string, GameVisualStateId> = {
    draft: 'draft',
    ready: 'ready',
    lobby: 'lobby',
    active: 'active',
    completed: 'game_ended',
  };
  const stateId = map[serverState];
  if (stateId) {
    logGameState(stateId, detail ?? `server state=${serverState}`);
  }
}
