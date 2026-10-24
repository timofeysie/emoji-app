import { randomUUID } from 'crypto';
import { type APIRequestContext } from '@playwright/test';

/** The stub LRS the e2e API server's XAPI_LRS_ENDPOINT points at (playwright.config.ts). */
export const STUB_LRS_URL = 'http://localhost:3101';

/** Just the fields the xAPI export tests assert on (docs/xAPI/LRS.md statement shape). */
export type StubStatement = {
  id: string;
  actor: { objectType: string; name: string; account: { homePage: string; name: string } };
  verb: { id: string };
  object: { id: string };
  result?: {
    response?: string;
    success?: boolean;
    score?: { raw: number; min: number; max: number; scaled: number };
  };
  context: {
    registration: string;
    statement?: { objectType: string; id: string };
    contextActivities?: { parent?: Array<{ id: string }>; grouping?: Array<{ id: string }> };
    extensions?: Record<string, string>;
  };
  timestamp?: string;
};

const XAPI_BASE = 'https://kogs.link/xapi/emoji-app';
export const ASSESSED_VERB = `${XAPI_BASE}/verbs/assessed`;
export const ANSWERED_VERB = 'http://adlnet.gov/expapi/verbs/answered';
export const EXT = {
  sourceRef: `${XAPI_BASE}/ext/source-ref`,
  aspect: `${XAPI_BASE}/ext/aspect`,
  gameKind: `${XAPI_BASE}/ext/game-kind`,
  role: `${XAPI_BASE}/ext/role`,
  strength: `${XAPI_BASE}/ext/strength`,
  scorer: `${XAPI_BASE}/ext/scorer`,
  gameId: `${XAPI_BASE}/ext/game-id`,
} as const;

/** A vocabulary learning object (docs/xAPI/leitner-method.md L16/L18) and one book source of it. */
export type Word = {
  word: string;
  sense: string;
  kind: 'lexeme' | 'expression';
  /** Book-qualified: `korean-language-book/ch27/vocabulary/1`. */
  sourceRef: string;
};

/** `ko/lexeme/시험/test`, as plans, progress and summaries name it. */
export function learningObjectId(word: Word): string {
  return `ko/${word.kind}/${word.word}/${word.sense}`;
}

/** `…/lo/ko/lexeme/%EC%8B%9C%ED%97%98/test` (L9: percent-encoded). */
export function learningObjectIri(word: Word): string {
  return `${XAPI_BASE}/lo/ko/${word.kind}/${encodeURIComponent(word.word)}/${word.sense}`;
}

/** One past answer to seed as evidence, as a Leitner game would have exported it. */
export type SeedObservation = {
  word: Word;
  aspect: 'reading' | 'writing';
  success: boolean;
  at: Date;
  gameKind?: string;
};

function assessedStatement(externalId: string, observation: SeedObservation): StubStatement {
  const [book, chapter] = observation.word.sourceRef.split('/');
  return {
    id: randomUUID(),
    actor: {
      objectType: 'Agent',
      name: `Player ${externalId.slice(0, 4).toUpperCase()}`,
      account: { homePage: 'https://kogs.link', name: externalId },
    },
    verb: { id: ASSESSED_VERB },
    object: { id: learningObjectIri(observation.word) },
    result: { success: observation.success },
    timestamp: observation.at.toISOString(),
    context: {
      registration: randomUUID(),
      statement: { objectType: 'StatementRef', id: randomUUID() },
      contextActivities: {
        parent: [{ id: `${XAPI_BASE}/games/seeded/questions/seeded` }],
        grouping: [{ id: `${XAPI_BASE}/content/${book}/${chapter}` }, { id: `${XAPI_BASE}/content/${book}` }],
      },
      extensions: {
        [EXT.gameId]: 'seeded',
        [EXT.aspect]: observation.aspect,
        [EXT.role]: 'whole',
        [EXT.strength]: 'direct',
        [EXT.sourceRef]: observation.word.sourceRef,
        [EXT.gameKind]: observation.gameKind ?? 'leitner-solo',
        [EXT.scorer]: 'choice-whole@1',
      },
    },
  };
}

/**
 * Reads back what the server actually sent (docs/testing/playwright-plan.md
 * Phase 4). The export runs server-side, so this is the only way a test sees
 * the statements; `page.route` can't intercept it.
 */
export class StubLrs {
  constructor(private readonly request: APIRequestContext) {}

  /** The next statement POSTs (or GETs) fail with `status` until `clearFailures`. */
  async fail(method: 'POST' | 'GET', status = 503): Promise<void> {
    await this.request.post(`${STUB_LRS_URL}/control/fail`, { data: { method, status } });
  }

  async clearFailures(): Promise<void> {
    await this.request.delete(`${STUB_LRS_URL}/control/fail`);
  }

  /**
   * Past Leitner evidence for one student, with chosen timestamps: the only
   * way to reach L2, L3 or retirement without waiting days between games.
   */
  async seedAssessed(externalId: string, observations: SeedObservation[]): Promise<void> {
    const response = await this.request.post(`${STUB_LRS_URL}/xapi/statements`, {
      data: observations.map((observation) => assessedStatement(externalId, observation)),
    });
    if (!response.ok()) throw new Error(`Seeding the stub LRS failed: ${response.status()}`);
  }

  async allStatements(): Promise<StubStatement[]> {
    const response = await this.request.get(`${STUB_LRS_URL}/xapi/statements`);
    const body = (await response.json()) as { statements: StubStatement[] };
    return body.statements;
  }

  /** Every statement that mentions this game id anywhere (object id or extensions). */
  async statementsForGame(gameId: string): Promise<StubStatement[]> {
    const all = await this.allStatements();
    return all.filter((statement) => JSON.stringify(statement).includes(gameId));
  }
}
