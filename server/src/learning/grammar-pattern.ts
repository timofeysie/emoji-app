/**
 * Grammar-pattern identity (docs/yalla/grammar-learning-objects.md, GP2–GP6).
 * Books write the same pattern differently (`-어(아, 여) 지다`,
 * `-아/어/여지다`, `A-아/어지다`), so a spelling is reduced to a matching
 * key, and the id's form is the key romanised by a fixed rule. Both are
 * permanent once pilot statements use them: change them only with a
 * migration plan.
 */

/** One token of a key: a run of syllables, a vowel-alternant group, `(으)`, or a lone jamo. */
export type KeyToken =
  | { type: 'run'; text: string }
  | { type: 'group'; variants: string[] }
  | { type: 'optional-eu' }
  | { type: 'jamo'; text: string };

export class PatternSpellingError extends Error {
  constructor(
    public readonly spelling: string,
    reason: string,
  ) {
    super(`Can't read the pattern '${spelling}': ${reason}`);
  }
}

const SYLLABLE = /[가-힣]/;
const JAMO = /[ㄱ-ㅎ]/;
const HANGUL_BASE = 0xac00;

/** Full-width brackets, commas and slashes, as some books print them. */
const FULL_WIDTH: Record<string, string> = { '（': '(', '）': ')', '，': ',', '、': ',', '／': '/', '～': '~' };

function medialOf(syllable: string): number {
  return Math.floor(((syllable.codePointAt(0)! - HANGUL_BASE) % 588) / 28);
}

/** `여`/`였` (medial ㅕ) is implied next to `아`/`어` (GP2 step 4). */
const MEDIAL_YEO = 6;
const MEDIAL_A = 0;
const MEDIAL_EO = 4;

function normaliseGroup(variants: readonly string[]): string[] {
  const unique = [...new Set(variants)];
  const harmony = unique.some((v) => [MEDIAL_A, MEDIAL_EO].includes(medialOf(v)));
  const kept = harmony ? unique.filter((v) => medialOf(v) !== MEDIAL_YEO) : unique;
  // Code point order puts the ㅏ variant before the ㅓ one (아 < 어, 았 < 었).
  return kept.sort();
}

/**
 * The matching key's tokens (GP2): placeholders, `+`, `~`, punctuation,
 * hyphens and spaces dropped; `X/Y/Z` and `X(Y, Z)` read as one group with
 * `여` implied; `(으)` and lone jamo kept as tokens.
 * @throws PatternSpellingError when nothing Korean is left, or a bracket can't be read
 */
