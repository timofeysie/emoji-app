import { compose, decompose, isHangulSyllable, misspellings, syllableVariants } from './hangul';
import { createRng } from './seeded-random';

describe('hangul', () => {
  it('splits and rebuilds syllables', () => {
    // 사 = ㅅ(9) + ㅏ(0), no final; 감 = ㄱ(0) + ㅏ(0) + ㅁ(16)
    expect(decompose('사')).toEqual({ initial: 9, vowel: 0, final: 0 });
    expect(decompose('감')).toEqual({ initial: 0, vowel: 0, final: 16 });
    expect(compose({ initial: 9, vowel: 13, final: 0 })).toBe('수');
    for (const syllable of ['간', '호', '사', '독', '감', '편', '붓', '없']) {
      expect(compose(decompose(syllable))).toBe(syllable);
    }
  });

  it('recognises only precomposed syllables', () => {
    expect(isHangulSyllable('가')).toBe(true);
    expect(isHangulSyllable('ㄱ')).toBe(false);
    expect(isHangulSyllable('a')).toBe(false);
    expect(isHangulSyllable(' ')).toBe(false);
    expect(() => decompose('a')).toThrow();
  });

  it('gives the review example variants of 사', () => {
    // docs/games/game-planning.md: 간호사 → 간호수 / 간호서 / 간호아
    expect(syllableVariants('사')).toEqual(expect.arrayContaining(['수', '서', '아']));
    expect(syllableVariants('사')).not.toContain('사');
  });

  it('changes the same syllable in every misspelling', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = misspellings('간호사', 3, createRng(seed));
      expect(result).toHaveLength(3);
      expect(new Set(result).size).toBe(3);
      const changedPositions = new Set(
        result.map((word) => [...word].findIndex((char, i) => char !== [...'간호사'][i])),
      );
      expect(changedPositions.size).toBe(1);
    }
  });

  it('never changes a dictionary-form 다 ending', () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const word of misspellings('붓다', 3, createRng(seed))) {
        expect(word.endsWith('다')).toBe(true);
        expect(word).not.toBe('붓다');
      }
      for (const word of misspellings('기운이 없다', 3, createRng(seed))) {
        expect(word.endsWith('다')).toBe(true);
        expect(word).toContain(' ');
      }
    }
  });

  it('changes a one-syllable word', () => {
    const result = misspellings('열', 3, createRng(7));
    expect(result).toHaveLength(3);
    expect(result).not.toContain('열');
  });

  it('skips excluded real words', () => {
    const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(seeds.some((seed) => misspellings('간호사', 3, createRng(seed)).includes('간호수'))).toBe(true);
    const excluded = new Set(['간호수']);
    for (const seed of seeds) {
      expect(misspellings('간호사', 3, createRng(seed), excluded)).not.toContain('간호수');
    }
  });

  it('returns nothing when no syllable has enough variants', () => {
    expect(misspellings('abc', 3, createRng(1))).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    expect(misspellings('편도선', 3, createRng(26))).toEqual(misspellings('편도선', 3, createRng(26)));
  });
});
