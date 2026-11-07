import { ChevronRight } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { YallaStatus } from './YallaStatus';
import { chapterPath, useYallaResource, type BookSummary } from './yalla-api';

/** `/yalla/books/:book`: the book's chapters. Progress pills join this list in Y3. */
export function YallaBookView() {
  const { book = '' } = useParams();
  const { data, loading, error } = useYallaResource<BookSummary>(`/books/${encodeURIComponent(book)}`);

  return (
    <div className="flex flex-col gap-4">
      <Link to="/yalla" className="text-sm text-muted-foreground hover:underline">
        ← Books
      </Link>
      <YallaStatus loading={loading} error={error} what="the book" />

      {data && (
        <>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <div className="flex flex-col gap-2">
            {data.chapters.map((item) => (
              <Link
                key={item.chapter}
                to={chapterPath(data.book, item.chapter)}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-accent"
              >
                <span className="w-24 shrink-0 text-sm font-semibold">Chapter {item.chapter}</span>
                <div className="min-w-0 flex-1">
                  <div lang={data.language} className="truncate">
                    {item.titleTarget}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{item.titleNative}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
