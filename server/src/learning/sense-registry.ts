import { z } from 'zod';
import {
  chapterOfSourceRef,
  defaultKind,
  parseQualifiedSourceRef,
  qualifiedSourceRef,
  vocabularyKindValues,
  type VocabularyKind,
} from './learning-object';

/**
 * Word-sense registry for one language, fed by every book
 * (docs/xAPI/leitner-method.md → The sense registry; learning-objects.md →
 * A1). A learning object is one word in one sense, and every chapter
 * vocabulary entry maps to exactly one sense. Pure: callers read and write
 * the JSON file.
 */

export type Sense = {
  /** ASCII slug, unique per word, permanent once used in an IRI. */
  sense: string;
  /** Set when first registered (`defaultKind`); a person may change it before pilot data exists. */
  kind: VocabularyKind;
  /** English gloss when the sense was first registered. */
  gloss: string;
  /** Book-qualified entries that teach this sense, e.g. `korean-language-book/ch27/vocabulary/1`. */
  sources: string[];
};

export type SenseRegistry = {
  /** ISO 639 code, e.g. `ko`. */
  language: string;
  /** Keyed by `normaliseWord(target)`. */
  words: Record<string, Sense[]>;
};

export type VocabularyEntry = {
  sourceRef: string;
  /** Korean, normalised. */
  word: string;
  /** English. */
  gloss: string;
  /** The source file had Korean and English in each other's fields (ch. 28). */
  swapped: boolean;
};

export type ChapterVocabulary = {
  chapter: string;
  entries: VocabularyEntry[];
  problems: string[];
};

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const MAX_SLUG_LENGTH = 40;

const chapterSchema = z.object({
  chapter: z.union([z.string(), z.number()]),
  vocabulary: z.array(
    z.object({
      id: z.number().int().optional(),
      targetLanguageText: z.string().min(1),
      nativeLanguageText: z.string().min(1),
    }),
  ),
});

/** NFC, trimmed, inner whitespace collapsed: `보여  주다 ` → `보여 주다`. */
export function normaliseWord(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** `Test, exam ` → `['test', 'exam']`. Commas only: `school/office` is one meaning. */
export function glossParts(gloss: string): string[] {
  return gloss
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);
}

/** First meaning as an ASCII slug: `to get (sick), to catch a disease` → `to-get-sick`. */
export function senseSlug(gloss: string): string {
  const slug = (glossParts(gloss)[0] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= MAX_SLUG_LENGTH) {
    return slug || 'sense';
  }
  const cut = slug.slice(0, MAX_SLUG_LENGTH + 1);
  const lastBreak = cut.lastIndexOf('-');
  return lastBreak > 0 ? cut.slice(0, lastBreak) : slug.slice(0, MAX_SLUG_LENGTH);
}

/**
 * Vocabulary entries from a language-learning-app `chapterNNData.json`.
 * `sourceRef` uses the entry's own `id` when present (ch. 28's are 346–375),
 * so reordering the file doesn't renumber entries.
 */
export function chapterVocabulary(raw: unknown): ChapterVocabulary {
  const parsed = chapterSchema.parse(raw);
  const chapter = String(parsed.chapter);
  const entries: VocabularyEntry[] = [];
  const problems: string[] = [];
  const seenRefs = new Set<string>();

  parsed.vocabulary.forEach((entry, index) => {
    const sourceRef = `ch${chapter}/vocabulary/${entry.id ?? index}`;
    if (seenRefs.has(sourceRef)) {
      problems.push(`${sourceRef}: duplicate entry id`);
      return;
    }
    seenRefs.add(sourceRef);

    let word = entry.targetLanguageText;
    let gloss = entry.nativeLanguageText;
    let swapped = false;
    if (!HANGUL.test(word) && HANGUL.test(gloss)) {
      [word, gloss] = [gloss, word];
      swapped = true;
    }
    if (!HANGUL.test(word)) {
      problems.push(`${sourceRef}: no Korean text in '${entry.targetLanguageText}' / '${entry.nativeLanguageText}'`);
      return;
    }
    entries.push({ sourceRef, word: normaliseWord(word), gloss: gloss.trim(), swapped });
  });

  return { chapter, entries, problems };
}

/** `sourceRef` is book-qualified. */
export type SenseAssignment = { sourceRef: string; word: string; sense: string };

