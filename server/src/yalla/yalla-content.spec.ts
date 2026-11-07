import { UnknownBookError, UnknownChapterError } from '../learning/book-content';
import { KOREAN_BOOK } from '../learning/learning-object';
import { getBook, getStudyChapter, listBooks } from './yalla-content';

describe('YALLA study content', () => {
  it('lists the Korean book with its chapters in order', () => {
    const books = listBooks();

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      book: KOREAN_BOOK,
      title: 'Real-Life Korean Conversations: Intermediate',
      language: 'ko',
    });
    expect(books[0].chapters.map((chapter) => chapter.chapter)).toEqual(['26', '27', '28', '29', '30']);
    expect(books[0].chapters[1]).toEqual({
      chapter: '27',
      titleTarget: '그냥 몸이 좀 안 좋네.',
      titleNative: 'I just don’t feel well.',
    });
  });

  it('collapses stray whitespace in titles', () => {
    const chapter30 = getBook(KOREAN_BOOK).chapters.find((chapter) => chapter.chapter === '30');

    expect(chapter30?.titleNative).toBe('This is my first time on an airplane.');
  });

  it('returns a whole chapter: dialog, vocabulary with learning objects, and patterns', () => {
    const chapter = getStudyChapter(KOREAN_BOOK, '27');

    expect(chapter.dialog).toHaveLength(25);
    expect(chapter.dialog[0]).toEqual({
      speakerNameTarget: '다영',
      speakerNameNative: 'Da-yeong',
      speechTarget: '다희야, 왜 그래? 어디 아파? 안색이 안 좋은데?',
      speechNative: 'Da-hee. What’s wrong? Are you sick? You don’t look well.',
    });
    expect(chapter.vocabulary).toHaveLength(14);
    expect(chapter.vocabulary[0]).toMatchObject({ sourceRef: 'ch27/vocabulary/0', word: '정도' });
    expect(chapter.vocabulary.every((entry) => entry.learningObjectId?.startsWith('ko/'))).toBe(true);
    expect(chapter.patterns).toHaveLength(3);
    expect(chapter.patterns[0].sampleSentences.length).toBeGreaterThan(0);
  });

  it('uses the registry’s normalised vocabulary, so swapped entries read Korean → English', () => {
    const hangul = /[가-힯]/;

    for (const entry of getStudyChapter(KOREAN_BOOK, '28').vocabulary) {
      expect(entry.word).toMatch(hangul);
      expect(entry.gloss).not.toMatch(hangul);
    }
  });

  it('refuses an unknown book or chapter', () => {
    expect(() => getBook('no-such-book')).toThrow(UnknownBookError);
    expect(() => getStudyChapter(KOREAN_BOOK, '99')).toThrow(UnknownChapterError);
  });
});
