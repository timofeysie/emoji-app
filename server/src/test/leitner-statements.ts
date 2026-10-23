import {
  bookIri,
  chapterIri,
  EXT_ASPECT,
  EXT_GAME_KIND,
  EXT_SOURCE_REF,
  KOREAN_BOOK,
  learningObjectIri,
} from '../learning/learning-object';
import { ANSWERED_VERB_ID, XAPI_BASE_IRI, XAPI_HOMEPAGE } from '../xapi/iris';

/**
 * A tagged `answered` statement in the shape docs/xAPI/leitner-method.md →
 * Statement changes describes, for specs. Overrides are shallow.
 */
export function taggedAnswer(input: {
  id: string;
  word: string;
  sense: string;
  aspect?: string;
  success: boolean;
  timestamp: string;
  sourceRef?: string;
  chapter?: string;
  gameKind?: string;
  externalId?: string;
  book?: string;
}): Record<string, unknown> {
  const book = input.book ?? KOREAN_BOOK;
  const chapter = input.chapter ?? '27';
  return {
    id: input.id,
    actor: {
      objectType: 'Agent',
      name: 'Player 7F3A',
      account: { homePage: XAPI_HOMEPAGE, name: input.externalId ?? '7f3a2c1e-0000-4000-8000-000000000000' },
    },
    verb: { id: ANSWERED_VERB_ID, display: { 'en-US': 'answered' } },
    object: { objectType: 'Activity', id: `${XAPI_BASE_IRI}/games/g1/questions/${input.id}` },
    result: { response: 'A', success: input.success },
    timestamp: input.timestamp,
    context: {
      registration: '0b7e2a1c-3d4f-5a6b-8c9d-0e1f2a3b4c5d',
      contextActivities: {
        parent: [{ id: `${XAPI_BASE_IRI}/games/g1` }],
        grouping: [
          { id: learningObjectIri({ book, word: input.word, sense: input.sense }) },
          { id: chapterIri(book, chapter) },
          { id: bookIri(book) },
        ],
      },
      extensions: {
        [`${XAPI_BASE_IRI}/ext/game-id`]: 'g1',
        [EXT_SOURCE_REF]: input.sourceRef ?? `ch${chapter}/vocabulary/1`,
        [EXT_ASPECT]: input.aspect ?? 'reading',
        [EXT_GAME_KIND]: input.gameKind ?? 'leitner-solo',
      },
    },
  };
}