export function patternKeyTokens(spelling: string): KeyToken[] {
  let text = spelling.normalize('NFC').replace(/[（）、，／～]/g, (c) => FULL_WIDTH[c] ?? c);
  // Step 2: what the pattern attaches to, and punctuation.
  text = text
    .replace(/[A-Za-z]+/g, '')
    .replace(/[+~.?!…"'“”‘’‐–—-]/g, '')
    .replace(/\(\s*\)/g, '');

  const tokens: KeyToken[] = [];
  /** A slash group stays open while `/X` follows, and is normalised once it ends. */
  let openGroup: { type: 'group'; variants: string[] } | null = null;
  const closeGroup = () => {
    if (openGroup) openGroup.variants = normaliseGroup(openGroup.variants);
    openGroup = null;
  };
  const pushSyllable = (syllable: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.type === 'run') last.text += syllable;
    else tokens.push({ type: 'run', text: syllable });
  };
  /** The run's last syllable becomes the first variant of a group. */
  const takeLastSyllable = (): string | null => {
    const last = tokens[tokens.length - 1];
    if (last?.type !== 'run') return null;
    const syllable = last.text.slice(-1);
    last.text = last.text.slice(0, -1);
    if (!last.text) tokens.pop();
    return syllable;
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i++;
    } else if (char === '(') {
      closeGroup();
      const close = text.indexOf(')', i);
      if (close < 0) throw new PatternSpellingError(spelling, 'a bracket is not closed');
      const inside = text.slice(i + 1, close).split(',').map((part) => part.trim()).filter(Boolean);
      i = close + 1;
      if (inside.length === 1 && inside[0] === '으') {
        tokens.push({ type: 'optional-eu' });
        continue;
      }
      if (!inside.every((part) => part.length === 1 && SYLLABLE.test(part))) {
        throw new PatternSpellingError(spelling, `'(${inside.join(', ')})' is not (으) or a list of vowel alternatives`);
      }
      const first = takeLastSyllable();
      if (!first) throw new PatternSpellingError(spelling, `'(${inside.join(', ')})' doesn't follow a syllable`);
      tokens.push({ type: 'group', variants: normaliseGroup([first, ...inside]) });
    } else if (char === '/') {
      const next = text[i + 1];
      if (!next || !SYLLABLE.test(next)) throw new PatternSpellingError(spelling, "'/' must sit between two syllables");
      if (openGroup) {
        openGroup.variants.push(next);
      } else {
        const first = takeLastSyllable();
        if (!first) throw new PatternSpellingError(spelling, "'/' must sit between two syllables");
        openGroup = { type: 'group', variants: [first, next] };
        tokens.push(openGroup);
      }
      i += 2;
    } else if (SYLLABLE.test(char)) {
      closeGroup();
      pushSyllable(char);
      i++;
    } else if (JAMO.test(char)) {
      closeGroup();
      tokens.push({ type: 'jamo', text: char });
      i++;
    } else {
      throw new PatternSpellingError(spelling, `unexpected '${char}'`);
    }
  }
  closeGroup();
  if (!tokens.some((token) => token.type === 'run' || token.type === 'group')) {
    throw new PatternSpellingError(spelling, 'it has no Korean in it');
  }
  return tokens;
}

function tokenText(token: KeyToken): string {
  switch (token.type) {
    case 'run':
    case 'jamo':
      return token.text;
    case 'group':
      return token.variants.join('/');
    case 'optional-eu':
      return '(으)';
  }
}

/** The stored key: tokens with one space between, e.g. `아/어 지다`, `(으) ㄹ 것같다`. */
export function patternKey(spelling: string): string {
  return patternKeyTokens(spelling).map(tokenText).join(' ');
}

// Revised Romanisation, one syllable at a time, finals as heard (GP6).
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
/** A lone jamo is an ending's final consonant: its final value. */
const JAMO_FINALS: Record<string, string> = {
  ㄱ: 'k', ㄲ: 'k', ㄴ: 'n', ㄷ: 't', ㄹ: 'l', ㅁ: 'm', ㅂ: 'p', ㅅ: 't', ㅆ: 't', ㅇ: 'ng', ㅈ: 't', ㅊ: 't', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 't',
};

export function romaniseSyllable(syllable: string): string {
  const index = syllable.codePointAt(0)! - HANGUL_BASE;
  if (index < 0 || index > 11171) throw new Error(`'${syllable}' is not a Hangul syllable`);
  return INITIALS[Math.floor(index / 588)] + MEDIALS[Math.floor((index % 588) / 28)] + FINALS[index % 28];
}

function romaniseToken(token: KeyToken): string {
  switch (token.type) {
    case 'run':
      return [...token.text].map(romaniseSyllable).join('');
    case 'group':
      return token.variants.map(romaniseSyllable).join('-');
    case 'optional-eu':
      return 'eu';
    case 'jamo': {
      const value = JAMO_FINALS[token.text];
      if (!value) throw new Error(`No romanisation for the jamo '${token.text}'`);
      return value;
    }
  }
}

/** The id's form (GP3, GP6): `-았/었더니` → `at-eot-deoni`. */
export function patternForm(spelling: string): string {
  return patternKeyTokens(spelling).map(romaniseToken).join('-');
}
