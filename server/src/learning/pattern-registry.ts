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

function indexPatterns(language: string, patterns: readonly GrammarPattern[], strict: boolean): PatternIndex {
  const byId = new Map<string, GrammarPattern>();
  const byKey = new Map<string, GrammarPattern[]>();
  const bySource = new Map<string, GrammarPattern[]>();
  for (const pattern of patterns) {
    if (byId.has(pattern.id)) throw new Error(`Two pattern entries have the id ${pattern.id}: give one another meaning.`);
    byId.set(pattern.id, pattern);
    const keys = new Set<string>();
    for (const spelling of [pattern.headword, ...pattern.spellings]) {
      try {
        keys.add(patternKey(spelling));
      } catch (error) {
        if (strict) throw error;
      }
    }
    for (const key of keys) byKey.set(key, [...(byKey.get(key) ?? []), pattern]);
    for (const source of pattern.sources) {
      if (!parseQualifiedSourceRef(source)?.sourceRef.includes('/patterns/')) {
        if (!strict) continue;
        throw new Error(`Pattern ${pattern.id} has a source that isn't a book pattern: '${source}'.`);
      }
      bySource.set(source, [...(bySource.get(source) ?? []), pattern]);
    }
  }
  return { language, byId, byKey, bySource };
}

/** @throws on a duplicate id, a malformed source or an unreadable spelling */
export function buildPatternIndex(raw: unknown): PatternIndex {
  const registry = patternRegistrySchema.parse(raw);
  return indexPatterns(
    registry.language,
    registry.patterns.map((entry) => ({
      ...entry,
      id: patternId(registry.language, entry.headword, entry.meaning),
      language: registry.language,
      form: patternForm(entry.headword),
      key: patternKey(entry.headword),
    })),
    true,
  );
}

/** An entry users added (the `patterns` collection), or extra spellings and sources of one. */
export type StoredPattern = {
  language: string;
  form: string;
  meaning: string;
  headword: string;
  gloss: string;
  spellings: readonly string[];
  sources: readonly string[];
};

/**
 * The file's entries plus the ones users added (H4c). The file wins on a
 * clash, but a stored row's spellings and sources are added to it. A stored
 * row whose headword no longer gives its form is skipped: its id is fixed.
 * `extraSpellings` are spellings seen in books (`계속 더 … -아/어/여지네` →
 * both entries it teaches), so the next book that writes it the same way
 * matches them all.
 */
export function mergePatterns(
  file: PatternIndex,
  stored: readonly StoredPattern[],
  extraSpellings: ReadonlyArray<{ id: string; spelling: string }> = [],
): PatternIndex {
  const merged = new Map<string, GrammarPattern>();
  for (const pattern of file.byId.values()) {
    merged.set(pattern.id, { ...pattern, spellings: [...pattern.spellings], sources: [...pattern.sources] });
  }
  const addAll = (into: string[], values: readonly string[]) => {
    for (const value of values) if (!into.includes(value)) into.push(value);
  };
  for (const row of stored) {
    if (row.language !== file.language) continue;
    let id: string;
    let key: string;
    try {
      id = patternId(row.language, row.headword, row.meaning);
      key = patternKey(row.headword);
    } catch {
      continue;
    }
    if (patternForm(row.headword) !== row.form) continue;
    const existing = merged.get(id);
    if (existing) {
      addAll(existing.spellings, row.spellings);
      addAll(existing.sources, row.sources);
    } else {
      merged.set(id, {
        id,
        language: row.language,
        form: row.form,
        key,
        meaning: row.meaning,
        headword: row.headword,
        gloss: row.gloss,
        spellings: [...row.spellings],
        sources: [...row.sources],
      });
    }
  }
  for (const { id, spelling } of extraSpellings) {
    const pattern = merged.get(id);
    if (pattern && spelling.trim()) addAll(pattern.spellings, [spelling.trim()]);
  }
  return indexPatterns(file.language, [...merged.values()], false);
}

/** Entries a spelling matches by key (GP2): reuse one by default, the user may change it. */
export function matchPatterns(index: PatternIndex, spelling: string): readonly GrammarPattern[] {
  return index.byKey.get(patternKey(spelling)) ?? [];
}

export type PatternMatches = {
  /** The spelling's key, or null when it can't be read (`problem` says why). */
  key: string | null;
  problem: string | null;
  /** Entries with the same key: reuse them by default (several for a combination seen before). */
  exact: readonly GrammarPattern[];
  /** Entries whose key is inside it (`-아/어지다` and `-네` in `-아/어/여지네`): suggestions only. */
  contained: readonly GrammarPattern[];
};

/** A key's stem for "contained" matching: no spaces, and a dictionary `다` dropped (`아/어지다` → `아/어지`). */
function keyStem(key: string): string {
  const compact = key.replace(/ /g, '');
  return compact.length > 1 && compact.endsWith('다') ? compact.slice(0, -1) : compact;
}

/**
 * What the editor and the AI offer for a book pattern
 * (docs/yalla/grammar-learning-objects.md → Matching at authoring time):
 * exact matches, then entries found inside it. A one-syllable stem (`네`,
 * `면`) only counts at the end of a token, where an ending is.
 */
export function findPatternMatches(index: PatternIndex, spelling: string): PatternMatches {
  let key: string;
  try {
    key = patternKey(spelling);
  } catch (error) {
    return { key: null, problem: error instanceof Error ? error.message : String(error), exact: [], contained: [] };
  }
  const exact = index.byKey.get(key) ?? [];
  const compact = key.replace(/ /g, '');
  const tokens = key.split(' ');
  const contained = [...index.byId.values()].filter((pattern) => {
    if (exact.includes(pattern)) return false;
    const stem = keyStem(pattern.key);
    if (stem === compact) return false;
    return stem.length === 1 ? tokens.some((token) => token.endsWith(stem)) : compact.includes(stem);
  });
  return { key, problem: null, exact, contained };
}

let korean: PatternIndex | null = null;

/** The committed registry for a language (empty for a language without one). */
export function filePatterns(language: string): PatternIndex {
  if (language !== KOREAN) return { language, byId: new Map(), byKey: new Map(), bySource: new Map() };
  korean ??= buildPatternIndex(koreanPatterns);
  return korean;
}
