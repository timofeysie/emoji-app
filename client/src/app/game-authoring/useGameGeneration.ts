import { useStructuredCompletion } from '@hashbrownai/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_MODEL } from '../chat/chat-config';
import type { DraftQuestion, DraftSettings, LanguagePair } from './drafts-api';
import { gameRecipe } from './game-authoring.prompt';
import { gameDraftSchema, type GameDraftPayload } from './game-draft.schema';

/** What the Draft Game page asks the model for. */
export type GenerationRequest =
  | { kind: 'all' }
  | { kind: 'one'; index: number; note?: string }
  | { kind: 'more'; count: number };

export type GenerationContext = {
  source: string;
  language: LanguagePair;
  settings: DraftSettings;
  /** The draft's questions now: replaced (`one`) or not to be repeated (`more`). */
  questions: DraftQuestion[];
};

const LANGUAGE_NAMES: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

const SYSTEM = [
  'You write multiple-choice quiz games for language learners from a passage the teacher pasted.',
  'Follow the task exactly: the number of questions, the mix and the number of options.',
  'Only ask about what the passage says or uses. Every correct answer must be clearly right, and every other option clearly wrong.',
].join('\n');

function existingList(questions: DraftQuestion[]): string {
  return questions.map((question, i) => `${i + 1}. ${question.text}`).join('\n');
}

/** The user message for one request: the task, the recipe and the passage. Exported for tests. */
export function generationMessage(request: GenerationRequest, context: GenerationContext): string {
  const { settings, language, questions } = context;
  const names = { target: languageName(language.target), native: languageName(language.native) };
  const { optionsPerQuestion } = settings;
  const languages =
    `The passage is in ${names.target}. The learner speaks ${names.native}. ` +
    `Set language to { target: "${language.target}", native: "${language.native}" }.`;
  let task: string;
  if (request.kind === 'one') {
    const old = questions[request.index];
    const focus = old?.focus ?? 'vocabulary';
    task = [
      `Write one new question to replace question ${request.index + 1}: "${old?.text ?? ''}".`,
      request.note
        ? `The teacher's note for it comes first: ${request.note}`
        : 'Make it different from the old one.',
      request.note
        ? gameRecipe({ mix: 'free', total: 1, optionsPerQuestion, languages: names })
        : gameRecipe({ mix: { comprehension: 0, vocabulary: 0, grammar: 0, [focus]: 1 }, total: 1, optionsPerQuestion, languages: names }),
      `Don't repeat any of the game's other questions:\n${existingList(questions.filter((_, i) => i !== request.index))}`,
      'Put the new question alone in questions. Keep the title short.',
    ].join('\n\n');
  } else if (request.kind === 'more') {
    task = [
      `Write ${request.count} more questions for this game.`,
      gameRecipe({ mix: settings.mix, total: request.count, optionsPerQuestion, languages: names }),
      `Don't repeat the game's questions so far:\n${existingList(questions)}`,
      'Put only the new questions in questions. Keep the title short.',
    ].join('\n\n');
  } else {
    task = [
      'Make a game from the passage.',
      gameRecipe({ mix: settings.mix, total: settings.questionCount, optionsPerQuestion, languages: names }),
    ].join('\n\n');
  }
  return `${task}\n\n${languages}\n\nThe passage:\n"""\n${context.source}\n"""`;
}

/**
 * The options in a random order. Models put the correct answer first almost
 * every time (checked with gpt-4.1: 10 of 10), which players would learn.
 */
export function shuffleOptions(output: GameDraftPayload, random: () => number = Math.random): GameDraftPayload {
  return {
    ...output,
    questions: output.questions.map((question) => {
      const options = [...question.options];
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      return { ...question, options };
    }),
  };
}

type Pending = { id: number; request: GenerationRequest; input: string };

/**
 * The Draft Game page's **Generate**, **Regenerate** and **Generate more**
 * through `useStructuredCompletion` (no chat history, no session header, so
 * it doesn't touch the chat's context reading). `onResult` gets each answer
 * once, for the request that asked for it.
 */
export function useGameGeneration(onResult: (request: GenerationRequest, output: GameDraftPayload) => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  // The previous answer is still in `output` until the new request starts.
  const sawLoading = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const completion = useStructuredCompletion({
    debugName: 'GameDraftGenerator',
    input: pending?.input ?? null,
    model: CHAT_MODEL,
    system: SYSTEM,
    schema: gameDraftSchema,
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
      onResultRef.current(pending.request, shuffleOptions(completion.output as GameDraftPayload));
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

  const generate = useCallback((request: GenerationRequest, context: GenerationContext) => {
    sawLoading.current = false;
    setError(null);
    const id = nextId.current++;
    // The id makes every request a new input, so the same one can be asked again.
    setPending({ id, request, input: `${generationMessage(request, context)}\n\n(request ${id})` });
  }, []);

  /** Stops waiting. The model may still finish, but its answer is ignored. */
  const cancel = useCallback(() => setPending(null), []);

  const partial = pending && completion.isLoading ? (completion.output as Partial<GameDraftPayload> | null) : null;

  return {
    generate,
    cancel,
    pending: pending?.request ?? null,
    /** Questions streamed so far for the pending request. */
    partialCount: Array.isArray(partial?.questions) ? partial.questions.length : 0,
    error,
    clearError: () => setError(null),
  };
}
