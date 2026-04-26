import type { Response } from 'express';
import { GameFlowController } from './game-flow.controller';
import { GameDataRepository } from './persistence/game-data.repository';

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

describe('GameFlowController', () => {
  const repository: jest.Mocked<GameDataRepository> = {
    createGame: jest.fn(),
    addParticipant: jest.fn(),
    createQuestionWithOptions: jest.fn(),
    setQuestionState: jest.fn(),
    createNfcCardGroup: jest.fn(),
    assignNfcCardGroupToGame: jest.fn(),
    submitGuess: jest.fn(),
  } as unknown as jest.Mocked<GameDataRepository>;
  const controller = new GameFlowController(repository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for invalid game creation payload', async () => {
    const res = createResponseMock();

    await controller.createGame({ title: '' }, res as unknown as Response);

    expect(repository.createGame).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 201 with gameId for valid game creation payload', async () => {
    const res = createResponseMock();
    repository.createGame.mockResolvedValue('507f1f77bcf86cd799439011');

    await controller.createGame(
      {
        title: 'Test Game',
        createdByUserId: '507f1f77bcf86cd799439012',
      },
      res as unknown as Response,
    );

    expect(repository.createGame).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ gameId: '507f1f77bcf86cd799439011' });
  });

  it('returns 400 when player participant is missing playMode', async () => {
    const res = createResponseMock();

    await controller.addParticipant(
      '507f1f77bcf86cd799439013',
      {
        userId: '507f1f77bcf86cd799439014',
        role: 'player',
      },
      res as unknown as Response,
    );

    expect(repository.addParticipant).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 for valid question state update', async () => {
    const res = createResponseMock();

    await controller.setQuestionState(
      '507f1f77bcf86cd799439015',
      {
        gameId: '507f1f77bcf86cd799439016',
        state: 'open',
      },
      res as unknown as Response,
    );

    expect(repository.setQuestionState).toHaveBeenCalledWith({
      gameId: '507f1f77bcf86cd799439016',
      questionId: '507f1f77bcf86cd799439015',
      state: 'open',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('maps repository submitGuess errors to 400', async () => {
    const res = createResponseMock();
    repository.submitGuess.mockRejectedValue(new Error('Question is not open for submissions.'));

    await controller.submitGuess(
      {
        gameId: '507f1f77bcf86cd799439017',
        questionId: '507f1f77bcf86cd799439018',
        guesserUserId: '507f1f77bcf86cd799439019',
        cardUid: 'CARD-UID-A-001',
      },
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(repository.submitGuess).toHaveBeenCalled();
  });
});
