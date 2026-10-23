import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from './seeded-random';
import {
  canBuildItem,
  firstSense,
  generateVocabQuiz,
  generateVocabQuizForPicks,
  readingItem,
  termsFromChapter,
  toQuestionInput,
  VocabChoiceItem,
  writingItem,
} from './vocab-choice';

const chapter26 = JSON.parse(
  readFileSync(join(__dirname, '../content/chapter26Data.json'), 'utf8'),
) as unknown;
const terms = termsFromChapter(chapter26);
const nurse = terms.find((term) => term.target === '간호사')!;

function correct(item: VocabChoiceItem): string {
  return item.options.find((option) => option.isCorrect)!.text;
}

describe('termsFromChapter', () => {
  it('reads every ch. 26 vocabulary entry with a stable id', () => {
    expect(terms).toHaveLength(28);
    expect(terms[0]).toEqual({ id: 'ch26/vocabulary/0', target: '독감', native: 'flu' });
    expect(nurse.id).toBe('ch26/vocabulary/13');
  });

  it('rejects data without a vocabulary list', () => {
    expect(() => termsFromChapter({ chapter: '1' })).toThrow();
  });
});

describe('firstSense', () => {
  it('keeps the first comma-separated sense', () => {
    expect(firstSense('to swell up, to become swollen')).toBe('to swell up');
    expect(firstSense('to get (sick), to catch a disease')).toBe('to get (sick)');
    expect(firstSense('nurse')).toBe('nurse');
  });
});

describe('readingItem', () => {
  it('asks for the meaning of the Korean word', () => {
    const item = readingItem(nurse, terms, createRng(1))!;
    expect(item.skill).toBe('reading');
    expect(item.prompt).toBe('간호사');
    expect(item.options).toHaveLength(4);
    expect(correct(item)).toBe('nurse');
    expect(item.options.filter((o) => o.isCorrect)).toHaveLength(1);
    expect(new Set(item.options.map((o) => o.text)).size).toBe(4);
  });

  it('uses verb meanings as distractors for a verb', () => {
    const swell = terms.find((term) => term.target === '붓다')!;
    for (let seed = 1; seed <= 20; seed++) {
      const item = readingItem(swell, terms, createRng(seed))!;
      expect(correct(item)).toBe('to swell up');
      for (const option of item.options) {
        expect(option.text.startsWith('to ')).toBe(true);
      }
    }
  });

  it('uses non-verb meanings as distractors for a noun', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const item = readingItem(nurse, terms, createRng(seed))!;
      for (const option of item.options) {
        expect(option.text.startsWith('to ')).toBe(false);
      }
    }
  });

  it('returns null when the list is too short', () => {
    expect(readingItem(nurse, [nurse, terms[0]], createRng(1))).toBeNull();
  });
});

describe('writingItem', () => {
  it('asks for the Korean spelling of the English word', () => {
    const item = writingItem(nurse, terms, createRng(1))!;
    expect(item.skill).toBe('writing');
    expect(item.prompt).toBe('nurse');
    expect(item.options).toHaveLength(4);
    expect(correct(item)).toBe('간호사');
    expect(new Set(item.options.map((o) => o.text)).size).toBe(4);
  });

  it('never offers another chapter word as a wrong spelling', () => {
    const realWords = new Set(terms.map((term) => term.target));
    for (const term of terms) {
      const item = writingItem(term, terms, createRng(3));
      expect(item).not.toBeNull();
      for (const option of item!.options.filter((o) => !o.isCorrect)) {
        expect(realWords.has(option.text)).toBe(false);
      }
    }
  });
});

describe('generateVocabQuiz', () => {
  const quiz = generateVocabQuiz({ terms, skills: ['reading', 'writing'], count: 10, seed: 26 });

  it('makes the requested number of questions, alternating skills', () => {
    expect(quiz).toHaveLength(10);
    expect(quiz.map((item) => item.skill)).toEqual([
      'reading', 'writing', 'reading', 'writing', 'reading',
      'writing', 'reading', 'writing', 'reading', 'writing',
    ]);
  });

  it('uses each term at most once', () => {
    expect(new Set(quiz.map((item) => item.termId)).size).toBe(10);
  });

  it('is the same quiz for the same seed and differs for another', () => {
    expect(generateVocabQuiz({ terms, skills: ['reading', 'writing'], count: 10, seed: 26 })).toEqual(quiz);
    expect(generateVocabQuiz({ terms, skills: ['reading', 'writing'], count: 10, seed: 27 })).not.toEqual(quiz);
  });

  it('does not put the correct answer in the same slot every time', () => {
    const slots = new Set(quiz.map((item) => item.options.findIndex((o) => o.isCorrect)));
    expect(slots.size).toBeGreaterThan(1);
  });

  it('stops at the number of terms available', () => {
    expect(generateVocabQuiz({ terms, skills: ['reading'], count: 100, seed: 1 })).toHaveLength(28);
  });

  it('requires a skill', () => {
    expect(() => generateVocabQuiz({ terms, skills: [], count: 1, seed: 1 })).toThrow();
  });
});

