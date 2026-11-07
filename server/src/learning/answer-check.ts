/**
 * Checks typed YALLA answers (docs/yalla/implementation-plan.md §6 →
 * Checking typed answers). The client uses it for instant feedback and the
 * server re-checks with it, so the two can't disagree.
 *
 * KEEP IN SYNC: client/src/app/yalla/answer-check.ts is a byte-for-byte
 * copy (the client and server builds share no source folder);
 * answer-check.spec.ts fails when they differ. No imports, on purpose.
 */

export type TypedAspect = 'reading' | 'writing';

/**
 * Only invisible differences are ignored: Unicode NFC (so jamo typed one
 * at a time match the composed syllable), outer whitespace, and runs of
 * inner whitespace. Case and punctuation still count.
 */
export function normalizeTyped(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

/**
 * What a typed item shows and expects: writing shows the English and wants
 * the Korean `word`; reading shows the Korean and wants the English answer
 * (the whole gloss, exactly: `test, exam` must be typed in full).
 */
export function typedItem(aspect: TypedAspect, word: string, gloss: string): { prompt: string; answer: string } {
  return aspect === 'writing' ? { prompt: gloss, answer: word } : { prompt: word, answer: gloss };
}

/** An empty answer ("Don't know") is wrong. */
export function isTypedCorrect(typed: string, answer: string): boolean {
  const given = normalizeTyped(typed);
  return given.length > 0 && given === normalizeTyped(answer);
}

export type DiffPart = { text: string; kind: 'same' | 'missing' | 'extra' };

/**
 * Where a wrong answer differs from the right one, character by character
 * (longest common subsequence), for the feedback after a miss: `missing`
 * is in the answer but wasn't typed, `extra` was typed but isn't in it.
 */
export function diffTyped(typed: string, answer: string): DiffPart[] {
  const a = [...normalizeTyped(typed)];
  const b = [...normalizeTyped(answer)];
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(a[i], 'same');
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || lengths[i][j + 1] >= lengths[i + 1][j])) {
      push(b[j], 'missing');
      j++;
    } else {
      push(a[i], 'extra');
      i++;
    }
  }
  return parts;
}
