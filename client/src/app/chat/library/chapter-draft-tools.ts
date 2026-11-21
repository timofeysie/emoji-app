import type { ChapterProposalOutput, ChapterWordWithSense } from '../../library/chapter-draft.schema';
import { CHAPTER_LIMITS } from '../../library/chapter-limits';
import {
  emptyDecision,
  type ChapterDraftContent,
  type ChapterPattern,
  type ChapterWord,
  type SenseDecision,
} from '../../library/library-api';

/** The model's sense decision as the draft stores it. A new sense waits for the user's confirmation (G7). */
export function decisionFromModel(sense: ChapterWordWithSense['sense']): SenseDecision {
  if (sense.decision === 'reuse' && sense.reuseId.trim()) {
    return { ...emptyDecision(), decision: 'reuse', reuseId: sense.reuseId.trim(), kind: sense.kind };
  }
  if (sense.decision === 'new' && sense.newSense.trim()) {
    return { ...emptyDecision(), decision: 'new', newSense: sense.newSense.trim().toLowerCase(), kind: sense.kind };
  }
  return emptyDecision();
}

export function wordFromModel(word: ChapterWordWithSense): ChapterWord {
  return {
    targetLanguageText: word.targetLanguageText.trim(),
    nativeLanguageText: word.nativeLanguageText.trim(),
    sense: decisionFromModel(word.sense),
  };
}

export function patternFromModel(pattern: ChapterProposalOutput['patterns'][number]): ChapterPattern {
  return {
    ...pattern,
    sampleSentences: pattern.sampleSentences.map((sample) => ({ ...sample })),
    exercises: pattern.exercises.map((exercise) => ({ ...exercise })),
  };
}

/** `proposeChapter`'s chapter as a draft payload, into `book` (one of the user's) or a new book. */
export function chapterFromModel(
  output: ChapterProposalOutput,
  book: { bookSlug: string } | { newBook: { title: string; slug: string } },
): ChapterDraftContent {
  return {
    bookSlug: 'bookSlug' in book ? book.bookSlug : '',
    newBook: 'newBook' in book ? book.newBook : { title: '', slug: '' },
    language: { target: output.language.target.toLowerCase(), native: output.language.native.toLowerCase() },
    titleTarget: output.titleTarget,
    titleNative: output.titleNative,
    dialog: output.dialog.map((line) => ({ ...line })),
    vocabulary: output.vocabulary.map(wordFromModel),
    patterns: output.patterns.map(patternFromModel),
  };
}

/** The draft's problems: the ones the model should fix, and the confirmations only the user can give. */
export function splitProblems(problems: ReadonlyArray<{ path: string; message: string }>): {
  toFix: string[];
  forTheUser: string[];
} {
  const forTheUser = problems.filter((problem) => /confirm the new sense/.test(problem.message)).map((problem) => problem.message);
  const toFix = problems.filter((problem) => !/confirm the new sense/.test(problem.message)).map((problem) => problem.message);
  return { toFix, forTheUser };
}

export type ChapterRevision = {
  titleTarget: string;
  titleNative: string;
  replaceWords: Array<{ number: number; word: ChapterWord }>;
  removeWords: number[];
  addWords: ChapterWord[];
  replacePatterns: Array<{ number: number; pattern: ChapterPattern }>;
  removePatterns: number[];
  addPatterns: ChapterPattern[];
};

function applyNumbered<T>(items: readonly T[], replace: Array<{ number: number; item: T }>, remove: number[], add: T[], what: string): T[] {
  const bad = [...replace.map((change) => change.number), ...remove].filter(
    (number) => !Number.isInteger(number) || number < 1 || number > items.length,
  );
  if (bad.length > 0) {
    throw new Error(`The draft has ${what}s 1–${items.length}; there is no ${what} ${bad.join(', ')}. Call getChapterDraft to see it now.`);
  }
  const next: Array<T | null> = [...items];
  for (const { number, item } of replace) next[number - 1] = item;
  for (const number of remove) next[number - 1] = null;
  return [...next.filter((item): item is T => item !== null), ...add];
}

/** Applies a `reviseChapterDraft` call, by the numbers words and patterns have now (1-based). */
export function applyChapterRevision(content: ChapterDraftContent, revision: ChapterRevision): ChapterDraftContent {
  const vocabulary = applyNumbered(
    content.vocabulary,
    revision.replaceWords.map(({ number, word }) => ({ number, item: word })),
    revision.removeWords,
    revision.addWords,
    'word',
  );
  if (vocabulary.length > CHAPTER_LIMITS.maxVocabulary) {
    throw new Error(`A chapter can have at most ${CHAPTER_LIMITS.maxVocabulary} words; this would make ${vocabulary.length}.`);
  }
  const patterns = applyNumbered(
    content.patterns,
    revision.replacePatterns.map(({ number, pattern }) => ({ number, item: pattern })),
    revision.removePatterns,
    revision.addPatterns,
    'pattern',
  );
  return {
    ...content,
    titleTarget: revision.titleTarget.trim() || content.titleTarget,
    titleNative: revision.titleNative.trim() || content.titleNative,
    vocabulary,
    patterns,
  };
}
