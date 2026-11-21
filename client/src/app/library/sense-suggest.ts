import { emptyDecision, type FoundSense, type SenseDecision } from './library-api';

/**
 * The editor's first guess at each word's sense (G7), as the sense registry
 * reuses an existing sense when the word has one, and adds a new one for a
 * word nobody has taught. A new sense always needs the user's confirmation
 * before Publish; a reused one doesn't.
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

/**
 * Reuse is the default whenever the registry has the word: the sense sharing
 * a meaning, else its first sense. The editor says it's being reused, and the
 * user can change it; publishing is never blocked on an undecided word that
 * has a sense to reuse.
 */
export function suggestDecision(word: string, gloss: string, found: readonly FoundSense[]): SenseDecision {
  if (found.length === 0) return newSenseFor(word, gloss);
  const parts = new Set(glossParts(gloss));
  const best = found.find((sense) => glossParts(sense.gloss).some((part) => parts.has(part))) ?? found[0];
  return { ...emptyDecision(), decision: 'reuse', reuseId: best.id, kind: best.kind === 'expression' ? 'expression' : 'lexeme' };
}
