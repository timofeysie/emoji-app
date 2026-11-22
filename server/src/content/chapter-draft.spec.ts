import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CHAPTER_DRAFT_LIMITS,
  chapterDraftPayloadSchema,
  chapterDraftProblems,
  patternRegistryProblems,
  publishedChapter,
  senseRegistryProblems,
  suggestBookSlug,
  type ChapterDraftInput,
  type FrozenChapter,
} from './chapter-draft';
import { kogsChapterV1Schema } from './kogs-chapter';

const words: Array<[string, string]> = [
  ['토끼', 'rabbit'],
  ['거북이', 'turtle'],
  ['경주', 'race'],
  ['달리다', 'to run'],
  ['언덕', 'hill'],
  ['잠', 'sleep'],
];

function draft(overrides: Partial<ChapterDraftInput> = {}) {
  return chapterDraftPayloadSchema.parse({
    newBook: { title: 'Rabbit stories', slug: 'rabbit-stories-1a2b' },
    titleTarget: '토끼와 거북이',
    titleNative: 'The rabbit and the turtle',
    dialog: [{ speechTarget: '옛날 옛적에 토끼와 거북이가 살았어요.', speechNative: 'Once upon a time there lived a rabbit and a turtle.' }],
    vocabulary: words.map(([word, gloss]) => ({
      targetLanguageText: word,
      nativeLanguageText: gloss,
      sense: { decision: 'new', newSense: gloss.replace(/^to /, 'to-').replace(/ /g, '-'), confirmed: true },
    })),
    patterns: [
      {
        patternTarget: '-았/었어요',
        patternNative: 'past tense',
        entries: [{ decision: 'new', headword: '-았/었어요', meaning: 'did-polite', gloss: 'did (polite past)', confirmed: true }],
      },
    ],
    ...overrides,
  });
}

describe('chapter limits', () => {
  it('are the client’s (library/chapter-limits.ts)', () => {
    // Read as text: the server build can't import client files.
    const file = readFileSync(join(__dirname, '../../../client/src/app/library/chapter-limits.ts'), 'utf8');
    const limits = file.match(/CHAPTER_LIMITS = \{([\s\S]*?)\} as const/)?.[1] ?? '';
    const clientLimits = Object.fromEntries([...limits.matchAll(/^\s*(\w+): (\d+),/gm)].map(([, name, value]) => [name, Number(value)]));

    expect(clientLimits).toEqual(CHAPTER_DRAFT_LIMITS);
  });
});

describe('kogs.chapter.v1', () => {
  it.each(['26', '27', '28', '29', '30'])('parses built-in chapter %s', (chapter) => {
    const raw = JSON.parse(readFileSync(join(__dirname, `../games/content/chapter${chapter}Data.json`), 'utf8'));
    const parsed = kogsChapterV1Schema.parse(raw);

    expect(parsed.chapter).toBe(chapter);
    expect(parsed.vocabulary.length).toBeGreaterThan(0);
  });
});

