import type { Response } from 'express';
import { KOREAN_BOOK } from '../learning/learning-object';
import { YallaContentController } from './yalla-content.controller';

// The guard is covered in auth.guard.spec.ts; importing the real one needs Cognito env.
jest.mock('../auth.guard', () => ({ AuthGuard: class {} }));

type ResponseMock = Pick<Response, 'status' | 'json'> & { status: jest.Mock; json: jest.Mock };

function createResponseMock(): ResponseMock {
  const response = { status: jest.fn(), json: jest.fn() } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

describe('YallaContentController', () => {
  const controller = new YallaContentController();

  it('lists books', () => {
    const res = createResponseMock();
    controller.getBooks(res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].books[0].book).toBe(KOREAN_BOOK);
  });

  it('returns a chapter', () => {
    const res = createResponseMock();
    controller.getChapter(KOREAN_BOOK, '26', res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ book: KOREAN_BOOK, chapter: '26' });
  });

  it.each([
    ['an invalid book', 'Bad Book', '26', 400],
    ['an invalid chapter', KOREAN_BOOK, 'ch26', 400],
    ['an unknown book', 'no-such-book', '26', 404],
    ['an unknown chapter', KOREAN_BOOK, '99', 404],
  ])('answers %s with %s', (_label, book, chapter, status) => {
    const res = createResponseMock();
    controller.getChapter(book, chapter, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(status);
  });

  it('answers an unknown book with 404', () => {
    const res = createResponseMock();
    controller.getBook('no-such-book', res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
