import {
  bookIri,
  chapterIri,
  defaultKind,
  EXT_ASPECT,
  EXT_GAME_KIND,
  EXT_ROLE,
  EXT_SCORER,
  EXT_SOURCE_REF,
  EXT_STRENGTH,
  KOREAN,
  KOREAN_BOOK,
  learningObjectIri,
  type VocabularyKind,
} from '../learning/learning-object';
import { ASSESSED_VERB_ID, XAPI_BASE_IRI, XAPI_HOMEPAGE } from '../xapi/iris';

/**
 * An `assessed` statement in the shape docs/xAPI/learning-objects.md → A2
 * describes, for specs. Overrides are shallow.
 */
export function assessedStatement(input: {
  id: string;
  word: string;
  sense: string;
  kind?: VocabularyKind;
  language?: string;
  aspect?: string;
  success: boolean;
  timestamp: string;
  sourceRef?: string;
  chapter?: string;
  gameKind?: string;
  strength?: string;
  externalId?: string;
  book?: string;
}): Record<string, unknown> {
  const book = input.book ?? KOREAN_BOOK;
  const chapter = input.chapter ?? '27';
  const key = {
    language: input.language ?? KOREAN,
    kind: input.kind ?? defaultKind(input.word),
    word: input.word,
    sense: input.sense,
  };
  return {
    id: input.id,
    actor: {
      objectType: 'Agent',
      name: 'Player 7F3A',
      account: { homePage: XAPI_HOMEPAGE, name: input.externalId ?? '7f3a2c1e-0000-4000-8000-000000000000' },
    },
    verb: { id: ASSESSED_VERB_ID, display: { 'en-US': 'was assessed on' } },
    object: { objectType: 'Activity', id: learningObjectIri(key) },
    result: { success: input.success },
    timestamp: input.timestamp,
    context: {
      registration: '0b7e2a1c-3d4f-5a6b-8c9d-0e1f2a3b4c5d',
      statement: { objectType: 'StatementRef', id: '5d1c3a6e-0000-4000-8000-000000000000' },
      contextActivities: {
        parent: [{ id: `${XAPI_BASE_IRI}/games/g1/questions/${input.id}` }],
        grouping: [{ id: chapterIri(book, chapter) }, { id: bookIri(book) }],
      },
      extensions: {
        [`${XAPI_BASE_IRI}/ext/game-id`]: 'g1',
        [EXT_ASPECT]: input.aspect ?? 'reading',
        [EXT_ROLE]: 'whole',
        [EXT_STRENGTH]: input.strength ?? 'direct',
        [EXT_SOURCE_REF]: `${book}/${input.sourceRef ?? `ch${chapter}/vocabulary/1`}`,
        [EXT_GAME_KIND]: input.gameKind ?? 'leitner-solo',
        [EXT_SCORER]: 'choice-whole@1',
      },
    },
  };
}