describe('chapterDraftProblems', () => {
  it('accepts a complete draft for a new book', () => {
    expect(chapterDraftProblems(draft())).toEqual([]);
  });

  it(`needs at least ${CHAPTER_DRAFT_LIMITS.minVocabulary} words, a passage and titles`, () => {
    const problems = chapterDraftProblems(
      draft({ vocabulary: draft().vocabulary.slice(0, 5), dialog: [], titleNative: '' }),
    ).map((problem) => problem.path);

    expect(problems).toEqual(expect.arrayContaining(['vocabulary', 'dialog', 'titleNative']));
  });

  it('needs a book: an existing one, or a title and an ASCII link name that isn’t a built-in book’s', () => {
    expect(chapterDraftProblems(draft({ newBook: { title: '', slug: '' } })).map((p) => p.path)).toEqual(
      expect.arrayContaining(['newBook.title', 'newBook.slug']),
    );
    expect(chapterDraftProblems(draft({ newBook: { title: 'Mine', slug: 'korean-language-book' } }))[0].path).toBe('newBook.slug');
    expect(chapterDraftProblems(draft({ newBook: { title: '토끼', slug: '토끼-1a2b' } }))[0].path).toBe('newBook.slug');
    expect(chapterDraftProblems(draft({ bookSlug: 'rabbit-stories-1a2b', newBook: { title: '', slug: '' } }))).toEqual([]);
  });

  it('needs a sense decision per word: unconfirmed new senses, bad slugs and other words’ senses are problems', () => {
    const vocabulary = draft().vocabulary;
    vocabulary[0] = { ...vocabulary[0], sense: { ...vocabulary[0].sense, confirmed: false } };
    vocabulary[1] = { ...vocabulary[1], sense: { ...vocabulary[1].sense, newSense: 'Turtle!' } };
    vocabulary[2] = { ...vocabulary[2], sense: { ...vocabulary[2].sense, decision: 'reuse', reuseId: 'ko/lexeme/시험/test' } };
    vocabulary[3] = { ...vocabulary[3], sense: { ...vocabulary[3].sense, decision: 'undecided' } };

    const messages = chapterDraftProblems(draft({ vocabulary })).map((problem) => problem.message);

    expect(messages).toEqual([
      '“토끼”: confirm the new sense “rabbit”',
      '“거북이”: the new sense name must be lower-case ASCII letters, digits and hyphens, e.g. rabbit',
      '“경주”: “ko/lexeme/시험/test” isn’t a sense of this word',
      '“달리다”: reuse an existing sense or add a new one',
    ]);
  });

  it('refuses a word without Korean, and the same word twice in one sense', () => {
    const vocabulary = draft().vocabulary;
    vocabulary[1] = { ...vocabulary[0] };
    vocabulary[2] = { ...vocabulary[2], targetLanguageText: 'race' };

    const messages = chapterDraftProblems(draft({ vocabulary })).map((problem) => problem.message);

    expect(messages).toEqual(['“토끼” repeats word 1 in the same sense', '“race” has no Korean in it']);
  });

  describe('a published chapter (G8)', () => {
    const published = publishedChapter(draft(), '1');
    const frozen: FrozenChapter = {
      book: 'rabbit-stories-1a2b',
      chapter: '1',
      words: published.content.vocabulary.map((entry) => entry.targetLanguageText),
      senseIds: published.senseIds,
      patternCount: 1,
      patternIds: published.patternIds,
    };
    // An edit draft reuses the published senses.
    const edit = (vocabulary: ReturnType<typeof draft>['vocabulary']) =>
      draft({
        bookSlug: 'rabbit-stories-1a2b',
        vocabulary: vocabulary.map((entry, i) => ({
          ...entry,
          sense: i < frozen.senseIds.length ? { ...entry.sense, decision: 'reuse', reuseId: frozen.senseIds[i] } : entry.sense,
        })),
      });

    it('can correct glosses and append words', () => {
      const vocabulary = draft().vocabulary;
      vocabulary[0] = { ...vocabulary[0], nativeLanguageText: 'rabbit, bunny' };
      vocabulary.push({
        targetLanguageText: '이기다',
        nativeLanguageText: 'to win',
        sense: { decision: 'new', reuseId: '', newSense: 'to-win', kind: 'lexeme', newGloss: '', confirmed: true },
      });

      expect(chapterDraftProblems(edit(vocabulary), frozen)).toEqual([]);
    });

    it('can’t reorder, remove or change the sense of a published word, or remove a pattern', () => {
      const vocabulary = draft().vocabulary;
      const reordered = [vocabulary[1], vocabulary[0], ...vocabulary.slice(2)];

      expect(chapterDraftProblems(edit(reordered), frozen).map((p) => p.path)).toEqual(
        expect.arrayContaining(['vocabulary.0', 'vocabulary.1']),
      );
      expect(chapterDraftProblems(edit(vocabulary.slice(1)), frozen).map((p) => p.path)).toContain('vocabulary');
      expect(chapterDraftProblems({ ...edit(vocabulary), patterns: [] }, frozen).map((p) => p.path)).toEqual(['patterns']);
    });

    it('keeps a published pattern’s entries, and can add others', () => {
      const reused = { decision: 'reuse' as const, reuseId: 'ko/grammar-pattern/at-eot-yo/did-polite', headword: '', meaning: '', gloss: '', confirmed: false };
      const pattern = edit(draft().vocabulary).patterns[0];
      const swapped = { ...edit(draft().vocabulary), patterns: [{ ...pattern, entries: [{ ...reused, reuseId: 'ko/grammar-pattern/eu-myeon/if' }] }] };
      const added = { ...edit(draft().vocabulary), patterns: [{ ...pattern, entries: [reused, { ...reused, reuseId: 'ko/grammar-pattern/eu-myeon/if' }] }] };

      expect(frozen.patternIds).toEqual([['ko/grammar-pattern/at-eot-eoyo/did-polite']]);
      expect(chapterDraftProblems(swapped, frozen).map((p) => p.message)).toEqual([
        'Pattern 1 was published teaching ko/grammar-pattern/at-eot-eoyo/did-polite: published links stay, others can be added',
      ]);
      const keeps = { ...added, patterns: [{ ...pattern, entries: [{ ...reused, reuseId: frozen.patternIds[0][0] }, added.patterns[0].entries[1]] }] };
      expect(chapterDraftProblems(keeps, frozen)).toEqual([]);
    });
  });
});

