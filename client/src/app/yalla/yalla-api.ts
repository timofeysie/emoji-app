import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../auth/authFetch';

export type ChapterSummary = {
  chapter: string;
  titleTarget: string;
  titleNative: string;
  /** User books: hidden from others, shown to the owner (docs/hashbrown, Feature 2). */
  archived?: boolean;
};

/** The built-in catalogue, the user's own books, or another referee's open book (G12). */
export type BookOwner = 'built-in' | 'mine' | 'other';

export type BookSummary = {
  book: string;
  title: string;
  language: string;
  /** Absent on older servers: built-in. */
  owner?: BookOwner;
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
  owner?: BookOwner;
  /** User chapters: bumped by each edit. */
  revision?: number | null;
  /** Credited by title only (G12). */
  remixedFrom?: { book: string; chapter: string; bookTitle: string; chapterTitle: string } | null;
};

export class YallaRequestError extends Error {
  constructor(
    public readonly status: number,
    /** The JSON error body, when there was one. */
    public readonly body: Record<string, unknown> | null = null,
  ) {
    super(
      typeof body?.['error'] === 'string' && (status === 403 || status === 409)
        ? body['error']
        : status === 401
        ? 'Please sign in again.'
        : status === 404
          ? 'Not found.'
          : status === 503
            ? 'The LRS is not configured on this server.'
            : status === 502
              ? 'The LRS did not answer.'
              : `Server returned ${status}`,
    );
  }
}

/**
 * Each content GET is fetched once. User books change when someone publishes,
 * so the library clears this after a publish or an archive, and the books
 * list isn't cached.
 */
const contentCache = new Map<string, Promise<unknown>>();

export function clearYallaContentCache(): void {
  contentCache.clear();
}

const BOOK_CHANGED = 'emoji-app:book-changed';

/** A book's chapters changed (a publish or an archive), so open book pages fetch it again. */
export function notifyBookChanged(book: string): void {
  window.dispatchEvent(new CustomEvent(BOOK_CHANGED, { detail: { book } }));
}

/** Calls `onChange` when `notifyBookChanged` is called for this book, or for any book when `book` is null. */
export function useBookChanged(book: string | null, onChange: () => void): void {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    const listener = (event: Event) => {
      if (book === null || (event as CustomEvent<{ book: string }>).detail.book === book) callback.current();
    };
    window.addEventListener(BOOK_CHANGED, listener);
    return () => window.removeEventListener(BOOK_CHANGED, listener);
  }, [book]);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`/api/yalla${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new YallaRequestError(res.status, body);
  }
  return (await res.json()) as T;
}

/** POST JSON to a YALLA endpoint with the user's Cognito token. */
export function postYalla<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** GET a YALLA endpoint with the user's Cognito token. `cache: false` for per-learner data (progress). */
export function fetchYalla<T>(path: string, { cache = true }: { cache?: boolean } = {}): Promise<T> {
  if (!cache) {
    return request<T>(path);
  }
  const cached = contentCache.get(path);
  if (cached) {
    return cached as Promise<T>;
  }
  const pending = request<T>(path);
  contentCache.set(path, pending);
  pending.catch(() => contentCache.delete(path));
  return pending;
}

type ResourceState<T> = { data: T | null; loading: boolean; error: string | null };

export type Resource<T> = ResourceState<T> & {
  /** Fetch again (uncached resources only), keeping the current data on screen meanwhile. */
  reload: () => void;
};

type ResourceOptions = {
  cache?: boolean;
  /** Reload when this changes, too (e.g. the linked player). */
  key?: string | null;
  /** Runs before every fetch (e.g. send queued answers first, so progress includes them). */
  before?: () => Promise<unknown>;
};

/** Loads `path` (null = nothing to load yet) and tracks loading and error state. */
export function useYallaResource<T>(
  path: string | null,
  { cache = true, key = null, before }: ResourceOptions = {},
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({ data: null, loading: path !== null, error: null });
  const [generation, setGeneration] = useState(0);
  const beforeRef = useRef(before);
  beforeRef.current = before;
  const keepData = useRef(false);
  const reload = useCallback(() => {
    keepData.current = true;
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    const keep = keepData.current;
    keepData.current = false;
    setState((current) => ({ data: keep ? current.data : null, loading: true, error: null }));
    const ready = beforeRef.current ? beforeRef.current().catch(() => undefined) : Promise.resolve();
    ready.then(() => fetchYalla<T>(path, { cache })).then(
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
  }, [path, cache, key, generation]);

  return { ...state, reload };
}

export function bookPath(book: string): string {
  return `/yalla/books/${encodeURIComponent(book)}`;
}

export function chapterPath(book: string, chapter: string): string {
  return `${bookPath(book)}/chapters/${encodeURIComponent(chapter)}`;
}
