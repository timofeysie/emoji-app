import { BookContentService } from '../learning/book-content.service';
import { KOREAN_BOOK } from '../learning/learning-object';
import type { ChapterRecord } from '../persistence/book.repository';
import { draftOf, memoryBooks, OTHER, OWNER, storyPayload } from '../test/library-fixtures';
import { YallaLibraryService } from '../yalla/yalla-library.service';
import { chapterDraftPayloadSchema } from './chapter-draft';
import { ChapterDraftError, ChapterDraftsService } from './chapter-drafts.service';

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
