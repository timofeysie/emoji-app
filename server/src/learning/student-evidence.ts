import { ASSESSED_VERB_ID, XAPI_HOMEPAGE } from '../xapi/iris';
import { fetchStatements, type LrsConfig } from '../xapi/lrs-client';
import { DEFAULT_LEITNER_CONFIG, LeitnerConfig, LeitnerObservation, observationsFromStatements } from './leitner';

/** Statements per LRS page; Veracity and most LRSs cap lower anyway. */
const PAGE_SIZE = 500;

/** A cached player's history is read in full again after this (and on server start). */
export const REBUILD_AFTER_MS = 24 * 60 * 60 * 1000;
/** Incremental reads start this far before the newest `stored` seen: same-instant statements aren't missed. */
export const SINCE_OVERLAP_MS = 5000;
/** A full rebuild may page further than a one-off read (500k statements). */
const REBUILD_MAX_PAGES = 1000;

/**
 * Per-player cache of `assessed` statements (docs/yalla/implementation-plan.md
 * §5 → Keeping Leitner levels accurate, milestone Y6). A copy of LRS data
 * that can always be rebuilt, so levels stay derived from statements.
 * Every read still asks the LRS for what's new (`since` the newest `stored`
 * seen, usually one short page); the full history is read only when the
 * entry is built: on the first read after a server start, after
 * `REBUILD_AFTER_MS`, and after `invalidateStudentEvidence` ("Recompute
 * levels"). Rebuilds are what drop voided statements, which the
 * `verb=assessed` incremental read can't see.
 */
type CacheEntry = {
  /** Every `assessed` statement, by id: a later copy (with `stored`) replaces an earlier one. */
  statements: Map<string, unknown>;
  /** Newest LRS `stored` time seen; null = none had one, so every read is a full read. */
  lastStored: string | null;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();
/** One read at a time per player, so two requests don't race on an entry. */
const queues = new Map<string, Promise<unknown>>();

function cacheKey(config: LrsConfig, externalId: string): string {
  return `${config.endpoint}|${externalId}`;
}

function idOf(statement: unknown): string | null {
  const id = (statement as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function storedOf(statement: unknown): string | null {
  const stored = (statement as { stored?: unknown } | null)?.stored;
  return typeof stored === 'string' && !Number.isNaN(Date.parse(stored)) ? stored : null;
}

function merge(entry: CacheEntry, statements: readonly unknown[]): void {
  for (const statement of statements) {
    const id = idOf(statement);
    if (!id) continue;
    entry.statements.set(id, statement);
    const stored = storedOf(statement);
    if (stored && (!entry.lastStored || Date.parse(stored) > Date.parse(entry.lastStored))) {
      entry.lastStored = stored;
    }
  }
}

function agentOf(externalId: string) {
  return { objectType: 'Agent', account: { homePage: XAPI_HOMEPAGE, name: externalId } };
}

async function refresh(config: LrsConfig, externalId: string, now: number): Promise<unknown[]> {
  const key = cacheKey(config, externalId);
  const existing = cache.get(key);
  const query = { agent: agentOf(externalId), verb: ASSESSED_VERB_ID, limit: PAGE_SIZE };

  if (!existing || !existing.lastStored || now - existing.builtAt >= REBUILD_AFTER_MS) {
    const statements = await fetchStatements(config, query, { maxPages: REBUILD_MAX_PAGES });
    const entry: CacheEntry = { statements: new Map(), lastStored: null, builtAt: now };
    merge(entry, statements);
    cache.set(key, entry);
    return [...entry.statements.values()];
  }

  const since = new Date(Date.parse(existing.lastStored) - SINCE_OVERLAP_MS).toISOString();
  merge(existing, await fetchStatements(config, { ...query, since }));
  return [...existing.statements.values()];
}

/** The player's `assessed` statements, through the cache. */
async function cachedAssessedStatements(config: LrsConfig, externalId: string): Promise<unknown[]> {
  const key = cacheKey(config, externalId);
  const previous = queues.get(key) ?? Promise.resolve();
  const read = previous.catch(() => undefined).then(() => refresh(config, externalId, Date.now()));
  queues.set(key, read);
  try {
    return await read;
  } finally {
    if (queues.get(key) === read) queues.delete(key);
  }
}

/**
 * One student's `assessed` statements and the observations that count
 * (docs/xAPI/leitner-method.md → Reading from the LRS). `agent` keeps tracks
 * per student (L4). No activity filter: learning objects are
 * language-scoped (L16), so evidence from every book and chapter counts.
 * Read through the evidence cache, so a view usually costs one LRS request.
 */
export async function fetchStudentEvidence(
  config: LrsConfig,
  externalId: string,
  language: string,
  leitnerConfig: LeitnerConfig = DEFAULT_LEITNER_CONFIG,
): Promise<{ statements: unknown[]; observations: LeitnerObservation[] }> {
  const statements = await cachedAssessedStatements(config, externalId);
  return { statements, observations: observationsFromStatements(statements, language, leitnerConfig) };
}

/**
 * Statements this server just sent to the LRS (YALLA results): the next
 * read sees them even if the LRS is slow to return them. Only `assessed`
 * ones are kept; the incremental read later replaces them with the LRS copy.
 */
export function rememberSentStatements(config: LrsConfig, externalId: string, statements: readonly unknown[]): void {
  const entry = cache.get(cacheKey(config, externalId));
  if (!entry) return;
  merge(
    entry,
    statements.filter((statement) => (statement as { verb?: { id?: unknown } } | null)?.verb?.id === ASSESSED_VERB_ID),
  );
}

/** The next read rebuilds this player's history from the LRS ("Recompute levels"). */
export function invalidateStudentEvidence(config: LrsConfig, externalId: string): void {
  cache.delete(cacheKey(config, externalId));
}

/** Tests: start every spec with an empty cache. */
export function resetEvidenceCache(): void {
  cache.clear();
  queues.clear();
}

/**
 * Every statement about one student, any verb (Players → activity). One
 * read for games, answers and the fold; the fold still keeps only `assessed`.
 * Not cached.
 */
export async function fetchStudentStatements(config: LrsConfig, externalId: string): Promise<unknown[]> {
  return fetchStatements(config, { agent: agentOf(externalId), limit: PAGE_SIZE });
}
