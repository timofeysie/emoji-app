import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { AspectPills, PendingExportNotice } from './AspectPills';
import { PractisingAs } from './PractisingAs';
import { YallaStatus } from './YallaStatus';
import { bookPath, chapterPath, useYallaResource, type StudyChapter } from './yalla-api';
import { chapterProgressPath, useLearnerProgress, type ChapterProgress, type LearnerProgress } from './yalla-progress';

type ChapterContext = { chapter: StudyChapter; progress: LearnerProgress<ChapterProgress> };

/** `/yalla/books/:book/chapters/:chapter/*`: the chapter header and pills, then the chosen section. */
export function YallaChapterView() {
  const { book = '', chapter = '' } = useParams();
  const { data, loading, error } = useYallaResource<StudyChapter>(
    `/books/${encodeURIComponent(book)}/chapters/${encodeURIComponent(chapter)}`,
  );
  const progress = useLearnerProgress<ChapterProgress>(chapterProgressPath(book, chapter));

  return (
    <div className="flex flex-col gap-4">
      <Link to={bookPath(book)} className="text-sm text-muted-foreground hover:underline">
        ← {data?.bookTitle ?? 'Book'}
      </Link>
      <YallaStatus loading={loading} error={error} what="the chapter" />

      {data && (
        <>
          <header className="flex flex-col gap-2">
            <div>
              <h1 className="text-2xl font-bold">Chapter {data.chapter}</h1>
              <p lang={data.language} className="text-lg">
                {data.titleTarget}
              </p>
              <p className="text-sm text-muted-foreground">{data.titleNative}</p>
            </div>
            <AspectPills
              counts={progress.data?.byAspect ?? null}
              emptyReason={
                progress.linked === false
                  ? 'link a player to see progress'
                  : progress.loading
                    ? 'loading…'
                    : (progress.error ?? undefined)
              }
              hrefFor={(aspect) => `${chapterPath(book, chapter)}/vocabulary?aspect=${aspect}`}
            />
            {progress.linked === false && <PractisingAs />}
            {progress.error && (
              <p className="text-xs text-muted-foreground" data-testid="progress-error">
                Progress unavailable. {progress.error}
              </p>
            )}
            {progress.data && <PendingExportNotice pending={progress.data.pendingExport} />}
          </header>
          <Outlet context={{ chapter: data, progress } satisfies ChapterContext} />
        </>
      )}
    </div>
  );
}

/** The loaded chapter, for the section routes. */
export function useStudyChapter(): StudyChapter {
  return useOutletContext<ChapterContext>().chapter;
}

/** The linked player's progress for this chapter (data is null without a link). */
export function useChapterProgress(): LearnerProgress<ChapterProgress> {
  return useOutletContext<ChapterContext>().progress;
}
