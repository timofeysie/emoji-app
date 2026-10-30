import { BookOpen, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { YallaStatus } from './YallaStatus';
import { bookPath, useYallaResource, type BookSummary } from './yalla-api';

/** `/yalla`: the books we have content for (one today). */
export function YallaBooksView() {
  const { data, loading, error } = useYallaResource<{ books: BookSummary[] }>('/books');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">YALLA</h1>
        <p className="text-sm text-muted-foreground">Yet Another Language Learning App</p>
      </div>

      <h2 className="text-lg font-semibold">Books</h2>
      <YallaStatus loading={loading} error={error} what="books" />

      {data && (
        <div className="flex flex-col gap-2">
          {data.books.map((book) => (
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
      )}
    </div>
  );
}