/** A known word whose gloss matches no sense, or more than one: a person decides. */
export type SenseConflict = {
  sourceRef: string;
  word: string;
  gloss: string;
  candidates: Sense[];
};

export type SenseRegistryUpdate = {
  registry: SenseRegistry;
  /** New senses created. */
  added: SenseAssignment[];
  /** Entries attached to an existing sense. */
  attached: SenseAssignment[];
  /** Left unregistered; resolve by editing the registry file. */
  conflicts: SenseConflict[];
  /** Registry entries that no longer match the chapter files, or bad files. */
  problems: string[];
};

function uniqueSlug(base: string, senses: readonly Sense[]): string {
  const taken = new Set(senses.map((sense) => sense.sense));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) {
    slug = `${base}-${n}`;
  }
  return slug;
}

/**
 * Registers every entry of `book`'s chapters not yet in the registry, in
 * chapter order:
 * - a new word gets a new sense;
 * - a known word attaches to the one sense sharing a gloss part with it;
 * - anything else is a conflict and stays unregistered.
 * Registered entries are checked, never moved. Re-running is a no-op.
 */
export function updateSenseRegistry(
  registry: SenseRegistry,
  book: string,
  chapters: readonly ChapterVocabulary[],
): SenseRegistryUpdate {
  const next: SenseRegistry = structuredClone(registry);
  const added: SenseAssignment[] = [];
  const attached: SenseAssignment[] = [];
  const conflicts: SenseConflict[] = [];
  const problems = chapters.flatMap((chapter) => chapter.problems);

  const registered = new Map<string, SenseAssignment>();
  for (const [word, senses] of Object.entries(next.words)) {
    for (const sense of senses) {
      if (!(vocabularyKindValues as readonly string[]).includes(sense.kind)) {
        problems.push(`${word}/${sense.sense}: unknown kind '${String(sense.kind)}'`);
      }
      for (const sourceRef of sense.sources) {
        if (!parseQualifiedSourceRef(sourceRef)) {
          problems.push(`${word}/${sense.sense}: source '${sourceRef}' is not book/chNN/section/N`);
        }
        const existing = registered.get(sourceRef);
        if (existing) {
          problems.push(`${sourceRef}: registered under both '${existing.word}/${existing.sense}' and '${word}/${sense.sense}'`);
        }
        registered.set(sourceRef, { sourceRef, word, sense: sense.sense });
      }
    }
  }

  const entryRefs = new Set<string>();
  for (const { entries } of chapters) {
    for (const entry of entries) {
      const sourceRef = qualifiedSourceRef(book, entry.sourceRef);
      entryRefs.add(sourceRef);
      const known = registered.get(sourceRef);
      if (known) {
        if (known.word !== entry.word) {
          problems.push(`${sourceRef}: registered as '${known.word}' but the chapter now says '${entry.word}'`);
        }
        continue;
      }

      const senses = (next.words[entry.word] ??= []);
      if (senses.length === 0) {
        const sense: Sense = {
          sense: uniqueSlug(senseSlug(entry.gloss), senses),
          kind: defaultKind(entry.word),
          gloss: entry.gloss,
          sources: [sourceRef],
        };
        senses.push(sense);
        added.push({ sourceRef, word: entry.word, sense: sense.sense });
        continue;
      }

      const parts = new Set(glossParts(entry.gloss));
      const matches = senses.filter((sense) => glossParts(sense.gloss).some((part) => parts.has(part)));
      if (matches.length === 1) {
        matches[0].sources.push(sourceRef);
        attached.push({ sourceRef, word: entry.word, sense: matches[0].sense });
      } else {
        conflicts.push({ sourceRef, word: entry.word, gloss: entry.gloss, candidates: senses });
      }
    }
  }

  const checkedChapters = new Set(chapters.map((chapter) => chapter.chapter));
  for (const sourceRef of registered.keys()) {
    const parsed = parseQualifiedSourceRef(sourceRef);
    const chapter = parsed && chapterOfSourceRef(parsed.sourceRef);
    if (parsed?.book === book && chapter && checkedChapters.has(chapter) && !entryRefs.has(sourceRef)) {
      problems.push(`${sourceRef}: registered but no longer in chapter ${chapter}`);
    }
  }

  for (const [word, senses] of Object.entries(next.words)) {
    if (senses.length === 0) delete next.words[word];
  }

  return { registry: next, added, attached, conflicts, problems };
}

export function emptySenseRegistry(language: string): SenseRegistry {
  return { language, words: {} };
}
