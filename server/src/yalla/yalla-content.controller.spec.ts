import type { Response } from 'express';
import { BookContentService } from '../learning/book-content.service';
import { KOREAN_BOOK } from '../learning/learning-object';
import type { BookRepository } from '../persistence/book.repository';
import type { UserRepository } from '../persistence/user.repository';
import { YallaContentController } from './yalla-content.controller';
import { YallaLibraryService } from './yalla-library.service';

// The guard is covered in auth.guard.spec.ts; importing the real one needs Cognito env.
jest.mock('../auth.guard', () => ({ AuthGuard: class {} }));

type ResponseMock = Pick<Response, 'status' | 'json'> & { status: jest.Mock; json: jest.Mock };

function createResponseMock(): ResponseMock {
  const response = { status: jest.fn(), json: jest.fn() } as unknown as ResponseMock;
  response.status.mockReturnValue(response);
  return response;
}

describe('YallaContentController', () => {
  // Without Mongo: the built-in catalogue only, as before H2.
  const books = { isAvailable: () => false } as unknown as BookRepository;
  const users = { findIdByAuthProviderId: jest.fn() } as unknown as UserRepository;
  const controller = new YallaContentController(new YallaLibraryService(books, new BookContentService(books)), users);
  const req = { auth: { sub: 'local-dev', username: 'local-dev' } } as never;

  it('lists books', async () => {
    const res = createResponseMock();
    await controller.getBooks(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].books[0].book).toBe(KOREAN_BOOK);
  });

  it('returns a chapter', async () => {
    const res = createResponseMock();
    await controller.getChapter(KOREAN_BOOK, '26', req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ book: KOREAN_BOOK, chapter: '26' });
  });

  it.each([
    ['an invalid book', 'Bad Book', '26', 400],
    ['an invalid chapter', KOREAN_BOOK, 'ch26', 400],
    ['an unknown book', 'no-such-book', '26', 404],
    ['an unknown chapter', KOREAN_BOOK, '99', 404],
  ])('answers %s with %s', async (_label, book, chapter, status) => {
    const res = createResponseMock();
    await controller.getChapter(book, chapter, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(status);
  });

  it('answers an unknown book with 404', async () => {
    const res = createResponseMock();
    await controller.getBook('no-such-book', req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
