import type { LucideIcon } from 'lucide-react';
import {
  BookAlert,
  Circle,
  DoorOpen,
  EyeClosed,
  HandPlatter,
  MessageCircleQuestion,
  Sparkles,
  Trophy,
  Turntable,
  X,
} from 'lucide-react';
/** Platform icon visual states used on badge cards (subset of log state ids). */
export type GameVisualState =
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
  lobby: DoorOpen,
  lobby_joined: HandPlatter,
  active: Turntable,
  question_open: MessageCircleQuestion,
  correct: Circle,
  wrong: X,
  question_closed: BookAlert,
  completed: Sparkles,
  // Lucide `Podium` is not in 0.577 yet — Trophy stands in until we bump further.
  winner: Trophy,
  loser: EyeClosed,
};

/** Tailwind classes for colour variants (blue circle / red x). */
export const GAME_STATE_ICON_CLASS: Partial<Record<GameVisualState, string>> = {
  correct: 'text-blue-500',
  wrong: 'text-red-500',
  lobby: 'text-amber-500',
  active: 'text-green-600',
  question_open: 'text-amber-600',
  winner: 'text-amber-600',
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

  if (gameState === 'lobby') {
    return joined ? 'lobby_joined' : 'lobby';
  }

  if (gameState === 'active' || gameState === 'paused') {
    if (result) {
      if (result.slotLabel == null) return 'wrong';
      return result.isCorrect ? 'correct' : 'wrong';
    }
    if (typeof nfcIsCorrect === 'boolean') {
      return nfcIsCorrect ? 'correct' : 'wrong';
    }
    if (questionPhase === 'open') return 'question_open';
    if (questionPhase === 'closed') return 'question_closed';
    return 'active';
  }

  return null;
}
