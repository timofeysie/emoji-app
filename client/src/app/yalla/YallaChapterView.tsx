import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { cn } from '../shared/utils';
import { AspectPills, PendingExportNotice } from './AspectPills';
import { PractisingAs } from './PractisingAs';
import { YallaStatus } from './YallaStatus';
import { bookPath, chapterPath, useYallaResource, type StudyChapter } from './yalla-api';
import { chapterProgressPath, useLearnerProgress, type ChapterProgress, type LearnerProgress } from './yalla-progress';

type ChapterContext = {
  chapter: StudyChapter;
  progress: LearnerProgress<ChapterProgress>;
  /** Limits the header pills to these aspects (a running practice session's); null = all. */
  setPillAspects: (aspects: readonly string[] | null) => void;
};

/** `/yalla/books/:book/chapters/:chapter/*`: the chapter header and pills, then the chosen section. */
export function YallaChapterView() {
  const { book = '', chapter = '' } = useParams();
  const { data, loading, error } = useYallaResource<StudyChapter>(
    `/books/${encodeURIComponent(book)}/chapters/${encodeURIComponent(chapter)}`,
  );
  const progress = useLearnerProgress<ChapterProgress>(chapterProgressPath(book, chapter));
  const [pillAspects, setPillAspects] = useState<readonly string[] | null>(null);
  const [titleOpen, setTitleOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <YallaStatus loading={loading} error={error} what="the chapter" />

      {data && (
        <>
          <header className="flex flex-col gap-2">
            <Link to={bookPath(book)} className="self-start text-sm text-muted-foreground hover:underline">
              ← {data.bookTitle}
            </Link>
            {/* One line by default: the title doesn't change while you practise, so keep it out of the way. */}
            <div className="flex min-w-0 items-start gap-2">
              <h1 className={cn('min-w-0 flex-1', titleOpen ? 'flex flex-col' : 'truncate')}>
                <span className="text-lg font-bold">Chapter {data.chapter}</span>
                <span lang={data.language} className={cn('text-lg', !titleOpen && 'ml-2')}>
                  {data.titleTarget}
                </span>
                <span className={cn('text-sm text-muted-foreground', !titleOpen && 'ml-2')}>{data.titleNative}</span>
              </h1>
              <button
                type="button"
                onClick={() => setTitleOpen((open) => !open)}
                aria-expanded={titleOpen}
                aria-label={titleOpen ? 'Collapse title' : 'Expand title'}
                className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
                data-testid="chapter-title-toggle"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', titleOpen && 'rotate-180')} aria-hidden />
              </button>
            </div>
            <AspectPills
              aspects={pillAspects}
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
          <Outlet context={{ chapter: data, progress, setPillAspects } satisfies ChapterContext} />
        </>
      )}
    </div>
  );
}

/** The loaded chapter, for the section routes. */
export function useStudyChapter(): StudyChapter {
  return useOutletContext<ChapterContext>().chapter;
}

/** Shows only `aspects` in the header pills while mounted with them (null = all). */
export function useChapterPillAspects(aspects: readonly string[] | null): void {
  const { setPillAspects } = useOutletContext<ChapterContext>();
  const key = aspects?.join(',') ?? null;
  useEffect(() => {
    setPillAspects(key === null ? null : key.split(','));
    return () => setPillAspects(null);
  }, [key, setPillAspects]);
}

/** The linked player's progress for this chapter (data is null without a link). */
export function useChapterProgress(): LearnerProgress<ChapterProgress> {
  return useOutletContext<ChapterContext>().progress;
}
