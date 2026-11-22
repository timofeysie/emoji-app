import { senseSlug } from './sense-suggest';
import type { ChapterPattern, FoundPattern, FoundPatterns, PatternDecision } from './library-api';

/**
 * The editor's first guess at the grammar a book pattern teaches
 * (docs/yalla/grammar-learning-objects.md → Matching at authoring time):
 * reuse every entry with the same key, else one new entry named after the
 * pattern, which the user checks and confirms. Entries found inside the
 * pattern are only offered, never chosen for the user.
 */

export function reuseEntry(found: Pick<FoundPattern, 'id'>): PatternDecision {
  return { decision: 'reuse', reuseId: found.id, headword: '', meaning: '', gloss: '', confirmed: false };
}

/** A new, unconfirmed entry: the pattern without what it attaches to (`VERB + -(으)면` → `-(으)면`). */
export function newEntryFor(pattern: Pick<ChapterPattern, 'patternTarget' | 'patternNative'>): PatternDecision {
  const headword = pattern.patternTarget
    .replace(/\b[A-Z]+\b/g, '')
    .replace(/\s*\+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    decision: 'new',
    reuseId: '',
    headword,
    meaning: senseSlug(pattern.patternNative),
    gloss: pattern.patternNative.trim(),
    confirmed: false,
  };
}

export function suggestEntries(pattern: ChapterPattern, found: FoundPatterns | undefined): PatternDecision[] {
  if (!found || found.problem) return [];
  if (found.exact.length > 0) return found.exact.map(reuseEntry);
  return [newEntryFor(pattern)];
}
