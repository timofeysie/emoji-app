import {
  bookIri,
  chapterIri,
  learningObjectId,
  learningObjectIri,
  parseLearningObjectId,
  parseLearningObjectIri,
} from './learning-object';

const BASE = 'https://kogs.link/xapi/emoji-app/content';

describe('learning-object ids and IRIs', () => {
  const exam = { book: 'korean-language-book', word: '시험', sense: 'test' };

  it('keeps the readable id unencoded', () => {
    expect(learningObjectId(exam)).toBe('korean-language-book/vocabulary/시험/test');
  });

  it('percent-encodes the word in the IRI (L9)', () => {
    expect(learningObjectIri(exam)).toBe(`${BASE}/korean-language-book/vocabulary/%EC%8B%9C%ED%97%98/test`);
    expect(learningObjectIri({ ...exam, word: '보여 주다', sense: 'to-show' })).toBe(
      `${BASE}/korean-language-book/vocabulary/%EB%B3%B4%EC%97%AC%20%EC%A3%BC%EB%8B%A4/to-show`,
    );
  });

  it('gives each sense of a homograph its own IRI', () => {
    const pear = learningObjectIri({ ...exam, word: '배', sense: 'pear' });
    const ship = learningObjectIri({ ...exam, word: '배', sense: 'ship' });
    expect(pear).not.toBe(ship);
  });

  it('round-trips ids and IRIs, including spaces and parentheses', () => {
    for (const key of [exam, { ...exam, word: '(돈을) 모으다', sense: 'to-save-up-money' }]) {
      expect(parseLearningObjectId(learningObjectId(key))).toEqual(key);
      expect(parseLearningObjectIri(learningObjectIri(key))).toEqual(key);
    }
  });

  it('does not mistake chapter, book, game or foreign IRIs for learning objects', () => {
    expect(parseLearningObjectIri(chapterIri('korean-language-book', '27'))).toBeNull();
    expect(parseLearningObjectIri(bookIri('korean-language-book'))).toBeNull();
    expect(parseLearningObjectIri('https://kogs.link/xapi/emoji-app/games/g1')).toBeNull();
    expect(parseLearningObjectIri('https://example.com/content/korean-language-book/vocabulary/a/b')).toBeNull();
    expect(parseLearningObjectIri(`${BASE}/korean-language-book/vocabulary/%E0%A4%A/test`)).toBeNull();
  });

  it('builds chapter and book IRIs', () => {
    expect(chapterIri('korean-language-book', '27')).toBe(`${BASE}/korean-language-book/ch27`);
    expect(bookIri('korean-language-book')).toBe(`${BASE}/korean-language-book`);
  });

  it('rejects slugs and words that would make an ambiguous id', () => {
    expect(() => learningObjectId({ ...exam, sense: 'Test' })).toThrow(/sense/);
    expect(() => learningObjectId({ ...exam, word: 'a/b' })).toThrow(/word/);
    expect(() => bookIri('../x')).toThrow(/book/);
  });
});
