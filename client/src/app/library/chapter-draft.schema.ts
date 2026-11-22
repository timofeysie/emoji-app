import { s } from '@hashbrownai/core';

/** A dialog line, or one sentence of a story (no speaker). */
const dialogLineSchema = s.object('One line of the passage', {
  speakerNameTarget: s.string('The speaker in the target language, or "" for a story'),
  speakerNameNative: s.string('The speaker in the learner\'s language, or ""'),
  speechTarget: s.string('The sentence exactly as the passage has it'),
  speechNative: s.string('Its translation into the learner\'s language'),
});

const patternFields = {
  patternTarget: s.string(
    'The smallest teachable pattern as the passage uses it, after what it attaches to, e.g. "VERB + -았/었더니" or "ADJECTIVE + -아/어/여지네"',
  ),
  patternNative: s.string('What it means or does, e.g. "when I did …, (I found that) …"'),
  type: s.string('"casual", "polite" or "formal", or "" if it doesn\'t apply'),
  exampleSentenceTarget: s.string('The passage sentence that uses it, exactly as written'),
  exampleSentenceNative: s.string('Its translation'),
  sampleSentences: s.array(
    'Two new example sentences',
    s.object('An example', { targetText: s.string('In the target language'), nativeText: s.string('Its translation') }),
  ),
  exercises: s.array(
    'Two exercises: a sentence to translate using the pattern, with the answer',
    s.object('An exercise', {
      exercise: s.string('In the learner\'s language, with any new word given, e.g. "I\'m getting curious. (궁금하다)"'),
      answerKey: s.string('The answer in the target language'),
    }),
  ),
};

const patternSchema = s.object('A grammar pattern the passage uses', patternFields);

/** One registry entry a pattern teaches (GP5), as the chat writes it after `findPatterns`. */
export const patternEntrySchema = s.object('A grammar entry the pattern teaches', {
  decision: s.enumeration('reuse an entry from findPatterns, or new when none teaches this grammar', ['reuse', 'new']),
  reuseId: s.string('reuse: the id from findPatterns, e.g. ko/grammar-pattern/a-eo-jida/become; new: ""'),
  headword: s.string('new: the smallest pattern in dictionary style, e.g. "-아/어/여지다"; reuse: ""'),
  meaning: s.string('new: an ASCII slug of its first English meaning, e.g. "become"; reuse: ""'),
  gloss: s.string('new: what it means, e.g. "gets to be, becomes"; reuse: ""'),
});

/** A pattern with the entries it teaches, as the chat's `proposeChapter` and `reviseChapterDraft` take it. */
export const patternWithEntriesSchema = s.object('A grammar pattern the passage uses', {
  ...patternFields,
  entries: s.array('The grammar it teaches: usually one entry, two for a combination like -아/어지네 (-아/어지다 and -네)', patternEntrySchema),
});

/** One word, without a sense: the Draft Game page matches senses itself. */
export const chapterWordSchema = s.object('A vocabulary entry', {
  targetLanguageText: s.string('The dictionary form, e.g. 달리다 not 달렸더니'),
  nativeLanguageText: s.string('Glosses separated by commas, the meaning in this passage first, e.g. "to run, to dash"'),
});

/** A word with its sense decision (G7), as the chat's `proposeChapter` writes it after `findSenses`. */
export const chapterWordWithSenseSchema = s.object('A vocabulary entry and its sense', {
  targetLanguageText: s.string('The dictionary form, e.g. 달리다 not 달렸더니'),
  nativeLanguageText: s.string('Glosses separated by commas, the meaning in this passage first'),
  sense: s.object('Which learning object the word teaches', {
    decision: s.enumeration('reuse an existing sense from findSenses, or new when none has this meaning', ['reuse', 'new']),
    reuseId: s.string('reuse: the id from findSenses, e.g. ko/lexeme/시험/test; new: ""'),
    newSense: s.string('new: an ASCII slug of the meaning, e.g. rabbit or to-run; reuse: ""'),
    kind: s.enumeration('lexeme for one word, expression for several words', ['lexeme', 'expression']),
  }),
});

const chapterFields = {
  titleTarget: s.string('A short chapter title in the target language'),
  titleNative: s.string('The title in the learner\'s language'),
  language: s.object('Languages', {
    target: s.string('ISO 639 code of the passage\'s language, e.g. "ko"'),
    native: s.string('ISO 639 code of the learner\'s language, e.g. "en"'),
  }),
  dialog: s.array('The whole passage, one sentence or line per entry, in order', dialogLineSchema),
  patterns: s.array('The grammar patterns to teach', patternSchema),
};

/** What the Draft Game page asks for when it generates a chapter. */
export const chapterDraftSchema = s.object('A library chapter made from a passage', {
  ...chapterFields,
  vocabulary: s.array('The words to teach, in the order the passage uses them', chapterWordSchema),
});

/** What the chat's `proposeChapter` takes: the same chapter, each word with its sense and each pattern with its entries. */
export const chapterProposalSchema = s.object('A library chapter made from a passage', {
  ...chapterFields,
  vocabulary: s.array('The words to teach, in the order the passage uses them', chapterWordWithSenseSchema),
  patterns: s.array('The grammar patterns to teach', patternWithEntriesSchema),
});

export type ChapterDraftOutput = s.Infer<typeof chapterDraftSchema>;
export type ChapterProposalOutput = s.Infer<typeof chapterProposalSchema>;
export type ChapterWordWithSense = s.Infer<typeof chapterWordWithSenseSchema>;
export type PatternWithEntries = s.Infer<typeof patternWithEntriesSchema>;
