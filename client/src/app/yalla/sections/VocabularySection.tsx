import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { aspectLabel, LevelDots } from '../AspectPills';
import { useChapterProgress, useStudyChapter } from '../YallaChapterView';
import { PRACTISED_ASPECTS, type ProgressTrack } from '../yalla-progress';
import { Reveal, RevealAllToggle } from './Reveal';

function trackKey(learningObjectId: string, aspect: string): string {
  return `${learningObjectId}|${aspect}`;
}

/**
 * The chapter's words; tap for the meaning. With a linked player each word
 * shows its level per aspect, and `?aspect=reading` (a header pill) lists
 * only the words still to learn for that aspect, like language-learning-app's
 * study lists.
 */
export function VocabularySection() {
  const chapter = useStudyChapter();
  const progress = useChapterProgress();
  const [searchParams] = useSearchParams();
  const [showAll, setShowAll] = useState(false);

  const tracks = useMemo(() => {
    const byKey = new Map<string, ProgressTrack>();
    for (const track of progress.data?.tracks ?? []) {
      byKey.set(trackKey(track.learningObjectId, track.aspect), track);
    }
    return byKey;
  }, [progress.data]);

  const requested = searchParams.get('aspect');
  const aspect = requested && progress.data?.byAspect[requested] ? requested : null;
  const entries = aspect
    ? chapter.vocabulary.filter((entry) => {
        const track = entry.learningObjectId ? tracks.get(trackKey(entry.learningObjectId, aspect)) : undefined;
        return track !== undefined && track.status !== 'retired';
      })
    : chapter.vocabulary;

  return (
    <section className="flex flex-col gap-2" aria-label="Vocabulary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" data-testid="vocabulary-count">
          {aspect ? (
            <>
              {entries.length} words still to learn for {aspectLabel(aspect)} ·{' '}
              <Link to="?" className="underline">
                show all
              </Link>
            </>
          ) : (
            `${chapter.vocabulary.length} words`
          )}
        </p>
        <RevealAllToggle checked={showAll} onChange={setShowAll} label="Show meanings" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => {
          const levels = entry.learningObjectId
            ? PRACTISED_ASPECTS.map((name) => tracks.get(trackKey(entry.learningObjectId!, name))).filter(
                (track): track is ProgressTrack => track !== undefined,
              )
            : [];
          return (
            <Reveal
              key={entry.sourceRef}
              revealed={showAll}
              frontLang={chapter.language}
              front={
                <span className="flex items-center justify-between gap-2">
                  <span className="text-lg">{entry.word}</span>
                  {levels.length > 0 && (
                    <span className="flex shrink-0 gap-2">
                      {levels.map((track) => (
                        <LevelDots key={track.aspect} track={track} />
                      ))}
                    </span>
                  )}
                </span>
              }
              back={entry.gloss}
            />
          );
        })}
      </div>
    </section>
  );
}
