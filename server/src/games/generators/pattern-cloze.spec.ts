import { findCatalogueBook } from '../../learning/book-catalogue';
import { KOREAN_BOOK } from '../../learning/learning-object';
import { bookPatternsOf, clozeItem, clozeOf, clozeSentences, promptNative } from './pattern-cloze';
import { createRng } from './seeded-random';

const book = findCatalogueBook(KOREAN_BOOK)!.chapters.flatMap(bookPatternsOf);
const byRef = (ref: string) => book.find((pattern) => pattern.sourceRef === ref)!;

describe('pattern cloze (docs/yalla/grammar-learning-objects.md, H4b)', () => {
  it.each([
    ['계속 더 ADJECTIVE + -아/어/여지네', '계속 더 심해지네.', '계속 더 심해', '지네', '.'],
    ['VERB + -(으)면 안 돼', '오늘 수업 빠지면 안 돼.', '오늘 수업 빠지', '면 안 돼', '.'],
    ['금방 VERB + -(으)ㄹ 것 같아', '금방 전화 올 것 같아.', '금방 전화 올 ', '것 같아', '.'],
    ['VERB + -았/었/였더니', '너무 오래 달렸더니 어지러워요.', '너무 오래 달렸', '더니', ' 어지러워요.'],
    ['VERB + -지 말고 VERB + -아/어/여', '거기로 가지 말고 여기로 와.', '거기로 가', '지 말고', ' 여기로 와.'],
    ['처음 VERB + -아/어/여 보는 거예요', '이거 처음 먹어 보는 거예요.', '이거 처음 먹어 ', '보는 거예요', '.'],
    ['VERB + -(으)려면 어떻게 해야 되죠?', '저기로 가려면 어떻게 해야 되죠?', '저기로 가', '려면 어떻게 해야 되죠', '?'],
  ])('%s in %s', (pattern, sentence, before, blank, after) => {
    expect(clozeOf(pattern, sentence)).toEqual({ before, blank, after });
  });

  it('finds the blank in every sentence of the built-in book (67)', () => {
    expect(book).toHaveLength(15);
    const all = book.flatMap((pattern) => pattern.sentences.map((sentence) => [pattern, sentence] as const));
    expect(all).toHaveLength(67);
    expect(all.filter(([pattern, sentence]) => !clozeOf(pattern.patternTarget, sentence.target)).map(([, s]) => s.target)).toEqual([]);
  });

  it('returns null when the ending is not in the sentence', () => {
    expect(clozeOf('VERB + -(으)면 안 돼', '오늘 수업 빠졌어.')).toBeNull();
    expect(clozeOf('-네', '그래.')).toBeNull();
  });

  it('drops word hints from the translation', () => {
    expect(promptNative('I’m getting more and more curious. (to be curious = 궁금하다)')).toBe('I’m getting more and more curious.');
  });

  it('builds a four-option item whose distractors are other patterns’ endings, never the same grammar', () => {
    const pattern = byRef('ch27/patterns/0');
    const item = clozeItem(pattern, book, new Set(['ch28/patterns/0']), createRng(7))!;
    expect(item.options).toHaveLength(4);
    expect(item.options.filter((option) => option.isCorrect).map((option) => option.text)).toEqual(['지네']);
    expect(new Set(item.options.map((option) => option.text)).size).toBe(4);
    expect(item.prompt).toMatch(/^계속 더 .+___\. \(.+\)$/);
    // The same sentence again for YALLA's re-check.
    const again = clozeItem(pattern, book, new Set(['ch28/patterns/0']), createRng(99), item.sentence)!;
    expect(again.prompt).toBe(item.prompt);
    expect(clozeSentences(pattern).map((sentence) => sentence.id)).toContain(item.sentence);
  });

  it('can’t build without enough other endings', () => {
    expect(clozeItem(byRef('ch27/patterns/0'), book.slice(0, 2), new Set(), createRng(1))).toBeNull();
  });
});
