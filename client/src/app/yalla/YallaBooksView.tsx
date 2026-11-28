import { BookOpen, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PractisingAs } from './PractisingAs';
import { YallaStatus } from './YallaStatus';
import { bookPath, useBookChanged, useYallaResource, type BookOwner, type BookSummary } from './yalla-api';

const GROUPS: Array<{ owner: BookOwner; title: string }> = [
  { owner: 'built-in', title: 'Books' },
  { owner: 'mine', title: 'Your library' },
  { owner: 'other', title: 'Shared by other referees' },
];

/**
 * `/yalla`: the built-in books, then the user's library books, then other
 * referees' open books (docs/hashbrown/creating-games-with-hashbrown.md, G12).
 */
export function YallaBooksView() {
  // Not cached: other referees publish books while the app is open.
  const { data, loading, error, reload } = useYallaResource<{ books: BookSummary[] }>('/books', { cache: false });
  useBookChanged(null, reload);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">YALLA</h1>
        <p className="text-sm text-muted-foreground">Yet Another Language Learning App</p>
      </div>
      <PractisingAs />

      <YallaStatus loading={loading} error={error} what="books" />

      {data &&
        GROUPS.map(({ owner, title }) => {
          const books = data.books.filter((book) => (book.owner ?? 'built-in') === owner);
          if (books.length === 0) return null;
          return (
            <section key={owner} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{title}</h2>
              <BookList books={books} />
            </section>
          );
        })}
      {data && !data.books.some((book) => book.owner === 'mine') && (
        <p className="text-xs text-muted-foreground">
          Make your own chapters from a story or a conversation: <Link className="underline" to="/games/drafts">New chapter draft</Link>{' '}
          on the Draft Game page, or ask the chat to “add this to my library”.
        </p>
      )}
    </div>
  );
}

function BookList({ books }: { books: BookSummary[] }) {
  return (
    <div className="flex flex-col gap-2">
      {books.map((book) => (
        <Link
          key={book.book}
          to={bookPath(book.book)}
          className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-accent"
        >
          <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{book.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {book.chapters.length} chapter{book.chapters.length === 1 ? '' : 's'}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ))}
    </div>
  );
}
