import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { BadgeStateService } from '../badge-state.service';
import { GameDataRepository, type GameDetail } from '../persistence/game-data.repository';

/** Shown in the student view before the first round (and after Resume). */
export const LEITNER_START_COUNTDOWN_MS = 5_000;
/** The student view's answer reveal (`REVEAL_MS` in GamePlayView): the next round opens when it ends. */
export const LEITNER_REVEAL_MS = 5_000;

/** `start`: the game is starting (or resuming). `next`: the previous round's reveal is running. */
export type LeitnerCountdownReason = 'start' | 'next';

export type LeitnerCountdown = { reason: LeitnerCountdownReason; opensAt: string; opensInMs: number };

type Scheduled = { timer: ReturnType<typeof setTimeout>; reason: LeitnerCountdownReason; opensAt: number };

/**
 * Continuous flow for solo Leitner games (docs/xAPI/leitner-method.md →
 * Continuous flow): rounds open by themselves, after a countdown when the
 * game starts or resumes, and after the answer reveal when a round
 * closes. Class games keep the referee opening each round.
 *
 * Timers live in memory: a server restart drops them, and the referee can
 * still open the next round by hand.
 */
@Injectable()
export class LeitnerFlowService implements OnModuleDestroy {
  private readonly logger = new Logger(LeitnerFlowService.name);
  private readonly scheduled = new Map<string, Scheduled>();

  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly badgeStateService: BadgeStateService,
  ) {}

  onModuleDestroy(): void {
    for (const gameId of [...this.scheduled.keys()]) this.cancel(gameId);
  }

  /** After a game state change: count down into the first open round, or stop. */
  onGameState(game: Pick<GameDetail, 'id' | 'kind' | 'questions'> | null, state: string): void {
    if (!game || game.kind !== 'leitner-solo') return;
    if (state !== 'active') {
      this.cancel(game.id);
      return;
    }
    if (game.questions.some((question) => question.state === 'open')) return;
    this.schedule(game.id, 'start', LEITNER_START_COUNTDOWN_MS);
  }

  /** After a round closed (any reason): the next one opens when the reveal ends. */
  onQuestionClosed(game: Pick<GameDetail, 'id' | 'kind' | 'state'> | null, isFinalRound: boolean): void {
    if (!game || game.kind !== 'leitner-solo' || game.state !== 'active' || isFinalRound) return;
    this.schedule(game.id, 'next', LEITNER_REVEAL_MS);
  }

  /** The pending countdown, for the play view after a reload. */
  countdown(gameId: string, now = Date.now()): LeitnerCountdown | null {
    const entry = this.scheduled.get(gameId);
    if (!entry) return null;
    return {
      reason: entry.reason,
      opensAt: new Date(entry.opensAt).toISOString(),
      opensInMs: Math.max(0, entry.opensAt - now),
    };
  }

  cancel(gameId: string): void {
    const entry = this.scheduled.get(gameId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.scheduled.delete(gameId);
  }

  private schedule(gameId: string, reason: LeitnerCountdownReason, delayMs: number): void {
    this.cancel(gameId);
    const opensAt = Date.now() + delayMs;
    const timer = setTimeout(() => {
      this.scheduled.delete(gameId);
      void this.openNext(gameId);
    }, delayMs);
    timer.unref?.();
    this.scheduled.set(gameId, { timer, reason, opensAt });
    this.badgeStateService.broadcastDashboard({
      type: 'question.countdown',
      gameId,
      reason,
      opensAt: new Date(opensAt).toISOString(),
      opensInMs: delayMs,
      serverTime: new Date().toISOString(),
    });
  }

  /** Opens the next unplayed round, if the game is still being played. */
  private async openNext(gameId: string): Promise<void> {
    try {
      const game = await this.gameDataRepository.getGameDetail(gameId);
      if (!game || game.kind !== 'leitner-solo' || game.state !== 'active') return;
      const questionId = await this.gameDataRepository.openNextUnplayedQuestion(gameId);
      if (!questionId) return;
      const questionEvent = {
        type: 'question.opened' as const,
        gameId,
        gameTitle: game.title,
        questionId,
        serverTime: new Date().toISOString(),
      };
      console.log(`[GAME] server | question_open | Question open | leitner auto questionId=${questionId} game="${game.title}"`);
      this.badgeStateService.broadcastDashboard(questionEvent);
      const stationNames = await this.gameDataRepository.getStationNamesByGameId(gameId);
      if (stationNames.length > 0) {
        this.badgeStateService.sendToPairNames(stationNames, questionEvent);
      }
    } catch (error) {
      this.logger.error(`Leitner auto-open failed for game ${gameId}`, error as Error);
    }
  }
}