describe('toQuestionInput', () => {
  it('maps options onto answer cards A–D in order', () => {
    const item = readingItem(nurse, terms, createRng(1))!;
    const input = toQuestionInput(item, 3);
    expect(input.text).toBe('간호사');
    expect(input.sequence).toBe(3);
    expect(input.mode).toBe('standard');
    expect(input.answerOptions.map((o) => o.slotLabel)).toEqual(['A', 'B', 'C', 'D']);
    expect(input.answerOptions.map((o) => o.sequence)).toEqual([1, 2, 3, 4]);
    expect(input.answerOptions.map((o) => o.text)).toEqual(item.options.map((o) => o.text));
    expect(input.answerOptions.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  it('adds no learning tag to class-game items', () => {
    const input = toQuestionInput(readingItem(nurse, terms, createRng(1))!, 1);
    expect(input).not.toHaveProperty('learning');
  });

  it("passes a Leitner item's tag through, with the skill as the aspect", () => {
    const learning = {
      learningObjectId: 'ko/lexeme/간호사/nurse',
      book: 'korean-language-book',
      sourceRef: 'ch26/vocabulary/13',
      target: '간호사',
      native: 'nurse',
    };
    const item = { ...writingItem(nurse, terms, createRng(1))!, learning };
    expect(toQuestionInput(item, 1).learning).toEqual({ ...learning, aspect: 'writing' });
  });
});

describe('Leitner picks', () => {
  const learning = (term: { target: string; native: string; id: string }) => ({
    learningObjectId: `ko/lexeme/${term.target}/x`,
    book: 'korean-language-book',
    sourceRef: term.id,
    target: term.target,
    native: term.native,
  });

  it('never offers another meaning of the same word as a reading distractor', () => {
    const pear = { id: 'ch1/vocabulary/0', target: '배', native: 'pear' };
    const pool = [
      pear,
      { id: 'ch1/vocabulary/1', target: '배', native: 'ship' },
      { id: 'ch1/vocabulary/2', target: '사과', native: 'apple' },
      { id: 'ch1/vocabulary/3', target: '포도', native: 'grape' },
      { id: 'ch1/vocabulary/4', target: '수박', native: 'watermelon' },
    ];
    for (let seed = 0; seed < 20; seed++) {
      const item = readingItem(pear, pool, createRng(seed))!;
      expect(item.options.map((option) => option.text)).not.toContain('ship');
    }
    expect(canBuildItem('reading', pear, pool.slice(0, 4))).toBe(false);
    expect(canBuildItem('reading', pear, pool)).toBe(true);
  });

  it('builds one tagged question per pick, from its own pool, shuffled by seed', () => {
    const picks = terms.slice(0, 6).map((term, index) => ({
      skill: (index % 2 === 0 ? 'reading' : 'writing') as 'reading' | 'writing',
      term,
      pool: terms,
      learning: learning(term),
    }));
    const items = generateVocabQuizForPicks(picks, 7);
    expect(items).toHaveLength(6);
    expect(new Set(items.map((item) => item.termId))).toEqual(new Set(picks.map((pick) => pick.term.id)));
    for (const item of items) {
      const pick = picks.find((p) => p.term.id === item.termId)!;
      expect(item.skill).toBe(pick.skill);
      expect(item.learning).toEqual(pick.learning);
      expect(toQuestionInput(item, 1).learning).toEqual({ ...pick.learning, aspect: pick.skill });
    }
    expect(generateVocabQuizForPicks(picks, 7)).toEqual(items);
    expect(generateVocabQuizForPicks(picks, 8).map((item) => item.termId)).not.toEqual(items.map((item) => item.termId));
  });

  it('throws for a pick that cannot be built', () => {
    const lonely = terms[0];
    expect(() =>
      generateVocabQuizForPicks([{ skill: 'reading', term: lonely, pool: [lonely], learning: learning(lonely) }], 1),
    ).toThrow(/Cannot build/);
  });
});
