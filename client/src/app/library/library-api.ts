import { authFetch } from '../auth/authFetch';
import { clearYallaContentCache } from '../yalla/yalla-api';
import { DraftRequestError, type ContentDraft, type DraftView, type LanguagePair } from '../game-authoring/drafts-api';

/**
 * Library chapters (docs/hashbrown/creating-games-with-hashbrown.md →
 * Feature 2): chapter drafts on the same `/api/content/drafts` as game
 * drafts, the sense lookup, the user's books and archiving. Reading books
 * and chapters is YALLA's (`yalla/yalla-api.ts`).
 */

export type SenseDecision = {
  decision: 'undecided' | 'reuse' | 'new';
  /** `reuse`: e.g. `ko/lexeme/시험/test`. */
  reuseId: string;
  /** `new`: an ASCII slug, e.g. `rabbit`. */
  newSense: string;
  kind: 'lexeme' | 'expression';
  /** `new`: the gloss; the entry's first meaning when empty. */
  newGloss: string;
  /** `new`: checked by the user (G7). */
  confirmed: boolean;
};

export type ChapterWord = { targetLanguageText: string; nativeLanguageText: string; sense: SenseDecision };

export type ChapterDialogLine = {
  speakerNameTarget: string;
  speakerNameNative: string;
  speechTarget: string;
  speechNative: string;
};

export type ChapterPattern = {
  patternTarget: string;
  patternNative: string;
  type: string;
  exampleSentenceTarget: string;
  exampleSentenceNative: string;
  sampleSentences: Array<{ targetText: string; nativeText: string }>;
  exercises: Array<{ exercise: string; answerKey: string }>;
};

/** The server's `chapterDraftPayloadSchema`. */
export type ChapterDraftContent = {
  /** One of the owner's books, or "" for `newBook`. */
  bookSlug: string;
  newBook: { title: string; slug: string };
  language?: LanguagePair;
  titleTarget: string;
  titleNative: string;
  dialog: ChapterDialogLine[];
  vocabulary: ChapterWord[];
  patterns: ChapterPattern[];
};

export type ChapterRef = { book: string; chapter: string; revision?: number | null };

export type MyBook = { slug: string; title: string; chapterCount: number };

/** An edit's published words and patterns, which must stay (G8). */
export type FrozenChapter = { book: string; chapter: string; words: string[]; senseIds: string[]; patternCount: number };

export type ChapterDraftView = Omit<DraftView, 'draft'> & {
  draft: Omit<ContentDraft, 'payload'> & { payload: ChapterDraftContent | null };
  chapter?: { books: MyBook[]; frozen: FrozenChapter | null };
};

export type FoundSense = { id: string; gloss: string; kind: string; from: 'registry' | 'library' };

export function emptyDecision(): SenseDecision {
  return { decision: 'undecided', reuseId: '', newSense: '', kind: 'lexeme', newGloss: '', confirmed: false };
}

export function emptyChapterContent(): ChapterDraftContent {
  return { bookSlug: '', newBook: { title: '', slug: '' }, titleTarget: '', titleNative: '', dialog: [], vocabulary: [], patterns: [] };
}

/** `The Rabbit & the Turtle` → `the-rabbit-the-turtle-3f9a` (G9). Hangul-only titles become `book-3f9a`. */
export function suggestBookSlug(title: string, hex = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')): string {
  const base = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 43)
    .replace(/-+$/, '');
  return `${base || 'book'}-${hex}`;
}

async function send<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(url, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new DraftRequestError(res.status, body);
  }
  return body;
}

export function createChapterDraft(
  body:
    | { source?: { text: string; language: LanguagePair }; payload?: ChapterDraftContent }
    | { fromGameId: string }
    | { fromChapter: { book: string; chapter: string } }
    | { editChapter: { book: string; chapter: string } },
): Promise<{ draft: ContentDraft }> {
  return send('/api/content/drafts', { method: 'POST', body: JSON.stringify({ type: 'chapter', ...body }) });
}

export function getChapterDraft(draftId: string): Promise<ChapterDraftView> {
  return send(`/api/content/drafts/${draftId}`);
}

export function updateChapterDraft(
  draftId: string,
  body: { revision: number; source?: { text: string; language: LanguagePair }; payload?: ChapterDraftContent },
): Promise<ChapterDraftView> {
  return send(`/api/content/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function publishChapterDraft(draftId: string, revision: number): Promise<{ chapter: ChapterRef; draft: ContentDraft | null }> {
  const published = await send<{ chapter: ChapterRef; draft: ContentDraft | null }>(`/api/content/drafts/${draftId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ revision }),
  });
  clearYallaContentCache();
  return published;
}

/** Each word's existing senses (G7). */
export async function findSenses(words: readonly string[], language = 'ko'): Promise<Array<{ word: string; senses: FoundSense[] }>> {
  const unique = [...new Set(words.map((word) => word.trim()).filter((word) => word && !word.includes(',')))];
  if (unique.length === 0) return [];
  const params = new URLSearchParams({ language, words: unique.slice(0, 60).join(',') });
  return (await send<{ words: Array<{ word: string; senses: FoundSense[] }> }>(`/api/senses?${params}`)).words;
}

export function myBooks(): Promise<{ books: MyBook[] }> {
  return send('/api/books/mine');
}

export async function setChapterArchived(book: string, chapter: string, archived: boolean): Promise<{ archived: boolean }> {
  const result = await send<{ archived: boolean }>(
    `/api/books/${encodeURIComponent(book)}/chapters/${encodeURIComponent(chapter)}/archive`,
    { method: 'POST', body: JSON.stringify({ archived }) },
  );
  clearYallaContentCache();
  return result;
}

export function yallaChapterPath(book: string, chapter: string): string {
  return `/yalla/books/${encodeURIComponent(book)}/chapters/${encodeURIComponent(chapter)}`;
}
