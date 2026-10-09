import type { Response } from 'express';
import { PlayersController } from './players.controller';
import { PlayerNotFoundError, PlayerRepository } from './persistence/player.repository';

type ResponseMock = Pick<Response, 'status' | 'json'> & {
  status: jest.Mock;
  json: jest.Mock;
};

function createResponseMock(): ResponseMock {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

const GAME_ID = '507f1f77bcf86cd799439011';
const PLAYER_ID = '507f1f77bcf86cd7994390aa';

describe('PlayersController', () => {
  const repository: jest.Mocked<
    Pick<PlayerRepository, 'createPlayer' | 'listPlayers' | 'bindPlayer' | 'unbindPlayer' | 'getGamePlayerBindings'>
  > = {
    createPlayer: jest.fn(),
    listPlayers: jest.fn(),
    bindPlayer: jest.fn(),
    unbindPlayer: jest.fn(),
    getGamePlayerBindings: jest.fn(),
  };
  const controller = new PlayersController(repository as unknown as PlayerRepository);

  it('creates a player from a first name', async () => {
    const player = { id: PLAYER_ID, firstName: 'Mia', externalId: 'x', label: 'Player X' };
    repository.createPlayer.mockResolvedValue(player);
    const res = createResponseMock();

    await controller.createPlayer({ firstName: '  Mia ' }, res as unknown as Response);

    expect(repository.createPlayer).toHaveBeenCalledWith({ firstName: 'Mia' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ player });
  });

  it('rejects an email or any other extra field (security.md D4)', async () => {
    const res = createResponseMock();

    await controller.createPlayer(
      { firstName: 'Mia', email: 'mia@example.com' },
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(repository.createPlayer).not.toHaveBeenCalled();
  });

  it('binds a badge to a player', async () => {
    repository.bindPlayer.mockResolvedValue({} as never);
    const res = createResponseMock();

    await controller.bindPlayer(GAME_ID, 'red', { playerId: PLAYER_ID }, res as unknown as Response);

    expect(repository.bindPlayer).toHaveBeenCalledWith({
      gameId: GAME_ID,
      badgeName: 'red',
      playerId: PLAYER_ID,
      reason: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 for an unknown player or badge', async () => {
    repository.bindPlayer.mockRejectedValue(new PlayerNotFoundError("Badge 'x' is not part of this game."));
    const res = createResponseMock();

    await controller.bindPlayer(GAME_ID, 'x', { playerId: PLAYER_ID }, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 404 when unbinding a badge with no player', async () => {
    repository.unbindPlayer.mockResolvedValue(false);
    const res = createResponseMock();

    await controller.unbindPlayer(GAME_ID, 'red', res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
