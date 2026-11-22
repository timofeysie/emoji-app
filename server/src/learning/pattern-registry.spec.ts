import { findCatalogueBook } from './book-catalogue';
import { KOREAN, KOREAN_BOOK, learningObjectIri, parseLearningObjectId } from './learning-object';
import { buildPatternIndex, filePatterns, matchPatterns } from './pattern-registry';

describe('pattern registry (docs/yalla/grammar-learning-objects.md)', () => {
  const index = filePatterns(KOREAN);

  it('derives ids from the headword key and the meaning slug', () => {
    expect([...index.byId.keys()]).toContain('ko/grammar-pattern/a-eo-jida/become');
    expect([...index.byId.keys()]).toContain('ko/grammar-pattern/at-eot-deoni/did-and-then');
    expect([...index.byId.keys()]).toContain('ko/grammar-pattern/eu-l-geotgatda/seems');
    const become = index.byId.get('ko/grammar-pattern/a-eo-jida/become')!;
    expect(parseLearningObjectId(become.id)).toEqual({ language: 'ko', kind: 'grammar-pattern', word: 'a-eo-jida', sense: 'become' });
    expect(learningObjectIri(parseLearningObjectId(become.id)!)).toBe(
      'https://kogs.link/xapi/emoji-app/lo/ko/grammar-pattern/a-eo-jida/become',
    );
  });

  it('links every built-in book pattern to at least one entry, and only to patterns that exist', () => {
    const chapters = findCatalogueBook(KOREAN_BOOK)!.chapters as Array<{ chapter: number | string; patterns: unknown[] }>;
    const bookPatterns = chapters.flatMap((chapter) =>
      chapter.patterns.map((_, i) => `${KOREAN_BOOK}/ch${chapter.chapter}/patterns/${i}`),
    );
    expect(bookPatterns).toHaveLength(15);
    expect(bookPatterns.filter((ref) => !index.bySource.has(ref))).toEqual([]);
    expect([...index.bySource.keys()].filter((ref) => !bookPatterns.includes(ref))).toEqual([]);
    // A combination teaches several entries (GP5).
    expect(index.bySource.get(`${KOREAN_BOOK}/ch27/patterns/0`)!.map((p) => p.headword)).toEqual(['-아/어/여지다', '-네']);
  });

  it('matches any notation of an entry by key', () => {
    for (const spelling of ['-어(아, 여) 지다', 'A-아/어지다', '-아/어지다', '-어지다']) {
      expect(matchPatterns(index, spelling).map((p) => p.form)).toEqual(['a-eo-jida']);
    }
    expect(matchPatterns(index, '-(으)ㄹ 것 같아요').map((p) => p.meaning)).toEqual(['seems']);
    expect(matchPatterns(index, '-고 싶다')).toEqual([]);
  });

  it('refuses two entries with the same id, and a source that is not a book pattern', () => {
    const entry = { headword: '-네', meaning: 'noticing', gloss: 'noticing', spellings: [], sources: [] };
    expect(() => buildPatternIndex({ language: 'ko', reviewed: false, patterns: [entry, { ...entry, headword: '-네 ' }] })).toThrow(
      /Two pattern entries/,
    );
    expect(() =>
      buildPatternIndex({ language: 'ko', reviewed: false, patterns: [{ ...entry, sources: ['korean-language-book/ch27/vocabulary/1'] }] }),
    ).toThrow(/isn't a book pattern/);
  });
});
