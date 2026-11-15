import { Types } from 'mongoose';
import { MongoService } from './mongo.service';
import { PlayerAlreadyLinkedError, UserRepository } from './user.repository';

const USER_ID = new Types.ObjectId('507f1f77bcf86cd7994390cc');
const PLAYER_ID = new Types.ObjectId('507f1f77bcf86cd7994390aa');

function leanResult<T>(value: T): { lean: jest.Mock } {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('UserRepository', () => {
  const User = { findOneAndUpdate: jest.fn(), findByIdAndUpdate: jest.fn() };
  const mongo = { getModels: () => ({ User }) } as unknown as MongoService;
  const repository = new UserRepository(mongo);

  it('creates the user for a new Cognito sub, keyed by sub only', async () => {
    User.findOneAndUpdate.mockReturnValue(leanResult({ _id: USER_ID, displayName: 'timo', playerId: null }));

    await expect(repository.upsertFromAuth({ sub: 'sub-1', username: 'timo' })).resolves.toEqual({
      id: USER_ID.toString(),
      displayName: 'timo',
      playerId: null,
      yallaFormat: null,
    });
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { authProviderId: 'sub-1' },
      { $setOnInsert: { authProviderId: 'sub-1', displayName: 'timo' } },
      { upsert: true, returnDocument: 'after' },
    );
  });

  it('links a player', async () => {
    User.findByIdAndUpdate.mockReturnValue(leanResult({ _id: USER_ID, displayName: 'timo', playerId: PLAYER_ID }));

    const user = await repository.setPlayer(USER_ID.toString(), PLAYER_ID.toString());

    expect(user.playerId).toBe(PLAYER_ID.toString());
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(USER_ID, { $set: { playerId: PLAYER_ID } }, { returnDocument: 'after' });
  });

  it('unlinks with null', async () => {
    User.findByIdAndUpdate.mockReturnValue(leanResult({ _id: USER_ID, displayName: 'timo', playerId: null }));

    await expect(repository.setPlayer(USER_ID.toString(), null)).resolves.toMatchObject({ playerId: null });
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(USER_ID, { $set: { playerId: null } }, { returnDocument: 'after' });
  });

  it('refuses a player another user already practises as', async () => {
    User.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockRejectedValue({ code: 11000 }) });

    await expect(repository.setPlayer(USER_ID.toString(), PLAYER_ID.toString())).rejects.toThrow(
      PlayerAlreadyLinkedError,
    );
  });

  it('saves the YALLA format, and clears it with null', async () => {
    const format = { reading: 'keyboard', writing: 'onscreen-choice' };
    User.findByIdAndUpdate.mockReturnValue(
      leanResult({ _id: USER_ID, displayName: 'timo', playerId: null, preferences: { yallaFormat: format } }),
    );
    await expect(repository.setYallaFormat(USER_ID.toString(), format as never)).resolves.toMatchObject({ yallaFormat: format });
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      USER_ID,
      { $set: { 'preferences.yallaFormat': format } },
      { returnDocument: 'after', runValidators: true },
    );

    User.findByIdAndUpdate.mockReturnValue(leanResult({ _id: USER_ID, displayName: 'timo', playerId: null, preferences: {} }));
    await expect(repository.setYallaFormat(USER_ID.toString(), null)).resolves.toMatchObject({ yallaFormat: null });
  });
});
