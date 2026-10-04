import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BadgeStateService } from './badge-state.service';
import {
  GameDataRepository,
  type StationRosterChange,
} from './persistence/game-data.repository';
import { QuestionCloser } from './question-closer';

/** Tell dashboards a game's bindings changed so they refetch it. */
export function broadcastBindingsChanged(
  badgeStateService: BadgeStateService,
  change: { gameId: string; stationName?: string; added?: string[]; removed?: string[] },
): void {
  badgeStateService.broadcastDashboard({
    type: 'game.bindings.changed',
    gameId: change.gameId,
    ...(change.stationName ? { stationName: change.stationName } : {}),
    added: change.added ?? [],
    removed: change.removed ?? [],
    serverTime: new Date().toISOString(),
  });
}

/** Log a roster sync and broadcast it when bindings changed. */
export function reportRosterChange(
  badgeStateService: BadgeStateService,
  change: StationRosterChange,
  logger: Pick<Logger, 'log' | 'warn'>,
): void {
  if (change.skipped.length > 0) {
    logger.warn(
      `Station '${change.stationName}' roster names bound to another station were skipped: ${change.skipped.join(', ')}`,
    );
  }
  if (change.added.length === 0 && change.removed.length === 0) {
    return;
  }
  logger.log(
    `Station '${change.stationName}' game=${change.gameId} roster sync added=[${change.added.join(', ')}] removed=[${change.removed.join(', ')}]`,
  );
  broadcastBindingsChanged(badgeStateService, change);
}

/** Keeps each bound station's player bindings in step with its live roster. */
@Injectable()
export class StationRosterSync implements OnModuleInit {
  private readonly logger = new Logger(StationRosterSync.name);

  private readonly questionCloser: QuestionCloser;

  constructor(
    private readonly badgeStateService: BadgeStateService,
    private readonly gameDataRepository: GameDataRepository,
  ) {
    this.questionCloser = new QuestionCloser(gameDataRepository, badgeStateService);
  }

  onModuleInit(): void {
    this.badgeStateService.onRosterChanged((stationName, badgeNames) => {
      void this.sync(stationName, badgeNames);
    });
  }

  async sync(stationName: string, badgeNames: string[]): Promise<StationRosterChange[]> {
    try {
      const changes = await this.gameDataRepository.syncStationRoster({ stationName, badgeNames });
      for (const change of changes) {
        reportRosterChange(this.badgeStateService, change, this.logger);
        if (change.removed.length > 0) {
          await this.questionCloser.closeIfAllAnswered(change.gameId);
        }
      }
      return changes;
    } catch (error) {
      this.logger.warn(`Roster sync failed for station '${stationName}': ${String(error)}`);
      return [];
    }
  }
}
