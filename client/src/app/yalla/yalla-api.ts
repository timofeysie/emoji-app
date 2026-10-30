import { useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';

export type ChapterSummary = { chapter: string; titleTarget: string; titleNative: string };

export type BookSummary = {
  book: string;
  title: string;
  language: string;
  chapters: ChapterSummary[];
};

export type DialogLine = {
  speakerNameTarget: string;
  speakerNameNative: string;
  speechTarget: string;
  speechNative: string;
};

export type VocabularyEntry = {
  sourceRef: string;
  word: string;
  gloss: string;
  learningObjectId: string | null;
  kind: string | null;
};

export type Pattern = {
  patternTarget: string;
  patternNative: string;
  type?: string;
  exampleSentenceNativeTitle: string;
  exampleSentenceTarget: string;
  exampleSentenceNative: string;
  sampleSentences: Array<{ targetText: string; nativeText: string }>;
  exercises: Array<{ exercise: string; answerKey: string }>;
  appliedPatterns: Array<{
    pattern: string;
    patternTargetText: string;
    patternNativeText: string;
    patternNote?: string;
  }>;
};

export type StudyChapter = ChapterSummary & {
  book: string;
  bookTitle: string;
  language: string;
  dialog: DialogLine[];
  vocabulary: VocabularyEntry[];
  patterns: Pattern[];
};

export class YallaRequestError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 ? 'Please sign in again.' : status === 404 ? 'Not found.' : `Server returned ${status}`);
  }
}

/** Study content doesn't change while the app is open, so each GET is fetched once. */
const contentCache = new Map<string, Promise<unknown>>();

/** GET a YALLA endpoint with the user's Cognito token. */
export function fetchYalla<T>(path: string): Promise<T> {
  const cached = contentCache.get(path);
  if (cached) {
    return cached as Promise<T>;
  }
  const request = (async () => {
    const res = await authFetch(`/api/yalla${path}`);
    if (!res.ok) {
      throw new YallaRequestError(res.status);
    }
    return (await res.json()) as T;
  })();
  contentCache.set(path, request);
  request.catch(() => contentCache.delete(path));
  return request;
}

export type Resource<T> = { data: T | null; loading: boolean; error: string | null };

/** Loads `path` (null = nothing to load yet) and tracks loading and error state. */
export function useYallaResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ data: null, loading: path !== null, error: null });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    fetchYalla<T>(path).then(
      (data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: error instanceof YallaRequestError ? error.message : 'Could not reach server.',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}

export function bookPath(book: string): string {
  return `/yalla/books/${encodeURIComponent(book)}`;
}

export function chapterPath(book: string, chapter: string): string {
  return `${bookPath(book)}/chapters/${encodeURIComponent(chapter)}`;
}
