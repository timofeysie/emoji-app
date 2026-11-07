// Stub LRS for the xAPI export e2e tests (docs/testing/playwright-plan.md,
// Phase 4). The real export (POST /api/games/:id/xapi-export) runs
// server-side, so page.route can't see it; the e2e API server points
// XAPI_LRS_ENDPOINT at this process instead of a real LRS. Implements just
// enough of the standard xAPI /statements resource for the delivery client
// (server/src/xapi/lrs-client.ts): POST ingest with id-conflict detection,
// GET list for test assertions. No auth check — credential handling is
// already covered by the real Veracity smoke test (docs/xAPI/LRS.md).
//
// Leitner (docs/xAPI/leitner-method.md → Reading from the LRS): GET honours
// the standard `agent`, `verb`, `activity` + `related_activities` and `since`
// filters, and a `limit` query is paged with `more` links (capped at
// STUB_LRS_MAX_PAGE, so the server's paging is exercised with few statements).
// Order is `stored` order, as in a real LRS. `/control/fail` makes the next
// POSTs or GETs fail, for the pending-export / Retry tests.
import { createServer } from 'http';

const port = Number(process.env.STUB_LRS_PORT ?? 3101);
const maxPage = Number(process.env.STUB_LRS_MAX_PAGE ?? 500);

/** statementId -> the exact statement object last accepted under that id. */
const statementsById = new Map();

/** `{ post?: { status, body }, get?: { status, body } }`: injected failures, until cleared. */
let failures = {};

function matchesAgent(statement, agent) {
  const actor = statement.actor ?? {};
  if (agent.account) {
    return actor.account?.homePage === agent.account.homePage && actor.account?.name === agent.account.name;
  }
  if (agent.mbox) return actor.mbox === agent.mbox;
  return false;
}

function activityIds(statement, related) {
  const ids = [statement.object?.id];
  if (related) {
    const activities = statement.context?.contextActivities ?? {};
    for (const key of ['parent', 'grouping', 'category', 'other']) {
      for (const activity of activities[key] ?? []) ids.push(activity.id);
    }
  }
  return ids;
}

/** The standard xAPI statement filters this stub supports. Throws on a bad `agent`. */
function filterStatements(params) {
  const agent = params.get('agent') ? JSON.parse(params.get('agent')) : null;
  const verb = params.get('verb');
  const activity = params.get('activity');
  const related = params.get('related_activities') === 'true';
  const since = params.get('since');
  return [...statementsById.values()].filter(
    (statement) =>
      (!agent || matchesAgent(statement, agent)) &&
      (!verb || statement.verb?.id === verb) &&
      (!activity || activityIds(statement, related).includes(activity)) &&
      (!since || Date.parse(statement.stored ?? statement.timestamp) > Date.parse(since)),
  );
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/control/fail' && req.method === 'POST') {
    const body = (await readJsonBody(req).catch(() => undefined)) ?? {};
    const failure = { status: body.status ?? 503, body: body.body ?? { error: 'Stub LRS failure (injected)' } };
    failures = { ...failures, [body.method === 'GET' ? 'get' : 'post']: failure };
    send(res, 200, { ok: true, failures });
    return;
  }

  if (url.pathname === '/control/fail' && req.method === 'DELETE') {
    failures = {};
    send(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/xapi/statements' && req.method === 'POST' && failures.post) {
    send(res, failures.post.status, failures.post.body);
    return;
  }

  if (url.pathname === '/xapi/statements' && req.method === 'GET' && failures.get) {
    send(res, failures.get.status, failures.get.body);
    return;
  }

  if (url.pathname === '/xapi/statements' && req.method === 'POST') {
    let batch;
    try {
      batch = await readJsonBody(req);
    } catch {
      send(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (!Array.isArray(batch)) {
      send(res, 400, { error: 'Expected an array of statements' });
      return;
    }

    for (const statement of batch) {
      const existing = statementsById.get(statement.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(statement)) {
        send(res, 409, {
          error: `Statement '${statement.id}' already exists with different content.`,
        });
        return;
      }
    }
    for (const statement of batch) {
      statementsById.set(statement.id, statement);
    }
    send(
      res,
      200,
      batch.map((statement) => statement.id),
    );
    return;
  }

  if (url.pathname === '/xapi/statements' && req.method === 'GET') {
    let matching;
    try {
      matching = filterStatements(url.searchParams);
    } catch {
      send(res, 400, { error: 'Invalid agent' });
      return;
    }
    const limit = Number(url.searchParams.get('limit') ?? 0);
    if (!limit) {
      // Test read-back (fixtures/stub-lrs.ts): everything, unpaged.
      send(res, 200, { statements: matching, more: '' });
      return;
    }
    const pageSize = Math.min(limit, maxPage);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = matching.slice(offset, offset + pageSize);
    let more = '';
    if (offset + pageSize < matching.length) {
      const next = new URLSearchParams(url.searchParams);
      next.set('offset', String(offset + pageSize));
      more = `/xapi/statements?${next.toString()}`;
    }
    send(res, 200, { statements: page, more });
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`[stub-lrs] listening on http://localhost:${port}`);
});
