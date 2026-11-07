import { BadgeStateService } from '../badge-state.service';
import { NfcCardService } from '../nfc-card.service';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import { LeitnerSetupService, previewSetup } from './leitner-setup.service';

const GAME_ID = '6650f00000000000000000f0';
const player = { id: '507f1f77bcf86cd7994390aa', firstName: 'power-cable', externalId: 'x', label: 'Player 7F3A' };

describe('LeitnerSetupService', () => {
  const badges = {
    findLiveStationForBadge: jest.fn(),
    findRosterConflicts: jest.fn(),
    broadcastDashboard: jest.fn(),
  };
  const games = {
    findBadgesInUnfinishedGames: jest.fn(),
    getLatestNfcCardGroup: jest.fn(),
    bindStation: jest.fn(),
    ensureNfcCardGroup: jest.fn(),
    assignNfcCardGroupToGame: jest.fn(),
  };
  const players = { findLastBadgeName: jest.fn(), bindPlayer: jest.fn() };
  const service = new LeitnerSetupService(
    badges as unknown as BadgeStateService,
    games as unknown as GameDataRepository,
    players as unknown as PlayerRepository,
    new NfcCardService(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    badges.findRosterConflicts.mockReturnValue([]);
    games.findBadgesInUnfinishedGames.mockResolvedValue([]);
    games.getLatestNfcCardGroup.mockResolvedValue({ groupId: 'g1', name: 'Quiz Cards A-D' });
    games.bindStation.mockImplementation(async ({ badgeNames }: { badgeNames: string[] }) => badgeNames);
    players.findLastBadgeName.mockResolvedValue('red');
  });

  it("binds the live station of the student's last badge, with the student on it", async () => {
    badges.findLiveStationForBadge.mockImplementation((name: string) =>
      name === 'red' ? { stationName: 'zero-1', badgeNames: ['red', 'blue'] } : null,
    );

    const resolved = await service.resolve(player, ['old-game']);
    expect(games.findBadgesInUnfinishedGames).toHaveBeenCalledWith(['red', 'blue'], ['old-game']);
    const setup = await service.apply(GAME_ID, player, resolved);

    expect(setup).toEqual({
      station: { stationName: 'zero-1', badgeName: 'red' },
      cardGroup: { name: 'Quiz Cards A-D' },
      notes: [],
    });
    expect(games.bindStation).toHaveBeenCalledWith({ stationName: 'zero-1', badgeNames: ['red', 'blue'], gameId: GAME_ID });
    expect(players.bindPlayer).toHaveBeenCalledWith({ gameId: GAME_ID, badgeName: 'red', playerId: player.id });
    expect(games.assignNfcCardGroupToGame).toHaveBeenCalledWith({ gameId: GAME_ID, groupId: 'g1' });
  });

  it('falls back to a badge named like the student', async () => {
    players.findLastBadgeName.mockResolvedValue(null);
    badges.findLiveStationForBadge.mockImplementation((name: string) =>
      name === 'power-cable' ? { stationName: 'power-cable', badgeNames: ['power-cable'] } : null,
    );

    const resolved = await service.resolve(player, []);
    expect(previewSetup(resolved).station).toEqual({ stationName: 'power-cable', badgeName: 'power-cable' });
  });

  it("leaves a station that's in another unfinished game alone", async () => {
    badges.findLiveStationForBadge.mockReturnValue({ stationName: 'zero-1', badgeNames: ['red'] });
    games.findBadgesInUnfinishedGames.mockResolvedValue(['red']);

    const setup = await service.apply(GAME_ID, player, await service.resolve(player, []));

    expect(setup.station).toBeNull();
    expect(setup.notes).toEqual(["zero-1 is in another game that hasn't finished, so it isn't bound."]);
    expect(games.bindStation).not.toHaveBeenCalled();
    expect(players.bindPlayer).not.toHaveBeenCalled();
  });

  it("says why when the last badge isn't live", async () => {
    badges.findLiveStationForBadge.mockReturnValue(null);

    const resolved = await service.resolve(player, []);

    expect(previewSetup(resolved)).toEqual({
      station: null,
      cardGroup: { name: 'Quiz Cards A-D' },
      notes: ["red (the student's last badge) isn't live, so no station is bound."],
    });
  });

  it('creates the demo card group when no game has used one', async () => {
    badges.findLiveStationForBadge.mockReturnValue(null);
    games.getLatestNfcCardGroup.mockResolvedValue(null);
    games.ensureNfcCardGroup.mockResolvedValue('demo');

    const setup = await service.apply(GAME_ID, player, await service.resolve(player, []));

    expect(games.ensureNfcCardGroup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Quiz Cards A-D' }));
    expect(games.assignNfcCardGroupToGame).toHaveBeenCalledWith({ gameId: GAME_ID, groupId: 'demo' });
    expect(setup.cardGroup).toEqual({ name: 'Quiz Cards A-D' });
  });

  it("keeps the game when binding fails, and says so", async () => {
    badges.findLiveStationForBadge.mockReturnValue({ stationName: 'zero-1', badgeNames: ['red'] });
    games.bindStation.mockRejectedValue(new Error('boom'));

    const setup = await service.apply(GAME_ID, player, await service.resolve(player, []));

    expect(setup.station).toBeNull();
    expect(setup.notes).toEqual(['Could not bind zero-1; bind it in Referee Controls.']);
    expect(setup.cardGroup).toEqual({ name: 'Quiz Cards A-D' });
  });
});
