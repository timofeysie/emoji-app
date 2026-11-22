import { patternForm, patternKey, PatternSpellingError, romaniseSyllable } from './grammar-pattern';

describe('grammar-pattern key and form (docs/yalla/grammar-learning-objects.md)', () => {
  it.each([
    // One pattern, every notation books use.
    ['-어(아, 여) 지다', '아/어 지다', 'a-eo-jida'],
    ['-어（아，여）지다', '아/어 지다', 'a-eo-jida'],
    ['-아/어/여지다', '아/어 지다', 'a-eo-jida'],
    ['-아/어지다', '아/어 지다', 'a-eo-jida'],
    ['-어/아지다', '아/어 지다', 'a-eo-jida'],
    ['A-아/어지다', '아/어 지다', 'a-eo-jida'],
    ['~아/어 지다', '아/어 지다', 'a-eo-jida'],
    ['ADJECTIVE + -아/어/여지다', '아/어 지다', 'a-eo-jida'],
    // Past tense alternants and others.
    ['-았/었/였더니', '았/었 더니', 'at-eot-deoni'],
    ['-었(았, 였)더니', '았/었 더니', 'at-eot-deoni'],
    ['V-았/었더니', '았/었 더니', 'at-eot-deoni'],
    ['-(으)면', '(으) 면', 'eu-myeon'],
    ['V-(으)면', '(으) 면', 'eu-myeon'],
    ['-(으)ㄹ 것 같다', '(으) ㄹ 것같다', 'eu-l-geotgatda'],
    ['-(으)려면', '(으) 려면', 'eu-ryeomyeon'],
    ['-네', '네', 'ne'],
    ['-아/어 버리다', '아/어 버리다', 'a-eo-beorida'],
    ['-지 말다', '지말다', 'jimalda'],
    ['-는 거', '는거', 'neungeo'],
  ])('%s → key %s, form %s', (spelling, key, form) => {
    expect(patternKey(spelling)).toBe(key);
    expect(patternForm(spelling)).toBe(form);
  });

  it('keeps conjugated and base-form-only spellings apart (linked by a person, not the key)', () => {
    expect(patternKey('-아/어/여지네')).toBe('아/어 지네');
    expect(patternKey('-어지다')).toBe('어지다');
    expect(patternKey('계속 더 ADJECTIVE + -아/어/여지네')).toBe('계속더 아/어 지네');
  });

  it('keeps a group without 아/어 as written, in a fixed order', () => {
    expect(patternKey('-을/를')).toBe('를/을');
    expect(patternKey('-를/을')).toBe('를/을');
  });

  it('romanises finals as heard, one syllable at a time', () => {
    expect(['았', '었', '것', '같', '닭', '좋', '밖'].map(romaniseSyllable)).toEqual(['at', 'eot', 'geot', 'gat', 'dak', 'jot', 'bak']);
  });

  it('refuses spellings it cannot read', () => {
    expect(() => patternKey('VERB +')).toThrow(PatternSpellingError);
    expect(() => patternKey('-어(아, 여 지다')).toThrow(/not closed/);
    expect(() => patternKey('/어지다')).toThrow(/between two syllables/);
    expect(() => patternKey('-(무엇)면')).toThrow(PatternSpellingError);
  });
});
