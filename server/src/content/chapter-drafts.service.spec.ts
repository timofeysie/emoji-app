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
    expect(study.patterns[0].patternTarget).toBe('VERB + -았/었어요');
    // The new pattern is added once; the reused one stays in the file.
    expect(memory.patterns).toEqual([
      expect.objectContaining({ form: 'at-eot-eoyo', meaning: 'did-polite', headword: '-았/었어요', sources: ['rabbit-stories-1a2b/ch1/patterns/0'] }),
    ]);
    expect(memory.chapters[0].patternIds).toEqual([['ko/grammar-pattern/at-eot-eoyo/did-polite'], ['ko/grammar-pattern/eu-myeon/if']]);

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
      patterns: again.patterns.map((pattern) => ({
        ...pattern,
        entries: pattern.entries.map((entry) =>
          entry.decision === 'new' ? { decision: 'reuse', reuseId: `ko/grammar-pattern/at-eot-eoyo/${entry.meaning}` } : entry,
        ),
      })),
    });
    expect(await service.publish(draftOf(reusing), OWNER)).toMatchObject({ chapter: '2' });
  });

  it('only the owner adds chapters to a book', async () => {
    await publishStory();
    const problems = await service.problems(storyPayload({ bookSlug: 'rabbit-stories-1a2b' }), { ownerUserId: OTHER, editsChapter: null });

    expect(problems).toContainEqual({ path: 'bookSlug', message: 'Chapters can only be added to your own books' });
  });

  it('Create chapter on a book page: an empty draft for the book, titled after it, publishes as its next chapter', async () => {
    await publishStory();
    const empty = chapterDraftPayloadSchema.parse({ bookSlug: 'rabbit-stories-1a2b', language: { target: 'ko', native: 'en' } });

    expect(await service.draftTitle(empty)).toBe('New chapter for Rabbit stories');
    const problems = await service.problems(empty, { ownerUserId: OWNER, editsChapter: null });
    expect(problems.filter((problem) => problem.path === 'bookSlug' || problem.path === 'language')).toEqual([]);

    // Filled in with what chapter 1 added, so nothing new needs confirming.
    const story = storyPayload({ bookSlug: 'rabbit-stories-1a2b' });
    const filled = chapterDraftPayloadSchema.parse({
      ...story,
      vocabulary: story.vocabulary.map((entry) =>
        entry.sense.decision === 'new'
          ? { ...entry, sense: { decision: 'reuse', reuseId: `ko/lexeme/${entry.targetLanguageText}/${entry.sense.newSense}` } }
          : entry,
      ),
      patterns: story.patterns.map((pattern) => ({
        ...pattern,
        entries: pattern.entries.map((entry) =>
          entry.decision === 'new' ? { decision: 'reuse', reuseId: `ko/grammar-pattern/at-eot-eoyo/${entry.meaning}` } : entry,
        ),
      })),
    });
    expect(await service.draftTitle(filled)).toBe('The rabbit and the turtle');
    expect(await service.publish(draftOf(filled), OWNER)).toMatchObject({ bookSlug: 'rabbit-stories-1a2b', chapter: '2' });
  });

  it('a chapter must be in its book’s language', async () => {
    await publishStory();
    const japanese = chapterDraftPayloadSchema.parse({ bookSlug: 'rabbit-stories-1a2b', language: { target: 'ja', native: 'en' } });

    expect(await service.problems(japanese, { ownerUserId: OWNER, editsChapter: null })).toContainEqual({
      path: 'language',
      message: '“Rabbit stories” is a book in “ko”: a chapter for it must be too, not “ja”',
    });
  });

  it('a remix keeps every learning object and credits the source by title', async () => {
    await publishStory();
    const copy = await service.copyChapter({ book: 'rabbit-stories-1a2b', chapter: '1' }, OTHER, 'remix');

    expect(copy.payload.bookSlug).toBe('');
    expect(copy.payload.vocabulary.map((entry) => entry.sense.reuseId)).toEqual(memory.chapters[0].senseIds);
    expect(copy.payload.patterns.map((pattern) => pattern.entries.map((entry) => entry.reuseId))).toEqual(memory.chapters[0].patternIds);

    const remix = chapterDraftPayloadSchema.parse({ ...copy.payload, newBook: { title: 'My remixes', slug: 'my-remixes-9f9f' } });
    await service.publish(draftOf(remix, { ownerUserId: OTHER, remixedFromChapter: copy.ref }), OTHER);

    const study = await yalla.getStudyChapter('my-remixes-9f9f', '1', OTHER);
    expect(study.owner).toBe('mine');
    expect(study.vocabulary.map((entry) => entry.learningObjectId)).toEqual(memory.chapters[0].senseIds);
    expect(memory.chapters[1].patternIds).toEqual(memory.chapters[0].patternIds);
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
    // Its patterns keep the registry file's links (GP5), combinations included.
    expect(copy.payload.patterns[0].entries.map((entry) => entry.reuseId)).toEqual([
      'ko/grammar-pattern/a-eo-jida/become',
      'ko/grammar-pattern/ne/noticing',
    ]);
    expect(await service.problems(copy.payload, { ownerUserId: OWNER, editsChapter: null })).not.toContainEqual(
      expect.objectContaining({ path: expect.stringMatching(/^patterns/) }),
    );
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

    // A published pattern keeps its entries; another can be added to it.
    const unlinked = chapterDraftPayloadSchema.parse({ ...appended, patterns: appended.patterns.map((pattern) => ({ ...pattern, entries: [] })) });
    expect(await service.problems(unlinked, { ownerUserId: OWNER, ...edits })).toContainEqual(
      expect.objectContaining({ path: 'patterns.0.entries', message: expect.stringContaining('published links stay') }),
    );

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

  it('finds grammar patterns by key: the file, the built-in book’s combinations and the library', async () => {
    await publishStory();
    const found = await content.findPatterns('ko', ['A-아/어지다', '계속 더 ADJECTIVE + -아/어/여지네', 'VERB + -았/었어요', '-아/어/여지네요', 'VERB']);
    const ids = (list: Array<{ id: string }>) => list.map((pattern) => pattern.id);

    expect(ids(found[0].exact)).toEqual(['ko/grammar-pattern/a-eo-jida/become']);
    expect(found[0].exact[0]).toMatchObject({ headword: '-아/어/여지다', from: 'registry' });
    // A spelling the built-in book uses for a combination matches all its entries.
    expect(ids(found[1].exact)).toEqual(['ko/grammar-pattern/a-eo-jida/become', 'ko/grammar-pattern/ne/noticing']);
    // The library chapter recorded its spelling on the entry it added.
    expect(found[2].exact).toEqual([
      { id: 'ko/grammar-pattern/at-eot-eoyo/did-polite', headword: '-았/었어요', gloss: 'did (polite past)', from: 'library' },
    ]);
    // A conjugated form isn't an exact match, but what it contains is suggested (a contraction like 졌 isn't found).
    expect(found[3].exact).toEqual([]);
    expect(ids(found[3].contained)).toContain('ko/grammar-pattern/a-eo-jida/become');
    expect(found[4]).toMatchObject({ key: null, problem: expect.stringContaining('no Korean'), exact: [], contained: [] });
  });
});
