import {
  buildBookContent,
  chapterLearningObjects,
  getBookContent,
  UnknownBookError,
  UnknownChapterError,
  UnregisteredSensesError,
} from './book-content';
import { KOREAN_BOOK } from './learning-object';

describe('korean-language-book content', () => {
  const content = getBookContent(KOREAN_BOOK);

  it('ships chapters 26–30', () => {
    expect([...content.chapters.keys()]).toEqual(['26', '27', '28', '29', '30']);
  });

  it('lists ch. 27 as 14 learning objects in chapter order', () => {
    const objects = chapterLearningObjects(content, '27');
    expect(objects).toHaveLength(14);
    expect(objects[1]).toEqual({
      book: KOREAN_BOOK,
      word: '시험',
      sense: 'test',
      id: 'korean-language-book/vocabulary/시험/test',
      gloss: 'test, exam',
      sourceRefs: ['ch27/vocabulary/1'],
    });
  });

  it('gives a word shared by two chapters the same id (L2)', () => {
    const show = (chapter: string) => chapterLearningObjects(content, chapter).find((object) => object.word === '보여 주다');
    expect(show('26')?.id).toBe(show('27')?.id);
  });

  it('merges a word listed twice in one chapter into one learning object', () => {
    const objects = chapterLearningObjects(content, '29');
    expect(objects).toHaveLength(53 - 6);
    expect(objects.find((object) => object.word === '지하철')?.sourceRefs).toEqual([
      'ch29/vocabulary/14',
      'ch29/vocabulary/23',
    ]);
  });

  it('throws for an unknown book or chapter', () => {
    expect(() => getBookContent('no-such-book')).toThrow(UnknownBookError);
    expect(() => chapterLearningObjects(content, '99')).toThrow(UnknownChapterError);
  });
});

describe('chapterLearningObjects', () => {
  const chapter = {
    chapter: '1',
    vocabulary: [
      { targetLanguageText: '배', nativeLanguageText: 'pear' },
      { targetLanguageText: '배', nativeLanguageText: 'ship' },
      { targetLanguageText: '시험', nativeLanguageText: 'test' },
    ],
  };

  it('keeps two senses of one word apart', () => {
    const content = buildBookContent(
      {
        book: 'test-book',
        words: {
          배: [
            { sense: 'pear', gloss: 'pear', sources: ['ch1/vocabulary/0'] },
            { sense: 'ship', gloss: 'ship', sources: ['ch1/vocabulary/1'] },
          ],
          시험: [{ sense: 'test', gloss: 'test', sources: ['ch1/vocabulary/2'] }],
        },
      },
      [chapter],
    );
    expect(chapterLearningObjects(content, '1').map((object) => object.id)).toEqual([
      'test-book/vocabulary/배/pear',
      'test-book/vocabulary/배/ship',
      'test-book/vocabulary/시험/test',
    ]);
  });

  it('refuses a chapter with unregistered entries', () => {
    const content = buildBookContent(
      { book: 'test-book', words: { 배: [{ sense: 'pear', gloss: 'pear', sources: ['ch1/vocabulary/0'] }] } },
      [chapter],
    );
    expect(() => chapterLearningObjects(content, '1')).toThrow(UnregisteredSensesError);
    try {
      chapterLearningObjects(content, '1');
    } catch (error) {
      expect((error as UnregisteredSensesError).sourceRefs).toEqual(['ch1/vocabulary/1', 'ch1/vocabulary/2']);
    }
  });
});
