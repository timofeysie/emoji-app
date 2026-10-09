import { Types } from 'mongoose';
import { MongoService } from './mongo.service';
import { bindingAt, PlayerNotFoundError, PlayerRepository, playerLabel } from './player.repository';

const GAME_ID = '507f1f77bcf86cd799439011';
const PLAYER_A = new Types.ObjectId('507f1f77bcf86cd7994390aa');
const PLAYER_B = new Types.ObjectId('507f1f77bcf86cd7994390bb');

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 9, 9, 10, minute));
}

function createLeanQuery<T>(value: T): { lean: jest.Mock; sort: jest.Mock } {
  const query = {
    lean: jest.fn().mockResolvedValue(value),
    sort: jest.fn(),
  };
  query.sort.mockReturnValue(query);
  return query;
}

describe('bindingAt', () => {
  it('returns null when the badge was never bound', () => {
    expect(bindingAt([], at(5))).toBeNull();
  });

  it('lets the first binding cover guesses made before it', () => {
    const first = { assignedAt: at(30), unassignedAt: null };
    expect(bindingAt([first], at(5))).toBe(first);
  });

  it('keeps earlier guesses with the earlier holder after a swap', () => {
    const first = { assignedAt: at(0), unassignedAt: at(20) };
    const second = { assignedAt: at(20), unassignedAt: null };
    expect(bindingAt([second, first], at(10))).toBe(first);
    expect(bindingAt([second, first], at(20))).toBe(second);
    expect(bindingAt([second, first], at(40))).toBe(second);
  });

  it('returns null for a guess after the badge was unbound', () => {
    const only = { assignedAt: at(0), unassignedAt: at(20) };
    expect(bindingAt([only], at(25))).toBeNull();
  });

  it('returns null in a gap between bindings', () => {
    const first = { assignedAt: at(0), unassignedAt: at(10) };
    const second = { assignedAt: at(20), unassignedAt: null };
    expect(bindingAt([first, second], at(15))).toBeNull();
  });
});

describe('playerLabel', () => {
  it('uses the first four hex digits', () => {
    expect(playerLabel('7f3a91c2-0000-4000-8000-000000000000')).toBe('Player 7F3A');
  });
});

