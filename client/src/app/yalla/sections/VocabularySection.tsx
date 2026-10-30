import { useState } from 'react';
import { useStudyChapter } from '../YallaChapterView';
import { Reveal, RevealAllToggle } from './Reveal';

/**
 * The chapter's words; tap for the meaning. The reading / writing /
 * speaking / listening pills and per-word levels arrive in milestone Y3.
 */
export function VocabularySection() {
  const chapter = useStudyChapter();
  const [showAll, setShowAll] = useState(false);

  return (
    <section className="flex flex-col gap-2" aria-label="Vocabulary">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{chapter.vocabulary.length} words</p>
        <RevealAllToggle checked={showAll} onChange={setShowAll} label="Show meanings" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {chapter.vocabulary.map((entry) => (
          <Reveal
            key={entry.sourceRef}
            revealed={showAll}
            frontLang={chapter.language}
            front={<span className="text-lg">{entry.word}</span>}
            back={entry.gloss}
          />
        ))}
      </div>
    </section>
  );
}
