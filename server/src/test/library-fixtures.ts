import {
  BookSlugTakenError,
  ChapterChangedError,
  SenseTakenError,
  type BookRecord,
  type BookRepository,
  type ChapterRecord,
  type SenseRecord,
} from '../persistence/book.repository';
import type { ContentDraftRecord } from '../persistence/content-draft.repository';
import { chapterDraftPayloadSchema, type ChapterDraftPayload } from '../content/chapter-draft';

export const OWNER = '000000000000000000000001';
export const OTHER = '000000000000000000000002';

/** Library specs: `BookRepository` in memory, enough for the publish, read and remix paths. */
export function memoryBooks() {
  const books: BookRecord[] = [];
  const chapters: ChapterRecord[] = [];
  const senses: SenseRecord[] = [];
  const repo = {
    isAvailable: () => true,
    listBooks: async () => [...books],
    getBook: async (slug: string) => books.find((book) => book.slug === slug) ?? null,
    listChapters: async (slug: string) => chapters.filter((chapter) => chapter.bookSlug === slug),
    getChapter: async (slug: string, chapter: string) =>
      chapters.find((row) => row.bookSlug === slug && row.chapter === chapter) ?? null,
    listSenses: async (language: string) => senses.filter((sense) => sense.language === language),
    publishChapter: async (input: Parameters<BookRepository['publishChapter']>[0]) => {
      if (input.book.isNew) {
        if (books.some((book) => book.slug === input.book.slug)) throw new BookSlugTakenError(input.book.slug);
        books.push({
          slug: input.book.slug,
          title: input.book.title,
          language: input.book.language,
          ownerUserId: input.ownerUserId,
          visibility: 'open',
          archivedAt: null,
          createdAt: new Date().toISOString(),
        });
      }
      const chapter = String(chapters.filter((row) => row.bookSlug === input.book.slug).length + 1);
      const built = input.build(chapter);
      for (const sense of built.newSenses) {
        if (senses.some((row) => row.word === sense.word && row.sense === sense.sense)) throw new SenseTakenError(sense.id);
        senses.push({ language: sense.language, word: sense.word, sense: sense.sense, kind: sense.kind, gloss: sense.gloss, sources: [] });
      }
      const record: ChapterRecord = {
        bookSlug: input.book.slug,
        chapter,
        content: built.content,
        senseIds: built.senseIds,
        sourceId: input.sourceId,
        remixedFrom: input.remixedFrom,
        publishedAt: new Date().toISOString(),
        revision: 1,
        archivedAt: null,
      };
      chapters.push(record);
      return record;
    },
    updateChapter: async (input: Parameters<BookRepository['updateChapter']>[0]) => {
      const record = chapters.find((row) => row.bookSlug === input.bookSlug && row.chapter === input.chapter);
      if (!record || record.revision !== input.revision) throw new ChapterChangedError();
      for (const sense of input.built.newSenses) {
        senses.push({ language: sense.language, word: sense.word, sense: sense.sense, kind: sense.kind, gloss: sense.gloss, sources: [] });
      }
      Object.assign(record, { content: input.built.content, senseIds: input.built.senseIds, revision: record.revision + 1 });
      return record;
    },
    setChapterArchived: async (slug: string, chapter: string, archived: boolean) => {
      const record = chapters.find((row) => row.bookSlug === slug && row.chapter === chapter);
      if (record) record.archivedAt = archived ? new Date().toISOString() : null;
      return record ?? null;
    },
  };
  return { repo: repo as unknown as BookRepository, books, chapters, senses };
}

export const story: Array<[string, string, string]> = [
  // 시험/test is in the registry file (ch. 27): reused, not added.
  ['시험', 'test, exam', 'reuse:ko/lexeme/시험/test'],
  ['토끼', 'rabbit', 'new:rabbit'],
  ['거북이', 'turtle', 'new:turtle'],
  ['경주', 'race', 'new:race'],
  ['언덕', 'hill', 'new:hill'],
  ['낮잠', 'nap', 'new:nap'],
];

export function storyPayload(book: Partial<Pick<ChapterDraftPayload, 'bookSlug' | 'newBook'>>): ChapterDraftPayload {
  return chapterDraftPayloadSchema.parse({
    ...book,
    titleTarget: '토끼와 거북이',
    titleNative: 'The rabbit and the turtle',
    dialog: [{ speechTarget: '토끼와 거북이가 경주를 했어요.', speechNative: 'The rabbit and the turtle had a race.' }],
    vocabulary: story.map(([word, gloss, decision]) => {
      const [kind, value] = decision.split(/:(.*)/);
      return {
        targetLanguageText: word,
        nativeLanguageText: gloss,
        sense: kind === 'reuse' ? { decision: 'reuse', reuseId: value } : { decision: 'new', newSense: value, confirmed: true },
      };
    }),
    patterns: [{ patternTarget: '-았/었어요', patternNative: 'past tense, polite' }],
  });
}

export function draftOf(payload: ChapterDraftPayload, overrides: Partial<ContentDraftRecord> = {}): ContentDraftRecord {
  return {
    id: '6650f00000000000000000d1',
    ownerUserId: OWNER,
    type: 'chapter',
    sourceId: '6650f00000000000000000a1',
    title: payload.titleNative,
    payload,
    settings: { mix: 'vocabulary', questionCount: 10, optionsPerQuestion: 4 },
    problems: [],
    status: 'draft',
    shared: false,
    lastEditedByUserId: OWNER,
    resultGameId: null,
    remixedFromGameId: null,
    resultChapter: null,
    remixedFromChapter: null,
    editsChapter: null,
    revision: 1,
    createdAt: '2026-11-21T09:00:00.000Z',
    updatedAt: '2026-11-21T09:00:00.000Z',
    ...overrides,
  };
}
