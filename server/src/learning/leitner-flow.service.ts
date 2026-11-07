import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { BadgeStateService, type RealtimeEvent } from '../badge-state.service';
import { GameDataRepository, type GameDetail } from '../persistence/game-data.repository';

/** Shown in the student view before the first round (and after Resume). */
export const LEITNER_START_COUNTDOWN_MS = 5_000;
/** The student view's answer reveal (`REVEAL_MS` in GamePlayView): the next round opens when it ends. */
export const LEITNER_REVEAL_MS = 5_000;

function log(gameId: string, message: string): void {
  console.log(`[GAME] server | leitner_flow | gameId=${gameId} ${message}`);
}

/** `start`: the game is starting (or resuming). `next`: the previous round's reveal is running. */
export type LeitnerCountdownReason = 'start' | 'next';

export type LeitnerCountdown = { reason: LeitnerCountdownReason; opensAt: string; opensInMs: number };

/** `end`: the final round's reveal is running; the game ends after it. */
type ScheduledReason = LeitnerCountdownReason | 'end';

type Scheduled = { timer: ReturnType<typeof setTimeout>; reason: ScheduledReason; opensAt: number };

/** Ends a game the way the referee's End Game does (scores, badges, export). */
export type LeitnerAutoEnd = (gameId: string) => Promise<void>;

/**
 * Continuous flow for solo Leitner games (docs/xAPI/leitner-method.md →
 * Continuous flow): rounds open by themselves, after a countdown when the
 * game starts or resumes, and after the answer reveal when a round
 * closes. After the final round's reveal the game ends by itself.
 * Countdowns go to the dashboard and the game's stations (the badge pulses
 * each second). Class games keep the referee opening each round.
 *
 * Timers live in memory: a server restart drops them, and the referee can
 * still open the next round by hand.
 */
@Injectable()
export class LeitnerFlowService implements OnModuleDestroy {
  private readonly logger = new Logger(LeitnerFlowService.name);
  private readonly scheduled = new Map<string, Scheduled>();
  private autoEnd: LeitnerAutoEnd | null = null;

  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly badgeStateService: BadgeStateService,
  ) {}

  /** Set by GameFlowController, which owns the End Game transition. */
  setAutoEnd(autoEnd: LeitnerAutoEnd): void {
    this.autoEnd = autoEnd;
  }

  onModuleDestroy(): void {
    for (const gameId of [...this.scheduled.keys()]) this.cancel(gameId);
  }

  /** After a game state change: count down into the first open round, or stop. */
  onGameState(game: Pick<GameDetail, 'id' | 'kind' | 'questions'> | null, state: string): void {
    if (!game || game.kind !== 'leitner-solo') return;
    if (state !== 'active') {
      if (this.scheduled.has(game.id)) log(game.id, `countdown cancelled: game ${state}`);
      this.cancel(game.id);
      return;
    }
    if (game.questions.some((question) => question.state === 'open')) {
      log(game.id, 'no start countdown: a round is already open');
      return;
    }
    this.schedule(game.id, 'start', LEITNER_START_COUNTDOWN_MS);
  }

  /** After a round closed (any reason): the next one opens, or the game ends, when the reveal ends. */
  onQuestionClosed(game: Pick<GameDetail, 'id' | 'kind' | 'state'> | null, isFinalRound: boolean): void {
    if (!game || game.kind !== 'leitner-solo') return;
    if (game.state !== 'active') {
      log(game.id, `no next round: game ${game.state}`);
      return;
    }
    if (isFinalRound) {
      if (!this.autoEnd) {
        log(game.id, 'no next round: that was the final round');
        return;
      }
      this.schedule(game.id, 'end', LEITNER_REVEAL_MS);
      return;
    }
    this.schedule(game.id, 'next', LEITNER_REVEAL_MS);
  }

  /** The pending countdown, for the play view after a reload. */
  countdown(gameId: string, now = Date.now()): LeitnerCountdown | null {
    const entry = this.scheduled.get(gameId);
    if (!entry || entry.reason === 'end') return null;
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

  private schedule(gameId: string, reason: ScheduledReason, delayMs: number): void {
    this.cancel(gameId);
    const opensAt = Date.now() + delayMs;
    const timer = setTimeout(() => {
      this.scheduled.delete(gameId);
      void (reason === 'end' ? this.end(gameId) : this.openNext(gameId));
    }, delayMs);
    timer.unref?.();
    this.scheduled.set(gameId, { timer, reason, opensAt });
    if (reason === 'end') {
      log(gameId, `final round closed: game ends in ${delayMs}ms`);
      return;
    }
    log(gameId, `countdown ${reason}: next round opens in ${delayMs}ms`);
    const event = {
      type: 'question.countdown' as const,
      gameId,
      reason,
      opensAt: new Date(opensAt).toISOString(),
      opensInMs: delayMs,
      serverTime: new Date().toISOString(),
    };
    this.badgeStateService.broadcastDashboard(event);
    void this.sendToStations(gameId, event);
  }

  /** The badge counts down too (a tone pulse each second). */
  private async sendToStations(gameId: string, event: RealtimeEvent): Promise<void> {
    try {
      const stationNames = await this.gameDataRepository.getStationNamesByGameId(gameId);
      if (stationNames.length > 0) this.badgeStateService.sendToPairNames(stationNames, event);
    } catch (error) {
      this.logger.warn(`Could not send the countdown to game ${gameId}'s stations: ${String(error)}`);
    }
  }

  /** Ends the game after the final round's reveal, if it's still being played. */
  private async end(gameId: string): Promise<void> {
    try {
      const game = await this.gameDataRepository.getGameDetail(gameId);
      if (!game || game.kind !== 'leitner-solo' || game.state !== 'active') {
        log(gameId, `reveal ended, not ended automatically: game ${game ? game.state : 'gone'}`);
        return;
      }
      log(gameId, 'final reveal ended: ending the game');
      await this.autoEnd?.(gameId);
    } catch (error) {
      this.logger.error(`Leitner auto-end failed for game ${gameId}`, error as Error);
    }
  }

  /** Opens the next unplayed round, if the game is still being played. */
  private async openNext(gameId: string): Promise<void> {
    try {
      const game = await this.gameDataRepository.getGameDetail(gameId);
      if (!game || game.kind !== 'leitner-solo' || game.state !== 'active') {
        log(gameId, `countdown ended, nothing opened: game ${game ? game.state : 'gone'}`);
        return;
      }
      const questionId = await this.gameDataRepository.openNextUnplayedQuestion(gameId);
      if (!questionId) {
        log(gameId, 'countdown ended, nothing opened: a round is already open or none are left');
        return;
      }
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
