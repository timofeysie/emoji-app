import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { AuthedRequest } from './auth';
import { LearnerService } from './learner.service';
import { PlayerRepository } from './persistence/player.repository';
import { UserRepository } from './persistence/user.repository';

const PLAYER = {
  id: '507f1f77bcf86cd7994390aa',
  firstName: 'Timo',
  externalId: '7f3a2c1e-0000-4000-8000-000000000000',
  label: 'Player 7F3A',
};
const USER = { id: '507f1f77bcf86cd7994390cc', displayName: 'timo', playerId: PLAYER.id };

function request(auth?: { sub: string; username: string }): AuthedRequest {
  return { auth } as AuthedRequest;
}

describe('LearnerService', () => {
  const users = { upsertFromAuth: jest.fn() };
  const players = { getPlayer: jest.fn() };
  const service = new LearnerService(users as unknown as UserRepository, players as unknown as PlayerRepository);

  it('finds the learner from the token, never from the request body', async () => {
    users.upsertFromAuth.mockResolvedValue(USER);
    players.getPlayer.mockResolvedValue(PLAYER);

    await expect(service.resolveLearner(request({ sub: 'sub-1', username: 'timo' }))).resolves.toEqual({
      user: USER,
      player: PLAYER,
    });
    expect(users.upsertFromAuth).toHaveBeenCalledWith({ sub: 'sub-1', username: 'timo' });
    expect(players.getPlayer).toHaveBeenCalledWith(PLAYER.id);
  });

  it('answers 403 when the user has no linked player', async () => {
    users.upsertFromAuth.mockResolvedValue({ ...USER, playerId: null });

    await expect(service.resolveLearner(request({ sub: 'sub-1', username: 'timo' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(players.getPlayer).not.toHaveBeenCalled();
  });

  it('treats a link to a deleted player as no link', async () => {
    users.upsertFromAuth.mockResolvedValue(USER);
    players.getPlayer.mockResolvedValue(null);

    const { me } = await service.me(request({ sub: 'sub-1', username: 'timo' }));

    expect(me.player).toBeNull();
  });

  it('keeps the LRS externalId out of /api/me', async () => {
    users.upsertFromAuth.mockResolvedValue(USER);
    players.getPlayer.mockResolvedValue(PLAYER);

    const { me } = await service.me(request({ sub: 'sub-1', username: 'timo' }));

    expect(me).toEqual({
      user: { id: USER.id, displayName: 'timo' },
      player: { id: PLAYER.id, firstName: 'Timo', label: 'Player 7F3A' },
    });
  });

  it('refuses a request the auth guard did not run on', async () => {
    await expect(service.me(request())).rejects.toThrow(UnauthorizedException);
  });
});
