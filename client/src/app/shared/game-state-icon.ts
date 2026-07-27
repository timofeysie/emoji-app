import type { LucideIcon } from 'lucide-react';
import {
  BookAlert,
  Circle,
  DoorOpen,
  EyeClosed,
  Gamepad2,
  HandPlatter,
  MessageCircleQuestion,
  Sparkles,
  Square,
  Trophy,
  X,
} from 'lucide-react';

/** Platform icon visual states used on badge cards (subset of log state ids). */
export type GameVisualState =
  | 'ready'
  | 'lobby'
  | 'lobby_joined'
  | 'active'
  | 'question_open'
  | 'correct'
  | 'wrong'
  | 'question_closed'
  | 'completed'
  | 'winner'
  | 'loser';

export const GAME_STATE_ICONS: Record<GameVisualState, LucideIcon> = {
  // Standby "G" on devices — Gamepad stands in on the dashboard card.
  ready: Gamepad2,
  lobby: DoorOpen,
  lobby_joined: HandPlatter,
  // Platform: solid green 4×4 centre square
  active: Square,
  question_open: MessageCircleQuestion,
  // Platform: blue filled circle
  correct: Circle,
  // Platform: red X
  wrong: X,
  question_closed: BookAlert,
  completed: Sparkles,
  // Lucide `Podium` is not in 0.577 yet — Trophy stands in until we bump further.
  winner: Trophy,
  loser: EyeClosed,
};

/** Short card labels (Platform icon / display reference). */
export const GAME_STATE_SHORT_LABELS: Record<GameVisualState, string> = {
  ready: 'Ready',
  lobby: 'Lobby',
  lobby_joined: 'Joined',
  active: 'Active',
  question_open: 'Question open',
  correct: 'Correct',
  wrong: 'Wrong',
  question_closed: 'Question closed',
  completed: 'Game over',
  winner: 'Winner',
  loser: 'Loser',
};

/** Tailwind classes for colour variants (blue circle / red x / green square). */
export const GAME_STATE_ICON_CLASS: Partial<Record<GameVisualState, string>> = {
  // Filled glyphs so correct/wrong/active are unmistakable at card size.
  correct: 'text-blue-500 fill-blue-500',
  wrong: 'text-red-500',
  ready: 'text-emerald-600',
  lobby: 'text-amber-500',
  lobby_joined: 'text-amber-600',
  active: 'text-green-600 fill-green-600',
  question_open: 'text-amber-600',
  question_closed: 'text-slate-600',
  winner: 'text-amber-600',
  loser: 'text-slate-500',
};

export type QuestionResultEntry = {
  slotLabel: string | null;
  isCorrect: boolean;
};

/**
 * Derive the Platform icon state for one badge pair from live WS slices.
 */
export function resolvePairVisualState(input: {
  gameState?: string | null;
  joined: boolean;
  questionPhase: 'none' | 'open' | 'closed';
  nfcIsCorrect?: boolean | null;
  result?: QuestionResultEntry | null;
  winnerPairNames?: Set<string> | null;
  pairName?: string;
}): GameVisualState | null {
  const {
    gameState,
    joined,
    questionPhase,
    nfcIsCorrect,
    result,
    winnerPairNames,
    pairName,
  } = input;

  if (!gameState) return null;

  if (gameState === 'completed' || gameState === 'cancelled') {
    if (pairName && winnerPairNames) {
      return winnerPairNames.has(pairName) ? 'winner' : 'loser';
    }
    return 'completed';
  }

  if (gameState === 'ready' || gameState === 'draft') {
    return 'ready';
  }

  if (gameState === 'lobby') {
    return joined ? 'lobby_joined' : 'lobby';
  }

  if (gameState === 'active' || gameState === 'paused') {
    // Answer outcome wins over phase — including after auto-close, while the
    // green "active" square must not replace a red X / blue circle.
    if (typeof nfcIsCorrect === 'boolean') {
      return nfcIsCorrect ? 'correct' : 'wrong';
    }
    if (result) {
      if (result.slotLabel == null) return 'wrong';
      return result.isCorrect === true ? 'correct' : 'wrong';
    }
    if (questionPhase === 'open') return 'question_open';
    if (questionPhase === 'closed') return 'question_closed';
    return 'active';
  }

  return null;
}
