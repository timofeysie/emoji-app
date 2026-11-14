import { readFileSync } from 'fs';
import { join } from 'path';
import { diffTyped, isTypedCorrect, isTypedExact, normalizeTyped, typedItem } from './answer-check';

describe('answer-check', () => {
  it('matches Hangul typed as separate jamo (NFD, as some IMEs send it) to the composed word', () => {
    const composed = '시험';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(isTypedCorrect(decomposed, composed)).toBe(true);
  });

  it('ignores outer and repeated inner whitespace, including the full-width space', () => {
    expect(isTypedCorrect('  보여   주다 ', '보여 주다')).toBe(true);
    expect(isTypedCorrect('보여　주다', '보여 주다')).toBe(true);
    expect(normalizeTyped(' a \t b\n')).toBe('a b');
  });

  it('needs the space a multi-word Korean entry has', () => {
    expect(isTypedCorrect('보여주다', '보여 주다')).toBe(false);
  });

  it('reading needs the whole gloss, case and word spacing included', () => {
    expect(isTypedCorrect('test, exam', 'test, exam')).toBe(true);
    expect(isTypedCorrect('test', 'test, exam')).toBe(false);
    expect(isTypedCorrect('test,exam', 'test, exam')).toBe(false);
    expect(isTypedCorrect('Test, exam', 'test, exam')).toBe(false);
  });

  it('scores answers that differ only in brackets and other punctuation as correct', () => {
    expect(isTypedCorrect('돈을 모으다', '(돈을) 모으다')).toBe(true);
    expect(isTypedCorrect('to save up money', 'to save up (money)')).toBe(true);
    expect(isTypedCorrect('test exam', 'test, exam')).toBe(true);
    expect(isTypedCorrect('안녕하세요', '안녕하세요!')).toBe(true);
    expect(isTypedCorrect('모으다', '(돈을) 모으다')).toBe(false);
    expect(isTypedCorrect('()', '(돈을) 모으다')).toBe(false);
  });

  it('tells an exact answer from one accepted despite punctuation', () => {
    expect(isTypedExact(' 보여   주다', '보여 주다')).toBe(true);
    expect(isTypedExact('돈을 모으다', '(돈을) 모으다')).toBe(false);
    expect(diffTyped('돈을 모으다', '(돈을) 모으다')).toEqual([
      { text: '(', kind: 'missing' },
      { text: '돈을', kind: 'same' },
      { text: ')', kind: 'missing' },
      { text: ' 모으다', kind: 'same' },
    ]);
  });

  it('counts an empty answer ("Don\'t know") as wrong', () => {
    expect(isTypedCorrect('', '시험')).toBe(false);
    expect(isTypedCorrect('   ', '시험')).toBe(false);
  });

  it('shows writing the English and wants the Korean; reading the reverse', () => {
    expect(typedItem('writing', '시험', 'test, exam')).toEqual({ prompt: 'test, exam', answer: '시험' });
    expect(typedItem('reading', '시험', 'test, exam')).toEqual({ prompt: '시험', answer: 'test, exam' });
  });

  it('diffs a near miss character by character', () => {
    expect(diffTyped('test exam', 'test, exam')).toEqual([
      { text: 'test', kind: 'same' },
      { text: ',', kind: 'missing' },
      { text: ' exam', kind: 'same' },
    ]);
    expect(diffTyped('시엄', '시험')).toEqual([
      { text: '시', kind: 'same' },
      { text: '험', kind: 'missing' },
      { text: '엄', kind: 'extra' },
    ]);
    expect(diffTyped('', 'ab')).toEqual([{ text: 'ab', kind: 'missing' }]);
  });

  it('is the same file as the client copy', () => {
    const server = readFileSync(join(__dirname, 'answer-check.ts'), 'utf8');
    const client = readFileSync(join(__dirname, '../../../client/src/app/yalla/answer-check.ts'), 'utf8');
    expect(client).toBe(server);
  });
});
