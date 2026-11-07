import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { YallaStatus } from './YallaStatus';
import { bookPath, useYallaResource, type StudyChapter } from './yalla-api';

/** `/yalla/books/:book/chapters/:chapter/*`: the chapter header, then the chosen section. */
export function YallaChapterView() {
  const { book = '', chapter = '' } = useParams();
  const { data, loading, error } = useYallaResource<StudyChapter>(
    `/books/${encodeURIComponent(book)}/chapters/${encodeURIComponent(chapter)}`,
  );

  return (
    <div className="flex flex-col gap-4">
      <Link to={bookPath(book)} className="text-sm text-muted-foreground hover:underline">
        ← {data?.bookTitle ?? 'Book'}
      </Link>
      <YallaStatus loading={loading} error={error} what="the chapter" />

      {data && (
        <>
          <header>
            <h1 className="text-2xl font-bold">Chapter {data.chapter}</h1>
            <p lang={data.language} className="text-lg">
              {data.titleTarget}
            </p>
            <p className="text-sm text-muted-foreground">{data.titleNative}</p>
          </header>
          <Outlet context={data} />
        </>
      )}
    </div>
  );
}

/** The loaded chapter, for the section routes. */
export function useStudyChapter(): StudyChapter {
  return useOutletContext<StudyChapter>();
}
