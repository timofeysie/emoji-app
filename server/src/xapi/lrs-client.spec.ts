import {
  loadLrsConfigFromEnv,
  LrsConflictError,
  LrsRequestError,
  sendStatements,
  type LrsConfig,
} from './lrs-client';
import type { XApiStatement } from './statement-builder';

const CONFIG: LrsConfig = {
  endpoint: 'https://emojiapp-dev.lrs.io/xapi/',
  key: 'emoji-app-server',
  secret: 'secret',
};

function statement(id: string): XApiStatement {
  return {
    id,
    actor: { objectType: 'Agent', name: 'Player 0000', account: { homePage: 'https://kogs.link', name: id } },
    verb: { id: 'http://adlnet.gov/expapi/verbs/scored', display: { 'en-US': 'scored' } },
    object: {
      objectType: 'Activity',
      id: 'https://kogs.link/xapi/emoji-app/games/g',
      definition: { type: 'http://adlnet.gov/expapi/activities/assessment', name: { 'en-US': 'g' } },
    },
    result: { score: { raw: 1, min: 0, max: 1, scaled: 1 } },
    timestamp: new Date().toISOString(),
    context: { registration: 'r' },
  };
}

describe('loadLrsConfigFromEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads the three env vars', () => {
    process.env['XAPI_LRS_ENDPOINT'] = CONFIG.endpoint;
    process.env['XAPI_LRS_KEY'] = CONFIG.key;
    process.env['XAPI_LRS_SECRET'] = CONFIG.secret;
    expect(loadLrsConfigFromEnv()).toEqual(CONFIG);
  });

  it('throws a clear message when any var is missing, rather than failing at startup', () => {
    delete process.env['XAPI_LRS_ENDPOINT'];
    delete process.env['XAPI_LRS_KEY'];
    delete process.env['XAPI_LRS_SECRET'];
    expect(() => loadLrsConfigFromEnv()).toThrow(/XAPI_LRS_ENDPOINT/);
  });
});

describe('sendStatements', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to the standard /statements resource with Basic Auth and the version header', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendStatements(CONFIG, [statement('a')]);

    expect(result).toEqual({ sent: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://emojiapp-dev.lrs.io/xapi/statements');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Experience-API-Version']).toBe('1.0.3');
    expect(init.headers['Authorization']).toBe(
      `Basic ${Buffer.from('emoji-app-server:secret').toString('base64')}`,
    );
    expect(JSON.parse(init.body)).toHaveLength(1);
  });

  it('sends more than BATCH_SIZE statements as multiple requests', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const statements = Array.from({ length: 51 }, (_, i) => statement(`s${i}`));
    const result = await sendStatements(CONFIG, statements);

    expect(result).toEqual({ sent: 51 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveLength(50);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toHaveLength(1);
  });

  it('maps a 409 to LrsConflictError (changed re-send; docs/xAPI/LRS.md idempotency)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 409, text: async () => 'ids already in the DB' }) as unknown as typeof fetch;

    await expect(sendStatements(CONFIG, [statement('a')])).rejects.toBeInstanceOf(LrsConflictError);
  });

  it('maps any other non-OK status to LrsRequestError', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' }) as unknown as typeof fetch;

    await expect(sendStatements(CONFIG, [statement('a')])).rejects.toBeInstanceOf(LrsRequestError);
  });
});
