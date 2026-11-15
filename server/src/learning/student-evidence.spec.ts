import { assessedStatement } from '../test/leitner-statements';
import type { LrsConfig } from '../xapi/lrs-client';
import { foldTracks } from './leitner';
import { KOREAN } from './learning-object';
import {
  fetchStudentEvidence,
  invalidateStudentEvidence,
  REBUILD_AFTER_MS,
  rememberSentStatements,
} from './student-evidence';

const CONFIG: LrsConfig = { endpoint: 'https://lrs.example/xapi/', key: 'k', secret: 's' };
const EXTERNAL_ID = '7f3a2c1e-0000-4000-8000-000000000000';

/** An assessed statement as the LRS returns it, with `stored`. */
function stored(id: string, storedAt: string, extra: { word?: string; sense?: string; success?: boolean; timestamp?: string } = {}) {
  return {
    ...assessedStatement({
      id,
      word: extra.word ?? '시험',
      sense: extra.sense ?? 'test',
      success: extra.success ?? true,
      timestamp: extra.timestamp ?? storedAt,
    }),
    stored: storedAt,
  };
}

describe('student evidence cache', () => {
  const originalFetch = global.fetch;
  /** What the LRS has; GET honours `since` (on `stored`). */
  let lrs: Array<Record<string, unknown>>;
  let requests: URL[];

  beforeEach(() => {
    lrs = [];
    requests = [];
    global.fetch = jest.fn(async (url: string) => {
      const parsed = new URL(url);
      requests.push(parsed);
      const since = parsed.searchParams.get('since');
      const statements = lrs.filter((statement) => !since || Date.parse(String(statement['stored'])) > Date.parse(since));
      return { ok: true, status: 200, json: async () => ({ statements, more: '' }) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const read = () => fetchStudentEvidence(CONFIG, EXTERNAL_ID, KOREAN);

  it('reads the whole history once, then only what is new since the last stored time (minus 5 s)', async () => {
    lrs = [stored('a', '2026-11-01T10:00:00.000Z'), stored('b', '2026-11-02T10:00:00.000Z')];
    expect((await read()).statements).toHaveLength(2);
    expect(requests[0].searchParams.has('since')).toBe(false);

    lrs.push(stored('c', '2026-11-03T10:00:00.000Z', { word: '독감', sense: 'flu' }));
    const { statements } = await read();

    expect(requests).toHaveLength(2);
    expect(requests[1].searchParams.get('since')).toBe('2026-11-02T09:59:55.000Z');
    expect(statements.map((statement) => (statement as { id: string }).id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('dedupes the overlap: a statement read twice counts once', async () => {
    lrs = [stored('a', '2026-11-01T10:00:00.000Z')];
    await read();
    // Stored in the same instant as the last one seen: inside the 5 s overlap.
    lrs.push(stored('b', '2026-11-01T10:00:00.000Z', { word: '독감', sense: 'flu' }));
    lrs[0] = { ...lrs[0], stored: '2026-11-01T10:00:01.000Z' };

    const { observations } = await read();
    expect(observations.map((observation) => observation.statementId).sort()).toEqual(['a', 'b']);
  });

  it('picks up a badge game exported late: old timestamp, new stored time', async () => {
    lrs = [stored('a', '2026-11-05T10:00:00.000Z')];
    await read();
    lrs.push(stored('late', '2026-11-06T10:00:00.000Z', { word: '독감', sense: 'flu', timestamp: '2026-10-20T10:00:00.000Z' }));

    const { observations } = await read();
    expect(observations.find((observation) => observation.statementId === 'late')?.timestamp).toBe('2026-10-20T10:00:00.000Z');
  });

  it('drops a voided statement on a rebuild: after 24 h, or after "Recompute levels"', async () => {
    const now = Date.parse('2026-11-08T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    lrs = [stored('a', '2026-11-01T10:00:00.000Z'), stored('voided', '2026-11-02T10:00:00.000Z', { word: '독감', sense: 'flu' })];
    await read();

    // The LRS no longer returns it, but an incremental read can't tell.
    lrs = lrs.filter((statement) => statement['id'] !== 'voided');
    expect((await read()).statements).toHaveLength(2);

    jest.spyOn(Date, 'now').mockReturnValue(now + REBUILD_AFTER_MS);
    expect((await read()).statements).toHaveLength(1);
    expect(requests[requests.length - 1].searchParams.has('since')).toBe(false);

    lrs.push(stored('voided-2', '2026-11-03T10:00:00.000Z'));
    await read();
    lrs = lrs.filter((statement) => statement['id'] !== 'voided-2');
    invalidateStudentEvidence(CONFIG, EXTERNAL_ID);
    expect((await read()).statements).toHaveLength(1);
  });

  it('shows statements this server just sent, before the LRS returns them', async () => {
    lrs = [stored('a', '2026-11-01T10:00:00.000Z')];
    await read();
    const sent = assessedStatement({ id: 'yalla-1', word: '독감', sense: 'flu', success: true, timestamp: '2026-11-08T00:00:00.000Z' });
    rememberSentStatements(CONFIG, EXTERNAL_ID, [{ verb: { id: 'http://adlnet.gov/expapi/verbs/answered' }, id: 'answered-1' }, sent]);

    const { statements, observations } = await read();
    expect(statements).toHaveLength(2);
    expect(observations.map((observation) => observation.statementId)).toContain('yalla-1');
  });

  it('gives the same tracks from the cache as from a full read', async () => {
    lrs = [
      stored('a', '2026-11-01T10:00:00.000Z'),
      stored('b', '2026-11-02T10:00:00.000Z', { success: false }),
      stored('c', '2026-11-02T12:00:00.000Z', { word: '독감', sense: 'flu' }),
    ];
    await read();
    lrs.push(stored('d', '2026-11-03T10:00:00.000Z'), stored('e', '2026-11-04T10:00:00.000Z', { word: '독감', sense: 'flu' }));
    const cached = foldTracks((await read()).observations);

    invalidateStudentEvidence(CONFIG, EXTERNAL_ID);
    const full = foldTracks((await read()).observations);
    expect(cached).toEqual(full);
  });

  it('keeps reading in full when the LRS gives no stored times', async () => {
    lrs = [{ ...stored('a', '2026-11-01T10:00:00.000Z'), stored: undefined }];
    await read();
    await read();
    expect(requests.every((request) => !request.searchParams.has('since'))).toBe(true);
  });
});
