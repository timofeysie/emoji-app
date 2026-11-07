import type { Response } from 'express';
import type { AuthedRequest } from './auth';
import { LearnerService } from './learner.service';
import { MeController } from './me.controller';
import { PlayerRepository } from './persistence/player.repository';
import { PlayerAlreadyLinkedError, UserRepository } from './persistence/user.repository';

// The guard is covered in auth.guard.spec.ts; importing the real one needs Cognito env.
jest.mock('./auth.guard', () => ({ AuthGuard: class {} }));

type ResponseMock = Pick<Response, 'status' | 'json'> & { status: jest.Mock; json: jest.Mock };

function createResponseMock(): ResponseMock {
  const response = { status: jest.fn(), json: jest.fn() } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

const USER = { id: '507f1f77bcf86cd7994390cc', displayName: 'timo', playerId: null };
const PLAYER = {
  id: '507f1f77bcf86cd7994390aa',
  firstName: 'Timo',
  externalId: '7f3a2c1e-0000-4000-8000-000000000000',
  label: 'Player 7F3A',
};
const ME = { user: { id: USER.id, displayName: 'timo' }, player: null };
const req = { auth: { sub: 'sub-1', username: 'timo' } } as AuthedRequest;

describe('MeController', () => {
  const learner = { me: jest.fn() };
  const users = { setPlayer: jest.fn() };
  const players = { getPlayer: jest.fn(), createPlayer: jest.fn() };
  const controller = new MeController(
    learner as unknown as LearnerService,
    users as unknown as UserRepository,
    players as unknown as PlayerRepository,
  );

  beforeEach(() => {
    learner.me.mockResolvedValue({ me: ME, user: USER, player: null });
  });

  it('returns the signed-in user', async () => {
    const res = createResponseMock();
    await controller.getMe(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(ME);
  });

  it('links the signed-in user (from the token) to an existing player', async () => {
    players.getPlayer.mockResolvedValue(PLAYER);
    const res = createResponseMock();

    await controller.setPlayer(req, { playerId: PLAYER.id }, res as unknown as Response);

    expect(users.setPlayer).toHaveBeenCalledWith(USER.id, PLAYER.id);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('creates a player and links it', async () => {
    players.createPlayer.mockResolvedValue(PLAYER);
    const res = createResponseMock();

    await controller.setPlayer(req, { create: { firstName: ' Timo ' } }, res as unknown as Response);

    expect(players.createPlayer).toHaveBeenCalledWith({ firstName: 'Timo' });
    expect(users.setPlayer).toHaveBeenCalledWith(USER.id, PLAYER.id);
  });

  it('unlinks with playerId null', async () => {
    const res = createResponseMock();

    await controller.setPlayer(req, { playerId: null }, res as unknown as Response);

    expect(users.setPlayer).toHaveBeenCalledWith(USER.id, null);
  });

  it.each([
    ['a bad id', { playerId: 'nope' }],
    ['an empty name', { create: { firstName: '  ' } }],
    ['someone else’s user id', { playerId: PLAYER.id, userId: '507f1f77bcf86cd7994390dd' }],
    ['no body', undefined],
  ])('answers 400 for %s', async (_label, body) => {
    const res = createResponseMock();

    await controller.setPlayer(req, body, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(users.setPlayer).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown player', async () => {
    players.getPlayer.mockResolvedValue(null);
    const res = createResponseMock();

    await controller.setPlayer(req, { playerId: PLAYER.id }, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(users.setPlayer).not.toHaveBeenCalled();
  });

  it('answers 409 when another user practises as that player', async () => {
    players.getPlayer.mockResolvedValue(PLAYER);
    users.setPlayer.mockRejectedValue(new PlayerAlreadyLinkedError('taken'));
    const res = createResponseMock();

    await controller.setPlayer(req, { playerId: PLAYER.id }, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});
