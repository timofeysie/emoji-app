import { BookContentService } from '../learning/book-content.service';
import type { BookRepository } from '../persistence/book.repository';

/** `BookContentService` without Mongo: only the built-in books. */
export function builtInBookContent(): BookContentService {
  return new BookContentService({ isAvailable: () => false } as unknown as BookRepository);
}
