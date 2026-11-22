import { s } from '@hashbrownai/core';
import { exposeComponent, useTool } from '@hashbrownai/react';
import { DraftRequestError, notifyDraftChanged } from '../../game-authoring/drafts-api';
import { chapterRecipe, PATTERN_RULES, SENSE_RULES } from '../../library/chapter-authoring.prompt';
import { chapterProposalSchema, chapterWordWithSenseSchema, patternWithEntriesSchema } from '../../library/chapter-draft.schema';
import {
  createChapterDraft,
  findPatterns,
  findSenses,
  getChapterDraft,
  suggestBookSlug,
  updateChapterDraft,
  type ChapterDraftView,
} from '../../library/library-api';
import { fetchYalla, type BookSummary } from '../../yalla/yalla-api';
import type { ChatArea } from '../chat-area';
import { findPassage } from '../game-authoring/game-draft-tools';
import { section } from '../prompt-sections';
import {
  applyChapterRevision,
  chapterFromModel,
  patternFromModel,
  splitProblems,
  wordFromModel,
  type ChapterRevision,
} from './chapter-draft-tools';
import { ChapterDraftCard, OpenYallaChapterTrigger } from './ChapterDraftCard';

/** A refused request as the model should read it: what to fix. */
function toolError(error: unknown): Error {
  if (error instanceof DraftRequestError) {
    const details = (error.body.details ?? error.body.problems ?? []).map((d) => `${d.path}: ${d.message}`);
    return new Error([error.message, ...details].join('\n'));
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** What the model sees of a chapter draft: numbered words with their senses, patterns and problems. */
function chapterForModel({ draft, chapter }: ChapterDraftView) {
  const content = draft.payload;
  return {
    draftId: draft.id,
    status: draft.status === 'accepted' ? 'published' : 'draft',
    mine: draft.mine,
    book: content?.bookSlug || (content?.newBook.title ? `new book: ${content.newBook.title}` : null),
    publishedAs: draft.resultChapter,
    editsChapter: draft.editsChapter,
    frozenWords: chapter?.frozen?.words.length ?? 0,
    titleTarget: content?.titleTarget ?? '',
    titleNative: content?.titleNative ?? '',
    lines: content?.dialog.length ?? 0,
    words: (content?.vocabulary ?? []).map((word, i) => ({
      number: i + 1,
      word: word.targetLanguageText,
      gloss: word.nativeLanguageText,
      sense:
        word.sense.decision === 'reuse'
          ? `reuse ${word.sense.reuseId}`
          : word.sense.decision === 'new'
            ? `new ${word.sense.newSense} (${word.sense.kind})${word.sense.confirmed ? ', confirmed' : ', waiting for the user'}`
            : 'undecided',
    })),
    patterns: (content?.patterns ?? []).map((pattern, i) => ({
      number: i + 1,
      pattern: pattern.patternTarget,
      meaning: pattern.patternNative,
      teaches: pattern.entries.map((entry) =>
        entry.decision === 'reuse'
          ? `reuse ${entry.reuseId}`
          : `new ${entry.headword} (${entry.meaning})${entry.confirmed ? ', confirmed' : ', waiting for the user'}`,
      ),
    })),
    ...splitProblems(draft.problems),
  };
}

/**
 * Library chapters in the chat (docs/hashbrown/creating-games-with-hashbrown.md →
 * Feature 2, H2): only when the user asks (G13). The AI looks up senses
 * (`findSenses`) and grammar patterns (`findPatterns`, H4c), saves the
 * chapter as a draft (`proposeChapter`) and shows it with `<ChapterDraft>`.
 * The user confirms new senses and patterns, and publishes (G1, G7, GP5).
 */
export function useLibraryChatArea(userTexts: () => readonly string[]): ChatArea {
  const getBooks = useTool({
    name: 'getBooks',
    description:
      'List the books in the library: built-in, the user\'s own (owner "mine") and other referees\' open books, ' +
      'each with its chapters. A new chapter can only go into one of the user\'s own books, or a new book.',
    handler: async () => {
      try {
        const { books } = await fetchYalla<{ books: BookSummary[] }>('/books', { cache: false });
        return books.map((book) => ({
          book: book.book,
          title: book.title,
          owner: book.owner ?? 'built-in',
          chapters: book.chapters.map((chapter) => ({
            chapter: chapter.chapter,
            title: chapter.titleNative || chapter.titleTarget,
            archived: chapter.archived ?? false,
          })),
        }));
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  const findSensesTool = useTool({
    name: 'findSenses',
    description:
      'Look up the senses the registry already has for words (in dictionary form). Call it before proposeChapter, ' +
      'and reuse a sense whenever one has the meaning the passage uses.',
    schema: s.object('Words to look up', {
      words: s.array('Up to 60 words, dictionary form', s.string('A word, e.g. 토끼')),
      language: s.string('ISO 639 code, e.g. "ko"'),
    }),
    handler: async (input) => {
      try {
        return await findSenses(input.words, input.language.toLowerCase() || 'ko');
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  const findPatternsTool = useTool({
    name: 'findPatterns',
    description:
      'Look up the grammar-pattern entries the registry already has for your patterns, by spelling. Call it before ' +
      'proposeChapter. exact entries are the same pattern: reuse them all. contained entries are found inside it: reuse ' +
      'the ones it teaches. problem means the spelling has no readable Korean pattern.',
    schema: s.object('Patterns to look up', {
      patterns: s.array('Up to 10 patterns, as you will write them in patternTarget', s.string('e.g. "VERB + -았/었더니"')),
      language: s.string('ISO 639 code, e.g. "ko"'),
    }),
    handler: async (input) => {
      try {
        return await findPatterns(input.patterns, input.language.toLowerCase() || 'ko');
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  const proposeChapter = useTool({
    name: 'proposeChapter',
    description:
      'Save a library chapter you made from a passage the user pasted as a new draft. Returns the draftId, ' +
      'problemsToFix (fix them with reviseChapterDraft) and forTheUser (new senses and patterns only the user can confirm). ' +
      'It never publishes: the user does that.',
    schema: s.object('A drafted chapter', {
      passageStart: s.string('The first 8 or so words of the passage, copied exactly from the user\'s message'),
      book: s.string('The slug of one of the user\'s own books (owner "mine" in getBooks), or "" for a new book'),
      newBookTitle: s.string('For a new book: its title, e.g. "Rabbit stories". Never a person\'s name. "" otherwise'),
      chapter: chapterProposalSchema,
    }),
    handler: async (input) => {
      const passage = findPassage(input.passageStart, userTexts());
      const book = input.book.trim()
        ? { bookSlug: input.book.trim() }
        : { newBook: { title: input.newBookTitle.trim(), slug: input.newBookTitle.trim() ? suggestBookSlug(input.newBookTitle) : '' } };
      const payload = chapterFromModel(input.chapter, book);
      try {
        const { draft } = await createChapterDraft({
          ...(passage.ok ? { source: { text: passage.text, language: payload.language ?? { target: 'ko', native: 'en' } } } : {}),
          payload,
        });
        const { toFix, forTheUser } = splitProblems(draft.problems);
        return {
          draftId: draft.id,
          problemsToFix: toFix,
          forTheUser,
          passageKept: passage.ok ? true : `no: ${passage.reason}`,
        };
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  const reviseChapterDraft = useTool({
    name: 'reviseChapterDraft',
    description:
      'Change a chapter draft: retitle it, replace or remove words and patterns by their number now (1-based), or add ' +
      'some at the end. Change only what the user asked for or what a problem names. Returns the problems left.',
    schema: s.object('Changes to a chapter draft', {
      draftId: s.string('The draft to change'),
      titleTarget: s.string('A new title in the target language, or "" to keep it'),
      titleNative: s.string('A new translated title, or "" to keep it'),
      replaceWords: s.array(
        'Words to replace',
        s.object('A replacement', { number: s.number('The word\'s number (1-based)'), word: chapterWordWithSenseSchema }),
      ),
      removeWords: s.array('Numbers of words to remove (1-based)', s.number('A word number')),
      addWords: s.array('Words to add at the end', chapterWordWithSenseSchema),
      replacePatterns: s.array(
        'Patterns to replace',
        s.object('A replacement', { number: s.number('The pattern\'s number (1-based)'), pattern: patternWithEntriesSchema }),
      ),
      removePatterns: s.array('Numbers of patterns to remove (1-based)', s.number('A pattern number')),
      addPatterns: s.array('Patterns to add at the end', patternWithEntriesSchema),
    }),
    handler: async (input) => {
      const revision: ChapterRevision = {
        titleTarget: input.titleTarget,
        titleNative: input.titleNative,
        replaceWords: input.replaceWords.map((change) => ({ number: change.number, word: wordFromModel(change.word) })),
        removeWords: input.removeWords,
        addWords: input.addWords.map(wordFromModel),
        replacePatterns: input.replacePatterns.map((change) => ({ number: change.number, pattern: patternFromModel(change.pattern) })),
        removePatterns: input.removePatterns,
        addPatterns: input.addPatterns.map(patternFromModel),
      };
      // One retry: the draft may have been saved on the Draft Game page meanwhile.
      for (let attempt = 0; ; attempt++) {
        try {
          const current = await getChapterDraft(input.draftId);
          if (current.draft.status !== 'draft') throw new Error('This draft was already published and can no longer change.');
          if (!current.draft.payload) throw new Error('This draft has no chapter yet: use proposeChapter.');
          const next = applyChapterRevision(current.draft.payload, revision);
          const saved = await updateChapterDraft(input.draftId, { revision: current.draft.revision, payload: next });
          notifyDraftChanged(input.draftId);
          const { toFix, forTheUser } = splitProblems(saved.draft.problems);
          return { draftId: input.draftId, words: next.vocabulary.length, problemsToFix: toFix, forTheUser };
        } catch (error) {
          if (attempt === 0 && error instanceof DraftRequestError && error.status === 409 && error.body.draft?.status === 'draft') {
            continue;
          }
          throw toolError(error);
        }
      }
    },
    deps: [],
  });

  const getChapterDraftTool = useTool({
    name: 'getChapterDraft',
    description: 'Read one chapter draft as it is now: its numbered words with their senses, patterns and problems.',
    schema: s.object('Which draft', { draftId: s.string('The draft id') }),
    handler: async (input) => {
      try {
        return chapterForModel(await getChapterDraft(input.draftId));
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  const remixChapter = useTool({
    name: 'remixChapter',
    description:
      'Copy a published chapter (any open or built-in book) into a new chapter draft of the user\'s, keeping every ' +
      'word\'s sense. The user then picks their book and publishes it.',
    schema: s.object('The chapter to remix', {
      book: s.string('The book slug from getBooks'),
      chapter: s.string('The chapter number, e.g. "1"'),
    }),
    handler: async (input) => {
      try {
        const { draft } = await createChapterDraft({ fromChapter: { book: input.book, chapter: input.chapter } });
        return { draftId: draft.id, ...splitProblems(draft.problems) };
      } catch (error) {
        throw toolError(error);
      }
    },
    deps: [],
  });

  return {
    tools: [getBooks, findSensesTool, findPatternsTool, proposeChapter, reviseChapterDraft, getChapterDraftTool, remixChapter],
    components: [
      exposeComponent(ChapterDraftCard, {
        name: 'ChapterDraft',
        description:
          'Show a library chapter draft: its book, words with their senses and problems, and buttons for the user to ' +
          'confirm new senses, publish it, discard it or open it in the Draft Game page.',
        props: { draftId: s.string('The draftId from proposeChapter or remixChapter') },
      }),
      exposeComponent(OpenYallaChapterTrigger, {
        name: 'OpenYallaChapter',
        description: 'Open a chapter in YALLA when the user asks to see or study it.',
        props: {
          book: s.string('The book slug, e.g. from getBooks'),
          chapter: s.string('The chapter number, e.g. "1"'),
        },
      }),
    ],
    prompt: section`
      ## Library chapters
      Only when the user asks ("add this to my library", "save this as a
      chapter"), you turn a pasted passage into a library chapter: the passage,
      its vocabulary and its grammar patterns, studied in YALLA and shared with
      every signed-in user once published. "Make a game" alone never makes a
      chapter.

      Steps:
      1. If you don't know the user's books, call getBooks. A chapter goes into
         one of their own books (owner "mine") or a new book. With no book of
         their own, suggest a title for a new one (never a person's name) and use
         it unless they say otherwise.
      2. Choose the words and patterns, then call findSenses with all the words
         at once and findPatterns with all the patterns at once.
      3. Call proposeChapter with the chapter, a sense for every word and the
         entries every pattern teaches.
      4. Fix problemsToFix with reviseChapterDraft. Never try to fix forTheUser:
         those are new senses and patterns only the user can confirm, on the card.
      5. Show <ChapterDraft>. Say how many words and patterns reuse what other
         books teach and how many are new, and that the user confirms the new
         ones and clicks Publish. Never say it is published until they have
         done that.

      The recipe:
      ${chapterRecipe()}

      Senses:
      ${SENSE_RULES}

      Patterns:
      ${PATTERN_RULES}

      To copy someone's chapter into the user's own book, call remixChapter and
      show the draft. To open a chapter, use <OpenYallaChapter>.

      ### EXAMPLES

      <user>Add this story to my library as a chapter: 옛날 옛적에 토끼와 거북이가 살았어요. …</user>
      <assistant>
        <tool-call>getBooks</tool-call>
      </assistant>
      <assistant>
        <tool-call>findSenses</tool-call>
      </assistant>
      <assistant>
        <tool-call>findPatterns</tool-call>
      </assistant>
      <assistant>
        <tool-call>proposeChapter</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Markdown>Here's the chapter for a new book, Rabbit stories: 12 words (4 reuse senses other books teach, 8 are new) and 2 patterns (one reuses -(으)면, one is new). Confirm the new senses and pattern, then click Publish.</Markdown>
          <ChapterDraft draftId="draft id from proposeChapter" />
        </ui>
      </assistant>

      <user>Open the rabbit chapter</user>
      <assistant>
        <tool-call>getBooks</tool-call>
      </assistant>
      <assistant>
        <ui>
          <OpenYallaChapter book="the book slug from getBooks" chapter=${'1'} />
        </ui>
      </assistant>
    `,
  };
}
