import { useState } from 'react';
import { useStudyChapter } from '../YallaChapterView';
import { Reveal, RevealAllToggle } from './Reveal';

/** The chapter's dialogue, line by line; tap a line for the English. */
export function DialogSection() {
  const chapter = useStudyChapter();
  const [showAll, setShowAll] = useState(false);

  return (
    <section className="flex flex-col gap-2" aria-label="Dialog">
      <RevealAllToggle checked={showAll} onChange={setShowAll} label="Show English" />
      {chapter.dialog.map((line, index) => (
        <Reveal
          key={index}
          revealed={showAll}
          frontLang={chapter.language}
          front={
            <>
              <span className="mr-2 text-sm font-semibold text-muted-foreground">{line.speakerNameTarget}</span>
              {line.speechTarget}
            </>
          }
          back={
            <>
              <span className="mr-2 font-semibold">{line.speakerNameNative}</span>
              {line.speechNative}
            </>
          }
        />
      ))}
    </section>
  );
}
