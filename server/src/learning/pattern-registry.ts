import { z } from 'zod';
import koreanPatterns from '../games/content/ko-patterns.json';
import { patternForm, patternKey } from './grammar-pattern';
import { GRAMMAR_PATTERN, KOREAN, learningObjectId, parseQualifiedSourceRef } from './learning-object';

/**
 * Grammar-pattern registry for one language
 * (docs/yalla/grammar-learning-objects.md → The pattern registry). Like the
 * sense registry: an entry is one smallest teachable pattern, and every
 * book pattern lists the entries it teaches (`sources`). The id comes from
 * the headword's matching key and the meaning slug, never typed (GP3).
 * The headword, gloss and spellings are data and can change (GP4).
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const patternEntrySchema = z
  .object({
    /** Display form, default style `-아/어/여지다`. Its key gives the id's form. */
    headword: z.string().trim().min(1).max(60),
    /** English meaning slug, permanent once used: `become`. */
    meaning: z.string().regex(SLUG).max(40),
    gloss: z.string().trim().min(1).max(120),
    /** Other spellings books use, for matching (`-어(아, 여) 지다`, `-어지다`). */
    spellings: z.array(z.string().trim().min(1).max(60)),
    /** Book-qualified book patterns that teach it: `korean-language-book/ch27/patterns/0`. */
    sources: z.array(z.string()),
  })
  .strict();

export const patternRegistrySchema = z
  .object({
    language: z.string().regex(/^[a-z]{2,3}$/),
    /** False until a person has checked the drafted entries (GP8). */
    reviewed: z.boolean(),
    patterns: z.array(patternEntrySchema),
  })
  .strict();

export type PatternEntry = z.infer<typeof patternEntrySchema>;
export type PatternRegistry = z.infer<typeof patternRegistrySchema>;

/** One entry as the app uses it: its id and key worked out. */
export type GrammarPattern = {
  id: string;
  language: string;
  /** Romanised key: `a-eo-jida`. */
  form: string;
  /** Matching key of the headword: `아/어 지다`. */
  key: string;
  meaning: string;
  headword: string;
  gloss: string;
  spellings: string[];
  sources: string[];
};

export type PatternIndex = {
  language: string;
  byId: ReadonlyMap<string, GrammarPattern>;
  /** Every spelling's key (the headword's included) → the entries it matches. */
  byKey: ReadonlyMap<string, readonly GrammarPattern[]>;
  /** Book-qualified book pattern → the entries it teaches, in registry order. */
  bySource: ReadonlyMap<string, readonly GrammarPattern[]>;
};

export function patternId(language: string, headword: string, meaning: string): string {
  return learningObjectId({ language, kind: GRAMMAR_PATTERN, word: patternForm(headword), sense: meaning });
}

/** @throws on a duplicate id, a malformed source or an unreadable spelling */
export function buildPatternIndex(raw: unknown): PatternIndex {
  const registry = patternRegistrySchema.parse(raw);
  const byId = new Map<string, GrammarPattern>();
  const byKey = new Map<string, GrammarPattern[]>();
  const bySource = new Map<string, GrammarPattern[]>();
  for (const entry of registry.patterns) {
    const pattern: GrammarPattern = {
      ...entry,
      id: patternId(registry.language, entry.headword, entry.meaning),
      language: registry.language,
      form: patternForm(entry.headword),
      key: patternKey(entry.headword),
    };
    if (byId.has(pattern.id)) throw new Error(`Two pattern entries have the id ${pattern.id}: give one another meaning.`);
    byId.set(pattern.id, pattern);
    for (const key of new Set([entry.headword, ...entry.spellings].map(patternKey))) {
      byKey.set(key, [...(byKey.get(key) ?? []), pattern]);
    }
    for (const source of entry.sources) {
      if (!parseQualifiedSourceRef(source)?.sourceRef.includes('/patterns/')) {
        throw new Error(`Pattern ${pattern.id} has a source that isn't a book pattern: '${source}'.`);
      }
      bySource.set(source, [...(bySource.get(source) ?? []), pattern]);
    }
  }
  return { language: registry.language, byId, byKey, bySource };
}

/** Entries a spelling matches by key (GP2): reuse one by default, the user may change it. */
export function matchPatterns(index: PatternIndex, spelling: string): readonly GrammarPattern[] {
  return index.byKey.get(patternKey(spelling)) ?? [];
}

let korean: PatternIndex | null = null;

/** The committed registry for a language (empty for a language without one). */
export function filePatterns(language: string): PatternIndex {
  if (language !== KOREAN) return { language, byId: new Map(), byKey: new Map(), bySource: new Map() };
  korean ??= buildPatternIndex(koreanPatterns);
  return korean;
}
