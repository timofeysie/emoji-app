import {
  bookIri,
  chapterIri,
  defaultKind,
  LEARNING_OBJECT_TYPES,
  learningObjectId,
  learningObjectIri,
  LearningObjectKey,
  parseLearningObjectId,
  parseLearningObjectIri,
  parseQualifiedSourceRef,
  qualifiedSourceRef,
} from './learning-object';

const BASE = 'https://kogs.link/xapi/emoji-app';

describe('learning-object ids and IRIs', () => {
  const exam: LearningObjectKey = { language: 'ko', kind: 'lexeme', word: '시험', sense: 'test' };
  const show: LearningObjectKey = { language: 'ko', kind: 'expression', word: '보여 주다', sense: 'to-show' };

  it('keeps the readable id unencoded, language and kind first (A1, A3)', () => {
    expect(learningObjectId(exam)).toBe('ko/lexeme/시험/test');
    expect(learningObjectId(show)).toBe('ko/expression/보여 주다/to-show');
  });

  it('is language-scoped, with no book in the IRI, and percent-encodes the word (L9)', () => {
    expect(learningObjectIri(exam)).toBe(`${BASE}/lo/ko/lexeme/%EC%8B%9C%ED%97%98/test`);
    expect(learningObjectIri(show)).toBe(`${BASE}/lo/ko/expression/%EB%B3%B4%EC%97%AC%20%EC%A3%BC%EB%8B%A4/to-show`);
  });

  it('types each kind as its own activity type', () => {
    expect(LEARNING_OBJECT_TYPES).toEqual({
      lexeme: `${BASE}/activity-types/lexeme-sense`,
      expression: `${BASE}/activity-types/expression`,
    });
  });

  it('gives each sense of a homograph its own IRI', () => {
    const pear = learningObjectIri({ ...exam, word: '배', sense: 'pear' });
    const ship = learningObjectIri({ ...exam, word: '배', sense: 'ship' });
    expect(pear).not.toBe(ship);
  });

  it('round-trips ids and IRIs, including spaces and parentheses', () => {
    for (const key of [exam, show, { ...show, word: '(돈을) 모으다', sense: 'to-save-up-money' }]) {
      expect(parseLearningObjectId(learningObjectId(key))).toEqual(key);
      expect(parseLearningObjectIri(learningObjectIri(key))).toEqual(key);
    }
  });

  it('does not mistake chapter, book, game, old book-scoped or foreign IRIs for learning objects', () => {
    expect(parseLearningObjectIri(chapterIri('korean-language-book', '27'))).toBeNull();
    expect(parseLearningObjectIri(bookIri('korean-language-book'))).toBeNull();
    expect(parseLearningObjectIri(`${BASE}/games/g1`)).toBeNull();
    expect(parseLearningObjectIri(`${BASE}/content/korean-language-book/vocabulary/%EC%8B%9C%ED%97%98/test`)).toBeNull();
    expect(parseLearningObjectIri('https://example.com/lo/ko/lexeme/a/b')).toBeNull();
    expect(parseLearningObjectIri(`${BASE}/lo/ko/lexeme/%E0%A4%A/test`)).toBeNull();
    expect(parseLearningObjectIri(`${BASE}/lo/ko/pattern/a/b`)).toBeNull();
  });

  it('builds chapter and book IRIs (provenance, unchanged)', () => {
    expect(chapterIri('korean-language-book', '27')).toBe(`${BASE}/content/korean-language-book/ch27`);
    expect(bookIri('korean-language-book')).toBe(`${BASE}/content/korean-language-book`);
  });

  it('rejects keys that would make an ambiguous id', () => {
    expect(() => learningObjectId({ ...exam, sense: 'Test' })).toThrow(/sense/);
    expect(() => learningObjectId({ ...exam, word: 'a/b' })).toThrow(/word/);
    expect(() => learningObjectId({ ...exam, language: 'Korean' })).toThrow(/language/);
    expect(() => learningObjectId({ ...exam, kind: 'pattern' as never })).toThrow(/kind/);
    expect(() => bookIri('../x')).toThrow(/book/);
  });
});

describe('defaultKind', () => {
  it('makes multi-word entries expressions', () => {
    expect(defaultKind('시험')).toBe('lexeme');
    expect(defaultKind('보여 주다')).toBe('expression');
    expect(defaultKind('(돈을) 모으다')).toBe('expression');
  });
});

describe('qualified source refs', () => {
  it('round-trips', () => {
    expect(qualifiedSourceRef('korean-language-book', 'ch27/vocabulary/1')).toBe('korean-language-book/ch27/vocabulary/1');
    expect(parseQualifiedSourceRef('korean-language-book/ch27/vocabulary/1')).toEqual({
      book: 'korean-language-book',
      sourceRef: 'ch27/vocabulary/1',
    });
  });

  it('rejects anything else', () => {
    expect(() => qualifiedSourceRef('korean-language-book', 'vocabulary/1')).toThrow(/sourceRef/);
    expect(parseQualifiedSourceRef('ch27/vocabulary/1')).toBeNull();
    expect(parseQualifiedSourceRef('Book/ch27/vocabulary/1')).toBeNull();
  });
});
