import type { XApiStatement } from './statement-builder';

const XAPI_VERSION_HEADER = '1.0.3';
const BATCH_SIZE = 50;

export type LrsConfig = {
  endpoint: string;
  key: string;
  secret: string;
};

/**
 * `XAPI_LRS_ENDPOINT`/`_KEY`/`_SECRET` are read lazily, at export time, not at
 * server startup (docs/xAPI/LRS.md → Step 3): a missing/misconfigured LRS must
 * not stop the rest of the app from working.
 */
export function loadLrsConfigFromEnv(): LrsConfig {
  const endpoint = process.env['XAPI_LRS_ENDPOINT'];
  const key = process.env['XAPI_LRS_KEY'];
  const secret = process.env['XAPI_LRS_SECRET'];
  if (!endpoint || !key || !secret) {
    throw new Error(
      'xAPI export is not configured: set XAPI_LRS_ENDPOINT, XAPI_LRS_KEY and XAPI_LRS_SECRET.',
    );
  }
  return { endpoint, key, secret };
}

/** The LRS rejected a re-sent statement id because its content changed (docs/xAPI/LRS.md → Idempotency). */
export class LrsConflictError extends Error {
  constructor(public readonly body: string) {
    super('The LRS already has a statement with this id, stored with different content.');
  }
}

export class LrsRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`LRS request failed with ${status}: ${body}`);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Sends statements to the configured LRS's standard xAPI `/statements`
 * resource only (`POST`, array body) — never a Veracity-specific endpoint, so
 * swapping LRS stays a config change (docs/xAPI/LRS.md → Veracity setup).
 * Batches of `BATCH_SIZE` per request per docs/xAPI/LRS.md → Idempotency.
 */
export async function sendStatements(
  config: LrsConfig,
  statements: XApiStatement[],
): Promise<{ sent: number }> {
  const endpoint = config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint;
  const authHeader = `Basic ${Buffer.from(`${config.key}:${config.secret}`).toString('base64')}`;

  for (const batch of chunk(statements, BATCH_SIZE)) {
    const response = await fetch(`${endpoint}/statements`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'X-Experience-API-Version': XAPI_VERSION_HEADER,
      },
      body: JSON.stringify(batch),
    });

    if (response.ok) {
      continue;
    }

    const body = await response.text();
    if (response.status === 409) {
      throw new LrsConflictError(body);
    }
    throw new LrsRequestError(response.status, body);
  }

  return { sent: statements.length };
}

const MAX_PAGES = 100;

export type StatementQuery = {
  /** Account actor, e.g. `{ objectType: 'Agent', account: { homePage, name } }`. */
  agent?: unknown;
  verb?: string;
  activity?: string;
  /** Match `activity` against context activities (grouping) too. */
  relatedActivities?: boolean;
  since?: string;
  /** Page size; the LRS may cap it. */
  limit?: number;
};

/**
 * Reads statements from the standard xAPI `GET /statements` resource and
 * follows `more` until it's empty (docs/xAPI/leitner-method.md → Reading
 * from the LRS). Voided statements are excluded by the LRS. A `more` link
 * on another origin is refused, so credentials only go to the configured LRS.
 */
export async function fetchStatements(config: LrsConfig, query: StatementQuery): Promise<unknown[]> {
  const endpoint = config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint;
  const authHeader = `Basic ${Buffer.from(`${config.key}:${config.secret}`).toString('base64')}`;
  const origin = new URL(endpoint).origin;

  const params = new URLSearchParams();
  if (query.agent !== undefined) params.set('agent', JSON.stringify(query.agent));
  if (query.verb) params.set('verb', query.verb);
  if (query.activity) params.set('activity', query.activity);
  if (query.relatedActivities) params.set('related_activities', 'true');
  if (query.since) params.set('since', query.since);
  if (query.limit) params.set('limit', String(query.limit));

  const statements: unknown[] = [];
  let url: string | null = `${endpoint}/statements?${params.toString()}`;
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES) {
      throw new LrsRequestError(0, `Stopped after ${MAX_PAGES} pages of statements.`);
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader, 'X-Experience-API-Version': XAPI_VERSION_HEADER },
    });
    if (!response.ok) {
      throw new LrsRequestError(response.status, await response.text());
    }

    const body = (await response.json()) as { statements?: unknown; more?: unknown };
    if (!Array.isArray(body.statements)) {
      throw new LrsRequestError(response.status, 'Response has no statements array.');
    }
    statements.push(...body.statements);

    if (typeof body.more === 'string' && body.more.length > 0) {
      const next = new URL(body.more, `${endpoint}/`);
      if (next.origin !== origin) {
        throw new LrsRequestError(response.status, `Refusing 'more' link to another origin: ${next.origin}`);
      }
      url = next.toString();
    } else {
      url = null;
    }
  }
  return statements;
}
