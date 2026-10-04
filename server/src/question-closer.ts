import type { GameDataRepository } from './persistence/game-data.repository';
import type { BadgeStateService } from './badge-state.service';

export type CloseReason = 'referee' | 'all_pairs_answered' | 'player_removed';

/** Closes questions and broadcasts question.closed + question.result. */
export class QuestionCloser {
  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly badgeStateService: BadgeStateService,
  ) {}

  async closeAndNotify(gameId: string, questionId: string, reason: CloseReason): Promise<void> {
    await this.gameDataRepository.setQuestionState({
      gameId,
      questionId,
      state: 'closed',
    });
    await this.gameDataRepository.resetPairReadiness(gameId);

    const serverTime = new Date().toISOString();
    const stationNames = await this.gameDataRepository.getStationNamesByGameId(gameId);
    const gameDetail = await this.gameDataRepository.getGameDetail(gameId);
    const gameTitle = gameDetail?.title;
    const closedQuestion = gameDetail?.questions.find(
      (question) => question.id === questionId,
    );
    const isFinalRound =
      closedQuestion != null &&
      !gameDetail?.questions.some(
        (question) =>
          question.sequence > closedQuestion.sequence &&
          question.state !== 'archived',
      );
    const questionEvent = {
      type: 'question.closed' as const,
      gameId,
      ...(gameTitle ? { gameTitle } : {}),
      questionId,
      isFinalRound,
      serverTime,
    };

    console.log(
      `[GAME] server | question_closed | Question closed | questionId=${questionId}${
        gameTitle ? ` game="${gameTitle}"` : ''
      } reason=${reason}`,
    );

    this.badgeStateService.broadcastDashboard(questionEvent);
    if (stationNames.length > 0) {
      this.badgeStateService.sendToPairNames(stationNames, questionEvent);
    }

    const result = await this.gameDataRepository.computeQuestionResult(gameId, questionId);
    const resultEvent = {
      type: 'question.result' as const,
      ...result,
      serverTime,
    };
    console.log(
      `[GAME] server | question_closed | Question closed | question.result players=${result.results.length} correctSlot=${result.correctSlotLabel}`,
    );
    this.badgeStateService.broadcastDashboard(resultEvent);
    if (stationNames.length > 0) {
      this.badgeStateService.sendToPairNames(stationNames, resultEvent);
    }
  }

  /**
   * After players were unbound: close the open question if every remaining
   * joined player has already guessed.
   */
  async closeIfAllAnswered(gameId: string): Promise<boolean> {
    const questionId = await this.gameDataRepository.getOpenQuestionId(gameId);
    if (!questionId) {
      return false;
    }
    if (!(await this.gameDataRepository.haveAllJoinedPlayersGuessed(gameId, questionId))) {
      return false;
    }
    await this.closeAndNotify(gameId, questionId, 'player_removed');
    return true;
  }
}