describe('pattern entries (H4c, GP5)', () => {
  const entry = { decision: 'new', headword: '-았/었어요', meaning: 'did-polite', gloss: 'did (polite past)', confirmed: true } as const;
  const withEntries = (entries: unknown[]) =>
    draft({ patterns: [{ patternTarget: 'VERB + -았/었어요', patternNative: 'did', entries } as never] });
  const messages = (entries: unknown[]) => chapterDraftProblems(withEntries(entries)).map((problem) => problem.message);

  it('a book pattern needs at least one entry', () => {
    expect(messages([])).toEqual([
      'Pattern 1 (“VERB + -았/었어요”): link it to the grammar it teaches: reuse an entry or add a new one',
    ]);
  });

  it('a new entry needs a readable headword, a meaning slug, a gloss and the user’s confirmation', () => {
    expect(messages([{ ...entry, confirmed: false }])).toEqual(['Pattern 1 (“VERB + -았/었어요”): confirm the new pattern “-았/었어요” (did-polite)']);
    expect(messages([{ ...entry, headword: 'VERB' }])[0]).toMatch(/Can't read the pattern 'VERB': it has no Korean in it/);
    expect(messages([{ ...entry, meaning: 'Did!' }])[0]).toMatch(/meaning must be lower-case ASCII/);
    expect(messages([{ ...entry, gloss: ' ' }])[0]).toMatch(/has no gloss/);
  });

  it('a reused entry must be a grammar pattern of the language, linked once', () => {
    const reuse = { decision: 'reuse', reuseId: 'ko/grammar-pattern/eu-myeon/if' };
    expect(messages([reuse])).toEqual([]);
    expect(messages([{ ...reuse, reuseId: 'ko/lexeme/시험/test' }])[0]).toMatch(/isn’t a grammar pattern of this language/);
    expect(messages([reuse, reuse])[0]).toMatch(/links ko\/grammar-pattern\/eu-myeon\/if twice/);
  });

  it('the registry check: a reused entry exists, a new one doesn’t yet', () => {
    const registry = new Set(['ko/grammar-pattern/at-eot-eoyo/did-polite']);
    const payload = withEntries([entry, { decision: 'reuse', reuseId: 'ko/grammar-pattern/ne/noticing' }]);

    expect(patternRegistryProblems(payload, registry).map((problem) => problem.message)).toEqual([
      'Pattern 1: ko/grammar-pattern/at-eot-eoyo/did-polite already exists; reuse it instead of adding it',
      'Pattern 1: there is no grammar pattern ko/grammar-pattern/ne/noticing to reuse',
    ]);
  });

  it('publishes each pattern’s entries, and a new entry once even if two patterns add it', () => {
    const payload = draft({
      patterns: [
        { patternTarget: '-았/었어요', entries: [entry] },
        { patternTarget: 'VERB + -았/었어요', entries: [{ ...entry, gloss: 'other wording' }, { decision: 'reuse', reuseId: 'ko/grammar-pattern/eu-myeon/if' }] },
      ] as never,
    });
    const { patternIds, newPatterns } = publishedChapter(payload, '1');

    expect(patternIds).toEqual([
      ['ko/grammar-pattern/at-eot-eoyo/did-polite'],
      ['ko/grammar-pattern/at-eot-eoyo/did-polite', 'ko/grammar-pattern/eu-myeon/if'],
    ]);
    expect(newPatterns).toEqual([
      { language: 'ko', form: 'at-eot-eoyo', meaning: 'did-polite', headword: '-았/었어요', gloss: 'did (polite past)', id: 'ko/grammar-pattern/at-eot-eoyo/did-polite' },
    ]);
  });
});

describe('senseRegistryProblems', () => {
  it('a reused sense must exist, and a new one must not', () => {
    const vocabulary = draft().vocabulary;
    vocabulary[0] = { ...vocabulary[0], sense: { ...vocabulary[0].sense, decision: 'reuse', reuseId: 'ko/lexeme/토끼/hare' } };
    const registry = new Set(['ko/lexeme/거북이/turtle']);

    const messages = senseRegistryProblems(draft({ vocabulary }), registry).map((problem) => problem.message);

    expect(messages).toEqual([
      '“토끼”: there is no sense ko/lexeme/토끼/hare to reuse',
      '“거북이”: the sense ko/lexeme/거북이/turtle already exists; reuse it instead of adding it',
    ]);
  });
});

describe('publishedChapter', () => {
  it('numbers the vocabulary by index, keeps a sense per entry and lists the new senses', () => {
    const { content, senseIds, newSenses } = publishedChapter(draft(), '3');

    expect(content.chapter).toBe('3');
    expect(content.vocabulary.map((entry) => entry.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(senseIds[0]).toBe('ko/lexeme/토끼/rabbit');
    expect(newSenses[3]).toEqual({ language: 'ko', kind: 'lexeme', word: '달리다', sense: 'to-run', gloss: 'to run', id: 'ko/lexeme/달리다/to-run' });
    expect(kogsChapterV1Schema.parse(content)).toMatchObject({ chapter: '3', titleTarget: '토끼와 거북이' });
  });
});

describe('suggestBookSlug', () => {
  it('slugs the title with 4 hex digits; Hangul-only titles become book-…', () => {
    expect(suggestBookSlug('The Rabbit & the Turtle!', '3f9a')).toBe('the-rabbit-the-turtle-3f9a');
    expect(suggestBookSlug('토끼 이야기', '3f9a')).toBe('book-3f9a');
    expect(suggestBookSlug('x'.repeat(100), '3f9a').length).toBeLessThanOrEqual(CHAPTER_DRAFT_LIMITS.maxBookSlugLength);
  });
});
