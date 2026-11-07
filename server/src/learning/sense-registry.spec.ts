import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chapterVocabulary,
  ChapterVocabulary,
  emptySenseRegistry,
  glossParts,
  normaliseWord,
  SenseRegistry,
  senseSlug,
  updateSenseRegistry,
} from './sense-registry';

const contentDir = join(__dirname, '../games/content');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(contentDir, name), 'utf8')) as unknown;
}

function chapter(number: string, entries: [string, string][], ids?: number[]): ChapterVocabulary {
  return chapterVocabulary({
    chapter: number,
    vocabulary: entries.map(([targetLanguageText, nativeLanguageText], index) => ({
      ...(ids ? { id: ids[index] } : {}),
      targetLanguageText,
      nativeLanguageText,
    })),
  });
}

describe('normaliseWord', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normaliseWord(' 보여   주다 ')).toBe('보여 주다');
  });

  it('composes decomposed Hangul (NFC)', () => {
    expect(normaliseWord('시험'.normalize('NFD'))).toBe('시험');
  });
});

describe('glossParts', () => {
  it('splits on commas only, lower-cased', () => {
    expect(glossParts('Test, exam ')).toEqual(['test', 'exam']);
    expect(glossParts('to leave school/office early')).toEqual(['to leave school/office early']);
  });
});

describe('senseSlug', () => {
  it('slugs the first meaning', () => {
    expect(senseSlug('test, exam')).toBe('test');
    expect(senseSlug('to get (sick), to catch a disease')).toBe('to-get-sick');
    expect(senseSlug("someone's house/place (honorific)")).toBe('someone-s-house-place-honorific');
  });

  it('cuts long meanings at a word break', () => {
    const slug = senseSlug('to take a very long detour around the whole city and back again');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect('to-take-a-very-long-detour-around-the-whole-city'.startsWith(slug)).toBe(true);
  });

  it('falls back when nothing is ASCII', () => {
    expect(senseSlug('—')).toBe('sense');
  });
});

describe('chapterVocabulary', () => {
  it('uses the entry id for sourceRef when present', () => {
    expect(chapter('5', [['시험', 'test']], [346]).entries[0].sourceRef).toBe('ch5/vocabulary/346');
  });

  it('falls back to the index without ids', () => {
    expect(chapter('5', [['시험', 'test']]).entries[0].sourceRef).toBe('ch5/vocabulary/0');
  });

  it('reads Korean/English swapped entries the right way round', () => {
    const result = chapter('5', [['thought', '생각']]);
    expect(result.problems).toEqual([]);
    expect(result.entries[0]).toEqual({ sourceRef: 'ch5/vocabulary/0', word: '생각', gloss: 'thought', swapped: true });
  });

  it('reads ch. 28 with Korean as the target, like the other chapters', () => {
    const ch28 = chapterVocabulary(readJson('chapter28Data.json'));
    expect(ch28.entries).toHaveLength(30);
    expect(ch28.entries.every((entry) => !entry.swapped)).toBe(true);
    expect(ch28.entries[0]).toEqual({ sourceRef: 'ch28/vocabulary/0', word: '생각', gloss: 'thought', swapped: false });
  });

  it('reports entries with no Korean and duplicate ids', () => {
    const result = chapter('5', [['hello', 'hi'], ['시험', 'test'], ['수업', 'class']], [0, 1, 1]);
    expect(result.entries.map((entry) => entry.word)).toEqual(['시험']);
    expect(result.problems).toEqual([
      "ch5/vocabulary/0: no Korean text in 'hello' / 'hi'",
      'ch5/vocabulary/1: duplicate entry id',
    ]);
  });
});

