import { useState } from 'react';
import { useStudyChapter } from '../YallaChapterView';
import { Reveal, RevealAllToggle } from './Reveal';

/** The chapter's grammar patterns: example, sample sentences, variations and exercises. */
export function PatternsSection() {
  const chapter = useStudyChapter();
  const lang = chapter.language;
  const [showAll, setShowAll] = useState(false);

  return (
    <section className="flex flex-col gap-4" aria-label="Patterns">
      <RevealAllToggle checked={showAll} onChange={setShowAll} label="Show English and answers" />
      {chapter.patterns.map((pattern, index) => (
        <article key={index} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <header>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 lang={lang} className="text-lg font-semibold">
                {pattern.patternTarget}
              </h2>
              {pattern.type && (
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{pattern.type}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{pattern.patternNative}</p>
          </header>

          {pattern.exampleSentenceTarget && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {pattern.exampleSentenceNativeTitle || 'Example'}
              </h3>
              <Reveal
                revealed={showAll}
                frontLang={lang}
                front={pattern.exampleSentenceTarget}
                back={pattern.exampleSentenceNative}
              />
            </div>
          )}

          {pattern.sampleSentences.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sample sentences</h3>
              {pattern.sampleSentences.map((sentence, sentenceIndex) => (
                <Reveal
                  key={sentenceIndex}
                  revealed={showAll}
                  frontLang={lang}
                  front={sentence.targetText}
                  back={sentence.nativeText}
                />
              ))}
            </div>
          )}

          {pattern.appliedPatterns.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variations</h3>
              {pattern.appliedPatterns.map((applied, appliedIndex) => (
                <Reveal
                  key={appliedIndex}
                  revealed={showAll}
                  frontLang={lang}
                  front={
                    <>
                      <div className="text-xs text-muted-foreground">{applied.pattern}</div>
                      {applied.patternTargetText}
                    </>
                  }
                  back={
                    <>
                      {applied.patternNativeText}
                      {applied.patternNote && <div className="mt-1 italic">{applied.patternNote}</div>}
                    </>
                  }
                />
              ))}
            </div>
          )}

          {pattern.exercises.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Try it (tap for the answer)
              </h3>
              {pattern.exercises.map((exercise, exerciseIndex) => (
                <Reveal
                  key={exerciseIndex}
                  revealed={showAll}
                  front={exercise.exercise}
                  back={<span lang={lang}>{exercise.answerKey}</span>}
                />
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
