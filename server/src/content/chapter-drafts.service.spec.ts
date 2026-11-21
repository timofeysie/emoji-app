import { BookContentService } from '../learning/book-content.service';
import { KOREAN_BOOK } from '../learning/learning-object';
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
import { YallaLibraryService } from '../yalla/yalla-library.service';
import { chapterDraftPayloadSchema, type ChapterDraftPayload } from './chapter-draft';
import { ChapterDraftError, ChapterDraftsService } from './chapter-drafts.service';

const OWNER = '000000000000000000000001';
const OTHER = '000000000000000000000002';

/** `BookRepository` in memory, enough for the publish, read and remix paths. */
function memoryBooks() {
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

const story: Array<[string, string, string]> = [
  // 시험/test is in the registry file (ch. 27): reused, not added.
  ['시험', 'test, exam', 'reuse:ko/lexeme/시험/test'],
  ['토끼', 'rabbit', 'new:rabbit'],
  ['거북이', 'turtle', 'new:turtle'],
  ['경주', 'race', 'new:race'],
  ['언덕', 'hill', 'new:hill'],
  ['낮잠', 'nap', 'new:nap'],
];

function storyPayload(book: Partial<Pick<ChapterDraftPayload, 'bookSlug' | 'newBook'>>): ChapterDraftPayload {
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

function draftOf(payload: ChapterDraftPayload, overrides: Partial<ContentDraftRecord> = {}): ContentDraftRecord {
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

describe('ChapterDraftsService with YALLA', () => {
  let memory: ReturnType<typeof memoryBooks>;
  let service: ChapterDraftsService;
  let yalla: YallaLibraryService;
  let content: BookContentService;

  beforeEach(() => {
    memory = memoryBooks();
    content = new BookContentService(memory.repo);
    service = new ChapterDraftsService(memory.repo, content);
    yalla = new YallaLibraryService(memory.repo, content);
  });

  async function publishStory(): Promise<ChapterRecord> {
    return service.publish(draftOf(storyPayload({ newBook: { title: 'Rabbit stories', slug: 'rabbit-stories-1a2b' } })), OWNER);
  }

  it('publishes chapter 1 of a new book with its new senses, and YALLA shows it to everyone', async () => {
    const chapter = await publishStory();

    expect(chapter).toMatchObject({ bookSlug: 'rabbit-stories-1a2b', chapter: '1' });
    expect(memory.senses.map((sense) => sense.sense)).toEqual(['rabbit', 'turtle', 'race', 'hill', 'nap']);

    const study = await yalla.getStudyChapter('rabbit-stories-1a2b', '1', OTHER);
    expect(study).toMatchObject({ owner: 'other', bookTitle: 'Rabbit stories', archived: false });
    expect(study.vocabulary.map((entry) => [entry.sourceRef, entry.learningObjectId])).toEqual([
      ['ch1/vocabulary/0', 'ko/lexeme/시험/test'],
      ['ch1/vocabulary/1', 'ko/lexeme/토끼/rabbit'],
      ['ch1/vocabulary/2', 'ko/lexeme/거북이/turtle'],
      ['ch1/vocabulary/3', 'ko/lexeme/경주/race'],
      ['ch1/vocabulary/4', 'ko/lexeme/언덕/hill'],
      ['ch1/vocabulary/5', 'ko/lexeme/낮잠/nap'],
    ]);
    expect(study.patterns[0].patternTarget).toBe('-았/었어요');

    const books = await yalla.listBooks(OTHER);
    expect(books.map((book) => [book.book, book.owner])).toEqual([
      [KOREAN_BOOK, 'built-in'],
      ['rabbit-stories-1a2b', 'other'],
    ]);
  });

  it('a second publish to the same book is chapter 2, and a sense added meanwhile must be reused', async () => {
    await publishStory();
    const again = storyPayload({ bookSlug: 'rabbit-stories-1a2b' });

    await expect(service.publish(draftOf(again), OWNER)).rejects.toMatchObject({
      status: 400,
      problems: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('already exists; reuse it') })]),
    });

    const reusing = chapterDraftPayloadSchema.parse({
      ...again,
      vocabulary: again.vocabulary.map((entry) =>
        entry.sense.decision === 'new'
          ? { ...entry, sense: { ...entry.sense, decision: 'reuse', reuseId: `ko/lexeme/${entry.targetLanguageText}/${entry.sense.newSense}` } }
          : entry,
      ),
    });
    expect(await service.publish(draftOf(reusing), OWNER)).toMatchObject({ chapter: '2' });
  });

  it('only the owner adds chapters to a book', async () => {
    await publishStory();
    const problems = await service.problems(storyPayload({ bookSlug: 'rabbit-stories-1a2b' }), { ownerUserId: OTHER, editsChapter: null });

    expect(problems).toContainEqual({ path: 'bookSlug', message: 'Chapters can only be added to your own books' });
  });

  it('a remix keeps every learning object and credits the source by title', async () => {
    await publishStory();
    const copy = await service.copyChapter({ book: 'rabbit-stories-1a2b', chapter: '1' }, OTHER, 'remix');

    expect(copy.payload.bookSlug).toBe('');
    expect(copy.payload.vocabulary.map((entry) => entry.sense.reuseId)).toEqual(memory.chapters[0].senseIds);

    const remix = chapterDraftPayloadSchema.parse({ ...copy.payload, newBook: { title: 'My remixes', slug: 'my-remixes-9f9f' } });
    await service.publish(draftOf(remix, { ownerUserId: OTHER, remixedFromChapter: copy.ref }), OTHER);

    const study = await yalla.getStudyChapter('my-remixes-9f9f', '1', OTHER);
    expect(study.owner).toBe('mine');
    expect(study.vocabulary.map((entry) => entry.learningObjectId)).toEqual(memory.chapters[0].senseIds);
    expect(study.remixedFrom).toEqual({
      book: 'rabbit-stories-1a2b',
      chapter: '1',
      bookTitle: 'Rabbit stories',
      chapterTitle: 'The rabbit and the turtle',
    });
  });

  it('remixes a built-in chapter with its registered senses (ch. 28’s swapped fields fixed)', async () => {
    const copy = await service.copyChapter({ book: KOREAN_BOOK, chapter: '28' }, OTHER, 'remix');

    expect(copy.payload.vocabulary.length).toBeGreaterThan(5);
    expect(copy.payload.vocabulary.every((entry) => /[가-힯]/.test(entry.targetLanguageText))).toBe(true);
    expect(copy.payload.vocabulary.every((entry) => entry.sense.decision === 'reuse')).toBe(true);
    await expect(service.copyChapter({ book: KOREAN_BOOK, chapter: '28' }, OWNER, 'edit')).rejects.toBeInstanceOf(ChapterDraftError);
  });

  it('an edit can correct glosses and append words, but not reorder; only the owner edits', async () => {
    await publishStory();
    await expect(service.copyChapter({ book: 'rabbit-stories-1a2b', chapter: '1' }, OTHER, 'edit')).rejects.toMatchObject({ status: 403 });

    const copy = await service.copyChapter({ book: 'rabbit-stories-1a2b', chapter: '1' }, OWNER, 'edit');
    const edits = { editsChapter: copy.ref };
    const appended = chapterDraftPayloadSchema.parse({
      ...copy.payload,
      vocabulary: [
        ...copy.payload.vocabulary.map((entry, i) => (i === 1 ? { ...entry, nativeLanguageText: 'rabbit, bunny' } : entry)),
        { targetLanguageText: '이기다', nativeLanguageText: 'to win', sense: { decision: 'new', newSense: 'to-win', confirmed: true } },
      ],
    });
    expect(await service.problems(appended, { ownerUserId: OWNER, ...edits })).toEqual([]);
    await service.publish(draftOf(appended, edits), OWNER);

    const study = await yalla.getStudyChapter('rabbit-stories-1a2b', '1', OWNER);
    expect(study.revision).toBe(2);
    expect(study.vocabulary[1]).toMatchObject({ gloss: 'rabbit, bunny', learningObjectId: 'ko/lexeme/토끼/rabbit' });
    expect(study.vocabulary[6]).toMatchObject({ sourceRef: 'ch1/vocabulary/6', learningObjectId: 'ko/lexeme/이기다/to-win' });

    const reordered = chapterDraftPayloadSchema.parse({ ...appended, vocabulary: [...appended.vocabulary].reverse() });
    expect((await service.problems(reordered, { ownerUserId: OWNER, editsChapter: copy.ref })).length).toBeGreaterThan(0);
  });

  it('archiving hides a chapter from others but keeps it readable by link; only the owner archives', async () => {
    await publishStory();
    await expect(service.setArchived({ book: 'rabbit-stories-1a2b', chapter: '1' }, OTHER, true)).rejects.toMatchObject({ status: 403 });
    await service.setArchived({ book: 'rabbit-stories-1a2b', chapter: '1' }, OWNER, true);

    expect((await yalla.listBooks(OTHER)).map((book) => book.book)).toEqual([KOREAN_BOOK]);
    expect((await yalla.getBook('rabbit-stories-1a2b', OWNER)).chapters[0].archived).toBe(true);
    expect(await yalla.getStudyChapter('rabbit-stories-1a2b', '1', OTHER)).toMatchObject({ archived: true });
  });

  it('finds senses from the registry file and the library', async () => {
    await publishStory();

    expect(await content.findSenses('ko', ['시험', '토끼', '없는말'])).toEqual([
      { word: '시험', senses: [{ id: 'ko/lexeme/시험/test', gloss: 'test, exam', kind: 'lexeme', from: 'registry' }] },
      { word: '토끼', senses: [{ id: 'ko/lexeme/토끼/rabbit', gloss: 'rabbit', kind: 'lexeme', from: 'library' }] },
      { word: '없는말', senses: [] },
    ]);
  });
});