describe('PlayerRepository', () => {
  const models = {
    Game: { findById: jest.fn(), exists: jest.fn() },
    Guess: { find: jest.fn(), exists: jest.fn() },
    PairBinding: { find: jest.fn(), exists: jest.fn() },
    Player: { create: jest.fn(), find: jest.fn(), findById: jest.fn() },
    PlayerBinding: {
      find: jest.fn(),
      findOne: jest.fn(),
      exists: jest.fn(),
      updateMany: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    },
  };
  const mongoService = { getModels: jest.fn() } as unknown as MongoService;
  const repository = new PlayerRepository(mongoService);

  beforeEach(() => {
    jest.clearAllMocks();
    (mongoService.getModels as jest.Mock).mockReturnValue(models);
  });

  describe('createPlayer', () => {
    it('stores only a first name and a random UUID v4 external ID', async () => {
      models.Player.create.mockImplementation(async (doc: Record<string, unknown>) => ({
        _id: PLAYER_A,
        ...doc,
      }));

      const player = await repository.createPlayer({ firstName: 'Mia' });

      const stored = models.Player.create.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(stored).sort()).toEqual(['externalId', 'firstName']);
      expect(stored['externalId']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(player).toEqual({
        id: PLAYER_A.toString(),
        firstName: 'Mia',
        externalId: stored['externalId'],
        label: playerLabel(stored['externalId'] as string),
      });
    });
  });

  describe('bindPlayer', () => {
    const playerDoc = { _id: PLAYER_A, firstName: 'Mia', externalId: '7f3a91c2-0000-4000-8000-000000000000' };

    beforeEach(() => {
      models.Player.findById.mockReturnValue(createLeanQuery(playerDoc));
      models.Game.exists.mockResolvedValue({ _id: GAME_ID });
      models.PairBinding.exists.mockResolvedValue({ _id: 'x' });
      models.Guess.exists.mockResolvedValue(null);
      models.PlayerBinding.updateMany.mockResolvedValue({ modifiedCount: 0 });
      models.PlayerBinding.create.mockImplementation(async (doc: Record<string, unknown>) => ({
        _id: new Types.ObjectId(),
        unassignedAt: null,
        ...doc,
      }));
    });

    it("binds a badge's first player with reason initial", async () => {
      models.PlayerBinding.findOne.mockReturnValue(createLeanQuery(null));
      models.PlayerBinding.exists.mockResolvedValue(null);

      const binding = await repository.bindPlayer({
        gameId: GAME_ID,
        badgeName: 'red',
        playerId: PLAYER_A.toString(),
      });

      expect(binding.reason).toBe('initial');
      expect(binding.player.firstName).toBe('Mia');
      expect(models.PlayerBinding.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          unassignedAt: null,
          $or: [{ badgeName: 'red' }, { playerId: PLAYER_A }],
        }),
        { $set: { unassignedAt: expect.any(Date) } },
      );
    });

    it('ends the previous holder and records a swap', async () => {
      models.PlayerBinding.findOne.mockReturnValue(
        createLeanQuery({ _id: new Types.ObjectId(), playerId: PLAYER_B }),
      );
      models.PlayerBinding.exists.mockResolvedValue({ _id: 'y' });

      const binding = await repository.bindPlayer({
        gameId: GAME_ID,
        badgeName: 'red',
        playerId: PLAYER_A.toString(),
      });

      expect(binding.reason).toBe('swap');
      const [ended] = models.PlayerBinding.updateMany.mock.calls[0] as [unknown, { $set: { unassignedAt: Date } }];
      expect(ended).toBeDefined();
      const created = models.PlayerBinding.create.mock.calls[0][0] as { assignedAt: Date };
      expect(created.assignedAt).toEqual(
        (models.PlayerBinding.updateMany.mock.calls[0][1] as { $set: { unassignedAt: Date } }).$set
          .unassignedAt,
      );
    });

    it('is a no-op when the badge is already bound to that player', async () => {
      models.PlayerBinding.findOne.mockReturnValue(
        createLeanQuery({
          _id: new Types.ObjectId(),
          playerId: PLAYER_A,
          badgeName: 'red',
          assignedAt: at(0),
          unassignedAt: null,
          reason: 'initial',
        }),
      );

      await repository.bindPlayer({ gameId: GAME_ID, badgeName: 'red', playerId: PLAYER_A.toString() });

      expect(models.PlayerBinding.updateMany).not.toHaveBeenCalled();
      expect(models.PlayerBinding.create).not.toHaveBeenCalled();
    });

    it('rejects a badge that is not part of the game', async () => {
      models.PairBinding.exists.mockResolvedValue(null);

      await expect(
        repository.bindPlayer({ gameId: GAME_ID, badgeName: 'nope', playerId: PLAYER_A.toString() }),
      ).rejects.toBeInstanceOf(PlayerNotFoundError);
    });

    it('rejects an unknown player', async () => {
      models.Player.findById.mockReturnValue(createLeanQuery(null));

      await expect(
        repository.bindPlayer({ gameId: GAME_ID, badgeName: 'red', playerId: PLAYER_A.toString() }),
      ).rejects.toBeInstanceOf(PlayerNotFoundError);
    });
  });

  describe('getGamePlayerBindings', () => {
    it('lists badges whose guesses no binding covers', async () => {
      models.Game.findById.mockReturnValue(createLeanQuery({ _id: GAME_ID, startedAt: at(0) }));
      models.Guess.find.mockReturnValue(
        createLeanQuery([
          { pairName: 'red', createdAt: at(5) },
          { pairName: 'blue', createdAt: at(6) },
          // red was unbound at minute 20 and nobody took it over
          { pairName: 'red', createdAt: at(25) },
        ]),
      );
      models.PairBinding.find.mockReturnValue(
        createLeanQuery([{ pairName: 'red' }, { pairName: 'blue' }, { pairName: 'green' }]),
      );
      models.PlayerBinding.find.mockReturnValue(
        createLeanQuery([
          {
            _id: new Types.ObjectId(),
            badgeName: 'red',
            playerId: PLAYER_A,
            assignedAt: at(1),
            unassignedAt: at(20),
            reason: 'initial',
          },
        ]),
      );
      models.Player.find.mockReturnValue(
        createLeanQuery([{ _id: PLAYER_A, firstName: 'Mia', externalId: 'abcd1234-0000-4000-8000-000000000000' }]),
      );

      const result = await repository.getGamePlayerBindings(GAME_ID);

      expect(models.Guess.find).toHaveBeenCalledWith(
        { gameId: expect.anything(), createdAt: { $gte: at(0) } },
        expect.anything(),
      );
      expect(result.badgeNames).toEqual(['blue', 'green', 'red']);
      expect(result.missingBadges).toEqual(['blue', 'red']);
      expect(result.bindings).toHaveLength(1);
      expect(result.bindings[0].player.label).toBe('Player ABCD');
    });
  });
});