describe('updateSenseRegistry', () => {
  const empty = emptySenseRegistry('ko');

  it('creates a sense for a new word', () => {
    const { registry, added } = updateSenseRegistry(empty, 'test-book', [chapter('1', [['시험', 'test, exam']])]);
    expect(registry.words['시험']).toEqual([{ sense: 'test', kind: 'lexeme', gloss: 'test, exam', sources: ['test-book/ch1/vocabulary/0'] }]);
    expect(added).toEqual([{ sourceRef: 'test-book/ch1/vocabulary/0', word: '시험', sense: 'test' }]);
  });

  it('attaches the same word with an overlapping gloss to one sense, across and within chapters', () => {
    const { registry, attached, conflicts } = updateSenseRegistry(empty, 'test-book', [
      chapter('1', [['타다', 'to ride']]),
      chapter('2', [['타다', 'to take, to ride'], ['타다', 'to ride']]),
    ]);
    expect(conflicts).toEqual([]);
    expect(registry.words['타다']).toEqual([
      { sense: 'to-ride', kind: 'lexeme', gloss: 'to ride', sources: ['test-book/ch1/vocabulary/0', 'test-book/ch2/vocabulary/0', 'test-book/ch2/vocabulary/1'] },
    ]);
    expect(attached).toHaveLength(2);
  });

  it('stops on a known word with a different meaning (homograph)', () => {
    const { registry, conflicts } = updateSenseRegistry(empty, 'test-book', [
      chapter('1', [['배', 'pear']]),
      chapter('2', [['배', 'ship']]),
    ]);
    expect(registry.words['배']).toHaveLength(1);
    expect(conflicts).toEqual([
      {
        sourceRef: 'test-book/ch2/vocabulary/0',
        word: '배',
        gloss: 'ship',
        candidates: [{ sense: 'pear', kind: 'lexeme', gloss: 'pear', sources: ['test-book/ch1/vocabulary/0'] }],
      },
    ]);
  });

  it('keeps a hand-resolved homograph and gives repeats of it the right sense', () => {
    const resolved: SenseRegistry = {
      language: 'ko',
      words: {
        배: [
          { sense: 'pear', kind: 'lexeme', gloss: 'pear', sources: ['test-book/ch1/vocabulary/0'] },
          { sense: 'ship', kind: 'lexeme', gloss: 'ship', sources: ['test-book/ch2/vocabulary/0'] },
        ],
      },
    };
    const result = updateSenseRegistry(resolved, 'test-book', [
      chapter('1', [['배', 'pear']]),
      chapter('2', [['배', 'ship']]),
      chapter('3', [['배', 'ship, boat']]),
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.attached).toEqual([{ sourceRef: 'test-book/ch3/vocabulary/0', word: '배', sense: 'ship' }]);
  });

  it('is a no-op when run again', () => {
    const chapters = [chapter('1', [['시험', 'test'], ['수업', 'class']])];
    const first = updateSenseRegistry(empty, 'test-book', chapters);
    const second = updateSenseRegistry(first.registry, 'test-book', chapters);
    expect(second.registry).toEqual(first.registry);
    expect([...second.added, ...second.attached, ...second.conflicts, ...second.problems]).toEqual([]);
  });

  it('does not change the registry it was given', () => {
    const registry = emptySenseRegistry('ko');
    updateSenseRegistry(registry, 'test-book', [chapter('1', [['시험', 'test']])]);
    expect(registry.words).toEqual({});
  });

  it('reports registry entries the chapter files no longer match', () => {
    const registry: SenseRegistry = {
      language: 'ko',
      words: {
        시험: [{ sense: 'test', kind: 'lexeme', gloss: 'test', sources: ['test-book/ch1/vocabulary/0'] }],
        수업: [{ sense: 'class', kind: 'lexeme', gloss: 'class', sources: ['test-book/ch1/vocabulary/1', 'test-book/ch9/vocabulary/0'] }],
      },
    };
    const { problems } = updateSenseRegistry(registry, 'test-book', [chapter('1', [['숙제', 'homework']])]);
    expect(problems).toEqual([
      "test-book/ch1/vocabulary/0: registered as '시험' but the chapter now says '숙제'",
      'test-book/ch1/vocabulary/1: registered but no longer in chapter 1',
    ]);
  });

  it('reports a sourceRef registered under two senses', () => {
    const registry: SenseRegistry = {
      language: 'ko',
      words: {
        배: [
          { sense: 'pear', kind: 'lexeme', gloss: 'pear', sources: ['test-book/ch1/vocabulary/0'] },
          { sense: 'ship', kind: 'lexeme', gloss: 'ship', sources: ['test-book/ch1/vocabulary/0'] },
        ],
      },
    };
    expect(updateSenseRegistry(registry, 'test-book', [chapter('1', [['배', 'pear']])]).problems).toEqual([
      "test-book/ch1/vocabulary/0: registered under both '배/pear' and '배/ship'",
    ]);
  });
});

describe('updateSenseRegistry across books (language-level registry)', () => {
  it('makes a new multi-word entry an expression', () => {
    const { registry } = updateSenseRegistry(emptySenseRegistry('ko'), 'test-book', [chapter('1', [['보여 주다', 'to show']])]);
    expect(registry.words['보여 주다'][0].kind).toBe('expression');
  });

  it('attaches the same sense from a second book to the one learning object', () => {
    const first = updateSenseRegistry(emptySenseRegistry('ko'), 'book-a', [chapter('1', [['주다', 'to give']])]);
    const second = updateSenseRegistry(first.registry, 'book-b', [chapter('1', [['주다', 'to give']])]);
    expect(second.problems).toEqual([]);
    expect(second.registry.words['주다']).toEqual([
      { sense: 'to-give', kind: 'lexeme', gloss: 'to give', sources: ['book-a/ch1/vocabulary/0', 'book-b/ch1/vocabulary/0'] },
    ]);
  });

  it("does not report another book's entries as missing from this book's chapters", () => {
    const registry: SenseRegistry = {
      language: 'ko',
      words: { 주다: [{ sense: 'to-give', kind: 'lexeme', gloss: 'to give', sources: ['book-a/ch1/vocabulary/5'] }] },
    };
    expect(updateSenseRegistry(registry, 'book-b', [chapter('1', [['시험', 'test']])]).problems).toEqual([]);
  });

  it('reports unknown kinds and unqualified sources', () => {
    const registry = {
      language: 'ko',
      words: { 시험: [{ sense: 'test', kind: 'noun', gloss: 'test', sources: ['ch1/vocabulary/0'] }] },
    } as unknown as SenseRegistry;
    expect(updateSenseRegistry(registry, 'test-book', []).problems).toEqual([
      "시험/test: unknown kind 'noun'",
      "시험/test: source 'ch1/vocabulary/0' is not book/chNN/section/N",
    ]);
  });
});

describe('committed Korean registry', () => {
  it('covers every korean-language-book chapter file in content/ (run `npm run content:senses` if this fails)', () => {
    const registry = readJson('ko-senses.json') as SenseRegistry;
    const chapters = readdirSync(contentDir)
      .filter((name) => /^chapter\d+Data\.json$/.test(name))
      .map((name) => chapterVocabulary(readJson(name)));

    const update = updateSenseRegistry(registry, 'korean-language-book', chapters);
    expect(update.problems).toEqual([]);
    expect(update.conflicts).toEqual([]);
    expect([...update.added, ...update.attached]).toEqual([]);
    expect(registry.language).toBe('ko');
  });
});
