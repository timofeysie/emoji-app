import { useStructuredCompletion } from '@hashbrownai/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_MODEL } from '../chat/chat-config';
import type { LanguagePair } from '../game-authoring/drafts-api';
import { languageName } from '../game-authoring/useGameGeneration';
import { chapterRecipe } from './chapter-authoring.prompt';
import { chapterDraftSchema, type ChapterDraftOutput } from './chapter-draft.schema';

const SYSTEM = [
  'You turn a passage a teacher pasted into a study chapter for language learners, like a textbook chapter.',
  'Copy the passage exactly; translate it faithfully. Only teach words and patterns the passage uses.',
].join('\n');

/** The user message for one chapter: the recipe and the passage. Exported for tests. */
export function chapterGenerationMessage(source: string, language: LanguagePair, note?: string): string {
  const names = { target: languageName(language.target), native: languageName(language.native) };
  return [
    chapterRecipe(names),
    note ? `The teacher's note: ${note}` : '',
    `The passage is in ${names.target}. The learner speaks ${names.native}. ` +
      `Set language to { target: "${language.target}", native: "${language.native}" }.`,
    `The passage:\n"""\n${source}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

type Pending = { id: number; input: string };

/**
 * The Draft Game page's **Generate** for a chapter, through
 * `useStructuredCompletion` (no chat history). `onResult` gets each answer
 * once; the page then looks up senses for its words.
 */
export function useChapterGeneration(onResult: (output: ChapterDraftOutput) => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const sawLoading = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const completion = useStructuredCompletion({
    debugName: 'ChapterDraftGenerator',
    input: pending?.input ?? null,
    model: CHAT_MODEL,
    system: SYSTEM,
    schema: chapterDraftSchema,
    retries: 2,
  });

  useEffect(() => {
    if (!pending) return;
    if (completion.isLoading) {
      sawLoading.current = true;
      return;
    }
    if (!sawLoading.current) return;
    const failure = completion.error ?? completion.sendingError ?? completion.generatingError;
    if (failure || completion.exhaustedRetries) {
      setError(failure?.message ?? 'The AI didn’t answer. Try again.');
      setPending(null);
      return;
    }
    if (completion.output) {
      setPending(null);
      onResultRef.current(completion.output as ChapterDraftOutput);
    }
  }, [
    pending,
    completion.isLoading,
    completion.output,
    completion.error,
    completion.sendingError,
    completion.generatingError,
    completion.exhaustedRetries,
  ]);

  const generate = useCallback((source: string, language: LanguagePair, note?: string) => {
    sawLoading.current = false;
    setError(null);
    const id = nextId.current++;
    // The id makes every request a new input, so the same one can be asked again.
    setPending({ id, input: `${chapterGenerationMessage(source, language, note)}\n\n(request ${id})` });
  }, []);

  const cancel = useCallback(() => setPending(null), []);

  const partial = pending && completion.isLoading ? (completion.output as Partial<ChapterDraftOutput> | null) : null;

  return {
    generate,
    cancel,
    pending: pending !== null,
    /** Passage lines and words streamed so far. */
    progress: {
      lines: Array.isArray(partial?.dialog) ? partial.dialog.length : 0,
      words: Array.isArray(partial?.vocabulary) ? partial.vocabulary.length : 0,
    },
    error,
  };
}
