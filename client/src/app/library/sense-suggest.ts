import { emptyDecision, type FoundSense, type SenseDecision } from './library-api';

/**
 * The editor's first guess at each word's sense (G7), as the sense registry
 * script guesses (`server/src/learning/sense-registry.ts`): reuse the one
 * sense that shares a meaning, add a new one for a word nobody has taught,
 * and leave the rest for the user. A new sense always needs the user's
 * confirmation before Publish.
 */

/** `Test, exam ` → `['test', 'exam']`. Commas only, as the server. */
export function glossParts(gloss: string): string[] {
  return gloss
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);
}

/** First meaning as an ASCII slug: `to get (sick), to catch` → `to-get-sick`. */
export function senseSlug(gloss: string, max = 40): string {
  const slug = (glossParts(gloss)[0] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug || 'sense';
  const cut = slug.slice(0, max + 1);
  const lastBreak = cut.lastIndexOf('-');
  return lastBreak > 0 ? cut.slice(0, lastBreak) : slug.slice(0, max);
}

export function defaultKind(word: string): SenseDecision['kind'] {
  return /\s/.test(word.trim()) ? 'expression' : 'lexeme';
}

/** A new, unconfirmed sense named after the first gloss. */
export function newSenseFor(word: string, gloss: string): SenseDecision {
  return { ...emptyDecision(), decision: 'new', newSense: senseSlug(gloss), kind: defaultKind(word) };
}

export function suggestDecision(word: string, gloss: string, found: readonly FoundSense[]): SenseDecision {
  if (found.length === 0) return newSenseFor(word, gloss);
  const parts = new Set(glossParts(gloss));
  const matches = found.filter((sense) => glossParts(sense.gloss).some((part) => parts.has(part)));
  if (matches.length === 1) {
    return { ...emptyDecision(), decision: 'reuse', reuseId: matches[0].id, kind: matches[0].kind === 'expression' ? 'expression' : 'lexeme' };
  }
  return emptyDecision();
}
