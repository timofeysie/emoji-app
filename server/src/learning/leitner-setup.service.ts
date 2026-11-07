import { Injectable, Logger } from '@nestjs/common';
import { BadgeStateService } from '../badge-state.service';
import { NfcCardService } from '../nfc-card.service';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository, type PlayerSummary } from '../persistence/player.repository';
import { broadcastBindingsChanged } from '../station-roster-sync';

/**
 * What a new Leitner game is preset with, so the referee can open it for
 * joining straight away: the student's station bound with the student on
 * their badge, and an NFC card group. Null parts are left to the referee;
 * `notes` says why.
 */
export type LeitnerSetup = {
  station: { stationName: string; badgeName: string } | null;
  cardGroup: { name: string } | null;
  notes: string[];
};

type ResolvedSetup = {
  station: { stationName: string; badgeName: string; badgeNames: string[] } | null;
  /** groupId null: the demo group, created when applied. */
  cardGroup: { groupId: string | null; name: string };
  notes: string[];
};

/** docs/xAPI/leitner-method.md → Referee flow (presets). */
@Injectable()
export class LeitnerSetupService {
  private readonly logger = new Logger(LeitnerSetupService.name);

  constructor(
    private readonly badgeStateService: BadgeStateService,
    private readonly gameDataRepository: GameDataRepository,
    private readonly playerRepository: PlayerRepository,
    private readonly nfcCardService: NfcCardService,
  ) {}

  /**
   * The student's badge: the one they were last bound to, else a badge named
   * like them (badge names double as nicknames). Only a live station that no
   * unfinished game holds is preset; `ignoreGameIds` are games being replaced.
   */
  async resolve(player: PlayerSummary, ignoreGameIds: string[]): Promise<ResolvedSetup> {
    const notes: string[] = [];
    const lastBadge = await this.playerRepository.findLastBadgeName(player.id);
    const candidates = [...new Set([lastBadge, player.firstName].filter((name): name is string => Boolean(name)))];

    let station: ResolvedSetup['station'] = null;
    const checked = new Set<string>();
    for (const badgeName of candidates) {
      const live = this.badgeStateService.findLiveStationForBadge(badgeName);
      if (!live || checked.has(live.stationName)) continue;
      checked.add(live.stationName);
      if (this.badgeStateService.findRosterConflicts(live.stationName, live.badgeNames).length > 0) continue;
      const busy = await this.gameDataRepository.findBadgesInUnfinishedGames(live.badgeNames, ignoreGameIds);
      if (busy.length > 0) {
        notes.push(`${live.stationName} is in another game that hasn't finished, so it isn't bound.`);
        continue;
      }
      station = { stationName: live.stationName, badgeName, badgeNames: live.badgeNames };
      break;
    }
    if (!station && notes.length === 0) {
      notes.push(
        lastBadge
          ? `${lastBadge} (the student's last badge) isn't live, so no station is bound.`
          : 'No badge is known for this student yet, so no station is bound.',
      );
    }

    const latest = await this.gameDataRepository.getLatestNfcCardGroup();
    const cardGroup = latest ?? { groupId: null, name: this.nfcCardService.demoGroupInput().name };
    return { station, cardGroup, notes };
  }

  /** Applies a resolved setup to a new game. Failures become notes: the game is already made. */
  async apply(gameId: string, player: PlayerSummary, resolved: ResolvedSetup): Promise<LeitnerSetup> {
    const notes = [...resolved.notes];
    let station: LeitnerSetup['station'] = null;
    if (resolved.station) {
      const { stationName, badgeName, badgeNames } = resolved.station;
      try {
        const added = await this.gameDataRepository.bindStation({ stationName, badgeNames, gameId });
        broadcastBindingsChanged(this.badgeStateService, { gameId, stationName, added });
        await this.playerRepository.bindPlayer({ gameId, badgeName, playerId: player.id });
        broadcastBindingsChanged(this.badgeStateService, { gameId });
        station = { stationName, badgeName };
      } catch (error) {
        this.logger.warn(`Could not preset ${stationName} for Leitner game ${gameId}: ${String(error)}`);
        notes.push(`Could not bind ${stationName}; bind it in Referee Controls.`);
      }
    }

    let cardGroup: LeitnerSetup['cardGroup'] = null;
    try {
      const groupId =
        resolved.cardGroup.groupId ??
        (await this.gameDataRepository.ensureNfcCardGroup(this.nfcCardService.demoGroupInput()));
      await this.gameDataRepository.assignNfcCardGroupToGame({ gameId, groupId });
      cardGroup = { name: resolved.cardGroup.name };
    } catch (error) {
      this.logger.warn(`Could not assign a card group to Leitner game ${gameId}: ${String(error)}`);
      notes.push('Could not assign a card group; assign one in Referee Controls.');
    }
    return { station, cardGroup, notes };
  }
}

/** The dry run's view of a resolved setup: what Create will preset. */
export function previewSetup(resolved: ResolvedSetup): LeitnerSetup {
  return {
    station: resolved.station && { stationName: resolved.station.stationName, badgeName: resolved.station.badgeName },
    cardGroup: { name: resolved.cardGroup.name },
    notes: resolved.notes,
  };
}
