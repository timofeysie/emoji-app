import { ASSESSED_VERB_ID, XAPI_HOMEPAGE } from '../xapi/iris';
import { fetchStatements, type LrsConfig } from '../xapi/lrs-client';
import { DEFAULT_LEITNER_CONFIG, LeitnerConfig, LeitnerObservation, observationsFromStatements } from './leitner';

/** Statements per LRS page; Veracity and most LRSs cap lower anyway. */
const PAGE_SIZE = 500;

/**
 * One student's `assessed` statements and the observations that count
 * (docs/xAPI/leitner-method.md → Reading from the LRS). `agent` keeps tracks
 * per student (L4). No activity filter: learning objects are
 * language-scoped (L16), so evidence from every book and chapter counts.
 */
export async function fetchStudentEvidence(
  config: LrsConfig,
  externalId: string,
  language: string,
  leitnerConfig: LeitnerConfig = DEFAULT_LEITNER_CONFIG,
): Promise<{ statements: unknown[]; observations: LeitnerObservation[] }> {
  const statements = await fetchStatements(config, {
    agent: { objectType: 'Agent', account: { homePage: XAPI_HOMEPAGE, name: externalId } },
    verb: ASSESSED_VERB_ID,
    limit: PAGE_SIZE,
  });
  return { statements, observations: observationsFromStatements(statements, language, leitnerConfig) };
}
