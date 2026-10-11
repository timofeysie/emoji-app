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
  context: { registration: string };
};

/**
 * Reads back what the server actually sent (docs/testing/playwright-plan.md
 * Phase 4). The export runs server-side, so this is the only way a test sees
 * the statements; `page.route` can't intercept it.
 */
export class StubLrs {
  constructor(private readonly request: APIRequestContext) {}

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
