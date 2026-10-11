// Stub LRS for the xAPI export e2e tests (docs/testing/playwright-plan.md,
// Phase 4). The real export (POST /api/games/:id/xapi-export) runs
// server-side, so page.route can't see it; the e2e API server points
// XAPI_LRS_ENDPOINT at this process instead of a real LRS. Implements just
// enough of the standard xAPI /statements resource for the delivery client
// (server/src/xapi/lrs-client.ts): POST ingest with id-conflict detection,
// GET list for test assertions. No auth check — credential handling is
// already covered by the real Veracity smoke test (docs/xAPI/LRS.md).
import { createServer } from 'http';

const port = Number(process.env.STUB_LRS_PORT ?? 3101);

/** statementId -> the exact statement object last accepted under that id. */
const statementsById = new Map();

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
    send(res, 200, { statements: [...statementsById.values()] });
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`[stub-lrs] listening on http://localhost:${port}`);
});
