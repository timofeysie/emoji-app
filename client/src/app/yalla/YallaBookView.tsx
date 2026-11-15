import { ChevronRight } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AspectPills, PendingExportNotice } from './AspectPills';
import { PractisingAs } from './PractisingAs';
import { YallaStatus } from './YallaStatus';
import { chapterPath, useYallaResource, type BookSummary } from './yalla-api';
import { bookProgressPath, useLearnerProgress, type BookProgress } from './yalla-progress';

/** `/yalla/books/:book`: the book's chapters, each with the linked player's pills. */
export function YallaBookView() {
  const { book = '' } = useParams();
  const { data, loading, error } = useYallaResource<BookSummary>(`/books/${encodeURIComponent(book)}`);
  const progress = useLearnerProgress<BookProgress>(bookProgressPath(book));
  const countsByChapter = new Map(progress.data?.chapters.map((item) => [item.chapter, item.byAspect]));
  const emptyReason =
    progress.linked === false ? 'link a player to see progress' : progress.loading ? 'loading…' : (progress.error ?? undefined);

  return (
    <div className="flex flex-col gap-4">
      <Link to="/yalla" className="text-sm text-muted-foreground hover:underline">
        ← Books
      </Link>
      <YallaStatus loading={loading} error={error} what="the book" />

      {data && (
        <>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          {progress.linked === false && <PractisingAs />}
          {progress.error && (
            <p className="text-xs text-muted-foreground" data-testid="progress-error">
              Progress unavailable. {progress.error}
            </p>
          )}
          {progress.data && <PendingExportNotice pending={progress.data.pendingExport} />}
          <div className="flex flex-col gap-2">
            {data.chapters.map((item) => (
              <Link
                key={item.chapter}
                to={chapterPath(data.book, item.chapter)}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 hover:bg-accent"
                data-testid={`chapter-${item.chapter}`}
              >
                <span className="hidden w-24 shrink-0 text-sm font-semibold sm:block">Chapter {item.chapter}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-muted-foreground sm:hidden">Chapter {item.chapter}</div>
                  <div lang={data.language} className="truncate">
                    {item.titleTarget}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{item.titleNative}</div>
                  <div className="mt-2">
                    <AspectPills compact counts={countsByChapter.get(item.chapter) ?? null} emptyReason={emptyReason} />
                  </div>
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
