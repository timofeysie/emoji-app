import chapter26 from '../games/content/chapter26Data.json';
import chapter27 from '../games/content/chapter27Data.json';
import chapter28 from '../games/content/chapter28Data.json';
import chapter29 from '../games/content/chapter29Data.json';
import chapter30 from '../games/content/chapter30Data.json';
import { KOREAN_BOOK } from './learning-object';

/**
 * The books we have content for, with the titles the content registry
 * (`book-content.ts`) doesn't keep. One list of chapter files per book, so
 * the games and YALLA always see the same chapters. Add a chapter here after
 * running `npm run content:senses`.
 */
export type CatalogueBook = {
  book: string;
  title: string;
  /** Raw chapter files, in chapter order. */
  chapters: readonly unknown[];
};

export const BOOK_CATALOGUE: readonly CatalogueBook[] = [
  {
    book: KOREAN_BOOK,
    title: 'Real-Life Korean Conversations: Intermediate',
    chapters: [chapter26, chapter27, chapter28, chapter29, chapter30],
  },
];

export function findCatalogueBook(book: string): CatalogueBook | undefined {
  return BOOK_CATALOGUE.find((entry) => entry.book === book);
}
